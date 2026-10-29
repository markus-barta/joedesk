// One SVG chart renderer in the Paimos language: faint grid, mono axes, soft
// area, emphasised end, crosshair with an opaque tip. Honest scales: result
// charts include zero; money charts span at least ±0,5 % of their base.
// Below it, the pure input rules History's time chart and overview share,
// and the vertical-axis choice every time chart offers (Auto, Max, Custom).
import { esc, digits, MINUS, NB } from './format.js';

// ---------- Input on a time chart ----------
// Wheel deltas in pixels: a line is about 16 px, a page about a screen.
export const wheelPixels = (delta, mode = 0) => delta * (mode === 1 ? 16 : mode === 2 ? 600 : 1);
// What one wheel event asks for: ⌘ or Ctrl zooms (browsers send a trackpad
// pinch as a Ctrl wheel); a sideways scroll, or Shift with a vertical wheel,
// pans; a plain vertical wheel belongs to the page and is never taken.
export function wheelIntent({ deltaX = 0, deltaY = 0, ctrlKey = false, metaKey = false, shiftKey = false }) {
  if (ctrlKey || metaKey) return 'zoom';
  if (Math.abs(deltaX) > Math.abs(deltaY)) return 'pan';
  if (shiftKey && deltaY) return 'pan';
  return 'page';
}
// A plain wheel event that is more vertical than sideways always belongs to
// the page, whatever came before it. Only diagonal trackpad noise (at least
// as sideways as vertical) keeps the gesture's meaning until the wheel rests
// (quietMs): a sideways swipe that wobbles keeps panning, and a page scroll
// that drifts sideways never starts panning. A held ⌘ or Ctrl zooms at once
// and stops zooming the moment it is released.
export function createWheelLatch(quietMs = 200) {
  let intent = null, last = -Infinity;
  return (e, now) => {
    const fresh = wheelIntent(e);
    const noise = !e.ctrlKey && !e.metaKey && !e.shiftKey && Math.abs(e.deltaX ?? 0) >= Math.abs(e.deltaY ?? 0);
    if (!noise || intent === null || intent === 'zoom' || now - last > quietMs) intent = fresh;
    last = now;
    return intent;
  };
}
// Chrome sends a pinch as about 100·ln(1/scale) per event, so 0,01 per pixel
// follows the fingers; one mouse-wheel notch zooms by about 40 %.
export const wheelZoomFactor = dyPx => Math.exp(Math.max(-35, Math.min(35, dyPx)) * 0.01);
// The overview strip's targets. The window itself is always a drag target at
// least `body` wide: the window, or `body` around its middle when narrower,
// inside the strip. Each edge handle's box is `hit` wide around its edge and
// kept inside the room [lo, hi] (the strip plus the space beside it); when
// the window is narrow the handles move outward, off the window's target,
// and a handle pressed against the room's end narrows instead of covering
// the window. Each grip (the visible bar) stays inside its own box, on the
// edge if it can.
export function overviewTargets({ width, left, right, hit, body = 44, lo = 0, hi = width }) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const span = Math.max(0, right - left), bw = Math.min(width, Math.max(body, span));
  const b0 = clamp((left + right) / 2 - bw / 2, 0, Math.max(0, width - bw)), b1 = b0 + bw;
  // The middle `body` of that target is never under a handle.
  const c = (b0 + b1) / 2, p0 = Math.max(b0, c - body / 2), p1 = Math.min(b1, c + body / 2);
  const fx = Math.min(clamp(left - hit / 2, lo, hi - hit), p0 - hit), tx = Math.max(clamp(right - hit / 2, lo, hi - hit), p1);
  const from = { x: Math.max(lo, fx), w: 0 }, to = { x: Math.min(hi, tx), w: 0 };
  from.w = Math.max(0, Math.min(p0, fx + hit) - from.x); to.w = Math.max(0, Math.min(hi, tx + hit) - to.x);
  const grip = (edge, box) => clamp(edge, box.x + Math.min(2, box.w / 2), box.x + box.w - Math.min(2, box.w / 2));
  return { win: { x: left, w: span, hit: { x: b0, w: bw } }, from: { ...from, gx: grip(left, from) }, to: { ...to, gx: grip(right, to) } };
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const r2 = n => Math.round(n * 100) / 100;
// A nice step that labels can state exactly: 1, 2, 2,5 or 5 times a power of
// ten, at least a cent, and no 2,5 below 0,1 (0,025 is no cent). Ticks on it
// are whole cents, so rounding them to cents never moves or merges one.
function centStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9))), f = raw / p;
  for (const m of [1, 2, 2.5, 5]) if (f <= m * (1 + 1e-9) && (m !== 2.5 || p >= 0.1)) return Math.max(0.01, r2(m * p) || m * p);
  return Math.max(0.01, 10 * p);
}
// The smallest such step whose labels stay `gap` px apart on `px` of axis,
// counted after the range is rounded out to whole steps.
function pixelStep(lo, hi, { px, gap }) {
  const most = Math.max(1, Math.floor(px / gap));
  let step = centStep((hi - lo) / most);
  for (let i = 0; i < 16 && Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9) > most; i++) step = centStep(step * 1.000001);
  return step;
}
// Labels are drawn to a tenth of a pixel: a plan for gap + 0,1 keeps every
// drawn distance at gap or more.
export const DRAWN_SLACK = 0.1;

