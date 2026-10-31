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
  let response = { status: 200, payload: valid[kind] }, continuity = { status: 200, payload: null };
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
  let release;
  const stop = session.coordinateRecovery(() => new Promise(done => { release = done; }), kind === 'history' ? [path, sidecar] : [path]);
  t.after(() => { release?.(); stop(); });
  return { feed, session, doc, messages, refresh, path,
    fallback: async () => { activeWorker.onerror(); await feed.whenIdle(); assert.equal(feed.usesWorker(), false); },
    set: r => { response = r; }, sidecar: r => { continuity = r; },
    transform: fn => { transform = fn; },
    expire: () => session.observe(path, { auth: true }),
    finish: () => session.finishRecovery(() => { feed.select(); freeze.rendered(valid[kind].receivedAt); return true; }),
  };
}
// Importing this module in the worker installs hooks only, never starts nested tests.
if (!process.env.JOED_FIX7_WORKER) {
  for (const kind of ['history', 'results']) for (const mode of ['worker', 'fallback', 'disabled'])
    test(`JOED-173 fix9 ${kind} cold ${mode} retains a validated sequence_replayed body without proving recovery`, async t => {
      const b = await board(t, kind, { cold: true, mode });
      assert.equal(b.feed.feeds[kind], null);
      b.set({ status: 200, payload: valid[kind], headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } });
      if (mode === 'fallback') await b.fallback(); else await b.refresh();
      const retained = b.feed.feeds[kind].value;
      assert.ok(retained, 'a cold client retains the validated last-good body');
      assert.equal(retained.seq, valid[kind].seq);
      assert.equal(retained.receivedAt, valid[kind].receivedAt);
      assert.equal(b.feed.feeds[kind].reason, 'sequence_replayed');
      assert.equal(b.feed.select().states[kind].state, 'stale');
      const newer = { ...valid[kind], seq: retained.seq + 1 };
      b.set({ status: 200, payload: newer, headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } });
      await b.refresh();
      assert.equal(b.feed.feeds[kind].value.seq, newer.seq, 'a failure label alone does not reject a newer last-good body');
      b.set({ status: 200, payload: valid[kind], headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } });
      await b.refresh();
      assert.equal(b.feed.feeds[kind].value.seq, newer.seq, 'an actual regression preserves the retained document');
      assert.equal(b.feed.feeds[kind].value.receivedAt, retained.receivedAt);
      b.expire(); await b.refresh();
      assert.equal(b.finish(), false, 'a server failure label cannot prove recovery');
      assert.equal(b.session.signedOut(), true);
      assert.equal(b.feed.feeds[kind].value.seq, newer.seq);
      b.set({ status: 200, payload: newer, headers: { 'X-Joe-Feed-Reason': 'sequence_replayed' } }); await b.refresh();
      assert.equal(b.finish(), false, 'an equal retained body with a server failure still cannot recover');
      b.set({ status: 200, payload: newer }); await b.refresh();
      assert.equal(b.finish(), true, 'a later clean equal document can recover');
      assert.equal(b.feed.select().states[kind].state, 'fresh');
    });
  test('JOED-173 fix7 history recovery resends the document discarded across a continuity 503 and null-200 replay', async t => {
    const b = await board(t, 'history'); b.expire();
    const newer = { ...valid.history, seq: valid.history.seq + 1 };
    b.set({ status: 200, payload: newer }); b.sidecar({ status: 503, payload: {} }); await b.refresh();
    assert.equal(b.finish(), false);
    b.sidecar({ status: 200, payload: null }); await b.refresh();
    assert.equal(b.finish(), true);
    assert.equal(b.feed.feeds.history.value.seq, newer.seq, 'new history must be in the page store before removing stale marks');
    assert.equal(b.doc.querySelectorAll('[data-frozen]').length, 0);
  });
  test('JOED-173 fix7 Results recovery never loses refresh_failed on an unchanged cached document', async t => {
    const b = await board(t, 'results'); b.expire();
    b.set({ status: 503, payload: {} }); await b.refresh();
    b.set({ status: 200, payload: valid.results, headers: { 'X-Joe-Feed-Reason': 'refresh_failed' } }); await b.refresh();
    b.finish();
    assert.equal(b.feed.feeds.results.reason, 'refresh_failed');
    assert.equal(boardStates(b.feed.feeds, valid.results.receivedAt).results.state, 'broken', 'failed Results retain their normal failure state under frozen marks');
    assert.equal(b.session.signedOut(), true, 'failure is not authenticated successful recovery evidence');
  });
  for (const kind of ['history', 'results']) {
    for (const shape of ['missing status', 'missing auth', 'unchanged wrong document']) test(`JOED-173 fix7 ${kind} message arrival alone cannot prove recovery: ${shape}`, async t => {
      const b = await board(t, kind); b.expire();
      b.transform(data => {
        if (shape === 'missing status') { delete data.status; return data; }
        if (shape === 'missing auth') { delete data.status[b.path].auth; return data; }
        return { ...data, kind: 'unchanged', feed: kind, status: { ...data.status,
          [b.path]: { ...data.status[b.path], document: { seq: valid[kind].seq + 1, receivedAt: valid[kind].receivedAt } } } };
      });
      await b.refresh();
      assert.equal(b.finish(), false);
      assert.equal(b.session.signedOut(), true);
      assert.ok(b.doc.querySelectorAll('[data-frozen]').length);
      b.transform(data => data); await b.refresh(); assert.equal(b.finish(), true);
    });
    test(`JOED-173 fix7 ${kind} accepts equal sequence and receipt on recovery`, async t => {
      const b = await board(t, kind); b.expire(); await b.refresh();
      assert.equal(b.finish(), true);
      assert.equal(b.feed.select().states[kind].state, 'fresh');
      assert.equal(b.doc.querySelectorAll('[data-frozen]').length, 0);
    });
    for (const frozen of [false, true]) test(`JOED-173 fix7 ${kind} rejects a newer sequence with an older receipt, frozen=${frozen}`, async t => {
      const b = await board(t, kind), original = valid[kind]; if (frozen) b.expire();
      b.set({ status: 200, payload: { ...original, seq: original.seq + 1, receivedAt: new Date(Date.parse(original.receivedAt) - 1000).toISOString() } });
      await b.refresh();
      assert.equal(b.finish(), false);
      assert.equal(b.session.signedOut(), frozen);
      assert.equal(b.messages.at(-1).status[b.path].reason, 'sequence_replayed');
      assert.equal(b.feed.feeds[kind].value.seq, original.seq);
      assert.equal(Boolean(b.doc.querySelectorAll('[data-frozen]').length), frozen);
    });
    for (const mode of ['worker', 'fallback']) for (const failure of ['503', 'header failure', 'malformed', 'replay', 'receivedAt regression']) test(`JOED-173 fix7 ${kind} latest ${failure} retains its reason after an earlier authenticated success, ${mode}`, async t => {
      const b = await board(t, kind), original = valid[kind];
      if (mode === 'fallback') await b.fallback();
      b.expire(); await b.refresh();
      b.set({ status: failure === '503' ? 503 : 200,
        payload: failure === 'malformed' ? { schema: original.schema } : { ...original,
          seq: original.seq + (failure === 'receivedAt regression' ? 1 : failure === 'replay' ? -1 : 0),
          receivedAt: failure === 'receivedAt regression' ? new Date(Date.parse(original.receivedAt) - 1000).toISOString() : original.receivedAt },
        headers: failure === 'header failure' ? { 'X-Joe-Feed-Reason': 'refresh_failed' } : {} });
      await b.refresh();
      assert.equal(b.finish(), true, 'a non-auth failure cannot revoke earlier authentication');
      assert.equal(b.session.signedOut(), false);
      assert.equal(b.doc.querySelectorAll('[data-frozen]').length, 0);
      assert.equal(b.feed.select().states[kind].reason, ['replay', 'receivedAt regression'].includes(failure) ? 'sequence_replayed' : failure === 'malformed' ? 'contract_invalid' : 'refresh_failed');
      assert.equal(b.feed.feeds[kind].value.seq, original.seq);
      assert.equal(b.feed.feeds[kind].value.receivedAt, original.receivedAt);
      if (mode === 'worker') assert.equal(b.messages.at(-1).status[b.path].state, 'error');
      b.set({ status: 200, payload: original }); await b.refresh();
      assert.equal(b.finish(), false, 'already recovered; a valid equal document clears the feed failure');
      assert.equal(b.feed.select().states[kind].state, 'fresh');
    });
    test(`JOED-173 fix7 ${kind} unchanged errors preserve their reason on every reply`, async t => {
      const b = await board(t, kind);
      b.set({ status: 200, payload: valid[kind], headers: { 'X-Joe-Feed-Reason': 'refresh_failed' } });
      await b.refresh(); await b.refresh();
      assert.equal(b.messages.at(-1).kind, 'unchanged');
      assert.equal(b.messages.at(-1).reason, 'refresh_failed');
      assert.equal(b.feed.select().states[kind].state, 'broken');
      assert.equal(b.feed.select().states[kind].reason, 'refresh_failed');
      assert.equal(b.session.signedOut(), false);
    });
  }
  for (const kind of ['history', 'results']) {
    test(`JOED-173 fix8 fallback ${kind} cannot recover a newer sequence with an older receivedAt after worker.onerror`, async t => {
      const b = await board(t, kind), original = valid[kind];
      b.set({ status: 401, payload: {} }); await b.refresh();
      assert.equal(b.session.signedOut(), true);
      b.set({ status: 200, payload: { ...original, seq: original.seq + 1,
        receivedAt: new Date(Date.parse(original.receivedAt) - 1000).toISOString() } });
      await b.fallback();
      assert.equal(b.finish(), false, 'receipt regression cannot end sign-out');
      assert.equal(b.session.signedOut(), true);
      assert.equal(b.feed.feeds[kind].value.seq, original.seq);
      assert.equal(b.feed.feeds[kind].value.receivedAt, original.receivedAt);
      assert.equal(b.feed.feeds[kind].reason, 'sequence_replayed');
      assert.ok(b.doc.querySelectorAll('[data-frozen]').length);
      b.set({ status: 200, payload: original }); await b.refresh();
      assert.equal(b.finish(), true, 'a later equal valid document can recover');
      assert.equal(b.feed.select().states[kind].state, 'fresh');
    });
  }
  for (const mode of ['worker', 'fallback']) for (const kind of ['history', 'results'])
    for (const outcome of ['ok newer', 'ok replay', 'receivedAt regression', '401', '503', 'malformed']) for (const frozen of [false, true])
    test(`JOED-173 fix8 worker/fallback matrix: ${mode} / ${kind} / ${outcome} / frozen=${frozen}`, async t => {
      const b = await board(t, kind), original = valid[kind];
      if (frozen) b.expire();
      const ok = outcome === 'ok newer';
      const replay = outcome === 'ok replay' || outcome === 'receivedAt regression';
      const reason = outcome === '401' ? 'auth_required' : ok ? null : replay ? 'sequence_replayed' : outcome === 'malformed' ? 'contract_invalid' : 'refresh_failed';
      b.set({ status: outcome === '401' ? 401 : outcome === '503' ? 503 : 200,
        payload: outcome === 'malformed' ? { schema: original.schema } : { ...original,
          seq: original.seq + (ok || outcome === 'receivedAt regression' ? 1 : replay ? -1 : 0),
          receivedAt: outcome === 'receivedAt regression' ? new Date(Date.parse(original.receivedAt) - 1000).toISOString() : original.receivedAt } });
      if (mode === 'fallback') await b.fallback(); else await b.refresh();
      const recovered = b.finish();
      assert.equal(recovered, frozen && ok);
      const signedOut = outcome === '401' || (frozen && !ok);
      assert.equal(b.session.signedOut(), signedOut);
      assert.equal(b.doc.getElementById('app').hasAttribute('data-last-known'), signedOut);
      assert.equal(Boolean(b.doc.querySelectorAll('[data-frozen]').length), signedOut);
      if (mode === 'worker') {
        const status = b.messages.at(-1).status?.[b.path];
        assert.equal(status?.state, outcome === '401' ? 'auth' : ok ? 'ok' : 'error');
        assert.equal(status.reason, reason);
      }
      const cell = b.feed.select().states[kind];
      if (!signedOut) {
        assert.equal(cell.state, ok ? 'fresh' : replay ? 'stale' : 'broken');
        assert.equal(cell.reason, reason);
        assert.equal(b.feed.feeds[kind].value.seq, original.seq + (ok ? 1 : 0));
        assert.equal(b.feed.feeds[kind].value.receivedAt, original.receivedAt, 'errors and replays never freshen receipts');
      } else assert.equal(b.feed.select().feeds[kind].value.seq, original.seq, 'frozen selection retains the original document');
    });
}
