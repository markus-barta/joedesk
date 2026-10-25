import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { closeBrowserProcess } from '../scripts/browser/cdp.mjs';
import { parseVersion, reserveVersion, compareReleases } from '../release/versioning.mjs';
import { backupStore, restoreStore, migrateToV2, verifyBackup } from '../release/data-migration.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { healthProjection } from '../server/health.mjs';
import { atomicWrite } from '../server/storage.mjs';
import { createJoeServer } from '../server.mjs';
import { smokeRelease, PROTECTED_READS, APP_ORIGIN_HEADER } from '../scripts/smoke-release.mjs';
import { validateContract } from '../contracts/index.mjs';
// Private capture tooling stays outside the runtime/package closure while its
// Node-only tests run in the existing npm test / CI release suite.
import './preview-capture.mjs';
import './adoption.mjs';
import './fleet-migration.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
const samples = read('fixtures/valid.json'), active = read('release.json'), prep = read('release/preparation.json');
const NOW = samples.data.receivedAt;
const ingress = () => { const v = structuredClone(samples.data); delete v.receivedAt; return v; };
const oldRelease = prep.previous_release, next = prep.reservation;
const lastDeployed = prep.last_deployed_release;
const legacyDeployed = { product: active.product, version_scheme: prep.anchor.legacy_scheme,
  version: prep.anchor.last_legacy_version, release_channel: active.release_channel, release_sequence: prep.anchor.last_legacy_sequence };
