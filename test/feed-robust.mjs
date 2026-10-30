import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
const { createFeed } = await import('../public/joe/feed.js');
const { statusPresentation } = await import('../public/joe/health.js');
const { readJSON, createBoardSession, boardSession } = await import('../public/joe/transport.js');
const { brokerState, boardDiagnostics } = await import('../public/joe/health.js');
const { statePhrase } = await import('../public/joe/ui.js');
const { headerHealth, healthPop, heroLeft, boardCaptionCell, sharedSectionPhrase, cellView } = await import('../public/joe/desk.js');
const { cardCaption } = await builders('desk.js', ['cardCaption']);
const { createBoardSettings } = await import('../public/joe/board-settings-write.js');
const { history: accountHistory } = await import('./fixtures/account-fixtures.mjs');

function property(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
}

const fixture = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const stamp = fixture.data.receivedAt;
// Layout reserves contain off-screen example captions, never reader copy.
const readerDocument = html => htmlDocument(html.replace(/<span class="cash-sizing"[^>]*>[\s\S]*?<\/span>/g, ''));
const turn = () => new Promise(resolve => setImmediate(resolve));
const payloadFor = url => url.includes('state.json') ? { serverNow: stamp, feeds: { data: { value: fixture.data } }, panels: {} }
  : url.includes('actions.json') ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] }
    : url.includes('fleet-config') ? fixture['fleet-config'] : url.includes('history.json') ? fixture.history : fixture.results;
function reply(url, headers = { 'X-Joe-Server-Now': stamp }) {
  return { status: 200, ok: true, headers: new Headers({ ...headers, 'X-Joe-Received-At': stamp, ETag: '"fixture"' }),
    json: async () => payloadFor(String(url)) };
}
function scheduler(t) {
  const deadlines = new Map(), intervals = new Map();
  let next = 0, perf = 0;
  t.mock.method(globalThis.performance, 'now', () => perf);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { const id = ++next; deadlines.set(id, { fn, ms }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => deadlines.delete(id));
  t.mock.method(globalThis, 'setInterval', (fn, ms) => { const id = ++next; intervals.set(id, { fn, ms }); return id; });
  t.mock.method(globalThis, 'clearInterval', id => intervals.delete(id));
  return { deadlines, intervals, advance(ms) { perf += ms; },
    expire() { for (const [id, { fn, ms }] of [...deadlines]) { assert.equal(ms, 15000); deadlines.delete(id); fn(); } } };
}

for (const route of ['state.json', 'history.json', 'results.json', 'fleet-config.json', 'fleet-config/actions.json']) {
  test(`JOED-130 header clock includes delayed ${route} body consumption`, async t => {
    const clock = scheduler(t);
    property(t, 'Worker', undefined);
    t.mock.method(globalThis, 'fetch', async url => {
      if (!String(url).endsWith(route)) return { status: 503, ok: false, headers: new Headers(), json: async () => ({}) };
      const res = reply(url);
      res.json = async () => { clock.advance(240000); return payloadFor(String(url)); };
      return res;
    });
    const feed = createFeed(() => {});
    await (route.includes('actions') ? feed.refreshActions() : feed.refresh());
    assert.equal(feed.now(), new Date(Date.parse(stamp) + 240000).toISOString());
    if (route === 'state.json') {
      assert.equal(feed.select().states['today.equity'].ageSeconds, 240);
      assert.equal(statusPresentation(feed.select()).sentence, 'Board updates stopped');
      assert.equal(statusPresentation(feed.select()).tone, 'red');
    }
    assert.equal(clock.deadlines.size, 0, 'successful reads clear their deadline');
  });
}

for (const phase of ['fetch', 'body']) test(`JOED-130 page ${phase} deadlines release all reads and allow polling recovery`, async t => {
  const clock = scheduler(t), calls = [];
  property(t, 'Worker', undefined);
  let hanging = true;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), signal: init.signal });
    if (!hanging) return reply(url);
    if (phase === 'fetch') return new Promise(() => {});
    return { ...reply(url), json: () => new Promise(() => {}) };
  });
  const feed = createFeed(() => {}, () => {}, '', { actionsWanted: () => true });
  feed.start();
  t.after(() => feed.stop());
  const actions = feed.refreshActions();
  await turn();
  let refreshed = false, actionsFinished = false;
  const refresh = feed.refresh().then(() => { refreshed = true; });
  const concurrentActions = feed.refreshActions().then(() => { actionsFinished = true; });
  await turn();
  assert.equal(refreshed, false, 'overlapping refresh waits for the active attempts');
  assert.equal(actionsFinished, false);
  assert.equal(calls.length, 6, 'one attempt per feed and the continuity sidecar, including state from manual refresh');
  assert.ok(calls.every(call => call.signal instanceof AbortSignal), 'every read supplies an abort signal');
  clock.expire();
  await turn();
  // start() chains its first state read after fleet; let that bounded attempt fail too.
  clock.expire();
  await turn();
  await Promise.all([refresh, actions, concurrentActions]);
  assert.ok(calls.every(call => call.signal.aborted), 'fetch and body attempts are aborted');
  assert.ok(feed.settled(), 'cold failures settle readiness with a reason');
  for (const value of Object.values(feed.feeds)) assert.equal(value.reason, 'refresh_failed');
  assert.equal(feed.select().actions.reason, 'refresh_failed');
  assert.equal(clock.deadlines.size, 0);
  hanging = false;
  for (const { fn, ms } of clock.intervals.values()) if (ms !== 1000) fn();
  await feed.refresh();
  await feed.refreshActions();
  assert.ok(feed.feeds.data.value);
  for (const value of Object.values(feed.feeds)) assert.equal(value.reason, null);
  assert.equal(feed.select().actions.reason, null);
  assert.equal(clock.deadlines.size, 0);
});

