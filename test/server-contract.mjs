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
  return { dataDir, base, request, push, time, model: server.readModel };
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
  assert.equal(first.versionScheme, 'calendar'); assert.equal(first.version, '26.09.21.12.00');
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
    assert.equal(feed.reason, name === 'results' ? 'results_not_wired' : 'feed_not_received');
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
  s.time.ms = 1000; await s.push(snapshot(102)); // data receipt advances; history deduplicates
  s.time.ms = 2000; await s.request('/joe/fleet-config.json');
  const expectedAges = { data: 608, history: 609, results: 610, 'fleet-config': 607 };
  for (const kind of ['data', 'history', 'results', 'fleet-config']) {
    const good = await s.request(`/joe/${kind}.json`);
    assert.equal(good.headers.get('x-joe-server-now'), kind === 'results' ? null : at(2000));
    let retained;
    if (kind === 'results') {
      assert.equal(good.status, 503); assert.equal(good.body.reason, 'results_not_wired');
      // P4 owns the real Results producer. This one cache is explicitly synthetic;
      // the other three receipt ages come from the production HTTP responses.
      retained = { value: { ...structuredClone(samples.results), receivedAt: at(-1000) } };
    } else {
      assert.equal(good.status, 200);
      retained = acceptRead(kind, { status: good.status, payload: good.body,
        receivedAt: good.headers.get('x-joe-received-at'), generatedAdvancedAt: good.headers.get('x-joe-generated-advanced-at') });
    }
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

test('P2 results: only v2 not-wired state; no executor producer fields or write route', async t => {
  const s = await setup(t);
  const result = await s.request('/joe/results.json');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, schema: CONTRACTS.contracts.results, reason: 'results_not_wired' });
  assert.equal((await s.request('/joe/results.json', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await s.request('/joe/inbox/results', { method: 'POST', body: '{}' })).status, 405);
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

test('P2 corrupt history: malformed, invalid and oversized stores fail closed without overwriting or resetting sequence', async t => {
  for (const damage of ['json', 'contract', 'bytes', 'oversize']) {
    const s = await setup(t); await s.push(snapshot());
    s.time.ms = 1000; await s.push(snapshot(102, 1000));
    const file = join(s.dataDir, 'history-state.json');
    const invalidBytes = JSON.parse(readFileSync(file)); invalidBytes.value.sizeBytes++;
    const body = damage === 'json' ? '{' : damage === 'contract' ? JSON.stringify({ format: 'joedesk.history-store.v2', value: { schema: 'old' } }) :
      damage === 'bytes' ? JSON.stringify(invalidBytes) : ' '.repeat(HISTORY_CAP + 1);
    await writeFile(file, body);
    const snapshotBefore = readFileSync(join(s.dataDir, 'data-state.json'), 'utf8');
    for (let attempt = 0; attempt < 2; attempt++) {
      const restarted = await setup(t, { dataDir: s.dataDir }); restarted.time.ms = 2000 + attempt * 1000;
      const pushed = await restarted.push(snapshot(103 + attempt, restarted.time.ms));
      assert.equal(pushed.status, 503); assert.equal(pushed.body.reason, 'history_write_failed');
      assert.equal(readFileSync(file, 'utf8'), body);
      assert.equal(readFileSync(join(s.dataDir, 'data-state.json'), 'utf8'), snapshotBefore);
      assert.equal(restarted.model.feeds().data.value.seq, 102);
      assert.equal(restarted.model.feeds().history.value, null);
      assert.equal((await restarted.request('/joe/healthz')).body.feeds.history.reason, 'history_write_failed');
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
  assert.ok(value.sizeBytes < HISTORY_WARNING); assert.equal(value.reason, 'history_compacted');
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
  // Include the alarm before measuring to account for every envelope byte.
  const exact = atCap(HISTORY_CAP, { reason: 'history_compacted', compactedThrough: at(9999000) });
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

test('P2 history alarm: successful near-cap compaction is visible through history and anonymous health', async t => {
  const dataDir = mkdtempSync(join(ROOT, 'p2-'));
  const history = historySeries(); measureHistory(history);
  assert.ok(history.sizeBytes >= HISTORY_WARNING && history.sizeBytes < HISTORY_CAP);
  atomicWrite(join(dataDir, 'history-state.json'), historyEnvelope(history), HISTORY_CAP);
  const s = await setup(t, { dataDir, clock: () => at(10000000) });
  const result = await s.push(snapshot(101, 10000000));
  assert.equal(result.body.historyReason, 'history_compacted');
  const stored = (await s.request('/joe/history.json')).body;
  assert.ok(stored.sizeBytes < HISTORY_WARNING); assert.equal(stored.reason, 'history_compacted');
  const health = (await s.request('/joe/healthz', { headers: { 'x-auth-request-user': '' } })).body;
  assert.equal(health.feeds.history.reason, 'history_compacted'); assert.equal(health.feeds.history.state, 'stale');
  assert.equal(health.feeds.data.state, 'fresh');
  assert.equal(s.model.panels().history.state, 'stale');
  const restart = await setup(t, { dataDir }); restart.time.ms = 10001000;
  await restart.push(snapshot(102, restart.time.ms));
  assert.equal(restart.model.feeds().history.value.reason, 'history_compacted');
  assert.equal((await restart.request('/joe/healthz')).body.feeds.history.state, 'stale');
  // The compacted range ages out while one later, uncompacted point remains.
  restart.time.ms = 10000000 + 14 * 86400000 + 1;
  assert.equal((await restart.push(snapshot(103, restart.time.ms))).status, 200);
  assert.equal(restart.model.feeds().history.value.reason, undefined);
  assert.equal(restart.model.feeds().history.value.compactedThrough, undefined);
  assert.deepEqual(restart.model.feeds().history.value.points.map(p => p.t), [at(10001000), at(restart.time.ms)]);
  assert.equal((await restart.request('/joe/healthz')).body.feeds.history.state, 'fresh');
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
  assert.equal((await s.push(extra)).status, 422);
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
