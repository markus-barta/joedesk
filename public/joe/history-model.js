// History display model (pure, display only). Solid means observed; the grey
// dashed line holds or interpolates across missing spans, from an explicitly
// assumed € 5.000 per desk before the first observation. Estimates never enter
// comparisons, sparklines, totals or storage. The validated history arrives as
// typed columns (one row per point, NaN for a missing value) so a 10,000-point
// file never costs the page more than a few milliseconds.
import { nyDay, marketSession, zonedInstant, NY, GAP_MS } from './time.mjs';
import { decimalUnits } from './contracts/decimal.mjs';
import { continuityClaims } from './history-continuity.js';

export const DESK_IDS = Object.freeze(['j', 'joe', 'joel']);
export const FIELDS = Object.freeze(['equity', 'dayPnl', 'openPnl', 'totalPnl']);
export const ASSUMED_BASELINE = 5000;
// Rows further apart than GAP_MS (time.mjs, shared with the server) are a gap
// in reporting; see "Rows the server thinned" below. A stretch of rows that
// arrived without numbers is hatched once it lasts longer than
// OBSERVATION_INTERVAL_MS.
export { GAP_MS };
export const OBSERVATION_INTERVAL_MS = 5 * 60 * 1000;
const RANGE_MS = { '1d': 864e5, '1w': 7 * 864e5, '1m': 30 * 864e5 };
export const rangeSpanMs = range => RANGE_MS[range] ?? null;

const number = money => (money && typeof money.amount === 'string' ? Number(money.amount) : NaN);

// A desk's bookkeeping basis identity (contract: an explicit historyBasis adds
// to, never replaces, its accounting period and method). History rows and the
// snapshot's desks are keyed the same way.
export const basisKey = d => JSON.stringify([d?.historyBasis ?? null, d?.accounting?.periodStart ?? null, d?.accounting?.method ?? null]);

// One pass over the validated points: times, every money field per desk and
// for the family, and each desk's bookkeeping basis as an index into a table.
// Each desk's equity also rides along exactly (BigInt units, null when not
// observed) for Results, which never takes money from a Number.
export function toColumns(points, continuity = null, historySeq = continuity?.historySeq) {
  const n = points.length, basisKeys = [], basisIndex = new Map();
  const t = new Float64Array(n), continuous = new Uint8Array(n);
  const claims = continuityClaims(continuity, historySeq);
  const col = () => Object.fromEntries(FIELDS.map(f => [f, new Float64Array(n)]));
  const desks = Object.fromEntries(DESK_IDS.map(id => [id, { ...col(), equityUnits: new Array(n).fill(null), basis: new Int32Array(n), identified: new Uint8Array(n) }]));
  const totals = col();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    t[i] = Date.parse(p.t);
    if (i && claims.has(`${points[i - 1].t}/${p.t}`)) continuous[i] = 1;
    for (const f of FIELDS) totals[f][i] = number(p.totals?.[f]);
    for (const id of DESK_IDS) {
      const d = p.desks?.[id], c = desks[id];
      for (const f of FIELDS) c[f][i] = number(d?.money?.[f]);
      if (typeof d?.money?.equity?.amount === 'string') c.equityUnits[i] = decimalUnits(d.money.equity.amount);
      const key = basisKey(d);
      if (!basisIndex.has(key)) { basisIndex.set(key, basisKeys.length); basisKeys.push(key); }
      c.basis[i] = basisIndex.get(key);
      c.identified[i] = d?.historyBasis || d?.accounting ? 1 : 0;
    }
  }
  return { n, t, continuous, desks, totals, basisKeys };
}

export const transferables = cols => [cols.t.buffer, cols.continuous.buffer, ...Object.values(cols.totals).map(a => a.buffer),
  ...DESK_IDS.flatMap(id => [...FIELDS.map(f => cols.desks[id][f].buffer), cols.desks[id].basis.buffer, cols.desks[id].identified.buffer])];

