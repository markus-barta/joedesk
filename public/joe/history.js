// History: each desk's change since the start of the shown window (or its
// money as observed), dashed where a desk's numbers are estimated and
// hatched where no numbers arrived, an overview strip of all kept history
// with the shown window, its Controls, J's bookkeeping with its captured
// results, and the desk changes this browser saw.
import { $, $$, icon, term, st, pl, inlineMark, swatch, ageSpan, patch, statePhrase, stateCaption } from './ui.js';
import { esc, amountOf, eur, age, dayDDM, dayDM, timeHM, money, digits, MINUS, NB } from './format.js';
import { decimalUnits } from './contracts/decimal.mjs';
import { cellReason } from './health.js';
import { exactCell } from './performance.js';
import { drawChart, eurAxis, changeAxis, axis, overviewTargets, createWheelLatch, wheelPixels, wheelZoomFactor, createAxisMode, chartHintSeen, dismissChartHint } from './chart.js';
import { DESK_IDS, ASSUMED_BASELINE, OBSERVATION_INTERVAL_MS, continuitySeries, coverageUnknownAt, sharedWindowCompare, basisNotice, toColumns, rowAt, rangeSpanMs,
  keptRange, placeWindow, panWindow, zoomWindow, resizeWindow, atLiveEdge, endsAtNewest, followWindow, presetSpan, windowPreset, resolveView,
  missingBands, easeOut, lerpWindow, toStrip, fromStrip, parseHistoryRoute, historyRouteQuery, changeExtremes } from './history-model.js';
import { viennaDay, zonedInstant, VIENNA, NY } from './time.mjs';

const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const EMPTY = toColumns([]);
// The chosen desks, the last chosen preset, a manual window (null while a
// preset shows), whether the window follows the newest time and what the
// lines measure ('change' since the window's start, or 'money'). full and
// shown are the kept range and the window drawn last, for the input below.
export const HS = { desks: DESK_IDS.slice(), preset: '1w', view: null, follow: true, measure: 'change', full: null, shown: null };
const RANGE_WORD = { '1d': 'last day', '1w': 'last week', '1m': 'last month', all: 'all kept history' };
const DAY = 864e5, HOUR = 3600e3;
const SUBTITLE = {
  change: 'Each desk’s change in € since the start of the view · paper · EUR · kept holdings left out',
  money: 'Each desk’s money as observed · paper · EUR · kept holdings left out',
};

// The vertical axis, one choice per measure (their euros differ), each
// remembered in this browser (chart.js: createAxisMode).
const AXES = { change: createAxisMode('history.change'), money: createAxisMode('history.money') };
export const historyAxis = (measure = HS.measure) => AXES[measure] ?? AXES.change;

// The address of what History shows (history-model.js: the route format).
export const historyQuery = () => historyRouteQuery(HS);
// A route's parameters (URLSearchParams or a query string), before History
// renders; a missing or unreadable one keeps the current choice. A preset
// shows from the newest time, as its button does.
export function readHistoryRoute(params) {
  const route = parseHistoryRoute(params);
  if (route.preset) { HS.preset = route.preset; HS.view = null; HS.follow = true; }
  if (route.desks) HS.desks = route.desks;
  if (route.measure) HS.measure = route.measure;
  return route;
}

function toolsHtml() {
  return {
    desks: `${DESK_IDS.map(id => `<button type="button" data-hdesk="${id}" aria-pressed="${HS.desks.includes(id)}">${inlineMark(id)}${LABEL[id]}</button>`).join('')}<button type="button" data-hdesk="all" aria-pressed="${HS.desks.length === 3}" aria-label="All desks"><span class="t-long">All desks</span><span class="t-short">All</span></button>`,
  };
}

// History's own state, with its age and reason. It sits inside the chart's
// fixed box and the plot starts below it, so a change of state moves nothing.
function statusLine(cell) {
  const p = statePhrase(cell, 'hist', 'last good history');
  if (p.state === 'fresh') return '';
  const why = cell?.reason ? esc(cellReason(cell.reason)) : null;
  const ago = () => ageSpan('hist', cell.ageSeconds == null ? 'an unknown time' : `${age(cell.ageSeconds)} ago`);
  const text = p.state === 'not reported' ? `History has not arrived yet${why && cell.reason !== 'feed_not_received' ? `: ${why}` : ''}.`
    : cell.value == null ? `History refresh failed: ${why ?? 'not available'}. Nothing to show yet.`
      : cell.retained ? `${p.state === 'broken' ? 'History refresh failed' : 'History update not used'}: ${why ?? 'not available'}. Showing the last good history from ${ago()}.`
        : p.state === 'stale' ? `History as of ${ago()}${why ? ` · ${why}` : ''}.` : `History: ${why ?? 'not available'} · as of ${ago()}.`;
  const retry = p.state === 'broken' || p.state === 'not reported' ? '<button type="button" class="btn quiet" id="histRetry">Retry</button>' : '';
  return `<div class="hist-state" data-state="${p.state}">${st(p.tone, text)}${retry}</div>`;
}

// The window the comparison uses: the one the chart settles on (a glide
// between two windows draws the frames in between, never compares them).
export function historyWindow(cols, endAt) {
  return resolveView(keptRange(cols, endAt), HS);
}
const thinnedOf = cell => { const at = Date.parse(cell?.value?.compactedThrough ?? ''); return Number.isFinite(at) ? at : null; };

// The comparison follows the measure: in Change, each desk's change in
// euros over the stretch it compares ("Change from … to …: J −€ 1,20 · …");
// in Money, its money at both ends ("J € 4.976,58", an arrow, "€ 5.000,00"), exact
// from the stored decimals. { text, html }: the words, and the markup with
// an arrow icon between the two ends (the words say "to").
const plainLine = text => ({ text, html: esc(text) });
function compareLine(cols, bounds, endAt, measure = HS.measure) {
  if (HS.desks.length < 2) return plainLine('Choose two or more desks to compare them over the same window.');
  const result = sharedWindowCompare(cols, HS.desks, bounds, endAt);
  if (!result.ok) {
    return plainLine(result.reason === 'incomplete-coverage' ? 'Comparing needs the same moments for every chosen desk in this window.'
      : result.reason === 'gap' ? 'Comparing needs two moments with continuous data in this window.'
        : result.reason === 'incompatible-basis' ? 'Comparing needs two moments on every chosen desk’s current bookkeeping basis.'
          : result.reason === 'insufficient-points' ? 'Not enough history in this window to compare.' : 'Choose two or more desks to compare them over the same window.');
  }
  return compareWords(result, measure);
}
function compareWords(result, measure) {
  const when = iso => `${dayDDM(iso)}, ${timeHM(iso)}`, change = measure === 'change';
  const figures = result.desks.map(d => {
    const exact = typeof d.startUnits === 'bigint' && typeof d.endUnits === 'bigint';
    const start = exact ? d.startUnits : d.start, end = exact ? d.endUnits : d.end, name = LABEL[d.id];
    if (change) return plainLine(`${name} ${eur(end - start, true)}`);
    return { text: `${name} ${eur(start)} to ${eur(end)}`, html: `${esc(name)} ${esc(eur(start))}${icon('arrow', 'i cmp-to')}<span class="vh"> to </span>${esc(eur(end))}` };
  });
  // A comparison that cannot use the whole window names the stretch it uses:
  // continuous data (every interval observed, every number there) after a gap
  // or a missing number, or the current bookkeeping after a basis change.
  let lead;
  if (result.after) {
    const run = age((Date.parse(result.endAt) - Date.parse(result.startAt)) / 1000);
    const stretch = `${run} ${result.after === 'incompatible-basis' ? 'on the current bookkeeping' : 'with continuous data'}, from ${when(result.startAt)}`;
    lead = change ? `Change in the last ${stretch}` : `Last ${stretch}`;
  } else lead = `${change ? 'Change from' : 'From'} ${when(result.startAt)} to ${when(result.endAt)}`;
  return { text: `${lead}: ${figures.map(f => f.text).join(' · ')}`, html: `${esc(lead)}: ${figures.map(f => f.html).join(' · ')}` };
}
// The longest line each measure can write (three desks, the longest stretch
// wording and wide amounts), laid out invisibly under the real one: the line
// keeps one height per measure while presets, desks and the window change.
const SIZING_AT = Date.parse('2026-10-28T22:59:00.000Z');
const sizing = {};
function compareSizing(measure) {
  return (sizing[measure] ??= compareWords({ after: 'incompatible-basis', startAt: new Date(SIZING_AT - 86340e3).toISOString(), endAt: new Date(SIZING_AT).toISOString(),
    desks: DESK_IDS.map(id => (measure === 'change' ? { id, start: 0, end: -8888.88 } : { id, start: 88888.88, end: 88888.88 })) }, measure).html);
}