for (const phase of ['fetch', 'body']) test(`JOED-130 actual worker ${phase} deadline completes page refresh and retries`, async t => {
  const clock = scheduler(t), calls = [], messages = [];
  let worker, hanging = true;
  property(t, 'self', { postMessage(data) { messages.push(data); worker.onmessage({ data }); } });
  await import(`../public/joe/history-worker.js?joed130-${phase}`);
  const handle = self.onmessage;
  property(t, 'Worker', class {
    constructor() { worker = this; }
    postMessage(data) { handle({ data }); }
  });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).startsWith('./')) return reply(url);
    calls.push({ url: String(url), signal: init.signal });
    if (!hanging) return reply(url);
    if (phase === 'fetch') return new Promise(() => {});
    return { ...reply(url), json: () => new Promise(() => {}) };
  });
  const feed = createFeed(() => {});
  let finished = false;
  const pending = feed.refresh().then(() => { finished = true; });
  const overlap = feed.refresh();
  await turn();
  assert.equal(finished, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.signal instanceof AbortSignal));
  clock.expire();
  await Promise.all([pending, overlap]);
  assert.ok(calls.every(call => call.signal.aborted));
  assert.equal(feed.feeds.history.reason, 'refresh_failed');
  assert.equal(feed.feeds.results.reason, 'refresh_failed');
  assert.ok(feed.settled());
  hanging = false;
  await feed.refresh();
  assert.ok(feed.feeds.history.value);
  assert.ok(feed.feeds.results.value);
  assert.equal(feed.feeds.history.reason, null);
  assert.equal(feed.feeds.results.reason, null);
  assert.equal(messages.length, 4);
  assert.equal(clock.deadlines.size, 0);
});

test('JOED-130 a delayed state body never rewinds a warm clock or freshens its receipt', async t => {
  const clock = scheduler(t);
  property(t, 'Worker', undefined);
  let delayed = false;
  let release;
  const body = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async url => {
    const res = reply(url);
    if (String(url).includes('state.json') && delayed) {
      const serverNow = new Date(Date.parse(stamp) + 1000).toISOString();
      res.json = async () => { clock.advance(240000); await body; return { ...payloadFor(String(url)), serverNow }; };
    }
    return res;
  });
  const feed = createFeed(() => {});
  await feed.refresh();
  clock.advance(1000);
  delayed = true;
  const pending = feed.refresh();
  await turn();
  const beforeAcceptance = feed.now();
  release();
  await pending;
  assert.equal(feed.now(), beforeAcceptance);
  assert.equal(feed.now(), new Date(Date.parse(stamp) + 241000).toISOString());
  assert.equal(feed.feeds.data.value.receivedAt, stamp);
  assert.equal(feed.select().states['today.equity'].ageSeconds, 241);
  assert.equal(statusPresentation(feed.select()).sentence, 'Board updates stopped');
});