// A row that says something about a desk: an identified basis or a value.
// All-null rows without calculation metadata are unknown, not a new basis.
export const meaningful = (cols, id, i) => {
  const d = cols.desks[id];
  return d.identified[i] === 1 || !Number.isNaN(d.equity[i]) || !Number.isNaN(d.dayPnl[i]) || !Number.isNaN(d.totalPnl[i]);
};
export const compatibleBasis = (cols, id, a, b) => cols.desks[id].basis[a] === cols.desks[id].basis[b];

// Only the latest comparable bookkeeping basis is drawn for each desk; rows
// [from, to) are the window considered.
export function latestCompatibleBasis(cols, id, from = 0, to = cols.n) {
  let anchor = -1;
  for (let i = to - 1; i >= from; i--) if (meaningful(cols, id, i)) { anchor = i; break; }
  if (anchor < 0) return { start: from, identified: false };
  let start = anchor;
  for (let i = anchor - 1; i >= from; i--) {
    if (!meaningful(cols, id, i)) continue;
    if (!compatibleBasis(cols, id, i, anchor)) break;
    start = i;
  }
  return { start, identified: cols.desks[id].identified[anchor] === 1 };
}

// First row at or after a time (binary search; times are strictly ordered).
export function rowAt(cols, at) {
  let lo = 0, hi = cols.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cols.t[mid] < at) lo = mid + 1; else hi = mid; }
  return lo;
}
// The window a range shows, ending at the board's current time: Day, Week and
// Month are fixed spans; All starts at the first kept observation. The chart
// and the comparison both use exactly this window (or its zoom).
export function rangeWindow(cols, range, endAt) {
  const span = rangeSpanMs(range);
  if (span) return [endAt - span, endAt];
  return [rowAt(cols, endAt + 1) ? cols.t[0] : endAt - 864e5, endAt];
}
const windowRows = (cols, [from, to]) => [rowAt(cols, from), rowAt(cols, to + 1)];

// ---------- The shown window (History's overview strip and chart) ----------
// Windows are [from, to] in milliseconds inside the kept range [first kept
// observation, board's current time]. A preset is a span ending at the
// newest time (Fit all is the whole range); a manual view stays where it was
// put unless it follows the newest time. Zooming never goes below five
// minutes of data or beyond the range, and every result is clamped exactly,
// so a window resting on an edge never jitters.
export const VIEW_PRESETS = Object.freeze(['all', '1d', '1w', '1m']);
export const MIN_VIEW_MS = 5 * 60 * 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const keptRange = (cols, endAt) => rangeWindow(cols, 'all', endAt);
export const minSpan = ([k0, k1]) => Math.min(MIN_VIEW_MS, k1 - k0);

