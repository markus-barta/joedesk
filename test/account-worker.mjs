// JOED-156: the whole account's read worker. What it posts for a read (two
// series of compact columns, by transfer), for a copy the page already holds,
// for a failed read and for a body off the contract; and that every module
// it imports is served under the release's own path, as Workers need.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { history } from './fixtures/account-fixtures.mjs';

const M = await import('../public/joe/account-model.js');
// The worker's global: its own postMessage, kept for every call it makes.
const posted = [];
const workerSelf = { postMessage: (message, transfer) => posted.push({ message, transfer }) };
const realSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: workerSelf });
const W = await import('../public/joe/account-worker.js?joed156');
// Other tests in this process see no worker global between these.
if (realSelf) Object.defineProperty(globalThis, 'self', realSelf); else delete globalThis.self;
const worker = t => {
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: workerSelf });
  t.after(() => { if (realSelf) Object.defineProperty(globalThis, 'self', realSelf); else delete globalThis.self; });
  posted.length = 0;
  return message => workerSelf.onmessage({ data: message });
};
const answer = (t, reply) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(String(url)); const r = typeof reply === 'function' ? reply() : reply;
    return { type: 'basic', status: r.status ?? 200, json: async () => (r.status ? {} : r) }; });
  return urls;
};

test('JOED-156 worker: a read posts the two series as compact columns, by transfer, with the key of what it read', async t => {
  const send = worker(t), urls = answer(t, history());
  await send({ read: 'account', have: null });
  assert.deepEqual(urls, ['/joe/account-history.json'], 'the board’s own route, from the worker’s release path');
  assert.equal(posted.length, 1);
  const { message, transfer } = posted[0];
  assert.deepEqual(Object.keys(message).sort(), ['key', 'kind', 'ms', 'reason', 'status', 'value']);
  assert.deepEqual([message.kind, message.status, message.reason], ['account', 200, null]);
  assert.ok(typeof message.key === 'string' && message.key.length > 10 && Number.isFinite(message.ms));
  for (const name of ['short', 'daily']) {
    const s = message.value[name];
    assert.equal(s.source, name);
    assert.ok(s.t instanceof Float64Array && s.v instanceof Float64Array && s.u instanceof BigInt64Array && s.why instanceof Uint8Array, `${name}: typed columns`);
    assert.ok([s.v, s.u, s.why].every(column => column.length === s.t.length));
  }
  assert.ok(Array.isArray(message.value.daily.day) && message.value.short.day === null && Array.isArray(message.value.short.reasons));
  assert.deepEqual(transfer, M.accountTransferables(message.value), 'every column’s buffer is handed over');
  assert.equal(new Set(transfer).size, 8);
  // What postMessage does with it: a structured clone that moves the buffers.
  const cloned = structuredClone(message, { transfer });
  assert.equal(message.value.short.t.length, 0, 'moved, not copied');
  assert.equal(cloned.value.short.u[0], M.acceptAccountHistory(history()).short.u[0]);
});

test('JOED-156 worker: the page’s current copy gets "unchanged"; any change to its times or amounts gets the data', async t => {
  const send = worker(t);
  let body = history();
  answer(t, () => body);
  await send({ read: 'account', have: null });
  const key = posted[0].message.key;
  await send({ read: 'account', have: key });
  assert.deepEqual(posted[1].message.kind, 'unchanged');
  assert.deepEqual(Object.keys(posted[1].message).sort(), ['feed', 'key', 'kind', 'ms']);
  assert.deepEqual([posted[1].message.feed, posted[1].message.key, posted[1].transfer], ['account', key, []]);
  // A late close for an older day: same length and newest time, a new key.
  body = history();
  body.dailyCloses.days[5].equity = { amount: '1.23', currency: 'EUR' };
  await send({ read: 'account', have: key });
  assert.equal(posted[2].message.kind, 'account');
  assert.notEqual(posted[2].message.key, key);
  assert.equal(W.historyKey(M.acceptAccountHistory(history())), key, 'the key is the history’s, not the read’s');
});

test('JOED-156 worker: a failed read or a body off the contract posts its reason and no columns', async t => {
  const send = worker(t);
  for (const [status, reason] of [[401, 'auth_required'], [302, 'auth_required'], [404, 'route_not_found'], [503, 'refresh_failed']]) {
    answer(t, { status });
    posted.length = 0;
    await send({ read: 'account', have: null });
    assert.deepEqual({ ...posted[0].message, ms: 0 }, { kind: 'account', status, reason, value: null, key: null, ms: 0 }, String(status));
    assert.deepEqual(posted[0].transfer, []);
    t.mock.restoreAll();
  }
  answer(t, { ...history(), schema: 'inspr.joe.account-history.v2' });
  posted.length = 0;
  await send({ read: 'account', have: null });
  assert.deepEqual([posted[0].message.status, posted[0].message.reason, posted[0].message.value], [200, 'contract_invalid', null]);
  posted.length = 0;
  await send('poll');
  await send({ read: 'history' });
  assert.equal(posted.length, 0, 'other messages are not the account worker’s');
});

test('JOED-156 worker: every module it imports is served under the release’s own path', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const ui = JSON.parse(server.match(/const UI_MODULES = (\[[^\]]+\]);/)[1]);
  const contracts = [...server.match(/const CONTRACT_FILES = Object\.freeze\(Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1].matchAll(/"([^"]+)"/g)].map(m => `contracts/${m[1]}`);
  const shared = ['time.mjs', 'market-calendar.json'];
  const source = name => readFileSync(new URL(name.startsWith('contracts/') || shared.includes(name) ? `../${name}` : `../public/joe/${name}`, import.meta.url), 'utf8');
  const seen = new Set(), queue = ['account-worker.js'];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    assert.ok(ui.includes(name) || contracts.includes(name) || shared.includes(name), `${name} is served under /joe/v/<release>/`);
    if (name.endsWith('.json')) continue;
    for (const [, spec] of source(name).matchAll(/\b(?:from|import)\s*['"](\.\/[^'"]+)['"]/g)) {
      const base = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
      queue.push(new URL(spec, `http://x/${base}`).pathname.slice(1));
    }
  }
  assert.ok(seen.has('account-model.js') && seen.has('contracts/decimal.mjs') && seen.has('time.mjs'), [...seen].join(' '));
});