// `room` ({ px, gap }) picks the step from the axis's length in pixels, so
// labels keep at least `gap` px apart at every size; without it, about `n`
// steps as before.
export function axis(lo, hi, n = 4, base = 0, zero = false, room = null) {
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (base) { const c = (lo + hi) / 2, h = Math.max(Math.abs(base) * 0.005, (hi - lo) / 2); lo = c - h; hi = c + h; }
  if (hi - lo < 1) { if (zero) hi = Math.max(hi, lo + 1); else { lo -= 0.5; hi += 0.5; } }
  const step = room?.px > 0 && room.gap > 0 ? pixelStep(lo, hi, room) : niceStep((hi - lo) / n);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(r2(v));
  return { lo: a, hi: b, ticks, step };
}
// An axis over exactly [lo, hi] (a custom axis, or one frame of an eased
// change): ticks on the cent step that keeps labels `gap` px apart. A range
// too small for two of them is labelled at its bounds, in whole cents, when
// those are far enough apart, and at zero between them when it fits too;
// never two labels for the same cent. (drawChart draws a zero line whether
// or not a label sits there.)
export function fixedAxis(lo, hi, room = null, n = 4) {
  const span = Math.max(hi - lo, 1e-6), pixels = room?.px > 0 && room.gap > 0;
  const step = centStep(pixels ? span * room.gap / room.px : span / n), ticks = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && ticks.length < 200; k++) ticks.push(r2(k * step) || 0);
  if (ticks.length < 2) {
    const a = Math.ceil(lo * 100 - 1e-6) / 100, b = Math.floor(hi * 100 + 1e-6) / 100;
    const apart = (u, v) => !pixels || (v - u) / span * room.px >= room.gap;
    if (a < b && apart(a, b)) {
      const zero = a < 0 && b > 0 && apart(a, 0) && apart(0, b) ? [0] : [];
      return { lo, hi, ticks: [a, ...zero, b], step: Number.isInteger(a) && Number.isInteger(b) ? 1 : 0.01 };
    }
  }
  return { lo, hi, ticks, step };
}
// The ticks to label as they are drawn (`at`: a tick's drawn coordinate):
// neighbours at least `gap` px apart with different labels, walking out from
// zero when it is a tick, so a zero line always stays.
function apartTicks(ticks, at, label, gap) {
  if (ticks.length < 2) return ticks;
  const from = Math.max(0, ticks.findIndex(t => Math.abs(t) < 1e-9)), keep = [ticks[from]];
  for (const dir of [-1, 1]) {
    let last = ticks[from];
    for (let i = from + dir; i >= 0 && i < ticks.length; i += dir) {
      if (Math.abs(at(ticks[i]) - at(last)) >= gap && label(ticks[i]) !== label(last)) { keep.push(ticks[i]); last = ticks[i]; }
    }
  }
  return keep.sort((a, b) => a - b);
}
// Whole euros for whole steps; a 2,5 step keeps its decimal. Before
// JOED-154 a 2,5 step printed whole euros, so 2,5 and 7,5 read "3" and "8"
// on every chart (Desk's day, Results); now each label states its value.
const stepDigits = step => (step < 1 ? 2 : Number.isInteger(step) ? 0 : 1);
export const eurAxis = (t, step) => `${t < 0 ? MINUS : ''}€${NB}${digits(t, stepDigits(step))}`;
// A change: signed, so +€ 20 and −€ 20 read apart from € 0.
export const changeAxis = (t, step) => `${t > 0 ? '+' : t < 0 ? MINUS : ''}€${NB}${digits(t, stepDigits(step))}`;

