// Black-box signed-out oracle on the actual app, in one headless browser.
// CI/agm2: TZ=UTC node scripts/browser/signed-out-pages.mjs
import assert from 'node:assert/strict';
import { authShapes, reasons, widths, screens, pageFixture, dirtyPreview, renderedSnapshot, assertSignedOutPage, blame } from '../../test/fixtures/signed-out-cases.mjs';
import { launch, openPage } from './cdp.mjs';
import { configure, waitFor } from './shots.mjs';
import { startBoard, ACTOR } from './board.mjs';

const f = pageFixture();
const board = await startBoard({ fleetConfig: f['fleet-config'], history: f.history });
board.setNow(f.data.receivedAt);
let browser;
const failures = [], checks = [];
try {
  browser = await launch({ commandTimeout: 30000 });
  const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
  // Restrict all traffic to this synthetic loopback board. No live accounts,
  // external SSO navigation, writes, or real product data are involved.
  let signedOut = false, shape = '401', reason = null;
  const statePanels = () => Object.fromEntries(Object.entries(f.data.desks.reduce((all, desk) => ({ ...all,
    ...Object.fromEntries(['equity', 'dayPnl', 'openPnl', 'totalPnl'].map(key => [`desks.${desk.id}.${key}`, { value: desk.money[key] }])) }), {}))
    .map(([key, cell]) => [key, { ...cell, state: 'broken', reason, retained: false, ageSeconds: 125 }]));
  browser.on(async m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    const { requestId, request } = m.params, url = new URL(request.url);
    const send = (code, payload, headers = []) => browser.send('Fetch.fulfillRequest', { requestId, responseCode: code,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Joe-Received-At', value: f.data.receivedAt },
        ...(reason ? [{ name: 'X-Joe-Feed-Reason', value: reason }] : []), ...headers], body: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)).toString('base64') }, m.sessionId);
    try {
      if (url.origin !== new URL(board.url).origin || request.method !== 'GET') {
        failures.push('unexpected external request or write');
        await browser.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, m.sessionId); return;
      }
      const path = url.pathname.slice('/joe/'.length);
      const isFeed = ['state.json', 'history.json', 'history-continuity.json', 'results.json', 'fleet-config.json', 'fleet-config/actions.json', 'board-settings.json', 'account-history.json', 'account-closes.json'].includes(path);
      if (!isFeed) { await browser.send('Fetch.continueRequest', { requestId }, m.sessionId); return; }
      if (signedOut) {
        if (shape === '302 to SSO') await send(302, '', [{ name: 'Location', value: 'https://sso.example.invalid/sign_in' }]);
        else if (shape === 'HTML body') await send(200, '<!doctype html><html><body>Sign in</body></html>');
        else await send(shape === '403' ? 403 : 401, '{}');
        return;
      }
      const value = path === 'state.json' ? { serverNow: f.data.receivedAt, feeds: { data: { value: f.data, reason } }, panels: reason ? statePanels() : {} }
        : path === 'history.json' ? f.history : path === 'results.json' ? f.results : path === 'fleet-config.json' ? f['fleet-config']
        : path === 'board-settings.json' ? { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null }
        : path === 'fleet-config/actions.json' ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] } : null;
      if (value) await send(200, value); else await browser.send('Fetch.continueRequest', { requestId }, m.sessionId);
    } catch (error) { failures.push(`interception: ${error.message}`); }
  });
  await page.setFetch([{ urlPattern: '*' }]);
  const setup = `if (location.origin === ${JSON.stringify(new URL(board.url).origin)}) { localStorage.clear(); localStorage.setItem('joe-fleet-config-preview-v1', ${JSON.stringify(dirtyPreview(f['fleet-config']))});
    localStorage.setItem('joe-board-observed-events-v1', JSON.stringify({ schema: 'inspr.joe.observed-events.v1', events: [{ deskId: 'j', kind: 'issues', summary: ${JSON.stringify(blame)}, snapshotAt: ${JSON.stringify(f.data.generatedAt)}, sourceLabel: ${JSON.stringify(blame)} }] }));
    const nativeFetch = window.fetch; window.fetch = (...args) => window.__opaqueAuth && String(args[0]).includes('state.json') ? Promise.resolve({ type: 'opaqueredirect', status: 0 }) : nativeFetch(...args); }`;
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  const visible = `n => Boolean(n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')`;
  const capture = () => page.evaluate(`(${renderedSnapshot.toString()})(document, ${visible})`);
  const go = async screen => {
    await page.evaluate(`location.hash = '#${screen}'`);
    await waitFor(page, `document.body.dataset.screen === ${JSON.stringify(screen)}`);
    if (screen === 'desk') await page.evaluate(`for (const button of document.querySelectorAll('[data-desk-disclosure][aria-expanded="false"]')) button.click(); if (document.getElementById('acctDetailsBtn').getAttribute('aria-expanded') === 'false') document.getElementById('acctDetailsBtn').click();`);
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  // Virtual time advances the actual page timers/monotonic feed clock by two
  // seconds per snapshot pair, without spending 12+ wall minutes on sleeps.
  const advance = async () => {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const on = m => { if (m.method === 'Emulation.virtualTimeBudgetExpired') finish(); };
    browser.on(on);
    let timer;
    try {
      await page.s('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 2000 });
      await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('virtual time did not advance')), 10000); })]);
    } finally { clearTimeout(timer); browser.off(on); }
    await page.s('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending' });
  };
  for (const width of widths) for (const auth of authShapes) {
    shape = auth;
    await configure(page, { name: String(width), width, height: 1000, mobile: width === 390 }, 'light');
    for (const failureReason of [null, ...reasons]) {
      signedOut = false; reason = null;
      await page.s('Page.navigate', { url: 'about:blank' });
      await waitFor(page, "location.href === 'about:blank'");
      await page.s('Page.navigate', { url: board.url });
      await waitFor(page, "document.documentElement.dataset.ready === '1'");
      // Exercise the actual feed/selector failure fixture before sign-out.
      reason = failureReason;
      await page.evaluate('window.__joedesk.refresh()');
      const before = {};
      for (const screen of screens) { await go(screen); before[screen] = await capture(); }
      // Expire through the actual transport, never a presentation flag.
      signedOut = true;
      if (auth === 'opaqueredirect') await page.evaluate('window.__opaqueAuth = true');
      await page.evaluate('window.__joedesk.refresh()');
      await waitFor(page, "document.getElementById('hdrHealth').dataset.reason === 'signed-out'");
      for (const screen of screens) {
        const tag = `${width}/${auth}/${failureReason}/${screen}`;
        await go(screen);
        const after = await capture();
        try {
          assertSignedOutPage(after, before[screen], tag);
          await advance();
          assert.deepEqual(await capture(), after, `${tag}: stable after two seconds`);
          checks.push(tag);
        } catch (error) { failures.push(error.message); console.error(error.message); }
      }
      assert.deepEqual(page.errors, [], 'no render errors');
      if (failures.length) throw new Error('Rendered browser oracle failed; see failures above');
    }
    console.log(`signed-out pages: ${width}px / ${auth}: ${reasons.length} reasons + warm values × ${screens.length} pages checked`);
  }
} finally {
  if (browser) await browser.close();
  await board.close();
}
for (const failure of failures) console.error(failure);
console.log(`${checks.length}/${widths.length * authShapes.length * (reasons.length + 1) * screens.length} signed-out browser cases passed; browser and fixture server closed`);
if (failures.length) process.exitCode = 1;
