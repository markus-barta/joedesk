import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { Worker as NodeWorker } from 'node:worker_threads';
import { htmlDocument } from './fixtures/preview-dom.mjs';
import { history as accountHistory } from './fixtures/account-fixtures.mjs';

// Replay production sources in memory; the checkout and historical fixtures stay intact.
if (process.env.JOED_FIX14_BASELINE) registerHooks({ load(url, context, next) {
  if (url.startsWith('file:') && /\/public\/joe\/[^/]+\.js(?:\?.*)?$/.test(url)) {
    const path = new URL(url).pathname.split('/public/joe/')[1];
    return { format: 'module', source: execFileSync('git', ['show', `${process.env.JOED_FIX14_BASELINE}:public/joe/${path}`], { encoding: 'utf8' }), shortCircuit: true };
  }
  return next(url, context);
} });
const { createFeed } = await import('../public/joe/feed.js');
const { createBoardSession, readJSON } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const continuity = { schema: 'joedesk.history-continuity.v1', historySeq: valid.history.seq, intervals: [] };
const good = payload => ({ status: 200, payload });
const bad = { status: 503, payload: {} };
const responses = {
  'history.json': valid.history, 'results.json': valid.results,
  'history-continuity.json': continuity,
  'state.json': { serverNow: valid.data.receivedAt, feeds: { data: { value: valid.data } } },
  'data.json': valid.data, 'fleet-config.json': valid['fleet-config'],
  'fleet-config/actions.json': { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] },
  'account-history.json': accountHistory(), 'board-settings.json': { accountStart: null, reason: 'unset' },
};
const response = r => {
  if (r.network) throw new TypeError('offline');
  const res = new Response(r.body ?? JSON.stringify(r.payload), { status: r.status,
    headers: { 'X-Joe-Server-Now': valid.history.receivedAt, ...r.headers } });
  if (r.crossedOrigin) Object.defineProperties(res, { redirected: { value: true }, url: { value: 'https://sso.example.invalid/sign_in' } });
  return res;
};

