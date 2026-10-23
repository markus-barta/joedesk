// HTTP tests run only in the disposable tmpfs enforced by the runner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, mkdtempSync, lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createJoeServer } from '../server.mjs';
import { viennaDay } from '../time.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { atomicWrite } from '../server/storage.mjs';
import { historyEnvelope, appendHistory, boundHistory, compactPoints, measureHistory, HISTORY_CAP, HISTORY_WARNING } from '../server/history.mjs';
import { validateContract, CONTRACTS } from '../contracts/index.mjs';
import { decimalUnits, unitsDecimal } from '../contracts/decimal.mjs';
import { acceptRead } from '../contracts/read.mjs';
import { panelStates, panelState, MONEY_FIELDS } from '../contracts/panel-state.mjs';

const ROOT = process.env.JOED_TEST_ROOT ?? '/var/lib/joe-board';
const privateNativeRoot = process.platform === 'darwin' && process.env.JOED_TEST_ROOT &&
  dirname(realpathSync(ROOT)) === realpathSync(tmpdir()) && /^joedesk-contract-[A-Za-z0-9]+$/.test(basename(ROOT)) &&
  !lstatSync(ROOT).isSymbolicLink() && lstatSync(ROOT).isDirectory() &&
  lstatSync(ROOT).uid === process.getuid() && (lstatSync(ROOT).mode & 0o077) === 0;
const disposableLinux = process.platform === 'linux' && ROOT === '/var/lib/joe-board' &&
  readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line =>
    line.split(' - ')[0].split(' ')[4] === ROOT && line.split(' - ')[1]?.split(' ')[0] === 'tmpfs');
