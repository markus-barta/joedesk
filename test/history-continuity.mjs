// JOED-145 fix3: bounded compaction, optional provenance, storage failure and
// HTTP/worker transport. Synthetic data only; no browser or production store.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createJoeServer } from '../server.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { atomicWrite } from '../server/storage.mjs';
import { compactHistory, appendHistory, measureHistory, historyEnvelope, HISTORY_CAP, HISTORY_WARNING } from '../server/history.mjs';
import { CONTINUITY_SCHEMA, CONTINUITY_CAP, emptyContinuity, validContinuity } from '../public/joe/history-continuity.js';
import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import './fixtures/preview-dom.mjs';
const hm = await import('../public/joe/history-model.js');
const { createFeed } = await import('../public/joe/feed.js');
const fixture = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const DAY = 864e5, START = Date.parse('2026-10-01T00:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const fields = ['equity', 'dayPnl', 'openPnl', 'totalPnl'];
function largePoint(t) {
  const money = amount => Object.fromEntries(fields.map(f => [f, { amount, currency: 'EUR', fx: {
    base: 'USD', quote: 'EUR', rate: '0.90000001', source: 'é'.repeat(71), observedAt: iso(START),
  } }]));
  return { t: iso(t), desks: Object.fromEntries(hm.DESK_IDS.map(id => [id, {
    money: money('5000.12345678'), accounting: { periodStart: iso(START), method: 'execution-fifo-net-current-fx', detail: 'é'.repeat(240) },
    historyBasis: `${id}.paper.v2xxxxx`,
  }])), totals: money('15000.37037034') };
}
const historyValue = points => ({ schema: CONTRACTS.contracts.history, seq: 1, generatedAt: points.at(-1).t,
  receivedAt: points.at(-1).t, points, sizeBytes: 0 });
function appendLarge(previous, t, continuity) {
  const p = largePoint(t), states = {};
  for (const id of hm.DESK_IDS) for (const f of fields) states[`desks.${id}.${f}`] = { state: 'fresh', value: p.desks[id].money[f] };
  for (const f of fields) states[`today.${f}`] = { state: 'fresh', value: p.totals[f] };
  return appendHistory(previous, { generatedAt: p.t, desks: hm.DESK_IDS.map(id => ({ id, ...p.desks[id] })) }, states, p.t, continuity);
}
const dirFor = t => { const dir = scratch('joed145-continuity-'); t.after(() => discard(dir, 'JOED-145 synthetic history')); return dir; };
function seed(dir, count = 1231) {
  const value = historyValue(Array.from({ length: count }, (_, i) => largePoint(START + i * 900e3)));
  measureHistory(value);
  assert.equal(validateContract('history', value).ok, true, JSON.stringify(validateContract('history', value).errors));
  atomicWrite(join(dir, 'history-state.json'), historyEnvelope(value), HISTORY_CAP);
  return value;
}
function ingress(now) {
  const data = structuredClone(fixture.data); delete data.receivedAt;
  data.generatedAt = now; data.safety.gateway.checkedAt = now;
  return data;
}
const noData = cols => hm.missingBands(hm.DESK_IDS.map(id => hm.continuitySeries(cols, id, 'all', cols.t.at(-1)).gaps));

test('JOED-145: the gate’s 1,231 large rows at 900 seconds keep recording through 14-day retention', t => {
  // Every row includes all 16 money/FX cells and maximal bookkeeping detail.
  let history = historyValue(Array.from({ length: 1231 }, (_, i) => largePoint(START + i * 900e3)));
  const continuity = emptyContinuity(1);
  assert.ok(measureHistory(history) >= HISTORY_WARNING);
  assert.ok(history.sizeBytes < HISTORY_CAP);
  t.diagnostic(`gate starting store: ${history.points.length} rows, ${history.sizeBytes} bytes`);
  for (let i = 1231; i <= 16 * 96; i++) {
    history = appendLarge(history, START + i * 900e3, continuity);
    assert.ok(history.sizeBytes < HISTORY_CAP);
    assert.equal(history.points.at(-1).t, iso(START + i * 900e3));
    assert.ok(Date.parse(history.points[0].t) >= START + i * 900e3 - 14 * DAY);
    assert.equal(validContinuity(continuity), true);
  }
  assert.ok(history.compactedThrough);
  assert.equal(validateContract('history', history).ok, true);
  assert.deepEqual(noData(hm.toColumns(history.points, continuity, history.seq)), []);
  t.diagnostic(`900 s append/retention: ${history.points.length} rows, ${history.sizeBytes} bytes (cap ${HISTORY_CAP})`);
});

test('JOED-145: complete large-row fixtures at 30–900 s compact comfortably below the cap', t => {
  for (const cadence of [30, 60, 300, 900]) {
    const base = largePoint(START);
    const points = Array.from({ length: 14 * DAY / (cadence * 1000) + 1 }, (_, i) => ({ ...base, t: iso(START + i * cadence * 1000) }));
    const compacted = compactHistory(points), value = historyValue(compacted.points);
    const continuity = { ...emptyContinuity(1), intervals: compacted.intervals };
    assert.ok(measureHistory(value) < HISTORY_CAP / 4, `${cadence}s has ample headroom`);
    assert.equal(validateContract('history', value).ok, true, JSON.stringify(validateContract('history', value).errors));
    assert.ok(Buffer.byteLength(JSON.stringify(continuity)) < CONTINUITY_CAP);
    assert.deepEqual(noData(hm.toColumns(value.points, continuity, value.seq)), []);
    t.diagnostic(`${cadence} s, ${points.length} raw -> ${value.points.length} kept, ${value.sizeBytes} bytes; sidecar ${Buffer.byteLength(JSON.stringify(continuity))} bytes`);
  }
});

test('JOED-145: large rows with independent money extrema retain headroom at the slow cadence', t => {
  let seed = 17;
  const next = () => (seed = (seed * 16807) % 2147483647) % 900000;
  const points = Array.from({ length: 14 * 96 + 1 }, (_, i) => {
    const p = largePoint(START + i * 900e3);
    for (const f of fields) {
      let sum = 0;
      for (const id of hm.DESK_IDS) { const cents = next(); sum += cents; p.desks[id].money[f].amount = (cents / 100).toFixed(2); }
      p.totals[f].amount = (sum / 100).toFixed(2);
    }
    return p;
  });
  const first = compactHistory(points), continuity = { ...emptyContinuity(1), intervals: first.intervals };
  const value = historyValue(first.points);
  assert.ok(measureHistory(value) < HISTORY_WARNING);
  assert.equal(validateContract('history', value).ok, true);
  assert.equal(JSON.stringify(compactHistory(first.points, { continuity })), JSON.stringify(first));
  assert.equal(JSON.stringify(compactHistory(first.points).points), JSON.stringify(first.points));
  assert.deepEqual(noData(hm.toColumns(first.points, continuity)), []);
  t.diagnostic(`independent 16-series extrema: ${points.length} raw -> ${first.points.length} kept, ${value.sizeBytes} bytes`);
});

test('JOED-145: sidecar persists atomically alongside unchanged v2 rows, survives restart and prunes', t => {
  const dir = dirFor(t), original = seed(dir), now = iso(Date.parse(original.points.at(-1).t) + 900e3), writes = [];
  const model = createReadModel({ dataDir: dir, clock: () => now, write(file, ...args) { writes.push(file); atomicWrite(file, ...args); } });
  assert.equal(model.accept(ingress(now)).historyReason, null);
  const store = JSON.parse(readFileSync(join(dir, 'history-state.json'))), sidecar = JSON.parse(readFileSync(join(dir, 'history-continuity.json')));
  assert.equal(store.format, 'joedesk.history-store.v2');
  assert.deepEqual(Object.keys(store.value).sort(), ['compactedThrough', 'generatedAt', 'points', 'receivedAt', 'schema', 'seq', 'sizeBytes']);
  for (const p of store.value.points.slice(0, -1)) assert.equal(JSON.stringify(p), JSON.stringify(original.points.find(raw => raw.t === p.t)), 'point bytes/fields untouched');
  assert.equal(validateContract('history', store.value).ok, true);
  assert.equal(store.value.sizeBytes, readFileSync(join(dir, 'history-state.json')).length);
  assert.equal(validContinuity(sidecar), true); assert.equal(sidecar.historySeq, store.value.seq);
  assert.ok(sidecar.intervals.length > 0);
  assert.ok(writes.indexOf(join(dir, 'history-continuity.json')) < writes.indexOf(join(dir, 'history-state.json')));
  assert.equal(statSync(join(dir, 'history-continuity.json')).mode & 0o777, 0o600);
  const bytes = readFileSync(join(dir, 'history-state.json'));
  const restart = createReadModel({ dataDir: dir, clock: () => now });
  assert.deepEqual(restart.historyContinuity(), sidecar);
  assert.deepEqual(readFileSync(join(dir, 'history-state.json')), bytes, 'opening provenance does not rewrite History');
  const cols = hm.toColumns(store.value.points, sidecar, store.value.seq);
  assert.ok(Array.from({ length: cols.n - 1 }, (_, k) => hm.observedInterval(cols, k + 1)).every(Boolean));
  const later = iso(Date.parse(now) + 15 * DAY), expired = createReadModel({ dataDir: dir, clock: () => later });
  const next = ingress(later); next.seq++;
  assert.equal(expired.accept(next).historyReason, null);
  assert.deepEqual(expired.historyContinuity().intervals, []);
});

for (const kind of ['missing', 'corrupt', 'future', 'oversized', 'wrong-sequence']) test(`JOED-145: ${kind} sidecar fails closed, preserves damaged bytes and leaves History bytes intact`, t => {
  const dir = dirFor(t), raw = seed(dir, 100), full = compactHistory(raw.points), history = historyValue(full.points);
  history.compactedThrough = raw.points.at(-1).t; measureHistory(history);
  atomicWrite(join(dir, 'history-state.json'), historyEnvelope(history), HISTORY_CAP);
  const sidecar = { ...emptyContinuity(1), intervals: full.intervals };
  const body = kind === 'corrupt' ? '{broken' : kind === 'oversized' ? ' '.repeat(CONTINUITY_CAP + 1)
    : JSON.stringify({ ...sidecar, ...(kind === 'future' ? { schema: 'joedesk.history-continuity.v99' } : kind === 'wrong-sequence' ? { historySeq: 55 } : {}) });
  if (kind !== 'missing') writeFileSync(join(dir, 'history-continuity.json'), body);
  const bytes = readFileSync(join(dir, 'history-state.json'));
  const model = createReadModel({ dataDir: dir });
  const empty = model.historyContinuity();
  assert.deepEqual(empty.intervals, []);
  assert.deepEqual(readFileSync(join(dir, 'history-state.json')), bytes);
  const cols = hm.toColumns(history.points, empty, history.seq);
  const i = cols.t.findIndex((at, i) => i && at - cols.t[i - 1] > hm.GAP_MS);
  assert.ok(i > 0);
  assert.equal(hm.coverageUnknownAt(cols, (cols.t[i - 1] + cols.t[i]) / 2, Date.parse(history.compactedThrough)), true);
  if (['corrupt', 'future', 'oversized'].includes(kind)) {
    const saved = readdirSync(dir).filter(f => f.startsWith('history-continuity.json.damaged-'));
    assert.equal(saved.length, 1); assert.equal(readFileSync(join(dir, saved[0]), 'utf8'), body);
    // Reopen never destroys or multiplies the saved evidence.
    createReadModel({ dataDir: dir });
    assert.equal(readdirSync(dir).filter(f => f.includes('.damaged-')).length, 1);
  }
});

for (const failure of ['sidecar', 'sidecar-committed', 'history', 'history-committed']) test(`JOED-145: ${failure} write failure cannot attach claims to a different history sequence`, t => {
  const dir = dirFor(t), initial = seed(dir), now = iso(Date.parse(initial.points.at(-1).t) + 900e3);
  const original = readFileSync(join(dir, 'history-state.json'));
  const model = createReadModel({ dataDir: dir, clock: () => now, write(file, ...args) {
    if (file.endsWith(failure.startsWith('sidecar') ? 'history-continuity.json' : 'history-state.json')) {
      if (failure.endsWith('-committed')) { atomicWrite(file, ...args); throw Object.assign(new Error('fsync'), { committed: true }); }
      throw new Error('write');
    }
    atomicWrite(file, ...args);
  } });
  const result = model.accept(ingress(now));
  assert.equal(result.status, 200); assert.equal(result.historyReason, 'history_write_failed');
  const cold = createReadModel({ dataDir: dir, clock: () => now });
  assert.equal(model.feeds().history.value.seq, cold.feeds().history.value.seq);
  assert.deepEqual(model.historyContinuity(), cold.historyContinuity());
  if (failure !== 'history-committed') {
    assert.deepEqual(readFileSync(join(dir, 'history-state.json')), original);
    assert.deepEqual(cold.historyContinuity().intervals, []);
  } else assert.ok(cold.historyContinuity().intervals.length);
});

test('JOED-145: sibling GET is protected, read-only, uncached and uses the History security headers', async t => {
  const dir = dirFor(t), value = seed(dir), now = iso(Date.parse(value.points.at(-1).t) + 900e3);
  const server = createJoeServer({ dataDir: dir, clock: () => now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/joe/`, headers = { 'x-auth-request-user': 'joed145-fixture' };
  const route = base + 'history-continuity.json';
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: { 'x-auth-request-user': 'invalid actor!' } })).status, 401);
  assert.equal(server.readModel.accept(ingress(now)).historyReason, null);
  const response = await fetch(route, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-joe-server-now'), now);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['historySeq', 'intervals', 'schema']);
  assert.equal(body.schema, CONTINUITY_SCHEMA); assert.equal(validContinuity(body), true);
  assert.deepEqual(body, server.readModel.historyContinuity());
  const release = JSON.parse(readFileSync(new URL('../release.json', import.meta.url)));
  assert.equal((await fetch(base + `v/${release.version}/history-continuity.js`)).status, 200);
  const index = await (await fetch(base)).text();
  const imports = JSON.parse(index.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.equal(imports['/joe/history-continuity.js'], `/joe/history-continuity.js?v=${release.version}`);
  const before = readFileSync(join(dir, 'history-continuity.json'));
  assert.equal((await fetch(route, { method: 'POST', headers, body: '{}' })).status, 405);
  assert.equal(await (await fetch(route, { method: 'HEAD', headers })).text(), '');
  assert.deepEqual(readFileSync(join(dir, 'history-continuity.json')), before);
});

test('JOED-145: real worker transfer and page fallback use the sidecar, including changes without a new History receipt', async t => {
  const saved = { self: globalThis.self, Worker: globalThis.Worker, fetch: globalThis.fetch };
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  const raw = Array.from({ length: 3 * 2880 }, (_, i) => ({ ...largePoint(START), t: iso(START + i * 30e3) }));
  const full = compactHistory(raw), value = historyValue(full.points); value.compactedThrough = value.generatedAt; measureHistory(value);
  let sidecar = { ...emptyContinuity(value.seq), intervals: full.intervals }, status = 200;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init]);
    const continuity = String(url).includes('history-continuity.json');
    return Response.json(continuity ? sidecar : value, { status: continuity ? status : 200, headers: { 'X-Joe-Server-Now': value.receivedAt } });
  };
  let reply;
  globalThis.self = { postMessage(data, transfer) { reply(structuredClone(data, { transfer })); } };
  await import('../public/joe/history-worker.js?joed145-continuity');
  const poll = () => new Promise(resolve => { reply = resolve; self.onmessage({ data: 'poll' }); });
  let message = await poll();
  assert.deepEqual(noData(message.columns), []);
  assert.ok(message.columns.continuous.some(Boolean), 'claim flags survive worker buffer transfer');
  message = await poll(); assert.equal(message.kind, 'unchanged');
  status = 404;
  message = await poll(); assert.equal(message.kind, 'history', 'sidecar loss invalidates unchanged cache');
  assert.ok(noData(message.columns).length > 0);
  status = 200; sidecar = { ...sidecar, historySeq: value.seq + 1 };
  message = await poll(); assert.ok(noData(message.columns).length > 0, 'racing reads fail closed');
  sidecar = { ...sidecar, historySeq: value.seq };
  message = await poll(); assert.deepEqual(noData(message.columns), []);
  globalThis.Worker = undefined;
  const feed = createFeed(() => {}); await feed.refreshHistory();
  assert.deepEqual(noData(feed.feeds.history.value.columns), []);
  sidecar = { ...sidecar, schema: 'joedesk.history-continuity.v99' };
  await feed.refreshHistory(); assert.ok(noData(feed.feeds.history.value.columns).length > 0);
  for (const [url, init] of calls.filter(([url]) => url.includes('history-continuity'))) {
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'manual');
  }
});
