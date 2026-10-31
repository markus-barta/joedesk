import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { Worker as NodeWorker } from 'node:worker_threads';
import { htmlDocument } from './fixtures/preview-dom.mjs';
// Replay the production modules under repair, without another checkout.
if (process.env.JOED_FIX7_BASELINE) registerHooks({ load(url, context, next) {
  const name = new URL(url).pathname.split('/').at(-1);
  if (url.startsWith('file:') && url.includes('/public/joe/') && ['feed.js', 'history-worker.js', 'transport.js'].includes(name))
    return { format: 'module', source: execFileSync('git', ['show', `${process.env.JOED_FIX7_BASELINE}:public/joe/${name}`], { encoding: 'utf8' }), shortCircuit: true };
  return next(url, context);
} });
const { createFeed } = await import('../public/joe/feed.js');
const { createBoardSession } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const { boardStates } = await import('../public/joe/board-state.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));

async function board(t, kind, { cold = false, mode = 'worker' } = {}) {
  const path = `/joe/${kind}.json`, sidecar = '/joe/history-continuity.json';
  const session = createBoardSession(), messages = [], workers = [];
  let transform = data => data, activeWorker;
  let response = { status: 200, payload: valid[kind] }, continuity = { status: 200, payload: { schema: 'joedesk.history-continuity.v1', historySeq: valid.history.seq, intervals: [] } };
  t.mock.method(globalThis, 'fetch', async url => {
    const route = String(url).split('/').at(-1);
    const r = route === 'history-continuity.json' ? continuity : route === `${kind}.json` ? response
      : { status: 200, payload: valid[route.replace('.json', '')] };
    return new Response(r.body ?? JSON.stringify(r.payload), { status: r.status,
      headers: { 'X-Joe-Server-Now': valid[kind].receivedAt, ...r.headers } });
  });
  const old = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = class {
    constructor() {
      if (mode === 'disabled') throw new Error('Module workers unavailable');
      activeWorker = this;
      const boot = `import { parentPort } from 'node:worker_threads';
        import ${JSON.stringify(import.meta.url)};
        const requests = new Map(); let serial = 0;
        globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
        globalThis.fetch = url => new Promise(resolve => { const id = ++serial; requests.set(id, resolve); parentPort.postMessage({ request: id, url: String(url) }); });
        const ready = import(${JSON.stringify(new URL('../public/joe/history-worker.js', import.meta.url).href)});
        parentPort.on('message', async data => {
          if (data.response) { requests.get(data.response)(new Response(data.body, { status: data.status, headers: data.headers })); requests.delete(data.response); }
          else { await ready; self.onmessage({ data }); }
        });`;
      this.node = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(boot)}`), { env: { ...process.env, JOED_FIX7_WORKER: '1' } }); workers.push(this.node);
      this.node.on('message', data => {
        if (data.request) {
          const r = data.url.endsWith('history-continuity.json') ? continuity : response;
          this.node.postMessage({ response: data.request, status: r.status, body: r.body ?? JSON.stringify(r.payload), headers: { 'X-Joe-Server-Now': valid[kind].receivedAt, ...r.headers } });
        } else { messages.push(data); this.onmessage?.({ data: transform(data) }); }
      });
      this.node.on('error', e => { throw e; });
    }
    postMessage(data) { this.node.postMessage(data); }
    terminate() { return this.node.terminate(); }
  };
  t.after(async () => { await Promise.all(workers.map(w => w.terminate())); if (old) Object.defineProperty(globalThis, 'Worker', old); else delete globalThis.Worker; });
  const feed = createFeed(() => {}, () => {}, '', { session }); t.after(feed.stop);
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const freeze = createBoardFreeze(doc, session); t.after(freeze.stop);
  const refresh = () => kind === 'history' ? feed.refreshHistory() : feed.refreshResults();
  if (!cold) await refresh();
  feed.select(); freeze.rendered(valid[kind].receivedAt);
  return { feed, session, doc, messages, refresh, path,
    fallback: async () => { activeWorker.onerror(); await feed.whenIdle(); assert.equal(feed.usesWorker(), false); },
    set: r => { response = r; }, sidecar: r => { continuity = r; },
    transform: fn => { transform = fn; },
    expire: () => session.observe(path, { auth: true }),
  };
}
// Importing this module in the worker installs hooks only.
if (!process.env.JOED_FIX7_WORKER) {
  for (const kind of ['history', 'results']) for (const mode of ['worker', 'fallback', 'disabled'])
  test(`JOED-173 fix9 ${kind} cold ${mode} retains validated rejected bodies and equal re-serves`, async t => {
    const b = await board(t, kind, { cold: true, mode });
    b.set({ status: 200, payload: valid[kind], headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } });
    if (mode === 'fallback') await b.fallback(); else await b.refresh();
    const retained = b.feed.feeds[kind].value;
    assert.ok(retained); assert.equal(retained.seq, valid[kind].seq);
    assert.equal(retained.receivedAt, valid[kind].receivedAt);
    assert.equal(b.feed.feeds[kind].reason, 'sequence_replayed');
    assert.equal(b.feed.select().states[kind].state, 'stale');
    const newer = { ...valid[kind], seq: retained.seq + 1 };
    b.set({ status: 200, payload: newer, headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } }); await b.refresh();
    assert.equal(b.feed.feeds[kind].value.seq, newer.seq);
    b.set({ status: 200, payload: valid[kind] }); await b.refresh();
    assert.equal(b.feed.feeds[kind].value.seq, newer.seq);
    assert.equal(b.feed.feeds[kind].reason, 'sequence_replayed');
    b.set({ status: 200, payload: newer }); await b.refresh(); await b.refresh();
    assert.equal(b.feed.select().states[kind].state, 'fresh', 'equal receipt and sequence is a valid re-serve');
    const frozen = structuredClone(b.feed.select()); b.expire(); await b.refresh();
    assert.equal(b.session.signedOut(), true); assert.deepEqual(b.feed.select(), frozen);
  });
  for (const mode of ['worker', 'fallback']) for (const kind of ['history', 'results'])
  for (const outcome of ['ok newer', 'ok replay', 'receivedAt regression', '401', '503', 'malformed', 'header failure']) for (const frozen of [false, true])
  test(`JOED-173 fix15 worker/fallback retention: ${mode} / ${kind} / ${outcome} / frozen=${frozen}`, async t => {
    const b = await board(t, kind), original = valid[kind], before = structuredClone(b.feed.select());
    if (frozen) b.expire();
    const ok = outcome === 'ok newer', replay = ['ok replay', 'receivedAt regression'].includes(outcome);
    const reason = outcome === '401' ? 'auth_required' : ok ? null : replay ? 'sequence_replayed' : outcome === 'malformed' ? 'contract_invalid' : 'refresh_failed';
    b.set({ status: outcome === '401' ? 401 : outcome === '503' ? 503 : 200,
      payload: outcome === 'malformed' ? { schema: original.schema } : { ...original,
        seq: original.seq + (ok || outcome === 'receivedAt regression' ? 1 : replay ? -1 : 0),
        receivedAt: outcome === 'receivedAt regression' ? new Date(Date.parse(original.receivedAt) - 1000).toISOString() : original.receivedAt },
      headers: outcome === 'header failure' ? { 'X-Joe-Feed-Reason': 'refresh_failed' } : {} });
    if (mode === 'fallback') await b.fallback(); else await b.refresh();
    const signedOut = frozen || outcome === '401';
    assert.equal(b.session.signedOut(), signedOut);
    assert.equal(b.doc.getElementById('app').hasAttribute('data-last-known'), signedOut);
    if (signedOut) assert.deepEqual(b.feed.select(), before);
    else {
      assert.equal(b.feed.select().states[kind].state, ok ? 'fresh' : replay ? 'stale' : 'broken');
      assert.equal(b.feed.select().states[kind].reason, reason);
      assert.equal(b.feed.feeds[kind].value.seq, original.seq + (ok ? 1 : 0));
      assert.equal(b.feed.feeds[kind].value.receivedAt, original.receivedAt);
    }
  });
  for (const kind of ['history', 'results']) test(`JOED-173 fix15 ${kind} crash keeps the page ordering floor on an older receipt`, async t => {
    const b = await board(t, kind), original = valid[kind];
    b.set({ status: 200, payload: { ...original, seq: original.seq + 1,
      receivedAt: new Date(Date.parse(original.receivedAt) - 1000).toISOString() } });
    await b.fallback();
    assert.equal(b.feed.feeds[kind].value.seq, original.seq);
    assert.equal(b.feed.feeds[kind].value.receivedAt, original.receivedAt);
    assert.equal(b.feed.feeds[kind].reason, 'sequence_replayed');
    b.set({ status: 200, payload: original }); await b.refresh();
    assert.equal(b.feed.select().states[kind].state, 'fresh');
  });
  for (const kind of ['history', 'results']) test(`JOED-173 fix7 ${kind} unchanged errors preserve their reason on every reply`, async t => {
    const b = await board(t, kind);
    b.set({ status: 200, payload: valid[kind], headers: { 'X-Joe-Feed-Reason': 'refresh_failed' } });
    await b.refresh(); await b.refresh();
    assert.equal(b.messages.at(-1).kind, 'unchanged');
    assert.equal(b.messages.at(-1).reason, 'refresh_failed');
    assert.equal(b.feed.select().states[kind].reason, 'refresh_failed');
    assert.equal(b.session.signedOut(), false);
  });
}
