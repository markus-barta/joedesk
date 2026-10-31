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
    return { type: 'basic', status: r.status ?? 200, text: async () => (r.status ? '{}' : JSON.stringify(r)), json: async () => (r.status ? {} : r) }; });
  return urls;
};

test('JOED-156 worker: a read posts the two series as compact columns, by transfer, with the key of what it read', async t => {
  const send = worker(t), urls = answer(t, history());
  await send({ read: 'account', have: null });
  assert.deepEqual(urls, ['/joe/account-history.json'], 'the board’s own route, from the worker’s release path');
  assert.equal(posted.length, 1);
  const { message, transfer } = posted[0];
  assert.deepEqual(Object.keys(message).sort(), ['evidence', 'key', 'kind', 'ms', 'reason', 'status', 'value']);
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

// A fresh worker module (its own global for the import): it has sent the page nothing yet.
async function freshWorker(tag) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, writable: true, value: { postMessage() {} } });
  try { return await import(`../public/joe/account-worker.js?${tag}`); }
  finally { if (before) Object.defineProperty(globalThis, 'self', before); else delete globalThis.self; }
}

test('JOED-156 worker: "unchanged" only for exactly the response it last sent; the key fingerprints all of it', async t => {
  const fresh = await freshWorker('exact-same');
  let body = history();
  answer(t, () => body);
  const first = (await fresh.readAccount(null)).message;
  assert.equal(first.kind, 'account');
  assert.equal(first.key, fresh.fingerprint(JSON.stringify(body)), 'the response’s length and hash');
  assert.match(first.key, /^\d+:[0-9a-f]{16}$/);
  const same = await fresh.readAccount(first.key);
  assert.deepEqual([same.message.kind, same.message.key, same.transfer], ['unchanged', first.key, []]);
  assert.equal((await fresh.readAccount(null)).message.kind, 'account', 'a page that holds nothing gets the data');
  // Another worker (one started after a failure) has sent nothing: data, whatever the page holds.
  const other = await freshWorker('exact-other');
  assert.equal((await other.readAccount(first.key)).message.kind, 'account');
});

test('JOED-156 fix round 2: offsetting corrections, a zero becoming unavailable and a changed reason all send the data', async t => {
  const fresh = await freshWorker('exact-changes');
  const base = history();
  base.points[5].account.equity = { amount: '0', currency: 'EUR' };
  base.points[6].account = { observedAt: base.points[6].t, equity: null, cash: null, reasons: { equity: 'gateway_down', cash: 'gateway_down' } };
  let body = base;
  answer(t, () => body);
  const held = (await fresh.readAccount(null)).message;
  const cases = {
    // The same sums of times and amounts: one value up, another down by as much.
    'offsetting corrections': b => { b.points[10].account.equity.amount = '27006.00'; b.points[11].account.equity.amount = '27004.50'; },
    'zero becomes unavailable': b => { b.points[5].account = { observedAt: b.points[5].t, equity: null, cash: b.points[5].account.cash, reasons: { equity: 'source_unavailable' } }; },
    'a changed reason': b => { b.points[6].account.reasons = { equity: 'contract_invalid', cash: 'gateway_down' }; },
  };
  // What the page holding the original is sent: 'data' is the history with a new key.
  const seen = {}, sentAs = (m, key) => (m.kind === 'account' && m.value && (key ? m.key === key : m.key !== held.key) ? 'data' : m.kind);
  for (const [name, change] of Object.entries(cases)) {
    body = structuredClone(base); change(body);
    seen[name] = sentAs((await fresh.readAccount(held.key)).message);
    // Back to the page's copy: the worker last sent the changed history, so
    // the original comes as data again, with its own key.
    body = base;
    seen[`${name}, then back`] = sentAs((await fresh.readAccount(held.key)).message, held.key);
  }
  assert.deepEqual(seen, Object.fromEntries(Object.keys(cases).flatMap(name => [[name, 'data'], [`${name}, then back`, 'data']])));
});

test('JOED-156 worker: the fingerprint is 64-bit FNV-1a over the bytes, with their length', () => {
  const enc = text => new TextEncoder().encode(text);
  for (const [text, hash] of [['', 'cbf29ce484222325'], ['a', 'af63dc4c8601ec8c'], ['foobar', '85944171f73967e8']]) assert.equal(W.fnv1a64(enc(text)), hash, JSON.stringify(text));
  const reference = bytes => { let h = 0xcbf29ce484222325n; for (const b of bytes) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h.toString(16).padStart(16, '0'); };
  for (const text of ['€ 985.100,10', 'ünchanged · “quoted”', JSON.stringify(history()).slice(0, 5000)]) assert.equal(W.fnv1a64(enc(text)), reference(enc(text)), text.slice(0, 20));
  assert.equal(W.fingerprint('€'), `3:${reference(enc('€'))}`, 'the length is in bytes');
});

test('JOED-156 worker: a failed read or a body off the contract posts its reason and no columns', async t => {
  const send = worker(t);
  for (const [status, reason] of [[401, 'auth_required'], [302, 'auth_required'], [404, 'route_not_found'], [503, 'refresh_failed']]) {
    answer(t, { status });
    posted.length = 0;
    await send({ read: 'account', have: null });
    assert.deepEqual({ ...posted[0].message, ms: 0 }, { evidence: [401, 302].includes(status) ? 'AUTH_FAILURE' : 'NO_EVIDENCE', kind: 'account', status, reason, value: null, key: null, ms: 0 }, String(status));
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