test('JOED-130 timeouts retain warm values and ignore late bodies before a clean retry', async t => {
  const clock = scheduler(t), release = [];
  property(t, 'Worker', undefined);
  let hanging = false;
  t.mock.method(globalThis, 'fetch', async url => {
    const res = reply(url);
    if (hanging) res.json = () => new Promise(resolve => release.push(() => resolve(payloadFor(String(url)))));
    return res;
  });
  const feed = createFeed(() => {});
  await feed.refresh();
  const previous = Object.fromEntries(Object.entries(feed.feeds).map(([key, value]) => [key, value.value]));
  hanging = true;
  const pending = feed.refresh();
  await turn();
  assert.equal(clock.deadlines.size, 5, 'all warm reads and provenance have a deadline');
  clock.advance(15000);
  clock.expire();
  await pending;
  for (const [key, value] of Object.entries(feed.feeds)) {
    assert.deepEqual(value.value, previous[key]);
    assert.equal(value.reason, 'refresh_failed');
    assert.equal(value.value.receivedAt, previous[key].receivedAt);
  }
  assert.equal(feed.feeds['fleet-config'].receivedAt, stamp);
  for (const finish of release) finish();
  await turn();
  for (const value of Object.values(feed.feeds)) assert.equal(value.reason, 'refresh_failed', 'late success cannot restore Live');
  hanging = false;
  await feed.refresh();
  for (const value of Object.values(feed.feeds)) assert.equal(value.reason, null);
  assert.equal(feed.feeds.data.value.receivedAt, stamp);
  assert.equal(clock.deadlines.size, 0);
});

const authResponses = {
  '302 to SSO': () => new Response(null, { status: 302, headers: { Location: 'https://auth.inspr.at/sign-in' } }),
  '303 to SSO': () => new Response(null, { status: 303, headers: { Location: 'https://auth.inspr.at/sign-in' } }),
  opaqueredirect: () => ({ type: 'opaqueredirect', status: 0 }),
  '401': () => new Response('{}', { status: 401 }),
  '403': () => new Response('{}', { status: 403 }),
  'HTML content type': () => new Response('<h1>Sign in</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  'HTML body': () => new Response(' \n<!doctype html><html><body>Sign in</body></html>', { headers: { 'Content-Type': 'application/json' } }),
  'HTML fragment': () => new Response('<form action="/login">Sign in</form>'),
  'followed cross-origin redirect': () => ({ status: 200, redirected: true, url: 'https://auth.inspr.at/sign-in', headers: new Headers(), json: async () => ({}) }),
};

test('JOED-173 fix1 High: hero caption has no ticking age after a warm state read redirects to SSO', async t => {
  const clock = scheduler(t);
  property(t, 'Worker', undefined);
  let refused = false;
  t.mock.method(globalThis, 'fetch', async url => refused && String(url).endsWith('state.json') ? authResponses['302 to SSO']() : reply(url));
  const feed = createFeed(() => {});
  t.after(feed.stop);
  await feed.refresh();
  clock.advance(9000); refused = true; await feed.refresh();
  for (const elapsed of [0, 1000, 240000]) {
    clock.advance(elapsed);
    const ctx = feed.select(), caption = boardCaptionCell(ctx);
    assert.equal(caption.signedOut, true);
    assert.equal(caption.ageSeconds, null);
    const hero = readerDocument(heroLeft(ctx));
    assert.match(hero.querySelector('.board-caption').textContent, /Last known value · unknown while signed out/);
    assert.equal(hero.querySelectorAll('[data-age]').length, 0, 'no visible hero age can tick');
    assert.doesNotMatch(hero.textContent, /last good|\d+\s*s ago/i);
  }
});

test('JOED-173 fix1 Medium: signed-out missing cells and shared hero copy override broker reasons', async t => {
  property(t, 'Worker', undefined);
  const failed = JSON.parse(readFileSync(new URL('../fixtures/failures/a-gateway-up-but-dead.json', import.meta.url)));
  let refused = false;
  t.mock.method(globalThis, 'fetch', async url => {
    if (refused && String(url).endsWith('history.json')) return authResponses['401']();
    if (String(url).endsWith('state.json')) return new Response(JSON.stringify({ serverNow: failed.now,
      feeds: { data: { value: { ...failed.payload, receivedAt: failed.receivedAt } } }, panels: {} }));
    return reply(url);
  });
  const feed = createFeed(() => {});
  t.after(feed.stop);
  await feed.refresh(); refused = true; await feed.refresh();
  const ctx = feed.select();
  assert.equal(ctx.states.session, 'signed-out');
  for (const cell of Object.values(ctx.states).filter(c => c?.signedOut && c.value == null && c.reason)) {
    const original = structuredClone(cell);
    assert.equal(statePhrase(cell, 'missing').text, 'unavailable · unknown while signed out');
    assert.equal(sharedSectionPhrase(cell), 'Numbers unavailable · unknown while signed out');
    assert.doesNotMatch(cellView(cell, 'missing', { label: 'Open result' }).html, /broker connection down/i);
    assert.deepEqual(cell, original, 'presentation preserves the diagnostic reason');
  }
  const hero = readerDocument(heroLeft(ctx));
  assert.doesNotMatch(hero.textContent, /broker connection down|waiting on prices/i);
  assert.match(hero.textContent, /unknown while signed out/);
  assert.match(healthPop(ctx, statusPresentation(ctx)), /Last known diagnostics before sign-out:.*broker connection down/);
  assert.equal(ctx.feeds.data.value.desks[0].money.reasons.equity, failed.payload.desks[0].money.reasons.equity);
});

for (const [name, response] of Object.entries(authResponses)) test(`JOED-173 fix1 Medium: protected board settings joins shared auth classification: ${name}`, async t => {
  property(t, 'Worker', undefined);
  let refused = false;
  const good = { accountStart: null, reason: 'unset' };
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('board-settings.json')
    ? refused ? response() : new Response(JSON.stringify(good)) : reply(url));
  const feed = createFeed(() => {}, () => {}, '', { session: boardSession });
  const settings = createBoardSettings();
  t.after(() => { feed.stop(); boardSession.observe('/joe/board-settings.json', { auth: false }); });
  await feed.refresh(); await settings.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'board_ok');
  refused = true; await settings.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'signed-out');
  assert.equal(settings.snapshot().reason, 'auth_required');
  await feed.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'signed-out', 'ordinary feeds cannot clear settings auth evidence');
  refused = false; await settings.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'board_ok');
});

