import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import './fixtures/preview-dom.mjs';
const { createBoardSession, startAuthProbe, readJSON, PROBE_RELOAD_KEY } = await import('../public/joe/transport.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const payload = { serverNow: valid.data.receivedAt, feeds: { data: { value: valid.data } } };
const app = readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8');
const start = app.indexOf('  const stopProbe = startAuthProbe(boardSession);');
const end = app.indexOf('  feed.start();', start);
assert.ok(start >= 0 && end > start, 'execute the actual app probe lifecycle wiring');
function harness(t, options = {}) {
  const session = createBoardSession(), queue = new Map(), delays = [], listeners = new Map(), data = new Map();
  const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let serial = 0, reloads = 0;
  const stop = startAuthProbe(session, {
    storage: () => store, reload: () => { reloads++; },
    schedule(fn, ms) { const id = ++serial; queue.set(id, fn); delays.push(ms); return id; },
    cancel: id => queue.delete(id), ...options,
  });
  t.after(stop);
  runInNewContext(app.slice(start, end), {
    boardSession: session, startAuthProbe: board => { assert.equal(board, session); return stop; },
    addEventListener(type, fn, config) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, once: config?.once });
    },
  });
  return { session, queue, delays, store, reloads: () => reloads,
    event(type, persisted) {
      for (const entry of [...(listeners.get(type) ?? [])]) {
        if (entry.once) listeners.set(type, listeners.get(type).filter(item => item !== entry));
        entry.fn({ persisted });
      }
    },
    async tick() {
      const [id, fn] = queue.entries().next().value ?? [];
      assert.ok(fn, 'exactly one probe can be taken from the timer queue');
      assert.equal(queue.size, 1);
      queue.delete(id); await fn();
    },
  };
}
const expire = h => h.session.observe('/joe/history.json', { status: 401 });
const pause = h => h.event('pagehide', true);
const resume = h => h.event('pageshow', true);

test('JOED-175 persisted pagehide, restore, then History 401 schedules exactly one probe', t => {
  const h = harness(t);
  pause(h); resume(h); expire(h);
  assert.equal(h.session.signedOut(), true);
  assert.equal(h.queue.size, 1);
  assert.deepEqual(h.delays, [30000]);
  resume(h); expire(h);
  assert.equal(h.queue.size, 1, 'repeated events do not duplicate timers');
});

test('JOED-175 signed out before persisted pagehide re-arms and validated same-origin state.json 2xx reloads', async t => {
  let reads = 0;
  const h = harness(t, { read: () => readJSON('https://board/joe/state.json', {}, { fetcher: async (url, init) => {
    reads++; assert.equal(url, 'https://board/joe/state.json');
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
    return new Response(JSON.stringify(payload), { status: 200 });
  } }) });
  expire(h);
  for (let i = 0; i < 2; i++) {
    pause(h); assert.equal(h.queue.size, 0); assert.equal(reads, 0);
    h.event('pageshow', false); assert.equal(h.queue.size, 0, 'only a persisted restore resumes');
    resume(h); assert.equal(h.queue.size, 1);
  }
  assert.deepEqual(h.delays, [30000, 30000, 30000]);
  await h.tick();
  assert.equal(reads, 1); assert.equal(h.reloads(), 1); assert.equal(h.queue.size, 0);
  assert.equal(h.session.signedOut(), true, 'restore and successful probe never unfreeze the document');
  assert.equal(JSON.parse(h.store.getItem(PROBE_RELOAD_KEY)).length, 1);
});

for (const signedOut of [false, true])
test(`JOED-175 non-persisted pagehide tears down permanently (signed out: ${signedOut})`, t => {
  const h = harness(t);
  if (signedOut) expire(h);
  h.event('pagehide', false);
  assert.equal(h.queue.size, 0);
  resume(h); expire(h); pause(h); resume(h);
  assert.equal(h.queue.size, 0);
});

test('JOED-175 reload history and backoff survive pause/resume; an exhausted guard cannot restart', async t => {
  let at = 1_000_000, succeeds = false;
  const h = harness(t, { now: () => at, read: async () => succeeds ? { status: 200, payload } : { status: 503 } });
  const prior = JSON.stringify([999_000, 999_001]); h.store.setItem(PROBE_RELOAD_KEY, prior);
  expire(h); await h.tick();
  pause(h); resume(h);
  assert.deepEqual(h.delays, [30000, 60000, 60000], 'backoff does not reset on restore');
  assert.equal(h.store.getItem(PROBE_RELOAD_KEY), prior, 'pause/resume preserves reload history');
  succeeds = true; await h.tick();
  assert.equal(h.reloads(), 1);
  assert.deepEqual(JSON.parse(h.store.getItem(PROBE_RELOAD_KEY)), [999_000, 999_001, at]);
  pause(h); resume(h); assert.equal(h.queue.size, 0, 'successful reload keeps the page stopped');

  const blocked = harness(t, { storage: () => h.store, now: () => at });
  expire(blocked); assert.equal(blocked.queue.size, 0);
  at += 600_001;
  pause(blocked); resume(blocked);
  assert.equal(blocked.queue.size, 0, 'pause/resume does not reset an exhausted guard even after its window');
});

test('JOED-175 storage-unavailable fallback survives pause/resume and permits only one reload', async t => {
  let accesses = 0;
  const h = harness(t, { storage: () => { accesses++; throw new Error('storage denied'); }, read: async () => ({ status: 200, payload }) });
  expire(h); pause(h); resume(h);
  assert.equal(accesses, 1, 'storage failure remains latched across restore');
  await h.tick();
  pause(h); resume(h); expire(h);
  assert.equal(h.reloads(), 1); assert.equal(h.queue.size, 0); assert.equal(accesses, 1);
});

test('JOED-175 late valid response during bfcache pause cannot reload; restore re-arms once', async t => {
  let release;
  const h = harness(t, { read: () => new Promise(done => { release = done; }) });
  expire(h); const pending = h.tick(); pause(h);
  release({ status: 200, payload }); await pending;
  assert.equal(h.reloads(), 0); assert.equal(h.queue.size, 0);
  assert.equal(h.store.getItem(PROBE_RELOAD_KEY), null);
  resume(h); resume(h);
  assert.equal(h.queue.size, 1); assert.deepEqual(h.delays, [30000, 30000]);
  const next = h.tick(); h.event('pagehide', false);
  release({ status: 200, payload }); await next; resume(h);
  assert.equal(h.reloads(), 0); assert.equal(h.queue.size, 0, 'permanent teardown also discards a late response');
});

test('JOED-175 restore before an in-flight failure settles keeps one read and re-arms normally', async t => {
  let release, reads = 0;
  const h = harness(t, { read: () => { reads++; return new Promise(done => { release = done; }); } });
  expire(h); const pending = h.tick(); pause(h); resume(h); resume(h);
  assert.equal(reads, 1); assert.equal(h.queue.size, 0);
  release({ status: 503 }); await pending;
  assert.equal(h.queue.size, 1); assert.deepEqual(h.delays, [30000, 60000]);
});

test('JOED-175 expiry while paused schedules nothing until persisted pageshow', t => {
  const h = harness(t);
  pause(h); expire(h);
  assert.equal(h.queue.size, 0); assert.equal(h.session.signedOut(), true);
  resume(h); assert.equal(h.queue.size, 1); assert.deepEqual(h.delays, [30000]);
});