const audit = { schema: 'inspr.joe.fleet-config.actions.v1', entries: [
  { id: 'fa-123456-1234abcd', at: NOW, actor: 'fixture', revBefore: 'fc-000001', revAfter: 'fc-000002', changedKeys: ['desks.maxBusyDesks'], outcome: 'success', reason: 'propagated' },
  { id: 'fa-123457-1234abce', at: NOW, actor: 'fixture', revBefore: 'fc-000002', revAfter: null, changedKeys: [], outcome: 'failure', reason: 'revision_conflict' },
  { id: 'fa-123458-1234abcf', at: NOW, actor: 'fixture', revBefore: null, revAfter: null, changedKeys: [], outcome: 'pending', reason: 'write_started' },
] };
function temporary(t) { const dir = scratch('joed-p6-test-'); t.after(() => discard(dir, 'release test')); return dir; }
async function listen(t, server) {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}/joe/`;
}

function browserProcess() {
  return Object.assign(new EventEmitter(), {
    exitCode: null, signalCode: null, signals: [],
    kill(signal) { this.signals.push(signal); return true; },
    exit(code = 0, signal = null) { this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal); },
  });
}
test('browser teardown: close acknowledgement does not permit profile cleanup before exit', async () => {
  const proc = browserProcess();
  let requested = false, cleaned = false;
  const closing = closeBrowserProcess(proc, async () => { requested = true; }).then(() => { cleaned = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, true);
    assert.equal(cleaned, false, 'Chrome can still be writing after acknowledging Browser.close');
  } finally { proc.exit(); }
  await closing;
  assert.equal(cleaned, true);
  assert.deepEqual(proc.signals, [], 'graceful exit needs no signal');
  assert.equal(proc.listenerCount('exit'), 0);
});
test('browser teardown: exit succeeds even if the CDP close reply never arrives', async () => {
  const proc = browserProcess();
  await closeBrowserProcess(proc, () => { queueMicrotask(() => proc.exit()); return new Promise(() => {}); });
  assert.deepEqual(proc.signals, []);
  for (const [code, signal] of [[0, null], [null, 'SIGTERM']]) {
    const gone = browserProcess(); gone.exit(code, signal);
    await closeBrowserProcess(gone, () => assert.fail('already exited'));
    assert.deepEqual(gone.signals, []);
  }
});
test('browser teardown: signal fallbacks still wait for exit; a stuck process retains its profile', async () => {
  for (const exitOn of ['SIGTERM', 'SIGKILL', null]) {
    const proc = browserProcess();
    proc.kill = signal => {
      proc.signals.push(signal);
      if (signal === exitOn) setImmediate(() => proc.exit(null, signal));
      return true;
    };
    let cleaned = false;
    const closing = closeBrowserProcess(proc, () => Promise.reject(new Error('CDP disconnected')), 10)
      .then(() => { assert.notEqual(proc.signalCode, null); cleaned = true; });
    if (exitOn) {
      await closing;
      assert.equal(cleaned, true);
    } else {
      await assert.rejects(closing, /Browser did not exit; profile retained/);
      assert.equal(cleaned, false);
    }
    assert.deepEqual(proc.signals, exitOn === 'SIGTERM' ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
    assert.equal(proc.listenerCount('exit'), 0);
  }
});

test('P6 version: explicit schemes, real UTC dates, no suffixes or 32-bit assumptions', () => {
  for (const version of ['280229120000.0.0', '991231235959.0.0', next.version]) {
    for (const version_scheme of ['inspr-calver-3', 'inspr-calendar-v2']) assert.equal(parseVersion({ version_scheme, version }).version, version);
    assert.ok(BigInt(version.split('.')[0]) > 2147483647n);
  }
  for (const version of ['260229120000.0.0', '260431120000.0.0', '260909240000.0.0', '260909116000.0.0', '090909113550.0.0', '20261016120000.0.0', '2610161200.0.0', '261016120000', '261016120000.1.0', '261016120000.0.1', '261016120000.0.0-rc1', '261016120000.0.0+abc', '26.10.16', '5.21.0']) {
    assert.throws(() => parseVersion({ version_scheme: 'inspr-calver-3', version }), undefined, version);
  }
  for (const version_scheme of [undefined, '', 'semver?', 'INSPR-CalVer3']) assert.throws(() => parseVersion({ version_scheme, version: next.version }));
  assert.equal(parseVersion(active).version, active.version);
  assert.equal(parseVersion({ version_scheme: 'legacy', version: '0.8.0' }).utc, null);
  assert.equal(parseVersion({ version_scheme: 'inspr-calendar-v1', version: '26.09.09.11.35.50' }).utc, '2026-09-09T11:35:50.000Z');
});
test('P6 reservation: one UTC second, no collisions, continued sequence, mixed-era anchor', () => {
  const reserved = reserveVersion(oldRelease, next.reserved_at);
  for (const key of Object.keys(reserved)) assert.equal(reserved[key], next[key]);
  assert.equal(compareReleases(oldRelease, next, prep.anchor), -1);
  assert.equal(compareReleases(next, oldRelease, prep.anchor), 1);
  assert.equal(compareReleases(oldRelease, next), -1, 'calendar successors share a coordinate space');
  assert.equal(compareReleases(lastDeployed, next, prep.anchor), -1);
  assert.throws(() => compareReleases(legacyDeployed, next), /anchor/);
  assert.throws(() => compareReleases(legacyDeployed, next, { ...prep.anchor, first_calendar_version: '260229120000.0.0' }), /calendar_date/);
  assert.throws(() => compareReleases({ ...oldRelease, version: '0.9.0', version_scheme: 'legacy' }, next, prep.anchor));
  assert.throws(() => compareReleases(legacyDeployed, { ...next, release_sequence: 23 }, prep.anchor));
  assert.throws(() => compareReleases(oldRelease, { ...next, release_channel: 'other' }, prep.anchor));
  for (const previous of [next, { ...next, version_scheme: 'inspr-calendar-v2' }]) assert.throws(() => reserveVersion(previous, next.reserved_at), /not_later/);
  assert.throws(() => reserveVersion(oldRelease, '2026-10-16T15:12:18+00:00'));
  assert.throws(() => reserveVersion(oldRelease, '2026-02-30T00:00:00Z'));
  const laterUTC = new Date(Date.parse(next.reserved_at) + 1000).toISOString().replace('.000Z', 'Z');
  const later = reserveVersion({ ...next, version_scheme: 'inspr-calendar-v2' }, laterUTC);
  assert.equal(later.version_scheme, 'inspr-calver-3'); assert.equal(later.release_sequence, next.release_sequence + 1);
});
test('JOED-81: outage candidate follows the deployed sequence 30; About preserves deployed history and excludes aborted candidates', () => {
  assert.equal(prep.ticket, 'JOED-81');
  assert.equal(next.release_sequence, 31);
  assert.equal(active.status, 'candidate');
  assert.equal(active.note, 'Round 2: calmer outage view (JOED-81)');
  assert.equal(oldRelease.version, '261023155418.0.0');
  assert.equal(oldRelease.release_sequence, 30);
  assert.equal(oldRelease.status, 'published-candidate');
  assert.equal(oldRelease.source_branch, 'main');
  assert.equal(oldRelease.source_commit, 'd4eb662795ff6d0e910aa20797995070b26e5554');
  assert.equal(oldRelease.release_set_ticket, 'JOED-78');
  assert.equal(oldRelease.disposition, 'deployed');
  assert.equal(oldRelease.deployed, true);
  assert.equal(oldRelease.note, 'live on csb0 since 2026-10-24T03:46:42Z (JOED-78)');
  assert.deepEqual(prep.anchor, { legacy_scheme: 'calendar', last_legacy_version: '26.09.21.12.00',
    last_legacy_sequence: 23, first_calendar_version: '261016151218.0.0', first_calendar_sequence: 24 });
  assert.equal(lastDeployed.version, oldRelease.version);
  assert.equal(lastDeployed.release_sequence, oldRelease.release_sequence);
  const versionSource = fs.readFileSync(new URL('../public/joe/joe-version.js', import.meta.url), 'utf8');
  const ui = new Function('window', `${versionSource}; return window.JoeVersion;`)({});
  assert.equal(ui.APP_VERSION, active.version);
  assert.equal(ui.RELEASE_SEQUENCE, next.release_sequence);
  assert.equal(ui.VERSION_HISTORY[0].version, active.version);
  assert.equal(ui.VERSION_HISTORY[0].date, next.reserved_at.slice(0, 10));
  assert.equal(ui.VERSION_HISTORY[1].version, lastDeployed.version);
  assert.equal(ui.VERSION_HISTORY[2].version, '261023100632.0.0');
  assert.equal(ui.VERSION_HISTORY[3].version, '261021113113.0.0');
  assert.equal(ui.VERSION_HISTORY[4].version, '261021083537.0.0');
  assert.equal(ui.VERSION_HISTORY[5].version, '261021015923.0.0');
  assert.equal(ui.VERSION_HISTORY[6].version, prep.anchor.last_legacy_version);
  for (const version of ['261019102825.0.0', prep.anchor.first_calendar_version]) {
    assert.equal(ui.VERSION_HISTORY.some(r => r.version === version), false,
      'About must not imply either superseded candidate was deployed');
  }
});
test('JOED-81 check-release: accepts the outage reservation and rejects equal or earlier reservations after integrity verification', t => {
  const root = temporary(t), closure = read('release/closure.json');
  for (const name of [...closure.files.map(f => f.path), 'release/closure.json', 'scripts/check-release.mjs']) {
    const target = join(root, name); fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.copyFileSync(new URL('../' + name, import.meta.url), target);
  }
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-release.mjs')], { encoding: 'utf8' });
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).candidate, next.version);
  for (const [version, reserved_at] of [['261023155418.0.0', '2026-10-23T15:54:18Z'], ['261023155417.0.0', '2026-10-23T15:54:17Z']]) {
    const invalid = structuredClone(prep);
    Object.assign(invalid.reservation, { version, reserved_at });
    fs.writeFileSync(join(root, 'release/preparation.json'), JSON.stringify(invalid, null, 2) + '\n');
    // Reseal only this isolated fixture so the CLI reaches reservation validation.
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    const sealed = { ...closure, files: closure.files.map(f => {
      const bytes = fs.readFileSync(join(root, f.path));
      return { path: f.path, size: bytes.length, sha256: sha(bytes) };
    }) };
    const bytes = JSON.stringify(sealed, null, 2) + '\n';
    fs.writeFileSync(join(root, 'release/closure.json'), bytes);
    const checker = fs.readFileSync(new URL('../scripts/check-release.mjs', import.meta.url), 'utf8');
    fs.writeFileSync(join(root, 'scripts/check-release.mjs'), checker.replace(/export const CLOSURE_SHA256 = '[a-f0-9]{64}';/, `export const CLOSURE_SHA256 = '${sha(bytes)}';`));
    const rejected = run();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /release-check: reservation_not_later/);
  }
});
test('P6 backup and v2 staging: exact legacy bytes restored; new producer receipt, no fabricated legacy history', t => {
  const root = temporary(t), source = join(root, 'legacy'), backup = join(root, 'backup'), restored = join(root, 'restore'), stage = join(root, 'v2');
  fs.mkdirSync(source);
  const bytes = Buffer.from('{"schema":"inspr.joe.household.v1", "sentinel":"legacy bytes"}\n');
  fs.writeFileSync(join(source, 'data.json'), bytes);
  fs.writeFileSync(join(source, 'history.json'), '{"schema":"inspr.joe.household.history.v1","points":[{"old":true}]}\n');
  fs.writeFileSync(join(source, 'fleet-config.json'), JSON.stringify(samples['fleet-config']));
  const auditBytes = Buffer.from(JSON.stringify(audit, null, 2) + '\n\n');
  fs.writeFileSync(join(source, 'fleet-config-actions.json'), auditBytes);
  const before = fs.readdirSync(source).map(name => [name, fs.readFileSync(join(source, name)).toString('hex')]);
  const manifest = backupStore({ source, destination: backup, boardSchema: 'v1' });
  assert.throws(() => backupStore({ source, destination: join(source, 'nested'), boardSchema: 'v1' }), /overlaps/);
  assert.throws(() => restoreStore({ backup, destination: join(backup, 'nested'), boardSchema: 'v1' }), /overlaps/);
  assert.throws(() => migrateToV2({ backup, destination: join(backup, 'nested'), snapshot: ingress(), receivedAt: NOW }), /overlaps/);
  assert.equal(manifest.files.length, 4); assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  for (const f of manifest.files) assert.equal(fs.statSync(join(backup, f.name)).mode & 0o777, 0o600);
  assert.equal(verifyBackup(backup).boardSchema, 'v1');
  restoreStore({ backup, destination: restored, boardSchema: 'v1' });
  for (const [name, hex] of before) assert.equal(fs.readFileSync(join(restored, name)).toString('hex'), hex);
  assert.throws(() => restoreStore({ backup, destination: restored, boardSchema: 'v1' }), /EEXIST/);
  assert.throws(() => restoreStore({ backup, destination: join(root, 'wrong'), boardSchema: 'v2' }), /incompatible/);
  assert.throws(() => createReadModel({ dataDir: source }), /data_migration_required/);
  assert.throws(() => migrateToV2({ backup, destination: stage, snapshot: { schema: 'inspr.joe.household.v1' }, receivedAt: NOW }), /valid_v2/);
  const result = migrateToV2({ backup, destination: stage, snapshot: ingress(), receivedAt: NOW });
  assert.deepEqual(fs.readFileSync(join(stage, 'fleet-config-actions.json')), auditBytes);
  assert.equal(fs.statSync(join(stage, 'fleet-config-actions.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(restored).sort(), before.map(([name]) => name).sort());
  assert.equal(result.legacyHistory, 'preserved-in-v1-backup-only');
  const model = createReadModel({ dataDir: stage, clock: () => NOW });
  assert.equal(model.feeds().data.value.receivedAt, NOW); assert.equal(model.feeds().history.value.points.length, 1);
  assert.equal(model.accept(ingress()).reason, 'sequence_replayed');
  assert.equal(fs.existsSync(join(stage, 'data.json')), false);
  assert.deepEqual(before, fs.readdirSync(source).map(name => [name, fs.readFileSync(join(source, name)).toString('hex')]));
  const v2Backup = join(root, 'backup-v2');
  const results = structuredClone(samples.results); delete results.receivedAt;
  assert.equal(model.acceptResults(results).ok, true);
  const resultsBytes = fs.readFileSync(join(stage, 'results-state.json'));
  backupStore({ source: stage, destination: v2Backup, boardSchema: 'v2' });
  assert.throws(() => restoreStore({ backup: v2Backup, destination: join(root, 'never-v1'), boardSchema: 'v1' }), /incompatible/);
  restoreStore({ backup: v2Backup, destination: join(root, 'v2-restore'), boardSchema: 'v2' });
  assert.deepEqual(fs.readFileSync(join(root, 'v2-restore', 'fleet-config-actions.json')), auditBytes);
  assert.deepEqual(fs.readFileSync(join(root, 'v2-restore', 'results-state.json')), resultsBytes);
  assert.equal(createReadModel({ dataDir: join(root, 'v2-restore'), clock: () => NOW }).feeds().results.value.seq, results.seq);
  assert.equal(createReadModel({ dataDir: join(root, 'v2-restore'), clock: () => NOW }).feeds().data.value.seq, samples.data.seq);
});
test('P6 migration refuses malformed audit history before creating a destination; absent log stays absent', t => {
  const root = temporary(t), source = join(root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(join(source, 'data.json'), '{"schema":"inspr.joe.household.v1"}');
  const invalid = [
    '{', { ...audit, schema: 'unknown' }, { ...audit, entries: {} },
    { ...audit, entries: [{ ...audit.entries[0], actor: 'invalid actor!' }] },
    { ...audit, entries: [{ ...audit.entries[0], revAfter: 'not-a-revision' }] },
    { ...audit, entries: [{ ...audit.entries[0], changedKeys: ['unknown'] }] },
    { ...audit, entries: [{ ...audit.entries[0], at: '2026-02-30T00:00:00.000Z' }] },
    { ...audit, entries: Array.from({ length: 201 }, () => audit.entries[0]) },
  ];
  for (const [i, value] of invalid.entries()) {
    fs.writeFileSync(join(source, 'fleet-config-actions.json'), typeof value === 'string' ? value : JSON.stringify(value));
    const backup = join(root, `backup-${i}`), destination = join(root, `v2-${i}`);
    backupStore({ source, destination: backup, boardSchema: 'v1' });
    assert.throws(() => migrateToV2({ backup, destination, snapshot: ingress(), receivedAt: NOW }));
    assert.equal(fs.existsSync(destination), false);
  }
  const emptySource = join(root, 'no-audit'); fs.mkdirSync(emptySource);
  fs.copyFileSync(join(source, 'data.json'), join(emptySource, 'data.json'));
  const backup = join(root, 'no-audit-backup'), destination = join(root, 'no-audit-v2');
  backupStore({ source: emptySource, destination: backup, boardSchema: 'v1' });
  migrateToV2({ backup, destination, snapshot: ingress(), receivedAt: NOW });
  assert.equal(fs.existsSync(join(destination, 'fleet-config-actions.json')), false);
});
test('P6 backup refuses tampering, extra files, symlinks, oversized input and false schema', t => {
  const root = temporary(t), source = join(root, 'source'); fs.mkdirSync(source);
  const file = join(source, 'data.json'); fs.writeFileSync(file, '{"schema":"inspr.joe.household.v1"}');
  for (const name of ['damaged', 'extra', 'missing']) {
    const backup = join(root, name); backupStore({ source, destination: backup, boardSchema: 'v1' });
    if (name === 'damaged') fs.appendFileSync(join(backup, 'data.json'), ' ');
    if (name === 'extra') fs.writeFileSync(join(backup, 'extra.json'), '{}');
    if (name === 'missing') fs.renameSync(join(backup, 'data.json'), join(backup, 'missing.json'));
    assert.throws(() => verifyBackup(backup));
  }
  assert.throws(() => backupStore({ source, destination: join(root, 'false-schema'), boardSchema: 'v2' }));
  fs.writeFileSync(join(source, 'history.json'), '{"schema":"inspr.joe.household.history.v2"}');
  assert.throws(() => backupStore({ source, destination: join(root, 'no-mixed-history'), boardSchema: 'v1' }), /schema_mismatch/);
  fs.renameSync(join(source, 'history.json'), join(root, 'history.json'));
  fs.writeFileSync(join(source, 'unexpected.json'), '{}');
  assert.throws(() => backupStore({ source, destination: join(root, 'no-extra'), boardSchema: 'v1' }), /unexpected/);
  fs.renameSync(join(source, 'unexpected.json'), join(root, 'unexpected.json'));
  fs.renameSync(file, join(root, 'original.json')); fs.symlinkSync(join(root, 'original.json'), file);
  assert.throws(() => backupStore({ source, destination: join(root, 'no-link'), boardSchema: 'v1' }));
  fs.renameSync(file, join(root, 'link')); fs.writeFileSync(file, ' '.repeat(16 * 1024 * 1024 + 1));
  assert.throws(() => backupStore({ source, destination: join(root, 'no-oversize'), boardSchema: 'v1' }));
});
test('P6 app stamps health, UI, assets, redirects and errors for every response method', async t => {
  let failClock = false;
  const server = createJoeServer({ dataDir: temporary(t), clock: () => { if (failClock) throw new Error('synthetic clock failure'); return NOW; }, inboxToken: 'p6-synthetic-fixture' });
  const base = await listen(t, server);
  for (const [route, method, status, headers = {}, body] of [
    ['healthz', 'GET', 200], ['healthz', 'HEAD', 200], ['healthz', 'POST', 405],
    ['', 'GET', 200], ['', 'HEAD', 200], [`app.js?v=${active.version}`, 'GET', 200],
    ['app.js?v=wrong', 'GET', 404], ['healthz/', 'GET', 404], ['healthz-extra', 'GET', 404],
    ['../joe', 'GET', 308], ['../healthz', 'GET', 200], ['../readyz', 'GET', 200],
    ['inbox', 'POST', 401], ['inbox', 'POST', 422, { authorization: 'Bearer p6-synthetic-fixture' }, '{}'],
    ...PROTECTED_READS.flatMap(route => [[route, 'GET', 401], [route, 'HEAD', 401], [route, 'GET', ['data.json', 'history.json', 'results.json'].includes(route) ? 503 : 200, { 'x-auth-request-user': 'fixture' }]]),
  ]) {
    const response = await fetch(new URL(route, base), { method, redirect: 'manual', headers: { [APP_ORIGIN_HEADER]: 'client-spoof', ...headers }, body });
    assert.equal(response.status, status, `${method} ${route}`);
    assert.equal(response.headers.get(APP_ORIGIN_HEADER), 'app', `${method} ${route}`);
    await response.body?.cancel();
  }
  failClock = true;
  const failed = await fetch(base + 'healthz');
  assert.equal(failed.status, 500); assert.equal(failed.headers.get(APP_ORIGIN_HEADER), 'app');
  await failed.body?.cancel();
});
test('P6 staged ingress: v1 and incompatible producer IDs rejected; v2 restart continuity and anonymous smoke', async t => {
  const root = temporary(t);
  const server = createJoeServer({ dataDir: root, clock: () => NOW, inboxToken: 'p6-synthetic-fixture' });
  const base = await listen(t, server);
  const push = payload => fetch(base + 'inbox', { method: 'POST', headers: { authorization: 'Bearer p6-synthetic-fixture' }, body: JSON.stringify(payload) });
  for (const schema of ['inspr.joe.household.v1', 'inspr.joe.household.v3', 'unknown']) assert.equal((await push({ ...ingress(), schema })).status, 422);
  assert.equal((await push(ingress())).status, 200);
  assert.equal((await push(ingress())).status, 422);
  assert.equal(createReadModel({ dataDir: root, clock: () => NOW }).feeds().data.value.seq, samples.data.seq);
  for (const route of PROTECTED_READS) for (const headers of [{}, { 'x-auth-request-user': 'malformed actor!' }]) assert.equal((await fetch(base + route, { headers })).status, 401, route);
  // The trusted proxy identity is exercised only in this isolated test; OPS
  // must strip any client-supplied identity headers at the real edge.
  assert.equal((await fetch(base + 'fleet-config.json', { headers: { 'x-auth-request-user': 'fixture' } })).status, 200);
  await assert.rejects(smokeRelease(base, active), /sso_not_proven/, 'a bare app must fail even though it returns anonymous 401');
  const forwarded = [], denied = [];
  const proxy = createServer(async (req, res) => {
    // Isolated contract fixture, not production SSO: only exact health GET/HEAD
    // is public, and no client identity is ever forwarded to the app.
    if (req.url === '/joe/healthz' && ['GET', 'HEAD'].includes(req.method)) {
      const headers = { accept: 'application/json' };
      forwarded.push({ path: req.url, headers });
      const upstream = await fetch(new URL('healthz', base), { method: req.method, headers });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } else {
      // oauth2-proxy returns a bare 401 {} for JSON requests and redirects
      // browser navigation. Neither rejection originates from the app.
      const json = req.headers.accept?.includes('application/json');
      denied.push({ path: req.url, spoof: req.headers['x-auth-request-user'], status: json ? 401 : 302 });
      res.writeHead(json ? 401 : 302, json ? { 'content-type': 'application/json' } : { location: '/oauth2/start' });
      res.end(json ? '{}' : '');
    }
  });
  const publicBase = await listen(t, proxy);
  const result = await smokeRelease(publicBase, active);
  assert.equal(result.protectedReads, 'sso-rejected');
  assert.equal(result.protectedUI, 'sso-rejected');
  assert.equal(result.spoofedIdentity, 'sso-rejected');
  assert.equal(result.results, 'not reported');
  for (const method of ['GET', 'HEAD']) {
    const health = await fetch(publicBase + 'healthz', { method });
    assert.equal(health.status, 200); assert.equal(health.headers.get(APP_ORIGIN_HEADER), 'app');
    await health.body?.cancel();
  }
  const jsonDenied = await fetch(publicBase + 'data.json', { headers: { accept: 'application/json' } });
  assert.equal(jsonDenied.status, 401); assert.equal(await jsonDenied.text(), '{}');
  assert.equal(jsonDenied.headers.has(APP_ORIGIN_HEADER), false);
  const redirected = await smokeRelease(publicBase, active, { fetcher: (url, init) => fetch(url, { ...init, headers: { ...init.headers, accept: 'text/html' } }) });
  assert.equal(redirected.ok, true, 'the redirect path also passes without an SSO marker');
  const cli = await promisify(execFile)(process.execPath, ['scripts/smoke-release.mjs', publicBase, active.version_scheme, active.version], { timeout: 30000 });
  assert.equal(JSON.parse(cli.stdout).ok, true, 'the deploy CLI passes only through the proxy');
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/smoke-release.mjs', base, active.version_scheme, active.version], { timeout: 30000 }), e => e.code === 1 && e.stderr.trim() === 'sso_not_proven');
  assert.ok(forwarded.every(r => r.path === '/joe/healthz' && !r.headers['x-auth-request-user'] && !r.headers['x-forwarded-user']));
  for (const route of [...PROTECTED_READS, '', `app.js?v=${active.version}`, 'healthz/', 'healthz-extra']) {
    for (const status of [401, 302]) {
      assert.ok(denied.some(r => r.path === '/joe/' + route && !r.spoof && r.status === status), `anonymous ${route} denied by proxy (${status})`);
      assert.ok(denied.some(r => r.path === '/joe/' + route && r.spoof === 'joedesk-smoke-spoof' && r.status === status), `spoofed ${route} denied before app (${status})`);
    }
  }
  for (const scheme of ['inspr-calendar-v2', 'inspr-calver-3']) {
    const h = await (await fetch(base + 'healthz')).json();
    assert.equal(validateContract('healthz', { ...h, versionScheme: scheme, version: next.version }).ok, true);
  }
  assert.equal((await fetch(base + 'app.js?v=wrong')).status, 404);
  assert.equal((await fetch(base + `app.js?v=${active.version}&v=${active.version}`)).status, 404);
  assert.equal((await fetch(base + `app.js?v=${active.version}`)).status, 200);
});
test('P6 SSO smoke rejects missing edge proof, leaked UI/assets, broad health exemption and spoofed identity bypass', async () => {
  const health = { ...samples.healthz, version: active.version, versionScheme: active.version_scheme };
  const base = 'https://board.example.invalid/joe/';
  const app = value => Response.json(value, { headers: { [APP_ORIGIN_HEADER]: 'app' } });
  const deny = (status = 302) => new Response(status === 401 ? '{}' : '', { status, headers: status < 400 ? { location: '/oauth2/start' } : {} });
  for (const status of [302, 401, 403]) {
    const result = await smokeRelease(base, active, { allowUnreported: true, fetcher: async url => url.pathname === '/joe/healthz' ? app(health) : deny(status) });
    assert.equal(result.ok, true);
  }
  const cases = [
    ...['app', '', 'other'].map(stamp => ({ match: () => true, answer: () => new Response('{}', { status: 401, headers: { [APP_ORIGIN_HEADER]: stamp } }), error: /sso_not_proven/ })),
    { match: u => u.pathname === '/joe/', answer: () => new Response('UI'), error: /protected_ui_exposed/ },
    { match: u => u.pathname === '/joe/app.js', answer: () => new Response('app bytes'), error: /protected_ui_exposed/ },
    { match: u => u.pathname === '/joe/healthz/', answer: () => new Response('wrong router', { status: 404 }), error: /protected_ui_exposed/ },
    { match: u => u.pathname === '/joe/healthz-extra', answer: () => Response.json(health), error: /protected_ui_exposed/ },
    { match: (_u, init) => !!init.headers['x-auth-request-user'], answer: () => Response.json({ private: 'synthetic' }), error: /spoofed_identity_exposed/ },
    { match: () => true, answer: () => new Response('', { status: 302 }), error: /sso_not_proven/ },
  ];
  for (const c of cases) await assert.rejects(smokeRelease(base, active, { allowUnreported: true, fetcher: async (url, init) => {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    if (url.pathname === '/joe/healthz') return app(health);
    return c.match(url, init) ? c.answer() : deny();
  } }), c.error);
  for (const route of PROTECTED_READS) await assert.rejects(smokeRelease(base, active, { allowUnreported: true, fetcher: async (url, init) => {
    if (url.pathname === '/joe/healthz') return app(health);
    return url.pathname === '/joe/' + route && init.headers['x-auth-request-user'] ? Response.json({ fixture: true }) : deny();
  } }), /spoofed_identity_exposed/, route);
  for (const stamp of [null, '', 'other']) await assert.rejects(smokeRelease(base, active, { fetcher: async () => Response.json(health, { headers: stamp === null ? {} : { [APP_ORIGIN_HEADER]: stamp } }) }), /app_origin_not_proven/);
  // Any protected route's app stamp, including only on spoofed requests,
  // invalidates SSO proof even when its status otherwise resembles an edge denial.
  for (const route of [...PROTECTED_READS, '', `app.js?v=${active.version}`, 'healthz/', 'healthz-extra']) for (const spoof of [false, true]) {
    await assert.rejects(smokeRelease(base, active, { allowUnreported: true, fetcher: async (url, init) => {
      if (url.pathname === '/joe/healthz') return app(health);
      return url.href === base + route && !!init.headers['x-auth-request-user'] === spoof ? new Response('{}', { status: 403, headers: { [APP_ORIGIN_HEADER]: 'app' } }) : deny();
    } }), /sso_not_proven/, `${route} (${spoof ? 'spoofed' : 'anonymous'})`);
  }
});
test('P6 smoke: SSO redirects are auth_required; wrong release, stale feeds, exposed reads and oversized health fail', async t => {
  const alias = join(temporary(t), 'smoke.mjs');
  fs.symlinkSync(fs.realpathSync(new URL('../scripts/smoke-release.mjs', import.meta.url)), alias);
  const cli = spawnSync(process.execPath, [alias, 'not-a-url', active.version_scheme, active.version], { encoding: 'utf8' });
  assert.equal(cli.status, 1, 'a symlinked CLI must run and fail closed, not silently skip its entry point');
  assert.match(cli.stderr, /release_smoke_failed/);
  const health = structuredClone(samples.healthz);
  assert.ok(health, 'health fixture');
  Object.assign(health, { version: active.version, versionScheme: active.version_scheme });
  const app = value => Response.json(value, { headers: { [APP_ORIGIN_HEADER]: 'app' } });
  const url = 'https://board.example.invalid/joe/';
  for (const status of [302, 401, 403]) await assert.rejects(smokeRelease(url, active, { fetcher: async (_url, init) => {
    assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit'); assert.deepEqual(init.headers, { accept: 'application/json' });
    return new Response('', { status });
  } }), /auth_required/);
  await assert.rejects(smokeRelease(url, oldRelease, { allowUnreported: true, fetcher: async () => app(health) }), /release_mismatch/);
  await assert.rejects(smokeRelease(url, active, { maxWaitSeconds: 0, fetcher: async () => app({ ...health, snapshotAgeSeconds: 61 }) }), /feeds_not_ready/);
  await assert.rejects(smokeRelease(url, active, { allowUnreported: true, fetcher: async () => app(health) }), /protected_read_exposed/);
  await assert.rejects(smokeRelease(url, active, { fetcher: async () => new Response(' '.repeat(16385), { headers: { [APP_ORIGIN_HEADER]: 'app' } }) }), /health_size_limit/);
  for (const base of ['https://board.example.invalid/', 'https://user:pass@board.example.invalid/joe/', 'https://board.example.invalid/joe/?token=redacted']) await assert.rejects(smokeRelease(base, active), /base_invalid/);
});
test('JOED-59 health: unchanged valid Fleet Config stays current with its original age across restart', t => {
  const root = temporary(t), model = createReadModel({ dataDir: root, clock: () => NOW });
  assert.equal(model.observeFleet(samples['fleet-config']).ok, true);
  const later = new Date(Date.parse(NOW) + 86400000).toISOString();
  const restarted = createReadModel({ dataDir: root, clock: () => later });
  assert.equal(restarted.observeFleet(samples['fleet-config']).ok, true);
  const health = healthProjection(restarted, active, later);
  assert.deepEqual(health.feeds['fleet-config'], { state: 'fresh', ageSeconds: 86400, reason: null });
  assert.equal(validateContract('healthz', health).ok, true);
});
test('JOED-59 health: absent, rejected, failed-refresh and clock-regressed Fleet Config keep their reasons', t => {
  const model = createReadModel({ dataDir: temporary(t), clock: () => NOW });
  const fleet = (m = model, now = NOW) => healthProjection(m, active, now).feeds['fleet-config'];
  assert.deepEqual(fleet(), { state: 'not reported', ageSeconds: null, reason: 'feed_not_received' });
  model.observeFleet(samples['fleet-config']);
  model.observeFleet({ ...samples['fleet-config'], mode: 'live' });
  assert.deepEqual(fleet(), { state: 'broken', ageSeconds: 0, reason: 'contract_invalid' });
  model.observeFleet(samples['fleet-config']);
  assert.deepEqual(fleet(model, new Date(Date.parse(NOW) - 1000).toISOString()), { state: 'broken', ageSeconds: null, reason: 'clock_regressed' });
  let fail = false;
  const failed = createReadModel({ dataDir: temporary(t), clock: () => NOW, write: (...args) => {
    if (fail) throw new Error('synthetic write failure');
    // Observe once with the normal storage implementation before failing writes.
    atomicWrite(...args);
  } });
  failed.observeFleet(samples['fleet-config']); fail = true;
  failed.observeFleet({ ...samples['fleet-config'], rev: 'fc-000002' });
  assert.deepEqual(fleet(failed), { state: 'broken', ageSeconds: 0, reason: 'refresh_failed' });
});

function smokeFixture(transform = () => {}) {
  const health = structuredClone(samples.healthz);
  Object.assign(health, { version: active.version, versionScheme: active.version_scheme, snapshotAgeSeconds: 1,
    gateway: { confirmed: false, checkAgeSeconds: 70, reason: 'gateway_unconfirmed' } });
  for (const name of ['data', 'history', 'fleet-config']) health.feeds[name] = { state: 'fresh', ageSeconds: name === 'fleet-config' ? 86400 : 1, reason: null };
  let elapsed = 0, polls = 0, probes = 0;
  const waits = [];
  return { waits, polls: () => polls, probes: () => probes,
    options: { clock: () => elapsed, wait: async ms => { waits.push(ms); elapsed += ms; }, fetcher: async (url, init) => {
      if (url.pathname === '/joe/healthz') {
        assert.deepEqual(init.headers, { accept: 'application/json' });
        const next = structuredClone(health); transform(next, ++polls);
        assert.equal(validateContract('healthz', next).ok, true);
        return Response.json(next, { headers: { [APP_ORIGIN_HEADER]: 'app' } });
      }
      probes++;
      return new Response('{}', { status: 401 });
    } },
  };
}
test('JOED-59 smoke: settled config and a gateway confirmed on only the third poll pass; access probes run once', async () => {
  const fixture = smokeFixture((health, poll) => {
    if (poll === 3) health.gateway = { confirmed: true, checkAgeSeconds: 0, reason: null };
  });
  const result = await smokeRelease('https://board.example.invalid/joe/', active, fixture.options);
  assert.equal(result.ok, true); assert.equal(result.feeds['fleet-config'].ageSeconds, 86400);
  assert.equal(fixture.polls(), 3); assert.deepEqual(fixture.waits, [10000, 10000]);
  assert.equal(fixture.probes(), 2 * (PROTECTED_READS.length + 4));
});
test('JOED-59 smoke: gateway confirmation is retained while waiting for fresh feeds', async () => {
  const fixture = smokeFixture((health, poll) => {
    if (poll === 1) {
      health.gateway = { confirmed: true, checkAgeSeconds: 0, reason: null };
      health.feeds.history = { state: 'stale', ageSeconds: 60, reason: 'snapshot_stale' };
    }
  });
  assert.equal((await smokeRelease('https://board.example.invalid/joe/', active, fixture.options)).ok, true);
  assert.equal(fixture.polls(), 2);
});
for (const fault of ['gateway never confirmed', 'fleet contract_invalid', 'fleet absent', 'data stale', 'history stale', 'snapshot stale']) {
  test(`JOED-59 smoke: ${fault} times out as feeds_not_ready without access probes`, async () => {
    const fixture = smokeFixture(health => {
      if (fault !== 'gateway never confirmed') health.gateway = { confirmed: true, checkAgeSeconds: 0, reason: null };
      if (fault === 'fleet contract_invalid') health.feeds['fleet-config'] = { state: 'broken', ageSeconds: 86400, reason: 'contract_invalid' };
      if (fault === 'fleet absent') health.feeds['fleet-config'] = { state: 'not reported', ageSeconds: null, reason: 'feed_not_received' };
      for (const name of ['data', 'history']) if (fault === `${name} stale`) health.feeds[name] = { state: 'stale', ageSeconds: 60, reason: 'snapshot_stale' };
      if (fault === 'snapshot stale') health.snapshotAgeSeconds = 60;
    });
    await assert.rejects(smokeRelease('https://board.example.invalid/joe/', active, fixture.options), /^Error: feeds_not_ready$/);
    assert.equal(fixture.polls(), 16); assert.deepEqual(fixture.waits, Array(15).fill(10000));
    assert.equal(fixture.probes(), 0);
  });
}
test('JOED-59 smoke: zero wait checks once; custom wait ends at its bound; allowUnreported still skips readiness', async () => {
  for (const [maxWaitSeconds, polls, waits] of [[0, 1, []], [15, 3, [10000, 5000]]]) {
    const fixture = smokeFixture();
    await assert.rejects(smokeRelease('https://board.example.invalid/joe/', active, { ...fixture.options, maxWaitSeconds }), /feeds_not_ready/);
    assert.equal(fixture.polls(), polls); assert.deepEqual(fixture.waits, waits);
  }
  const fixture = smokeFixture();
  assert.equal((await smokeRelease('https://board.example.invalid/joe/', active, { ...fixture.options, allowUnreported: true })).ok, true);
  assert.equal(fixture.polls(), 1); assert.deepEqual(fixture.waits, []);
  for (const maxWaitSeconds of [-1, 601, 1.5, NaN, '150']) await assert.rejects(smokeRelease('https://board.example.invalid/joe/', active, { maxWaitSeconds }), /smoke_wait_invalid/);
});
test('JOED-59 smoke: later polls still enforce release, schema, origin and authentication checks', async () => {
  for (const [failure, reason] of [['release', 'release_mismatch'], ['schema', 'health_contract_invalid'], ['origin', 'app_origin_not_proven'], ['auth', 'auth_required']]) {
    const fixture = smokeFixture();
    let polls = 0;
    const fetcher = async (url, init) => {
      if (++polls === 1) return fixture.options.fetcher(url, init);
      if (failure === 'auth') return new Response('', { status: 302 });
      const response = await fixture.options.fetcher(url, init), health = await response.json();
      if (failure === 'release') health.version = oldRelease.version;
      if (failure === 'schema') health.schema = 'unknown';
      return Response.json(health, { headers: failure === 'origin' ? {} : { [APP_ORIGIN_HEADER]: 'app' } });
    };
    await assert.rejects(smokeRelease('https://board.example.invalid/joe/', active, { ...fixture.options, fetcher }), new RegExp(`^Error: ${reason}$`));
    assert.equal(polls, 2); assert.equal(fixture.probes(), 0);
  }
});
test('JOED-59 smoke CLI: positional invocation defaults to 150 seconds; wait flag is bounded and fail-closed', t => {
  const preload = join(temporary(t), 'smoke-clock.mjs');
  const fixture = structuredClone(samples.healthz);
  Object.assign(fixture, { version: active.version, versionScheme: active.version_scheme, snapshotAgeSeconds: 1 });
  for (const name of ['data', 'history', 'fleet-config']) fixture.feeds[name] = { state: 'fresh', ageSeconds: name === 'fleet-config' ? 86400 : 1, reason: null };
  fs.writeFileSync(preload, `import timers from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