// A window `span` wide with `at` at fraction `frac` of it, inside the range.
export function placeWindow(range, span, at, frac = 0.5) {
  const [k0, k1] = range, full = k1 - k0;
  const w = clamp(span, minSpan(range), full);
  if (!(w < full)) return [k0, k1];
  const from = clamp(at - w * frac, k0, k1 - w);
  return from >= k1 - w ? [k1 - w, k1] : [from, from + w];
}
export const panWindow = (range, [a, b], by) => placeWindow(range, b - a, a + by, 0);
// Zoom by a factor (below 1 narrows), keeping `at` where it is on screen.
export function zoomWindow(range, [a, b], factor, at = (a + b) / 2) {
  const w = b - a;
  return placeWindow(range, w * factor, at, w ? clamp((at - a) / w, 0, 1) : 0.5);
}
// Move one edge; the other stays and the window keeps the minimum span.
export function resizeWindow(range, [a, b], edge, to) {
  const [k0, k1] = range, min = minSpan(range);
  return edge === 'from' ? [clamp(to, k0, b - min), b] : [a, clamp(to, a + min, k1)];
}
// The newest time is in view (within about two pixels of the window's end).
export const atLiveEdge = (range, [a, b]) => range[1] - b <= Math.max(1000, (b - a) * 0.002);
// A window a person moved follows the newest time only if it ends exactly
// there: every move is clamped exactly onto the range's end, so a pan of a
// single pixel into the past leaves Follow, and small pans add up.
export const endsAtNewest = (range, [, b]) => b >= range[1];
export const followWindow = (range, [a, b]) => placeWindow(range, b - a, range[1], 1);
export const presetSpan = (range, preset) => Math.min(rangeSpanMs(preset) ?? Infinity, range[1] - range[0]);
export const presetWindow = (range, preset) => placeWindow(range, presetSpan(range, preset), range[1], 1);
// The preset a window's width matches: the chosen one if it does (a Month
// longer than the kept history shows all of it), otherwise the first.
export function windowPreset(range, [a, b], chosen = null) {
  const near = span => Math.abs(span - (b - a)) <= Math.max(1000, span * 0.002);
  const matches = VIEW_PRESETS.filter(p => near(presetSpan(range, p)));
  return matches.includes(chosen) ? chosen : matches[0] ?? null;
}
// A window moved inside the range with its width kept (unless wider).
export function keepInside([k0, k1], [a, b]) {
  const w = Math.min(Math.max(0, b - a), k1 - k0), from = clamp(a, k0, k1 - w);
  return from >= k1 - w ? [k1 - w, k1] : [from, from + w];
}
// The window shown: a preset ending at the newest time, or a manual view kept
// inside the range that follows the newest time while Follow is on. Every
// resolve holds the current floor: a view chosen while less than five
// minutes were kept, or one of no width at all, widens to five minutes
// around its middle once the range allows it.
export function resolveView(range, { preset = 'all', view = null, follow = true } = {}) {
  if (!view) return presetWindow(range, preset);
  const [a, b] = view, span = b - a, min = minSpan(range);
  if (follow) return placeWindow(range, span, range[1], 1);
  return span >= min ? keepInside(range, view) : placeWindow(range, min, (a + b) / 2, 0.5);
}
// ---------- What History shows, and its address ----------
// Change draws each desk as its distance in euros from its own value at the
// window's left edge, so every line starts at 0; Money draws the money as
// observed. The address #history?range=fit|day|week|month&desk=all|none|
// j,joe,joel&mode=change|money names the chosen preset, desks and measure;
// a part that is missing or unreadable keeps the current choice.
export const HISTORY_MEASURES = Object.freeze(['change', 'money']);
const RANGE_NAMES = Object.freeze({ all: 'fit', '1d': 'day', '1w': 'week', '1m': 'month' });
export function parseHistoryRoute(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(String(params ?? '').replace(/^\?/, ''));
  const out = {}, range = p.get('range'), desk = p.get('desk'), measure = p.get('mode');
  const preset = Object.keys(RANGE_NAMES).find(key => RANGE_NAMES[key] === range);
  if (preset) out.preset = preset;
  if (desk === 'all') out.desks = DESK_IDS.slice();
  else if (desk === 'none') out.desks = [];
  else if (desk) {
    const ids = desk.split(',');
    if (ids.every(id => DESK_IDS.includes(id))) out.desks = DESK_IDS.filter(id => ids.includes(id));
  }
  if (HISTORY_MEASURES.includes(measure)) out.measure = measure;
  return out;
}
export function historyRouteQuery({ preset = '1w', desks = DESK_IDS, measure = 'change' } = {}) {
  const desk = desks.length === DESK_IDS.length ? 'all' : desks.length ? DESK_IDS.filter(id => desks.includes(id)).join(',') : 'none';
  return `range=${RANGE_NAMES[preset] ?? 'week'}&desk=${desk}&mode=${HISTORY_MEASURES.includes(measure) ? measure : 'change'}`;
}
// Max in Change mode: over one desk's drawn values in time order (observed
// values and the corners of its estimates; the lines between are straight),
// the largest fall and rise from any value to a later one. Whatever window
// the reader chooses, its Change values lie in between.
export function changeExtremes(values) {
  let lo = 0, hi = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (min <= max) { hi = Math.max(hi, v - min); lo = Math.min(lo, v - max); }
    min = Math.min(min, v); max = Math.max(max, v);
  }
  return [lo, hi];
}

