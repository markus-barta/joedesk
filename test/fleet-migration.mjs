import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { backupStore, migrateToV2, checkFleet } from '../release/data-migration.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { createJoeServer } from '../server.mjs';
import { validateContract } from '../contracts/index.mjs';
import { checkSchema } from '../contracts/schema-validator.mjs';
import { inspectFleetConfig } from '../server/fleet-normalization.mjs';
import actionSchema from '../public/joe/fleet-config-actions.schema.json' with { type: 'json' };

const json = file => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const sample = json('fixtures/valid.json').data;
const NOW = sample.receivedAt;
const ingress = () => { const value = structuredClone(sample); delete value.receivedAt; return value; };
const audit = { schema: 'inspr.joe.fleet-config.actions.v1', entries: [
  { id: 'fa-100-1234abcd', at: NOW, actor: 'fixture', revBefore: 'fc-000001', revAfter: null,
    changedKeys: [], outcome: 'pending', reason: 'write_started' },
  { id: 'fa-101-1234abce', at: NOW, actor: 'fixture', revBefore: 'fc-000001', revAfter: 'fc-000001',
    changedKeys: [], outcome: 'failure', reason: 'revision_conflict' },
] };
const cases = [
  ['missing TSLA', ['EXAMPLE', 'SXR8'], ['EXAMPLE', 'SXR8', 'TSLA']],
  ['missing SXR8', ['EXAMPLE', 'TSLA'], ['EXAMPLE', 'TSLA', 'SXR8']],
  ['missing both (live shape)', ['EXAMPLE', 'ALPHA'], ['EXAMPLE', 'ALPHA', 'SXR8', 'TSLA']],
  ['empty KEEP', [], ['SXR8', 'TSLA']],
];
function temporary(t) { const root = scratch('joed-58-test-'); t.after(() => discard(root, 'fleet migration test')); return root; }
function fleet(keep = ['SXR8', 'TSLA']) {
  const value = json('public/joe/fleet-config.example.json');
  value.rev = 'fc-000019';
  value.desks.keep = keep;
  value.mac.shared = { configPath: '/fixture/config.json', docsPath: '/fixture/docs' };
  value.tools.entries = [{ id: 'fixture', label: 'Fixture' }];
  value.secretSlots = { agenix: [], janus: [] };
  return value;
}
function history(length) {
  return { ...audit, entries: Array.from({ length }, (_, i) => ({
    ...audit.entries[i % audit.entries.length], id: `fa-${1000 + i}-${i.toString(16).padStart(8, '0')}`,
  })) };
}
function legacy(root, config, log = audit) {
  const source = join(root, 'source'), backup = join(root, 'backup'), destination = join(root, 'v2');
  fs.mkdirSync(source);
  fs.writeFileSync(join(source, 'data.json'), '{"schema":"inspr.joe.household.v1"}\n');
  fs.writeFileSync(join(source, 'fleet-config.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 4) + '\n\n');
  if (log !== null) fs.writeFileSync(join(source, 'fleet-config-actions.json'), typeof log === 'string' ? log : JSON.stringify(log, null, 4) + '\n\n');
  backupStore({ source, destination: backup, boardSchema: 'v1' });
  return { source, backup, destination, snapshot: ingress(), receivedAt: NOW };
}
function contents(dir) {
  return ['.', ...fs.readdirSync(dir).sort()].map(name => {
    const file = join(dir, name), stat = fs.lstatSync(file);
    return { name, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
      bytes: stat.isFile() ? fs.readFileSync(file).toString('hex') : null };
  });
}
function assertAudit(log) {
  // Check the actual audit schema, adapting only the validator's unsupported
  // union type syntax, independently of the implementation's validation call.
  const schema = structuredClone(actionSchema);
  for (const key of ['revBefore', 'revAfter']) {
    schema.$defs.action.properties[key].anyOf = [{ type: 'string' }, { type: 'null' }];
    delete schema.$defs.action.properties[key].type;
  }
  assert.deepEqual(checkSchema(schema, log, {}), []);
}
const cli = args => spawnSync(process.execPath, ['scripts/prepare-data.mjs', ...args], { encoding: 'utf8' });
async function listen(t, dataDir, clock = () => NOW) {
  const server = createJoeServer({ dataDir, clock, inboxToken: 'joed-58-fixture' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/joe/`;
}

test('JOED-118: an uninitialized installation may keep using the starter across restart', async t => {
  const root = temporary(t);
  for (let boot = 0; boot < 2; boot++) {
    const base = await listen(t, root);
    const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-joe-fleet-source-kind'), 'example');
    assert.deepEqual(await response.json(), json('public/joe/fleet-config.example.json'));
    assert.equal(fs.existsSync(join(root, 'fleet-config.json')), false);
  }
});

for (const [first, rev] of [['read', 'fc-000019'], ['propagate', 'fc-000019'],
  ['restart', 'fc-000019'], ['restart', 'fc-000000']]) test(`JOED-118: missing accepted policy ${rev} fails closed on ${first}; restoration preserves receipt`, async t => {
  const root = temporary(t), config = fleet(['SXR8', 'TSLA', 'DEMO']);
  config.rev = rev;
  config.desks.maxBusyDesks = 1;
  config.desks.stage0.capEur = 1;
  const file = join(root, 'fleet-config.json'), offline = join(root, 'fleet-config.offline.json');
  fs.writeFileSync(file, JSON.stringify(config));
  let base = await listen(t, root);
  const receipt = fs.readFileSync(join(root, 'fleet-receipt.json'));
  fs.renameSync(file, offline); // This test's own file, restored below.
  if (first === 'restart') base = await listen(t, root, () => new Date(Date.parse(NOW) + 60000).toISOString());
  const request = (route, init = {}) => fetch(base + route, { ...init,
    headers: { 'x-auth-request-user': 'fixture', ...init.headers } });
  const state = async () => (await request('state.json')).json();
  const propagate = candidate => request('fleet-config/propagate', { method: 'POST', headers: {
    'content-type': 'application/json', origin: new URL(base).origin, 'sec-fetch-site': 'same-origin',
  }, body: JSON.stringify({ baseRev: candidate.rev, config: candidate }) });
  const starter = json('public/joe/fleet-config.example.json'); starter.desks.maxBusyDesks = 2;
  const changed = structuredClone(config); changed.desks.maxBusyDesks = 2;
  const assertUnavailable = async () => {
    const view = await state();
    assert.deepEqual(view.feeds['fleet-config'].value, config);
    assert.equal(view.feeds['fleet-config'].receivedAt, NOW);
    assert.equal(view.feeds['fleet-config'].reason, 'refresh_failed');
    assert.equal(view.panels['fleet-config'].state, 'broken');
    assert.equal(view.panels['fleet-config'].retained, true);
    assert.deepEqual(fs.readFileSync(join(root, 'fleet-receipt.json')), receipt);
    assert.equal(fs.existsSync(file), false);
  };
  if (first === 'restart') await assertUnavailable(); // Before a settings read.
  if (first === 'propagate') {
    const response = await propagate(starter);
    assert.equal(response.status, 503);
    await response.body?.cancel();
    await assertUnavailable();
  }
  for (const headers of [{}, { 'if-none-match': `"${config.rev}"` }]) {
    const response = await request('fleet-config.json', { headers });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, 'refresh_failed');
    await assertUnavailable();
  }
  for (const candidate of [starter, changed]) {
    const response = await propagate(candidate);
    assert.equal(response.status, 503);
    await response.body?.cancel();
    await assertUnavailable();
  }
  const accepted = await request('inbox', { method: 'POST',
    headers: { authorization: 'Bearer joed-58-fixture' }, body: JSON.stringify(ingress()) });
  assert.equal(accepted.status, 200); await accepted.body?.cancel();
  assert.equal((await state()).panels['desks.j.equity'].reason, 'source_not_authoritative',
    'the extra accepted KEEP symbol must still constrain incoming money');
  fs.renameSync(offline, file);
  const restored = await request('fleet-config.json', { headers: { 'if-none-match': `"${config.rev}"` } });
  assert.equal(restored.status, 304);
  const recovered = (await state()).feeds['fleet-config'];
  assert.deepEqual(recovered.value, config); assert.equal(recovered.reason, null);
  assert.equal(recovered.receivedAt, NOW);
  assert.deepEqual(fs.readFileSync(join(root, 'fleet-receipt.json')), receipt);
  const propagated = await propagate(changed);
  assert.equal(propagated.status, 200); await propagated.body?.cancel();
  assert.equal(JSON.parse(fs.readFileSync(file)).desks.maxBusyDesks, 2);
});

test('JOED-118: the read model rejects starter replacement of accepted policy, including after restart', t => {
  const root = temporary(t), config = fleet(['SXR8', 'TSLA', 'DEMO']);
  config.desks.maxBusyDesks = 1;
  const starter = json('public/joe/fleet-config.example.json');
  let model = createReadModel({ dataDir: root, clock: () => NOW });
  assert.equal(model.observeFleet(config).ok, true);
  const receipt = fs.readFileSync(join(root, 'fleet-receipt.json'));
  for (let boot = 0; boot < 2; boot++) {
    if (boot) model = createReadModel({ dataDir: root, clock: () => NOW });
    assert.equal(model.observeFleet(starter).ok, false);
    assert.deepEqual(model.feeds()['fleet-config'].value, config);
    assert.equal(model.feeds()['fleet-config'].reason, 'refresh_failed');
    assert.deepEqual(fs.readFileSync(join(root, 'fleet-receipt.json')), receipt);
    assert.equal(model.observeFleet(config).ok, true);
    assert.equal(model.feeds()['fleet-config'].reason, null);
  }
});

for (const [name, keep, expected] of cases) test(`JOED-58 migration: ${name}; one revision and valid audit; restart retains policy`, t => {
  const config = fleet(keep), original = structuredClone(config);
  const paths = legacy(temporary(t), config);
  const before = [contents(paths.source), contents(paths.backup)];
  assert.equal(inspectFleetConfig(config).ok, true);
  assert.deepEqual(config, original, 'inspection must not mutate its caller');
  migrateToV2(paths);
  const migrated = JSON.parse(fs.readFileSync(join(paths.destination, 'fleet-config.json')));
  assert.deepEqual(migrated, { ...original, rev: 'fc-000020', updatedAt: NOW, desks: { ...original.desks, keep: expected } });
  assert.equal(validateContract('fleet-config', migrated).ok, true);
  const log = JSON.parse(fs.readFileSync(join(paths.destination, 'fleet-config-actions.json')));
  assert.deepEqual(log.entries.slice(0, -1), audit.entries);
  assert.equal(log.entries.length, audit.entries.length + 1);
  assert.deepEqual({ ...log.entries.at(-1), id: 'checked-separately' }, {
    id: 'checked-separately', at: NOW, actor: 'migration', revBefore: original.rev, revAfter: migrated.rev,
    changedKeys: ['desks.keep'], outcome: 'success', reason: 'propagated',
  });
  assertAudit(log);
  assert.equal(fs.statSync(join(paths.destination, 'fleet-config.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(join(paths.destination, 'fleet-config-actions.json')).mode & 0o777, 0o600);
  const model = createReadModel({ dataDir: paths.destination, clock: () => NOW });
  assert.deepEqual(model.feeds()['fleet-config'].value, migrated);
  assert.equal(model.feeds()['fleet-config'].reason, null);
  assert.equal(model.observeFleet(migrated).ok, true);
  assert.equal(model.accept({ ...ingress(), seq: sample.seq + 1 }).ok, true);
  const restarted = createReadModel({ dataDir: paths.destination, clock: () => NOW });
  assert.deepEqual(restarted.feeds()['fleet-config'].value, migrated);
  assert.equal(restarted.feeds().data.value.seq, sample.seq + 1);
  assert.deepEqual([contents(paths.source), contents(paths.backup)], before);
});

test('JOED-58 migration: compliant config and audit stay byte-identical; absent audit stays absent', t => {
  for (const log of [audit, null]) {
    const paths = legacy(temporary(t), fleet(['TSLA', 'EXAMPLE', 'SXR8']), log);
    migrateToV2(paths);
    assert.deepEqual(fs.readFileSync(join(paths.destination, 'fleet-config.json')), fs.readFileSync(join(paths.source, 'fleet-config.json')));
    if (log) assert.deepEqual(fs.readFileSync(join(paths.destination, 'fleet-config-actions.json')), fs.readFileSync(join(paths.source, 'fleet-config-actions.json')));
    else assert.equal(fs.existsSync(join(paths.destination, 'fleet-config-actions.json')), false);
  }
});

test('JOED-58 migration: normalization creates a missing audit', t => {
  const paths = legacy(temporary(t), fleet([]), null);
  migrateToV2(paths);
  const log = JSON.parse(fs.readFileSync(join(paths.destination, 'fleet-config-actions.json')));
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].actor, 'migration');
  assertAudit(log);
});

test('JOED-58 migration: other violations fail closed with value-free path/rule detail before any output', t => {
  const invalid = [
    [config => { config.mode = 'PRIVATE_FIELD_SENTINEL'; }, '$.mode', 'const'],
    [config => { config.rev = 'invalid'; }, '$.rev', 'pattern'],
    [config => { config.updatedAt = 'invalid'; }, '$.updatedAt', 'date-time'],
    [config => { config.desks.keep = ['EXAMPLE', 'EXAMPLE']; }, '$.desks.keep', 'uniqueItems'],
    [config => { config.desks.keep = ['invalid symbol']; }, '$.desks.keep[0]', 'pattern'],
    [config => { config.desks.keep = 'EXAMPLE'; }, '$.desks.keep', 'type'],
    [config => { config.desks.keep = Array.from({ length: 64 }, (_, i) => 'SYM' + i); }, '$.desks.keep', 'maxItems'],
    [config => { config.rev = 'fc-999999'; }, '$.rev', 'revisionExhausted'],
  ];
  for (const [change, path, rule] of invalid) {
    const config = fleet([]); change(config);
    const paths = legacy(temporary(t), config);
    const before = contents(paths.backup);
    assert.throws(() => migrateToV2(paths), error => {
      assert.equal(error.message, 'migration_fleet_invalid');
      assert.ok(error.detail.some(item => item.path === path && item.rule === rule));
      assert.ok(error.detail.every(item => Object.keys(item).sort().join(',') === 'path,rule'));
      assert.equal(JSON.stringify(error.detail).includes('PRIVATE_FIELD_SENTINEL'), false);
      return true;
    });
    assert.equal(fs.existsSync(paths.destination), false);
    assert.deepEqual(contents(paths.backup), before);
  }
  const paths = legacy(temporary(t), '{"invalid-json-sentinel":');
  assert.throws(() => migrateToV2(paths), error => error.message === 'migration_fleet_invalid' &&
    JSON.stringify(error.detail) === '[{"path":"$","rule":"json"}]');
  assert.equal(fs.existsSync(paths.destination), false);
});

test('JOED-58 migration: a full audit uses the 200-row ring; verified v1 backup bytes stay unchanged', t => {
  const prior = history(200), paths = legacy(temporary(t), fleet([]), prior);
  const before = [contents(paths.source), contents(paths.backup)];
  migrateToV2(paths);
  const log = JSON.parse(fs.readFileSync(join(paths.destination, 'fleet-config-actions.json')));
  assert.equal(log.entries.length, 200);
  assert.deepEqual(log.entries.slice(0, -1), prior.entries.slice(1));
  assert.deepEqual({ ...log.entries.at(-1), id: 'checked-separately' }, {
    id: 'checked-separately', at: NOW, actor: 'migration', revBefore: 'fc-000019', revAfter: 'fc-000020',
    changedKeys: ['desks.keep'], outcome: 'success', reason: 'propagated',
  });
  assertAudit(log);
  assert.deepEqual([contents(paths.source), contents(paths.backup)], before);
});

test('JOED-58 migration: invalid audits fail closed before ring truncation or output', t => {
  const invalidOldest = history(200); invalidOldest.entries[0] = {};
  for (const log of [history(201), invalidOldest, { ...audit, entries: [{}] },
    { ...audit, schema: 'invalid' }, '{"private-actions-sentinel":']) {
    const paths = legacy(temporary(t), fleet([]), log), before = contents(paths.backup);
    assert.throws(() => migrateToV2(paths), /migration_fleet_actions_invalid/);
    assert.equal(fs.existsSync(paths.destination), false);
    assert.deepEqual(contents(paths.backup), before);
  }
});

test('JOED-58 board load: stored v1 KEEP normalizes once, persists, audits and survives restart', async t => {
  const root = temporary(t), config = fleet(['EXAMPLE']);
  fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
  fs.writeFileSync(join(root, 'fleet-config-actions.json'), JSON.stringify(audit));
  const base = await listen(t, root);
  const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
  assert.equal(response.status, 200);
  const migrated = await response.json();
  assert.deepEqual(migrated, { ...config, rev: 'fc-000020', updatedAt: NOW, desks: { ...config.desks, keep: ['EXAMPLE', 'SXR8', 'TSLA'] } });
  const log = JSON.parse(fs.readFileSync(join(root, 'fleet-config-actions.json')));
  assert.equal(log.entries.length, audit.entries.length + 1);
  assert.deepEqual(log.entries.slice(0, -1), audit.entries);
  assertAudit(log);
  assert.equal(log.entries.at(-1).outcome, 'success');
  const before = contents(root);
  const restart = await listen(t, root);
  const again = await fetch(restart + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), migrated);
  assert.deepEqual(contents(root), before, 'restart and reads must not re-audit or freshen the config');
  const submitted = { ...migrated, desks: { ...migrated.desks, keep: [] } };
  const rejected = await fetch(restart + 'fleet-config/propagate', { method: 'POST', headers: {
    'x-auth-request-user': 'fixture', 'content-type': 'application/json', origin: new URL(restart).origin, 'sec-fetch-site': 'same-origin',
  }, body: JSON.stringify({ baseRev: migrated.rev, config: submitted }) });
  assert.equal(rejected.status, 422, 'submitted settings must still satisfy the unchanged contract');
  assert.deepEqual(JSON.parse(fs.readFileSync(join(root, 'fleet-config.json'))), migrated);
});

for (const count of [199, 200]) test(`JOED-58 board load: ${count} prior actions normalize with the 200-row ring, oldest dropped only as needed`, async t => {
  const root = temporary(t), config = fleet([]), prior = history(count);
  fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
  fs.writeFileSync(join(root, 'fleet-config-actions.json'), JSON.stringify(prior));
  const base = await listen(t, root);
  const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
  assert.equal(response.status, 200);
  const migrated = await response.json();
  assert.deepEqual(migrated.desks.keep, ['SXR8', 'TSLA']);
  assert.equal(migrated.rev, 'fc-000020');
  const log = JSON.parse(fs.readFileSync(join(root, 'fleet-config-actions.json')));
  assert.equal(log.entries.length, 200);
  assert.deepEqual(log.entries.slice(0, -1), prior.entries.slice(count - 199));
  assert.equal(log.entries.at(-1).actor, 'migration');
  assert.equal(log.entries.at(-1).outcome, 'success');
  assert.equal(log.entries.at(-1).reason, 'propagated');
  assert.equal(log.entries.at(-1).at, migrated.updatedAt);
  assertAudit(log);
});

test('JOED-58 board load: unrelated invalid config or invalid audit stays unavailable and unchanged', async t => {
  const invalidOldest = history(200); invalidOldest.entries[0] = {};
  for (const log of [null, history(201), invalidOldest, { ...audit, schema: 'invalid' }, '{"private-actions-sentinel":']) {
    const root = temporary(t), config = fleet([]);
    if (log === null) config.mode = 'invalid';
    fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
    if (log !== null) fs.writeFileSync(join(root, 'fleet-config-actions.json'), typeof log === 'string' ? log : JSON.stringify(log));
    const before = contents(root), base = await listen(t, root);
    const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assert.deepEqual(contents(root), before);
  }
});

for (const count of [0, 199, 200]) test(`JOED-58 board load: failed startup and two GETs reuse one row; recovery finalizes it (${count} prior actions)`, async t => {
  const root = temporary(t), config = fleet([]), prior = history(count);
  fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
  if (count) fs.writeFileSync(join(root, 'fleet-config-actions.json'), JSON.stringify(prior));
  const blocker = join(root, 'fleet-config.json.next');
  fs.mkdirSync(blocker);
  const configBefore = contents(root).find(entry => entry.name === 'fleet-config.json');
  let receivedAt = NOW;
  const base = await listen(t, root, () => receivedAt);
  const readLog = () => JSON.parse(fs.readFileSync(join(root, 'fleet-config-actions.json')));
  const id = readLog().entries.at(-1).id;
  function assertFailure() {
    assert.deepEqual(contents(root).find(entry => entry.name === 'fleet-config.json'), configBefore);
    const log = readLog();
    assert.equal(log.entries.length, Math.min(count + 1, 200));
    assert.deepEqual(log.entries.slice(0, -1), prior.entries.slice(Math.max(0, count - 199)));
    assert.deepEqual(log.entries.at(-1), {
      id, at: receivedAt, actor: 'migration', revBefore: config.rev, revAfter: config.rev,
      changedKeys: ['desks.keep'], outcome: 'failure', reason: 'store_failed',
    });
    assertAudit(log);
  }
  assertFailure();
  for (let i = 1; i <= 2; i++) {
    receivedAt = new Date(Date.parse(NOW) + i * 1000).toISOString();
    const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assertFailure();
  }
  // Move this test's own blocker aside; both scratch roots are trashed by teardown.
  fs.renameSync(blocker, join(temporary(t), 'config-write-blocker'));
  receivedAt = new Date(Date.parse(NOW) + 3000).toISOString();
  const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
  assert.equal(response.status, 200);
  const migrated = await response.json();
  assert.deepEqual(migrated, { ...config, rev: 'fc-000020', updatedAt: receivedAt,
    desks: { ...config.desks, keep: ['SXR8', 'TSLA'] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(join(root, 'fleet-config.json'))), migrated);
  const log = readLog();
  assert.equal(log.entries.length, Math.min(count + 1, 200));
  assert.deepEqual(log.entries.slice(0, -1), prior.entries.slice(Math.max(0, count - 199)));
  assert.deepEqual(log.entries.at(-1), {
    id, at: migrated.updatedAt, actor: 'migration', revBefore: config.rev, revAfter: migrated.rev,
    changedKeys: ['desks.keep'], outcome: 'success', reason: 'propagated',
  });
  assertAudit(log);
});

for (const outcome of ['pending', 'failure']) test(`JOED-58 board load: reuse the latest eligible ${outcome} migration row for the stored revision`, async t => {
  const root = temporary(t), config = fleet([]), prior = history(6);
  for (const entry of prior.entries) entry.actor = 'migration';
  prior.entries[0].revBefore = config.rev;
  prior.entries[1].revBefore = config.rev;
  prior.entries[2] = { ...prior.entries[2], revBefore: config.rev, outcome,
    reason: outcome === 'pending' ? 'write_started' : 'store_failed' };
  prior.entries[3] = { ...prior.entries[3], revBefore: config.rev, outcome: 'success', reason: 'propagated' };
  prior.entries[5].actor = 'fixture'; prior.entries[5].revBefore = config.rev;
  fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
  fs.writeFileSync(join(root, 'fleet-config-actions.json'), JSON.stringify(prior));
  const base = await listen(t, root);
  const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
  assert.equal(response.status, 200);
  const migrated = await response.json();
  const log = JSON.parse(fs.readFileSync(join(root, 'fleet-config-actions.json')));
  const expected = structuredClone(prior);
  expected.entries[2] = { ...prior.entries[2], at: migrated.updatedAt, revAfter: migrated.rev,
    changedKeys: ['desks.keep'], outcome: 'success', reason: 'propagated' };
  assert.deepEqual(log, expected);
  assertAudit(log);
});

test('JOED-58 check-fleet: config outcomes and actions ok for store and backup; no files, bytes or timestamps written', t => {
  for (const [config, output, status] of [
    [fleet(), 'fleet ok', 0],
    [fleet([]), 'fleet normalizable (keep: +SXR8 +TSLA)', 0],
    [fleet(['SXR8']), 'fleet normalizable (keep: +TSLA)', 0],
    [fleet(['TSLA']), 'fleet normalizable (keep: +SXR8)', 0],
    [{ ...fleet([]), mode: 'PRIVATE_FIELD_SENTINEL' }, 'fleet invalid: $.mode/const', 1],
    ['{"private-json-sentinel":', 'fleet invalid: $/json', 1],
  ]) {
    const paths = legacy(temporary(t), config);
    for (const source of [paths.source, paths.backup]) {
      const before = contents(source), result = cli(['check-fleet', source]);
      assert.equal(result.status, status, result.stderr);
      assert.equal(result.stdout.trim(), output + '\nactions ok');
      assert.equal(result.stderr, '');
      assert.deepEqual(contents(source), before);
    }
  }
  const paths = legacy(temporary(t), fleet([]));
  fs.appendFileSync(join(paths.backup, 'fleet-config.json'), ' ');
  const before = contents(paths.backup), result = cli(['check-fleet', paths.backup]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /backup_digest_mismatch/);
  assert.deepEqual(contents(paths.backup), before);
  const root = temporary(t);
  fs.symlinkSync(join(paths.source, 'fleet-config.json'), join(root, 'fleet-config.json'));
  assert.equal(cli(['check-fleet', root]).status, 1);
});

test('JOED-58 check-fleet: actions ok for absent/full logs; actions invalid for bad JSON, schema or entries; read-only', t => {
  const invalidOldest = history(200); invalidOldest.entries[0] = {};
  for (const config of [fleet(), fleet([])]) for (const [log, actionsOk] of [
    [null, true], [history(199), true], [history(200), true], [history(201), false],
    [invalidOldest, false], [{ ...audit, schema: 'PRIVATE_ACTIONS_SENTINEL' }, false],
    ['{"private-actions-sentinel":', false],
  ]) {
    const paths = legacy(temporary(t), config, log);
    for (const source of [paths.source, paths.backup]) {
      const before = contents(source), result = cli(['check-fleet', source]);
      assert.equal(result.status, actionsOk ? 0 : 1, result.stderr);
      const fleetLine = config.desks.keep.length ? 'fleet ok' : 'fleet normalizable (keep: +SXR8 +TSLA)';
      assert.equal(result.stdout.trim(), fleetLine + '\nactions ' + (actionsOk ? 'ok' : 'invalid'));
      assert.equal(result.stderr, '');
      assert.equal(checkFleet(source).ok, actionsOk);
      assert.equal(checkFleet(source).actionsOk, actionsOk);
      assert.deepEqual(contents(source), before);
    }
  }
  const paths = legacy(temporary(t), { ...fleet([]), mode: 'PRIVATE_FIELD_SENTINEL' }, { ...audit, entries: [{}] });
  const before = contents(paths.source), result = cli(['check-fleet', paths.source]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), 'fleet invalid: $.mode/const\nactions invalid');
  assert.equal(result.stderr, '');
  assert.deepEqual(contents(paths.source), before);
});

test('JOED-58 prepare-data: specific codes and value-free validator details replace generic usage', t => {
  const paths = legacy(temporary(t), { ...fleet([]), mode: 'PRIVATE_FIELD_SENTINEL' });
  const snapshot = join(temporary(t), 'snapshot.json'); fs.writeFileSync(snapshot, JSON.stringify(ingress()));
  const args = ['migrate-v2', '--offline', paths.backup, paths.destination, snapshot, NOW];
  const invalid = cli(args);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.trim(), 'Data preparation failed: migration_fleet_invalid: $.mode/const');
  for (const forbidden of ['PRIVATE_FIELD_SENTINEL', paths.backup, 'Use backup', 'usage']) assert.equal(invalid.stderr.includes(forbidden), false);
  const receipt = cli([...args.slice(0, -1), 'invalid']);
  assert.equal(receipt.status, 1);
  assert.match(receipt.stderr, /migration_receipt_required/);
  const offline = cli(['verify', paths.backup]);
  assert.equal(offline.status, 1);
  assert.match(offline.stderr, /offline_writers_must_be_stopped/);
  fs.writeFileSync(snapshot, '{"private-json-sentinel":');
  const malformed = cli(args);
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stderr.trim(), 'Data preparation failed: input_json_invalid');
  assert.equal(fs.existsSync(paths.destination), false);
  const valid = legacy(temporary(t), fleet([]));
  fs.writeFileSync(snapshot, JSON.stringify(ingress()));
  const migrated = cli(['migrate-v2', '--offline', valid.backup, valid.destination, snapshot, NOW]);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal(JSON.parse(migrated.stdout).schema, 'inspr.joe.household.v2');
  assert.deepEqual(checkFleet(valid.destination), { ok: true, added: [], errors: [], actionsOk: true });
});
