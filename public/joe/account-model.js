// The whole IB paper account over time (pure, display only). The board server
// records the account's exact EUR value, kept holdings included, in two
// stores (GET /joe/account-history.json): every accepted snapshot of the last
// 14 days, and the last exact value of each Vienna calendar day for years.
// 1D and 5D read the first, the longer ranges the second. Only recorded
// values are drawn: nothing before the first or after the last observation,
// a gap breaks the line, and no value is ever interpolated, carried or
// extrapolated. Changes are exact: decimal strings become BigInt units.
import { viennaDay, zonedInstant, VIENNA } from './time.mjs';
import { decimalUnits, divRound, UNIT } from './contracts/decimal.mjs';
import { validInstant } from './contracts/schema-validator.mjs';
import { placeWindow, resolveView } from './history-model.js';
import { trustedCurrent } from './board-state.js';
import { dayDM, timeHM, digits, MONTH, MINUS, NB } from './format.js';

export const RANGES = Object.freeze(['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All']);
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const SPAN = { '1D': DAY, '5D': 5 * DAY, '1M': 30 * DAY, '6M': 182 * DAY, '1Y': 365 * DAY };
// What each range button stands for, in words.
export const RANGE_TITLE = Object.freeze({ '1D': 'The last day', '5D': 'The last 5 days', '1M': 'The last month', '6M': 'The last 6 months',
  YTD: 'Year to date: since 1 January', '1Y': 'The last year', All: 'Everything recorded' });
// The same, as words after "the whole paper account" in the chart's name.
export const RANGE_WORD = Object.freeze({ '1D': 'over the last day', '5D': 'over the last 5 days', '1M': 'over the last month', '6M': 'over the last 6 months',
  YTD: 'since 1 January', '1Y': 'over the last year', All: 'everything recorded' });
export const sourceOf = range => (range === '1D' || range === '5D' ? 'short' : 'daily');
// Snapshots arrive every few seconds in the session and every 15 minutes
// overnight: a longer interval between two of them is a gap, never joined.
// Closes are joined only from one calendar day to the next.
export const SHORT_GAP_MS = 20 * MIN;
// How far a change may reach for its starting value: an observation this
// close to the window's start stands for it.
const TOLERANCE = { short: SHORT_GAP_MS, daily: 1.5 * DAY };
// The narrowest window: five minutes of snapshots, or three days of closes.
export const MIN_SPAN = Object.freeze({ short: 5 * MIN, daily: 3 * DAY });

// ---------- The read ----------
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/;
const exactEur = m => Boolean(m) && typeof m === 'object' && m.currency === 'EUR' && typeof m.amount === 'string' && m.amount.length <= 32 && DECIMAL.test(m.amount);
const reasonOf = r => (typeof r === 'string' && /^[a-z_]{1,64}$/.test(r) ? r : null);
const lossOf = d => (d && typeof d === 'object' && validInstant(d.at) ? { at: d.at, reason: reasonOf(d.reason) } : null);
const invalid = () => { throw new Error('contract_invalid'); };
// The endpoint's body as two typed series. Anything outside the documented
// shape refuses the whole read (the last good one stays), like every feed.
export function acceptAccountHistory(body) {
  if (!body || body.schema !== 'inspr.joe.account-history.v1' || !Array.isArray(body.points) || !Array.isArray(body.dailyCloses?.days)) invalid();
  const short = { source: 'short', t: [], v: [], amount: [], why: [], day: null };
  let last = -Infinity;
  for (const p of body.points) {
    const t = validInstant(p?.t) ? Date.parse(p.t) : NaN, equity = p?.account?.equity;
    if (!(t > last) || (equity !== null && !exactEur(equity))) invalid();
    last = t;
    short.t.push(t); short.amount.push(equity ? equity.amount : null); short.v.push(equity ? Number(equity.amount) : NaN);
    short.why.push(equity ? null : reasonOf(p.account?.reasons?.equity) ?? 'source_unavailable');
  }
  const daily = { source: 'daily', t: [], v: [], amount: [], why: [], day: [] };
  let lastDay = '';
  last = -Infinity;
  for (const d of body.dailyCloses.days) {
    if (typeof d?.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || d.day <= lastDay) invalid();
    lastDay = d.day;
    // A day that recorded only cash has no account value to draw.
    if (d.equity === null) continue;
    const t = validInstant(d.equityAt) ? Date.parse(d.equityAt) : NaN;
    if (!exactEur(d.equity) || !(t > last) || viennaDay(d.equityAt) !== d.day) invalid();
    last = t;
    daily.t.push(t); daily.amount.push(d.equity.amount); daily.v.push(Number(d.equity.amount)); daily.why.push(null); daily.day.push(d.day);
  }
  return {
    short: { ...short, reason: reasonOf(body.reason), loss: lossOf(body.discontinuity) },
    daily: { ...daily, reason: reasonOf(body.dailyCloses.reason), loss: lossOf(body.dailyCloses.discontinuity) },
  };
}
export const emptySeries = source => ({ source, t: [], v: [], amount: [], why: [], day: source === 'daily' ? [] : null, reason: null, loss: null });