// ---------- The vertical axis: Auto, Max or Custom ----------
// Every time chart offers the same choice, remembered per chart and viewer
// in this browser:
//   auto    fits the values in the shown window (the default);
//   max     fits every value the chart has loaded, so moving the window
//           never rescales it;
//   custom  keeps the reader's own bottom and top, in euros of what the
//           chart shows.
// A chart adopts it with its own id:
//   const yAxis = createAxisMode('account');
//   yAxis.setAxisMode({ mode: 'custom', min: 4900, max: 5100 });
//     // { ok: true, choice } once saved, or { ok: false, field, error }
//   drawChart(el, { ...o, axis: yAxis.get(), yValues: shownValues, maxValues: [lowest, highest], tickGap: 56, ease: 180, again: redraw });
// drawChart without `axis` draws exactly as before.
export const AXIS_MODES = Object.freeze(['auto', 'max', 'custom']);
export const AXIS_LIMIT = 1e7;
export const CHART_AXES_KEY = 'joe-board-chart-axes-v1';
const AUTO = Object.freeze({ mode: 'auto' });
const withinLimit = n => Number.isFinite(n) && Math.abs(n) <= AXIS_LIMIT;

// A saved or requested choice, checked; anything else is Auto.
export function axisChoice(value) {
  if (!value || typeof value !== 'object' || !AXIS_MODES.includes(value.mode) || value.mode === 'auto') return AUTO;
  if (value.mode === 'max') return Object.freeze({ mode: 'max' });
  const { min, max } = value;
  return withinLimit(min) && withinLimit(max) && min < max ? Object.freeze({ mode: 'custom', min, max }) : AUTO;
}
// One custom bound as typed: an optional sign, digits and at most two
// decimals after a point or a comma, without grouping, as Settings reads
// euros. A Number passes as it is. Null: not a bound.
export function axisBound(raw) {
  if (typeof raw === 'number') return withinLimit(raw) ? raw : null;
  const text = String(raw ?? '').trim().replace(/^[−–]/, '-');
  if (!/^[+-]?\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replace(',', '.'));
  return withinLimit(n) ? n : null;
}
// Both bounds of a custom axis, or which one is wrong and why.
export function customAxis(min, max) {
  const blank = v => typeof v !== 'number' && !String(v ?? '').trim();
  if (blank(min) || blank(max)) return { ok: false, field: blank(min) ? 'min' : 'max', error: 'Enter both a bottom and a top.' };
  const lo = axisBound(min), hi = axisBound(max);
  if (lo === null || hi === null) return { ok: false, field: lo === null ? 'min' : 'max', error: `Enter euros as a number, for example ${MINUS}25 or 4950,50, without grouping and within ${digits(AXIS_LIMIT, 0)}.` };
  if (!(hi > lo)) return { ok: false, field: 'max', error: 'The top must be above the bottom.' };
  return { ok: true, min: lo, max: hi };
}

// The saved choices, one entry per chart id, read once. Unreadable storage
// keeps Auto everywhere; a full or blocked one keeps a choice for this page.
// (Storage is the window's: outside a page, as under Node, there is none.)
let savedAxes = null;
function axesSaved() {
  if (savedAxes) return savedAxes;
  savedAxes = {};
  try {
    const all = JSON.parse(globalThis.window?.localStorage.getItem(CHART_AXES_KEY) ?? '{}');
    if (all && typeof all === 'object' && !Array.isArray(all)) {
      for (const [id, value] of Object.entries(all)) { const choice = axisChoice(value); if (choice !== AUTO) savedAxes[id] = choice; }
    }
  } catch { /* nothing saved, or no storage */ }
  return savedAxes;
}
export function createAxisMode(id) {
  return {
    id,
    get: () => axesSaved()[id] ?? AUTO,
    setAxisMode(next = {}) {
      let choice = AUTO;
      if (next.mode === 'custom') {
        const bounds = customAxis(next.min, next.max);
        if (!bounds.ok) return bounds;
        choice = axisChoice({ mode: 'custom', min: bounds.min, max: bounds.max });
      } else choice = axisChoice(next);
      const all = axesSaved();
      if (choice === AUTO) delete all[id]; else all[id] = choice;
      try { globalThis.window?.localStorage.setItem(CHART_AXES_KEY, JSON.stringify(all)); } catch { /* this page only */ }
      return { ok: true, choice };
    },
  };
}