if ((!privateNativeRoot && !disposableLinux) || readdirSync(ROOT).length) {
  throw new Error('Refusing HTTP tests outside an empty private native root or disposable tmpfs; run npm test');
}
const samples = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const activeRelease = JSON.parse(readFileSync(new URL('../release.json', import.meta.url)));
const BASE_TIME = Date.parse(samples.data.receivedAt);
const TOKEN = 'joedesk-isolated-contract-fixture';
const FLEET_ACTOR = 'hostd-contract-user';
const at = ms => new Date(BASE_TIME + ms).toISOString();
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/failures/${name}.json`, import.meta.url))).payload;
function snapshot(seq = 101, generated = 0, checked = generated) {
  const value = structuredClone(samples.data); delete value.receivedAt;
  value.seq = seq; value.generatedAt = at(generated); value.safety.gateway.checkedAt = at(checked);
  return value;
}
function resultsSnapshot(seq = 101, generated = 0) {
  const value = structuredClone(samples.results); delete value.receivedAt;
  value.seq = seq; value.generatedAt = at(generated);
  return value;
}
function rolloverSnapshot(seq, generatedAt, date = viennaDay(generatedAt)) {
  const value = resultsSnapshot(seq);
  value.generatedAt = generatedAt; value.trackingStart = date;
  value.trades = []; value.days = [{ date, coverage: 'partial', desks: {} }];
  return value;
}
async function setupRollover(t, generatedAt = '2026-10-17T21:59:55.000Z', receivedAt = '2026-10-17T22:00:05.000Z') {
  const writes = [];
  const s = await setup(t, { write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  s.time.ms = Date.parse(generatedAt) - BASE_TIME;
  assert.equal((await s.pushResults(rolloverSnapshot(101, generatedAt))).status, 200);
  const original = (await s.request('/joe/results.json')).body;
  s.time.ms = Date.parse(receivedAt) - BASE_TIME; writes.length = 0;
  return { ...s, writes, original, candidate: rolloverSnapshot(102, generatedAt) };
}
async function setup(t, options = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(ROOT, 'p2-'));
  const time = { ms: 0 };
  const server = createJoeServer({ dataDir, clock: () => at(time.ms), inboxToken: TOKEN, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, init = {}) => {
    const response = await fetch(base + route, { ...init, redirect: 'manual', headers: { 'x-auth-request-user': FLEET_ACTOR, ...init.headers } });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };
  const push = value => request('/joe/inbox', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(value) });
  const pushResults = value => request('/joe/inbox/results', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(value) });
  const close = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  return { dataDir, base, request, push, pushResults, close, time, model: server.readModel };
}

test('P2 acceptance: 400 malformed, 413 streamed bound, 422 contract failure precede snapshot writes', async t => {
  const writes = [];
  const s = await setup(t, { write: (file, ...args) => { writes.push(file); atomicWrite(file, ...args); } });
  assert.equal((await s.push(snapshot())).status, 200);
  const original = readFileSync(join(s.dataDir, 'data-state.json'), 'utf8');
  const history = readFileSync(join(s.dataDir, 'history-state.json'), 'utf8');
  for (const [body, status, reason] of [
    ['{', 400, 'contract_invalid'],
    [' '.repeat(CONTRACTS.limits.data + 1), 413, 'contract_invalid'],
    [JSON.stringify({ schema: 'inspr.joe.household.v1' }), 422, 'schema_unsupported'],
    [JSON.stringify({ ...snapshot(102), mode: 'LIVE' }), 422, 'contract_invalid'],
    [JSON.stringify({ ...snapshot(102), receivedAt: at(0) }), 422, 'contract_invalid'],
  ]) {
    writes.length = 0;
    const result = await s.request('/joe/inbox', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body });
    assert.equal(result.status, status); assert.equal(result.body.reason, reason);
    assert.ok(writes.every(file => file.endsWith('feed-rejections.json')));
    assert.equal(readFileSync(join(s.dataDir, 'data-state.json'), 'utf8'), original);
    assert.equal(readFileSync(join(s.dataDir, 'history-state.json'), 'utf8'), history);
    assert.equal((await s.request('/joe/data.json')).headers.get('x-joe-feed-reason'), reason);
  }
  const rejected = await s.request('/joe/state.json');
  assert.equal(rejected.body.panels.halt.retained, true);
  const read = await s.request('/joe/data.json');
  const client = acceptRead('data', { status: read.status, payload: read.body, reason: read.headers.get('x-joe-feed-reason') }, { value: samples.data });
  assert.deepEqual(client.value, read.body); assert.equal(client.reason, 'contract_invalid');
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(9000) });
  assert.equal(restart.panels().halt.reason, 'contract_invalid'); assert.equal(restart.panels().halt.ageSeconds, 9);
  assert.equal((await s.push(snapshot(102, 1000))).status, 200);
  assert.equal((await s.request('/joe/data.json')).headers.get('x-joe-feed-reason'), null);
});

test('P2 inbox auth: missing and wrong bearer return 401; unconfigured token returns 503 before writes', async t => {
  for (const [inboxToken, authorization, expected] of [[TOKEN, '', 401], [TOKEN, 'Bearer wrong-fixture', 401], ['', `Bearer ${TOKEN}`, 503]]) {
    const s = await setup(t, { inboxToken });
    const result = await s.request('/joe/inbox', { method: 'POST', headers: { authorization }, body: '{' });
    assert.equal(result.status, expected); assert.equal(result.body.reason, 'auth_required');
    assert.deepEqual(readdirSync(s.dataDir), []);
    assert.equal((await s.request('/joe/healthz')).body.feeds.data.reason, 'feed_not_received');
  }
});

test('P2 clock ahead: five good observations survive a one-year jump and the next valid sequence', async t => {
  const writes = [];
  const s = await setup(t, { write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  for (let n = 0; n < 5; n++) {
    s.time.ms = n * 1000;
    assert.equal((await s.push(snapshot(101 + n, s.time.ms))).status, 200);
  }
  const before = ['data-state.json', 'history-state.json'].map(file => readFileSync(join(s.dataDir, file), 'utf8'));
  writes.length = 0;
  const rejected = await s.push(snapshot(106, 365 * 86400000));
  assert.equal(rejected.status, 422); assert.equal(rejected.body.reason, 'clock_ahead');
  assert.deepEqual(rejected.body.errors, [{ path: '$.generatedAt', rule: 'clockAhead' }]);
  assert.deepEqual(writes, ['feed-rejections.json']);
  assert.deepEqual(['data-state.json', 'history-state.json'].map(file => readFileSync(join(s.dataDir, file), 'utf8')), before);
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 5000;
  assert.equal((await restarted.push(snapshot(107, 5000))).status, 200);
  assert.equal(restarted.model.feeds().history.value.points.length, 6);
  assert.equal(restarted.model.feeds().data.value.seq, 107);
});

test('P2 cold retention: bad and replayed pushes preserve the last snapshot, ownership and original receipts', async t => {
  const s = await setup(t); await s.push(snapshot(101, 0, -20000));
  const original = (await s.request('/joe/data.json')).body;
  s.time.ms = 9000;
  for (const [candidate, reason] of [[{ schema: 'unknown' }, 'schema_unsupported'], [snapshot(), 'sequence_replayed']]) {
    await s.push(candidate);
    const read = await s.request('/joe/data.json');
    assert.equal(read.headers.get('x-joe-server-now'), at(9000));
    assert.equal(read.headers.get('x-joe-feed-reason'), reason);
    assert.deepEqual(read.body, original);
    assert.deepEqual(read.body.safety.gateway, original.safety.gateway);
    const cold = acceptRead('data', { status: read.status, payload: read.body,
      reason: read.headers.get('x-joe-feed-reason'), generatedAdvancedAt: read.headers.get('x-joe-generated-advanced-at') });
    const cell = panelStates({ data: cold }, at(9000))['today.equity'];
    assert.deepEqual(cell.value, original.totals.equity); assert.equal(cell.retained, true);
    assert.equal(cell.valueReceivedAt, at(0)); assert.equal(cell.ageSeconds, 9);
    const restarted = createReadModel({ dataDir: s.dataDir, clock: () => at(9000) });
    assert.deepEqual(restarted.view().data, original);
    assert.equal(restarted.panels()['today.equity'].valueReceivedAt, at(0));
    if (reason === 'sequence_replayed') {
      assert.ok(Object.values(restarted.panels()).filter(p => p.value != null).every(p => p.state !== 'broken'));
      const health = (await s.request('/joe/healthz')).body;
      assert.equal(health.feeds.data.state, 'stale'); assert.equal(health.feeds.data.reason, reason);
      assert.equal(health.gateway.confirmed, false);
    }
  }
  // A feed-level rejection must never bypass an independently expired check.
  s.time.ms = 59000;
  const aged = createReadModel({ dataDir: s.dataDir, clock: () => at(59000) });
  assert.deepEqual(aged.view().data.safety.gateway, original.safety.gateway);
  assert.equal(aged.view().data.totals.equity, null);
  assert.equal(validateContract('data', aged.view().data).ok, true);
});

test('P2 inbox diagnostics: schema, field and replay rejections expose only bounded safe path/rule pairs', async t => {
  const s = await setup(t); await s.push(snapshot());
  for (const [candidate, path, rule] of [[{ schema: 'unknown' }, '$.schema', 'const'],
    [{ ...snapshot(102), mode: 'LIVE' }, '$.mode', 'const'], [snapshot(), '$.seq', 'sequenceReplayed']]) {
    const response = await s.push(candidate);
    assert.equal(response.status, 422);
    assert.ok(response.body.errors.some(e => e.path === path && e.rule === rule));
    assert.ok(response.body.errors.length <= 20);
    assert.ok(response.body.errors.every(e => Object.keys(e).sort().join(',') === 'path,rule'));
    assert.equal(JSON.stringify(response.body).includes('LIVE'), false);
  }
});

test('P2 exact replay: same sequence and payload digest leave display, receipts and stores unchanged', async t => {
  const writes = [];
  const s = await setup(t, { write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  const original = snapshot();
  await s.push(original); s.time.ms = 9000;
  const files = ['data-state.json', 'history-state.json'];
  const before = files.map(file => readFileSync(join(s.dataDir, file), 'utf8'));
  const state = (await s.request('/joe/state.json')).body;
  const health = (await s.request('/joe/healthz')).body;
  // Object ordering is not part of the payload identity.
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  for (const replay of [original, reordered]) {
    writes.length = 0;
    const result = await s.push(replay);
    assert.equal(result.status, 422); assert.equal(result.body.reason, 'sequence_replayed');
    assert.deepEqual(result.body.errors, [{ path: '$.seq', rule: 'sequenceReplayed' }]);
    assert.deepEqual(writes, []);
    assert.deepEqual((await s.request('/joe/state.json')).body, state);
    assert.deepEqual((await s.request('/joe/healthz')).body, health);
    assert.equal((await s.request('/joe/data.json')).headers.get('x-joe-feed-reason'), null);
    assert.deepEqual(files.map(file => readFileSync(join(s.dataDir, file), 'utf8')), before);
  }
  assert.equal(health.feeds.data.state, 'fresh'); assert.equal(health.gateway.confirmed, true);
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 60000;
  assert.equal((await restarted.push(original)).body.reason, 'sequence_replayed');
  const stalled = (await restarted.request('/joe/healthz')).body;
  assert.deepEqual(stalled.feeds.data, { state: 'stale', ageSeconds: 60, reason: 'snapshot_stale' });
  assert.equal(restarted.model.panels()['today.equity'].valueReceivedAt, at(0));
  assert.deepEqual(files.map(file => readFileSync(join(s.dataDir, file), 'utf8')), before);
  restarted.time.ms = 9000;
  const changed = snapshot(101, 0, -1000);
  assert.equal((await restarted.push(changed)).body.reason, 'sequence_replayed');
  const rejected = (await restarted.request('/joe/state.json')).body.panels['today.equity'];
  assert.equal(rejected.state, 'stale'); assert.equal(rejected.reason, 'sequence_replayed');
  assert.equal(rejected.retained, true); assert.equal(rejected.ageSeconds, 9);
  // An exact retry cannot clear an unrelated existing rejection either.
  const rejectedHealth = (await restarted.request('/joe/healthz')).body;
  await restarted.push(original);
  assert.deepEqual((await restarted.request('/joe/healthz')).body, rejectedHealth);
});

test('P2 empty feeds: 503 is not reported with feed_not_received, never route_not_found', async t => {
  const s = await setup(t);
  for (const kind of ['data', 'history']) {
    const response = await s.request(`/joe/${kind}.json`);
    assert.equal(response.status, 503); assert.equal(response.body.reason, 'feed_not_received');
    assert.equal(response.headers.get('x-joe-server-now'), at(0));
    const cold = acceptRead(kind, { status: response.status, payload: response.body, reason: response.headers.get('x-joe-feed-reason') });
    assert.equal(cold.reason, 'feed_not_received');
    assert.equal(panelState(cold, cold.value, null, at(0)).state, 'not reported');
  }
  const state = (await s.request('/joe/state.json')).body;
  assert.deepEqual(state.panels['today.equity'], { state: 'not reported', ageSeconds: null, reason: 'feed_not_received',
    value: null, retained: false, valueReceivedAt: null });
  assert.equal((await s.request('/joe/missing.json')).status, 404);
});

test('P2 transport: chunked oversized input responds 413 without resetting the connection', async t => {
  const s = await setup(t);
  const { default: http } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = http.request(s.base + '/joe/inbox', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    for (let i = 0; i < 5; i++) req.write('x'.repeat(65536));
    req.end();
  });
  assert.equal(status, 413); assert.equal(s.model.hasData(), false);
});

test('P2 restart: seq, generation progress and receive regressions stay durable', async t => {
  const s = await setup(t);
  s.time.ms = 5000; assert.equal((await s.push(snapshot(101, 10000, 10000))).status, 200);
  s.time.ms = 35000; assert.equal((await s.push(snapshot(102, 10000, 10000))).status, 200);
  const r = createReadModel({ dataDir: s.dataDir, clock: () => at(65000) });
  assert.equal(r.feeds().data.value.seq, 102); assert.equal(r.feeds().data.value.receivedAt, at(35000));
  assert.equal(r.feeds().data.generatedAdvancedAt, at(5000));
  assert.equal(r.panels()['today.equity'].reason, 'producer_frozen');
  assert.equal(r.panels()['today.equity'].ageSeconds, 60);
  assert.equal(r.accept(snapshot(102, 20000)).reason, 'sequence_replayed');
  assert.equal(r.accept(snapshot(103, 9000)).reason, 'clock_regressed');
  const regressed = createReadModel({ dataDir: s.dataDir, clock: () => at(34000) });
  assert.equal(regressed.accept(snapshot(103, 20000)).reason, 'clock_regressed');
  assert.equal(regressed.panels()['today.equity'].reason, 'clock_regressed');
  assert.equal(r.accept(snapshot(103, 20000)).ok, true);
});

test('P2 retention: every retained cell keeps valueReceivedAt through nulls, rejection and restart', async t => {
  const s = await setup(t);
  assert.equal((await s.push(snapshot())).status, 200);
  for (let n = 1; n <= 3; n++) {
    s.time.ms = n * 30000;
    const dead = fixture('a-gateway-up-but-dead'); dead.seq = 101 + n; dead.generatedAt = at(n * 30000);
    dead.safety.gateway.checkedAt = at(n * 30000);
    assert.equal((await s.push(dead)).status, 200);
  }
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(100000) });
  const cells = restart.panels();
  for (const name of ['today.equity', 'paperAccount', ...['j', 'joe', 'joel'].flatMap(id => MONEY_FIELDS.map(f => `desks.${id}.${f}`))]) {
    assert.equal(cells[name].retained, true, name); assert.equal(cells[name].valueReceivedAt, at(0), name);
    assert.equal(cells[name].ageSeconds, 100, name);
  }
  const stored = JSON.parse(readFileSync(join(s.dataDir, 'data-state.json')));
  for (const cell of Object.values(stored.cells)) if (cell.value != null) assert.equal(typeof cell.valueReceivedAt, 'string');
  delete stored.cells['today.equity'].valueReceivedAt;
  atomicWrite(join(s.dataDir, 'data-state.json'), stored, 2 * 1024 * 1024);
  const corrupt = createReadModel({ dataDir: s.dataDir, clock: () => at(100000) });
  assert.equal(corrupt.accept(snapshot(200, 120000)).status, 503);
  assert.equal(corrupt.panels()['today.equity'].reason, 'contract_invalid');
});

test('rev 8 positions: per-field null reasons survive HTTP ingress, projection and restart', async t => {
  const s = await setup(t);
  const value = JSON.parse(readFileSync(new URL('../fixtures/positions-null.json', import.meta.url)));
  delete value.receivedAt;
  assert.equal((await s.push(value)).status, 200);
  const wire = (await s.request('/joe/data.json')).body;
  assert.deepEqual(wire.positions.rows, value.positions.rows);
  assert.equal(validateContract('data', wire).ok, true);
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(9000) });
  assert.deepEqual(restart.view().data.positions.rows, value.positions.rows);
  assert.deepEqual(restart.panels().kept.value.map(row => [row.symbol, row.quantity, row.reasons.quantity]),
    [['SXR8', null, 'not_exact_yet'], ['TSLA', null, 'source_unavailable']]);
  const unreasoned = structuredClone(value); unreasoned.seq++;
  delete unreasoned.positions.rows[1].reasons.quantity;
  const rejected = await s.push(unreasoned);
  assert.equal(rejected.status, 422);
  assert.ok(rejected.body.errors.some(error => error.path === '$.positions.rows[1].quantity' && error.rule === 'reasonRequired'));
  assert.deepEqual((await s.request('/joe/data.json')).body.positions.rows, value.positions.rows);
});

test('rev 8 cash: exact ingress, stale read and null retention survive restart independently of equity', async t => {
  const s = await setup(t);
  const value = snapshot(); value.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  assert.equal((await s.push(value)).status, 200);
  assert.equal((await s.request('/joe/data.json')).body.brokerAccount.cash.amount, '12345.67890123');
  assert.equal(s.model.panels().paperCash.state, 'fresh');
  s.time.ms = 90000;
  assert.equal(s.model.panels().paperCash.state, 'stale');
  const unavailable = snapshot(102, 90000);
  unavailable.brokerAccount.cash = null; unavailable.brokerAccount.reasons = { cash: 'source_unavailable' };
  assert.equal((await s.push(unavailable)).status, 200);
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(90000) });
  const panel = restart.panels().paperCash;
  assert.equal(panel.state, 'broken'); assert.equal(panel.retained, true);
  assert.equal(panel.valueReceivedAt, at(0)); assert.equal(panel.ageSeconds, 90);
  assert.equal(panel.value.amount, '12345.67890123');
  const wire = restart.view().data;
  assert.equal(wire.brokerAccount.cash, null);
  assert.equal(wire.brokerAccount.reasons.cash, 'source_unavailable');
  assert.deepEqual(wire.brokerAccount.equity, value.brokerAccount.equity);
  assert.equal(wire.brokerAccount.reason, undefined);
  assert.equal(validateContract('data', wire).ok, true);
  const recovery = snapshot(103, 100000); recovery.brokerAccount.cash = value.brokerAccount.cash;
  s.time.ms = 100000; assert.equal((await s.push(recovery)).status, 200);
  assert.equal(s.model.panels().paperCash.state, 'fresh');
  assert.equal(s.model.panels().paperCash.retained, false);
});

test('rev 8 cash: API check expiry and explicit session loss withhold the value exactly like equity', async t => {
  const s = await setup(t);
  const value = snapshot(101, 0, -20000); value.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  assert.equal((await s.push(value)).status, 200);
  s.time.ms = 40000;
  let wire = (await s.request('/joe/data.json')).body;
  assert.equal(wire.brokerAccount.equity, null); assert.equal(wire.brokerAccount.cash, null);
  assert.equal(wire.brokerAccount.reason, 'gateway_unconfirmed');
  assert.equal(wire.brokerAccount.reasons.cash, 'gateway_unconfirmed');
  assert.equal(validateContract('data', wire).ok, true);
  assert.equal(s.model.panels().paperCash.retained, true);
  const dead = fixture('a-gateway-up-but-dead'); dead.seq = 102; dead.generatedAt = at(40000);
  dead.safety.gateway.checkedAt = at(40000); dead.brokerAccount.cash = null;
  dead.brokerAccount.reasons = { cash: 'gateway_unconfirmed' };
  assert.equal((await s.push(dead)).status, 200);
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(40000) });
  wire = restart.view().data;
  assert.equal(wire.brokerAccount.cash, null);
  assert.equal(restart.panels().paperCash.valueReceivedAt, at(0));
});

test('rev 8 cash: a rev 7 durable cell set preserves sequence and last-good cells on upgrade', async t => {
  const s = await setup(t); assert.equal((await s.push(snapshot())).status, 200);
  const file = join(s.dataDir, 'data-state.json');
  const stored = JSON.parse(readFileSync(file)); delete stored.cells.paperCash;
  atomicWrite(file, stored, 2 * 1024 * 1024);
  const original = readFileSync(file, 'utf8');
  s.time.ms = 10000;
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(s.time.ms) });
  assert.equal(restart.hasData(), true);
  assert.equal(restart.panels().paperAccount.value.amount, samples.data.brokerAccount.equity.amount);
  assert.equal(restart.panels().paperCash.state, 'not reported');
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(restart.accept(snapshot()).reason, 'sequence_replayed');
  assert.equal(restart.accept(snapshot(102, 10000)).ok, true);
  const withCash = snapshot(103, 20000); withCash.brokerAccount.cash = { amount: '12.34000000', currency: 'EUR' };
  s.time.ms = 20000;
  assert.equal(restart.accept(withCash).ok, true);
  const damaged = JSON.parse(readFileSync(file)); delete damaged.cells.paperCash;
  atomicWrite(file, damaged, 2 * 1024 * 1024);
  assert.equal(createReadModel({ dataDir: s.dataDir }).hasData(), false);
});

test('P2 gateway: persisted old-check progress invalidates every money, account and both position panels', async t => {
  for (const skew of [5000, -61000]) {
    const s = await setup(t);
    assert.equal((await s.push(snapshot(101, skew, skew))).status, 200);
    s.time.ms = 30000;
    assert.equal((await s.push(snapshot(102, skew + 1000, skew))).status, 200);
    s.time.ms = 60000;
    // Producer progress is deliberately slow: reported age is only 2s, but
    // this is the same check the server first saw 60s ago.
    assert.equal((await s.push(snapshot(103, skew + 2000, skew))).status, 200);
    const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(60000) });
    const selected = restart.panels();
    for (const name of ['today.equity', 'today.dayPnl', 'today.openPnl', 'today.totalPnl', 'paperAccount', 'positions', 'kept',
      ...['j', 'joe', 'joel'].flatMap(id => MONEY_FIELDS.map(f => `desks.${id}.${f}`))]) {
      assert.equal(selected[name].reason, 'gateway_unconfirmed', name); assert.equal(selected[name].retained, true, name);
      assert.equal(selected[name].valueReceivedAt, at(30000), name);
    }
    assert.equal(selected.gateway.ageSeconds, 60);
    const wire = restart.view().data;
    assert.equal(wire.safety.gateway.apiSessionReady, true);
    assert.deepEqual(wire.safety.gateway, restart.feeds().data.value.safety.gateway);
    assert.equal(wire.brokerAccount.equity, null);
    for (const d of wire.desks) for (const f of MONEY_FIELDS) assert.equal(d.money[f], null);
    assert.ok(wire.positions.rows.every(row => row.mark === null && row.marketValue === null));
    const validated = validateContract('data', wire);
    assert.equal(validated.ok, true, JSON.stringify(validated.errors));
    s.time.ms = 61000;
    assert.equal((await s.push(snapshot(104, skew + 3000, skew + 3000))).status, 200);
    assert.equal(s.model.panels()['today.equity'].state, 'fresh');
    assert.equal(s.model.panels().positions.retained, false);
  }
});

test('P2 gateway: stale/frozen precedence, initial check age and check regressions', async t => {
  const s = await setup(t);
  assert.equal((await s.push(snapshot(101, 0, -20000))).status, 200);
  s.time.ms = 39999; assert.equal(s.model.panels()['today.equity'].state, 'fresh');
  s.time.ms = 40000; assert.equal(s.model.panels()['today.equity'].reason, 'gateway_unconfirmed');
  s.time.ms = 60000; assert.equal(s.model.panels()['today.equity'].reason, 'snapshot_stale');
  assert.equal((await s.push(snapshot(102, 0, -20000))).status, 200);
  assert.equal(s.model.panels()['today.equity'].reason, 'producer_frozen');
  const regression = await s.push(snapshot(103, 1000, -21000));
  assert.equal(regression.body.reason, 'clock_regressed');
  assert.deepEqual(regression.body.errors, [{ path: '$.safety.gateway.checkedAt', rule: 'clockRegressed' }]);
});

test('P2 outages: 20 dead, missing and frozen-ready pushes retain original money through restart and recover', async t => {
  for (const incident of ['a-gateway-up-but-dead', 'a-missing-gateway', 'a-frozen-ready-gateway']) {
    const s = await setup(t); await s.push(snapshot());
    for (let n = 1; n <= 20; n++) {
      s.time.ms = n * 30000;
      const value = fixture(incident); value.seq = 101 + n; value.generatedAt = at(n * 30000);
      assert.equal((await s.push(value)).status, 200, incident);
    }
    const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(600000) });
    for (const name of ['today.equity', 'paperAccount', ...['j', 'joe', 'joel'].flatMap(id => MONEY_FIELDS.map(f => `desks.${id}.${f}`))]) {
      assert.equal(restart.panels()[name].ageSeconds, 600, `${incident}: ${name}`);
      assert.equal(restart.panels()[name].valueReceivedAt, at(0));
      assert.equal(restart.panels()[name].retained, true);
    }
    const last = restart.feeds().data.value;
    assert.equal(last.desks[0].heartbeatAt, samples.data.desks[0].heartbeatAt);
    const served = (await s.request('/joe/data.json')).body;
    const validated = validateContract('data', served);
    assert.equal(validated.ok, true, JSON.stringify(validated.errors));
    if (incident === 'a-missing-gateway') assert.equal(served.safety.gateway, undefined);
    assert.equal(restart.accept(snapshot(122, 601000)).ok, true);
    assert.equal(restart.panels()['today.equity'].state, 'fresh');
  }
});

test('P2 gateway: a future unconfirmed check cannot poison the valid-check recovery watermark', async t => {
  const s = await setup(t); await s.push(snapshot()); s.time.ms = 30000;
  const future = fixture('a-frozen-ready-gateway');
  future.seq = 102; future.generatedAt = at(30000); future.safety.gateway.checkedAt = at(3600000);
  assert.equal((await s.push(future)).status, 200);
  assert.equal(s.model.panels()['today.equity'].reason, 'gateway_unconfirmed');
  assert.equal((await s.request('/joe/healthz')).body.gateway.checkAgeSeconds, null);
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(31000) });
  assert.equal(restart.accept(snapshot(103, 31000)).ok, true);
  assert.equal(restart.panels()['today.equity'].state, 'fresh');
});

test('P2 health: anonymous exact allowlist, never-received null ages and failed-refresh distinctions', async t => {
  const s = await setup(t);
  const get = () => s.request('/joe/healthz', { headers: { 'x-auth-request-user': '' } });
  const first = (await get()).body;
  assert.equal(validateContract('healthz', first).ok, true);
  assert.equal(first.versionScheme, activeRelease.version_scheme); assert.equal(first.version, activeRelease.version);
  for (const version of ['261016151218.0.0', '261019102825.0.0', '261021015923.0.0', '261021083537.0.0', '261021113113.0.0']) {
    assert.notEqual(first.version, version, 'health reports the running candidate, not a previous publication');
  }
  assert.equal(first.serverNow, at(0)); assert.equal(first.snapshotAgeSeconds, null);
  for (const [version, versionScheme] of [['261015150000.0.0', 'calendar'], ['26.10.15.15.00', 'inspr-calver-3'], ['26.02.30.15.00', 'calendar']]) {
    assert.equal(validateContract('healthz', { ...first, version, versionScheme }).ok, false);
  }
  for (const property of ['gateway', 'serverNow']) {
    const missing = structuredClone(first); delete missing[property];
    assert.equal(validateContract('healthz', missing).ok, false);
  }
  for (const [name, feed] of Object.entries(first.feeds)) {
    assert.equal(feed.state, 'not reported'); assert.equal(feed.ageSeconds, null);
    assert.equal(feed.reason, 'feed_not_received');
  }
  assert.deepEqual(first.gateway, { confirmed: false, checkAgeSeconds: null, reason: 'gateway_unconfirmed' });
  await s.push({ schema: 'unknown' });
  assert.equal((await get()).body.feeds.data.state, 'broken');
  assert.equal((await get()).body.feeds.data.reason, 'schema_unsupported');
  await s.push(snapshot()); s.time.ms = 9000;
  const ready = (await get()).body;
  assert.equal(ready.snapshotAgeSeconds, 9); assert.equal(ready.gateway.confirmed, true); assert.equal(ready.gateway.checkAgeSeconds, 9);
  for (const path of [[], ['feeds', 'data'], ['feeds', 'history'], ['feeds', 'results'], ['feeds', 'fleet-config'], ['gateway']]) {
    for (const key of ['money', 'accountHint', 'desk', 'trade', 'actor', 'path', 'detail', 'token']) {
      const injected = structuredClone(ready); let object = injected; for (const part of path) object = object[part];
      object[key] = 'synthetic'; assert.equal(validateContract('healthz', injected).ok, false, `${path}.${key}`);
    }
  }
  assert.deepEqual(Object.keys(ready).sort(), ['schema', 'version', 'versionScheme', 'schemaVersion', 'serverNow', 'snapshotAgeSeconds', 'feeds', 'gateway'].sort());
  s.time.ms = 60000;
  assert.equal((await get()).body.feeds.data.state, 'stale'); assert.equal((await get()).body.gateway.confirmed, false);
  const failed = await s.push({ schema: 'unknown' }); assert.equal(failed.status, 422);
  assert.equal((await get()).body.feeds.data.ageSeconds, 60);
  s.time.ms = -1000;
  assert.equal((await get()).body.feeds.data.reason, 'clock_regressed');
});

test('P2 auth: all four protected reads retain independent last-good ages on SSO failures', async t => {
  const s = await setup(t);
  await s.push(snapshot());
  await s.pushResults(resultsSnapshot());
  s.time.ms = 1000; await s.push(snapshot(102)); // data receipt advances; history deduplicates
  s.time.ms = 2000; await s.request('/joe/fleet-config.json');
  const expectedAges = { data: 608, history: 609, results: 609, 'fleet-config': 607 };
  for (const kind of ['data', 'history', 'results', 'fleet-config']) {
    const good = await s.request(`/joe/${kind}.json`);
    // Every feed's receipt and clock come from the real HTTP response.
    assert.equal(good.headers.get('x-joe-server-now'), at(2000));
    assert.equal(good.status, 200);
    let retained = acceptRead(kind, { status: good.status, payload: good.body,
      receivedAt: good.headers.get('x-joe-received-at'), generatedAdvancedAt: good.headers.get('x-joe-generated-advanced-at') });
    const value = retained.value;
    const response = await s.request(`/joe/${kind}.json`, { headers: { 'x-auth-request-user': '' } });
    assert.equal(response.status, 401); assert.equal(response.body.reason, 'auth_required');
    for (const status of [302, 401, 403]) {
      retained = acceptRead(kind, { status, payload: response.body }, retained);
      const cell = panelState(retained, retained.value, null, at(609000));
      assert.equal(cell.reason, 'auth_required'); assert.equal(cell.retained, true);
      assert.equal(cell.ageSeconds, expectedAges[kind]); assert.equal(retained.value, value);
    }
  }
  assert.equal((await s.request('/joe/healthz', { headers: { 'x-auth-request-user': '' } })).status, 200);
  assert.equal((await s.request('/joe/data.json')).status, 200);
});

test('JOED-27 results: cold feed is not received; only the inbox accepts writes', async t => {
  const s = await setup(t);
  const result = await s.request('/joe/results.json');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, schema: CONTRACTS.contracts.results, reason: 'feed_not_received' });
  assert.equal(result.headers.get('x-joe-feed-reason'), 'feed_not_received');
  assert.equal(result.headers.get('x-joe-received-at'), null);
  assert.equal((await s.request('/joe/results.json', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await s.request('/joe/inbox/results')).status, 405);
});

test('JOED-27 results: accepted snapshot and server receipt survive a stopped-server restart independently of data', async t => {
  const s = await setup(t);
  await s.push(snapshot());
  const dataBefore = ['data-state.json', 'history-state.json'].map(f => readFileSync(join(s.dataDir, f)));
  s.time.ms = 1000;
  assert.deepEqual((await s.pushResults(resultsSnapshot())).body, { ok: true, status: 200, reason: null, receivedAt: at(1000) });
  const served = await s.request('/joe/results.json');
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-joe-received-at'), at(1000));
  assert.equal(served.headers.get('x-joe-generated-advanced-at'), at(1000));
  assert.deepEqual(served.body, { ...resultsSnapshot(), receivedAt: at(1000) });
  assert.equal(validateContract('results', served.body).ok, true);
  assert.equal((await stat(join(s.dataDir, 'results-state.json'))).mode & 0o777, 0o600);
  assert.equal(readdirSync(s.dataDir).includes('results-state.json.next'), false);
  assert.deepEqual(['data-state.json', 'history-state.json'].map(f => readFileSync(join(s.dataDir, f))), dataBefore);
  const state = (await s.request('/joe/state.json')).body;
  assert.equal(state.panels.results.state, 'fresh');
  assert.equal(Object.hasOwn(state.panels.results, 'value'), false);
  assert.equal(Object.hasOwn(state.feeds.results, 'value'), false);
  assert.equal(state.feeds.results.receivedAt, at(1000));
  assert.equal(JSON.stringify(state).includes('"trades"'), false);
  await s.close();
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 9000;
  const after = await restarted.request('/joe/results.json');
  assert.deepEqual(after.body, served.body);
  assert.equal(after.headers.get('x-joe-received-at'), at(1000));
  assert.equal((await restarted.pushResults(resultsSnapshot(102, 9000))).status, 200);
});

test('JOED-30 results: partial coverage, empty desks and unknown summary money reach the protected read unchanged', async t => {
  const now = '2026-10-16T12:00:00.000Z';
  const s = await setup(t, { clock: () => now });
  const value = resultsSnapshot(); value.generatedAt = now;
  value.days[0].coverage = 'partial';
  value.days[0].partialReasons = ['unattributed_activity'];
  value.days[0].unattributedCount = 1;
  for (const desk of Object.values(value.days[0].desks)) desk.realisedNet = desk.fees = null;
  value.days.push({ date: '2026-10-15', desks: {}, coverage: 'partial', partialReasons: ['history_gap'] });
  assert.equal((await s.pushResults(value)).status, 200);
  const read = await s.request('/joe/results.json');
  assert.equal(read.status, 200);
  assert.ok(validateContract('results', read.body).ok);
  assert.deepEqual(read.body.days, value.days);
  assert.deepEqual(read.body.trades, value.trades);
  assert.deepEqual(read.body.missingDays ?? [], []);
  const cold = createReadModel({ dataDir: s.dataDir, clock: () => now });
  assert.deepEqual(cold.feeds().results.value.days, value.days, 'restart preserves the producer coverage and nulls');
});

test('JOED-30 rev 5 HTTP: reason semantic 422s retain the accepted record through restart', async t => {
  const now = '2026-10-16T12:00:00.000Z', s = await setup(t, { clock: () => now });
  const value = resultsSnapshot(); value.generatedAt = now;
  value.days[0] = { date: value.days[0].date, desks: {}, coverage: 'partial', partialReasons: ['history_gap'] };
  assert.equal((await s.pushResults(value)).status, 200);
  const saved = (await s.request('/joe/results.json')).body;
  for (const [mutate, field, rule] of [
    [d => { delete d.coverage; }, 'partialReasons', 'partialCoverageRequired'],
    [d => { d.coverage = 'full'; }, 'partialReasons', 'partialCoverageRequired'],
    [d => { d.partialReasons = ['history_gap', 'capture_gap']; }, 'partialReasons', 'canonicalOrder'],
    [d => { d.unattributedCount = 1; }, 'unattributedCount', 'unattributedReasonRequired'],
    [d => { d.partialReasons = ['unattributed_activity']; d.unattributedCount = 0; }, 'unattributedCount', 'minimum'],
  ]) {
    const bad = structuredClone(value); bad.seq++; mutate(bad.days[0]);
    const rejected = await s.pushResults(bad);
    assert.equal(rejected.status, 422);
    assert.ok(rejected.body.errors.some(e => e.path === `$.days[0].${field}` && e.rule === rule));
    assert.deepEqual((await s.request('/joe/results.json')).body, saved);
    assert.deepEqual(createReadModel({ dataDir: s.dataDir, clock: () => now }).feeds().results.value, saved);
  }
});

test('JOED-34 rev 6 HTTP: open partial days accept with no cause or FX missing; closed reasonless days retain last-good', async t => {
  for (const [day, before, after] of [
    ['2026-10-15', '2026-10-15T21:59:59.999Z', '2026-10-15T22:00:00.000Z'],
    ['2026-10-25', '2026-10-25T22:59:59.999Z', '2026-10-25T23:00:00.000Z'],
    ['2027-03-28', '2027-03-28T21:59:59.999Z', '2027-03-28T22:00:00.000Z'],
  ]) {
    let now = before;
    const s = await setup(t, { clock: () => now });
    const value = resultsSnapshot(); value.generatedAt = before;
    value.days = [{ date: day, desks: {}, coverage: 'partial' }]; value.trades = [];
    for (const partialReasons of [undefined, ['fx_missing'], undefined]) {
      if (partialReasons) value.days[0].partialReasons = partialReasons;
      else delete value.days[0].partialReasons;
      assert.equal((await s.pushResults(value)).status, 200);
      assert.deepEqual((await s.request('/joe/results.json')).body.days, value.days);
      value.seq++;
    }
    const saved = (await s.request('/joe/results.json')).body;
    const bytes = readFileSync(join(s.dataDir, 'results-state.json'));
    now = after; // The producer still has the previous day's clock.
    const rejected = await s.pushResults(value);
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.reason, 'contract_invalid');
    assert.deepEqual(rejected.body.errors, [{ path: '$.days[0].partialReasons', rule: 'partialReasonsRequired' }]);
    assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), bytes);
    assert.deepEqual((await s.request('/joe/results.json')).body, saved);
    assert.deepEqual(createReadModel({ dataDir: s.dataDir, clock: () => now }).feeds().results.value, saved,
      'restart validates the original receipt, preserving the then-open day');
    value.days[0].partialReasons = ['fx_missing'];
    assert.equal((await s.pushResults(value)).status, 200);
    assert.deepEqual((await s.request('/joe/results.json')).body.days[0].partialReasons, ['fx_missing']);
  }
});

test('JOED-28 results: missing closed days accept with 200, persist, retain on rejection and clear on partial coverage', async t => {
  const now = '2026-10-16T12:00:00.000Z';
  const s = await setup(t, { clock: () => now });
  const value = resultsSnapshot(); value.generatedAt = now;
  value.trades.push({ ...structuredClone(value.trades[0]), id: 'rt-missing-day',
    openedAt: '2026-10-15T15:00:00.000Z', closedAt: '2026-10-15T15:00:00.000Z' });
  assert.equal((await s.pushResults(value)).status, 200);
  const read = await s.request('/joe/results.json');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.missingDays, ['2026-10-15']);
  assert.equal(read.headers.get('x-joe-feed-reason'), null);
  assert.equal(acceptRead('results', { status: 200, payload: read.body }).reason, null);
  assert.equal((await s.request('/joe/state.json')).body.panels.results.state, 'fresh');
  const cold = createReadModel({ dataDir: s.dataDir, clock: () => now });
  assert.deepEqual(cold.feeds().results.value, read.body);
  const before = readFileSync(join(s.dataDir, 'results-state.json'));
  const bad = { ...structuredClone(value), seq: value.seq + 1 }; bad.trades[0].netEur.amount = '999';
  assert.equal((await s.pushResults(bad)).status, 422);
  // Exact retries must compare only producer fields, excluding diagnostics.
  assert.equal((await s.pushResults(value)).body.reason, 'sequence_replayed');
  assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), before);
  const retained = await s.request('/joe/results.json');
  assert.deepEqual(retained.body, read.body);
  assert.equal(retained.headers.get('x-joe-feed-reason'), 'contract_invalid');
  const partial = { ...structuredClone(value), seq: value.seq + 1 };
  partial.days.push({ date: '2026-10-15', coverage: 'partial', desks: {}, partialReasons: ['history_gap'] });
  assert.equal((await s.pushResults(partial)).status, 200);
  assert.deepEqual((await s.request('/joe/results.json')).body.missingDays ?? [], []);
  const spoof = { ...partial, seq: partial.seq + 1, missingDays: [] };
  const rejected = await s.pushResults(spoof);
  assert.equal(rejected.status, 422);
  assert.deepEqual(rejected.body.errors, [{ path: '$.missingDays', rule: 'serverOwned' }]);
});

test('JOED-28 results: HTTP diagnostics skip the open Vienna date and use the DST day rather than the host date', async t => {
  for (const [now, closedAt, expected] of [
    ['2026-10-15T22:30:00.000Z', '2026-10-15T22:00:00.000Z', []],
    ['2026-10-26T12:00:00.000Z', '2026-10-24T22:00:00.000Z', ['2026-10-25']],
    ['2026-10-26T12:00:00.000Z', '2026-10-25T22:59:59.999Z', ['2026-10-25']],
  ]) {
    const s = await setup(t, { clock: () => now });
    const value = resultsSnapshot(); value.generatedAt = now;
    value.trades.push({ ...structuredClone(value.trades[0]), id: 'rt-vienna-day', openedAt: closedAt, closedAt });
    assert.equal((await s.pushResults(value)).status, 200);
    assert.deepEqual((await s.request('/joe/results.json')).body.missingDays ?? [], expected);
  }
});

test('JOED-36 results: a midnight straddle keeps the 422 response, last-good and rejection file; resend is accepted', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const s = await setupRollover(t);
  // An existing data diagnostic also makes a rejection-file rewrite observable.
  s.model.reject('schema_unsupported');
  const before = readFileSync(join(s.dataDir, 'feed-rejections.json'));
  const snapshotBefore = readFileSync(join(s.dataDir, 'results-state.json'));
  s.writes.length = 0;
  const response = await s.pushResults(s.candidate);
  assert.equal(response.status, 422);
  assert.deepEqual(response.body, { ok: false, status: 422, reason: 'contract_invalid',
    errors: [{ path: '$.days[0].partialReasons', rule: 'partialReasonsRequired' }] });
  assert.deepEqual(s.writes, []);
  assert.deepEqual(readFileSync(join(s.dataDir, 'feed-rejections.json')), before);
  assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), snapshotBefore);
  const read = await s.request('/joe/results.json');
  assert.deepEqual(read.body, s.original); assert.equal(read.headers.get('x-joe-feed-reason'), null);
  assert.equal((await s.request('/joe/state.json')).body.panels.results.state, 'fresh');
  assert.deepEqual(logs, [{ event: 'rollover_resend_pending', generatedAt: s.candidate.generatedAt,
    receivedAt: at(s.time.ms), days: ['2026-10-17'] }]);
  s.time.ms += 1000;
  const resend = { ...s.candidate, generatedAt: at(s.time.ms) };
  resend.days[0].partialReasons = ['history_gap'];
  assert.equal((await s.pushResults(resend)).status, 200);
  assert.deepEqual((await s.request('/joe/results.json')).body, { ...resend, receivedAt: at(s.time.ms) });
  assert.equal(s.model.feeds().results.reason, null);
});

test('JOED-36 results: a missing resend becomes snapshot_stale at 60 seconds without a contract fault', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const s = await setupRollover(t);
  assert.equal((await s.pushResults(s.candidate)).status, 422);
  const receipt = Date.parse(s.original.receivedAt) - BASE_TIME;
  for (const [age, state, reason] of [[59999, 'fresh', null], [60000, 'stale', 'snapshot_stale'], [360000, 'stale', 'snapshot_stale']]) {
    s.time.ms = receipt + age;
    const panel = (await s.request('/joe/state.json')).body.panels.results;
    assert.equal(panel.state, state); assert.equal(panel.reason, reason); assert.equal(panel.ageSeconds, age / 1000);
    assert.equal((await s.request('/joe/healthz')).body.feeds.results.reason, reason);
    const read = await s.request('/joe/results.json');
    assert.equal(read.headers.get('x-joe-feed-reason'), null); assert.deepEqual(read.body, s.original);
  }
  assert.deepEqual(s.writes, []); assert.equal(logs.length, 1);
  assert.equal(readdirSync(s.dataDir).includes('feed-rejections.json'), false);
});

test('JOED-36 results: the second rollover rejection is persisted; acceptance re-arms the next rollover', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const s = await setupRollover(t);
  assert.equal((await s.pushResults(s.candidate)).status, 422); assert.deepEqual(s.writes, []);
  assert.equal((await s.pushResults(s.candidate)).status, 422);
  assert.deepEqual(s.writes, ['feed-rejections.json']); assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(s.dataDir, 'feed-rejections.json'))), { results: 'contract_invalid' });
  assert.equal((await s.request('/joe/results.json')).headers.get('x-joe-feed-reason'), 'contract_invalid');
  const panel = (await s.request('/joe/state.json')).body.panels.results;
  assert.equal(panel.state, 'broken'); assert.equal(panel.reason, 'contract_invalid');
  assert.equal(createReadModel({ dataDir: s.dataDir }).feeds().results.reason, 'contract_invalid');
  const resend = structuredClone(s.candidate);
  resend.generatedAt = at(s.time.ms); resend.days[0].partialReasons = ['history_gap'];
  assert.equal((await s.pushResults(resend)).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(s.dataDir, 'feed-rejections.json'))), {});
  const generatedAt = '2026-10-18T21:59:55.000Z';
  s.time.ms = Date.parse(generatedAt) - BASE_TIME + 10000; s.writes.length = 0;
  assert.equal((await s.pushResults(rolloverSnapshot(103, generatedAt))).status, 422);
  assert.deepEqual(s.writes, []); assert.equal(s.model.feeds().results.reason, null); assert.equal(logs.length, 2);
});

test('JOED-36 results: exemption preserves an existing results reason and restart re-arms the in-memory flag', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const s = await setupRollover(t);
  s.model.reject('sequence_replayed', 422, 'results');
  const before = readFileSync(join(s.dataDir, 'feed-rejections.json'));
  s.writes.length = 0;
  assert.equal((await s.pushResults(s.candidate)).status, 422);
  assert.equal(s.model.feeds().results.reason, 'sequence_replayed');
  assert.deepEqual(readFileSync(join(s.dataDir, 'feed-rejections.json')), before); assert.deepEqual(s.writes, []);
  await s.close();
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = s.time.ms;
  assert.equal((await restarted.pushResults(s.candidate)).status, 422);
  assert.equal(restarted.model.feeds().results.reason, 'sequence_replayed');
  assert.deepEqual(readFileSync(join(s.dataDir, 'feed-rejections.json')), before); assert.equal(logs.length, 2);
});

test('JOED-36 results: calendar rollover is independent of host zone across Vienna DST, month and year boundaries', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  for (const [generatedAt, receivedAt, day] of [
    ['2026-03-28T22:59:55.000Z', '2026-03-28T23:00:05.000Z', '2026-03-28'],
    ['2026-03-29T21:59:55.000Z', '2026-03-29T22:00:05.000Z', '2026-03-29'],
    ['2026-10-24T21:59:55.000Z', '2026-10-24T22:00:05.000Z', '2026-10-24'],
    ['2026-10-25T22:59:55.000Z', '2026-10-25T23:00:05.000Z', '2026-10-25'],
    ['2026-01-31T22:59:55.000Z', '2026-01-31T23:00:05.000Z', '2026-01-31'],
    ['2026-12-31T22:59:55.000Z', '2026-12-31T23:00:05.000Z', '2026-12-31'],
  ]) {
    const s = await setupRollover(t, generatedAt, receivedAt);
    assert.equal((await s.pushResults(s.candidate)).status, 422);
    assert.equal(s.model.feeds().results.reason, null); assert.deepEqual(s.writes, []);
    assert.deepEqual(logs.at(-1), { event: 'rollover_resend_pending', generatedAt, receivedAt, days: [day] });
  }
  assert.equal(logs.length, 6);
});

test('JOED-36 results: exactly five minutes is exempt; excess skew, wrong days and mixed errors remain faults', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  const edge = await setupRollover(t, '2026-10-17T21:55:00.000Z', '2026-10-17T22:00:00.000Z');
  assert.equal((await edge.pushResults(edge.candidate)).status, 422);
  assert.equal(edge.model.feeds().results.reason, null); assert.deepEqual(edge.writes, []);
  for (const [label, generatedAt, receivedAt, mutate] of [
    ['over five minutes', '2026-10-17T21:55:00.000Z', '2026-10-17T22:00:00.001Z'],
    ['two dates later', '2026-10-17T21:59:55.000Z', '2026-10-18T22:00:05.000Z'],
    ['same date', '2026-10-17T21:59:55.000Z', '2026-10-17T21:59:56.000Z', value => { value.days[0].date = '2026-10-16'; }],
    ['older closed day', '2026-10-17T21:59:55.000Z', '2026-10-17T22:00:05.000Z', value => { value.days[0].date = '2026-10-16'; }],
    ['mixed errors', '2026-10-17T21:59:55.000Z', '2026-10-17T22:00:05.000Z', value => { value.days[0].unattributedCount = 1; }],
    ['zero skew', '2026-10-17T22:00:05.000Z', '2026-10-17T22:00:05.000Z', value => { value.days[0].date = '2026-10-17'; }],
    ['negative skew', '2026-10-17T22:00:05.000Z', '2026-10-17T22:00:04.000Z', value => { value.days[0].date = '2026-10-17'; }],
  ]) {
    const s = await setupRollover(t, generatedAt, receivedAt); mutate?.(s.candidate);
    const response = await s.pushResults(s.candidate);
    assert.equal(response.status, 422, label); assert.equal(response.body.reason, 'contract_invalid', label);
    assert.equal(s.model.feeds().results.reason, 'contract_invalid', label);
    assert.deepEqual(s.writes, ['feed-rejections.json'], label);
    assert.deepEqual(JSON.parse(readFileSync(join(s.dataDir, 'feed-rejections.json'))), { results: 'contract_invalid' }, label);
    assert.deepEqual((await s.request('/joe/results.json')).body, s.original, label);
  }
  assert.equal(logs.length, 1);
});

test('JOED-36 results: the full validation error list controls exemption beyond the 20-error response slice', async t => {
  const logs = []; t.mock.method(console, 'info', line => logs.push(JSON.parse(line)));
  for (const variant of ['all rollover', 'mixed after slice', 'older day after slice']) {
    const s = await setupRollover(t);
    s.candidate.days = Array.from({ length: 21 }, () => structuredClone(s.candidate.days[0]));
    if (variant === 'mixed after slice') s.candidate.days[20].unattributedCount = 1;
    if (variant === 'older day after slice') s.candidate.days[20].date = '2026-10-16';
    const checked = validateContract('results', s.candidate, { stage: 'ingress', receivedAt: at(s.time.ms) });
    assert.ok(checked.errors.length > 20);
    const response = await s.pushResults(s.candidate);
    assert.equal(response.status, 422); assert.equal(response.body.reason, 'contract_invalid');
    assert.deepEqual(response.body.errors, checked.errors.slice(0, 20));
    assert.ok(response.body.errors.every(error => error.rule === 'partialReasonsRequired'));
    const exempt = variant === 'all rollover';
    assert.equal(s.model.feeds().results.reason, exempt ? null : 'contract_invalid', variant);
    assert.deepEqual(s.writes, exempt ? [] : ['feed-rejections.json'], variant);
  }
  assert.equal(logs.length, 1);
});

test('JOED-27 results: same machine auth, missing/wrong bearer 401 and missing token 503 precede writes', async t => {
  for (const [inboxToken, authorization, status] of [[TOKEN, '', 401], [TOKEN, 'Bearer wrong-fixture', 401],
    [TOKEN, `Basic ${TOKEN}`, 401], ['', `Bearer ${TOKEN}`, 503]]) {
    const s = await setup(t, { inboxToken });
    const result = await s.request('/joe/inbox/results', { method: 'POST', headers: { authorization }, body: '{' });
    assert.equal(result.status, status); assert.equal(result.body.reason, 'auth_required');
    assert.deepEqual(readdirSync(s.dataDir), []);
    assert.equal(s.model.feeds().results.reason, 'feed_not_received');
  }
});

test('JOED-27 results: malformed 400, oversized 413 and bounded 422 diagnostics retain the original record and durable reason', async t => {
  const s = await setup(t); await s.pushResults(resultsSnapshot());
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  const manyErrors = resultsSnapshot(102);
  manyErrors.trades = Array.from({ length: 25 }, () => ({ id: 'rt-invalid', privateDiagnostic: 'never echoed' }));
  for (const [body, status, reason, error] of [
    ['{', 400, 'contract_invalid'],
    [' '.repeat(CONTRACTS.limits.results + 1), 413, 'contract_invalid'],
    [JSON.stringify({ schema: 'unknown' }), 422, 'schema_unsupported', { path: '$.schema', rule: 'const' }],
    [JSON.stringify({ snapshot: resultsSnapshot(102) }), 422, 'schema_unsupported'],
    [JSON.stringify([resultsSnapshot(102)]), 422, 'schema_unsupported'],
    [JSON.stringify({ ...resultsSnapshot(102), receivedAt: at(0) }), 422, 'contract_invalid', { path: '$.receivedAt', rule: 'serverOwned' }],
    [JSON.stringify(manyErrors), 422, 'contract_invalid'],
  ]) {
    s.time.ms += 1000;
    const result = await s.request('/joe/inbox/results', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body });
    assert.equal(result.status, status); assert.equal(result.body.reason, reason);
    if (status === 422) {
      assert.ok(result.body.errors.length > 0 && result.body.errors.length <= 20);
      assert.ok(result.body.errors.every(e => Object.keys(e).sort().join(',') === 'path,rule'));
      if (error) assert.ok(result.body.errors.some(e => e.path === error.path && e.rule === error.rule), JSON.stringify(result.body.errors));
      assert.equal(JSON.stringify(result.body).includes('never echoed'), false);
    }
    assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
    const cold = createReadModel({ dataDir: s.dataDir, clock: () => at(s.time.ms) });
    assert.equal(cold.feeds().results.reason, reason);
    assert.equal(cold.feeds().results.value.receivedAt, at(0));
    assert.equal(cold.panels().results.retained, true);
    assert.equal(cold.panels().results.ageSeconds, s.time.ms / 1000);
    const read = await s.request('/joe/results.json');
    assert.equal(read.status, 200); assert.equal(read.headers.get('x-joe-feed-reason'), reason);
    assert.equal(read.headers.get('x-joe-received-at'), at(0));
  }
  assert.equal((await stat(join(s.dataDir, 'feed-rejections.json'))).mode & 0o777, 0o600);
  assert.equal((await s.pushResults(resultsSnapshot(102, s.time.ms))).status, 200);
  assert.equal(createReadModel({ dataDir: s.dataDir }).feeds().results.reason, null);
});

test('JOED-27 results: replay and regressed producer/server clocks cannot replace or freshen last-good', async t => {
  const s = await setup(t); await s.pushResults(resultsSnapshot());
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  const sameSeq = resultsSnapshot(); sameSeq.trades[0].company = 'same sequence, changed record';
  s.time.ms = 9000;
  for (const [value, reason, error] of [
    [resultsSnapshot(100), 'sequence_replayed', { path: '$.seq', rule: 'sequenceReplayed' }],
    [sameSeq, 'sequence_replayed', { path: '$.seq', rule: 'sequenceReplayed' }],
    [resultsSnapshot(102, -1), 'clock_regressed', { path: '$.generatedAt', rule: 'clockRegressed' }],
    [resultsSnapshot(102, 14001), 'clock_ahead', { path: '$.generatedAt', rule: 'clockAhead' }],
  ]) {
    const response = await s.pushResults(value);
    assert.equal(response.status, 422); assert.equal(response.body.reason, reason);
    assert.deepEqual(response.body.errors, [error]);
    assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
    assert.equal(createReadModel({ dataDir: s.dataDir }).feeds().results.reason, reason);
  }
  s.time.ms = -1;
  const regressed = await s.pushResults(resultsSnapshot(102));
  assert.equal(regressed.status, 422); assert.equal(regressed.body.reason, 'clock_regressed');
  assert.deepEqual(regressed.body.errors, [{ path: '$.receivedAt', rule: 'clockRegressed' }]);
  s.time.ms = 10000;
  assert.equal((await s.pushResults(resultsSnapshot(102, 15000))).status, 200); // exactly +5 s allowed
});

test('JOED-27 results: exact decimals survive HTTP/storage; per-day 422 keeps last-good through restart; partial days skip', async t => {
  const s = await setup(t);
  const exact = JSON.parse(readFileSync(new URL('../fixtures/results/exact-decimals.json', import.meta.url)));
  delete exact.receivedAt; exact.seq = 101; exact.generatedAt = at(0);
  assert.equal((await s.pushResults(exact)).status, 200);
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  assert.deepEqual((await s.request('/joe/results.json')).body, { ...exact, receivedAt: at(0) });
  const bad = structuredClone(exact); bad.seq++;
  Object.assign(bad.days[0].desks.j, { trades: 5, realisedNet: { amount: '0.02', currency: 'EUR' }, fees: { amount: '0.02', currency: 'EUR' } });
  s.time.ms = 30000;
  const rejected = await s.pushResults(bad);
  assert.equal(rejected.status, 422); assert.equal(rejected.body.reason, 'contract_invalid');
  assert.deepEqual(rejected.body.errors, [
    { path: '$.days[0].desks.j.trades', rule: 'dayTradeCount' },
    { path: '$.days[0].desks.j.realisedNet', rule: 'dayNetSum' },
    { path: '$.days[0].desks.j.fees', rule: 'dayFeeSum' },
  ]);
  assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
  await s.close();
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 60000;
  const read = await restarted.request('/joe/results.json');
  assert.deepEqual(read.body, { ...exact, receivedAt: at(0) });
  assert.equal(read.headers.get('x-joe-feed-reason'), 'contract_invalid');
  assert.equal(read.headers.get('x-joe-received-at'), at(0));
  assert.equal(restarted.model.panels().results.ageSeconds, 60);
  assert.equal(restarted.model.panels().results.retained, true);
  const partial = JSON.parse(readFileSync(new URL('../fixtures/results/partial-day.json', import.meta.url)));
  delete partial.receivedAt; partial.seq = 102; partial.generatedAt = at(60000);
  assert.equal((await restarted.pushResults(partial)).status, 200);
  assert.deepEqual((await restarted.request('/joe/results.json')).body, { ...partial, receivedAt: at(60000) });
  const full = structuredClone(partial); full.seq++; delete full.days[0].coverage;
  const invalid = await restarted.pushResults(full);
  assert.equal(invalid.status, 422);
  assert.ok(invalid.body.errors.some(e => e.path === '$.days[0].desks.j.trades' && e.rule === 'dayTradeCount'));
  assert.equal((await restarted.request('/joe/results.json')).body.seq, partial.seq);
});

test('JOED-27 results: omitted trading desk returns a per-day 422 and retains last-good through restart', async t => {
  const s = await setup(t);
  const good = resultsSnapshot();
  assert.equal((await s.pushResults(good)).status, 200);
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  s.time.ms = 30000;
  for (const coverage of [undefined, 'full']) {
    const bad = resultsSnapshot(102); delete bad.days[0].desks.j;
    if (coverage) bad.days[0].coverage = coverage;
    const rejected = await s.pushResults(bad);
    assert.equal(rejected.status, 422); assert.equal(rejected.body.reason, 'contract_invalid');
    assert.deepEqual(rejected.body.errors, [{ path: '$.days[0].desks.j', rule: 'dayDeskRequired' }]);
    assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
  }
  await s.close();
  const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 60000;
  const read = await restarted.request('/joe/results.json');
  assert.deepEqual(read.body, { ...good, receivedAt: at(0) });
  assert.equal(read.headers.get('x-joe-feed-reason'), 'contract_invalid');
  assert.equal(read.headers.get('x-joe-received-at'), at(0));
  assert.equal(restarted.model.panels().results.retained, true);
  const beforeClose = resultsSnapshot(102, 60000); beforeClose.days = [];
  assert.equal((await restarted.pushResults(beforeClose)).status, 200);
  assert.deepEqual((await restarted.request('/joe/results.json')).body, { ...beforeClose, receivedAt: at(60000) });
  const partial = resultsSnapshot(103, 60000); partial.days[0].coverage = 'partial'; partial.days[0].desks = {};
  assert.equal((await restarted.pushResults(partial)).status, 200);
});

test('JOED-27 results: KEEP trades and KEEP-only daily totals are rejected without replacing last-good', async t => {
  const s = await setup(t); await s.pushResults(resultsSnapshot());
  const { sourceTrades } = JSON.parse(readFileSync(new URL('../fixtures/results-keep-exclusion.json', import.meta.url)));
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  for (const trade of sourceTrades.filter(t => ['SXR8', 'TSLA'].includes(t.symbol))) {
    const bad = resultsSnapshot(102); bad.trades.push(trade);
    const rejected = await s.pushResults(bad);
    assert.equal(rejected.status, 422);
    assert.ok(rejected.body.errors.some(e => e.path === '$.trades[1].symbol' && e.rule === 'keepExcluded'));
  }
  const polluted = resultsSnapshot(102); polluted.days[0].desks.joel.realisedNet.amount = '303';
  const rejected = await s.pushResults(polluted);
  assert.equal(rejected.status, 422);
  assert.deepEqual(rejected.body.errors, [{ path: '$.days[0].desks.joel.realisedNet', rule: 'dayNetSum' }]);
  assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
});

test('JOED-27 results: exact retry is a rejected no-op; new seq and non-regressing generation accept', async t => {
  const writes = [];
  const s = await setup(t, { write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  const original = resultsSnapshot(); await s.pushResults(original);
  writes.length = 0; s.time.ms = 30000;
  const response = await s.pushResults(Object.fromEntries(Object.entries(original).reverse()));
  assert.equal(response.status, 422); assert.equal(response.body.reason, 'sequence_replayed');
  assert.deepEqual(writes, []); assert.equal(s.model.feeds().results.reason, null);
  assert.equal(s.model.feeds().results.value.receivedAt, at(0));
  assert.equal((await s.pushResults(resultsSnapshot(102))).status, 200);
  assert.equal(s.model.feeds().results.value.receivedAt, at(30000));
  assert.equal(s.model.feeds().results.generatedAdvancedAt, at(0));
  s.time.ms = 60000;
  assert.equal(s.model.panels().results.reason, 'producer_frozen');
  assert.equal((await s.request('/joe/results.json')).headers.get('x-joe-generated-advanced-at'), at(0));
  assert.equal((await s.pushResults(resultsSnapshot(103, 60000))).status, 200);
  assert.equal(s.model.panels().results.state, 'fresh');
});

test('JOED-27 results: selector, health, browser read and restarted model stale at exactly 60 s without a new accepted push', async t => {
  const s = await setup(t); await s.pushResults(resultsSnapshot());
  for (const ms of [59999, 60000, 60001, 300000]) {
    s.time.ms = ms;
    const read = await s.request('/joe/results.json');
    const client = acceptRead('results', { status: read.status, payload: read.body,
      generatedAdvancedAt: read.headers.get('x-joe-generated-advanced-at') });
    const cold = createReadModel({ dataDir: s.dataDir, clock: () => at(ms) });
    const health = (await s.request('/joe/healthz')).body.feeds.results;
    const state = ms < 60000 ? 'fresh' : 'stale', reason = ms < 60000 ? null : 'snapshot_stale';
    for (const cell of [s.model.panels().results, cold.panels().results, panelStates({ results: client }, at(ms)).results, health]) {
      assert.equal(cell.state, state); assert.equal(cell.reason, reason); assert.equal(cell.ageSeconds, ms / 1000);
    }
    assert.equal(read.headers.get('x-joe-received-at'), at(0));
  }
});

test('JOED-27 results: unavailable or corrupt storage fails closed with 503 and keeps data independent', async t => {
  for (const committed of [false, true]) {
    let failing = false;
    const s = await setup(t, { write: (file, ...args) => {
      if (failing && file.endsWith('results-state.json')) {
        if (committed) atomicWrite(file, ...args);
        throw Object.assign(new Error('fixture write failed'), { committed });
      }
      atomicWrite(file, ...args);
    } });
    await s.pushResults(resultsSnapshot()); failing = true; s.time.ms = 1000;
    const response = await s.pushResults(resultsSnapshot(102, 1000));
    assert.equal(response.status, 503); assert.equal(response.body.reason, 'refresh_failed');
    const cold = createReadModel({ dataDir: s.dataDir, clock: () => at(1000) });
    assert.equal(cold.feeds().results.reason, 'refresh_failed');
    assert.equal(cold.feeds().results.value.seq, committed ? 102 : 101);
    assert.equal(s.model.feeds().results.value.seq, committed ? 102 : 101);
    failing = false;
    assert.equal((await s.push(snapshot())).status, 200);
    assert.equal((await s.pushResults(resultsSnapshot(103, 1000))).status, 200);
  }
  for (const corrupt of ['{', JSON.stringify({ format: 'joedesk.results-store.v2', feed: { value: samples.results, generatedAdvancedAt: 'invalid' } }),
    ' '.repeat(CONTRACTS.limits.results + 4097)]) {
    const s = await setup(t);
    await writeFile(join(s.dataDir, 'results-state.json'), corrupt);
    const restarted = await setup(t, { dataDir: s.dataDir });
    const response = await restarted.pushResults(resultsSnapshot());
    assert.equal(response.status, 503); assert.equal(response.body.reason, 'contract_invalid');
    assert.equal((await restarted.request('/joe/results.json')).body.reason, 'contract_invalid');
    assert.equal(readFileSync(join(s.dataDir, 'results-state.json'), 'utf8'), corrupt);
    assert.equal((await restarted.push(snapshot())).status, 200);
  }
});

test('JOED-27 results: rejection persistence failure returns 503 with the last snapshot retained', async t => {
  let failing = false;
  const s = await setup(t, { write: (file, ...args) => {
    if (failing && file.endsWith('feed-rejections.json')) throw new Error('fixture rejection write failed');
    atomicWrite(file, ...args);
  } });
  await s.pushResults(resultsSnapshot()); failing = true;
  const rejected = await s.pushResults({ schema: 'unknown' });
  assert.equal(rejected.status, 503); assert.equal(rejected.body.reason, 'refresh_failed');
  assert.equal(s.model.feeds().results.value.seq, 101);
  failing = false; await s.pushResults({ schema: 'unknown' }); failing = true;
  const accepted = await s.pushResults(resultsSnapshot(102));
  assert.equal(accepted.status, 503); assert.equal(accepted.body.reason, 'refresh_failed');
  assert.equal(s.model.feeds().results.value.seq, 102);
});

test('JOED-27 results: exact 8 MiB transport and served boundaries include UTF-8 receipt overhead', async t => {
  const s = await setup(t);
  const small = JSON.stringify(resultsSnapshot());
  const exactBody = small + ' '.repeat(CONTRACTS.limits.results - Buffer.byteLength(small));
  const accepted = await s.request('/joe/inbox/results', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: exactBody });
  assert.equal(accepted.status, 200); // transport limit is inclusive

  const value = resultsSnapshot(102), trade = { ...value.trades[0], id: 'rt-byte-00000000', company: 'é' };
  value.trades = [];
  const emptyBytes = Buffer.byteLength(JSON.stringify({ ...value, receivedAt: at(0) }));
  const perTrade = Buffer.byteLength(JSON.stringify(trade)) + 1;
  // Leave room for the enlarged full-day count/sums before filling the last
  // bytes with company text. This is a valid record at both byte boundaries.
  const count = Math.floor((CONTRACTS.limits.results - emptyBytes - 128 + 1) / perTrade);
  value.trades = Array.from({ length: count }, (_, n) => ({ ...trade, id: `rt-byte-${String(n).padStart(8, '0')}` }));
  const day = value.days[0].desks.j;
  day.trades = count;
  day.realisedNet.amount = String(-count);
  day.fees.amount = unitsDecimal(decimalUnits(trade.feesEur.amount) * BigInt(count));
  let remaining = CONTRACTS.limits.results - Buffer.byteLength(JSON.stringify({ ...value, receivedAt: at(0) }));
  for (const entry of value.trades) {
    const extra = Math.min(98, remaining); entry.company += 'x'.repeat(extra); remaining -= extra;
    if (!remaining) break;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify({ ...value, receivedAt: at(0) })), CONTRACTS.limits.results);
  assert.equal((await s.pushResults(value)).status, 200);
  assert.ok((await stat(join(s.dataDir, 'results-state.json'))).size > CONTRACTS.limits.results);
  assert.equal(createReadModel({ dataDir: s.dataDir }).feeds().results.value.seq, 102);
  const original = readFileSync(join(s.dataDir, 'results-state.json'));
  // The ingress still fits, but its server-stamped served form is one byte over.
  value.seq = 103; value.trades.at(-1).company += 'x';
  assert.ok(Buffer.byteLength(JSON.stringify(value)) <= CONTRACTS.limits.results);
  const rejected = await s.pushResults(value);
  assert.equal(rejected.status, 422); assert.equal(rejected.body.reason, 'contract_invalid');
  assert.deepEqual(rejected.body.errors, [{ path: '$', rule: 'maxBytes' }]);
  assert.deepEqual(readFileSync(join(s.dataDir, 'results-state.json')), original);
});

test('P2 KEEP: accepted Fleet Config policy withholds affected money and measured history', async t => {
  const s = await setup(t);
  const config = structuredClone(samples['fleet-config']); config.desks.keep.push('DEMO');
  assert.equal(s.model.observeFleet(config).ok, true);
  assert.equal((await s.push(snapshot())).status, 200);
  const states = s.model.panels();
  assert.equal(states['desks.j.equity'].reason, 'source_not_authoritative');
  assert.equal(states['desks.joe.equity'].state, 'fresh'); assert.equal(states['today.equity'].value, null);
  assert.equal(states.positions.value.length, 0); assert.equal(states.kept.value.length, 3);
  const point = (await s.request('/joe/history.json')).body.points[0];
  assert.equal(point.desks.j.money.equity, null); assert.equal(point.totals.equity, null);
  assert.equal(point.desks.joe.money.equity.amount, '5000');
  assert.equal(states.paperAccount.value.amount, '28000');
  const wire = (await s.request('/joe/data.json')).body;
  for (const row of wire.positions.rows) for (const field of ['mark', 'marketValue']) {
    assert.equal(row[field], null);
    assert.equal(row.reasons[field], 'source_not_authoritative');
  }
  const floor = structuredClone(config); floor.desks.keep = ['DEMO'];
  assert.equal(s.model.observeFleet(floor).ok, false);
});

test('P2 Fleet receipt: stored policy constrains first ingress; unchanged reads and restart preserve its age', async t => {
  const dataDir = mkdtempSync(join(ROOT, 'p2-'));
  const config = structuredClone(samples['fleet-config']); config.desks.keep.push('DEMO');
  await writeFile(join(dataDir, 'fleet-config.json'), JSON.stringify(config));
  const s = await setup(t, { dataDir });
  await s.push(snapshot());
  assert.equal(s.model.panels()['today.equity'].reason, 'source_not_authoritative');
  s.time.ms = 45000;
  const response = await s.request('/joe/fleet-config.json');
  assert.equal(response.headers.get('x-joe-received-at'), at(0));
  assert.equal(s.model.panels()['fleet-config'].ageSeconds, 45);
  const restarted = await setup(t, { dataDir, clock: () => at(60000) });
  assert.equal(restarted.model.panels()['fleet-config'].ageSeconds, 60);
  assert.equal((await restarted.request('/joe/fleet-config.json')).headers.get('x-joe-received-at'), at(0));
  assert.equal(restarted.model.panels()['fleet-config'].ageSeconds, 60);
});

test('P2 isolation: single unavailable desk and coupled equity/total P&L keep sibling receipts', async t => {
  const s = await setup(t); await s.push(snapshot());
  s.time.ms = 30000;
  const partial = snapshot(102, 30000);
  for (const f of ['equity', 'totalPnl']) {
    partial.desks[0].money[f] = null;
    (partial.desks[0].money.reasons ??= {})[f] = 'family_projection_unavailable';
    partial.totals[f] = null; (partial.totals.reasons ??= {})[f] = 'family_projection_unavailable';
  }
  assert.equal((await s.push(partial)).status, 200);
  const states = s.model.panels();
  assert.equal(states['desks.j.equity'].valueReceivedAt, at(0));
  assert.equal(states['desks.j.equity'].retained, true);
  assert.equal(states['desks.j.totalPnl'].valueReceivedAt, at(0));
  for (const id of ['joe', 'joel']) {
    assert.equal(states[`desks.${id}.equity`].ageSeconds, 0);
    assert.equal(states[`desks.${id}.equity`].valueReceivedAt, at(30000));
  }
  const point = s.model.feeds().history.value.points.at(-1);
  assert.equal(point.desks.j.money.equity, null); assert.equal(point.totals.equity, null);
  assert.equal(point.desks.joe.money.equity.amount, '5000');
  const onlyEquity = structuredClone(partial); onlyEquity.seq++; onlyEquity.generatedAt = at(31000);
  onlyEquity.desks[0].money.totalPnl = samples.data.desks[0].money.totalPnl;
  delete onlyEquity.desks[0].money.reasons.totalPnl;
  onlyEquity.totals.totalPnl = samples.data.totals.totalPnl; delete onlyEquity.totals.reasons.totalPnl;
  assert.equal((await s.push(onlyEquity)).status, 200);
  assert.equal(s.model.panels()['desks.j.totalPnl'].retained, false);
});

test('P2 executor: reachability and API readiness remain independent in both directions', async t => {
  for (const ready of [true, false]) {
    const s = await setup(t);
    const value = ready ? snapshot() : fixture('a-gateway-up-but-dead');
    if (!ready) { delete value.receivedAt; value.generatedAt = at(0); value.safety.gateway.checkedAt = at(0); }
    value.safety.executor.gatewayReachable = !ready;
    assert.equal((await s.push(value)).status, 200);
    assert.equal(s.model.panels().executor.reason, null);
    assert.equal(s.model.panels().executor.state, 'fresh');
    assert.equal(s.model.panels().gateway.reason, ready ? null : 'upstream_lost');
    assert.equal((await s.request('/joe/healthz')).body.gateway.confirmed, ready);
  }
});

test('P2 history: dedupe generation, null gaps and composite per-desk bases survive restart', async t => {
  const s = await setup(t);
  await s.push(snapshot()); s.time.ms = 30000; await s.push(snapshot(102));
  assert.equal(s.model.feeds().history.value.points.length, 1);
  assert.equal(s.model.feeds().history.value.receivedAt, at(0));
  const gap = snapshot(103, 60000); gap.desks[0].historyBasis = 'j.changed.v2';
  gap.desks[0].accounting = { periodStart: at(0), method: 'execution-fifo-net-current-fx', detail: 'Synthetic basis' };
  gap.desks[0].money.equity = null; gap.desks[0].money.reasons = { equity: 'retained_values' };
  gap.totals.equity = null; gap.totals.reasons = { equity: 'retained_values' };
  s.time.ms = 60000; await s.push(gap);
  s.time.ms = 90000; await s.push(snapshot(104, 90000));
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(90000) });
  const points = restart.feeds().history.value.points;
  assert.deepEqual(points.map(p => p.desks.j.money.equity?.amount ?? null), ['4999', null, '4999']);
  assert.equal(points[1].desks.j.historyBasis, 'j.changed.v2');
  assert.deepEqual(points[1].desks.j.accounting, gap.desks[0].accounting);
  assert.equal(points[1].desks.joe.historyBasis, 'joe.paper.v2');
});

test('P2 storage: data and history write failures are explicit and preserve independent last-good', async t => {
  let failing = '';
  const s = await setup(t, { write: (file, ...args) => {
    if (file.endsWith(failing) && failing) throw new Error('synthetic write failure');
    atomicWrite(file, ...args);
    if (failing === 'history-sync' && file.endsWith('history-state.json')) throw Object.assign(new Error('synthetic directory sync failure'), { committed: true });
  } });
  await s.push(snapshot());
  const original = readFileSync(join(s.dataDir, 'data-state.json'), 'utf8');
  failing = 'data-state.json'; s.time.ms = 30000;
  assert.equal((await s.push(snapshot(102, 30000))).body.reason, 'refresh_failed');
  assert.equal(readFileSync(join(s.dataDir, 'data-state.json'), 'utf8'), original);
  failing = 'history-state.json';
  const result = await s.push(snapshot(102, 30000));
  assert.equal(result.status, 200); assert.equal(result.body.historyReason, 'history_write_failed');
  assert.equal(s.model.feeds().data.value.seq, 102); assert.equal(s.model.feeds().history.value.seq, 1);
  assert.equal((await s.request('/joe/healthz')).body.feeds.history.reason, 'history_write_failed');
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(40000) });
  assert.equal(restart.feeds().history.reason, 'history_write_failed');
  failing = 'history-sync'; s.time.ms = 45000;
  assert.equal((await s.push(snapshot(103, 45000))).body.historyReason, 'history_write_failed');
  assert.equal(s.model.feeds().history.value.points.at(-1).t, at(45000));
  // Dedupe cannot resolve a directory-sync failure; a successful write can.
  failing = ''; s.time.ms = 46000;
  assert.equal((await s.push(snapshot(104, 45000))).status, 200);
  assert.equal(s.model.feeds().history.reason, 'history_write_failed');
  assert.equal(createReadModel({ dataDir: s.dataDir }).feeds().history.reason, 'history_write_failed');
  s.time.ms = 60000; await s.push(snapshot(105, 60000));
  assert.equal(s.model.feeds().history.reason, null);
});

test('P2 durability: a post-rename sync failure cannot roll sequence back in memory or after restart', async t => {
  let failAfterRename = false;
  const s = await setup(t, { write: (file, ...args) => {
    atomicWrite(file, ...args);
    if (failAfterRename && file.endsWith('data-state.json')) throw Object.assign(new Error('synthetic directory sync failure'), { committed: true });
  } });
  await s.push(snapshot()); failAfterRename = true; s.time.ms = 30000;
  assert.equal((await s.push(snapshot(102, 30000))).body.reason, 'refresh_failed');
  assert.equal(s.model.feeds().data.value.seq, 102);
  assert.deepEqual(s.model.feeds().history.value.points.map(p => p.t), [at(0), at(30000)]);
  assert.equal((await s.push(snapshot(102, 30000))).body.reason, 'sequence_replayed');
  const restart = createReadModel({ dataDir: s.dataDir, clock: () => at(30000) });
  assert.deepEqual(restart.feeds().history.value.points.map(p => p.t), [at(0), at(30000)]);
  assert.equal(restart.accept(snapshot(102, 30000)).reason, 'sequence_replayed');
  assert.equal(restart.accept(snapshot(103, 31000)).ok, true);
  assert.deepEqual(restart.feeds().history.value.points.map(p => p.t), [at(0), at(30000), at(31000)]);
});

test('P2 corrupt history: snapshots advance while malformed, invalid and oversized history stays untouched and broken', async t => {
  for (const damage of ['json', 'contract', 'bytes', 'oversize']) {
    const s = await setup(t); await s.push(snapshot());
    s.time.ms = 1000; await s.push(snapshot(102, 1000));
    const file = join(s.dataDir, 'history-state.json');
    const invalidBytes = JSON.parse(readFileSync(file)); invalidBytes.value.sizeBytes++;
    const body = damage === 'json' ? '{' : damage === 'contract' ? JSON.stringify({ format: 'joedesk.history-store.v2', value: { schema: 'old' } }) :
      damage === 'bytes' ? JSON.stringify(invalidBytes) : ' '.repeat(HISTORY_CAP + 1);
    await writeFile(file, body);
    for (let attempt = 0; attempt < 2; attempt++) {
      const writes = [];
      const restarted = await setup(t, { dataDir: s.dataDir,
        write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
      restarted.time.ms = 2000 + attempt * 1000;
      assert.equal(restarted.model.feeds().data.value.seq, 102 + attempt);
      const pushed = await restarted.push(snapshot(103 + attempt, restarted.time.ms));
      assert.equal(pushed.status, 200); assert.equal(pushed.body.historyReason, 'history_write_failed');
      assert.equal(pushed.body.reason, null);
      assert.equal(readFileSync(file, 'utf8'), body);
      assert.ok(!writes.includes('history-state.json'));
      assert.equal(restarted.model.feeds().data.value.seq, 103 + attempt);
      const data = (await restarted.request('/joe/data.json')).body;
      assert.equal(data.seq, 103 + attempt); assert.equal(data.receivedAt, at(restarted.time.ms));
      assert.deepEqual(data.totals, samples.data.totals);
      assert.equal(restarted.model.panels()['today.equity'].state, 'fresh');
      assert.equal(restarted.model.feeds().history.value, null);
      const health = (await restarted.request('/joe/healthz')).body;
      assert.deepEqual(health.feeds.history, { state: 'broken', ageSeconds: null, reason: 'history_write_failed' });
      assert.deepEqual(health.feeds.data, { state: 'fresh', ageSeconds: 0, reason: null });
      assert.equal(health.gateway.confirmed, true);
      const unavailable = await restarted.request('/joe/history.json');
      assert.equal(unavailable.status, 503); assert.equal(unavailable.body.reason, 'history_write_failed');
      const durable = readFileSync(join(s.dataDir, 'data-state.json'), 'utf8');
      assert.equal((await restarted.push(snapshot(1, restarted.time.ms))).body.reason, 'sequence_replayed');
      assert.equal(readFileSync(join(s.dataDir, 'data-state.json'), 'utf8'), durable);
      assert.equal(readFileSync(file, 'utf8'), body);
    }
  }
});

test('P2 packaging: offline allowlist serves shared contracts and rejects arbitrary source paths', async t => {
  const s = await setup(t);
  for (const file of readdirSync(new URL('../contracts/', import.meta.url))) {
    const response = await fetch(s.base + '/joe/contracts/' + file);
    assert.equal(response.status, 200, file);
    assert.equal(await response.text(), readFileSync(new URL('../contracts/' + file, import.meta.url), 'utf8'));
  }
  for (const name of ['time.mjs', 'market-calendar.json']) {
    const response = await fetch(s.base + '/joe/' + name);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
  }
  for (const route of ['/joe/contracts/server.mjs', '/joe/contracts/no-such-file.json', '/joe/server/read-model.mjs', '/joe/release.json']) {
    assert.equal((await s.request(route)).status, 404);
  }
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /^COPY server \.\/server$/m);
  assert.match(docker, /^COPY contracts \.\/contracts$/m);
  assert.match(docker, /^COPY release\.json time\.mjs market-calendar\.json \.\/$/m);
  const nix = readFileSync(new URL('../default.nix', import.meta.url), 'utf8');
  assert.match(nix, /cp -r \$src\/contracts \$src\/server \$out\/share\/joedesk\//);
  assert.match(nix, /install -m 644 \$src\/release\.json \$src\/time\.mjs \$src\/market-calendar\.json \$out\/share\/joedesk\//);
  const redirect = await fetch(s.base + '/joe?desk=j', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/joe/?desk=j');
  const page = await fetch(s.base + '/joe/'); assert.equal(page.status, 200); assert.match(await page.text(), /<base href="\/joe\/">/);
  assert.deepEqual((await s.request('/healthz')).body, { ok: true, service: 'joe-board', hasData: false });
});

test('P3 UI: every shipped module is served, legacy layout assets are not, and the state poll carries no history points', async t => {
  const s = await setup(t);
  const shipped = readdirSync(new URL('../public/joe/', import.meta.url)).filter(name => /\.(js|css|html)$/.test(name));
  for (const name of shipped) {
    const response = await fetch(s.base + '/joe/' + name + '?v=' + activeRelease.version);
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type'), name.endsWith('.css') ? /text\/css/ : name.endsWith('.html') ? /text\/html/ : /text\/javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const route of ['/joe/joe.js', '/joe/joe.css', '/joe/vendor/gridstack-13.2.0-all.js', '/joe/vendor/chart-4.4.8.umd.js']) {
    assert.equal((await s.request(route)).status, 404, route);
  }
  assert.equal((await s.push(snapshot(101, 0))).status, 200);
  s.time.ms = 30000;
  assert.equal((await s.push(snapshot(102, 30000))).status, 200);
  const state = await s.request('/joe/state.json');
  assert.equal(state.status, 200);
  assert.equal(state.body.feeds.history.value, undefined);
  assert.equal(state.body.feeds.history.pointCount, 2);
  assert.equal(state.body.feeds.history.receivedAt, at(30000));
  assert.equal(state.body.panels.history.value, undefined);
  assert.equal(state.body.panels.history.state, 'fresh');
  assert.equal(state.body.feeds.data.value.seq, 102);
  assert.equal((await s.request('/joe/history.json')).body.points.length, 2);
  assert.equal((await fetch(s.base + '/joe/state.json')).status, 401);
});

test('P3 UI: the history worker graph is served only under this release path', async t => {
  const s = await setup(t);
  const release = JSON.parse(readFileSync(new URL('../release.json', import.meta.url)));
  const prefix = `/joe/v/${release.version}/`;
  // The worker and every module it imports, resolved under the release path.
  const graph = ['history-worker.js', 'history-model.js', 'time.mjs', 'market-calendar.json', 'contracts/read.mjs', 'contracts/index.mjs',
    'contracts/schema-validator.mjs', 'contracts/semantics.mjs', 'contracts/vienna-date.mjs', 'contracts/decimal.mjs', 'contracts/gateway.mjs', 'contracts/data.schema.json',
    'contracts/history.schema.json', 'contracts/results.schema.json', 'contracts/fleet-config.schema.json', 'contracts/healthz.schema.json',
    'contracts/common.schema.json', 'contracts/reason.schema.json', 'contracts/manifest.json'];
  for (const name of graph) {
    const response = await fetch(s.base + prefix + name);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), readFileSync(new URL(name.startsWith('contracts/') ? `../${name}` : ['time.mjs', 'market-calendar.json'].includes(name) ? `../${name}` : `../public/joe/${name}`, import.meta.url), 'utf8'), name);
  }
  for (const route of ['/joe/v/00.00.00.00.00/history-worker.js', `${prefix}index.html`, prefix, `${prefix}state.json`, `${prefix}history.json`,
    `${prefix}app.css`, `${prefix}../server.mjs`, `${prefix}contracts/../../server.mjs`, `${prefix}fleet-config.example.json`]) {
    assert.equal((await s.request(route)).status, 404, route);
  }
});

function historySeries(count = 10000) {
  const base = samples.history.points[0];
  return { schema: CONTRACTS.contracts.history, seq: 1, generatedAt: at(0), receivedAt: at(0), sizeBytes: 0,
    points: Array.from({ length: count }, (_, i) => ({ ...structuredClone(base), t: at(i * 1000) })) };
}

test('P2 compaction: UTF-8 envelope warning compacts before 6.4MiB and preserves extrema and gap/basis edges', () => {
  const value = historySeries();
  for (const [i, amount] of [[31, '-100'], [32, '90000']]) {
    value.points[i].desks.j.money.equity.amount = amount;
    value.points[i].totals.equity.amount = String(BigInt(amount) + 10000n);
  }
  value.points[47].desks.j.money.equity = null; value.points[47].totals.equity = null;
  value.points[47].desks.j.money.reasons = { equity: 'retained_values' };
  value.points[47].totals.reasons = { equity: 'retained_values' };
  value.points[50].desks.j.historyBasis = 'j.changed';
  value.points[51].desks.j.accounting = { periodStart: at(0), method: 'execution-fifo-net-current-fx', detail: 'é'.repeat(240) };
  assert.ok(measureHistory(value) >= HISTORY_WARNING);
  const original = structuredClone(value.points);
  boundHistory(value);
  assert.ok(value.sizeBytes < HISTORY_WARNING); assert.equal(value.reason, undefined);
  assert.equal(value.compactedThrough, original.at(-1).t);
  assert.ok(value.points.length < original.length);
  for (const i of [0, 31, 32, 46, 47, 48, 49, 50, 51, 52, original.length - 1]) {
    assert.deepEqual(value.points.find(p => p.t === original[i].t), original[i], String(i));
  }
  assert.equal(value.sizeBytes, Buffer.byteLength(JSON.stringify(historyEnvelope(value))));
  assert.equal(validateContract('history', value).ok, true);
});

test('P2 daily closes: compaction retains every Vienna day final observed equity before null gaps', () => {
  const value = historySeries(1000);
  value.points.forEach((p, i) => { p.t = at(i * 30000); });
  const boundary = value.points.findIndex((p, i) => i && viennaDay(p.t) !== viennaDay(value.points[i - 1].t));
  assert.ok(boundary > 3);
  value.points[boundary - 1].desks.j.money.equity = null;
  value.points[boundary - 1].totals.equity = null;
  const compacted = compactPoints(value.points);
  assert.ok(compacted.some(p => p.t === value.points[boundary - 2].t));
  assert.ok(compacted.some(p => p.t === value.points[boundary - 1].t));
  assert.ok(compacted.some(p => p.t === value.points.at(-1).t));
});

function atCap(target, metadata = {}) {
  const value = { ...historySeries(), ...metadata };
  // Every point is a real basis boundary; compaction cannot drop it to fit.
  value.points.forEach((p, i) => { p.desks.j.historyBasis = `j.${i % 2}`; });
  let delta = target - measureHistory(value);
  assert.ok(delta > 0);
  for (const p of value.points) {
    const extra = Math.min(90, delta);
    p.desks.j.historyBasis += 'x'.repeat(extra); delta -= extra;
    if (!delta) break;
  }
  assert.equal(delta, 0); assert.equal(measureHistory(value), target);
  return value;
}

test('P2 hard cap: exact 8MiB complete envelope writes; +1 byte fails explicitly before persistence', async t => {
  const s = await setup(t);
  // Include compaction metadata when measuring every envelope byte.
  const exact = atCap(HISTORY_CAP, { compactedThrough: at(9999000) });
  boundHistory(exact);
  assert.equal(exact.sizeBytes, HISTORY_CAP); assert.equal(exact.points.length, 10000);
  atomicWrite(join(s.dataDir, 'history-state.json'), historyEnvelope(exact), HISTORY_CAP);
  assert.equal((await stat(join(s.dataDir, 'history-state.json'))).size, HISTORY_CAP);
  const original = readFileSync(join(s.dataDir, 'history-state.json'));
  const over = structuredClone(exact); over.points[0].desks.j.historyBasis += 'x';
  assert.throws(() => boundHistory(over), /history_size_limit/);
  assert.deepEqual(readFileSync(join(s.dataDir, 'history-state.json')), original);
  assert.equal(validateContract('history', exact).ok, true);
  const restarted = await setup(t, { dataDir: s.dataDir, clock: () => at(10000000) });
  const pushed = await restarted.push(snapshot(101, 10000000));
  assert.equal(pushed.status, 200); assert.equal(pushed.body.historyReason, 'history_size_limit');
  assert.deepEqual(readFileSync(join(s.dataDir, 'history-state.json')), original);
  const health = (await restarted.request('/joe/healthz')).body;
  assert.equal(health.feeds.data.state, 'fresh'); assert.equal(health.feeds.history.reason, 'history_size_limit');
  const recovery = await setup(t, { dataDir: s.dataDir }); recovery.time.ms = 10001000;
  assert.equal((await recovery.request('/joe/healthz')).body.feeds.history.reason, 'history_size_limit');
  const stillFull = await recovery.push(snapshot(102, 10001000));
  assert.equal(stillFull.body.historyReason, 'history_size_limit');
  assert.deepEqual(readFileSync(join(s.dataDir, 'history-state.json')), original);
  recovery.time.ms += 15 * 86400000;
  assert.equal((await recovery.push(snapshot(103, recovery.time.ms))).body.historyReason, null);
  assert.equal((await recovery.request('/joe/healthz')).body.feeds.history.state, 'fresh');
});

test('P2 history metadata: compacted history stays fresh across restart and turns snapshot_stale at 60 seconds', async t => {
  const dataDir = mkdtempSync(join(ROOT, 'p2-'));
  const history = historySeries(); measureHistory(history);
  assert.ok(history.sizeBytes >= HISTORY_WARNING && history.sizeBytes < HISTORY_CAP);
  atomicWrite(join(dataDir, 'history-state.json'), historyEnvelope(history), HISTORY_CAP);
  const s = await setup(t, { dataDir, clock: () => at(10000000) });
  const result = await s.push(snapshot(101, 10000000));
  assert.equal(result.body.historyReason, null);
  const stored = (await s.request('/joe/history.json')).body;
  assert.ok(stored.sizeBytes < HISTORY_WARNING); assert.equal(stored.reason, undefined);
  assert.equal(stored.compactedThrough, at(10000000));
  const health = (await s.request('/joe/healthz', { headers: { 'x-auth-request-user': '' } })).body;
  assert.equal(health.feeds.history.reason, null); assert.equal(health.feeds.history.state, 'fresh');
  assert.equal(health.feeds.data.state, 'fresh');
  assert.equal(s.model.panels().history.state, 'fresh');
  const restart = await setup(t, { dataDir }); restart.time.ms = 10001000;
  await restart.push(snapshot(102, restart.time.ms));
  assert.equal(restart.model.feeds().history.value.reason, undefined);
  assert.equal(restart.model.feeds().history.value.compactedThrough, stored.compactedThrough);
  assert.equal((await restart.request('/joe/healthz')).body.feeds.history.state, 'fresh');
  for (const elapsed of [59999, 60000, 60001, 86400000]) {
    restart.time.ms = 10001000 + elapsed;
    const expected = { state: elapsed < 60000 ? 'fresh' : 'stale', ageSeconds: elapsed / 1000,
      reason: elapsed < 60000 ? null : 'snapshot_stale' };
    assert.deepEqual((await restart.request('/joe/healthz')).body.feeds.history, expected);
    const panel = restart.model.panels().history;
    for (const key of Object.keys(expected)) assert.equal(panel[key], expected[key]);
    const cold = createReadModel({ dataDir, clock: () => at(restart.time.ms) });
    assert.equal(cold.panels().history.reason, expected.reason);
  }
  // The compacted range ages out while one later, uncompacted point remains.
  restart.time.ms = 10000000 + 14 * 86400000 + 1;
  assert.equal((await restart.push(snapshot(103, restart.time.ms))).status, 200);
  assert.equal(restart.model.feeds().history.value.reason, undefined);
  assert.equal(restart.model.feeds().history.value.compactedThrough, undefined);
  assert.deepEqual(restart.model.feeds().history.value.points.map(p => p.t), [at(10001000), at(restart.time.ms)]);
  assert.equal((await restart.request('/joe/healthz')).body.feeds.history.state, 'fresh');
});

test('P2 history cadence: 16 days of 30-second observations remain fresh through repeated compactions', () => {
  const cadence = 30000, batch = 240, duration = 16 * 86400000;
  const point = samples.history.points[0];
  let history = null;
  const compactedRanges = new Set();
  // Replay the complete cadence in two-hour batches to bound test CPU cost.
  // appendHistory owns pruning, compaction, metadata and each final receipt.
  for (let start = 0; start < duration / cadence; start += batch) {
    const pending = history ? { ...history, points: [...history.points] } : historySeries(0);
    for (let n = start; n < start + batch - 1; n++) pending.points.push({ ...point, t: at(n * cadence) });
    const ms = (start + batch - 1) * cadence;
    const accepted = { ...snapshot(start + batch, ms), receivedAt: at(ms) };
    history = appendHistory(pending, accepted, panelStates({ data: { value: accepted } }, at(ms)), at(ms));
    if (history.compactedThrough) compactedRanges.add(history.compactedThrough);
    assert.equal(history.reason, undefined);
    assert.ok(history.points.length <= 10000 && history.sizeBytes <= HISTORY_CAP);
    assert.ok(Date.parse(history.points[0].t) >= BASE_TIME + ms - 14 * 86400000);
    for (const elapsed of [0, cadence]) {
      const cell = panelState({ value: history }, history, history.reason, at(ms + elapsed));
      assert.equal(cell.state, 'fresh'); assert.equal(cell.reason, null); assert.equal(cell.ageSeconds, elapsed / 1000);
    }
  }
  assert.ok(compactedRanges.size >= 3, `Expected repeated compactions, got ${compactedRanges.size}`);
  assert.equal(history.points.at(-1).t, at(duration - cadence));
});

test('P2 history retention: server time prunes old points even with a slow producer clock', () => {
  const previous = historySeries(2);
  previous.points[0].t = at(-14 * 86400000 - 1);
  previous.points[1].t = at(-14 * 86400000);
  const accepted = { ...snapshot(101, -1000), receivedAt: at(0) };
  const states = panelStates({ data: { value: accepted } }, at(0));
  const history = appendHistory(previous, accepted, states, at(0));
  assert.deepEqual(history.points.map(p => p.t), [at(-14 * 86400000), at(-1000)]);
});

test('P2 history: J backfill is never accepted or copied into observed v2 history', async t => {
  const s = await setup(t); await s.push(snapshot());
  const original = readFileSync(join(s.dataDir, 'history-state.json'), 'utf8');
  const extra = snapshot(102, 1000); extra.desks[0].equityBackfill = [{ t: at(-3600000), equity: 5000 }];
  const rejected = await s.push(extra);
  assert.equal(rejected.status, 422); assert.equal(rejected.body.reason, 'contract_invalid');
  assert.deepEqual(rejected.body.errors, [{ path: '$.desks[0]', rule: 'additionalProperties' }]);
  assert.equal(readFileSync(join(s.dataDir, 'history-state.json'), 'utf8'), original);
  s.time.ms = 1000; assert.equal((await s.push(snapshot(103, 1000))).status, 200);
  const history = (await s.request('/joe/history.json')).body;
  assert.deepEqual(history.points.map(p => p.t), [at(0), at(1000)]);
  assert.equal(JSON.stringify(history).includes('Backfill'), false);
});

test('P2 repeated NY hour: distinct UTC receipts and history points survive compaction and restart', async t => {
  const first = '2026-11-01T05:30:00.000Z', second = '2026-11-01T06:30:00.000Z';
  let now = first;
  const s = await setup(t, { clock: () => now });
  for (const [seq, instant] of [[101, first], [102, second]]) {
    now = instant;
    const value = snapshot(seq); value.generatedAt = instant; value.safety.gateway.checkedAt = instant;
    assert.equal((await s.push(value)).status, 200);
  }
  const restarted = createReadModel({ dataDir: s.dataDir, clock: () => second });
  const points = compactPoints(restarted.feeds().history.value.points);
  assert.deepEqual(points.map(p => p.t), [first, second]);
  assert.equal(restarted.panels()['today.equity'].valueReceivedAt, second);
  assert.equal(restarted.panels()['today.equity'].ageSeconds, 0);
});

test('P2 history sums: every field rejects missing/null desks or fields and unequal family sums', () => {
  for (const field of MONEY_FIELDS) for (const mutation of ['desk', 'field', 'null', 'sum']) {
    const value = historySeries(1);
    if (mutation === 'desk') delete value.points[0].desks.j;
    if (mutation === 'field') delete value.points[0].desks.j.money[field];
    if (mutation === 'null') value.points[0].desks.j.money[field] = null;
    if (mutation === 'sum') value.points[0].totals[field].amount = '17';
    const result = validateContract('history', value);
    assert.equal(result.ok, false, `${field}: ${mutation}`);
    assert.ok(result.errors.some(e => e.rule === (mutation === 'sum' ? 'deskSum' : 'incompleteDeskSum')));
  }
});

test('P2 gap storage: empty, leading/internal/trailing and outage-only windows remain null observations', () => {
  assert.deepEqual(compactPoints([]), []);
  const value = historySeries(128);
  for (const i of [0, 1, 40, 41, 42, 126, 127]) {
    for (const d of Object.values(value.points[i].desks)) d.money.equity = null;
    value.points[i].totals.equity = null;
  }
  const compacted = compactPoints(value.points);
  for (const i of [0, 1, 2, 39, 40, 42, 43, 125, 126, 127]) assert.ok(compacted.some(p => p.t === value.points[i].t), String(i));
  const inside = value.points.slice(40, 43);
  assert.ok(compactPoints(inside).every(p => p.totals.equity === null));
});

test('P2 performance: 256 positions and 10000 history points fit the local 5s CPU budget', async t => {
  const s = await setup(t); const data = snapshot();
  data.positions.rows = Array.from({ length: 256 }, (_, i) => ({ ...data.positions.rows[0], symbol: `DEMO${i}` }));
  const history = historySeries();
  const start = performance.now();
  assert.equal((await s.push(data)).status, 200); boundHistory(history);
  const elapsed = performance.now() - start;
  t.diagnostic(`256-position accept + 10000-point compact/validate: ${elapsed.toFixed(1)}ms; local CPU budget 5000ms`);
  assert.ok(elapsed < 5000, `${elapsed}ms`);
});

  test("Fleet Config propagates one atomic paper revision to the shared adapter", async t => {
    const { base: BASE, dataDir: DATA_DIR, request: jsonFetch } = await setup(t);
    const fleetWriteHeaders = () => ({ "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin", "x-auth-request-user": FLEET_ACTOR });
    const initial = await jsonFetch("/joe/fleet-config.json");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.schema, "inspr.joe.fleet-config.v1");
    assert.equal(initial.body.mode, "paper");
    assert.equal(initial.body.rev, "fc-000000");
    assert.equal(initial.headers.get("etag"), '"fc-000000"');
    assert.equal(initial.headers.get("x-joe-fleet-source-kind"), "example");
    assert.match(initial.headers.get("x-joe-fleet-source-path"), /\/public\/joe\/fleet-config\.example\.json$/);
    const emptyActions = await jsonFetch("/joe/fleet-config/actions.json");
    assert.equal(emptyActions.status, 200);
    assert.deepEqual(emptyActions.body, { schema: "inspr.joe.fleet-config.actions.v1", entries: [] });

    const anonymousWrite = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin", "x-auth-request-user": "" },
      body: JSON.stringify({ baseRev: initial.body.rev, config: initial.body }),
    });
    assert.equal(anonymousWrite.status, 403);
    assert.equal(anonymousWrite.body.error, "Zitadel-authenticated user required");
    assert.deepEqual((await jsonFetch("/joe/fleet-config/actions.json")).body.entries, []);

    const invalid = structuredClone(initial.body);
    invalid.secretSlots.agenix = ["NOT-A-REFERENCE"];
    const rejected = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: fleetWriteHeaders(),
      body: JSON.stringify({ baseRev: initial.body.rev, config: invalid }),
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.error, "schema validation failed");
    assert.equal(rejected.body.action.actor, FLEET_ACTOR);
    assert.deepEqual(rejected.body.action.changedKeys, ["secretSlots.[redacted]"]);
    assert.equal(rejected.body.action.outcome, "failure");

    const protectedSlot = structuredClone(initial.body);
    protectedSlot.secretSlots.janus = ["paper-session"];
    const protectedSlotResult = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: fleetWriteHeaders(),
      body: JSON.stringify({ baseRev: initial.body.rev, config: protectedSlot }),
    });
    assert.equal(protectedSlotResult.status, 422);
    assert.equal(protectedSlotResult.body.error, "secret slots are read-only in HOSTD-49");
    assert.deepEqual(protectedSlotResult.body.action.changedKeys, ["secretSlots.[redacted]"]);

    const noChange = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: fleetWriteHeaders(),
      body: JSON.stringify({ baseRev: initial.body.rev, config: initial.body }),
    });
    assert.equal(noChange.status, 422);
    assert.equal(noChange.body.error, "fleet config has no changes");

    const candidate = structuredClone(initial.body);
    candidate.desks.maxBusyDesks = 4;
    const propagated = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: fleetWriteHeaders(),
      body: JSON.stringify({ baseRev: initial.body.rev, config: candidate }),
    });
    assert.equal(propagated.status, 200);
    assert.equal(propagated.body.ok, true);
    assert.equal(propagated.body.rev, "fc-000001");
    assert.equal(propagated.body.config.mode, "paper");
    assert.equal(propagated.body.config.desks.maxBusyDesks, 4);
    assert.deepEqual(propagated.body.action.changedKeys, ["desks.maxBusyDesks"]);
    assert.equal(propagated.body.action.actor, FLEET_ACTOR);
    assert.equal(propagated.body.action.revBefore, "fc-000000");
    assert.equal(propagated.body.action.revAfter, "fc-000001");
    assert.equal(propagated.body.action.outcome, "success");
    assert.deepEqual(propagated.body.adapter, {
      id: "shared-file",
      status: "written",
      path: join(DATA_DIR, "fleet-config.json"),
      consumers: ["amy", "desks"],
      reload: "read-on-revision",
    });

    const stored = JSON.parse(await readFile(join(DATA_DIR, "fleet-config.json"), "utf8"));
    assert.deepEqual(stored, propagated.body.config);
    assert.equal((await stat(join(DATA_DIR, "fleet-config.json"))).mode & 0o777, 0o644);
    assert.equal((await readdir(DATA_DIR)).includes("fleet-config.json.next"), false);
    const storedActionsText = await readFile(join(DATA_DIR, "fleet-config-actions.json"), "utf8");
    const storedActions = JSON.parse(storedActionsText);
    assert.equal((await stat(join(DATA_DIR, "fleet-config-actions.json"))).mode & 0o777, 0o600);
    assert.equal(storedActions.schema, "inspr.joe.fleet-config.actions.v1");
    assert.equal(storedActions.entries.at(-1).outcome, "success");
    assert.equal(storedActions.entries.at(-1).actor, FLEET_ACTOR);
    assert.equal(storedActions.entries.at(-1).changedKeys[0], "desks.maxBusyDesks");
    assert.equal(storedActionsText.includes("NOT-A-REFERENCE"), false);
    assert.equal(storedActionsText.includes("paper-session"), false);

    const current = await jsonFetch("/joe/fleet-config.json");
    assert.equal(current.headers.get("x-joe-fleet-source-kind"), "stored");
    assert.equal(current.headers.get("x-joe-fleet-source-path"), join(DATA_DIR, "fleet-config.json"));
    assert.equal(current.body.rev, "fc-000001");
    const notModified = await fetch(`${BASE}/joe/fleet-config.json`, { headers: { "if-none-match": '"fc-000001"', "x-auth-request-user": FLEET_ACTOR } });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.get("cache-control"), "private, no-cache");
    const stale = await jsonFetch("/joe/fleet-config/propagate", {
      method: "POST",
      headers: fleetWriteHeaders(),
      body: JSON.stringify({ baseRev: initial.body.rev, config: candidate }),
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.currentRev, "fc-000001");
    assert.equal(stale.body.action.outcome, "failure");
    const actions = await jsonFetch("/joe/fleet-config/actions.json");
    assert.equal(actions.status, 200);
    assert.equal(actions.body.entries.length, 5);
    assert.deepEqual(actions.body.entries.map((entry) => entry.outcome), ["failure", "failure", "failure", "success", "failure"]);
    assert.ok(actions.body.entries.every((entry) => entry.actor === FLEET_ACTOR));

    await writeFile(join(DATA_DIR, "fleet-config.json"), '{"schema":"invalid"}\n');
    const unavailable = await jsonFetch("/joe/fleet-config.json");
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.body, { ok: false, error: "fleet config unavailable", reason: "refresh_failed" });
    const boardHealth = await jsonFetch("/healthz");
    assert.equal(boardHealth.status, 200);
    assert.equal(boardHealth.body.ok, true);
    await writeFile(join(DATA_DIR, "fleet-config.json"), `${JSON.stringify(stored, null, 2)}\n`);
  });
