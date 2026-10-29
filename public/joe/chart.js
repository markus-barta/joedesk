// One SVG chart renderer in the Paimos language: faint grid, mono axes, soft
// area, emphasised end, crosshair with an opaque tip. Honest scales: result
// charts include zero; money charts span at least ±0,5 % of their base.
// Below it, the pure input rules History's time chart and overview share.
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
// One gesture keeps its first meaning until the wheel rests (quietMs), so a
// sideways swipe never turns into page scrolling half-way and a page scroll
// that drifts sideways never starts panning. A held ⌘ or Ctrl zooms at once
// and stops zooming the moment it is released.
export function createWheelLatch(quietMs = 200) {
  let intent = null, last = -Infinity;
  return (e, now) => {
    const fresh = wheelIntent(e);
    if (intent === null || now - last > quietMs || fresh === 'zoom' || intent === 'zoom') intent = fresh;
    last = now;
    return intent;
  };
}
// Chrome sends a pinch as about 100·ln(1/scale) per event, so 0,01 per pixel
// follows the fingers; one mouse-wheel notch zooms by about 40 %.
export const wheelZoomFactor = dyPx => Math.exp(Math.max(-35, Math.min(35, dyPx)) * 0.01);
// The overview strip's targets: the window between its two edge handles. A
// handle's box is `hit` wide around its edge, kept inside the strip; when the
// window is narrower than both boxes they sit side by side around its middle.
// Each grip (the visible bar) stays inside its own box, on the edge if it can.
export function overviewTargets({ width, left, right, hit }) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const box = c => clamp(c - hit / 2, 0, Math.max(0, width - hit));
  let from = box(left), to = box(right);
  if (to - from < hit) {
    const pair = clamp((left + right) / 2 - hit, 0, Math.max(0, width - 2 * hit));
    from = pair; to = pair + hit;
  }
  const grip = (edge, x) => clamp(edge, x + 2, x + hit - 2);
  return { win: { x: left, w: Math.max(0, right - left) }, from: { x: from, w: hit, gx: grip(left, from) }, to: { x: to, w: hit, gx: grip(right, to) } };
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const r2 = n => Math.round(n * 100) / 100;

export function axis(lo, hi, n = 4, base = 0, zero = false) {
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (base) { const c = (lo + hi) / 2, h = Math.max(Math.abs(base) * 0.005, (hi - lo) / 2); lo = c - h; hi = c + h; }
  if (hi - lo < 1) { if (zero) hi = Math.max(hi, lo + 1); else { lo -= 0.5; hi += 0.5; } }
  const step = niceStep((hi - lo) / n), a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(r2(v));
  return { lo: a, hi: b, ticks, step };
}
export const eurAxis = (t, step) => `${t < 0 ? MINUS : ''}€${NB}${digits(t, step < 1 ? 2 : 0)}`;