// Display-only thinning: per pixel bucket keep the first, lowest, highest and
// last observation, and every gap marker, so extrema and breaks survive.
export function downsample(pts, x0, x1, buckets) {
  if (pts.length <= buckets * 4) return pts;
  const out = [], width = (x1 - x0) / buckets;
  let bucket = null, group = [];
  const flush = () => {
    if (!group.length) return;
    const lo = group.reduce((a, b) => (b.v < a.v ? b : a)), hi = group.reduce((a, b) => (b.v > a.v ? b : a));
    for (const p of [...new Set([group[0], lo, hi, group[group.length - 1]])].sort((a, b) => a.x - b.x)) out.push(p);
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

// Vienna wall-clock instants, cached: every frame asks for the same few days.
const instants = new Map();
function viennaAt(day, hour = 0) {
  const key = `${day}T${hour}`;
  let at = instants.get(key);
  if (at === undefined) {
    if (instants.size > 2000) instants.clear();
    at = Date.parse(zonedInstant(day, `${String(hour).padStart(2, '0')}:00:00`, VIENNA));
    instants.set(key, at);
  }
  return at;
}
const nextDay = day => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
// Wall-clock ticks in Vienna every stepMin minutes inside [from, to], in
// order; a tick at midnight is a date. Days of a clock change are 23 or 25
// hours long: steps within the hour count real time from midnight, so every
// instant of such a day has its tick (03:00 follows 01:45 in spring, 02:00
// comes twice in autumn); hour steps are placed by the clock, and an hour the
// change skips is the next one. No instant is ever listed twice.
export function wallTicks(from, to, stepMin) {
  const out = [], seen = new Set();
  const add = (at, midnight, day) => { if (at >= from && at <= to && !seen.has(at)) { seen.add(at); out.push({ at, midnight, day }); } };
  let day = viennaDay(new Date(Math.floor(from)).toISOString());
  for (let i = 0; i < 40; i++) {
    const start = viennaAt(day), next = nextDay(day), end = viennaAt(next);
    if (start > to) break;
    if (end >= from && stepMin < 60) {
      const step = stepMin * 60e3;
      for (let at = start + Math.max(0, Math.ceil((from - start) / step)) * step; at < end && at <= to; at += step) add(at, at === start, day);
    } else if (end >= from) {
      const regular = end - start === DAY;
      for (let hour = 0; hour < 24; hour += stepMin / 60) add(regular ? start + hour * HOUR : viennaAt(day, hour), hour === 0, day);
    }
    day = next;
  }
  return out.sort((a, b) => a.at - b.at);
}
const midnightLines = (from, to) => wallTicks(from, to, 1440).map(t => t.at);
const dayWord = at => dayDDM(new Date(at).toISOString()).split(NB)[0];
// Axis labels at least `gap` pixels apart at every width: clock times for a
// day or two, dates beyond; a label at midnight is always the date, and a
// window that starts during a day names that day at its left edge ("Wed 28"
// before the midnight line marked "Thu 29"). Steps are planned from the
// average pixels per minute; a last pass drops any label a short day (the
// spring clock change) or the left-edge date brings closer than `gap`.
function axisLabels(x0, x1, pw, gap = 56) {
  const span = x1 - x0, perMin = pw / (span / 60e3) || 0;
  const stepMin = [5, 10, 15, 30, 60, 120, 180, 360, 720].find(s => s * perMin >= gap);
  const labels = [];
  if (stepMin) {
    const ticks = wallTicks(x0, x1, stepMin), lead = ticks[0]?.at === x0 && ticks[0].midnight ? null : x0;
    if (lead !== null) labels.push({ x: lead, text: dayWord(lead), anchor: 'start' });
    for (const t of ticks) {
      if (lead !== null && (t.at - lead) * perMin / 60e3 < gap) continue;
      labels.push({ x: t.at, text: t.midnight ? dayWord(t.at) : timeHM(new Date(t.at).toISOString()), anchor: 'start' });
    }
  } else {
    const every = [1, 2, 4, 7, 14].find(n => n * 1440 * perMin >= gap) ?? 14;
    wallTicks(x0, x1, 1440).forEach((t, i) => { if (i % every === 0) labels.push({ x: t.at, text: dayWord(t.at), anchor: 'start' }); });
  }
  const px = l => (l.x - x0) / span * pw, kept = [];
  for (const l of labels) if (!kept.length || px(l) - px(kept[kept.length - 1]) >= gap) kept.push(l);
  // A label never runs past the plot's right edge.
  return kept.filter(l => px(l) < pw - 40);
}

// First point at or after x; both observations and gap samples are ordered.
function pointAt(points, x) {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].x < x) lo = mid + 1; else hi = mid; }
  return lo;
}
// Index bounds in sorted times: the first at or after x, the first after x.
function firstAt(xs, x, after = false) {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (xs[mid] < x || (after && xs[mid] === x)) lo = mid + 1; else hi = mid; }
  return lo;
}

// Display-only hits use original observations, never the thinned SVG points.
// An actual observation wins at its timestamp; inside a gap show its estimate.
// Between observations joined by proven continuous reporting, the nearest
// actual observation answers.
function historyHit(observed, gaps, x) {
  const i = pointAt(observed, x), a = observed[i - 1], b = observed[i];
  const p = !a ? b : !b || x - a.x <= b.x - x ? a : b;
  if (p?.x === x) return { x: p.x, v: p.y };
  const gap = gaps.find(g => g[0].x <= x && g[g.length - 1].x >= x);
  if (gap) {
    const k = pointAt(gap, x), right = gap[k], left = gap[Math.max(0, k - 1)];
    const v = right.x === left.x ? right.y : left.y + (right.y - left.y) * ((x - left.x) / (right.x - left.x));
    return { x, v, estimated: true };
  }
  return p && ((a && b) || Math.abs(p.x - x) <= OBSERVATION_INTERVAL_MS) ? { x: p.x, v: p.y } : null;
}

// One wording for the visible tooltip and the polite keyboard announcement.
// Inside a stretch without rows that an older version may have thinned
// (coverageUnknownAt), a last line says its coverage is unknown. In Change
// (since: the window's start, in ms) each value is that desk's signed change
// since then, and a second line says since when; a desk whose value at that
// start is itself an estimate (estimatedStart[i]) says so.
export function historyPointDetails(near, x, desks, unknown = false, since = null, estimatedStart = []) {
  const at = new Date(Math.round(x)).toISOString(), change = Number.isFinite(since);
  const lines = [`${dayDDM(at)}, ${timeHM(at)} Vienna time`, ...(change ? [`Change since ${when(since)}`] : []), ...desks.map((id, i) => {
    const p = near[i];
    return `${LABEL[id]} ${p ? `${eur(p.v, change)} ${p.estimated ? 'estimated' : 'observed'}${change && estimatedStart[i] ? ', from an estimated start' : ''}` : 'no value here'}`;
  }), ...(unknown ? ['Thinned or not reported: coverage unknown'] : [])];
  return { text: lines.join('\n'), html: `<b>${esc(lines[0])}</b>${lines.slice(1).map(line => `<br>${esc(line)}`).join('')}` };
}