test('JOED-173 fix1 Medium: HTTP 200 history_compacted metadata stays accepted in worker and page', async t => {
  let worker;
  const history = { ...fixture.history, reason: 'history_compacted', compactedThrough: fixture.history.points[0].t };
  const messages = [];
  property(t, 'self', { postMessage(data) { messages.push(data); worker.onmessage({ data }); } });
  await import('../public/joe/history-worker.js?joed173-fix1-compacted');
  const handle = self.onmessage;
  const workerClass = class { constructor() { worker = this; } postMessage(data) { handle({ data }); } };
  property(t, 'Worker', workerClass);
  t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('history.json') ? new Response(JSON.stringify(history)) : reply(url));
  for (const mode of ['worker', 'page']) {
    globalThis.Worker = mode === 'worker' ? workerClass : undefined;
    const feed = createFeed(() => {});
    t.after(feed.stop);
    await feed.refresh();
    assert.equal(feed.feeds.history.reason, null, `${mode}: successful metadata is not a feed failure`);
    assert.equal(feed.feeds.history.value.reason, 'history_compacted');
    assert.equal(feed.feeds.history.value.compactedThrough, history.compactedThrough);
    assert.equal(feed.select().states.history.retained, false);
  }
  assert.equal(messages.find(m => m.kind === 'history').reason, null);
});

