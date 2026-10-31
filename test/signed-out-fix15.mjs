import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import './fixtures/preview-dom.mjs';
const { createBoardSession, startAuthProbe, readJSON, PROBE_RELOAD_KEY } = await import('../public/joe/transport.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const payload = { serverNow: valid.data.receivedAt, feeds: { data: { value: valid.data } } };
const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
};
function harness(t, { storage = () => memory(), ...options } = {}) {
  const session = createBoardSession(), queue = new Map(), delays = [];
  let serial = 0, reloads = 0;
  const stop = startAuthProbe(session, { reload: () => { reloads++; }, storage,
    schedule(fn, ms) { const id = ++serial; queue.set(id, fn); delays.push(ms); return id; },
    cancel: id => queue.delete(id), ...options });
  t.after(stop);
  return { session, queue, delays, stop, reloads: () => reloads,
    async tick() { const [id, fn] = queue.entries().next().value ?? []; assert.ok(fn, 'probe is scheduled'); queue.delete(id); await fn(); },
  };
}
const response = shape => {
  if (shape === 'network') throw new TypeError('offline');
  const res = new Response(shape === 'invalid JSON' ? '{bad' : shape === 'HTML' ? '<form>Sign in</form>'
    : JSON.stringify(shape === 'invalid body' ? { feeds: { data: { value: {} } } } : payload),
  { status: typeof shape === 'number' ? shape : 200, headers: shape === 'HTML content type' ? { 'Content-Type': 'text/html' } : {} });
  if (shape === 'cross-origin redirect') Object.defineProperties(res, { redirected: { value: true }, url: { value: 'https://sso.example.invalid/sign_in' } });
  if (shape === 'same-origin redirect') Object.defineProperties(res, { redirected: { value: true }, url: { value: 'https://board/joe/state.json' } });
  return res;
};
for (const shape of [401, 403, 302, 503, 404, 'network', 'invalid JSON', 'invalid body', 'HTML', 'HTML content type', 'cross-origin redirect', 'opaque redirect', 200, 201, 'same-origin redirect'])
test(`JOED-173 fix15 probe transport/validator: ${shape}`, async t => {
  let reads = 0;
  const store = memory();
  const h = harness(t, { storage: () => store, read: () => readJSON('https://board/joe/state.json', {}, { fetcher: async (url, init) => {
    reads++; assert.equal(url, 'https://board/joe/state.json');
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
    return shape === 'opaque redirect' ? { status: 0, type: 'opaqueredirect' } : response(shape);
  } }) });
  assert.equal(h.queue.size, 0, 'no probes while live');
  h.session.observe('expiry', { auth: true });
  assert.deepEqual(h.delays, [30000]);
  await h.tick();
  const succeeds = [200, 201, 'same-origin redirect'].includes(shape);
  assert.equal(h.reloads(), succeeds ? 1 : 0);
  assert.equal(h.session.signedOut(), true, 'even successful probes never unfreeze in place');
  assert.equal(h.session.accept('/joe/state.json', { status: 200, payload }), false);
  assert.equal(reads, 1);
  assert.equal(h.queue.size, succeeds ? 0 : 1);
  if (succeeds) assert.equal(JSON.parse(store.getItem(PROBE_RELOAD_KEY)).length, 1);
});
test('JOED-173 fix15 backoff is 30, 60, 120 seconds and caps at 120; one pending read', async t => {
  let release, reads = 0;
  const h = harness(t, { read: () => { reads++; return new Promise(done => { release = done; }); } });
  h.session.observe('expiry', { auth: true });
  const pending = h.tick();
  for (let i = 0; i < 5; i++) h.session.observe('sibling', { auth: true });
  assert.equal(reads, 1); assert.equal(h.queue.size, 0);
  release({ status: 503 }); await pending;
  for (let i = 0; i < 3; i++) { const task = h.tick(); release({ status: 503 }); await task; }
  assert.deepEqual(h.delays, [30000, 60000, 120000, 120000, 120000]);
});
test('JOED-173 fix15 probe stops after teardown, including a late valid response', async t => {
  let release;
  const h = harness(t, { read: () => new Promise(done => { release = done; }) });
  h.session.observe('expiry', { auth: true });
  const pending = h.tick(); h.stop();
  release({ status: 200, payload }); await pending;
  assert.equal(h.reloads(), 0); assert.equal(h.queue.size, 0);
});
test('JOED-173 fix15 guard permits three reloads per rolling ten minutes, then stops until manual reload', async t => {
  const store = memory(); let at = 1_000_000;
  for (let i = 0; i < 3; i++) {
    const h = harness(t, { storage: () => store, now: () => at, read: async () => ({ status: 200, payload }) });
    h.session.observe('expiry', { auth: true }); await h.tick(); assert.equal(h.reloads(), 1); at += 30000;
  }
  const blocked = harness(t, { storage: () => store, now: () => at, read: async () => { throw new Error('must not poll'); } });
  blocked.session.observe('expiry', { auth: true });
  assert.equal(blocked.queue.size, 0); assert.equal(blocked.reloads(), 0);
  at = 1_600_000;
  assert.equal(blocked.queue.size, 0, 'the exhausted page stays stopped even after time passes');
  const newPage = harness(t, { storage: () => store, now: () => at, read: async () => ({ status: 200, payload }) });
  newPage.session.observe('expiry', { auth: true }); await newPage.tick();
  assert.equal(newPage.reloads(), 1, 'manual reload may create a probe once an old entry expires');
  assert.deepEqual(JSON.parse(store.getItem(PROBE_RELOAD_KEY)), [1_030_000, 1_060_000, 1_600_000]);
});
test('JOED-173 fix15 guard rechecks storage after the asynchronous probe', async t => {
  const store = memory(); let release;
  const h = harness(t, { storage: () => store, now: () => 1_000_000, read: () => new Promise(done => { release = done; }) });
  h.session.observe('expiry', { auth: true }); const pending = h.tick();
  store.setItem(PROBE_RELOAD_KEY, JSON.stringify([999_000, 999_001, 999_002]));
  release({ status: 200, payload }); await pending;
  assert.equal(h.reloads(), 0); assert.equal(h.queue.size, 0);
});
for (const failure of ['getter', 'read', 'write', 'invalid JSON', 'invalid history'])
test(`JOED-173 fix15 storage unavailable (${failure}) allows at most one probe reload per page`, async t => {
  const store = memory();
  if (failure === 'invalid JSON') store.setItem(PROBE_RELOAD_KEY, '{bad');
  if (failure === 'invalid history') store.setItem(PROBE_RELOAD_KEY, '["bad"]');
  if (failure === 'read') store.getItem = () => { throw new Error('storage denied'); };
  if (failure === 'write') store.setItem = () => { throw new Error('quota exceeded'); };
  const h = harness(t, { storage: () => { if (failure === 'getter') throw new Error('storage denied'); return store; }, read: async () => ({ status: 200, payload }) });
  h.session.observe('expiry', { auth: true });
  const callback = [...h.queue.values()][0];
  await h.tick(); await callback(); h.session.observe('other', { auth: true });
  assert.equal(h.reloads(), 1); assert.equal(h.queue.size, 0);
});
test('JOED-173 fix15 manual Reload calls location.reload even when automatic guard is exhausted', async t => {
  const store = memory(); store.setItem(PROBE_RELOAD_KEY, '[1000000,1000000,1000000]');
  const h = harness(t, { storage: () => store, now: () => 1_000_001 });
  h.session.observe('expiry', { auth: true }); assert.equal(h.queue.size, 0);
  const app = readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8');
  const start = app.indexOf("    if (e.target.closest('[data-sign-in-reload]'))"), end = app.indexOf('\n', start);
  let reloads = 0;
  runInNewContext(`(() => { ${app.slice(start, end)} })()`, {
    e: { target: { closest: selector => selector === '[data-sign-in-reload]' } }, location: { reload: () => reloads++ },
  });
  assert.equal(reloads, 1);
});
test('JOED-173 fix15 automatic feed timers pause at expiry, leaving only the state auth probe', async t => {
  const { createFeed } = await import('../public/joe/feed.js');
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = undefined;
  t.after(() => { if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker); else delete globalThis.Worker; });
  const intervals = new Map(), calls = [];
  t.mock.method(globalThis, 'setInterval', fn => { const id = intervals.size + 1; intervals.set(id, fn); return id; });
  t.mock.method(globalThis, 'clearInterval', id => intervals.delete(id));
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    const body = String(url).endsWith('state.json') ? payload
      : String(url).includes('continuity') ? { schema: 'joedesk.history-continuity.v1', historySeq: valid.history.seq, intervals: [] }
      : String(url).includes('history.json') ? valid.history
      : String(url).includes('results.json') ? valid.results : valid['fleet-config'];
    return new Response(JSON.stringify(body), { headers: { 'X-Joe-Received-At': valid.data.receivedAt } });
  });
  const h = harness(t), feed = createFeed(() => {}, () => {}, '', { session: h.session, actionsWanted: () => true });
  t.after(feed.stop);
  feed.start(); await feed.refresh(); await feed.whenIdle();
  h.session.observe('expiry', { auth: true }); const before = calls.length;
  for (const tick of intervals.values()) tick();
  await feed.whenIdle(); assert.equal(calls.length, before, 'ordinary polling does no protected reads after expiry');
  await h.tick();
  assert.deepEqual(calls.slice(before), ['/joe/state.json']);
  assert.equal(h.reloads(), 1); assert.equal(h.session.signedOut(), true);
});
