// JoeDesk shell: navigation, theme, the header light, the footer and one
// render per animation frame. Settings saves reviewed paper fleet drafts and
// board display values through separate authenticated routes.
import { isCanonicalJoeHost } from './host.js';
import { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, onRoute, applyRoute, onAddress, writeRoute, createPlaces } from './route.js';
import { $, $$, icon, initTips, isPhone, trapDialogs, fromPointer, patch, fitStatusLine } from './ui.js';
import { createFeed } from './feed.js';
import { boardSession } from './transport.js';
import { refreshBoardSettings } from './board-settings.js';
import { createBoardFreeze } from './presentation.js';
import { createObservedEvents } from './events.js';
import { renderDesk, headerHealth, healthPop, forgetCharts, toggleDeskDisclosure, initBarTaps, cancelBarInteractions } from './desk.js';
import { initAccount, renderAccount, refreshAccountHistory, pollAccountHistory, accountHistoryIdle, cancelInteractions as cancelAccountInteractions } from './account.js';
import { renderHistory, historyChart, HS, historyPreset, toggleFollow, initHistoryInput, initHistoryControls, historyQuery, readHistoryRoute, cancelInteractions as cancelHistoryInteractions } from './history.js';
import { renderResults, RS, stepPeriod, choosePeriod, chooseDesk, selectDay, showMonth, resultsView, openDaySheet, toggleDayReasons, forgetResults, copyDayText, requestResultsRoute, resultsUrl, explainResultsSignIn } from './results.js';
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
  const freeze = createBoardFreeze(document, boardSession, { cancelInteractions: () => {
    explainResultsSignIn(context());
    cancelAccountInteractions(); cancelHistoryInteractions(); cancelBarInteractions(); tips.cancel();
  } });
  let recoveringRender = false, queuedRoute = null;
  // Keep reading/scrolling available, but a frozen board cannot edit a draft,
  // open a live explanation or navigate into a renderer until sign-in recovers.
  const blockFrozenInput = event => {
    if (!freeze.frozen() || !event.target.closest?.('#app')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  for (const type of ['click', 'beforeinput', 'paste', 'cut', 'drop', 'input', 'change', 'submit', 'pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'pointerover', 'pointerout', 'pointerleave', 'focus', 'blur', 'focusin', 'focusout', 'wheel', 'gesturestart', 'gesturechange', 'gestureend', 'keydown', 'keyup'])
    document.addEventListener(type, blockFrozenInput, true);
  // The header keeps one row. While its last control, the theme button, does
  // not fit, add the next step (app.css: the wordmark goes, the nav drops its
  // icons, gaps tighten, the nav keeps only its icons, then the light may
  // narrow), keeping the earlier ones. Each pass starts from none, and only
  // the viewport and the fonts decide the steps, never the light's words, so
  // no tick or state change moves the header and refitting cannot oscillate.
  const header = $('.top-in'), themeBtn = $('#themeBtn');
  const FIT = ['word', 'labels', 'tight', 'icons', 'squeeze'];
  const overflows = () => themeBtn.getBoundingClientRect().right > header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight) + 0.02;
  const fitHeader = () => {
    if (freeze.frozen()) return;
    let steps = 0;
    header.dataset.fit = '';
    while (steps < FIT.length && overflows()) header.dataset.fit = FIT.slice(0, ++steps).join(' ');
    fitStatusLine($('#hdrHealth'), $('#statusAlert'));
  };
  // Apply size changes in the next frame, outside ResizeObserver delivery.
  let headerFrame = 0;
  const queueHeaderFit = () => {
    if (!headerFrame) headerFrame = requestAnimationFrame(() => { headerFrame = 0; fitHeader(); });
  };
  const headerFit = new ResizeObserver(queueHeaderFit);
  for (const el of [header, $('#modeLabel'), header.querySelector('.brand .word > span'), header.querySelector('.nav'), $('#hdrHealth')]) headerFit.observe(el);
  document.fonts.addEventListener('loadingdone', queueHeaderFit);
  fitHeader();
  trapDialogs();
  initAccount();
  setInterval(pollAccountHistory, 15000);
  const events = createObservedEvents();
  let lastData = null, frame = 0, pending = null, dirtyHistory = true;
  const feed = createFeed(kind => {
    if (kind === 'history') dirtyHistory = true;
    schedule(kind);
  }, (reason, ms) => { timings.push({ reason, ms, at: performance.now() }); if (timings.length > 200) timings.shift(); }, globalThis.JoeVersion.APP_VERSION,
  { actionsWanted: () => screen === 'settings', session: boardSession });
  const tips = initTips({ now: () => feed.now(), since: () => sinceStarts(feed.feeds) });
  initBarTaps();
  // Read-only refresh hooks; a named read also allows transport isolation.
  window.__joedesk.refresh = kind => {
    const read = { state: feed.refreshState, history: feed.refreshHistory, results: feed.refreshResults, fleet: feed.refreshFleet, actions: feed.refreshActions }[kind];
    return read ? read() : Promise.all([feed.refresh(), feed.refreshActions()]);
  };
  window.__joedesk.worker = () => feed.usesWorker();

  // Every render has a selection: before the server's clock is known, each
  // panel still shows its own state and reason, and nothing needs an age.
  const context = () => ({ ...feed.select(), events });

  function guard(name, fn) {
    try { return fn(); } catch (error) {
      renderFailed = true;
      console.error(`render ${name} failed`, error);
      return null;
    }
  }

  let announcedStatus = null, renderFailed = false;
  function renderHeader(ctx) {
    const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
    const head = headerHealth(ctx, health);
    const btn = $('#hdrHealth');
    patch(btn, head.html);
    if (btn.getAttribute('aria-label') !== head.label) btn.setAttribute('aria-label', head.label);
    if (btn.dataset.tone !== health.statusTone) btn.dataset.tone = health.statusTone;
    if (btn.dataset.reason !== health.reason) btn.dataset.reason = health.reason;
    if (btn.getAttribute('title') !== head.title) {
      if (head.title) btn.setAttribute('title', head.title);
      else btn.removeAttribute('title');
    }
    if (root.dataset.joeState !== health.statusTone) root.dataset.joeState = health.statusTone;
    const alert = $('#statusAlert');
    if (alert.dataset.reason !== health.reason) alert.dataset.reason = health.reason;
    if (alert.dataset.tone !== health.statusTone) alert.dataset.tone = health.statusTone;
    const use = alert.querySelector('use'), href = health.statusTone === 'warn' ? '#i-half' : '#i-stop';
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
    const alertText = $('#statusAlertText');
    if (alertText.textContent !== head.alert) alertText.textContent = head.alert;
    if (alertText.title !== head.alert) alertText.title = head.alert;
    fitStatusLine(btn, alert);
    patch($('#healthPop'), healthPop(ctx, health));
    if (announcedStatus !== head.announcementKey) {
      $('#statusAnnouncement').textContent = head.announcement;
      announcedStatus = head.announcementKey;
    }
  }

  function render(reason) {
    frame = 0;
    if (freeze.sync() && !recoveringRender) { root.dataset.ready = '1'; return; }
    renderFailed = false;
    const started = performance.now();
    const ctx = context();
    const data = ctx.feeds.data?.value ?? null;
    if (data && data !== lastData) { guard('events', () => events.observe(data)); lastData = data; }
    guard('header', () => renderHeader(ctx));
    // Desk's whole account (JOED-156) renders first, in the slot above the desk hero.
    if (screen === 'desk') { guard('account', () => renderAccount(ctx)); guard('desk', () => renderDesk(ctx)); }
    // History's address names its preset, desks and measure: a correction in
    // place (no history entry), never over an address still waiting for follow().
    if (screen === 'history') {
      const moved = guard('history', () => renderHistory(ctx))?.redraw;
      if (moved || dirtyHistory || !['tick', 'results'].includes(reason)) { guard('history chart', () => historyChart(ctx)); dirtyHistory = false; }
      writeRoute('history', historyQuery());
    }
    // Results' address follows its view once a link is applied (a correction; README: Results deep links).
    if (screen === 'results') { const url = guard('results', () => renderResults(ctx)); if (url) writeRoute('results', parseRoute(url).query); }
    if (screen === 'settings') guard('settings', () => renderSettings(ctx));
    window.__joedesk.renders++;
    if (reason !== 'tick') {
      timings.push({ reason, ms: performance.now() - started, at: started });
      if (timings.length > 200) timings.shift();
    }
    if (feed.settled()) root.dataset.ready = '1';
    if (!renderFailed) freeze.rendered(ctx.feeds.data?.value?.generatedAt ?? ctx.now);
    return !renderFailed;
  }

  function schedule(reason = 'tick') {
    if (frame) { if (reason !== 'tick') pending = reason; return; }
    const why = reason;
    frame = requestAnimationFrame(() => { const r = pending ?? why; pending = null; render(r); });
  }
  // Every way onto a screen ends here (route.js). The reader's own navigation
  // (push) adds a history entry; the first load, Back and Forward only
  // correct the address. Each entry keeps the reader's place (createPlaces,
  // which makes every history call within one budget): saved while reading
  // and on every departure, restored on return and after a reload. The
  // address keeps the screen and its query, which the screen's route reader
  // gets before it renders; an anchor only scrolls.
  let shown = { screen, query: '' };
  window.__joedesk.route = () => ({ ...shown });
  const places = createPlaces(window);
  addEventListener('scroll', places.scrolled, { passive: true });
  addEventListener('scrollend', places.scrolled);
  addEventListener('pagehide', places.flush);
  // The reader's own scrolling ends a return still waiting for the page to grow.
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(type, places.abandon, { passive: true });
  // The one address path: go() and a shown screen writing its own query
  // (route.js writeRoute) take the same history step through the same places,
  // so every write counts against the one budget.
  function address(target, push) {
    try {
      const step = historyStep(location.hash, target, push), url = `${location.pathname}${location.search}${routeHash(target)}`;
      if (step === 'push') { if (!places.push(url)) places.step(); } else if (step === 'replace') places.replace(url);
    } catch { places.step(); /* file or sandboxed context: keep the entry it is on */ }
    shown = target;
  }
  // A shown screen's own query: the reader's change pushes, a correction
  // replaces, and a correction never overwrites an address that changed
  // outside the page and still waits for follow().
  onAddress((target, push) => {
    if (target.screen !== screen || (!push && location.hash !== routeHash(shown))) return false;
    address(target, push);
    return true;
  });
  function go(next, { anchor = null, query = '', push = false, scroll = 0 } = {}) {
    if (freeze.frozen() && !recoveringRender) return;
    if (!SCREENS.includes(next)) { next = 'desk'; anchor = null; query = ''; }
    // The reader's own way onto the screen already shown (its nav button, the
    // gear, a bare link or anchor) asks for that screen as it is: it keeps the
    // query the screen gave its address, so no entry repeats the shown view.
    // Nothing in the address changed, so the screen's reader does not run
    // again and its state stays (Results' browsed month); only the scroll or
    // the anchor applies.
    const asIs = push && !query && next === shown.screen;
    if (asIs) query = shown.query;
    const target = { screen: next, query };
    // The address first, while the page still shows the place being left:
    // hiding a screen, closing a dialog or rendering may move it.
    address(target, push);
    screen = next;
    tips.hide();
    for (const s of SCREENS) $(`#scr-${s}`).classList.toggle('on', s === next);
    document.body.dataset.screen = next;
    // The nav (both copies) and the gear: exactly the shown screen is current.
    $$('.top-in [data-go], .bottom-nav [data-go]').forEach(b => { if (b.dataset.go === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    closePop();
    for (const dialog of $$('dialog[open]')) dialog.close();
    dirtyHistory = true; forgetCharts(); forgetResults();
    if (next === 'settings') feed.refreshActions();
    if (!asIs) guard('route', () => applyRoute(target));
    const rendered = render('screen');
    if (next === 'settings' && SETTINGS_SECTIONS.some(s => s.id === anchor)) { places.abandon(); showSection(anchor); }
    else if (anchor) { places.abandon(); document.getElementById(anchor)?.scrollIntoView({ block: 'start' }); } else places.arrive(scroll);
    return rendered;
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
    if (e.target.closest('[data-sign-in-reload]')) { location.reload(); return; }
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

  // History controls: desk toggles, Change | Money, the window presets and
  // Follow; the chart and its overview strip take their own pointer, wheel
  // and keys. History reads its link (range, desk, mode) before it renders.
  onRoute('history', readHistoryRoute);
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
  // Change | Money: what the lines measure (the window and the desks stay).
  $('#histMeasure').addEventListener('click', e => {
    const b = e.target.closest('[data-measure]');
    if (!b || b.dataset.measure === HS.measure) return;
    HS.measure = b.dataset.measure; dirtyHistory = true; render('history-measure');
  });
  // Follow and its phone copy (index.html) are one toggle.
  for (const b of $$('[data-follow]')) b.addEventListener('click', () => { toggleFollow(); dirtyHistory = true; render('history-follow'); });
  initHistoryInput({ schedule });
  initHistoryControls({ schedule });

  // Results: the period and desk switches, the stepper, the month arrows and
  // a day drive every number; on a phone a day opens its trades in a sheet.
  for (const root of [$('#daypanel'), $('#daySheet')]) root.addEventListener('copy', copyDayText);
  const view = () => resultsView(context());
  // Results reads its link before it renders (route.js onRoute); a link that
  // waits for the record keeps its address until Results applies it once
  // (results.js). Each change of the view pushes its address (writeRoute).
  onRoute('results', (_params, route) => requestResultsRoute(route.query));
  const commit = () => writeRoute('results', parseRoute(resultsUrl(view())).query, { push: true });
  $('#periodSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    choosePeriod(b.dataset.period, view());
    commit();
    render('results-period');
  });
  $('#deskSeg').addEventListener('click', e => { const b = e.target.closest('[data-desk]'); if (b) { chooseDesk(b.dataset.desk); commit(); render('results-desk'); } });
  $('#prevPer').addEventListener('click', () => { stepPeriod(-1, view()); commit(); render('results-step'); });
  $('#nextPer').addEventListener('click', () => { stepPeriod(1, view()); commit(); render('results-step'); });
  // The month on show is not part of the link: a day selects, a month only browses.
  $('#prevMonth').addEventListener('click', () => { showMonth(-1); render('results-month'); });
  $('#nextMonth').addEventListener('click', () => { showMonth(1); render('results-month'); });
  let sheetFrom = null;
  $('#cal').addEventListener('click', e => {
    const c = e.target.closest('[data-day]');
    if (!c || c.disabled) return;
    const v = view();
    if (!selectDay(c.dataset.day, v)) return;
    commit();
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
  // the entry left keeps the place the page still shows; show what the
  // address says, where the reader last was on it (a new entry: its top).
  // Back and Forward fire both events; the second finds the entry taken up.
  const follow = () => {
    const moved = places.step(), next = parseRoute(location.hash);
    if (freeze.frozen()) { queuedRoute = { ...next, scroll: places.saved() }; return; }
    if (!moved && next.known && !next.anchor && sameRoute(next, shown)) return;
    go(next.screen, { anchor: next.anchor, query: next.query, scroll: places.saved() });
  };
  addEventListener('popstate', follow);
  addEventListener('hashchange', follow);
  let resize = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(() => { forgetCharts(); forgetResults(); dirtyHistory = true; render('resize'); }); });
  // With System chosen the page follows the OS live (CSS); the header button's words follow too.
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!boardSession.signedOut()) { syncThemeButton(); schedule('theme'); } });

  // Numbers never part from their units, in static and rendered text alike.
  const fixUnits = (node, phone) => {
    if (node.nodeType === 3) {
      let fixed = joinUnits(node.nodeValue, { joinDot: phone });
      // A separator may start the next inline element (the exact-key line).
      if (phone && / $/.test(fixed) && node.nextSibling?.textContent?.startsWith('·')) fixed = fixed.slice(0, -1) + NB;
      if (fixed !== node.nodeValue) node.nodeValue = fixed;
      return;
    }
    if (node.nodeType !== 1) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) fixUnits(t, phone);
  };
  // A synchronous delivery has one viewport, including a large positions patch.
  new MutationObserver(list => { const phone = isPhone(); for (const m of list) { if (m.type === 'characterData') fixUnits(m.target, phone); else m.addedNodes.forEach(node => fixUnits(node, phone)); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  fixUnits(document.body, isPhone());

  syncThemeButton();
  initSettings({ feed, tips, schedule });
  initVersionDisplay();
  $('#footShield').innerHTML = `${icon('shield')}Read-only paper board · nothing here can place a trade`;
  // go() puts each screen back where the reader left it; the browser need not.
  try { history.scrollRestoration = 'manual'; } catch { /* go() still scrolls */ }
  // A reload returns to the entry's place once the page has grown to it.
  places.step();
  const first = parseRoute(location.hash || '#desk');
  go(first.screen, { anchor: first.anchor, query: first.query, scroll: places.saved() });
  boardSession.coordinateRecovery(async () => {
    await Promise.all([feed.whenIdle(), accountHistoryIdle()]);
    await Promise.all([feed.refresh(), feed.refreshActions(), refreshAccountHistory(), refreshBoardSettings()]);
    boardSession.finishRecovery(() => {
      recoveringRender = true;
      try {
        syncThemeButton();
        forgetCharts(); forgetResults(); dirtyHistory = true;
        const route = queuedRoute; queuedRoute = null;
        return route ? go(route.screen, route) : render('recovery');
      } finally { recoveringRender = false; }
    });
  });
  feed.start();
}