test('JOED-173 fix1 Medium: transport is registered in package modules and pinned in the page import map', () => {
  const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const modules = text => JSON.parse(text.match(/const UI_MODULES = (\[[\s\S]*?\]);/)[1]);
  const server = modules(source('server.mjs')), checker = modules(source('scripts/check-package.mjs'));
  assert.ok(checker.includes('transport.js'), 'package checker registers transport');
  assert.deepEqual(checker.toSorted(), server.toSorted());
  const map = JSON.parse(source('public/joe/index.html').match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const pkg = JSON.parse(source('package.json'));
  assert.equal(map.imports['/joe/transport.js'], `/joe/transport.js?v=${pkg.version}`);
});

test('JOED-173 fix1 Low: retained card figures consistently say last known while signed out', async t => {
  property(t, 'Worker', undefined);
  let refused = false;
  t.mock.method(globalThis, 'fetch', async url => refused && String(url).endsWith('state.json') ? authResponses['401']() : reply(url));
  const feed = createFeed(() => {});
  t.after(feed.stop);
  await feed.refresh(); refused = true; await feed.refresh();
  const cell = feed.select().states['desks.j.equity'];
  assert.ok(cell.retained && cell.value != null);
  assert.equal(cardCaption(cell, 'designed caption', null), 'Last known');
  assert.equal(cardCaption({ ...cell, signedOut: false }, 'designed caption', null), 'Last good', 'ordinary retained copy is preserved');
});
for (const route of ['state.json', 'history.json', 'results.json', 'account-history.json', 'healthz']) {
  for (const [name, response] of Object.entries(authResponses)) test(`JOED-173 shared boundary: ${route}, ${name}`, async t => {
    t.mock.method(globalThis, 'fetch', async (_url, init) => { assert.equal(init.redirect, 'manual'); return response(); });
    const res = await readJSON(`https://board.example/joe/${route}`);
    assert.equal(res.auth, true);
    assert.equal(res.payload, undefined, 'sign-in responses never become documents');
  });
}

for (const route of ['state.json', 'history.json', 'history-continuity.json', 'results.json', 'fleet-config.json', 'fleet-config/actions.json']) {
  test(`JOED-173 board precedence and recovery: ${route}`, async t => {
    const clock = scheduler(t);
    property(t, 'Worker', undefined);
    let signedOut = false;
    t.mock.method(globalThis, 'fetch', async url => {
      if (signedOut && String(url).endsWith(route)) return authResponses['302 to SSO']();
      const response = reply(url);
      if (String(url).endsWith('state.json')) response.json = async () => ({ ...payloadFor(String(url)), serverNow: new Date(Date.parse(stamp) + performance.now()).toISOString() });
      return response;
    });
    const feed = createFeed(() => {});
    t.after(feed.stop);
    await feed.refresh(); await feed.refreshActions();
    const known = feed.feeds.data.value;
    assert.equal(statusPresentation(feed.select()).reason, 'board_ok');
    clock.advance(240000);
    assert.equal(statusPresentation(feed.select()).reason, 'feed_disconnected');
    signedOut = true;
    await feed.refresh(); await feed.refreshActions();
    const ctx = feed.select(), status = statusPresentation(ctx);
    assert.equal(ctx.states.session, 'signed-out');
    assert.equal(status.reason, 'signed-out', 'auth takes precedence over stopped updates and broker age');
    assert.equal(status.sentence, 'Signed out — reload to sign in');
    assert.equal(status.alert, status.sentence, 'one reason and one action');
    assert.equal(feed.feeds.data.value.receivedAt, known.receivedAt, 'original receipt is preserved');
    assert.deepEqual(feed.feeds.data.value, known, 'last good snapshot stays available');
    assert.equal(ctx.states['desks.j.equity'].value.amount, known.desks[0].money.equity.amount);
    assert.equal(ctx.states.gateway.ageSeconds, null);
    assert.equal(brokerState(ctx.states, known).word, 'unknown while signed out');
    assert.match(statePhrase(ctx.states['desks.j.equity'], '').text, /last known value · unknown while signed out/);
    const health = statusPresentation(ctx);
    const head = headerHealth(ctx, health), details = healthPop(ctx, health);
    assert.doesNotMatch([head.label, head.alert, details, ...boardDiagnostics(ctx.states, ctx.feeds, ctx.now)].join(' '), /Amy|updates stopped|has not checked in|broker (?:is offline|connection down|unsure)/i);
    assert.match(details, /data-sign-in-reload>Reload/);
    signedOut = false;
    await feed.refresh(); await feed.refreshActions();
    assert.equal(feed.select().states.session, undefined);
    assert.equal(statusPresentation(feed.select()).reason, 'feed_disconnected', 'recovery restores the honest stale reason, not Live');
  });
}

test('JOED-173 a session recovers per endpoint; unrelated successes and network errors cannot clear it', () => {
  const session = createBoardSession();
  let changes = 0;
  const stop = session.subscribe(() => changes++);
  session.observe('state', { auth: true }); session.observe('healthz', { auth: true });
  session.observe('history', { auth: false }); session.observe('state', { status: 0 });
  assert.equal(session.signedOut(), true);
  session.observe('state', { auth: false });
  assert.equal(session.signedOut(), true);
  session.observe('healthz', { auth: false });
  assert.equal(session.signedOut(), false);
  assert.equal(changes, 2, 'only board-level transitions announce');
  stop();
});

for (const route of ['history.json', 'history-continuity.json', 'results.json']) test(`JOED-173 actual history worker reports auth and recovery: ${route}`, async t => {
  let worker, refused = false;
  property(t, 'self', { postMessage(data) { worker.onmessage({ data }); } });
  await import(`../public/joe/history-worker.js?joed173-${route}`);
  const handle = self.onmessage;
  property(t, 'Worker', class { constructor() { worker = this; } postMessage(data) { handle({ data }); } });
  t.mock.method(globalThis, 'fetch', async url => refused && String(url).endsWith(route) ? authResponses['HTML body']() : reply(url));
  const feed = createFeed(() => {});
  t.after(feed.stop);
  await feed.refresh();
  refused = true; await feed.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'signed-out');
  refused = false; await feed.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'board_ok');
  await feed.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'board_ok', 'unchanged worker replies preserve recovered sign-in');
});