export const easeOut = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const lerpWindow = ([a0, b0], [a1, b1], t) => (t >= 1 ? [a1, b1] : [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t]);
// The overview strip maps the whole range onto its width, and back.
export const toStrip = ([k0, k1], width, x) => (k1 > k0 ? clamp((x - k0) / (k1 - k0), 0, 1) * width : 0);
export const fromStrip = ([k0, k1], width, px) => k0 + (width > 0 ? clamp(px / width, 0, 1) : 0) * (k1 - k0);

// Where no chosen desk has a number for longer than the observation interval:
// the intersection of every desk's estimated stretches. gapsByDesk holds each
// desk's ordered gap groups; one band per remaining stretch, in time order.
// A gap in reporting lasts more than GAP_MS, so it is always hatched.
export function missingBands(gapsByDesk, minMs = OBSERVATION_INTERVAL_MS) {
  if (!gapsByDesk.length) return [];
  let bands = gapsByDesk[0].map(g => [g[0].x, g[g.length - 1].x]);
  for (const gaps of gapsByDesk.slice(1)) {
    const other = gaps.map(g => [g[0].x, g[g.length - 1].x]), next = [];
    for (let i = 0, j = 0; i < bands.length && j < other.length;) {
      const from = Math.max(bands[i][0], other[j][0]), to = Math.min(bands[i][1], other[j][1]);
      if (to > from) next.push([from, to]);
      if (bands[i][1] < other[j][1]) i++; else j++;
    }
    bands = next;
  }
  return bands.filter(([from, to]) => to - from > minMs);
}

// The rows the chart keeps for one desk, [start, last): every row up to the
// board's current time on the desk's latest comparable bookkeeping basis. The
// chart, the comparison and the basis notice all read exactly these rows, so
// a zoom never compares an observation the chart left out.
export function chartRows(cols, id, endAt) {
  const last = rowAt(cols, endAt + 1);
  return { start: latestCompatibleBasis(cols, id, 0, last).start, last };
}

// ---------- Rows the server thinned ----------
// Only an exact sidecar claim can prove a long interval continuous. Missing,
// damaged, future or sequence-mismatched provenance contributes no claims.
// Legacy compacted intervals remain coverage unknown, never inferred from
// adjacent cadence or the mere presence of compactedThrough.
export const observedInterval = (cols, i) => i > 0 && i < cols.n &&
  (cols.t[i] - cols.t[i - 1] <= GAP_MS || cols.continuous?.[i] === 1);
// Inside a stretch without rows, ending at or before compactedThrough.
export function coverageUnknownAt(cols, x, thinnedThrough) {
  if (!Number.isFinite(thinnedThrough)) return false;
  const i = rowAt(cols, x);
  return i > 0 && i < cols.n && cols.t[i] > x && cols.t[i] <= thinnedThrough && !observedInterval(cols, i);
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

// Observed samples (null y marks a gap) plus the dashed continuity groups for
// one desk, clipped to the visible range ending at the board's current time.
// Explicit missing values and unproven intervals above GAP_MS are estimates;
// the sidecar proves which long intervals came from continuous reporting.
export function continuitySeries(cols, id, range, endAt) {
  const { start, last } = chartRows(cols, id, endAt);
  const earliest = last ? cols.t[0] : null;
  const [startAt] = rangeWindow(cols, range, endAt);
  const eq = cols.desks[id].equity;
  const inside = rowAt(cols, startAt);
  const from = Math.max(start, inside - 1), seenRows = [];
  const observed = [];
  for (let i = inside < last ? from : last; i < last; i++) {
    const y = Number.isNaN(eq[i]) ? null : eq[i];
    if (i > from && !observedInterval(cols, i)) observed.push({ x: cols.t[i - 1] + (cols.t[i] - cols.t[i - 1]) / 2, y: null });
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
      if (right === left + 1 && observedInterval(cols, right)) continue;
      if (cols.t[right] < startAt - OBSERVATION_INTERVAL_MS) continue;
      const a = { x: cols.t[left], y: eq[left] }, b = { x: cols.t[right], y: eq[right] };
      const markers = [];
      for (let r = left; r < right; r++) {
        if (!observedInterval(cols, r + 1)) markers.push(cols.t[r] + (cols.t[r + 1] - cols.t[r]) / 2);
        if (r > left && Number.isNaN(eq[r])) markers.push(cols.t[r]);
      }
      const group = [gapPoint(a.x, a.y, 'interpolated', { observedBoundary: true })];
      for (const x of markers.sort((m, n) => m - n)) if (group[group.length - 1].x !== x) group.push(gapPoint(x, a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x)), 'interpolated'));
      group.push(gapPoint(b.x, b.y, 'interpolated', { observedBoundary: true }));
      groups.push(group);
    }
    const lastSeen = seenRows[seenRows.length - 1];
    if (cols.t[lastSeen] < endAt) groups.push([gapPoint(cols.t[lastSeen], eq[lastSeen], 'last-value-carry', { observedBoundary: true }), gapPoint(endAt, eq[lastSeen], 'last-value-carry')]);
  }
  return { observed: observed.filter(p => p.x <= endAt), gaps: groups.map(g => clipGap(g, startAt, endAt)).filter(g => g.length > 1), startAt, endAt };
}