// ---------- The live edge ----------
// The account value the board shows now, when it is current and exact: the
// same observation the server records from this snapshot. Never a retained,
// stale or not-exact value.
export function liveObservation(cell, data) {
  if (!trustedCurrent(cell) || !exactEur(cell.value)) return null;
  const t = validInstant(data?.generatedAt) ? Date.parse(data.generatedAt) : NaN, observedAt = data?.brokerAccount?.observedAt;
  if (!Number.isFinite(t) || !validInstant(observedAt) || Date.parse(observedAt) > t) return null;
  return { t, observedAt, amount: cell.value.amount };
}
// The series with the live value at its end: after the newest snapshot, or
// as today's close so far (it replaces an older value of the same day). It
// only extends recorded history: alone it is no chart.
export function withLive(series, live) {
  if (!live || !series.v.some(Number.isFinite)) return series;
  const n = series.t.length, add = (at, day, replace) => {
    const keep = replace ? n - 1 : n, cut = a => a.slice(0, keep);
    return { ...series, t: [...cut(series.t), at], v: [...cut(series.v), Number(live.amount)], amount: [...cut(series.amount), live.amount],
      why: [...cut(series.why), null], day: series.day ? [...cut(series.day), day] : null, live: at };
  };
  if (series.source === 'short') return n && series.t[n - 1] >= live.t ? series : add(live.t, null, false);
  const at = Date.parse(live.observedAt), day = viennaDay(live.observedAt), lastDay = series.day[n - 1];
  if (n && (lastDay > day || (lastDay === day && series.t[n - 1] >= at))) return series;
  return add(at, day, Boolean(n) && lastDay === day);
}

// ---------- Windows ----------
const firstObserved = s => s.v.findIndex(Number.isFinite);
// Everything this series can show: from its first recorded value to now.
export function keptRange(series, now) {
  const i = firstObserved(series);
  if (i < 0) return null;
  return [series.t[i], Math.max(now, series.t.at(-1))];
}
export function rangeStart(range, now) {
  if (range === 'All') return -Infinity;
  if (range === 'YTD') return Date.parse(zonedInstant(`${viennaDay(new Date(now).toISOString()).slice(0, 4)}-01-01`, '00:00:00', VIENNA));
  return now - SPAN[range];
}
// A range ends now; one longer than what is recorded shows all of it.
export function presetWindow(full, range) {
  const start = rangeStart(range, full[1]);
  return start <= full[0] ? [full[0], full[1]] : placeWindow(full, full[1] - start, full[1], 1);
}
// The window shown: the chosen range, or a window the viewer moved, which
// follows the newest value while it ends there (History's rules).
export const accountWindow = (full, { range, view = null, follow = true }) => (view ? resolveView(full, { view, follow }) : presetWindow(full, range));
// The range a window matches, if any: the chosen one first.
export function windowRange(full, [a, b], source, chosen) {
  if (full[1] - b > Math.max(1000, (b - a) * 0.002)) return null;
  const near = ([p, q]) => Math.abs(p - a) <= Math.max(1000, (b - a) * 0.002) && Math.abs(q - b) <= Math.max(1000, (b - a) * 0.002);
  const fits = RANGES.filter(r => sourceOf(r) === source && near(presetWindow(full, r)));
  return fits.includes(chosen) ? chosen : fits[0] ?? null;
}