// ---------- The drawn model ----------
// Rebuilt only when the history, the desk choice or the rows up to the
// board's time change. Between updates only each desk's trailing estimate
// (its held last value, or the assumed start of a desk never observed)
// reaches the board's current time, so a frame of panning or zooming never
// walks the whole history.
let model = null;
function deskModel(cols, id, endAt) {
  const s = continuitySeries(cols, id, 'all', endAt);
  const end = s.gaps.at(-1);
  const tail = end && end.at(-1).x === endAt && ['last-value-carry', 'no-history-baseline'].includes(end[0].assumption) ? end : null;
  const hits = s.observed.filter(p => p.y !== null);
  return { id, lines: s.observed.map(p => ({ x: p.x, v: p.y })), hits, body: tail ? s.gaps.slice(0, -1) : s.gaps, tail };
}
function historyModel(cols, endAt) {
  const last = rowAt(cols, endAt + 1), desks = HS.desks.join();
  if (!model || !last || model.cols !== cols || model.desks !== desks || model.last !== last) {
    const models = HS.desks.map(id => deskModel(cols, id, endAt));
    // Every original moment keyboard inspection can stop at, in order.
    const xs = [...new Set(models.flatMap(m => [...m.lines.map(p => p.x), ...m.body.flatMap(g => g.map(p => p.x)), ...(m.tail ? [m.tail[0].x] : [])]))].sort((a, b) => a - b);
    model = { cols, desks, last, models, xs, overview: null };
  }
  return model;
}
function gapsAt(m, endAt) {
  const lastSeen = m.hits.at(-1);
  const from = m.tail?.[0] ?? (lastSeen ? { x: lastSeen.x, y: lastSeen.y, estimated: true, assumption: 'last-value-carry', observedBoundary: true } : null);
  if (!from || endAt <= from.x) return m.body;
  return [...m.body, [from, { x: endAt, y: from.y, estimated: true, assumption: from.assumption }]];
}
// A line's value at x, between its neighbours (null across a break).
function lineAt(pts, x) {
  const k = pointAt(pts, x), a = pts[k - 1], b = pts[k];
  if (b?.x === x) return b.v;
  if (!a || !b || a.v === null || b.v === null) return null;
  return a.v + (b.v - a.v) * ((x - a.x) / (b.x - a.x));
}
const segmentAt = (g, x) => g[0].y + (g[g.length - 1].y - g[0].y) * ((x - g[0].x) / ((g[g.length - 1].x - g[0].x) || 1));

// ---------- Motion ----------
// Preset jumps, Fit all and centring ease over about 200 ms; with reduced
// motion they land at once. The target is resolved every frame, so a glide
// that follows the newest time still ends exactly on it.
const motion = { from: null, start: 0 };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function glide() {
  if (HS.shown && input.schedule && !reducedMotion()) { motion.from = HS.shown.slice(); motion.start = performance.now(); }
}
function frameWindow(target) {
  if (!motion.from) return target;
  const t = (performance.now() - motion.start) / 200;
  if (t >= 1) { motion.from = null; return target; }
  input.schedule('history-anim');
  return lerpWindow(motion.from, target, easeOut(t));
}