for (const mode of ['page', 'worker']) test(`JOED-173 account history ${mode} participates in the board session`, async t => {
  let handle, send, refused = false;
  property(t, 'Worker', undefined);
  const { refreshAccountHistory, forgetAccountHistory } = await import(`../public/joe/account.js?joed173-${mode}`);
  if (mode === 'worker') {
    property(t, 'self', { postMessage(data) { handle.onmessage({ data }); } });
    await import('../public/joe/account-worker.js?joed173');
    send = self.onmessage;
    property(t, 'JoeVersion', { APP_VERSION: 'test' });
  }
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).endsWith('account-history.json')) return refused ? authResponses['HTML body']() : new Response(JSON.stringify(accountHistory()));
    return reply(url);
  });
  // Feed uses the application's shared session here; ordinary feeds have
  // independent sessions so a different board instance cannot contaminate it.
  const feed = createFeed(() => {}, () => {}, '', { session: boardSession });
  if (mode === 'worker') globalThis.Worker = class { constructor() { handle = this; } postMessage(data) { send({ data }); } };
  t.after(() => { feed.stop(); boardSession.observe('/joe/account-history.json', { auth: false }); forgetAccountHistory(); });
  await feed.refresh(); await refreshAccountHistory();
  refused = true; await refreshAccountHistory();
  assert.equal(statusPresentation(feed.select()).reason, 'signed-out');
  await feed.refresh();
  assert.equal(statusPresentation(feed.select()).reason, 'signed-out', 'main feed cannot clear an account read failure');
  refused = false; await refreshAccountHistory();
  assert.equal(statusPresentation(feed.select()).reason, 'board_ok');
});

for (const [name, response, expected] of [
  ['proxy HTML', () => new Response('<html>Bad gateway</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }), 'refresh_failed'],
  ['invalid JSON', () => new Response('{bad json'), 'refresh_failed'],
  ['invalid data', () => new Response('{}'), 'refresh_failed'],
  ['network down', () => { throw new TypeError('offline'); }, 'refresh_failed'],
  ['missing route', () => new Response('{}', { status: 404 }), 'route_not_found'],
]) test(`JOED-173 non-auth failure stays honest: ${name}`, async t => {
  property(t, 'Worker', undefined);
  let fail = false;
  t.mock.method(globalThis, 'fetch', async url => fail && String(url).endsWith('state.json') ? response() : reply(url));
  const feed = createFeed(() => {});
  t.after(feed.stop);
  await feed.refresh(); fail = true; await feed.refresh();
  assert.equal(feed.feeds.data.reason, expected);
  assert.notEqual(statusPresentation(feed.select()).reason, 'signed-out');
});
