// JoeDesk shell: navigation, theme, the header light, the footer and one
// render per animation frame. A read-only paper board: nothing here sends a
// request that changes anything.
import { isCanonicalJoeHost } from './host.js';
import { $, $$, icon, initTips, isPhone } from './ui.js';
import { createFeed } from './feed.js';
import { createObservedEvents } from './events.js';
import { renderDesk, headerHealth, forgetCharts } from './desk.js';
import { renderHistory, historyChart, HS } from './history.js';
import { renderResults, RS, stepPeriod } from './results.js';
import { boardHealthPresentation, dataAge } from './health.js';
import { setTheme, toggleTheme, syncThemeButton } from './theme.js';
import { dateTimeFull, age, NB, joinUnits } from './format.js';
import { viennaDay } from './time.mjs';

const SCREENS = ['desk', 'results', 'history', 'settings'];
const root = document.documentElement;
let screen = 'desk';
const timings = [];
window.__joedesk = { timings, renders: 0 };

if (!isCanonicalJoeHost(location.hostname)) {
  $('#privateGate').hidden = false;
  $('#app').hidden = true;
  root.dataset.ready = 'private';
} else {
  start();
}

function start() {
  const tips = initTips();
  const events = createObservedEvents();
  let lastData = null, frame = 0, pending = null, dirtyHistory = true, panning = false;
  const feed = createFeed(kind => {
    if (kind === 'history') dirtyHistory = true;
    schedule(kind);
  }, (reason, ms) => { timings.push({ reason, ms }); if (timings.length > 200) timings.shift(); }, $('#appVersion').textContent.trim());
  // Read-only: fetches the same three reads now instead of at the next poll.
  window.__joedesk.refresh = () => feed.refresh();

  function context() {
    const selected = feed.select();
    if (!selected) return null;
    return { ...selected, events, panning: () => panning };
  }

  function guard(name, fn) {
    try { return fn(); } catch (error) {
      console.error(`render ${name} failed`, error);
      return null;
    }
  }

  function renderHeader(ctx) {
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
    const head = headerHealth(ctx, health);
    const btn = $('#hdrHealth');
    if (btn.innerHTML !== head.html) btn.innerHTML = head.html;
    btn.setAttribute('aria-label', head.label);
    root.dataset.joeState = health.statusTone;
    const data = ctx.feeds.data?.value;
    const failed = ['refresh_failed', 'auth_required'].includes(ctx.feeds.data?.reason);
    const meta = data
      ? `Data from ${dateTimeFull(data.generatedAt)} · ${age(dataAge(ctx.feeds, ctx.now).receipt)} old · ${failed ? 'refresh failed' : `refreshes every 15${NB}s`}`
      : failed ? 'No data · refresh failed' : 'No data yet';
    const node = $('#footData');
    if (node.textContent !== meta) node.textContent = meta;
  }

  function render(reason) {
    frame = 0;
    const started = performance.now();
    const ctx = context();
    if (!ctx) return;
    const data = ctx.feeds.data?.value ?? null;
    if (data && data !== lastData) { guard('events', () => events.observe(data)); lastData = data; }
    guard('header', () => renderHeader(ctx));
    if (screen === 'desk') guard('desk', () => renderDesk(ctx));
    if (screen === 'history') {
      guard('history', () => renderHistory(ctx));
      if (dirtyHistory || reason !== 'tick') { guard('history chart', () => historyChart(ctx)); dirtyHistory = false; }
    }
    if (screen === 'results') guard('results', () => renderResults(ctx));
    window.__joedesk.renders++;
    if (reason !== 'tick') {
      timings.push({ reason, ms: performance.now() - started });
      if (timings.length > 200) timings.shift();
    }
    if (data || ctx.feeds.data?.reason) root.dataset.ready = '1';
  }

  function schedule(reason = 'tick') {
    if (frame) { if (reason !== 'tick') pending = reason; return; }
    const why = reason;
    frame = requestAnimationFrame(() => { const r = pending ?? why; pending = null; render(r); });
  }
  function go(next, anchor) {
    if (!SCREENS.includes(next)) next = 'desk';
    screen = next;
    tips.hide();
    for (const s of SCREENS) $(`#scr-${s}`).classList.toggle('on', s === next);
    document.body.dataset.screen = next;
    $$('.nav button, .bottom-nav button').forEach(b => { if (b.dataset.go === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    closePop();
    try { history.replaceState(null, '', `#${next}`); } catch { /* file or sandboxed context */ }
    dirtyHistory = true; forgetCharts();
    render('screen');
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }

  function closePop() {
    const pop = $('#healthPop');
    pop.classList.remove('on');
    $('#healthMore')?.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', e => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) { go(goEl.dataset.go, goEl.dataset.anchor); return; }
    const pop = $('#healthPop');
    if (e.target.closest('#healthMore')) {
      const on = !pop.classList.contains('on');
      pop.classList.toggle('on', on);
      $('#healthMore').setAttribute('aria-expanded', String(on));
      return;
    }
    if (pop.classList.contains('on') && !e.target.closest('#healthPop')) closePop();
    if (e.target.closest('#histRetry')) feed.refreshHistory();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#healthPop').classList.contains('on')) { closePop(); $('#healthMore')?.focus(); }
  });
  $('#themeBtn').addEventListener('click', () => { toggleTheme(); schedule('theme'); });
  window.__joedesk.setTheme = setTheme;

  // History controls: desk toggles, range, zoom and pan (desktop), retry.
  $('#histDesks').addEventListener('click', e => {
    const b = e.target.closest('[data-hdesk]');
    if (!b) return;
    const id = b.dataset.hdesk, all = ['j', 'joe', 'joel'];
    if (id === 'all') HS.desks = HS.desks.length === 3 ? [] : all.slice();
    else HS.desks = HS.desks.includes(id) ? HS.desks.filter(x => x !== id) : all.filter(x => x === id || HS.desks.includes(x));
    dirtyHistory = true; render('history-desks');
  });
  $('#histRange').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    HS.range = b.dataset.range; HS.zoom = null; dirtyHistory = true; render('history-range');
  });
  $('#resetZoom').addEventListener('click', () => { HS.zoom = null; dirtyHistory = true; render('history-zoom'); });
  const chartEl = $('#histChart');
  const domain = () => (HS.full ? { full: HS.full, current: HS.zoom ?? HS.full } : null);
  chartEl.addEventListener('wheel', e => {
    if (isPhone()) return;
    const d = domain();
    if (!d?.current) return;
    e.preventDefault();
    const r = chartEl.getBoundingClientRect(), padL = 64, pw = r.width - padL - 14;
    const [x0, x1] = d.current, at = x0 + Math.min(1, Math.max(0, (e.clientX - r.left - padL) / pw)) * (x1 - x0);
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    let a = at - (at - x0) * factor, b = at + (x1 - at) * factor;
    const [f0, f1] = d.full;
    if (b - a >= f1 - f0) { HS.zoom = null; } else { if (a < f0) { b += f0 - a; a = f0; } if (b > f1) { a -= b - f1; b = f1; } HS.zoom = [Math.max(f0, a), Math.min(f1, b)]; }
    if (HS.zoom && HS.zoom[1] - HS.zoom[0] < 30 * 60e3) HS.zoom = [at - 15 * 60e3, at + 15 * 60e3];
    dirtyHistory = true; schedule('history-zoom');
  }, { passive: false });
  let drag = null;
  chartEl.addEventListener('pointerdown', e => {
    if (!e.shiftKey || !HS.zoom || isPhone()) return;
    drag = { x: e.clientX, zoom: HS.zoom.slice() }; panning = true;
    chartEl.setPointerCapture(e.pointerId);
  });
  chartEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const d = domain();
    const r = chartEl.getBoundingClientRect(), pw = r.width - 78;
    const shift = -(e.clientX - drag.x) / pw * (drag.zoom[1] - drag.zoom[0]);
    let a = drag.zoom[0] + shift, b = drag.zoom[1] + shift;
    if (a < d.full[0]) { b += d.full[0] - a; a = d.full[0]; }
    if (b > d.full[1]) { a -= b - d.full[1]; b = d.full[1]; }
    HS.zoom = [a, b]; dirtyHistory = true; schedule('history-pan');
  });
  const endDrag = () => { drag = null; panning = false; };
  chartEl.addEventListener('pointerup', endDrag);
  chartEl.addEventListener('pointercancel', endDrag);
  // Pinch to zoom on touch: two fingers scale the time window around their middle.
  const touches = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...touches.values()]; return Math.abs(a - b); };
  chartEl.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !HS.full) return;
    touches.set(e.pointerId, e.clientX);
    if (touches.size === 2) {
      const r = chartEl.getBoundingClientRect(), [x0, x1] = HS.zoom ?? HS.full, mid = ([...touches.values()].reduce((a, b) => a + b) / 2 - r.left - 64) / (r.width - 78);
      pinch = { spread: Math.max(20, spread()), zoom: [x0, x1], at: x0 + Math.min(1, Math.max(0, mid)) * (x1 - x0) };
    }
  });
  chartEl.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, e.clientX);
    if (!pinch || touches.size !== 2) return;
    const [f0, f1] = HS.full, ratio = pinch.spread / Math.max(20, spread());
    let a = pinch.at - (pinch.at - pinch.zoom[0]) * ratio, b = pinch.at + (pinch.zoom[1] - pinch.at) * ratio;
    if (b - a >= f1 - f0) HS.zoom = null;
    else { if (a < f0) { b += f0 - a; a = f0; } if (b > f1) { a -= b - f1; b = f1; } HS.zoom = [a, b]; }
    dirtyHistory = true; schedule('history-zoom');
  });
  const endTouch = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  chartEl.addEventListener('pointerup', endTouch);
  chartEl.addEventListener('pointercancel', endTouch);

  // Results stays in its not-wired state; the switches and the calendar still move.
  $('#periodSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    RS.period = b.dataset.period;
    const ctx = context();
    if (ctx && (RS.period === 'ytd' || RS.period === 'all')) RS.anchor = viennaDay(ctx.now);
    render('results-period');
  });
  $('#deskSeg').addEventListener('click', e => { const b = e.target.closest('[data-desk]'); if (b) { RS.desk = b.dataset.desk; render('results-desk'); } });
  const today = () => viennaDay(context()?.now ?? new Date().toISOString());
  $('#prevPer').addEventListener('click', () => { stepPeriod(-1, today()); render('results-step'); });
  $('#nextPer').addEventListener('click', () => { stepPeriod(1, today()); render('results-step'); });
  $('#prevMonth').addEventListener('click', () => { const [y, m] = RS.cal; RS.cal = m ? [y, m - 1] : [y - 1, 11]; render('results-month'); });
  $('#nextMonth').addEventListener('click', () => { const [y, m] = RS.cal; RS.cal = m === 11 ? [y + 1, 0] : [y, m + 1]; render('results-month'); });
  $('#cal').addEventListener('click', e => {
    const c = e.target.closest('[data-day]');
    if (!c) return;
    RS.sel = c.dataset.day;
    if (['day', 'week', 'month'].includes(RS.period) && RS.sel <= today()) RS.anchor = RS.sel;
    render('results-day');
  });

  addEventListener('hashchange', () => { const next = location.hash.slice(1).split('/')[0]; if (next !== screen) go(next); });
  let resize = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(() => { forgetCharts(); dirtyHistory = true; render('resize'); }); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeButton);

  // Numbers never part from their units, in static and rendered text alike.
  const fixUnits = node => {
    if (node.nodeType === 3) { const fixed = joinUnits(node.nodeValue); if (fixed !== node.nodeValue) node.nodeValue = fixed; return; }
    if (node.nodeType !== 1) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) fixUnits(t);
  };
  new MutationObserver(list => { for (const m of list) { if (m.type === 'characterData') fixUnits(m.target); else m.addedNodes.forEach(fixUnits); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  fixUnits(document.body);

  syncThemeButton();
  $('#footShield').innerHTML = `${icon('shield')}Read-only paper board · nothing here can place a trade`;
  go((location.hash || '#desk').slice(1).split('/')[0]);
  feed.start();
}