// ---------- The chart ----------
const when = ms => { const at = new Date(Math.round(ms)).toISOString(); return `${dayDDM(at)}, ${timeHM(at)}`; };
function spanText(ms) {
  if (ms >= 2 * DAY) return `${digits(ms / DAY, ms >= 10 * DAY || Math.abs(ms / DAY - Math.round(ms / DAY)) < 0.05 ? 0 : 1)}${NB}days`;
  if (ms >= 2 * HOUR) return `${Math.round(ms / HOUR)}${NB}h`;
  return `${Math.max(1, Math.round(ms / 60e3))}${NB}min`;
}
function chartLabel(range, shown, yAxis = { mode: 'auto' }) {
  const what = HS.measure === 'change' ? 'Each desk’s change since the start of the window' : 'Each desk’s money';
  const axisWords = yAxis.mode === 'max' ? '; vertical axis fixed to all kept history'
    : yAxis.mode === 'custom' ? `; custom vertical axis from ${eur(yAxis.min, HS.measure === 'change')} to ${eur(yAxis.max, HS.measure === 'change')}` : '';
  const pressed = windowPreset(range, shown, HS.preset);
  if (pressed === 'all' || (pressed && presetSpan(range, pressed) < rangeSpanMs(pressed))) return `${what}, ${RANGE_WORD.all}${axisWords}`;
  if (pressed && HS.follow && atLiveEdge(range, shown)) return `${what}, ${RANGE_WORD[pressed]}${axisWords}`;
  return `${what}, zoomed: ${when(shown[0])} to ${when(shown[1])} Vienna time${axisWords}`;
}
// Change: a desk's value at the window's left edge, where its line starts
// at 0. That is the drawn line there: the observed line where it is solid,
// otherwise the estimate that crosses the edge (and then the start is an
// estimate, which the tooltip says).
function edgeValue(d, gaps, x) {
  const v = lineAt(d.lines, x);
  if (v !== null) return { v, estimated: false };
  const g = gaps.find(s => s[0].x <= x && s[s.length - 1].x >= x);
  if (g) return { v: segmentAt(g, x), estimated: true };
  const next = d.lines.find(p => p.v !== null && p.x >= x);
  return next ? { v: next.v, estimated: false } : { v: ASSUMED_BASELINE, estimated: true };
}
// Max: every drawn value of the chosen desks over all kept history (the
// observed lines and the corners of their estimates), as Money's lowest and
// highest value, Change's largest fall and rise (changeExtremes) and the
// money the scale's ±0,5 % floor is taken of. Kept until the model changes.
function historyExtremes(m, gaps) {
  if (m.extremes) return m.extremes;
  let lo = Infinity, hi = -Infinity, fall = 0, rise = 0;
  const firsts = [];
  m.models.forEach((d, i) => {
    const pts = d.lines.filter(p => p.v !== null).map(p => [p.x, p.v]);
    for (const g of gaps[i]) pts.push([g[0].x, g[0].y], [g[g.length - 1].x, g[g.length - 1].y]);
    pts.sort((p, q) => p[0] - q[0]);
    const values = pts.map(p => p[1]);
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const [down, up] = changeExtremes(values);
    fall = Math.min(fall, down); rise = Math.max(rise, up);
    firsts.push(values[0] ?? ASSUMED_BASELINE);
  });
  m.extremes = { money: lo <= hi ? [lo, hi] : null, change: [fall, rise], base: firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : ASSUMED_BASELINE };
  return m.extremes;
}
let lastScale = null;
export function historyChart(ctx) {
  const el = $('#histChart');
  const top = Math.ceil($('#histStatus')?.offsetHeight ?? 0);
  const inspection = { description: 'histStatus histInspectHelp', live: $('#histLive'), points: [] };
  if (!ctx.now) {
    HS.full = null; HS.shown = null; overviewOff();
    return (lastScale = drawChart(el, { series: [], xDomain: [0, 1], empty: true, inspect: inspection, pad: { t: 12 + top }, emptyText: 'Waiting for the board server’s clock', label: 'Each desk’s money: the board server’s time is not known yet' }));
  }
  const cell = ctx.states.history;
  const cols = cell?.value?.columns ?? EMPTY;
  const endAt = Date.parse(ctx.now), thin = thinnedOf(cell);
  const m = historyModel(cols, endAt);
  const range = keptRange(cols, endAt);
  const gaps = m.models.map(d => gapsAt(d, endAt));
  const bands = missingBands(gaps);
  const target = resolveView(range, HS);
  const [x0, x1] = frameWindow(target);
  HS.full = range; HS.shown = [x0, x1];
  const pw = Math.max(1, el.clientWidth - 78);
  const change = HS.measure === 'change', yAxis = historyAxis().get();
  // Change shifts each desk by its value at the left edge, so every line
  // starts at 0; Money draws the money itself. The classifier, the bands and
  // the estimates are the same in both; only the numbers move.
  const starts = m.models.map((d, i) => (change ? edgeValue(d, gaps[i], x0) : { v: 0, estimated: false }));
  const shifts = starts.map(start => start.v), estimatedStart = starts.map(start => start.estimated);
  const series = [], firsts = [], yValues = [];
  m.models.forEach((d, i) => {
    const shift = shifts[i];
    const from = Math.max(0, pointAt(d.lines, x0) - 1), to = Math.min(d.lines.length, pointAt(d.lines, x1) + 1);
    const visible = downsample(d.lines.slice(from, to), x0, x1, Math.max(200, el.clientWidth));
    let first = null;
    for (const p of visible) if (p.v !== null && p.x >= x0 && p.x <= x1) { yValues.push(p.v - shift); first ??= p.v; }
    for (const x of [x0, x1]) { const v = lineAt(d.lines, x); if (v !== null) yValues.push(v - shift); }
    let firstGap = null;
    // Each estimate is one straight segment (its markers lie on it).
    for (const g of gaps[i]) {
      if (g[g.length - 1].x < x0 || g[0].x > x1) continue;
      const a = Math.max(x0, g[0].x), b = Math.min(x1, g[g.length - 1].x);
      yValues.push(segmentAt(g, a) - shift, segmentAt(g, b) - shift);
      firstGap ??= segmentAt(g, a);
      series.push({ pts: [{ x: g[0].x, v: g[0].y - shift }, { x: g[g.length - 1].x, v: g[g.length - 1].y - shift }], color: 'var(--est)', estimate: true, desk: d.id });
    }
    firsts.push(first ?? firstGap ?? ASSUMED_BASELINE);
    series.push({ pts: shift ? visible.map(p => (p.v === null ? p : { x: p.x, v: p.v - shift })) : visible, color: `var(--desk-${d.id})`, w: 1.8, live: true, area: false, desk: d.id });
  });
  // The ±0,5 % floor is always taken of the money, also in Change: a change
  // of a few cents never fills the chart.
  const base = firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : ASSUMED_BASELINE;
  const most = yAxis.mode === 'max' && HS.desks.length ? historyExtremes(m, gaps) : null;
  const hitTest = xv => m.models.map((d, i) => { const hit = historyHit(d.hits, gaps[i], xv); return hit && shifts[i] ? { ...hit, v: hit.v - shifts[i] } : hit; });
  const tipFmt = (near, xv) => historyPointDetails(near, xv, HS.desks, coverageUnknownAt(cols, xv, thin), change ? x0 : null, estimatedStart);
  const points = [x0, ...m.xs.slice(firstAt(m.xs, x0), firstAt(m.xs, x1, true)), x1].filter((x, i, list) => x !== list[i - 1]);
  // Synthetic window edges can snap to an observation in the same minute.
  // Keep every original observation, but skip an edge that repeats its neighbour.
  for (const edge of [x0, x1]) {
    const i = points.indexOf(edge), adjacent = points[i === 0 ? 1 : i - 1];
    if (i < 0 || adjacent === undefined || m.models.some(d => d.hits[pointAt(d.hits, edge)]?.x === edge)) continue;
    if (tipFmt(hitTest(edge), edge).text === tipFmt(hitTest(adjacent), adjacent).text) points.splice(i, 1);
  }
  // The vertical axis: Auto re-fits to the window on every pan and zoom,
  // gliding over 180 ms; Max holds every value kept; Custom is the reader's.
  // Labels keep 56 px apart on both axes.
  const scale = drawChart(el, {
    series, xDomain: [x0, x1], base: most ? most.base : base, yValues, margin: 0.08, yFmt: change ? changeAxis : eurAxis, ticks: 5, tickGap: 56, pad: { t: 12 + top },
    zero: change, axis: yAxis, maxValues: most?.[HS.measure] ?? null, ease: 180, easeKey: HS.measure, again: () => input.schedule?.('history-anim'),
    vlines: midnightLines(x0, x1).map(x => ({ x, dashed: true })), xLabels: axisLabels(x0, x1, pw), bands, now: endAt,
    empty: !HS.desks.length, emptyText: 'Choose a desk to draw its line',
    label: chartLabel(range, [x0, x1], yAxis),
    isPanning: () => Boolean(ctx.panning?.() || input.blocksTip()), isPinned: () => input.pinned,
    inspect: { ...inspection, points },
    hitTest, tipFmt,
  });
  lastScale = scale;
  el.classList.toggle('pannable', canPan());
  // The drawn window and what it measures, for the zoom, pan and mode checks.
  const svg = el.querySelector(':scope > svg');
  if (svg) { svg.dataset.x0 = String(Math.round(x0)); svg.dataset.x1 = String(Math.round(x1)); svg.dataset.measure = HS.measure; }
  if (input.announce && inspection.live) { inspection.live.textContent = input.announce; input.announce = null; }
  if (HS.desks.length && range[1] > range[0]) drawOverview(m, range, gaps, bands, [x0, x1]);
  else overviewOff();
  return scale;
}

