import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { htmlDocument, builders } from './fixtures/preview-dom.mjs';
const { createBoardSession, boardSession } = await import('../public/joe/transport.js');
const { createBoardFreeze } = await import('../public/joe/presentation.js');
const { createBoardSettings } = await import('../public/joe/board-settings-write.js');
const { sendFleetDraft } = await import('../public/joe/fleet-write.js');
const { sendOutcome } = await import('../public/joe/settings-model.js');
const valid = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const keys = ['state', 'history', 'history-continuity', 'results', 'account-history', 'board-settings', 'fleet-config', 'fleet-config/actions'].map(s => `/joe/${s}.json`);
const good = { evidence: 'AUTHENTICATED', status: 200, auth: false };
function recovering(t, session = createBoardSession()) {
  const stop = session.coordinateRecovery(async () => {});
  t.after(() => { stop(); for (const key of [...keys, 'expiry']) session.observe(key, good); });
  session.observe('expiry', { auth: true });
  return session;
}
for (const key of keys) for (const status of [undefined, 401, 503, 404, 0]) test(`JOED-173 fix13 latest auth refusal gates recovery for ${key}, failure=${status}`, async t => {
  const s = recovering(t);
  for (const other of keys) if (other !== key) s.accept(other, good);
  s.observe('expiry', good);
  if (status !== undefined) s.accept(key, { status, ...(status === 401 ? { auth: true } : {}) });
  let painted = false;
  const refused = status === 401;
  assert.equal(s.finishRecovery(() => { painted = true; }), !refused);
  assert.equal(painted, !refused); assert.equal(s.signedOut(), refused);
});
test('JOED-173 fix13 account-history failure before its first authenticated success keeps its own reason', async t => {
  const A = await builders('account.js', ['useReply', 'store'], 'fix6-first-failure');
  const s = recovering(t, boardSession);
  for (const key of keys) if (!key.endsWith('/account-history.json')) s.accept(key, good);
  s.observe('expiry', good);
  A.useReply({ kind: 'account', status: 503, reason: 'refresh_failed', value: null });
  assert.equal(A.store.reason, 'refresh_failed');
  assert.equal(s.finishRecovery(() => true), true);
  assert.equal(s.signedOut(), false);
});
test('JOED-173 fix6 account-history 503 after an authenticated success exposes the honest reason after recovery', async t => {
  const A = await builders('account.js', ['useReply', 'store'], 'fix6-reason');
  const s = recovering(t, boardSession);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  assert.equal(A.useReply({ kind: 'account', status: 503, reason: 'refresh_failed', value: null }), false);
  assert.equal(A.store.reason, 'refresh_failed');
  assert.equal(s.finishRecovery(() => true), true);
});
test('JOED-173 fix6 pending account-start save is abandoned and a recovery GET runs before its POST completes', async t => {
  let release, reads = 0, body = { accountStart: { amountEur: 100, date: '2026-01-01' }, reason: null };
  const client = createBoardSettings({ fetcher: async (_, init) => init.method === 'POST'
    ? new Promise(done => { release = done; }) : (reads++, new Response(JSON.stringify(body))) });
  t.after(() => client.stop?.());
  await client.refresh();
  const pending = client.save({ accountStart: { amountEur: 200, date: '2026-01-01' } });
  const s = recovering(t, boardSession);
  body = { accountStart: { amountEur: 200, date: '2026-01-01' }, reason: null };
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  try {
    assert.deepEqual(await client.refresh(), { ok: true });
    assert.equal(reads, 2); assert.equal(client.accountStart().amountEur, 200);
    assert.equal(s.finishRecovery(() => true), true);
  } finally { release(new Response(JSON.stringify({ ok: true, accountStart: { amountEur: 999, date: '2026-01-01' }, reason: null }))); }
  assert.equal((await pending).abandoned, true);
  assert.equal(client.accountStart().amountEur, 200, 'late POST cannot replace the refetched baseline');
});
test('JOED-173 fix6 collapsed Positions and Kept holdings headers and the calendar total carry frozen marks', t => {
  const doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const s = createBoardSession(), freeze = createBoardFreeze(doc, s); t.after(freeze.stop);
  s.observe('expiry', { auth: true });
  for (const id of ['positionsTitle', 'keptTitle', 'calSum']) {
    const node = doc.getElementById(id);
    assert.ok(node.closest('[data-frozen]'), `${id}: section marking must include its header`);
  }
});
for (const pending of [false, true]) test(`JOED-173 fix6 version feedback and clipboard completion are neutralized at freeze, pending=${pending}`, async t => {
  const doc = htmlDocument('<button id="versionMode"></button><span data-product-version="261030154842.0.0" data-version-scheme="inspr-calver-3"></span>');
  let release, fallback = 0, invalidTimerReceivers = 0, stopVersion;
  for (const node of [doc, ...doc.querySelectorAll('*')]) {
    node.ownerDocument = doc;
    const listeners = new Map(); node.addEventListener = (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    node.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(f => f !== fn));
    node.fire = type => { for (const fn of listeners.get(type) ?? []) fn({ target: node, pointerType: 'mouse' }); };
  }
  const make = () => {
    const node = htmlDocument('<span></span>').querySelector('span');
    node.ownerDocument = doc; node.append = (...nodes) => { for (const n of nodes) { n.parentElement = node; node.children.push(n); } };
    node.replaceChildren = (...nodes) => { node.children = []; node.append(...nodes); };
    node.remove = () => { node.parentElement.children = node.parentElement.children.filter(n => n !== node); };
    node.addEventListener = () => {}; node.removeEventListener = () => {}; node.focus = () => {}; node.select = () => {};
    return node;
  };
  doc.createElement = make;
  for (const node of doc.querySelectorAll('*')) {
    node.append = (...nodes) => { for (const n of nodes) { n.parentElement = node; node.children.push(n); } };
    node.replaceChildren = (...nodes) => { node.children = []; node.append(...nodes); };
  }
  doc.execCommand = () => { fallback++; return false; };
  const hostAttributes = doc.querySelector('[data-product-version]').attributes;
  Object.defineProperty(hostAttributes, Symbol.iterator, { value: function* () { for (const [name, value] of Object.entries(this)) yield { name, value }; } });
  const old = new Map(['document', 'getComputedStyle', 'MutationObserver', 'matchMedia', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { stopVersion?.(); boardSession.observe('version', good); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  Object.defineProperties(globalThis, {
    document: { value: doc, configurable: true }, getComputedStyle: { value: () => ({ getPropertyValue: () => '#aa9900' }), configurable: true },
    MutationObserver: { value: class { observe() {} }, configurable: true }, matchMedia: { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true },
    navigator: { value: { clipboard: { writeText: () => pending ? new Promise((_, reject) => { release = reject; }) : Promise.resolve() } }, configurable: true },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const key of ['setTimeout', 'clearTimeout']) {
    const timer = globalThis[key];
    t.mock.method(globalThis, key, function (...args) { if (this !== globalThis) invalidTimerReceivers++; return Reflect.apply(timer, globalThis, args); });
  }
  const V = await import(`../public/joe/version-display.js?fix6-${pending}`); stopVersion = V.initVersionDisplay();
  const host = doc.querySelector('[data-product-version]'); host.fire('click');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  boardSession.observe('version', { auth: true });
  const atFreeze = JSON.stringify([host.attributes, host.dataset, host.innerHTML, host.textContent]);
  if (pending) release(new Error('clipboard refused after freeze'));
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(3000);
  assert.equal(JSON.stringify([host.attributes, host.dataset, host.innerHTML, host.textContent]), atFreeze);
  assert.equal(invalidTimerReceivers, 0, 'browser timers require the global receiver');
  assert.equal(fallback, 0, 'late clipboard failure cannot create fallback UI');
  assert.equal(host.dataset.copyState, undefined);
  stopVersion?.(); boardSession.observe('version', good);
});
test('JOED-173 fix6 malformed non-auth 200 fleet POST keeps exact request rejected wording', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{broken'));
  const answer = await sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  assert.equal(sendOutcome(answer.status, answer.body, []).reason, 'request rejected');
});
for (const status of [503, 404, 0]) test(`JOED-173 fix6 every authenticated feed may report its normal later non-auth error: ${status}`, t => {
  const s = recovering(t);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  for (const key of keys) assert.equal(s.accept(key, { status }), true, key);
  assert.equal(s.finishRecovery(() => true), true);
});
test('JOED-173 fix6 pre-freeze successes and a later auth failure cannot satisfy recovery', t => {
  const s = createBoardSession();
  for (const key of keys) s.observe(key, good);
  recovering(t, s);
  assert.equal(s.finishRecovery(() => true), false);
  s.observe('expiry', good);
  for (const key of keys) s.accept(key, good);
  s.accept('/joe/account-history.json', { status: 401, auth: true });
  assert.equal(s.finishRecovery(() => true), false);
});
test('JOED-173 fix6 all feed documents render under frozen section marks before the single unmark', t => {
  const s = recovering(t), doc = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  const freeze = createBoardFreeze(doc, s); t.after(freeze.stop);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  assert.equal(s.finishRecovery(() => {
    for (const [i, key] of keys.entries()) {
      assert.equal(doc.getElementById('app').hasAttribute('data-last-known'), true);
      assert.equal(doc.getElementById('acctHero').hasAttribute('data-frozen'), true);
      doc.getElementById('acctHero').textContent += `${key}: fresh ${i}; `;
    }
    freeze.rendered('2026-10-31T01:00:00Z'); return true;
  }), true);
  assert.equal(doc.getElementById('app').hasAttribute('data-last-known'), false);
  assert.equal(doc.querySelectorAll('[data-frozen]').length, 0);
});
test('JOED-173 fix6 in-flight fleet POST is abandoned even when its response arrives after recovery', async t => {
  let release;
  t.mock.method(globalThis, 'fetch', () => new Promise(done => { release = done; }));
  const pending = sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  const s = recovering(t, boardSession);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  assert.equal(s.finishRecovery(() => true), true);
  release(new Response(JSON.stringify({ ok: true })));
  assert.equal((await pending).abandoned, true);
});
test('JOED-173 fix6 fleet submission auth is cleared by a fully refreshed fleet read', async t => {
  const s = boardSession, stop = s.coordinateRecovery(async () => {}); t.after(() => { stop(); for (const key of [...keys, '/joe/fleet-config/propagate']) s.observe(key, good); });
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await sendFleetDraft(valid['fleet-config'].rev, valid['fleet-config']);
  for (const key of keys) s.accept(key, good);
  assert.equal(s.finishRecovery(() => true), true);
});
for (const threaded of [false, true]) test(`JOED-173 fix6 browser sequence recovers after state-only 401 with real worker messages, threaded=${threaded}`, async t => {
  const { createFeed } = await import('../public/joe/feed.js');
  const { history: accountHistory } = await import('./fixtures/account-fixtures.mjs');
  const A = await builders('account.js', ['store'], 'fix6-browser-worker');
  const B = await import('../public/joe/board-settings.js');
  const old = new Map(['self', 'Worker', 'JoeVersion'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  let worker, expired = false, only = null, task = Promise.resolve();
  globalThis.self = { postMessage: data => queueMicrotask(() => worker.onmessage({ data })) };
  await import('../public/joe/history-worker.js?fix6-browser-sequence'); const handle = self.onmessage;
  const workers = [];
  if (threaded) {
    globalThis.JoeVersion = { APP_VERSION: 'test' };
    globalThis.Worker = class {
      constructor(url) {
        const entry = new URL(`../public/joe/${url.pathname.endsWith('account-worker.js') ? 'account-worker.js' : 'history-worker.js'}`, import.meta.url).href;
        const boot = `import { parentPort } from 'node:worker_threads';
          import ${JSON.stringify(new URL('./fixtures/preview-dom.mjs', import.meta.url).href)};
          const requests = new Map(); let serial = 0;
          globalThis.self = { postMessage: (data, transfer) => parentPort.postMessage(data, transfer) };
          globalThis.fetch = url => new Promise(resolve => { const id = ++serial; requests.set(id, resolve); parentPort.postMessage({ request: id, url: String(url) }); });
          const ready = import(${JSON.stringify(entry)});
          parentPort.on('message', async data => {
            if (data.response) { requests.get(data.response)(new Response(data.body, { status: data.status, headers: data.headers })); requests.delete(data.response); }
            else { await ready; self.onmessage({ data }); }
          });`;
        this.node = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(boot)}`)); workers.push(this.node);
        this.node.on('message', async data => {
          if (data.request) {
            const response = await fetch(data.url);
            this.node.postMessage({ response: data.request, body: await response.text(), status: response.status, headers: [...response.headers] });
          } else this.onmessage?.({ data });
        });
        this.node.on('error', error => this.onerror?.(error));
      }
      postMessage(data) { this.node.postMessage(data); }
      terminate() { return this.node.terminate(); }
    };
    t.after(async () => { A.forgetAccountWorker(); await Promise.all(workers.map(w => w.terminate())); });
  } else globalThis.Worker = class { constructor() { worker = this; } postMessage(data) { queueMicrotask(() => handle({ data })); } terminate() {} };
  t.mock.method(globalThis, 'fetch', async url => {
    const path = String(url).split('/').at(-1);
    if (expired && (!only || only === path)) return new Response('{}', { status: 401 });
    const payload = path === 'state.json' ? { serverNow: valid.data.receivedAt, feeds: { data: { value: valid.data } }, panels: {} }
      : path === 'history.json' ? valid.history : path === 'results.json' ? valid.results : path === 'fleet-config.json' ? valid['fleet-config']
      : path === 'actions.json' ? { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] }
      : path === 'board-settings.json' ? { accountStart: { amountEur: 100000, date: '2026-01-01' }, reason: null }
      : path === 'account-history.json' ? accountHistory() : {};
    return new Response(JSON.stringify(payload), { headers: { 'X-Joe-Received-At': valid.data.receivedAt } });
  });
  const feed = createFeed(() => {}, () => {}, '', { session: boardSession }); t.after(feed.stop);
  const events = [], accept = boardSession.accept.bind(boardSession);
  t.mock.method(boardSession, 'accept', (key, response) => { const accepted = accept(key, response); events.push(['accept', key, response.auth, response.status, accepted]); return accepted; });
  const refresh = () => Promise.all([feed.refresh(), feed.refreshActions(), A.refreshAccountHistory(), B.refreshBoardSettings()]);
  await refresh();
  const stop = boardSession.coordinateRecovery(() => (task = (async () => {
    await Promise.all([feed.whenIdle(), A.accountHistoryIdle()]);
    await refresh();
    events.push(['finish', boardSession.finishRecovery(() => true)]);
  })()));
  t.after(() => { stop(); for (const key of keys) boardSession.observe(key, good); });
  expired = true; await B.refreshBoardSettings();
  only = 'state.json'; await refresh(); await task;
  assert.equal(boardSession.signedOut(), true);
  expired = false; await refresh(); await task;
  assert.equal(boardSession.signedOut(), false, JSON.stringify(events));
});
test('JOED-173 fix6 late authenticated success supersedes an earlier 401 in the same recovery attempt', t => {
  const s = recovering(t);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  s.accept('/joe/state.json', { status: 401, auth: true });
  assert.equal(s.finishRecovery(() => true), false, 'the outstanding 401 keeps the board frozen');
  s.accept('/joe/state.json', good);
  assert.equal(s.finishRecovery(() => true), true, 'the later fresh state clears that refusal without another polling cycle');
});
test('JOED-173 fix6 recovery notification failure cannot leave a frozen board logically signed in', t => {
  const s = recovering(t);
  for (const key of keys) s.accept(key, good);
  s.observe('expiry', good);
  let painted = false;
  const stop = s.subscribe(() => { if (!s.signedOut()) throw new Error('synthetic notification failure'); }); t.after(stop);
  assert.equal(s.finishRecovery(() => { painted = true; }), false);
  assert.equal(painted, false);
  assert.equal(s.signedOut(), true);
});