// The first-visit hint under a chart: shown until the first drag, swipe,
// zoom or key on any chart, then never again in this browser.
export const CHART_HINT_KEY = 'joe-board-chart-hint-v1';
let hintSeen = null;
export function chartHintSeen() {
  if (hintSeen === null) { try { hintSeen = globalThis.window?.localStorage.getItem(CHART_HINT_KEY) === '1'; } catch { hintSeen = false; } }
  return hintSeen;
}
// True only the first time.
export function dismissChartHint() {
  if (chartHintSeen()) return false;
  hintSeen = true;
  try { globalThis.window?.localStorage.setItem(CHART_HINT_KEY, '1'); } catch { /* this page only */ }
  return true;
}
// Read the saved choices and the hint again (a test, or another tab's change).
export function forgetChartMemory() { savedAxes = null; hintSeen = null; }

const drawn = new Set();
const cursors = new WeakMap();
const eases = new WeakMap();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = t => 1 - (1 - t) ** 3;
// The y-range drawn this frame. A new target glides from the range on screen
// over `o.ease` ms (redrawing through `o.again`); with reduced motion, on
// the first drawing and when `o.easeKey` changes (another quantity, say) it
// lands at once.
function easedAxis(el, target, o, room) {
  const now = performance.now(), last = eases.get(el), key = o.easeKey ?? '', to = [target.lo, target.hi];
  let e = last;
  if (!last || last.key !== key || reduced()) e = { key, from: to, to, start: -Infinity, shown: to };
  else if (last.to[0] !== to[0] || last.to[1] !== to[1]) e = { key, from: last.shown, to, start: now, shown: last.shown };
  const k = Math.min(1, (now - e.start) / o.ease), t = easeOut(k);
  e.shown = k >= 1 ? e.to : [e.from[0] + (e.to[0] - e.from[0]) * t, e.from[1] + (e.to[1] - e.from[1]) * t];
  eases.set(el, e);
  if (k >= 1) return target;
  o.again?.();
  return fixedAxis(e.shown[0], e.shown[1], room, o.ticks || 4);
}