// ---------- The overview strip ----------
// The whole kept range of the chosen desks as compact lines on one shared,
// honest scale (the same ±0,5 % floor as the chart), with the shown window
// and its two edge handles kept in step with the chart.
const coarse = () => matchMedia('(pointer: coarse), (max-width: 700px)').matches;
function overviewSvg(m, range, gaps, bands, width, height) {
  const [k0, k1] = range, X = x => toStrip(range, width, x).toFixed(1);
  const top = 5, bottom = height - 17;
  const lines = m.models.map(d => downsample(d.lines, k0, k1, Math.max(50, Math.round(width))));
  const values = [];
  for (const l of lines) for (const p of l) if (p.v !== null) values.push(p.v);
  for (const g of gaps.flat()) values.push(g[0].y, g[g.length - 1].y);
  if (!values.length) return '';
  const firsts = lines.map((l, i) => l.find(p => p.v !== null)?.v ?? gaps[i][0]?.[0].y ?? ASSUMED_BASELINE);
  const ax = axis(Math.min(...values), Math.max(...values), 2, firsts.reduce((a, b) => a + b, 0) / firsts.length);
  const Y = v => (top + (ax.hi - v) / (ax.hi - ax.lo) * (bottom - top)).toFixed(1);
  let g = bands.length ? '<defs><pattern id="ht-mini" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--line-2)" stroke-width="1.2"/></pattern></defs>' : '';
  for (const [a, b] of bands) g += `<rect x="${X(a)}" y="0" width="${Math.max(1, toStrip(range, width, b) - toStrip(range, width, a)).toFixed(1)}" height="${bottom + 3}" fill="url(#ht-mini)"/>`;
  const days = wallTicks(k0, k1, 1440), every = [1, 2, 4, 7, 14].find(n => n * DAY / (k1 - k0) * width >= 56) ?? 14;
  // Day labels keep 56 px apart, also across a 23-hour day.
  let labelled = -Infinity;
  days.forEach((t, i) => {
    g += `<line x1="${X(t.at)}" x2="${X(t.at)}" y1="0" y2="${bottom + 3}" stroke="var(--line)"/>`;
    const at = toStrip(range, width, t.at);
    if (i % every === 0 && at < width - 34 && at - labelled >= 56) { g += `<text x="${(at + 3).toFixed(1)}" y="${height - 4}">${esc(dayWord(t.at))}</text>`; labelled = at; }
  });
  gaps.forEach(list => { for (const s of list) g += `<path d="M${X(s[0].x)} ${Y(s[0].y)} L${X(s[s.length - 1].x)} ${Y(s[s.length - 1].y)}" fill="none" stroke="var(--est)" stroke-width="1" stroke-dasharray="3 3"/>`; });
  m.models.forEach((d, i) => {
    let path = '', pen = false;
    for (const p of lines[i]) { if (p.v === null) { pen = false; continue; } path += `${pen ? 'L' : 'M'}${X(p.x)} ${Y(p.v)}`; pen = true; }
    if (path) g += `<path d="${path}" fill="none" stroke="var(--desk-${d.id})" stroke-width="1.3" stroke-linejoin="round"/>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">${g}</svg>`;
}
const setAttrs = (node, attrs) => { for (const [k, v] of Object.entries(attrs)) if (node.getAttribute(k) !== String(v)) node.setAttribute(k, String(v)); };
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
function overviewOff() {
  const mini = $('#histMini');
  if (!mini) return;
  mini.setAttribute('data-off', '');
  for (const n of [$('#histWin'), ...$$('#histMini [data-edge]')]) setAttrs(n, { tabindex: '-1', 'aria-hidden': 'true' });
  const plot = $('#histMiniPlot');
  if (plot && plot.innerHTML) plot.innerHTML = '';
  if (model) model.overview = null;
  setText($('#histKept'), '');
}
function drawOverview(m, range, gaps, bands, [a, b]) {
  const mini = $('#histMini'), track = $('#histTrack'), plot = $('#histMiniPlot');
  if (!mini || !track || !plot) return;
  const width = track.clientWidth, height = track.clientHeight;
  if (!width || !height) return;
  mini.removeAttribute('data-off');
  setAttrs(mini, { 'data-k0': Math.round(range[0]), 'data-k1': Math.round(range[1]) });
  // Redrawn when the range moves by a pixel or more, not on every frame.
  const key = `${width}|${height}|${Math.round(range[0])}|${Math.round(range[1] / ((range[1] - range[0]) / width))}`;
  if (m.overview !== key) { plot.innerHTML = overviewSvg(m, range, gaps, bands, width, height); m.overview = key; }
  // The handles may use the room beside the track inside the strip, so a
  // window narrower than a finger keeps its own target and both edges.
  const off = track.offsetLeft || 0;
  const t = overviewTargets({ width, left: toStrip(range, width, a), right: toStrip(range, width, b), hit: coarse() ? 44 : 16,
    lo: -off, hi: Math.max(width, (mini.clientWidth || 0) - off) });
  const win = $('#histWin'), from = $('#histMini [data-edge="from"]'), to = $('#histMini [data-edge="to"]');
  win.style.left = `${t.win.x}px`; win.style.width = `${t.win.w}px`;
  // The window's target (its ::after) reaches past a narrow window, never past the strip.
  win.style.setProperty?.('--hl', `${t.win.hit.x - t.win.x}px`);
  win.style.setProperty?.('--hr', `${t.win.x + t.win.w - t.win.hit.x - t.win.hit.w}px`);
  for (const [node, box] of [[from, t.from], [to, t.to]]) {
    node.style.left = `${box.x}px`; node.style.width = `${box.w}px`;
    node.firstElementChild.style.left = `${box.gx - box.x}px`;
  }
  const min = ms => Math.round(ms / 60e3), kept = spanText(range[1] - range[0]), live = HS.follow && atLiveEdge(range, [a, b]);
  setAttrs(win, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(range[0]), 'aria-valuemax': min(range[1] - (b - a)), 'aria-valuenow': min(a),
    'aria-valuetext': `${when(a)} to ${when(b)} Vienna time, ${spanText(b - a)} of ${kept} kept${live ? ', following the newest' : ''}` });
  setAttrs(from, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(range[0]), 'aria-valuemax': min(b), 'aria-valuenow': min(a), 'aria-valuetext': `From ${when(a)} Vienna time` });
  setAttrs(to, { tabindex: '0', 'aria-hidden': 'false', 'aria-valuemin': min(a), 'aria-valuemax': min(range[1]), 'aria-valuenow': min(b), 'aria-valuetext': `To ${when(b)} Vienna time${live ? ', the newest' : ''}` });
  const label = $('#histKept');
  if (label && label.textContent !== kept) label.textContent = kept;
}

// ---------- Input ----------
// Who owns what: on the chart, Left and Right inspect points (JOED-121) and
// Shift with them moves the window; plus and minus zoom; 0 shows all. On
// the strip, the window and its edges are sliders. A pointer drags the chart
// sideways; a plain vertical wheel always scrolls the page.
const input = { schedule: null, drag: null, touch: null, pinned: false, announce: null, blocksTip: () => false };
const canPan = () => Boolean(HS.full && HS.shown && HS.shown[1] - HS.shown[0] < (HS.full[1] - HS.full[0]) * 0.999);
// The first gesture or key on the chart or its strip retires the first-visit
// hint for good (its room stays, so nothing moves).
function gestured() { if (dismissChartHint()) $('#histHint')?.setAttribute('data-seen', ''); }
// A person's change of the window. Its width may match a preset again; it
// follows the newest time only while it ends exactly there, so a pan of a
// single pixel into the past turns Follow off.
function setView(next) {
  if (!HS.full) return;
  HS.view = next; HS.follow = endsAtNewest(HS.full, next);
  gestured();
  input.schedule?.('history-pan');
}
// The window a move starts from: the frame on screen while a glide runs,
// otherwise the window as it stands now. Several wheel events can arrive
// before the next frame; each builds on the one before, so small moves add
// up instead of replacing each other.
const current = () => (motion.from || !HS.full || !HS.shown ? HS.shown : resolveView(HS.full, HS));
function announceWindow() {
  if (!HS.full || !HS.shown) return;
  const next = resolveView(HS.full, HS);
  input.announce = `Showing ${when(next[0])} to ${when(next[1])} Vienna time${HS.follow ? ', following the newest' : ''}`;
}
// A preset: its span (Fit all: everything kept) ending at the newest time.
export function historyPreset(preset) {
  glide();
  HS.preset = preset; HS.view = null; HS.follow = true;
}
// Follow on keeps the window's width and moves it to the newest time; off
// keeps it where it is while newer history arrives.
export function toggleFollow() {
  if (!HS.full || !HS.shown) { HS.follow = !HS.follow; return; }
  if (HS.follow) { HS.view = HS.shown.slice(); HS.follow = false; return; }
  glide();
  HS.view = followWindow(HS.full, HS.shown); HS.follow = true;
}
const fitAll = () => { gestured(); historyPreset('all'); input.schedule?.('history-range'); };

