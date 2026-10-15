// One SVG chart renderer in the Paimos language: faint grid, mono axes, soft
// area, emphasised end, crosshair with an opaque tip. Honest scales: result
// charts include zero; money charts span at least ±0,5 % of their base.
import { esc, digits, MINUS, NB } from './format.js';

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
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// series: [{ pts:[{x,v}], color, w, live, area, endDot, dotted }]; gaps are
// drawn by the caller as dotted series. Returns the scale for hit-testing.
export function drawChart(el, o) {
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return null;
  const pad = { l: 64, r: 14, t: 12, b: 24, ...(o.pad || {}) };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const values = (o.yValues ?? o.series.flatMap(s => s.pts.map(p => p.v)).concat(o.include || [])).filter(Number.isFinite);
  const tip = el.querySelector('.ctip');
  el.querySelector(':scope > svg')?.remove();
  if (!values.length || o.empty) {
    el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.emptyText || 'No data')}"><text x="${pad.l + pw / 2}" y="${pad.t + ph / 2}" text-anchor="middle">${esc(o.emptyText || 'No data')}</text></svg>`);
    el.onpointermove = null; el.onpointerleave = null;
    return null;
  }
  const ax = axis(Math.min(...values), Math.max(...values), o.ticks || 4, o.base || 0, Boolean(o.zero));
  const [x0, x1] = o.xDomain;
  const X = x => pad.l + (x1 === x0 ? pw / 2 : (x - x0) / (x1 - x0) * pw);
  const Y = v => pad.t + (ax.hi - v) / (ax.hi - ax.lo) * ph;
  const first = !drawn.has(el.id) && !reduced();
  drawn.add(el.id);
  const clip = `cl-${el.id}`;
  let g = `<defs><clipPath id="${clip}"><rect x="${pad.l}" y="${pad.t - 6}" width="${pw}" height="${ph + 12}"/></clipPath>${o.series.map((s, i) => `<linearGradient id="ga-${el.id}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:${o.series.length > 1 ? 0.1 : 0.24}"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('')}</defs>`;
  if (o.future && o.future[1] > o.future[0]) g += `<rect x="${X(o.future[0]).toFixed(1)}" y="${pad.t}" width="${Math.max(0, X(o.future[1]) - X(o.future[0])).toFixed(1)}" height="${ph}" fill="var(--sunken)" rx="6"/>`;
  for (const t of ax.ticks) {
    const y = Y(t).toFixed(1), zeroLine = Math.abs(t) < 1e-9 && o.zero;
    g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="var(--line)"${zeroLine ? (o.strongZero ? ' stroke-width="1.4" style="stroke:var(--ink-3)"' : ' stroke-width="1.2" style="stroke:var(--line-2)"') : ''}/>`;
    if (!o.noY) g += `<text x="${pad.l - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(o.yFmt ? o.yFmt(t, ax.step) : t)}</text>`;
  }
  for (const v of o.vlines || []) if (v.x >= x0 && v.x <= x1) g += `<line x1="${X(v.x).toFixed(1)}" x2="${X(v.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--line)"/>`;
  for (const l of o.xLabels || []) g += `<text x="${X(l.x).toFixed(1)}" y="${H - 6}" text-anchor="${l.anchor || 'middle'}">${esc(l.text)}</text>`;
  if (o.startLine != null) g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${Y(o.startLine).toFixed(1)}" y2="${Y(o.startLine).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  const base = o.zero ? 0 : ax.lo;
  g += `<g clip-path="url(#${clip})">`;
  o.series.forEach((s, si) => {
    const segs = [[]];
    for (const p of s.pts) { if (p.v === null || p.v === undefined) { segs.push([]); continue; } segs[segs.length - 1].push(p); }
    for (const seg of segs) {
      if (!seg.length) continue;
      if (seg.length === 1 && !s.dotted) { g += `<circle cx="${X(seg[0].x).toFixed(1)}" cy="${Y(seg[0].v).toFixed(1)}" r="2" fill="${s.color}"/>`; continue; }
      const line = seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
      if (s.area !== false && !s.dotted) g += `<path d="${line} L${X(seg[seg.length - 1].x).toFixed(1)} ${Y(base).toFixed(1)} L${X(seg[0].x).toFixed(1)} ${Y(base).toFixed(1)} Z" fill="url(#ga-${el.id}-${si})"${first ? ' class="fade-in"' : ''}/>`;
      g += s.dotted
        ? `<path d="${line}" fill="none" stroke="var(--est)" stroke-width="1.6" stroke-dasharray="1.5 3.5" stroke-linecap="round" data-estimate="1"/>`
        : `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round"${first ? ' class="draw-in" data-draw="1"' : ''}/>`;
    }
  });
  g += '</g>';
  // End dots sit outside the clip so a point on the right edge stays whole.
  for (const s of o.series) {
    const last = [...s.pts].reverse().find(p => p.v !== null && p.v !== undefined);
    if (s.endDot !== false && !s.dotted && last && last.x >= x0 && last.x <= x1) {
      g += `${s.live && !reduced() ? `<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="5" fill="${s.color}" class="dot-live" opacity=".35"/>` : ''}<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="4" fill="var(--surface)" stroke="${s.color}" stroke-width="2"/>`;
    }
  }
  if (o.marker) g += `<line x1="${X(o.marker.x).toFixed(1)}" x2="${X(o.marker.x).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--line-2)"/><text x="${(X(o.marker.x) + 6).toFixed(1)}" y="${pad.t + 11}" text-anchor="start">${esc(o.marker.text)}</text>`;
  const hits = o.series.map((s, i) => (s.dotted || s.noHit ? null : i)).filter(i => i !== null);
  g += `<line class="xh" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ph}" stroke="var(--ink-3)" stroke-dasharray="2 3" visibility="hidden"/>${hits.map(i => `<circle class="xd" r="4" fill="var(--surface)" stroke="${o.series[i].color}" stroke-width="2" visibility="hidden"/>`).join('')}`;
  const attrs = o.zero ? `data-zero="1" data-ylo="${ax.lo}" data-yhi="${ax.hi}"` : `data-ylo="${ax.lo}" data-yhi="${ax.hi}" data-base="${o.base}"`;
  el.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" ${attrs} role="img" aria-label="${esc(o.label)}">${g}</svg>`);
  if (first) for (const p of el.querySelectorAll('[data-draw]')) { const len = Math.ceil(p.getTotalLength()); p.style.setProperty('--len', len); p.setAttribute('stroke-dasharray', `${len} ${len}`); }
  const scale = { X, Y, pad, pw, ph, W, H, x0, x1, ax };
  if (!tip || !o.tipFmt) { el.onpointermove = null; el.onpointerleave = null; return scale; }
  const xh = el.querySelector('.xh'), xds = [...el.querySelectorAll('.xd')];
  el.onpointermove = e => {
    if (o.isPanning?.()) return;
    if (e.target.closest?.('.hist-status, .mini-label')) { el.onpointerleave(); return; }
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, xv = x0 + (mx - pad.l) / pw * (x1 - x0);
    if (mx < pad.l - 4 || mx > pad.l + pw + 4) { el.onpointerleave(); return; }
    const near = hits.map(i => {
      let best = null;
      for (const p of o.series[i].pts) if (p.v !== null && p.v !== undefined && (!best || Math.abs(p.x - xv) < Math.abs(best.x - xv))) best = p;
      return best;
    });
    const anchor = near.find(Boolean);
    if (!anchor) return;
    const cx = X(anchor.x);
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    xds.forEach((d, i) => { if (!near[i]) { d.setAttribute('visibility', 'hidden'); return; } d.setAttribute('cx', X(near[i].x)); d.setAttribute('cy', Y(near[i].v)); d.setAttribute('visibility', 'visible'); });
    tip.innerHTML = o.tipFmt(near, xv);
    tip.classList.add('on');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(0, Math.min(W - tw, cx + 12 > W - tw ? cx - tw - 12 : cx + 12))}px`;
    tip.style.top = `${Math.max(0, Math.min(H - th, Y(anchor.v) - th - 10))}px`;
  };
  // A hidden tip goes back to the corner so it can never widen the page.
  el.onpointerleave = () => { tip.classList.remove('on'); tip.style.left = '0px'; tip.style.top = '0px'; xh.setAttribute('visibility', 'hidden'); xds.forEach(d => d.setAttribute('visibility', 'hidden')); };
  return scale;
}
