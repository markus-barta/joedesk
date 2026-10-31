// The actual app, native page/worker transports, one owned headless browser.
import assert from 'node:assert/strict';
import { authShapes, reasons, widths, screens, pageFixture, dirtyPreview, retainedDocument, assertSignedOutPage, blame } from '../../test/fixtures/signed-out-cases.mjs';
import { history as accountHistory } from '../../test/fixtures/account-fixtures.mjs';
import { launch, openPage } from './cdp.mjs';
import { configure, waitFor } from './shots.mjs';
import { startBoard, ACTOR } from './board.mjs';

const f = pageFixture(), account = accountHistory();
const board = await startBoard({ fleetConfig: f['fleet-config'], history: f.history });
board.setNow(f.data.receivedAt);
let browser, checked = 0, stage = 'launch';
const failures = [], visited = new Set();
const endpoints = ['state.json', 'history.json', 'history-continuity.json', 'results.json', 'fleet-config.json', 'fleet-config/actions.json', 'board-settings.json', 'account-history.json'];
try {
  browser = await launch({ commandTimeout: 30000 });
  const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
  let expired = false, fail503 = false, shape = '401', reason = null, only = null, fleetPaused = null, settingsPaused = null, nonAuthOnly = null;
  let settingsValue = { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null };
  const panels = () => Object.fromEntries(f.data.desks.flatMap(desk => ['equity', 'dayPnl', 'openPnl', 'totalPnl'].map(key =>
    [`desks.${desk.id}.${key}`, { value: desk.money[key], state: 'broken', reason, retained: false, ageSeconds: 125 }])));
  browser.on(async m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    const { requestId, request } = m.params, url = new URL(request.url);
    const send = (code, payload, headers = []) => browser.send('Fetch.fulfillRequest', { requestId, responseCode: code,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Joe-Received-At', value: f.data.receivedAt },
        ...(reason ? [{ name: 'X-Joe-Feed-Reason', value: reason }] : []), ...headers],
      body: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)).toString('base64') }, m.sessionId);
    try {
      if (url.origin === new URL(board.url).origin && request.method === 'POST' && url.pathname === '/joe/fleet-config/propagate' && fleetPaused) {
        fleetPaused(send); fleetPaused = null; return;
      }
      if (url.origin === new URL(board.url).origin && request.method === 'POST' && url.pathname === '/joe/board-settings.json' && settingsPaused) {
        settingsValue = { ...JSON.parse(request.postData), reason: null };
        settingsPaused(send); settingsPaused = null; return;
      }
      if (url.origin !== new URL(board.url).origin || request.method !== 'GET') {
        failures.push('unexpected external request or write');
        await browser.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, m.sessionId); return;
      }
      const path = url.pathname.slice('/joe/'.length);
      if (!endpoints.includes(path)) { await browser.send('Fetch.continueRequest', { requestId }, m.sessionId); return; }
      if (path === nonAuthOnly) { await send(503, '{}'); return; }
      if (fail503) { await send(503, '{}'); return; }
      if (expired && (!only || only === path)) {
        visited.add(`${shape}/${path}`);
        // Manual 302/303 redirects are native opaqueredirect responses on
        // both page and worker fetches, independently for each endpoint.
        if (['302 to SSO', '303 to SSO', 'opaqueredirect'].includes(shape))
          await send(shape === '303 to SSO' ? 303 : 302, '', [{ name: 'Location', value: 'https://sso.example.invalid/sign_in' }]);
        else if (shape.startsWith('HTML')) await send(200, shape === 'HTML fragment' ? '<form>Sign in</form>' : '<!doctype html><html><body>Sign in</body></html>',
          shape === 'HTML content type' ? [{ name: 'Content-Type', value: 'text/html' }] : []);
        else await send(Number(shape), '{}');
        return;
      }
      const value = path === 'state.json' ? { serverNow: f.data.receivedAt, feeds: { data: { value: f.data, reason } }, panels: reason ? panels() : {} }
        : path === 'history.json' ? f.history : path === 'results.json' ? f.results : path === 'fleet-config.json' ? f['fleet-config']
        : path === 'board-settings.json' ? settingsValue
        : path === 'account-history.json' ? account
        : path === 'fleet-config/actions.json' ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] } : {};
      await send(200, value);
    } catch (error) { failures.push(`interception: ${error.message}`); }
  });
  await page.setFetch([{ urlPattern: '*' }], { strict: true });
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(new URL(board.url).origin)}) {
    // A controlled monotonic clock lets the real registered timer callbacks
    // cross minute boundaries without suspending native worker event loops.
    window.__boardTime = 0; window.__boardIntervals = new Map();
    Object.defineProperty(performance, 'now', { value: () => window.__boardTime });
    let intervalId = 0;
    window.setInterval = (fn, ms, ...args) => { const id = ++intervalId; window.__boardIntervals.set(id, () => fn(...args)); return id; };
    window.clearInterval = id => window.__boardIntervals.delete(id);
    localStorage.clear(); localStorage.setItem('joe-fleet-config-preview-v1', ${JSON.stringify(dirtyPreview(f['fleet-config']))});
    localStorage.setItem('joe-board-observed-events-v1', JSON.stringify({ schema: 'inspr.joe.observed-events.v1', events: [{ deskId: 'j', kind: 'issues', summary: ${JSON.stringify(blame)}, snapshotAt: ${JSON.stringify(f.data.generatedAt)}, sourceLabel: ${JSON.stringify(blame)} }] })); }` });
  const settle = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const refresh = () => page.evaluate(`Promise.all([window.__joedesk.refresh(), import('/joe/board-settings.js').then(m => m.refreshBoardSettings()), import('/joe/account.js').then(m => m.refreshAccountHistory())])`);
  const frozenVisuals = async tag => {
    const view = await page.evaluate(`(() => {
      const app = document.getElementById('app');
      const sections = [...app.querySelectorAll('[data-frozen]')].filter(n => n.getClientRects().length);
      const values = [...app.querySelectorAll('.bn, .acct-value, .v, .chart, .num, .cash-amount')].filter(n => n.getClientRects().length);
      const button = document.querySelector('[data-sign-in-reload]');
      button.focus(); const r = button.getBoundingClientRect();
      return { sections: sections.length, labels: sections.every(n => getComputedStyle(n, '::before').content.includes('Stale')),
        muted: values.every(n => Number(getComputedStyle(n).opacity) < 1 || Boolean(n.closest('.chart, .acct-value, .acct-change, .bars'))),
        headers: [...app.querySelectorAll('.sec-h, .sec-head, .scr-h, .desk-disclosure')].filter(n => n.getClientRects().length).every(n => n.closest('[data-frozen]') && getComputedStyle(n, '::before').content.includes('Stale')),
        collapsed: [...app.querySelectorAll('[data-desk-disclosure="positions"], [data-desk-disclosure="kept"]')].filter(n => n.getClientRects().length && n.getAttribute('aria-expanded') === 'false').every(n => n.hasAttribute('data-frozen') && getComputedStyle(n, '::before').content.includes('Stale')),
        desaturated: getComputedStyle(app).filter.includes('grayscale(1)'),
        animations: [...app.querySelectorAll('*')].some(n => getComputedStyle(n).animationName !== 'none'),
        reload: document.activeElement === button && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    })()`);
    assert.ok(view.sections && view.labels && view.headers && view.collapsed && view.muted && view.desaturated && !view.animations && view.reload, `${tag}: frozen visual guard ${JSON.stringify(view)}`);
  };
  const interact = () => page.evaluate(`(() => {
    for (const node of document.querySelectorAll('#acctChart, #histChart, #heroChart, #curve')) {
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150 })); node.focus();
      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 80 }));
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
    document.getElementById('healthPop').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    document.getElementById('acctCtl').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('[data-sign-in-reload]') }));
  })()`);
  const capture = () => page.evaluate(`(${retainedDocument.toString()})(document)`);
  const idleRecovery = () => page.evaluate(`(async () => { const { boardSession } = await import('/joe/transport.js'); for (let i = 0; boardSession.recovering(); i++) { if (i > 10000) throw new Error('Recovery did not finish'); await new Promise(done => setTimeout(done, 0)); } })()`);
  const recover = async () => {
    await idleRecovery();
    expired = fail503 = false;
    await refresh();
    await waitFor(page, "!document.getElementById('app').hasAttribute('data-last-known')");
    await settle();
  };
  const go = async screen => {
    await page.evaluate(`location.hash = '#${screen}'`);
    await waitFor(page, `document.body.dataset.screen === ${JSON.stringify(screen)}`);
    if (screen === 'desk') await page.evaluate(`for (const button of document.querySelectorAll('[data-desk-disclosure][aria-expanded="false"]')) button.click(); if (document.getElementById('acctDetailsBtn').getAttribute('aria-expanded') === 'false') document.getElementById('acctDetailsBtn').click();`);
    await settle();
  };
  const advance = async (ms = 125000) => {
    await page.evaluate(`window.__boardTime += ${ms}; for (const tick of window.__boardIntervals.values()) tick();`);
    await refresh(); await settle();
  };
  const check = async (screen, tag) => {
    await go(screen);
    // Clock time is stable until advance() invokes the real page timers.
    const before = await capture();
    expired = true; stage = `${tag}: expire`;
    // Expire one actual protected read first. Successful sibling reads must
    // not create a newer good render between the baseline and the failure.
    const endpoint = only ?? 'board-settings.json';
    const readName = { 'state.json': 'state', 'history.json': 'history', 'history-continuity.json': 'history', 'results.json': 'results', 'fleet-config.json': 'fleet', 'fleet-config/actions.json': 'actions' }[endpoint];
    if (readName) await page.evaluate(`window.__joedesk.refresh(${JSON.stringify(readName)})`);
    else if (endpoint === 'account-history.json') await page.evaluate('window.__joedesk.refreshAccount()');
    else await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
    await refresh();
    assertSignedOutPage(await capture(), before, tag);
    await frozenVisuals(tag);
    await interact();
    assertSignedOutPage(await capture(), before, `${tag}/interactions`);
    fail503 = true; stage = `${tag}: 503 and timers`;
    await advance();
    assertSignedOutPage(await capture(), before, `${tag}/503 and paused timers`);
    const timers = await page.evaluate(`Array.from(document.querySelectorAll('[data-age]')).filter(n => n.getClientRects().length).every(n => getComputedStyle(n, '::after').content.includes('last known'))`);
    assert.equal(timers, true, `${tag}: paused ages show their frozen value plus last known`);
    stage = `${tag}: recovery`;
    const retainedReason = reason;
    if (reason) {
      expired = fail503 = false;
      await refresh(); await idleRecovery();
      assertSignedOutPage(await capture(), before, `${tag}/failed authenticated attempt cannot recover`);
      // A failure-bearing last-good document is not a recovery success.
      // First obtain clean worker documents, then restore the ordinary fault.
      reason = null;
    }
    await recover();
    reason = retainedReason;
    const count = await page.evaluate('window.__joedesk.renders');
    await refresh(); await settle();
    assert.ok(await page.evaluate(`window.__joedesk.renders > ${count}`), `${tag}: recovery resumes renders`);
    assert.deepEqual(page.errors, [], `${tag}: no render errors`);
    assert.deepEqual(failures, [], 'no routing errors');
    checked++;
    if (checked % 100 === 0) console.log(`${checked} complete DOM comparisons passed`);
  };
  // A followed cross-origin redirect is a defensive transport-only shape:
  // native fetch with redirect:manual cannot produce it. Unit tests cover it.
  const nativeShapes = authShapes.filter(s => s !== 'followed cross-origin redirect');
  for (const width of widths) {
    await configure(page, { name: String(width), width, height: 1000, mobile: width === 390 }, 'light');
    stage = `${width}: initial navigation`;
    await page.s('Page.navigate', { url: board.url });
    await waitFor(page, "document.documentElement.dataset.ready === '1'");
    await refresh(); await settle();
    await page.evaluate('document.fonts.ready.then(() => true)');
    stage = `${width}: every feed gates recovery`;
    await go('desk');
    if (width === 390) {
      await page.evaluate(`for (const b of document.querySelectorAll('[data-desk-disclosure="positions"], [data-desk-disclosure="kept"]')) if (b.getAttribute('aria-expanded') === 'true') b.click();`);
      assert.deepEqual(await page.evaluate(`['positions', 'kept'].map(id => document.querySelector('[data-desk-disclosure="' + id + '"]').getAttribute('aria-expanded'))`), ['false', 'false']);
    }
    for (const endpoint of endpoints) {
      stage = `${width}: one feed still 401: ${endpoint}`;
      only = null; expired = true;
      await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
      only = endpoint;
      await refresh(); await idleRecovery(); await settle();
      assert.equal((await capture()).marked, true, `${endpoint} still 401 must keep all frozen marks`);
      await frozenVisuals(stage);
      await recover(); only = null;
    }
    console.log(`fix6: ${width}px collapsed headers and all eight recovery gates passed`);
    stage = `${width}: later non-auth account-history failure shows its honest reason`;
    only = null; expired = true;
    await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
    only = 'state.json'; await refresh(); await idleRecovery();
    nonAuthOnly = 'account-history.json';
    await recover();
    assert.match(await page.evaluate(`document.getElementById('acctNote').textContent`), /could not|refresh|failed|update/i);
    nonAuthOnly = only = null; await refresh(); await settle();
    for (const pendingCopy of [false, true]) {
      stage = `${width}: version copy at freeze, pending=${pendingCopy}`;
      await page.evaluate(`window.__clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => ${pendingCopy ? "new Promise((_, reject) => { window.__lateClipboard = reject; })" : "Promise.resolve()"} } }); document.querySelector('[data-product-version]').click();`);
      await settle();
      expired = true; await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
      const copyFrozen = await capture();
      if (pendingCopy) await page.evaluate(`window.__lateClipboard(new Error('clipboard failed after sign-out'))`);
      await page.evaluate(`new Promise(done => setTimeout(done, 2100))`); await settle();
      assert.deepEqual(await capture(), copyFrozen, 'version confirmation timers and clipboard promises cannot mutate the freeze');
      assert.equal(await page.evaluate(`document.querySelector('[data-product-version]').hasAttribute('data-copy-state')`), false);
      await page.evaluate(`if (window.__clipboardBefore) Object.defineProperty(navigator, 'clipboard', window.__clipboardBefore); else delete navigator.clipboard; delete window.__clipboardBefore;`);
      await recover();
    }
    stage = `${width}: abandoned account-start save refetches before delayed POST`;
    await go('settings');
    await page.evaluate(`document.getElementById('accountStartEdit').click(); document.getElementById('accountStartAmount').value = '200000'; document.getElementById('accountStartDate').value = '2026-01-01'; document.getElementById('accountStartReview').click(); document.getElementById('accountStartConfirmed').click();`);
    const posted = new Promise(done => { settingsPaused = done; });
    await page.evaluate(`document.getElementById('accountStartSave').click()`);
    const completeSave = await posted;
    expired = true; await page.evaluate(`window.__joedesk.refresh('state')`);
    await recover();
    assert.match(await page.evaluate(`document.getElementById('accountStartSummary').textContent`), /200[.]000/);
    const afterRead = await capture();
    await completeSave(200, { ok: true, ...settingsValue });
    await settle();
    assert.deepEqual(await capture(), afterRead, 'abandoned save has no late success or error UI');
    settingsValue = { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null };
    await refresh(); await settle();
    // Confirm the native modal/top-layer and long-press reproducers before
    // the matrix; snapshots after expiry retain every data/form property.
    if (width === 390) {
      stage = 'phone: pre-expiry account long press'; await go('desk');
      const touch = await page.evaluate(`(() => { const chart = document.getElementById('acctChart'); chart.scrollIntoView({ block: 'center' }); const r = chart.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 7 }] });
      expired = true; await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
      const pending = await capture();
      await page.evaluate('new Promise(done => setTimeout(done, 450))');
      await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual(await capture(), pending, 'pre-expiry touch timer and release cannot mutate the frozen chart');
      await recover();
    }
    stage = `${width}: native modal and controls`;
    await go('desk');
    await page.evaluate(`document.getElementById('acctCtl').click(); document.getElementById('diffDlg').showModal();`);
    expired = true; await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
    await frozenVisuals(stage);
    const closed = await capture(); await interact(); await settle();
    assert.deepEqual(await capture(), closed, 'closing a native modal/Controls once leaves an inert document');
    await recover();
    // Account-only expiry must recover through normal polling; no explicit
    // account-history retry from the audit is allowed in this reproducer.
    stage = `${width}: account-only automatic recovery`;
    only = 'account-history.json'; expired = true;
    await page.evaluate('window.__joedesk.refreshAccount()');
    assert.equal((await capture()).inert, true);
    expired = false;
    await page.evaluate('window.__boardTime += 15001; for (const tick of window.__boardIntervals.values()) tick();');
    await waitFor(page, "!document.getElementById('app').hasAttribute('data-last-known')");
    only = null; await settle();
    // Observe the exact unmark operation, not only the eventual page. At
    // that operation the newly served account figure must already be in DOM.
    stage = `${width}: recovery render precedes unmark`;
    await go('desk'); expired = true;
    await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
    const amount = f.data.brokerAccount.equity.amount;
    f.data.brokerAccount.equity.amount = '29001'; f.data.seq++;
    await page.evaluate(`window.__unmarkValues = []; window.__originalRemove = Element.prototype.removeAttribute;
      Element.prototype.removeAttribute = function(key) {
        if (this.id === 'app' && key === 'data-last-known') window.__unmarkValues.push({ value: document.getElementById('acctValue').textContent, marked: this.hasAttribute('data-last-known') && this.hasAttribute('inert'), sectionMarks: document.querySelectorAll('[data-frozen]').length });
        return window.__originalRemove.call(this, key);
      };`);
    await recover();
    assert.deepEqual(await page.evaluate('window.__unmarkValues.map(s => s.value.replace(/\\s/g, ""))'), ['€29.001,00']);
    assert.equal(await page.evaluate('window.__unmarkValues.every(s => s.marked && s.sectionMarks > 0)'), true, 'fresh document renders while still frozen and marked');
    await page.evaluate('Element.prototype.removeAttribute = window.__originalRemove; delete window.__originalRemove;');
    f.data.brokerAccount.equity.amount = amount; f.data.seq++;
    await refresh(); await settle();
    stage = `${width}: latest frozen address`;
    expired = true; await page.evaluate(`import('/joe/board-settings.js').then(m => m.refreshBoardSettings())`);
    await page.evaluate(`location.hash = '#history';`); await settle();
    await page.evaluate(`location.hash = '#results';`); await settle();
    await recover();
    assert.equal(await page.evaluate('document.body.dataset.screen'), 'results');
    if (width > 700) for (const auth of ['401', 'opaque redirect', 'HTML']) {
      stage = `fleet submission/${auth}`; await go('settings');
      await page.evaluate(`document.getElementById('reviewBtn').click(); document.getElementById('diffReviewed').click(); document.getElementById('diffConfirm').click();`);
      assert.equal(await page.evaluate('document.getElementById("sendBtn").disabled'), false);
      const paused = new Promise(done => { fleetPaused = done; });
      await page.evaluate('document.getElementById("sendBtn").click()');
      const send = await paused, sending = await capture();
      if (auth === '401') await send(401, '{}');
      else if (auth === 'HTML') await send(200, '<form>Sign in</form>');
      else await send(302, '', [{ name: 'Location', value: 'https://sso.example.invalid/sign_in' }]);
      await waitFor(page, "document.getElementById('app').hasAttribute('data-last-known')");
      assertSignedOutPage(await capture(), sending, stage);
      await recover();
    }
    for (const auth of nativeShapes) {
      shape = auth; only = null;
      for (const failureReason of [null, ...reasons]) {
        reason = failureReason; await refresh(); await settle();
        for (const screen of screens) await check(screen, `${width}/${auth}/${failureReason}/${screen}`);
      }
      console.log(`signed-out DOM: ${width}px / ${auth}: all ${reasons.length} reasons + warm values, all pages, 503, timer freeze, minute-boundary checks and recovery`);
    }
    // Opaque redirects in isolation on every transport (including real
    // history/results/account workers and the continuity sidecar).
    shape = 'opaqueredirect'; reason = null;
    for (const endpoint of endpoints) { only = endpoint; for (const screen of screens) await check(screen, `${width}/opaque-only/${endpoint}/${screen}`); }
  }
  for (const auth of nativeShapes) for (const endpoint of endpoints) assert.ok(visited.has(`${auth}/${endpoint}`), `${auth}/${endpoint}: actual auth response exercised`);
  console.log(`${checked} signed-out browser cases passed; all native auth shapes exercised on every transport`);
} catch (error) {
  console.error(`Failed at ${stage}`); throw error;
} finally {
  if (browser) await browser.close();
  await board.close();
  console.log('Owned browser and synthetic fixture server closed');
}
