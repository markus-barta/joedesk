// JoeDesk shell: navigation, theme, the header light, the footer and one
// render per animation frame. Settings saves reviewed paper fleet drafts and
// board display values through separate authenticated routes.
import { isCanonicalJoeHost } from './host.js';
import { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, applyRoute } from './route.js';
import { $, $$, icon, initTips, isPhone, trapDialogs, fromPointer, patch, fitStatusLine } from './ui.js';
import { createFeed } from './feed.js';
import { createObservedEvents } from './events.js';
import { renderDesk, headerHealth, healthPop, forgetCharts, toggleDeskDisclosure } from './desk.js';
import { renderHistory, historyChart, HS, historyPreset, toggleFollow, initHistoryInput } from './history.js';
import { renderResults, RS, stepPeriod, resultsView, openDaySheet, toggleDayReasons, forgetResults, copyDayText } from './results.js';
import { boardHealthPresentation } from './health.js';
import { sinceStarts } from './performance.js';
import { setTheme, toggleTheme, syncThemeButton } from './theme.js';
import { initSettings, renderSettings, showSection, SECTIONS as SETTINGS_SECTIONS } from './settings.js';
import { NB, joinUnits } from './format.js';
import { initVersionDisplay } from './version-display.js';

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
  // CSS shrinks only the brand before any essential item. Hide an incomplete
  // wordmark, then tighten gaps if even the icon-only row needs more room.
  // Visibility never changes sizes, so observing the result cannot oscillate.
  const header = $('.top-in'), word = header.querySelector('.brand .word'), wordText = word.firstElementChild;
  const fitHeader = () => {
    header.removeAttribute('data-tight');
    const row = header.getBoundingClientRect(), css = getComputedStyle(header);
    if ($('#themeBtn').getBoundingClientRect().right > row.right - parseFloat(css.paddingRight) + 0.02) header.setAttribute('data-tight', '');
    word.style.visibility = wordText.getBoundingClientRect().width > word.getBoundingClientRect().width + 0.02 ? 'hidden' : '';
    fitStatusLine($('#hdrHealth'), $('#statusAlert'));
  };
  // Apply size changes in the next frame, outside ResizeObserver delivery.
  let headerFrame = 0;
  const queueHeaderFit = () => {
    if (!headerFrame) headerFrame = requestAnimationFrame(() => { headerFrame = 0; fitHeader(); });
  };
  const headerFit = new ResizeObserver(queueHeaderFit);
  for (const el of [header, word, wordText, $('#hdrHealth'), header.querySelector('.nav')]) headerFit.observe(el);
  document.fonts.addEventListener('loadingdone', queueHeaderFit);
  fitHeader();
  trapDialogs();
  const events = createObservedEvents();
  let lastData = null, frame = 0, pending = null, dirtyHistory = true;
  const feed = createFeed(kind => {
    if (kind === 'history') dirtyHistory = true;
    schedule(kind);
  }, (reason, ms) => { timings.push({ reason, ms, at: performance.now() }); if (timings.length > 200) timings.shift(); }, globalThis.JoeVersion.APP_VERSION,
  { actionsWanted: () => screen === 'settings' });
  const tips = initTips({ now: () => feed.now(), since: () => sinceStarts(feed.feeds) });
  // Read-only: fetches the same three reads now instead of at the next poll.
  window.__joedesk.refresh = () => feed.refresh();
  window.__joedesk.worker = () => feed.usesWorker();

  // Every render has a selection: before the server's clock is known, each
  // panel still shows its own state and reason, and nothing needs an age.
  const context = () => ({ ...feed.select(), events });

  function guard(name, fn) {
    try { return fn(); } catch (error) {
      console.error(`render ${name} failed`, error);
      return null;
    }
  }

  let announcedStatus = null;
  function renderHeader(ctx) {
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
    const head = headerHealth(ctx, health);
    const btn = $('#hdrHealth');
    if (btn.innerHTML !== head.html) btn.innerHTML = head.html;
    if (btn.getAttribute('aria-label') !== head.label) btn.setAttribute('aria-label', head.label);
    btn.dataset.tone = health.statusTone;
    btn.dataset.reason = health.reason;
    if (btn.getAttribute('title') !== head.title) {
      if (head.title) btn.setAttribute('title', head.title);
      else btn.removeAttribute('title');
    }
    root.dataset.joeState = health.statusTone;
    const alert = $('#statusAlert');
    alert.dataset.tone = health.statusTone;
    alert.querySelector('use').setAttribute('href', health.statusTone === 'warn' ? '#i-half' : '#i-stop');
    const alertText = $('#statusAlertText');
    if (alertText.textContent !== head.alert) alertText.textContent = head.alert;
    alertText.title = head.alert;
    fitStatusLine(btn, alert);
    patch($('#healthPop'), healthPop(ctx, health));
    if (announcedStatus !== head.announcementKey) {
      $('#statusAnnouncement').textContent = head.announcement;
      announcedStatus = head.announcementKey;
    }
  }

  function render(reason) {
    frame = 0;
    const started = performance.now();
    const ctx = context();
    const data = ctx.feeds.data?.value ?? null;
    if (data && data !== lastData) { guard('events', () => events.observe(data)); lastData = data; }
    guard('header', () => renderHeader(ctx));
    if (screen === 'desk') guard('desk', () => renderDesk(ctx));
    if (screen === 'history') {
      const moved = guard('history', () => renderHistory(ctx))?.redraw;
      if (moved || dirtyHistory || !['tick', 'results'].includes(reason)) { guard('history chart', () => historyChart(ctx)); dirtyHistory = false; }
    }
    if (screen === 'results') guard('results', () => renderResults(ctx));
    if (screen === 'settings') guard('settings', () => renderSettings(ctx));
    window.__joedesk.renders++;
    if (reason !== 'tick') {
      timings.push({ reason, ms: performance.now() - started, at: started });
      if (timings.length > 200) timings.shift();
    }
    if (feed.settled()) root.dataset.ready = '1';
  }

  function schedule(reason = 'tick') {
    if (frame) { if (reason !== 'tick') pending = reason; return; }
    const why = reason;
    frame = requestAnimationFrame(() => { const r = pending ?? why; pending = null; render(r); });
  }
  // Every way onto a screen ends here (route.js). The reader's own navigation
  // (push) adds a history entry and remembers where they were on the page;
  // the first load, Back and Forward only correct the address. The address
  // keeps the screen and its query, which the screen's route reader gets
  // before it renders; an anchor only scrolls.
  let shown = { screen, query: '' };
  window.__joedesk.route = () => ({ ...shown });
  function go(next, { anchor = null, query = '', push = false, scroll = 0 } = {}) {
    if (!SCREENS.includes(next)) { next = 'desk'; anchor = null; query = ''; }
    const target = { screen: next, query };
    screen = next;
    tips.hide();
    for (const s of SCREENS) $(`#scr-${s}`).classList.toggle('on', s === next);
    document.body.dataset.screen = next;
    // The nav (both copies) and the gear: exactly the shown screen is current.
    $$('.top-in [data-go], .bottom-nav [data-go]').forEach(b => { if (b.dataset.go === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    closePop();
    for (const dialog of $$('dialog[open]')) dialog.close();
    try {
      const step = historyStep(location.hash, target, push), address = `${location.pathname}${location.search}${routeHash(target)}`;
      if (step === 'push') { history.replaceState({ ...history.state, joeScrollY: scrollY }, ''); history.pushState(null, '', address); }
      else if (step === 'replace') history.replaceState(history.state, '', address);
    } catch { /* file or sandboxed context */ }
    shown = target;
    dirtyHistory = true; forgetCharts(); forgetResults();
    if (next === 'settings') feed.refreshActions();
    guard('route', () => applyRoute(target));
    render('screen');
    if (next === 'settings' && SETTINGS_SECTIONS.some(s => s.id === anchor)) showSection(anchor);
    else if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' }); else window.scrollTo(0, scroll);
  }

  // The board details are a dialog: opening moves focus into it, Tab stays
  // inside. Escape returns focus; outside clicks keep their own destination.
  let popFrom = $('#hdrHealth');
  function openPop(from = $('#hdrHealth')) {
    tips.hide();
    popFrom = from;
    const pop = $('#healthPop');
    pop.classList.add('on');
    pop.setAttribute('aria-modal', 'true');
    pop.scrollTop = 0;
    $('#hdrHealth').setAttribute('aria-expanded', 'true');
    $('#statusAlertControl').setAttribute('aria-expanded', 'true');
    pop.focus({ preventScroll: true });
  }
  function closePop(returnFocus = false) {
    const pop = $('#healthPop');
    const wasOpen = pop.classList.contains('on');
    pop.classList.remove('on');
    if (wasOpen) tips.hide(pop);
    pop.removeAttribute('aria-modal');
    $('#hdrHealth').setAttribute('aria-expanded', 'false');
    $('#statusAlertControl').setAttribute('aria-expanded', 'false');
    if (wasOpen && returnFocus) {
      const from = popFrom.id === 'statusAlertControl' && $('#statusAlert').getAttribute('aria-hidden') === 'true' ? $('#hdrHealth') : popFrom;
      from.focus({ preventScroll: true });
    }
  }
  const focusables = el => $$('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])', el).filter(n => !n.disabled && n.getClientRects().length);

  document.addEventListener('click', e => {
    const disclosure = e.target.closest('[data-desk-disclosure]');
    if (disclosure) {
      tips.hide();
      toggleDeskDisclosure(disclosure.dataset.deskDisclosure);
      render('disclosure');
      return;
    }
    const goEl = e.target.closest('[data-go]');
    if (goEl) { go(goEl.dataset.go, { anchor: goEl.dataset.anchor, query: goEl.dataset.query, push: true }); return; }
    const route = linkRoute(e, e.target.closest('a[href]'));
    if (route) { e.preventDefault(); go(route.screen, { anchor: route.anchor, query: route.query, push: true }); return; }
    const pop = $('#healthPop');
    const statusControl = e.target.closest('#hdrHealth, #statusAlertControl');
    if (statusControl) {
      if (pop.classList.contains('on')) closePop(true); else openPop(statusControl);
      return;
    }
    if (pop.classList.contains('on') && !e.target.closest('#healthPop')) closePop();
    if (e.target.closest('#histRetry')) feed.refreshHistory();
  });
  document.addEventListener('keydown', e => {
    const pop = $('#healthPop');
    if (!pop.classList.contains('on')) return;
    if (e.key === 'Escape') { e.preventDefault(); closePop(true); return; }
    if (e.key !== 'Tab') return;
    const items = focusables(pop);
    const active = document.activeElement;
    if (!items.length) { e.preventDefault(); pop.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!pop.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && (active === first || active === pop)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  });

  $('#themeBtn').addEventListener('click', () => { toggleTheme(); schedule('theme'); });
  window.__joedesk.setTheme = setTheme;

  // History controls: desk toggles, the window presets and Follow; the chart
  // and its overview strip take their own pointer, wheel and keys.
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
    historyPreset(b.dataset.range); dirtyHistory = true; render('history-range');
  });
  $('#histFollow').addEventListener('click', () => { toggleFollow(); dirtyHistory = true; render('history-follow'); });
  initHistoryInput({ schedule });

  // Results: the period and desk switches, the stepper, the month arrows and
  // a day drive every number; on a phone a day opens its trades in a sheet.
  for (const root of [$('#daypanel'), $('#daySheet')]) root.addEventListener('copy', copyDayText);
  const view = () => resultsView(context());
  $('#periodSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    RS.period = b.dataset.period;
    if (RS.period === 'ytd' || RS.period === 'all') RS.anchor = view().today;
    render('results-period');
  });
  $('#deskSeg').addEventListener('click', e => { const b = e.target.closest('[data-desk]'); if (b) { RS.desk = b.dataset.desk; render('results-desk'); } });
  $('#prevPer').addEventListener('click', () => { stepPeriod(-1, view()); render('results-step'); });
  $('#nextPer').addEventListener('click', () => { stepPeriod(1, view()); render('results-step'); });
  $('#prevMonth').addEventListener('click', () => { const [y, m] = RS.cal; RS.cal = m ? [y, m - 1] : [y - 1, 11]; RS.moved = true; render('results-month'); });
  $('#nextMonth').addEventListener('click', () => { const [y, m] = RS.cal; RS.cal = m === 11 ? [y + 1, 0] : [y, m + 1]; RS.moved = true; render('results-month'); });
  let sheetFrom = null;
  $('#cal').addEventListener('click', e => {
    const c = e.target.closest('[data-day]');
    if (!c) return;
    const v = view();
    RS.sel = c.dataset.day; RS.moved = true;
    if (['day', 'week', 'month'].includes(RS.period) && RS.sel <= v.today) RS.anchor = RS.sel;
    render('results-day');
    if (isPhone()) { sheetFrom = RS.sel; openDaySheet(v, RS.sel, { pointer: fromPointer(e) }); }
  });
  // The sheet closes with its × button, Escape or a tap outside; focus goes back to the day.
  const sheet = $('#daySheet');
  sheet.addEventListener('click', e => {
    const more = e.target.closest('.dp-reasons-more');
    if (more) toggleDayReasons(more);
    if (e.target.closest('[data-close]') || e.target === sheet) sheet.close();
  });
  sheet.addEventListener('close', () => { if (sheetFrom) document.querySelector(`#cal [data-day="${sheetFrom}"]`)?.focus({ preventScroll: true }); sheetFrom = null; });

  // Back, Forward, a typed address or a link the browser followed itself:
  // show what the address says, where the reader left that page when they
  // left it by the nav (Back), else at its top. Back and Forward fire both
  // events; the second finds the route already shown.
  const follow = () => {
    const next = parseRoute(location.hash);
    if (next.known && !next.anchor && sameRoute(next, shown)) return;
    go(next.screen, { anchor: next.anchor, query: next.query, scroll: history.state?.joeScrollY ?? 0 });
  };
  addEventListener('popstate', follow);
  addEventListener('hashchange', follow);
  let resize = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(() => { forgetCharts(); forgetResults(); dirtyHistory = true; render('resize'); }); });
  // With System chosen the page follows the OS live (CSS); the header button's words follow too.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { syncThemeButton(); schedule('theme'); });

  // Numbers never part from their units, in static and rendered text alike.
  const fixUnits = node => {
    if (node.nodeType === 3) {
      let fixed = joinUnits(node.nodeValue, { joinDot: isPhone() });
      // A separator may start the next inline element (the exact-key line).
      if (isPhone() && / $/.test(fixed) && node.nextSibling?.textContent?.startsWith('·')) fixed = fixed.slice(0, -1) + NB;
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
      return;
    }
    if (node.nodeType !== 1) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) fixUnits(t);
  };
  new MutationObserver(list => { for (const m of list) { if (m.type === 'characterData') fixUnits(m.target); else m.addedNodes.forEach(fixUnits); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  fixUnits(document.body);

  syncThemeButton();
  initSettings({ feed, tips, schedule });
  initVersionDisplay();
  $('#footShield').innerHTML = `${icon('shield')}Read-only paper board · nothing here can place a trade`;
  // go() puts each screen back where the reader left it; the browser need not.
  try { history.scrollRestoration = 'manual'; } catch { /* go() still scrolls */ }
  const first = parseRoute(location.hash || '#desk');
  go(first.screen, { anchor: first.anchor, query: first.query });
  feed.start();
}
