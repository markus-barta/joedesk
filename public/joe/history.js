// History: each desk's money as observed, with dotted estimated gaps, J's
// bookkeeping with its captured results, and the desk changes this browser saw.
import { $, $$, icon, term, st, pl, inlineMark, swatch, ageSpan, patch, isPhone, statePhrase, stateCaption } from './ui.js';
import { esc, amountOf, eur, pct, age, dayDDM, dayDM, timeHM, money, NB } from './format.js';
import { cellReason } from './health.js';
import { exactCell } from './performance.js';
import { drawChart, eurAxis } from './chart.js';
import { DESK_IDS, ASSUMED_BASELINE, OBSERVATION_INTERVAL_MS, continuitySeries, sharedWindowCompare, basisNotice, toColumns, rangeWindow } from './history-model.js';
import { viennaDay, zonedInstant, VIENNA, NY } from './time.mjs';

const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const EMPTY = toColumns([]);
export const HS = { desks: DESK_IDS.slice(), range: '1w', zoom: null, full: null };
const RANGE_WORD = { '1d': 'last day', '1w': 'last week', '1m': 'last month', all: 'all kept history' };

function toolsHtml() {
  return {
    desks: `<button type="button" data-hdesk="all" aria-pressed="${HS.desks.length === 3}">All desks</button>${DESK_IDS.map(id => `<button type="button" data-hdesk="${id}" aria-pressed="${HS.desks.includes(id)}">${inlineMark(id)}${LABEL[id]}</button>`).join('')}`,
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

// The window the chart shows and the comparison uses: the range ending at the
// board's current time, or its zoom.
export function historyWindow(cols, endAt) {
  return HS.zoom ?? rangeWindow(cols, HS.range, endAt);
}

function compareLine(cols, bounds, endAt) {
  if (HS.desks.length < 2) return 'Choose two or more desks to compare them over the same window.';
  const result = sharedWindowCompare(cols, HS.desks, bounds, endAt);
  if (!result.ok) {
    return result.reason === 'incomplete-coverage' ? 'Comparing needs the same moments for every chosen desk in this window.'
      : result.reason === 'incompatible-basis' ? 'Comparing needs two moments on every chosen desk’s current bookkeeping basis.'
        : result.reason === 'insufficient-points' ? 'Not enough history in this window to compare.' : 'Choose two or more desks to compare them over the same window.';
  }
  const when = iso => `${dayDDM(iso)}, ${timeHM(iso)}`;
  return `From ${when(result.startAt)} to ${when(result.endAt)}: ${result.desks.map(d => `${LABEL[d.id]} ${pct(d.pct, 2, true)}`).join(' · ')}`;
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

function midnightLines(from, to) {
  const lines = [];
  let day = viennaDay(new Date(from).toISOString());
  for (let i = 0; i < 40; i++) {
    const at = Date.parse(zonedInstant(day, '00:00:00', VIENNA));
    if (at > to) break;
    if (at >= from) lines.push(at);
    day = new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  }
  return lines;
}

// First point at or after x; both observations and gap samples are ordered.
function pointAt(points, x) {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].x < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// Display-only hits use original observations, never the thinned SVG points.
// An actual observation wins at its timestamp; inside a gap show its estimate.
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
  return p && Math.abs(p.x - x) <= OBSERVATION_INTERVAL_MS ? { x: p.x, v: p.y } : null;
}

// One wording for the visible tooltip and the polite keyboard announcement.
export function historyPointDetails(near, x, desks) {
  const at = new Date(Math.round(x)).toISOString();
  const lines = [`${dayDDM(at)}, ${timeHM(at)} Vienna time`, ...desks.map((id, i) => {
    const p = near[i];
    return `${LABEL[id]} ${p ? `${eur(p.v)} ${p.estimated ? 'estimated' : 'observed'}` : 'no value here'}`;
  })];
  return { text: lines.join('\n'), html: `<b>${esc(lines[0])}</b>${lines.slice(1).map(line => `<br>${esc(line)}`).join('')}` };
}

export function historyChart(ctx) {
  const el = $('#histChart');
  const top = Math.ceil($('#histStatus')?.offsetHeight ?? 0);
  const inspection = { description: 'histStatus histInspectHelp', live: $('#histLive'), points: [] };
  if (!ctx.now) {
    HS.full = null;
    return drawChart(el, { series: [], xDomain: [0, 1], empty: true, inspect: inspection, pad: { t: 12 + top }, emptyText: 'Waiting for the board server’s clock', label: 'Each desk’s money: the board server’s time is not known yet' });
  }
  const cell = ctx.states.history;
  const cols = cell?.value?.columns ?? EMPTY;
  const endAt = Date.parse(ctx.now);
  const model = HS.desks.map(id => ({ id, ...continuitySeries(cols, id, HS.range, endAt) }));
  const hitPoints = model.map(m => m.observed.filter(p => p.y !== null));
  HS.full = rangeWindow(cols, HS.range, endAt);
  const [x0, x1] = historyWindow(cols, endAt);
  const inView = p => p.x >= x0 && p.x <= x1;
  const series = [];
  const firsts = [];
  for (const m of model) {
    const observed = m.observed.map(p => ({ x: p.x, v: p.y }));
    const firstSeen = observed.find(p => p.v !== null && inView(p));
    const firstGap = m.gaps.flat().find(inView);
    firsts.push(firstSeen?.v ?? firstGap?.y ?? ASSUMED_BASELINE);
    for (const gap of m.gaps) series.push({ pts: gap.map(p => ({ x: p.x, v: p.y })), color: 'var(--est)', dotted: true, desk: m.id });
    series.push({ pts: observed, color: `var(--desk-${m.id})`, w: 1.8, live: true, desk: m.id });
  }
  const base = firsts.length ? firsts.reduce((a, b) => a + b, 0) / firsts.length : ASSUMED_BASELINE;
  // Only what is visible sets the scale; the floor is ±0,5 % of the first visible money.
  const edge = (pts, x) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (a.x <= x && b.x >= x && a.v !== null && b.v !== null) return b.x === a.x ? b.v : a.v + (b.v - a.v) * ((x - a.x) / (b.x - a.x));
    }
    return null;
  };
  const yValues = series.flatMap(s => [...s.pts.filter(inView).map(p => p.v), edge(s.pts, x0), edge(s.pts, x1)]).filter(Number.isFinite);
  const visible = series.map(s => ({ ...s, pts: s.dotted ? s.pts : downsample(s.pts, x0, x1, Math.max(200, el.clientWidth)) }));
  const span = x1 - x0, daily = span > 2 * 864e5;
  const phone = el.clientWidth < 700;
  const xLabels = [];
  if (daily) {
    const lines = midnightLines(x0, x1);
    const every = span > 10 * 864e5 ? (phone ? 4 : 2) : phone ? 2 : 1;
    lines.forEach((x, i) => { if (i % every === 0 && x < x1 - span * 0.06) xLabels.push({ x, text: dayDDM(new Date(x).toISOString()).replace(/ \w+$/, ''), anchor: 'start' }); });
  } else {
    const step = span > 864e5 * 1.2 ? 6 * 3600e3 : span > 6 * 3600e3 ? (phone ? 6 : 4) * 3600e3 : 3600e3;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) if (x < x1 - span * 0.06) xLabels.push({ x, text: timeHM(new Date(x).toISOString()), anchor: 'start' });
  }
  const hitTest = xv => model.map((m, i) => historyHit(hitPoints[i], m.gaps, xv));
  const tipFmt = (near, xv) => historyPointDetails(near, xv, HS.desks);
  const points = [...new Set([x0, x1, ...model.flatMap(m => [...m.observed.map(p => p.x), ...m.gaps.flatMap(g => g.map(p => p.x))])])]
    .filter(x => x >= x0 && x <= x1).sort((a, b) => a - b);
  // Synthetic window edges can snap to an observation in the same minute.
  // Keep every original observation, but skip an edge that repeats its neighbour.
  for (const edge of [x0, x1]) {
    const i = points.indexOf(edge), adjacent = points[i === 0 ? 1 : i - 1];
    if (i < 0 || adjacent === undefined || hitPoints.some(pts => pts.some(p => p.x === edge))) continue;
    if (tipFmt(hitTest(edge), edge).text === tipFmt(hitTest(adjacent), adjacent).text) points.splice(i, 1);
  }
  const scale = drawChart(el, {
    series: visible, xDomain: [x0, x1], base, yValues, yFmt: eurAxis, ticks: 5, pad: { t: 12 + top },
    vlines: midnightLines(x0, x1).map(x => ({ x })), xLabels,
    empty: !HS.desks.length, emptyText: 'Choose a desk to draw its line',
    label: `Each desk’s money, ${RANGE_WORD[HS.range]}${HS.zoom ? ', zoomed' : ''}`,
    isPanning: () => Boolean(ctx.panning?.()),
    inspect: { ...inspection, points },
    hitTest, tipFmt,
  });
  // The drawn window, for the zoom and pan checks.
  const svg = el.querySelector(':scope > svg');
  if (svg) { svg.dataset.x0 = String(Math.round(x0)); svg.dataset.x1 = String(Math.round(x1)); }
  return scale;
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
    chart = `<svg class="capt" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-zero="1" data-ylo="${lo}" data-yhi="${hi}" role="img" aria-label="Captured J results in ${cur === 'USD' ? 'dollars' : esc(cur)}: from ${money(pts[0].v, cur, true)} to ${money(last, cur, true)}"><defs><linearGradient id="ga-capt" x1="0" y1="${last < 0 ? 1 : 0}" x2="0" y2="${last < 0 ? 0 : 1}"><stop offset="0" style="stop-color:var(--${tint});stop-opacity:.22"/><stop offset="1" style="stop-color:var(--${tint});stop-opacity:0"/></linearGradient></defs><line x1="0" x2="${W}" y1="${cy(0).toFixed(1)}" y2="${cy(0).toFixed(1)}" stroke="var(--line-2)" vector-effect="non-scaling-stroke"/>${pts.length > 1 ? `<path d="M${pts.map(p => `${cx(p.x).toFixed(1)} ${cy(p.v).toFixed(1)}`).join(' L')} L${cx(pts[pts.length - 1].x).toFixed(1)} ${cy(0).toFixed(1)} L${cx(pts[0].x).toFixed(1)} ${cy(0).toFixed(1)} Z" fill="url(#ga-capt)"/><polyline points="${pts.map(p => `${cx(p.x).toFixed(1)},${cy(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>` : `<circle cx="${cx(pts[0].x)}" cy="${cy(pts[0].v)}" r="3" fill="${color}"/>`}</svg>`;
  }
  const curWord = cur === 'USD' ? 'dollars' : cur === 'EUR' ? 'euros' : cur;
  const span = (from, to) => (viennaDay(from) === viennaDay(to) ? `${dayDM(from)}, ${timeHM(from)} to ${timeHM(to)}` : `${dayDM(from)}, ${timeHM(from)} to ${dayDM(to)}, ${timeHM(to)}`);
  const partial = backfill.status === 'COMPLETE' ? 'complete' : 'partial';
  return `<div class="sec-h small"><h2>${term('captured')}, ${partial}</h2><span class="sub">In ${curWord}, on their own scale; never added to the euro totals</span></div>
    ${chart}
    <dl class="facts-dl">
      <dt>Captured result</dt><dd>${pl(amountOf(captured.realizedPnl), cur)} from ${captured.executionCount}${NB}fills and ${captured.commissionCount}${NB}commissions</dd>
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

export function renderHistory(ctx) {
  const tools = toolsHtml();
  patch($('#histDesks'), tools.desks);
  $$('#histRange button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === HS.range)));
  $('#resetZoom').disabled = !HS.zoom;
  patch($('#histLegend'), `${DESK_IDS.map(id => `<span class="lg">${swatch(`var(--desk-${id})`, '', 2.4)}${LABEL[id]}</span>`).join('')}<span class="lg">${swatch('var(--est)', '1.5 3.5', 1.6)}${term('estimate')} (starts from an assumed ${eur(ASSUMED_BASELINE, false, 0)})</span>`);
  const cell = ctx.states.history;
  const cols = cell?.value?.columns ?? EMPTY;
  const moved = patch($('#histStatus'), statusLine(cell));
  if (ctx.now) {
    const endAt = Date.parse(ctx.now), bounds = historyWindow(cols, endAt);
    const excluded = basisNotice(cols, HS.desks, bounds, endAt);
    $('#histCompare').textContent = compareLine(cols, bounds, endAt);
    $('#histBasis').textContent = excluded.length ? `This chart shows comparable records for ${excluded.map(id => LABEL[id]).join(' and ')}. Older records on another bookkeeping basis stay in the history file.` : '';
  } else {
    $('#histCompare').textContent = 'Comparing waits for the board server’s clock.';
    $('#histBasis').textContent = '';
  }
  patch($('#jAcct'), bookkeepingHtml(ctx));
  patch($('#events'), eventsHtml(ctx));
  return { redraw: moved };
}

export const zoomable = () => !isPhone();
