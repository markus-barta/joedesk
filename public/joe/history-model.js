// History display model (pure, display only). Solid means observed; the grey
// dotted line holds or interpolates across missing spans, from an explicitly
// assumed € 5.000 per desk before the first observation. Estimates never enter
// comparisons, sparklines, totals or storage. The validated history arrives as
// typed columns (one row per point, NaN for a missing value) so a 10,000-point
// file never costs the page more than a few milliseconds.
import { nyDay, marketSession, zonedInstant, NY } from './time.mjs';

export const DESK_IDS = Object.freeze(['j', 'joe', 'joel']);
export const FIELDS = Object.freeze(['equity', 'dayPnl', 'openPnl', 'totalPnl']);
export const ASSUMED_BASELINE = 5000;
export const OBSERVATION_INTERVAL_MS = 5 * 60 * 1000;
const RANGE_MS = { '1d': 864e5, '1w': 7 * 864e5, '1m': 30 * 864e5 };
export const rangeSpanMs = range => RANGE_MS[range] ?? null;

const number = money => (money && typeof money.amount === 'string' ? Number(money.amount) : NaN);

// One pass over the validated points: times, every money field per desk and
// for the family, and each desk's bookkeeping basis as an index into a table.
export function toColumns(points) {
  const n = points.length, basisKeys = [], basisIndex = new Map();
  const t = new Float64Array(n);
  const col = () => Object.fromEntries(FIELDS.map(f => [f, new Float64Array(n)]));
  const desks = Object.fromEntries(DESK_IDS.map(id => [id, { ...col(), basis: new Int32Array(n), identified: new Uint8Array(n) }]));
  const totals = col();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    t[i] = Date.parse(p.t);
    for (const f of FIELDS) totals[f][i] = number(p.totals?.[f]);
    for (const id of DESK_IDS) {
      const d = p.desks?.[id], c = desks[id];
      for (const f of FIELDS) c[f][i] = number(d?.money?.[f]);
      const key = JSON.stringify([d?.historyBasis ?? null, d?.accounting?.periodStart ?? null, d?.accounting?.method ?? null]);
      if (!basisIndex.has(key)) { basisIndex.set(key, basisKeys.length); basisKeys.push(key); }
      c.basis[i] = basisIndex.get(key);
      c.identified[i] = d?.historyBasis || d?.accounting ? 1 : 0;
    }
  }
  return { n, t, desks, totals, basisKeys };
}

export const transferables = cols => [cols.t.buffer, ...Object.values(cols.totals).map(a => a.buffer),
  ...DESK_IDS.flatMap(id => [...FIELDS.map(f => cols.desks[id][f].buffer), cols.desks[id].basis.buffer, cols.desks[id].identified.buffer])];

const meaningful = (cols, id, i) => {
  const d = cols.desks[id];
  return d.identified[i] === 1 || !Number.isNaN(d.equity[i]) || !Number.isNaN(d.dayPnl[i]) || !Number.isNaN(d.totalPnl[i]);
};
export const compatibleBasis = (cols, id, a, b) => cols.desks[id].basis[a] === cols.desks[id].basis[b];

// Only the latest comparable bookkeeping basis is drawn for each desk; rows
// [from, to) are the window considered.
export function latestCompatibleBasis(cols, id, from = 0, to = cols.n) {
  let anchor = -1;
  for (let i = to - 1; i >= from; i--) if (meaningful(cols, id, i)) { anchor = i; break; }
  if (anchor < 0) return { start: from, excludedCount: 0, identified: false };
  let start = anchor;
  for (let i = anchor - 1; i >= from; i--) {
    if (!meaningful(cols, id, i)) continue;
    if (!compatibleBasis(cols, id, i, anchor)) break;
    start = i;
  }
  let excludedCount = 0;
  for (let i = from; i < start; i++) if (!Number.isNaN(cols.desks[id].equity[i])) excludedCount++;
  return { start, excludedCount, identified: cols.desks[id].identified[anchor] === 1 };
}

