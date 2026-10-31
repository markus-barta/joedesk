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
  const res = new Response(r.status === 304 ? null : r.body ?? JSON.stringify(r.payload), { status: r.status,
    headers: { 'X-Joe-Server-Now': valid.history.receivedAt, ...r.headers } });
  if (r.crossedOrigin) Object.defineProperties(res, { redirected: { value: true }, url: { value: 'https://sso.example.invalid/sign_in' } });
  return res;
};

async function board(t, mode, sidecarFirst = false) {
  const route = '/joe/history.json', session = createBoardSession(), workers = [];
  const replies = new Map(Object.entries(responses).map(([url, payload]) => [url, good(payload)]));
  const delay = url => String(url).includes('continuity') !== sidecarFirst;
  const fetcher = async url => {
    if (delay(url)) await new Promise(done => setImmediate(done));
    return response(replies.get(String(url).replace(/^.*\/joe\//, '').replace(/^\.\//, '')) ?? bad);
  };
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
      this.node.on('message', async data => {
        if (!data.request) { this.onmessage?.({ data }); return; }
        const r = replies.get(data.url.replace('/joe/', '')) ?? bad;
        if (delay(data.url)) await new Promise(done => setImmediate(done));
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
  t.after(async () => {
    freeze.stop(); feed.stop(); await Promise.all(workers.map(w => w.terminate()));
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
  };
}

if (!process.env.JOED_FIX14_WORKER) {
  test('JOED-173 fix15 one worker/fallback parity table: every response sequence preserves the frozen display', async t => {
    const table = [
      [good({ ...valid.history, seq: valid.history.seq + 1 }), bad],
      [good(valid.history), { status: 404, payload: {} }],
      [good(valid.history), { network: true }],
      [good(valid.history), { status: 200, body: '{bad' }],
      [{ status: 401, payload: {} }, good(continuity)],
      [bad, bad],
      [good(valid.history), { status: 401, payload: {} }],
      [bad, bad],
      [bad, good({ ...continuity, intervals: [['bad', 'bad']] })],
      [good(valid.history), good(continuity), true],
      [good(valid.history), good(continuity)],
    ];
    const states = {};
    for (const mode of ['worker', 'fallback']) for (const sidecarFirst of [false, true]) await t.test(`${mode} / ${sidecarFirst ? 'Continuity first' : 'History first'}`, async t => {
      const b = await board(t, mode, sidecarFirst), key = `${mode}/${sidecarFirst}`;
      const frozen = structuredClone(b.feed.select()), markup = b.doc.getElementById('app').innerHTML;
      states[key] = [];
      for (const [history, sidecar, resultsFailed] of table) {
        await b.poll(history, sidecar); await b.poll(history, sidecar);
        // All other feeds succeed together; neither order nor sibling matters.
        for (const [url, payload] of Object.entries(responses)) if (!['history.json', 'history-continuity.json'].includes(url)) b.replies.set(url, good(payload));
        const next = structuredClone(valid.data); next.seq++; next.brokerAccount.equity.amount = '29001';
        b.replies.set('state.json', good({ serverNow: next.receivedAt, feeds: { data: { value: next } } }));
        if (resultsFailed) b.replies.set('results.json', bad);
        await b.feed.refresh(); await b.feed.refreshActions();
        b.session.accept('/joe/board-settings.json', good(responses['board-settings.json']));
        b.session.accept('/joe/account-history.json', good(responses['account-history.json']));
        states[key].push(b.session.signedOut());
        assert.equal(b.session.signedOut(), true);
        assert.deepEqual(b.feed.select(), frozen);
        assert.equal(b.doc.getElementById('app').innerHTML, markup);
        assert.equal(b.doc.getElementById('app').hasAttribute('inert'), true);
        assert.equal(b.doc.getElementById('signedOutBanner').hidden, false);
      }
    });
    assert.deepEqual(states['worker/false'], states['fallback/false']);
    assert.deepEqual(states['worker/true'], states['fallback/true']);
    assert.deepEqual(states['worker/false'], states['worker/true']);
  });
  for (const endpoint of Object.keys(responses)) test(`JOED-173 fix15 any protected read freezes until reload: ${endpoint}`, async () => {
    const key = `/joe/${endpoint}`, session = createBoardSession();
    session.observe(key, { auth: true });
    for (const r of [good({}), { status: 200, body: '<form>Sign in</form>' }, { status: 200, body: '{bad' },
      { status: 200, payload: responses[endpoint], crossedOrigin: true }, { status: 304 }, bad, good(responses[endpoint])]) {
      const result = await readJSON(key, {}, { fetcher: async () => response(r) });
      assert.equal(session.accept(key, result), false);
      assert.equal(session.signedOut(), true);
    }
    assert.equal(createBoardSession().signedOut(), false, 'a new document has a new session');
  });
}