async function board(t, mode) {
  const route = '/joe/history.json', session = createBoardSession(), workers = [];
  const replies = new Map(Object.entries(responses).map(([url, payload]) => [url, good(payload)]));
  const fetcher = async url => response(replies.get(String(url).replace(/^.*\/joe\//, '').replace(/^\.\//, '')) ?? bad);
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), oldFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  globalThis.Worker = mode === 'fallback' ? undefined : class {
    constructor() {
      const boot = `import { parentPort } from 'node:worker_threads';
        import ${JSON.stringify(import.meta.url)};
        const pending = new Map(); let id = 0;
        globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
        globalThis.fetch = url => new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); parentPort.postMessage({ request, url }); });
        const ready = import(${JSON.stringify(new URL('../public/joe/history-worker.js', import.meta.url).href)});
        parentPort.on('message', async m => {
          if (m.response) { const p = pending.get(m.response); pending.delete(m.response); if (m.error) p.reject(new TypeError('offline')); else p.resolve(new Response(m.body, { status: m.status, headers: m.headers })); }
          else { await ready; self.onmessage({ data: m }); }
        });`;
      this.node = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(boot)}`), { env: { ...process.env, JOED_FIX14_WORKER: '1' } });
      workers.push(this.node);
      this.node.on('message', data => {
        if (!data.request) { this.onmessage?.({ data }); return; }
        const r = replies.get(data.url.replace('/joe/', '')) ?? bad;
        this.node.postMessage({ response: data.request, error: r.network, status: r.status,
          body: r.body ?? JSON.stringify(r.payload), headers: { 'X-Joe-Server-Now': valid.history.receivedAt, ...r.headers } });
      });
      this.node.on('error', error => { throw error; });
    }
    postMessage(data) { this.node.postMessage(data); }
    terminate() { return this.node.terminate(); }
  };
  const feed = createFeed(() => {}, () => {}, '', { session });
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const freeze = createBoardFreeze(doc, session);
  let release;
  const stop = session.coordinateRecovery(() => new Promise(done => { release = done; }));
  t.after(async () => {
    release?.(); stop(); freeze.stop(); feed.stop(); await Promise.all(workers.map(w => w.terminate()));
    globalThis.fetch = oldFetch;
    if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker); else delete globalThis.Worker;
  });
  await feed.refreshHistory(); feed.select(); freeze.rendered(feed.now());
  // No unrelated endpoint can supply accidental post-expiry evidence.
  for (const key of replies.keys()) replies.set(key, bad);
  replies.set('history.json', { status: 401, payload: {} }); await feed.refreshHistory();
  assert.equal(session.signedOut(), true);
  return { feed, session, doc, replies, route,
    async poll(history, sidecar) {
      replies.set('history.json', history); replies.set('history-continuity.json', sidecar);
      await feed.refreshHistory(); await feed.whenIdle();
    },
    finish: () => session.finishRecovery(() => { feed.select(); freeze.rendered(feed.now()); return true; }),
  };
}

if (!process.env.JOED_FIX14_WORKER) {
  for (const failure of ['503', '404', 'network', 'invalid JSON'])
  test(`JOED-173 fix14 History success survives Continuity ${failure}, worker and fallback`, async t => {
    for (const mode of ['worker', 'fallback']) await t.test(mode, async t => {
      const b = await board(t, mode), next = { ...valid.history, seq: valid.history.seq + 1 };
      const sidecar = failure === 'network' ? { network: true } : failure === 'invalid JSON' ? { status: 200, body: '{bad' } : { status: Number(failure), payload: {} };
      await b.poll(good(next), sidecar); await b.poll(good(next), sidecar);
      assert.equal(b.finish(), true, 'validated History proves sign-in independently of its sibling');
      assert.equal(b.session.signedOut(), false);
      assert.equal(b.feed.select().feeds.history.value.seq, next.seq);
      assert.equal(b.doc.getElementById('signedOutBanner').hidden, true);
      assert.equal(b.doc.getElementById('app').hasAttribute('inert'), false);
    });
  });
  test('JOED-173 fix14 invalid Continuity intervals never prove sign-in, worker and fallback', async t => {
    for (const mode of ['worker', 'fallback']) await t.test(mode, async t => {
      const b = await board(t, mode);
      const malformed = { ...continuity, intervals: [['bad', 'bad']] };
      await b.poll(bad, good(malformed)); await b.poll(bad, good(malformed));
      assert.equal(b.finish(), false, 'a 200 failing validContinuity is not sign-in evidence');
      assert.equal(b.session.signedOut(), true);
      assert.equal(b.doc.getElementById('signedOutBanner').hidden, false);
      assert.equal(b.doc.getElementById('app').hasAttribute('inert'), true);
    });
  });
  test('JOED-173 fix14 good Continuity beside History 401 survives subsequent both-503, worker and fallback', async t => {
    for (const mode of ['worker', 'fallback']) await t.test(mode, async t => {
      const b = await board(t, mode);
      await b.poll({ status: 401, payload: {} }, good(continuity));
      assert.equal(b.finish(), false, 'latest History 401 blocks despite good Continuity');
      await b.poll(bad, bad); await b.poll(bad, bad);
      assert.equal(b.finish(), true, 'the earlier validated Continuity response survives its sibling refusal');
      assert.equal(b.session.signedOut(), false);
      assert.equal(b.feed.select().states.history.reason, 'refresh_failed');
    });
  });
  for (const endpoint of Object.keys(responses)) test(`JOED-173 fix14 endpoint validator and sign-in HTML: ${endpoint}`, async t => {
    const key = `/joe/${endpoint}`, session = createBoardSession();
    t.after(session.coordinateRecovery(() => new Promise(() => {})));
    session.observe(key, { auth: true });
    for (const r of [good({}), { status: 200, body: '<!doctype html><html><form>Sign in</form></html>' },
      { status: 200, body: '<form>Sign in</form>', headers: { 'Content-Type': 'text/html' } },
      { status: 200, body: '{bad' }, { status: 200, payload: responses[endpoint], crossedOrigin: true }, bad]) {
      const result = await readJSON(key, {}, { fetcher: async () => response(r) });
      session.accept(key, result);
      assert.equal(session.finishRecovery(() => true), false, 'invalid, HTML and redirected bodies cannot prove sign-in');
      assert.equal(session.signedOut(), true);
      if (r.crossedOrigin) assert.equal(result.evidence, 'NO_EVIDENCE');
    }
    const result = await readJSON(key, {}, { fetcher: async () => response(good(responses[endpoint])) });
    session.accept(key, result);
    assert.equal(session.finishRecovery(() => true), true, 'only this endpoint’s valid body proves sign-in');
    assert.equal(result.evidence, 'AUTHENTICATED');
  });
  test('JOED-173 fix14 worker/fallback parity uses the same table of endpoint sequences', async t => {
    const table = [
      [bad, good({ ...continuity, intervals: [['bad', 'bad']] }), true],
      [good({ ...valid.history, seq: valid.history.seq + 1 }), bad, false],
      [{ status: 401, payload: {} }, good(continuity), true],
      [bad, bad, false],
      [{ status: 401, payload: {} }, bad, true],
      [bad, { status: 200, body: '{bad' }, true],
      [bad, good(continuity), false],
    ];
    const states = {};
    for (const mode of ['worker', 'fallback']) await t.test(mode, async t => {
      const b = await board(t, mode); states[mode] = [];
      for (const [history, sidecar, signedOut] of table) {
        await b.poll(history, sidecar); await b.poll(history, sidecar); b.finish();
        states[mode].push(b.session.signedOut());
        assert.equal(b.session.signedOut(), signedOut);
      }
    });
    assert.deepEqual(states.worker, states.fallback);
  });
}