export function initHistoryInput({ schedule }) {
  input.schedule = schedule;
  const chart = $('#histChart'), track = $('#histTrack');
  if (/Mac|iPhone|iPad/.test(navigator.platform ?? '')) for (const n of $$('.mod-key')) n.textContent = '⌘';
  const plotWidth = () => lastScale?.pw ?? Math.max(1, chart.clientWidth - 78);
  const perPx = () => (HS.shown ? (HS.shown[1] - HS.shown[0]) / plotWidth() : 0);
  const chartTime = (clientX, [a, b] = current()) => {
    const r = chart.getBoundingClientRect();
    return a + Math.min(1, Math.max(0, (clientX - r.left - (lastScale?.pad.l ?? 64)) / plotWidth())) * (b - a);
  };
  const stripTime = clientX => fromStrip(HS.full, track.clientWidth, clientX - track.getBoundingClientRect().left);
  const stop = () => { motion.from = null; };
  const unpin = () => { if (input.pinned) { input.pinned = false; lastScale?.release(); } };

  // Wheel and trackpad: ⌘/Ctrl or a pinch zooms around the pointer, a
  // sideways swipe pans, a plain vertical wheel is the page's.
  const latch = createWheelLatch();
  const wheel = (e, time) => {
    if (!HS.full || !HS.shown) return;
    const intent = latch(e, e.timeStamp);
    if (intent === 'page') return;
    e.preventDefault();
    const base = current(), dx = wheelPixels(e.deltaX, e.deltaMode), dy = wheelPixels(e.deltaY, e.deltaMode);
    stop();
    if (intent === 'zoom') setView(zoomWindow(HS.full, base, wheelZoomFactor(dy), time(e.clientX, base)));
    else setView(panWindow(HS.full, base, (e.shiftKey && Math.abs(dy) > Math.abs(dx) ? dy : dx) * (base[1] - base[0]) / plotWidth()));
  };
  chart.addEventListener('wheel', e => wheel(e, chartTime), { passive: false });
  track.addEventListener('wheel', e => wheel(e, stripTime), { passive: false });
  // Safari reports a trackpad pinch as gesture events, not as a Ctrl wheel
  // (on a phone the pointer pinch below handles it).
  const touches = new Map();
  let gesture = null;
  chart.addEventListener('gesturestart', e => { if (!HS.shown || touches.size) return; const start = current(); e.preventDefault(); stop(); gesture = { start, at: chartTime(e.clientX, start) }; });
  chart.addEventListener('gesturechange', e => { if (!gesture) return; e.preventDefault(); setView(zoomWindow(HS.full, gesture.start, 1 / Math.max(0.05, e.scale), gesture.at)); });
  chart.addEventListener('gestureend', () => { gesture = null; });

  // Mouse and pen: drag pans after 3 px, double-click shows everything kept.
  // Touch: a clear sideways swipe pans (a vertical one scrolls the page), two
  // fingers pinch and pan, a tap or a long press inspects, a double tap fits.
  input.blocksTip = () => Boolean(input.drag?.moved || (input.touch && input.touch.phase !== 'scrub'));
  chart.addEventListener('pointerdown', e => {
    if (!HS.shown || e.target.closest('.hist-status')) return;
    const start = current();
    stop();
    if (e.pointerType !== 'touch') {
      // With everything kept in view there is nothing to drag; hover keeps inspecting.
      if (e.button === 0 && canPan()) input.drag = { kind: 'chart', id: e.pointerId, x: e.clientX, start, perPx: perPx(), moved: false };
      return;
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(input.touch?.timer);
    if (touches.size === 1) {
      const t = { phase: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, down: e.timeStamp, start, perPx: perPx() };
      t.timer = setTimeout(() => { if (input.touch === t && t.phase === 'pending') { t.phase = 'scrub'; input.pinned = true; lastScale?.inspectAt(t.lastX); } }, 350);
      input.touch = t;
    } else if (touches.size === 2) {
      const [p, q] = [...touches.values()], mid = (p.x + q.x) / 2;
      unpin();
      input.touch = { phase: 'pinch', start, spread: Math.max(24, Math.abs(p.x - q.x)), mid, at: chartTime(mid, start), perPx: perPx() };
    }
  });
  chart.addEventListener('pointermove', e => {
    const d = input.drag;
    if (d?.kind === 'chart' && d.id === e.pointerId) {
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 3) return;
      if (!d.moved) { d.moved = true; chart.setPointerCapture(e.pointerId); chart.classList.add('panning'); lastScale?.release(); }
      setView(panWindow(HS.full, d.start, -dx * d.perPx));
      return;
    }
    if (!touches.has(e.pointerId) || !input.touch) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const t = input.touch;
    if (t.phase === 'pinch') {
      if (touches.size !== 2) return;
      const [p, q] = [...touches.values()], spread = Math.max(24, Math.abs(p.x - q.x)), mid = (p.x + q.x) / 2;
      const zoomed = zoomWindow(HS.full, t.start, t.spread / spread, t.at);
      setView(panWindow(HS.full, zoomed, -(mid - t.mid) * t.perPx * (zoomed[1] - zoomed[0]) / (t.start[1] - t.start[0])));
      return;
    }
    if (t.id !== e.pointerId) return;
    t.lastX = e.clientX;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (t.phase === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(t.timer);
      if (Math.abs(dx) <= Math.abs(dy)) { t.phase = 'page'; return; }
      unpin();
      t.phase = canPan() ? 'pan' : 'scrub';
      if (t.phase === 'scrub') input.pinned = true;
    }
    if (t.phase === 'pan') setView(panWindow(HS.full, t.start, -dx * t.perPx));
  });
  // Fingers are tracked by id. Whichever lifts last ends the gesture, pinch or
  // swipe, so none of its state outlives it and a mouse or pen inspects again.
  const release = e => {
    if (input.drag?.kind === 'chart' && input.drag.id === e.pointerId) { input.drag = null; chart.classList.remove('panning'); return; }
    if (!touches.delete(e.pointerId)) return;
    const t = input.touch;
    if (!touches.size) input.touch = null;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.phase === 'pinch' || t.phase === 'done') { if (touches.size) t.phase = 'done'; return; }
    if (t.id !== e.pointerId) return;
    input.touch = null;
    if (e.type === 'pointercancel') { unpin(); return; }
    if (t.phase !== 'pending' || e.timeStamp - t.down > 300) return;
    const tap = input.lastTap;
    if (tap && e.timeStamp - tap.at < 300 && Math.abs(e.clientX - tap.x) < 24) { input.lastTap = null; unpin(); fitAll(); return; }
    input.lastTap = { at: e.timeStamp, x: e.clientX };
    input.pinned = Boolean(lastScale?.inspectAt(e.clientX));
  };
  chart.addEventListener('pointerup', release);
  chart.addEventListener('pointercancel', release);
  chart.addEventListener('dblclick', e => { if (!e.target.closest('.hist-status')) fitAll(); });
  document.addEventListener('pointerdown', e => { if (!chart.contains(e.target)) unpin(); }, true);

  // Keys on the focused chart; the arrows alone stay with point inspection.
  chart.addEventListener('keydown', e => {
    if (e.target !== chart || e.altKey || e.ctrlKey || e.metaKey || !HS.shown) return;
    if (!['Tab', 'Shift'].includes(e.key)) gestured();
    const shown = current(), [a, b] = shown, w = b - a, anchor = HS.follow ? b : (a + b) / 2;
    const next = e.shiftKey && e.key === 'ArrowLeft' ? panWindow(HS.full, shown, -w * 0.1)
      : e.shiftKey && e.key === 'ArrowRight' ? panWindow(HS.full, shown, w * 0.1)
        : e.shiftKey && e.key === 'Home' ? placeWindow(HS.full, w, HS.full[0], 0)
          : e.shiftKey && e.key === 'End' ? placeWindow(HS.full, w, HS.full[1], 1)
            : e.key === '+' || e.key === '=' ? zoomWindow(HS.full, shown, 1 / 1.5, anchor)
              : e.key === '-' || e.key === '_' ? zoomWindow(HS.full, shown, 1.5, anchor) : null;
    if (e.key === '0') { e.preventDefault(); historyPreset('all'); announceWindow(); schedule('history-range'); return; }
    if (!next) return;
    e.preventDefault(); stop();
    setView(next); announceWindow();
  });

  // The strip: drag the window to pan, drag an edge to resize, click beside
  // the window to centre it there; a drag on the background pans too.
  track.addEventListener('pointerdown', e => {
    if (!HS.full || !HS.shown || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const edge = e.target.closest('[data-edge]')?.dataset.edge ?? null, start = current();
    stop();
    input.drag = { kind: edge ? 'edge' : e.target.closest('#histWin') ? 'window' : 'strip', edge, id: e.pointerId, x: e.clientX, start, moved: false };
    track.setPointerCapture?.(e.pointerId);
  });
  track.addEventListener('pointermove', e => {
    const d = input.drag;
    if (!d || d.kind === 'chart' || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) { d.moved = true; track.classList.add('dragging'); }
    const per = (HS.full[1] - HS.full[0]) / track.clientWidth;
    setView(d.kind === 'edge' ? resizeWindow(HS.full, d.start, d.edge, d.start[d.edge === 'from' ? 0 : 1] + dx * per) : panWindow(HS.full, d.start, dx * per));
  });
  const drop = e => {
    const d = input.drag;
    if (!d || d.kind === 'chart' || d.id !== e.pointerId) return;
    input.drag = null; track.classList.remove('dragging');
    if (d.moved || d.kind !== 'strip' || e.type !== 'pointerup') return;
    glide();
    setView(placeWindow(HS.full, d.start[1] - d.start[0], stripTime(e.clientX), 0.5));
  };
  track.addEventListener('pointerup', drop);
  track.addEventListener('pointercancel', drop);
  track.addEventListener('keydown', e => {
    const target = e.target.closest('#histWin, [data-edge]');
    if (!target || !HS.full || !HS.shown || e.altKey || e.ctrlKey || e.metaKey) return;
    const full = HS.full, shown = current(), [a, b] = shown, w = b - a, edge = target.dataset.edge;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    let next = null;
    if (edge) {
      const at = edge === 'from' ? a : b;
      const to = step ? at + step * w * (e.shiftKey ? 0.5 : 0.1) : { PageUp: at + w, PageDown: at - w, Home: full[0], End: full[1] }[e.key];
      if (to !== undefined) next = resizeWindow(full, shown, edge, to);
    } else if (step && e.shiftKey) next = zoomWindow(full, shown, step < 0 ? 1 / 1.5 : 1.5, HS.follow ? b : (a + b) / 2);
    else if (step) next = panWindow(full, shown, step * w * 0.1);
    else if (e.key === 'PageUp' || e.key === 'PageDown') next = panWindow(full, shown, (e.key === 'PageUp' ? 1 : -1) * w);
    else if (e.key === 'Home') next = placeWindow(full, w, full[0], 0);
    else if (e.key === 'End') next = placeWindow(full, w, full[1], 1);
    if (!next) return;
    e.preventDefault(); stop();
    if (!step) glide();
    setView(next);
  });
}

