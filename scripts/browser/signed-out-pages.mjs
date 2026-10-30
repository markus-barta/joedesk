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
  let expired = false, fail503 = false, shape = '401', reason = null, only = null;
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
      if (url.origin !== new URL(board.url).origin || request.method !== 'GET') {
        failures.push('unexpected external request or write');
        await browser.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, m.sessionId); return;
      }
      const path = url.pathname.slice('/joe/'.length);
      if (!endpoints.includes(path)) { await browser.send('Fetch.continueRequest', { requestId }, m.sessionId); return; }
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
        : path === 'board-settings.json' ? { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null }
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
  const capture = () => page.evaluate(`(${retainedDocument.toString()})(document)`);
  const recover = async () => {
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
    fail503 = true; stage = `${tag}: 503 and timers`;
    await advance();
    assertSignedOutPage(await capture(), before, `${tag}/503 and paused timers`);
    const timers = await page.evaluate(`Array.from(document.querySelectorAll('[data-age]')).filter(n => n.getClientRects().length).every(n => getComputedStyle(n, '::after').content.includes('last known'))`);
    assert.equal(timers, true, `${tag}: paused ages show their frozen value plus last known`);
    stage = `${tag}: recovery`;
    await recover();
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