// First row at or after a time (binary search; times are strictly ordered).
export function rowAt(cols, at) {
  let lo = 0, hi = cols.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cols.t[mid] < at) lo = mid + 1; else hi = mid; }
  return lo;
}
function rangeRows(cols, range) {
  if (!cols.n || range === 'all') return [0, cols.n];
  const span = rangeSpanMs(range);
  return span ? [rowAt(cols, cols.t[cols.n - 1] - span), cols.n] : [0, cols.n];
}

const gapPoint = (x, y, assumption, extra = {}) => ({ x, y, estimated: true, assumption, ...extra });
function valueAt(samples, x) {
  if (x <= samples[0].x) return samples[0].y;
  if (x >= samples[samples.length - 1].x) return samples[samples.length - 1].y;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].x < x) continue;
    const a = samples[i - 1], b = samples[i];
    return b.x === a.x ? b.y : a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x));
  }
  return samples[samples.length - 1].y;
}
function clipGap(samples, startAt, endAt) {
  if (!samples.length || samples[samples.length - 1].x < startAt || samples[0].x > endAt) return [];
  const from = Math.max(startAt, samples[0].x), to = Math.min(endAt, samples[samples.length - 1].x);
  const out = [];
  if (from > samples[0].x) out.push(gapPoint(from, valueAt(samples, from), samples[0].assumption, { boundary: true }));
  for (const s of samples) if (s.x >= from && s.x <= to) out.push(s);
  if (to < samples[samples.length - 1].x && !out.some(s => s.x === to)) out.push(gapPoint(to, valueAt(samples, to), samples[0].assumption, { boundary: true }));
  return out;
}

// Observed samples (null y marks a gap) plus the dotted continuity groups for
// one desk, clipped to the visible range ending at the board's current time.
export function continuitySeries(cols, id, range, endAt) {
  const last = rowAt(cols, endAt + 1);
  const span = rangeSpanMs(range);
  const earliest = last ? cols.t[0] : null;
  const startAt = span ? endAt - span : earliest === null ? endAt - 864e5 : earliest;
  const { start } = latestCompatibleBasis(cols, id, 0, last);
  const eq = cols.desks[id].equity;
  const inside = rowAt(cols, startAt);
  const from = Math.max(start, inside - 1), seenRows = [];
  const observed = [];
  for (let i = inside < last ? from : last; i < last; i++) {
    const y = Number.isNaN(eq[i]) ? null : eq[i];
    if (i > from && cols.t[i] - cols.t[i - 1] > OBSERVATION_INTERVAL_MS) observed.push({ x: cols.t[i - 1] + (cols.t[i] - cols.t[i - 1]) / 2, y: null });
    observed.push({ x: cols.t[i], y });
  }
  // Continuity needs the observed rows across the whole retained basis, so a
  // range wholly inside an outage still holds the last value.
  for (let i = start; i < last; i++) if (!Number.isNaN(eq[i])) seenRows.push(i);
  const groups = [];
  if (!seenRows.length) {
    groups.push([gapPoint(startAt, ASSUMED_BASELINE, 'no-history-baseline'), gapPoint(endAt, ASSUMED_BASELINE, 'no-history-baseline')]);
  } else {
    const first = seenRows[0];
    const baselineAt = earliest === null ? startAt : Math.min(startAt, earliest);
    if (baselineAt < cols.t[first]) groups.push([gapPoint(baselineAt, ASSUMED_BASELINE, 'assumed-baseline'), gapPoint(cols.t[first], eq[first], 'assumed-baseline', { observedBoundary: true })]);
    for (let k = 0; k + 1 < seenRows.length; k++) {
      const left = seenRows[k], right = seenRows[k + 1];
      if (right === left + 1 && cols.t[right] - cols.t[left] <= OBSERVATION_INTERVAL_MS) continue;
      if (cols.t[right] < startAt - OBSERVATION_INTERVAL_MS) continue;
      const a = { x: cols.t[left], y: eq[left] }, b = { x: cols.t[right], y: eq[right] };
      const markers = [];
      for (let r = left; r < right; r++) {
        if (cols.t[r + 1] - cols.t[r] > OBSERVATION_INTERVAL_MS) markers.push(cols.t[r] + (cols.t[r + 1] - cols.t[r]) / 2);
        if (r > left && Number.isNaN(eq[r])) markers.push(cols.t[r]);
      }
      const group = [gapPoint(a.x, a.y, 'interpolated', { observedBoundary: true })];
      for (const x of markers.sort((m, n) => m - n)) if (!group.some(s => s.x === x)) group.push(gapPoint(x, a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x)), 'interpolated'));
      group.push(gapPoint(b.x, b.y, 'interpolated', { observedBoundary: true }));
      groups.push(group);
    }
    const lastSeen = seenRows[seenRows.length - 1];
    if (cols.t[lastSeen] < endAt) groups.push([gapPoint(cols.t[lastSeen], eq[lastSeen], 'last-value-carry', { observedBoundary: true }), gapPoint(endAt, eq[lastSeen], 'last-value-carry')]);
  }
  return { observed: observed.filter(p => p.x <= endAt), gaps: groups.map(g => clipGap(g, startAt, endAt)).filter(g => g.length > 1), startAt, endAt };
}