// ---------- Controls ----------
// One small button under the chart opens the gestures and keys and the
// vertical axis (Auto, Max, Custom). The button again, Escape or a click
// outside closes it; Escape returns focus to the button. Auto and Max apply
// at once; Custom starts from the range on screen, and its bottom and top
// apply with Enter or Apply, in euros of the current measure.
const AXIS_NOTE = {
  auto: () => 'Fits the shown window and glides with every move.',
  max: () => (HS.measure === 'change' ? 'Holds every change all kept history can show, so moving never rescales.' : 'Holds all kept history, so moving never rescales.'),
  custom: () => `Your own bottom and top, in euros${HS.measure === 'change' ? ' of change' : ''}.`,
};
const typedBound = n => `${n < 0 ? MINUS : ''}${String(Math.abs(n)).replace('.', ',')}`;
const axisShown = { key: null };
function syncAxisControls(force = false) {
  const choice = historyAxis().get(), pop = $('#histControls');
  if (!pop) return;
  for (const b of $$('#histAxis [data-axis]')) setAttrs(b, { 'aria-pressed': b.dataset.axis === choice.mode });
  setText($('#histAxisNote'), AXIS_NOTE[choice.mode]());
  setText($('#histAxisUnit'), HS.measure === 'change' ? `In euros of change, for example ${MINUS}25 or 40,50.` : 'In euros, for example 4950 or 5050,50.');
  const form = $('#histAxisForm');
  if (form) form.hidden = choice.mode !== 'custom';
  // The fields follow the saved bounds when the measure or the choice
  // changes, never while the reader is typing.
  const key = `${HS.measure}|${choice.mode}|${choice.min}|${choice.max}`;
  if (!force && axisShown.key === key) return;
  axisShown.key = key;
  for (const [id, value] of [['#histAxisMin', choice.min], ['#histAxisMax', choice.max]]) {
    const field = $(id);
    if (field && document.activeElement !== field) { field.value = choice.mode === 'custom' ? typedBound(value) : ''; field.setAttribute('aria-invalid', 'false'); }
  }
  setText($('#histAxisError'), '');
}
export function initHistoryControls({ schedule }) {
  const button = $('#histCtl'), pop = $('#histControls'), form = $('#histAxisForm');
  if (!button || !pop) return;
  const isOpen = () => !pop.hidden;
  const close = (focus = false) => {
    if (!isOpen()) return;
    pop.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus({ preventScroll: true });
  };
  button.addEventListener('click', () => {
    if (isOpen()) { close(); return; }
    syncAxisControls(true);
    pop.hidden = false; button.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('pointerdown', e => { if (isOpen() && !pop.contains(e.target) && !button.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const inside = pop.contains(document.activeElement) || document.activeElement === button;
    if (inside) e.preventDefault();
    close(inside);
  });
  const applied = () => { syncAxisControls(true); schedule('history-axis'); };
  $('#histAxis')?.addEventListener('click', e => {
    const b = e.target.closest('[data-axis]');
    if (!b) return;
    const yAxis = historyAxis();
    if (b.dataset.axis !== 'custom') { yAxis.setAxisMode({ mode: b.dataset.axis }); applied(); return; }
    if (yAxis.get().mode !== 'custom') {
      // Custom starts from the range on screen, in whole euros.
      const shown = lastScale?.target ?? { lo: 0, hi: 1 }, lo = Math.floor(shown.lo), hi = Math.ceil(shown.hi);
      yAxis.setAxisMode({ mode: 'custom', min: lo, max: hi > lo ? hi : lo + 1 });
    }
    applied();
    $('#histAxisMin')?.focus();
  });
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const min = $('#histAxisMin'), max = $('#histAxisMax');
    const result = historyAxis().setAxisMode({ mode: 'custom', min: min.value, max: max.value });
    if (!result.ok) {
      min.setAttribute('aria-invalid', String(result.field === 'min'));
      max.setAttribute('aria-invalid', String(result.field === 'max'));
      setText($('#histAxisError'), result.error);
      (result.field === 'min' ? min : max).focus();
      return;
    }
    // The fields show the bounds as read, the focused one included.
    min.value = typedBound(result.choice.min); max.value = typedBound(result.choice.max);
    applied();
  });
}

function capturedHtml(desk) {
  const backfill = desk?.backfill;
  const captured = backfill?.capturedSubtotal;
  if (!captured) return '';
  const cur = captured.realizedPnl?.currency ?? captured.points[0]?.realizedPnl.currency ?? 'USD';
  const pts = captured.points.map(p => ({ x: Date.parse(p.at), v: amountOf(p.realizedPnl) }));
  let chart = '';
  if (pts.length) {
    const W = 320, H = 96, xs = pts.map(p => p.x), vs = pts.map(p => p.v).concat(0);
    const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1, t0 = Math.min(...xs), t1 = Math.max(...xs);
    const cx = x => 10 + (t1 === t0 ? (W - 20) / 2 : (x - t0) / (t1 - t0) * (W - 20)), cy = v => 8 + (hi - v) / span * (H - 16);
    const last = pts[pts.length - 1].v, color = last < 0 ? 'var(--loss)' : last > 0 ? 'var(--gain)' : 'var(--ink-3)';
    const tint = last < 0 ? 'loss' : 'gain';
    const firstMoney = decimalUnits(captured.points[0].realizedPnl.amount), lastMoney = decimalUnits(captured.points.at(-1).realizedPnl.amount);
    chart = `<svg class="capt" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-zero="1" data-ylo="${lo}" data-yhi="${hi}" role="img" aria-label="Captured J results in ${cur === 'USD' ? 'dollars' : esc(cur)}: from ${money(firstMoney, cur, true)} to ${money(lastMoney, cur, true)}"><defs><linearGradient id="ga-capt" x1="0" y1="${last < 0 ? 1 : 0}" x2="0" y2="${last < 0 ? 0 : 1}"><stop offset="0" style="stop-color:var(--${tint});stop-opacity:.22"/><stop offset="1" style="stop-color:var(--${tint});stop-opacity:0"/></linearGradient></defs><line x1="0" x2="${W}" y1="${cy(0).toFixed(1)}" y2="${cy(0).toFixed(1)}" stroke="var(--line-2)" vector-effect="non-scaling-stroke"/>${pts.length > 1 ? `<path d="M${pts.map(p => `${cx(p.x).toFixed(1)} ${cy(p.v).toFixed(1)}`).join(' L')} L${cx(pts[pts.length - 1].x).toFixed(1)} ${cy(0).toFixed(1)} L${cx(pts[0].x).toFixed(1)} ${cy(0).toFixed(1)} Z" fill="url(#ga-capt)"/><polyline points="${pts.map(p => `${cx(p.x).toFixed(1)},${cy(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>` : `<circle cx="${cx(pts[0].x)}" cy="${cy(pts[0].v)}" r="3" fill="${color}"/>`}</svg>`;
  }
  const curWord = cur === 'USD' ? 'dollars' : cur === 'EUR' ? 'euros' : cur;
  const span = (from, to) => (viennaDay(from) === viennaDay(to) ? `${dayDM(from)}, ${timeHM(from)} to ${timeHM(to)}` : `${dayDM(from)}, ${timeHM(from)} to ${dayDM(to)}, ${timeHM(to)}`);
  const partial = backfill.status === 'COMPLETE' ? 'complete' : 'partial';
  return `<div class="sec-h small"><h2>${term('captured')}, ${partial}</h2><span class="sub">In ${curWord}, on their own scale; never added to the euro totals</span></div>
    ${chart}
    <dl class="facts-dl">
      <dt>Captured result</dt><dd>${pl(captured.realizedPnl ? decimalUnits(captured.realizedPnl.amount) : null, cur)} from ${captured.executionCount}${NB}fills and ${captured.commissionCount}${NB}commissions</dd>
      <dt>How it is counted</dt><dd>${captured.method === 'captured-fifo-matched-roundtrips' ? 'Buys and sells matched, oldest first' : 'Not reported'}</dd>
      <dt>Covers</dt><dd>${span(captured.fromInclusive, captured.throughInclusive)}${captured.pointsTruncated ? ' · only part of the curve is kept' : ''}</dd>
      <dt>Record checked</dt><dd>${span(backfill.coverage.fromInclusive, backfill.coverage.toExclusive)} · ${backfill.coverage.gapCount} gap${backfill.coverage.gapCount === 1 ? '' : 's'}</dd>
      <dt>Currency</dt><dd>Kept in ${curWord}${cur === 'EUR' ? '' : ': no euro rate from that time is known'}</dd>
      <dt>Gaps in the record</dt><dd>${backfill.missingOpeningLotCount} opening purchase${backfill.missingOpeningLotCount === 1 ? '' : 's'} missing · ${backfill.orphanCommissionCount} commission${backfill.orphanCommissionCount === 1 ? '' : 's'} without its trade</dd>
    </dl>`;
}

function bookkeepingHtml(ctx) {
  const data = ctx.feeds.data?.value;
  const desk = data?.desks.find(d => d.id === 'j');
  if (!desk) return `<p class="empty-line">${icon('info')}<span>J’s bookkeeping arrives with the first valid snapshot.</span></p>`;
  const acc = desk.accounting;
  const cell = ctx.states['desks.j.totalPnl'];
  const since = acc ? dayDM(acc.periodStart, NY) : null;
  const caption = stateCaption(cell, 'jacct', '');
  const result = exactCell(cell);
  const value = `${result !== null ? pl(result) : '<span class="muted">—</span>'}${caption ? ` <span class="cap" data-state="${cell?.state ?? 'not reported'}">· ${caption}</span>` : ''}`;
  return `<dl class="facts-dl">
      <dt>Counted from</dt><dd>${since ? `${since} (New York date)` : 'Not reported'}</dd>
      <dt>How it is counted</dt><dd>${acc ? `${term('bookkeeping')}: oldest purchase first, after fees, dollars turned into euros at the rate seen at the time` : 'Not reported'}</dd>
      <dt>Note</dt><dd>${acc ? esc(acc.detail) : 'No bookkeeping detail in this snapshot.'}</dd>
      <dt>J ${since ? `since ${since}` : 'since start'}</dt><dd class="jtotal">${value}</dd>
    </dl>${capturedHtml(desk)}`;
}

const EVENT_ICON = { state: 'work', action: 'work', learning: 'learning', issues: 'warn' };
const EVENT_WORD = { state: 'state', action: 'what it does', learning: 'learning', issues: 'problem' };
function eventsHtml(ctx) {
  const list = ctx.events.recent();
  if (!list.length) return `<li class="ev-empty"><span class="ev">${icon('info')}</span><div>${ctx.events.baseline() ? 'Baseline recorded. Changes appear when later snapshots differ.' : 'Waiting for the first snapshot.'}</div></li>`;
  return list.map(e => `<li><span class="ev">${icon(EVENT_ICON[e.kind] ?? 'info')}</span><div><div>${esc(e.summary)}</div><div class="m">${dayDDM(e.snapshotAt)}, ${timeHM(e.snapshotAt)} · ${LABEL[e.deskId] ?? esc(e.deskId)} · ${EVENT_WORD[e.kind] ?? esc(e.kind)} · ${esc(e.sourceLabel)}</div></div></li>`).join('');
}

const hatch = '<svg viewBox="0 0 22 10" aria-hidden="true"><defs><pattern id="ht-lg" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-3)" stroke-width="1.2"/></pattern></defs><rect x="1" y="0.5" width="20" height="9" rx="2" fill="url(#ht-lg)"/></svg>';
export function renderHistory(ctx) {
  const tools = toolsHtml();
  patch($('#histDesks'), tools.desks);
  for (const b of $$('#histMeasure [data-measure]')) setAttrs(b, { 'aria-pressed': b.dataset.measure === HS.measure });
  setText($('#histSub'), SUBTITLE[HS.measure]);
  patch($('#histLegend'), `${DESK_IDS.map(id => `<span class="lg">${swatch(`var(--desk-${id})`, '', 2.4)}${LABEL[id]}</span>`).join('')}<span class="lg">${swatch('var(--est)', '5 4', 1.6)}${term('estimate')} (drawn, not measured)</span><span class="lg">${hatch}${term('nodata')}</span>`);
  patch($('#histCompareSize'), compareSizing(HS.measure));
  const hint = $('#histHint');
  if (hint && chartHintSeen() && hint.getAttribute('data-seen') === null) hint.setAttribute('data-seen', '');
  syncAxisControls();
  const cell = ctx.states.history;
  const cols = cell?.value?.columns ?? EMPTY;
  const moved = patch($('#histStatus'), statusLine(cell));
  let pressed = HS.view ? null : HS.preset;
  if (ctx.now) {
    const endAt = Date.parse(ctx.now), range = keptRange(cols, endAt), bounds = resolveView(range, HS);
    pressed = windowPreset(range, bounds, HS.preset);
    patch($('#histCompare'), compareLine(cols, bounds, endAt).html);
    // Named over everything kept and every desk, so switching desks or the
    // window never moves the lines below.
    const excluded = basisNotice(cols, DESK_IDS, range, endAt);
    setText($('#histBasis'), excluded.length ? `This chart shows comparable records for ${excluded.map(id => LABEL[id]).join(' and ')}. Older records on another bookkeeping basis stay in the history file.` : '');
    const thin = thinnedOf(cell);
    setText($('#histThin'), thin !== null && thin > range[0] ? `Before ${when(Math.min(thin, endAt))} the history is thinned to fit its size limit: the line joins kept observations where continuous reporting is recorded. Other stretches are hatched; where coverage cannot be proved, the tooltip says coverage unknown.` : '');
  } else {
    patch($('#histCompare'), esc('Comparing waits for the board server’s clock.'));
    setText($('#histBasis'), '');
    setText($('#histThin'), '');
  }
  for (const b of $$('#histRange button')) setAttrs(b, { 'aria-pressed': b.dataset.range === pressed });
  const follow = $('#histFollow');
  if (follow) setAttrs(follow, { 'aria-pressed': HS.follow });
  patch($('#jAcct'), bookkeepingHtml(ctx));
  patch($('#events'), eventsHtml(ctx));
  return { redraw: moved };
}