// ---------- Honest coverage ----------
// Whether the series reaches back to the range's start, and since when it
// records: a range without enough history says so, never extrapolates.
export function coverage(series, range, now) {
  const i = firstObserved(series);
  if (i < 0) return { recorded: false, complete: false };
  const first = series.t[i];
  const complete = range === 'All' || first - rangeStart(range, now) <= TOLERANCE[series.source];
  const days = series.day ? new Set(series.day.filter((_, k) => Number.isFinite(series.v[k]))).size : 0;
  return { recorded: true, complete, first, days };
}
export function spanWords(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MIN))}${NB}min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}${NB}h`;
  const d = Math.floor(ms / DAY);
  return `${d}${NB}day${d === 1 ? '' : 's'}`;
}
const when = (ms, withTime) => { const at = new Date(ms).toISOString(); return withTime ? `${dayDM(at)}, ${timeHM(at)}` : dayDM(at); };
export function recordingText(cov, source, now) {
  if (!cov.recorded || cov.complete) return '';
  const so = source === 'daily' ? `${cov.days}${NB}day${cov.days === 1 ? '' : 's'}` : spanWords(now - cov.first);
  return `Recording since ${when(cov.first, source === 'short')} · ${so} so far`;
}

// ---------- The change over a window ----------
const lower = (t, x) => { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } return lo; };
const upper = (t, x) => { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m + 1; else hi = m; } return lo; };
// Exact: from the value standing at the window's start (the last one before
// it, if close enough, else the first inside) to the last value inside.
export function rangeChange(series, [x0, x1]) {
  let e = upper(series.t, x1) - 1;
  while (e >= 0 && !Number.isFinite(series.v[e])) e--;
  if (e < 0 || series.t[e] < x0) return null;
  const tol = TOLERANCE[series.source];
  let s = upper(series.t, x0) - 1;
  while (s >= 0 && !Number.isFinite(series.v[s])) s--;
  if (s < 0 || x0 - series.t[s] > tol) { s = lower(series.t, x0); while (s < e && !Number.isFinite(series.v[s])) s++; }
  if (s >= e) return null;
  const a = decimalUnits(series.amount[s]), b = decimalUnits(series.amount[e]);
  return { from: series.t[s], to: series.t[e], startUnits: a, endUnits: b, change: b - a,
    pct: a > 0n ? divRound((b - a) * 10000n, a) : null, fromStart: Math.abs(series.t[s] - x0) <= tol };
}
// The whole account against the account start set in Settings.
export function sinceStart(units, start) {
  if (typeof units !== 'bigint' || !start || !(start.amountEur > 0)) return null;
  const base = BigInt(Math.round(start.amountEur * 100)) * (UNIT / 100n);
  return { base, change: units - base, pct: divRound((units - base) * 10000n, base) };
}
// Hundredths of a percent as words: "+6,75 %", "−1,49 %", "0,00 %".
export const pctText = hundredths => (hundredths === null || typeof hundredths !== 'bigint' ? '—'
  : `${hundredths < 0n ? MINUS : hundredths > 0n ? '+' : ''}${digits((hundredths < 0n ? -hundredths : hundredths) * (UNIT / 100n), 2)}${NB}%`);

// ---------- What the chart draws ----------
const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
// Display thinning per pixel bucket: first, lowest, highest and last, and
// every break, so extremes and gaps survive.
export function downsample(pts, x0, x1, buckets) {
  if (pts.length <= buckets * 4) return pts;
  const out = [], width = (x1 - x0) / buckets;
  let bucket = null, group = [];
  const flush = () => {
    if (!group.length) return;
    const lo = group.reduce((a, b) => (b.v < a.v ? b : a)), hi = group.reduce((a, b) => (b.v > a.v ? b : a));
    for (const p of [...new Set([group[0], lo, hi, group.at(-1)])].sort((a, b) => a.x - b.x)) out.push(p);
    group = [];
  };
  for (const p of pts) {
    if (p.v === null) { flush(); out.push(p); bucket = null; continue; }
    const b = Math.floor((p.x - x0) / width);
    if (b !== bucket) { flush(); bucket = b; }
    group.push(p);
  }
  flush();
  return out;
}
// Points for the window (one beyond each edge, so lines run to the edges),
// a break wherever the series has a gap, and the gaps as hatched bands: an
// unavailable value, an interval longer than the snapshot cadence, a missing
// calendar day, and the time since the last value when it is that long.
export function chartPoints(series, [x0, x1], now, buckets = Infinity) {
  const { t, v } = series, pts = [], bands = [];
  // From the last value before the window, across unavailable ones, so a gap
  // at the left edge is still drawn as one.
  let i0 = Math.max(0, lower(t, x0) - 1);
  for (let k = 0; i0 > 0 && !Number.isFinite(v[i0]) && k < 10000; k++) i0--;
  const i1 = Math.min(t.length, upper(t, x1) + 1);
  const apart = (a, b) => (series.day ? series.day[b] !== nextDay(series.day[a]) : t[b] - t[a] > SHORT_GAP_MS);
  let prev = -1, missing = false;
  for (let i = i0; i < i1; i++) {
    if (!Number.isFinite(v[i])) { missing = true; continue; }
    if (prev >= 0 && (missing || apart(prev, i))) { pts.push({ x: (t[prev] + t[i]) / 2, v: null }); bands.push([t[prev], t[i]]); }
    pts.push({ x: t[i], v: v[i] });
    prev = i; missing = false;
  }
  const lastSeen = prev >= 0 && i1 === t.length ? t[prev] : null;
  if (lastSeen !== null && (missing || (series.day ? viennaDay(new Date(now).toISOString()) > nextDay(series.day[prev]) : now - lastSeen > SHORT_GAP_MS))) bands.push([lastSeen, now]);
  return { pts: downsample(pts, x0, x1, buckets), bands };
}
// The observation nearest to x and whether it stands for x (it is within
// the gap rule of it); inside a gap the tooltip says no value was recorded.
export function pointNear(series, x) {
  const { t, v } = series, n = t.length;
  if (!n) return null;
  let b = lower(t, x), a = b - 1;
  // The nearest sample of any kind: an unavailable one nearer than every
  // value means no value stands here, for its own reason.
  const any = b >= n || (a >= 0 && x - t[a] <= t[b] - x) ? a : b;
  while (a >= 0 && !Number.isFinite(v[a])) a--;
  while (b < n && !Number.isFinite(v[b])) b++;
  const k = a < 0 ? (b < n ? b : -1) : b >= n || x - t[a] <= t[b] - x ? a : b;
  if (k < 0) return null;
  const reach = series.day ? 0.75 * DAY : SHORT_GAP_MS / 2;
  const why = any !== k && !Number.isFinite(v[any]) && Math.abs(t[any] - x) < Math.abs(t[k] - x) ? series.why[any] ?? 'source_unavailable' : null;
  return { i: k, x: t[k], v: v[k], amount: series.amount[k], day: series.day?.[k] ?? null, stands: Math.abs(t[k] - x) <= reach && !why, why };
}
export const observedTimes = (series, [x0, x1]) => series.t.filter((x, i) => x >= x0 && x <= x1 && Number.isFinite(series.v[i]));
// The value extents of the window (the values inside it and where its line
// crosses each edge) and of everything loaded, for the vertical axis.
export function extents(series, [x0, x1]) {
  const { t, v } = series;
  let lo = Infinity, hi = -Infinity, alo = Infinity, ahi = -Infinity;
  const take = y => { if (y < lo) lo = y; if (y > hi) hi = y; };
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    if (v[i] < alo) alo = v[i];
    if (v[i] > ahi) ahi = v[i];
    if (t[i] >= x0 && t[i] <= x1) take(v[i]);
  }
  for (const x of [x0, x1]) {
    const b = lower(t, x), a = b - 1;
    if (a < 0 || b >= t.length || !Number.isFinite(v[a]) || !Number.isFinite(v[b])) continue;
    if (series.day ? series.day[b] !== nextDay(series.day[a]) : t[b] - t[a] > SHORT_GAP_MS) continue;
    take(v[a] + (v[b] - v[a]) * ((x - t[a]) / (t[b] - t[a] || 1)));
  }
  return { visible: lo <= hi ? [lo, hi] : null, loaded: alo <= ahi ? [alo, ahi] : null };
}

// ---------- The time axis ----------
// Labels at least `gap` pixels apart, on Vienna wall-clock ticks: times
// within a day (a midnight is its date), dates, weeks from Monday, months
// (January is its year). Ticks sit on absolute steps, so a pan never
// reshuffles them. Returns the labels and the lines behind them.
const midnights = new Map();
function midnight(day) {
  let at = midnights.get(day);
  if (at === undefined) { if (midnights.size > 4000) midnights.clear(); at = Date.parse(zonedInstant(day, '00:00:00', VIENNA)); midnights.set(day, at); }
  return at;
}
const dayIndex = day => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
const MON3 = MONTH.map(m => m.slice(0, 3));
export function timeLabels(x0, x1, pw, gap = 56) {
  const span = x1 - x0, perMs = span > 0 ? pw / span : 0;
  const ticks = [];
  const minute = [5, 10, 15, 30, 60, 120, 180, 360, 720].find(m => m * MIN * perMs >= gap);
  const days = minute ? null : [1, 2, 7, 14].find(d => d * DAY * perMs >= gap);
  const months = minute || days ? null : [1, 2, 3, 6, 12].find(m => m * 30.44 * DAY * perMs >= gap) ?? 12;
  let day = viennaDay(new Date(Math.floor(x0)).toISOString());
  if (months) {
    let [y, m] = day.split('-').map(Number);
    for (let k = 0; k < 400; k++) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`, at = midnight(first), index = y * 12 + m - 1;
      if (at > x1) break;
      if (at >= x0 && index % months === 0) ticks.push({ at, text: m === 1 ? String(y) : MON3[m - 1], date: true });
      if (++m > 12) { m = 1; y++; }
    }
  } else {
    for (let k = 0; k < 800; k++) {
      const start = midnight(day), next = nextDay(day), end = midnight(next);
      if (start > x1) break;
      if (minute) {
        for (let at = start; at < end && at <= x1; at += minute * MIN) if (at >= x0) ticks.push({ at, text: at === start ? dayDM(new Date(at).toISOString()) : timeHM(new Date(at).toISOString()), date: at === start });
      } else if (start >= x0) {
        const index = dayIndex(day), weekday = (index + 3) % 7; // 1970-01-01 was a Thursday: 0 is Monday
        const step = days === 14 ? weekday === 0 && Math.floor(index / 7) % 2 === 0 : days === 7 ? weekday === 0 : index % days === 0;
        if (step) ticks.push({ at: start, text: dayDM(new Date(start).toISOString()), date: true });
      }
      day = next;
    }
  }
  const labels = [];
  for (const tick of ticks) {
    const px = (tick.at - x0) * perMs;
    if (px > pw - 40 || (labels.length && px - (labels.at(-1).x - x0) * perMs < gap)) continue;
    labels.push({ x: tick.at, text: tick.text, anchor: 'start', date: tick.date });
  }
  // Within days the dashed lines mark each midnight; across weeks and months
  // a faint line stands behind each label.
  const lines = minute ? ticks.filter(tick => tick.date).map(tick => ({ x: tick.at, dashed: true })) : labels.map(l => ({ x: l.x }));
  return { labels, lines };
}

// ---------- Words for the store's state ----------
// One plain line about the stored history, or '' when there is nothing to
// say. Every line stays short enough for two lines on a phone.
export function storeNote(series) {
  if (series.loss) return `Recording restarted ${dayDM(series.loss.at)} after the store was damaged`;
  return ({ history_write_failed: 'The latest values could not be saved', store_version_unsupported: 'Stored in a newer format this version cannot read',
    contract_invalid: 'The stored history could not be read' })[series.reason] ?? '';
}