const drawn = new Set();
const cursors = new WeakMap();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// series: [{ pts:[{x,v}], color, w, live, area, endDot, estimate }]; gaps are
// drawn by the caller as estimate series (one subtle dashed style). Optional
// hitTest(x) supplies one hit per observed, hittable series independently of
// the drawing points. bands ([from, to]) are hatched stretches without data,
// vlines may be dashed, margin pads the value range by a share of itself and
// now marks the board's current time. inspect supplies original cursor
// timestamps, an instruction id and a live region; its tipFmt returns
// { html, text } with shared visible/spoken words. Returns the scale for
// hit-testing, with inspectAt/release for a touch caller.
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
  let lo = Math.min(...values), hi = Math.max(...values);
  if (o.margin) { const m = (hi - lo) * o.margin; lo -= m; hi += m; }
  const ax = axis(lo, hi, o.ticks || 4, o.base || 0, Boolean(o.zero));
  const [x0, x1] = o.xDomain;
  const X = x => pad.l + (x1 === x0 ? pw / 2 : (x - x0) / (x1 - x0) * pw);
  const Y = v => pad.t + (ax.hi - v) / (ax.hi - ax.lo) * ph;
  const first = !drawn.has(el.id) && !reduced();
  drawn.add(el.id);
  const clip = `cl-${el.id}`, hatch = `ht-${el.id}`;
  const bands = (o.bands || []).map(([a, b]) => [Math.max(a, x0), Math.min(b, x1)]).filter(([a, b]) => b > a);
  let g = `<defs><clipPath id="${clip}"><rect x="${pad.l}" y="${pad.t - 6}" width="${pw}" height="${ph + 12}"/></clipPath>${bands.length ? `<pattern id="${hatch}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="var(--line-2)" stroke-width="1.5"/></pattern>` : ''}${o.series.map((s, i) => `<linearGradient id="ga-${el.id}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:${o.series.length > 1 ? 0.1 : 0.24}"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('')}</defs>`;
  if (o.future && o.future[1] > o.future[0]) g += `<rect x="${X(o.future[0]).toFixed(1)}" y="${pad.t}" width="${Math.max(0, X(o.future[1]) - X(o.future[0])).toFixed(1)}" height="${ph}" fill="var(--sunken)" rx="6"/>`;
  for (const [a, b] of bands) g += `<rect x="${X(a).toFixed(1)}" y="${pad.t}" width="${Math.max(1, X(b) - X(a)).toFixed(1)}" height="${ph}" fill="url(#${hatch})" data-gap="1"/>`;
  for (const t of ax.ticks) {
    const y = Y(t).toFixed(1), zeroLine = Math.abs(t) < 1e-9 && o.zero;
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="var(--line)"${zeroLine ? (o.strongZero ? ' stroke-width="1.4" style="stroke:var(--ink-3)"' : ' stroke-width="1.2" style="stroke:var(--line-2)"') : ''}/>`;
    if (!o.noY) g += `<text x="${pad.l - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(o.yFmt ? o.yFmt(t, ax.step) : t)}</text>`;
  }
  for (const v of o.vlines || []) if (v.x >= x0 && v.x <= x1) g += `<line x1="${X(v.x).toFixed(1)}" x2="${X(v.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" ${v.dashed ? 'stroke="var(--line-2)" stroke-dasharray="3 4"' : 'stroke="var(--line)"'}/>`;
  for (const l of o.xLabels || []) g += `<text x="${X(l.x).toFixed(1)}" y="${H - 6}" text-anchor="${l.anchor || 'middle'}">${esc(l.text)}</text>`;
  if (o.startLine != null) g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${Y(o.startLine).toFixed(1)}" y2="${Y(o.startLine).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  if (o.now != null && o.now >= x0 && o.now <= x1) g += `<line x1="${X(o.now).toFixed(1)}" x2="${X(o.now).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--ink-3)" stroke-opacity=".45" data-now="1"/><text x="${(X(o.now) - 5).toFixed(1)}" y="${pad.t + 10}" text-anchor="end">now</text>`;
  const base = o.zero ? 0 : ax.lo;
  g += `<g clip-path="url(#${clip})">`;
  o.series.forEach((s, si) => {
    const segs = [[]];
    for (const p of s.pts) { if (p.v === null || p.v === undefined) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    for (const seg of segs) {
      if (!seg.length) continue;
      if (seg.length === 1 && !s.estimate) { g += `<circle cx="${X(seg[0].x).toFixed(1)}" cy="${Y(seg[0].v).toFixed(1)}" r="2" fill="${s.color}"/>`; continue; }
      const line = seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
      if (s.area !== false && !s.estimate) g += `<path d="${line} L${X(seg[seg.length - 1].x).toFixed(1)} ${Y(base).toFixed(1)} L${X(seg[0].x).toFixed(1)} ${Y(base).toFixed(1)} Z" fill="url(#ga-${el.id}-${si})"${first ? ' class="fade-in"' : ''}/>`;
      g += s.estimate
        ? `<path d="${line}" fill="none" stroke="var(--est)" stroke-width="1.4" stroke-dasharray="5 4" data-estimate="1"/>`
        : `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round"${first ? ' class="draw-in" data-draw="1"' : ''}/>`;
    }
  });
  g += '</g>';
  // End dots sit outside the clip so a point on the right edge stays whole.
  for (const s of o.series) {
    const last = [...s.pts].reverse().find(p => p.v !== null && p.v !== undefined);
    if (s.endDot !== false && !s.estimate && last && last.x >= x0 && last.x <= x1) {
      g += `${s.live && !reduced() ? `<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="5" fill="${s.color}" class="dot-live" opacity=".35"/>` : ''}<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4" fill="var(--surface)" stroke="${s.color}" stroke-width="2"/>`;
    }
  }
  if (o.marker) g += `<line x1="${X(o.marker.x).toFixed(1)}" x2="${X(o.marker.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--line-2)"/><text x="${(X(o.marker.x) + 6).toFixed(1)}" y="${pad.t + 11}" text-anchor="start">${esc(o.marker.text)}</text>`;
  const hits = o.series.map((s, i) => (s.estimate || s.noHit ? null : i)).filter(i => i !== null);
  g += `<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--ink-3)" stroke-dasharray="2 3" visibility="hidden"/>${hits.map(i => `<circle class="xd" r="4" fill="var(--surface)" stroke="${o.series[i].color}" stroke-width="2" visibility="hidden"/>`).join('')}`;
  // A result chart is zero-based; given a base it also keeps the money chart's minimum span.
  const attrs = o.zero ? `data-zero="1" data-ylo="${ax.lo}" data-yhi="${ax.hi}"${o.base ? ` data-base="${o.base}"` : ''}` : `data-ylo="${ax.lo}" data-yhi="${ax.hi}" data-base="${o.base}"`;
  el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" ${attrs} role="img" aria-label="${esc(o.label)}"${o.inspect ? ' aria-hidden="true"' : ''}>${g}</svg>`);
  if (first) for (const p of el.querySelectorAll('[data-draw]')) { const len = Math.ceil(p.getTotalLength()); p.style.setProperty('--len', len); p.setAttribute('stroke-dasharray', `${len} ${len}`); }
  const scale = { X, Y, pad, pw, ph, W, H, x0, x1, ax };
  if (!tip || !o.tipFmt) { el.onpointermove = null; el.onpointerleave = null; return scale; }
  const xh = el.querySelector('.xh'), xds = [...el.querySelectorAll('.xd')];
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
    xds.forEach((d, i) => { if (!near[i] || near[i].estimated) { d.setAttribute('visibility', 'hidden'); return; } d.setAttribute('cx', X(near[i].x)); d.setAttribute('cy', Y(near[i].v)); d.setAttribute('visibility', 'visible'); });
    const content = o.tipFmt(near, xv);
    tip.innerHTML = typeof content === 'string' ? content : content.html;
    if (announce && live && live.textContent !== content.text) live.textContent = content.text;
    tip.classList.add('on');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(W - tw, cx + 12 > W - tw ? cx - tw - 12 : cx + 12))}px`;
    tip.style.top = `${Math.max(0, Math.min(H - th, (anchor ? Y(anchor.v) : pad.t + ph / 2) - th - 10))}px`;
  };
  // A hidden tip goes back to the corner so it can never widen the page.
  const hide = () => { tip.classList.remove('on'); tip.style.left = '0px'; tip.style.top = '0px'; xh.setAttribute('visibility', 'hidden'); xds.forEach(d => d.setAttribute('visibility', 'hidden')); };
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