let elapsed = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => elapsed } });
timers.setTimeout = async ms => { elapsed += ms; };
syncBuiltinESMExports();
globalThis.fetch = async url => {
  if (url.pathname !== '/joe/healthz') return new Response('{}', { status: 401 });
  const health = ${JSON.stringify(fixture)};
  health.gateway = elapsed === 150000 ? { confirmed: true, checkAgeSeconds: 0, reason: null }
    : { confirmed: false, checkAgeSeconds: 70, reason: 'gateway_unconfirmed' };
  return Response.json(health, { headers: { 'x-joedesk-origin': 'app' } });
};\n`);
  const run = (...flags) => spawnSync(process.execPath, ['--import', preload, 'scripts/smoke-release.mjs', 'https://board.example.invalid/joe/', active.version_scheme, active.version, ...flags], { encoding: 'utf8', timeout: 10000 });
  const defaultCLI = run();
  assert.equal(defaultCLI.status, 0, defaultCLI.stderr); assert.equal(JSON.parse(defaultCLI.stdout).ok, true);
  for (const value of ['0', '20']) {
    const failed = run('--max-wait-seconds', value);
    assert.equal(failed.status, 1); assert.equal(failed.stderr.trim(), 'feeds_not_ready');
  }
  for (const flags of [['--max-wait-seconds', '-1'], ['--max-wait-seconds', '601'], ['--max-wait-seconds', '1.5'], ['--max-wait-seconds'], ['--unexpected', '0'], ['extra']]) {
    const failed = run(...flags);
    assert.equal(failed.status, 1); assert.equal(failed.stderr.trim(), 'release_smoke_failed');
  }
});
test('P6 normal build verifies pinned offline bundle/closure; corruption, extra, missing and untracked fail', t => {
  execFileSync(process.execPath, ['scripts/check-release.mjs'], { stdio: 'pipe' });
  const root = temporary(t);
  const files = read('release/closure.json').files;
  for (const name of [...files.map(f => f.path), 'release/closure.json', 'scripts/check-release.mjs']) {
    const target = join(root, name); fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.copyFileSync(new URL('../' + name, import.meta.url), target);
  }
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-release.mjs')], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const target = join(root, 'public/joe/app.js'), original = fs.readFileSync(target);
  fs.appendFileSync(target, '\n'); assert.equal(run().status, 1); fs.writeFileSync(target, original);
  const extra = join(root, 'public/joe/extra.js'); fs.writeFileSync(extra, ''); assert.equal(run().status, 1); fs.renameSync(extra, join(root, 'extra.js'));
  fs.renameSync(target, join(root, 'app.js')); assert.equal(run().status, 1); fs.renameSync(join(root, 'app.js'), target);
  const vendor = join(root, 'public/joe/vendor/calver/version.js'), vendorBytes = fs.readFileSync(vendor);
  fs.appendFileSync(vendor, '\n'); assert.equal(run().status, 1); fs.writeFileSync(vendor, vendorBytes);
  const extraBundle = join(root, 'public/joe/vendor/calver/extra.js'); fs.writeFileSync(extraBundle, ''); assert.equal(run().status, 1); fs.renameSync(extraBundle, join(root, 'extra-bundle.js'));
  const bundleManifest = join(root, 'public/joe/vendor/calver/manifest.json'), manifestBytes = fs.readFileSync(bundleManifest);
  fs.appendFileSync(bundleManifest, '\n'); assert.equal(run().status, 1); fs.writeFileSync(bundleManifest, manifestBytes);
  execFileSync('git', ['init', '-q', root], { stdio: 'pipe' });
  assert.equal(run().status, 1, 'working-tree builds reject untracked payloads even with matching hashes');
  fs.appendFileSync(join(root, 'release/closure.json'), '\n'); assert.equal(run().status, 1);
});
