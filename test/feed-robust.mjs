import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import './fixtures/preview-dom.mjs';
const { createFeed } = await import('../public/joe/feed.js');
const { statusPresentation } = await import('../public/joe/health.js');

function property(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
}

const fixture = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const stamp = fixture.data.receivedAt;
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
  assert.equal(calls.length, 5, 'one attempt per feed, including state from manual refresh');
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
  assert.equal(calls.length, 2);
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
  assert.equal(clock.deadlines.size, 4, 'all warm reads have a deadline');
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
