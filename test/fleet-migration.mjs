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
function legacy(root, config, log = audit) {
  const source = join(root, 'source'), backup = join(root, 'backup'), destination = join(root, 'v2');
  fs.mkdirSync(source);
  fs.writeFileSync(join(source, 'data.json'), '{"schema":"inspr.joe.household.v1"}\n');
  fs.writeFileSync(join(source, 'fleet-config.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 4) + '\n\n');
  if (log !== null) fs.writeFileSync(join(source, 'fleet-config-actions.json'), JSON.stringify(log, null, 4) + '\n\n');
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
async function listen(t, dataDir) {
  const server = createJoeServer({ dataDir, clock: () => NOW, inboxToken: 'joed-58-fixture' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/joe/`;
}

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

test('JOED-58 migration: a full or invalid audit fails closed without truncation', t => {
  for (const log of [{ ...audit, entries: Array.from({ length: 200 }, () => audit.entries[0]) }, { ...audit, entries: [{}] }]) {
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

test('JOED-58 board load: unrelated invalid config or full audit stays unavailable and unchanged', async t => {
  for (const fullAudit of [false, true]) {
    const root = temporary(t), config = fleet([]);
    if (!fullAudit) config.mode = 'invalid';
    fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
    if (fullAudit) fs.writeFileSync(join(root, 'fleet-config-actions.json'), JSON.stringify({ ...audit, entries: Array.from({ length: 200 }, () => audit.entries[0]) }));
    const before = contents(root), base = await listen(t, root);
    const response = await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } });
    assert.equal(response.status, 503);
    await response.body?.cancel();
    assert.deepEqual(contents(root), before);
  }
});

test('JOED-58 board load: config write failure retains pending audit instead of false success', async t => {
  const root = temporary(t), config = fleet([]);
  fs.writeFileSync(join(root, 'fleet-config.json'), JSON.stringify(config));
  fs.mkdirSync(join(root, 'fleet-config.json.next'));
  await listen(t, root);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(root, 'fleet-config.json'))), config);
  const log = JSON.parse(fs.readFileSync(join(root, 'fleet-config-actions.json')));
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].outcome, 'pending');
  assert.equal(log.entries[0].reason, 'write_started');
  assertAudit(log);
});

test('JOED-58 check-fleet: three outcomes for store and backup; no files, bytes or timestamps written', t => {
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
      assert.equal(result.stdout.trim(), output);
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
  assert.deepEqual(checkFleet(valid.destination), { ok: true, added: [], errors: [] });
});