// Same-timestamp comparison of the selected desks on the rows the chart draws
// (observed, latest comparable basis), inside its window [from, to] in
// milliseconds; endAt is the board's current time, as for the chart. It runs
// over the last stretch in which every chosen desk has a number on its
// current basis and every interval is observed (the chart's own rule: at
// most GAP_MS between rows or an exact continuity claim), so a stretch it
// compares is continuous data;
// `after` names what ended the stretch before it inside the window (null
// when the stretch starts with the window's first row): 'gap' for a stretch
// without rows, 'incomplete-coverage' for missing numbers.
export function sharedWindowCompare(cols, ids, bounds, endAt) {
  if (ids.length < 2) return { ok: false, reason: 'insufficient-selection' };
  if (!cols.n) return { ok: false, reason: 'insufficient-points' };
  const [from, to] = windowRows(cols, bounds);
  if (to - from < 2) return { ok: false, reason: 'insufficient-points' };
  const kept = ids.map(id => chartRows(cols, id, endAt));
  let runStart = -1, runEnd = -1, lastBreak = 'incomplete-coverage';
  for (let i = from; i < to; i++) {
    if (!ids.every(id => !Number.isNaN(cols.desks[id].equity[i]))) { runStart = -1; lastBreak = 'incomplete-coverage'; continue; }
    if (kept.some(k => i < k.start || i >= k.last)) { runStart = -1; lastBreak = 'incompatible-basis'; continue; }
    if (runStart >= 0 && !observedInterval(cols, i)) { runStart = -1; lastBreak = 'gap'; }
    if (runStart < 0) runStart = i;
    runEnd = i;
  }
  if (runStart < 0 || runEnd <= runStart) return { ok: false, reason: lastBreak };
  // Both ends also exactly (BigInt units), for figures in euros.
  return { ok: true, startAt: new Date(cols.t[runStart]).toISOString(), endAt: new Date(cols.t[runEnd]).toISOString(), after: runStart > from ? lastBreak : null, desks: ids.map(id => {
    const start = cols.desks[id].equity[runStart], end = cols.desks[id].equity[runEnd], units = cols.desks[id].equityUnits;
    return { id, start, end, startUnits: units?.[runStart] ?? null, endUnits: units?.[runEnd] ?? null, pct: start === 0 ? null : (end - start) / start * 100 };
  }) };
}

// The desks with observations inside the window that the chart leaves out
// because they sit on an older bookkeeping basis.
export function basisNotice(cols, ids, bounds, endAt) {
  const [from, to] = windowRows(cols, bounds);
  return ids.filter(id => {
    const { start } = chartRows(cols, id, endAt), eq = cols.desks[id].equity;
    for (let i = from; i < Math.min(to, start); i++) if (!Number.isNaN(eq[i])) return true;
    return false;
  });
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