// Same-timestamp comparison of the selected desks on observed, compatible rows only.
export function sharedWindowCompare(cols, ids, range) {
  if (ids.length < 2 || !cols.n) return { ok: false, reason: 'insufficient-selection' };
  const [from, to] = rangeRows(cols, range);
  if (to - from < 2) return { ok: false, reason: 'insufficient-points' };
  let runStart = -1, runEnd = -1, lastBreak = 'incomplete-coverage';
  for (let i = from; i < to; i++) {
    if (!ids.every(id => !Number.isNaN(cols.desks[id].equity[i]))) { runStart = -1; lastBreak = 'incomplete-coverage'; continue; }
    if (runStart >= 0 && ids.some(id => !compatibleBasis(cols, id, runEnd, i))) { runStart = i; runEnd = i; lastBreak = 'incompatible-basis'; continue; }
    if (runStart < 0) runStart = i;
    runEnd = i;
  }
  if (runStart < 0 || runEnd <= runStart) return { ok: false, reason: lastBreak };
  return { ok: true, startAt: new Date(cols.t[runStart]).toISOString(), endAt: new Date(cols.t[runEnd]).toISOString(), desks: ids.map(id => {
    const start = cols.desks[id].equity[runStart], end = cols.desks[id].equity[runEnd];
    return { id, start, end, pct: start === 0 ? null : (end - start) / start * 100 };
  }) };
}

export function basisNotice(cols, ids, range) {
  const [from, to] = rangeRows(cols, range);
  return ids.filter(id => latestCompatibleBasis(cols, id, from, to).excludedCount > 0);
}

// The last observed value of each New York session, for the desk cards'
// result since start. Observed basis only; sessionless days are skipped.
// Runs once per accepted history, off the page's main thread.
export function sessionCloses(cols, id, field, limit) {
  const { start } = latestCompatibleBasis(cols, id);
  const values = cols.desks[id][field], out = [];
  let dayStart = Infinity;
  for (let i = cols.n - 1; i >= start && out.length < limit; i--) {
    if (Number.isNaN(values[i]) || cols.t[i] >= dayStart) continue;
    const at = new Date(cols.t[i]).toISOString();
    const d = nyDay(at);
    dayStart = Date.parse(zonedInstant(d, '00:00:00', NY));
    if (marketSession(at).reason) continue;
    out.push({ t: at, v: values[i], day: d });
  }
  return out.reverse();
}

// Today's family result through the session, observed rows only.
export function intraday(cols, field, fromAt, toAt) {
  const out = [], values = cols.totals[field];
  for (let i = rowAt(cols, Date.parse(fromAt)); i < cols.n && cols.t[i] <= Date.parse(toAt); i++) {
    if (!Number.isNaN(values[i])) out.push({ x: cols.t[i], v: values[i] });
  }
  return out;
}