// series: [{ pts:[{x,v}], color, w, live, area, endDot, estimate }]; gaps are
// drawn by the caller as estimate series (one subtle dashed style). Optional
// hitTest(x) supplies one hit per observed, hittable series independently of
// the drawing points. bands ([from, to]) are hatched stretches without data,
// vlines may be dashed, margin pads the value range by a share of itself and
// now marks the board's current time. inspect supplies original cursor
// timestamps, an instruction id and a live region; its tipFmt returns
// { html, text } with shared visible/spoken words. Returns the scale for
// hit-testing, with inspectAt/release for a touch caller.
// The vertical axis (all optional): axis is a choice from createAxisMode
// (Auto fits yValues; Max fits maxValues, every value the chart has loaded;
// Custom is exactly its bounds, marked on the chart, with a note where
// values lie beyond it); tickGap keeps its labels that many px apart; ease
// glides a new range over that many ms, calling again() for each next frame
// (easeKey: a new key lands at once).
export function drawChart(el, o) {
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return null;
  const pad = { l: 64, r: 14, t: 12, b: 24, ...(o.pad || {}) };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const values = (o.yValues ?? o.series.flatMap(s => s.pts.map(p => p.v)).concat(o.include || [])).filter(Number.isFinite);
  const tip = el.querySelector('.ctip');
  const live = o.inspect?.live;
  const cursor = cursors.get(el) ?? { x: null, active: false };
  cursors.set(el, cursor);
  if (o.inspect) {
    el.onkeydown = null; el.onfocus = null; el.onblur = null;
    if (tip) { tip.classList.remove('on'); tip.style.left = '0px'; tip.style.top = '0px'; }
    el.setAttribute('tabindex', '-1');
    el.setAttribute('role', 'application');
    el.setAttribute('aria-roledescription', 'interactive chart');
    el.setAttribute('aria-label', o.label);
    el.setAttribute('aria-describedby', o.inspect.description);
  }
  el.querySelector(':scope > svg')?.remove();
  if (!values.length || o.empty) {
    cursor.active = false;
    if (live) live.textContent = '';
    el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.emptyText || 'No data')}"><text x="${pad.l + pw / 2}" y="${pad.t + ph / 2}" text-anchor="middle">${esc(o.emptyText || 'No data')}</text></svg>`);
    el.onpointermove = null; el.onpointerleave = null;
    return null;
  }
  const choice = o.axis ? axisChoice(o.axis) : AUTO, custom = choice.mode === 'custom';
  const room = o.tickGap ? { px: ph, gap: o.tickGap + DRAWN_SLACK } : null;
  let target;
  if (custom) target = fixedAxis(choice.min, choice.max, room, o.ticks || 4);
  else {
    const fit = choice.mode === 'max' ? (o.maxValues ?? []).filter(Number.isFinite) : [];
    const from = fit.length ? fit : values;
    let lo = Math.min(...from), hi = Math.max(...from);
    if (o.margin) { const m = (hi - lo) * o.margin; lo -= m; hi += m; }
    target = axis(lo, hi, o.ticks || 4, o.base || 0, Boolean(o.zero), room);
  }
  let ax = o.ease > 0 ? easedAxis(el, target, o, room) : target;
  const [x0, x1] = o.xDomain;
  const X = x => pad.l + (x1 === x0 ? pw / 2 : (x - x0) / (x1 - x0) * pw);
  const Y = v => pad.t + (ax.hi - v) / (ax.hi - ax.lo) * ph;
  // With a label gap, the labels are checked where they are drawn.
  if (o.tickGap) ax = { ...ax, ticks: apartTicks(ax.ticks, t => Number((Y(t) + 3.5).toFixed(1)), t => (o.yFmt ? o.yFmt(t, ax.step) : String(t)), o.tickGap) };
  // Dots. On a custom axis a dot is drawn only where all its ink fits inside
  // the plot box: its centre ± its radius and half its stroke (SINGLE an
  // isolated value's dot, RING the newest value's and the inspected one's,
  // HALO the newest's breathing halo at its widest); a value whose dot does
  // not fit is a chevron at the edge it reaches. An automatic fit holds all
  // its values (History's with an 8 % margin), so a dot is drawn wherever its
  // value is in view, as on every chart before; a frame of a glide that has
  // not caught up with a value leaves that value's dot out.
  const SINGLE = 2, RING = 4 + 2 / 2, HALO = 5 * 2.2, WING = 4 + 2 / 2;
  const inPlot = y => y >= pad.t - 0.5 && y <= pad.t + ph + 0.5;
  const fits = (cy, extent) => (custom ? cy - extent >= pad.t - 1e-6 && cy + extent <= pad.t + ph + 1e-6 : inPlot(cy));
  // A chevron at the edge a value reaches, its wings kept inside the chart's width.
  const chevron = (x, cy) => {
    const above = cy < pad.t + ph / 2, tip = above ? pad.t + 1 : pad.t + ph - 1, d = above ? 5 : -5, cx = Math.min(W - WING, Math.max(WING, x));
    return { side: above ? 'above' : 'below', d: `M${(cx - 4).toFixed(1)} ${(tip + d).toFixed(1)} L${cx.toFixed(1)} ${tip.toFixed(1)} L${(cx + 4).toFixed(1)} ${(tip + d).toFixed(1)}` };
  };
  const CHEVRON = 'fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  // One chevron per value, drawn after the clipped lines (never clipped).
  const marks = new Map();
  const markBeyond = (si, p, color) => { const key = `${si}|${p.x}`; if (!marks.has(key)) marks.set(key, { ...chevron(X(p.x), Y(p.v)), color }); };
  const first = !drawn.has(el.id) && !reduced();
  drawn.add(el.id);
  const clip = `cl-${el.id}`, hatch = `ht-${el.id}`;
  const bands = (o.bands || []).map(([a, b]) => [Math.max(a, x0), Math.min(b, x1)]).filter(([a, b]) => b > a);
  // The lines' clip is the plot box plus half a line's width: a line on the
  // axis's edge keeps its whole width, and nothing beyond the axis shows past it.
  const edge = Math.max(0.5, ...o.series.map(s => (s.estimate ? 1.4 : s.w || 2) / 2));
  let g = `<defs><clipPath id="${clip}"><rect x="${pad.l}" y="${(pad.t - edge).toFixed(1)}" width="${pw}" height="${(ph + 2 * edge).toFixed(1)}"/></clipPath>${bands.length ? `<pattern id="${hatch}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--line-2)" stroke-width="1.5"/></pattern>` : ''}${o.series.map((s, i) => `<linearGradient id="ga-${el.id}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:${o.series.length > 1 ? 0.1 : 0.24}"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('')}</defs>`;
  if (o.future && o.future[1] > o.future[0]) g += `<rect x="${X(o.future[0]).toFixed(1)}" y="${pad.t}" width="${Math.max(0, X(o.future[1]) - X(o.future[0])).toFixed(1)}" height="${ph}" fill="var(--sunken)" rx="6"/>`;
  for (const [a, b] of bands) g += `<rect x="${X(a).toFixed(1)}" y="${pad.t}" width="${Math.max(1, X(b) - X(a)).toFixed(1)}" height="${ph}" fill="url(#${hatch})" data-gap="1"/>`;
  const zeroStyle = o.strongZero ? ' stroke-width="1.4" style="stroke:var(--ink-3)"' : ' stroke-width="1.2" style="stroke:var(--line-2)"';
  for (const t of ax.ticks) {
    const y = Y(t).toFixed(1), zeroLine = Math.abs(t) < 1e-9 && o.zero;
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="var(--line)"${zeroLine ? `${zeroStyle} data-zero-line="1"` : ''}/>`;
    if (!o.noY) g += `<text x="${pad.l - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(o.yFmt ? o.yFmt(t, ax.step) : t)}</text>`;
  }
  // The zero line belongs to the chart, not to its labels: it is drawn when
  // zero is in view, also where no label sits at zero.
  if (o.zero && ax.lo <= 0 && ax.hi >= 0 && !ax.ticks.some(t => Math.abs(t) < 1e-9)) g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--line)"${zeroStyle} data-zero-line="1"/>`;
  for (const v of o.vlines || []) if (v.x >= x0 && v.x <= x1) g += `<line x1="${X(v.x).toFixed(1)}" x2="${X(v.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" ${v.dashed ? 'stroke="var(--line-2)" stroke-dasharray="3 4"' : 'stroke="var(--line)"'}/>`;
  for (const l of o.xLabels || []) g += `<text x="${X(l.x).toFixed(1)}" y="${H - 6}" text-anchor="${l.anchor || 'middle'}">${esc(l.text)}</text>`;
  if (o.startLine != null) g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${Y(o.startLine).toFixed(1)}" y2="${Y(o.startLine).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  if (o.now != null && o.now >= x0 && o.now <= x1) g += `<line x1="${X(o.now).toFixed(1)}" x2="${X(o.now).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--ink-3)" stroke-opacity=".45" data-now="1"/><text x="${(X(o.now) - 5).toFixed(1)}" y="${pad.t + 10}" text-anchor="end">now</text>`;
  // A custom axis says so, and where values lie beyond it (their lines are cut there).
  if (custom) {
    const above = values.some(v => v > ax.hi), below = values.some(v => v < ax.lo);
    g += `<text class="axis-note" x="${pad.l + 6}" y="${pad.t + 11}" data-axis-note="top">${above ? 'Custom axis · some values lie above it' : 'Custom axis'}</text>`;
    if (below) g += `<text class="axis-note" x="${pad.l + 6}" y="${(pad.t + ph - 5).toFixed(1)}" data-axis-note="bottom">Some values lie below it</text>`;
  }
  const base = o.zero ? 0 : ax.lo;
  g += `<g clip-path="url(#${clip})">`;
  o.series.forEach((s, si) => {
    const segs = [[]];
    for (const p of s.pts) { if (p.v === null || p.v === undefined) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    for (const seg of segs) {
      if (!seg.length) continue;
      // An isolated value is a dot where it fits; on a custom axis, else a chevron.
      if (seg.length === 1 && !s.estimate) {
        const p = seg[0], cy = Y(p.v);
        if (fits(cy, SINGLE)) g += `<circle cx="${X(p.x).toFixed(1)}" cy="${cy.toFixed(1)}" r="2" fill="${s.color}"/>`;
        else if (custom && p.x >= x0 && p.x <= x1) markBeyond(si, p, s.color);
        continue;
      }
      const line = seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
      if (s.area !== false && !s.estimate) g += `<path d="${line} L${X(seg[seg.length - 1].x).toFixed(1)} ${Y(base).toFixed(1)} L${X(seg[0].x).toFixed(1)} ${Y(base).toFixed(1)} Z" fill="url(#ga-${el.id}-${si})"${first ? ' class="fade-in"' : ''}/>`;
      g += s.estimate
        ? `<path d="${line}" fill="none" stroke="var(--est)" stroke-width="1.4" stroke-dasharray="5 4" data-estimate="1"/>`
        : `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round"${first ? ' class="draw-in" data-draw="1"' : ''}/>`;
    }
  });
  g += '</g>';
  // End dots sit outside the clip so a point on the right edge stays whole;
  // its halo only where all of it fits too. The chevrons follow, once each.
  o.series.forEach((s, si) => {
    const last = [...s.pts].reverse().find(p => p.v !== null && p.v !== undefined);
    if (s.endDot !== false && !s.estimate && last && last.x >= x0 && last.x <= x1) {
      const cx = X(last.x), cy = Y(last.v);
      if (fits(cy, RING)) g += `${s.live && !reduced() && fits(cy, HALO) ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${s.color}" class="dot-live" opacity=".35"/>` : ''}<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="var(--surface)" stroke="${s.color}" stroke-width="2"/>`;
      else if (custom) markBeyond(si, last, s.color);
    }
  });
  for (const m of marks.values()) g += `<path d="${m.d}" ${CHEVRON} style="stroke:${m.color}" data-beyond="${m.side}"/>`;
  if (o.marker) g += `<line x1="${X(o.marker.x).toFixed(1)}" x2="${X(o.marker.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--line-2)"/><text x="${(X(o.marker.x) + 6).toFixed(1)}" y="${pad.t + 11}" text-anchor="start">${esc(o.marker.text)}</text>`;
  const hits = o.series.map((s, i) => (s.estimate || s.noHit ? null : i)).filter(i => i !== null);
  g += `<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--ink-3)" stroke-dasharray="2 3" visibility="hidden"/>${hits.map(i => `<circle class="xd" r="4" fill="var(--surface)" stroke="${o.series[i].color}" stroke-width="2" visibility="hidden"/>`).join('')}`;
  // A custom axis also marks an inspected value whose dot does not fit.
  if (custom) g += hits.map(i => `<path class="xc" d="" ${CHEVRON} style="stroke:${o.series[i].color}" visibility="hidden"/>`).join('');
  // A result chart is zero-based; given a base it also keeps the money
  // chart's minimum span. Both are promises of the automatic fits: a custom
  // axis is the reader's own, makes neither and says so on the chart.
  const fitted = o.zero ? `data-zero="1" data-ylo="${ax.lo}" data-yhi="${ax.hi}"${o.base ? ` data-base="${o.base}"` : ''}` : `data-ylo="${ax.lo}" data-yhi="${ax.hi}" data-base="${o.base}"`;
  const attrs = `${custom ? `data-ylo="${ax.lo}" data-yhi="${ax.hi}"` : fitted}${o.axis ? ` data-axis="${choice.mode}"` : ''}`;
  el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" ${attrs} role="img" aria-label="${esc(o.label)}"${o.inspect ? ' aria-hidden="true"' : ''}>${g}</svg>`);
  if (first) for (const p of el.querySelectorAll('[data-draw]')) { const len = Math.ceil(p.getTotalLength()); p.style.setProperty('--len', len); p.setAttribute('stroke-dasharray', `${len} ${len}`); }
  // ax is the range drawn this frame; target the one an eased change settles on.
  const scale = { X, Y, pad, pw, ph, W, H, x0, x1, ax, target, axis: choice };
  if (!tip || !o.tipFmt) { el.onpointermove = null; el.onpointerleave = null; return scale; }
  const xh = el.querySelector('.xh'), xds = [...el.querySelectorAll('.xd')], xcs = [...el.querySelectorAll('.xc')];
  const show = (xv, announce = false) => {
    const near = o.hitTest ? o.hitTest(xv) : hits.map(i => {
      let best = null;
      for (const p of o.series[i].pts) if (p.v !== null && p.v !== undefined && (!best || Math.abs(p.x - xv) < Math.abs(best.x - xv))) best = p;
      return best;
    });
    const anchor = near.find(Boolean);
    if (!anchor && !announce) return;
    const cx = X(anchor?.x ?? xv);
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    // The inspected values: a dot where it fits whole, on a custom axis a
    // chevron where it does not, unless the value already has its chevron
    // (the newest or an isolated value): that one marks it, never a second.
    // The tip keeps the words either way.
    xds.forEach((d, i) => {
      const c = xcs[i], cy = near[i] && !near[i].estimated ? Y(near[i].v) : NaN;
      if (Number.isFinite(cy) && fits(cy, RING)) {
        d.setAttribute('cx', X(near[i].x)); d.setAttribute('cy', cy); d.setAttribute('visibility', 'visible');
        c?.setAttribute('visibility', 'hidden');
        return;
      }
      d.setAttribute('visibility', 'hidden');
      if (!c) return;
      if (Number.isFinite(cy) && !marks.has(`${hits[i]}|${near[i].x}`)) { c.setAttribute('d', chevron(X(near[i].x), cy).d); c.setAttribute('visibility', 'visible'); } else c.setAttribute('visibility', 'hidden');
    });
    const content = o.tipFmt(near, xv);
    tip.innerHTML = typeof content === 'string' ? content : content.html;
    if (announce && live && live.textContent !== content.text) live.textContent = content.text;
    tip.classList.add('on');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(W - tw, cx + 12 > W - tw ? cx - tw - 12 : cx + 12))}px`;
    tip.style.top = `${Math.max(0, Math.min(H - th, (anchor ? Y(anchor.v) : pad.t + ph / 2) - th - 10))}px`;
  };
  // A hidden tip goes back to the corner so it can never widen the page.
  const hide = () => { tip.classList.remove('on'); tip.style.left = '0px'; tip.style.top = '0px'; xh.setAttribute('visibility', 'hidden'); [...xds, ...xcs].forEach(d => d.setAttribute('visibility', 'hidden')); };
  const inspectAt = clientX => {
    const r = el.getBoundingClientRect(), mx = clientX - r.left, xv = x0 + (mx - pad.l) / pw * (x1 - x0);
    if (mx < pad.l - 4 || mx > pad.l + pw + 4) return false;
    cursor.active = false;
    if (live) live.textContent = '';
    show(xv);
    return true;
  };
  el.onpointermove = e => {
    if (o.isPanning?.()) return;
    if (e.target.closest?.('.hist-status, .mini-label')) { el.onpointerleave(); return; }
    if (!inspectAt(e.clientX)) el.onpointerleave();
  };
  el.onpointerleave = () => { if (!cursor.active && !o.isPinned?.()) hide(); };
  Object.assign(scale, { inspectAt, release: () => { if (!cursor.active) hide(); } });
  if (o.inspect) {
    const points = [...new Set(o.inspect.points.filter(x => x >= x0 && x <= x1))].sort((a, b) => a - b);
    if (!points.length) return scale;
    el.setAttribute('tabindex', '0');
    let index = points.findIndex(x => cursor.x !== null && x >= cursor.x);
    if (index < 0) index = cursor.x === null ? 0 : points.length - 1;
    const inspect = () => { cursor.active = true; cursor.x = points[index]; show(cursor.x, true); };
    const dismiss = () => { cursor.active = false; hide(); if (live) live.textContent = ''; };
    el.onfocus = () => { if (el.matches(':focus-visible')) inspect(); };
    el.onblur = dismiss;
    el.onkeydown = e => {
      if (e.target !== el || e.altKey || e.ctrlKey || e.metaKey) return;
      // Shift with an arrow, Home or End moves the shown window instead (the caller's).
      if (e.shiftKey && /^(Arrow|Home$|End$)/.test(e.key)) return;
      const step = Math.max(10, Math.ceil(points.length / 10));
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: points.length - 1, PageUp: index - step, PageDown: index + step };
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      if (!(e.key in next)) return;
      e.preventDefault();
      index = Math.max(0, Math.min(points.length - 1, next[e.key]));
      inspect();
    };
    if (cursor.active && document.activeElement === el) inspect();
    else if (live) live.textContent = '';
  }
  return scale;
}
