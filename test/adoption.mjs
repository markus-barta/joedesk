import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { checkRelease, checkAdoptedRelease } from '../scripts/check-release.mjs';
import { validateAdoption } from '../scripts/check-adoption.mjs';
import { createReleaseSet } from '../scripts/release-set.mjs';
import { sha256, SBOM_FORMAT, PROVENANCE_FORMAT } from '../scripts/verify-release-set.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const json = name => JSON.parse(fs.readFileSync(join(repoRoot, name)));
const active = json('release.json'), contracts = json('release/contracts.json');
const closure = json('release/closure.json');
const instant = '2026-10-19T16:00:00.000Z';
const digest = char => `sha256:${char.repeat(64)}`;
const git = (root, args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const recordPath = root => join(root, 'adoption', `${active.version}.json`);
function good() {
  return {
    schema: 'joedesk.adoption.v1', version: active.version, version_scheme: active.version_scheme,
    release_channel: active.release_channel, release_sequence: active.release_sequence,
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    release_set_sha256: 'c'.repeat(64), image_digest: digest('d'), contract_set_sha256: contracts.contract_set_sha256,
    validation_run_id: '123456', decisions: ['d4509143-261d-4bd4-8de0-439fe0d80b2b'],
    deployment: { deployed_at: instant, operator_ticket: 'OPS-354', rollback_reference: 'retained-v1-artifact-and-matching-backup' },
    live_checks: Object.fromEntries(['joed_live_check', 'ops_t76_live', 'smoke_release', 'spoof_check']
      .map(name => [name, { status: 'pass', checked_at: instant }])),
    markus_ui_look: { status: 'confirmed', checked_at: instant }, adopted_at: instant,
  };
}
function put(record, field, value) {
  const names = field.split('.'), last = names.pop();
  let target = record;
  for (const name of names) target = target[name];
  target[last] = value;
}
function at(record, field) { return field.split('.').reduce((value, name) => value[name], record); }
function writeRecord(root, record) {
  fs.mkdirSync(join(root, 'adoption'), { recursive: true });
  fs.writeFileSync(recordPath(root), JSON.stringify(record));
}
function temporary(t, { adoptionTools = true } = {}) {
  const root = scratch('joed-adoption-');
  t.after(() => discard(root, 'adoption test'));
  for (const name of [...closure.files.map(file => file.path), 'release/closure.json', 'scripts/check-release.mjs',
    ...(adoptionTools ? ['scripts/check-adoption.mjs', 'scripts/verify-release-set.mjs'] : [])]) {
    const target = join(root, name);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.copyFileSync(join(repoRoot, name), target);
  }
  return root;
}
function committed(t) {
  const root = temporary(t);
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  const tree = git(root, ['write-tree']);
  // Fixture Git objects only; no source-branch commits or hooks are involved.
  const makeCommit = (message, parent) => git(root, ['-c', 'user.name=Markus Barta', '-c', 'user.email=markus@barta.com',
    'commit-tree', tree, ...(parent ? ['-p', parent] : [])], `${message}\n`);
  const commit = makeCommit('JOED-51 synthetic publication');
  git(root, ['update-ref', 'HEAD', commit]);
  const record = good(); record.source = { commit, tree };
  writeRecord(root, record);
  return { root, record, makeCommit };
}
function releaseSet(root, record) {
  const manifest = createReleaseSet({ source_commit: record.source.commit,
    image: { digest: record.image_digest, index_digest: digest('e'), config_digest: digest('f'), platform: 'linux/amd64' },
    sbom: { format: SBOM_FORMAT, digest: digest('a') }, provenance: { format: PROVENANCE_FORMAT, digest: digest('b') },
    reproducible: { checked: true, identical: true } },
  { repository: 'markus-barta/joedesk', commit: record.source.commit, ref: 'refs/heads/main', event: 'push',
    run_id: record.validation_run_id, run_attempt: '1', workflow: 'ci', server_url: 'https://github.com', generated_at: instant }, root);
  return manifest;
}
function writeSet(root, record, manifest) {
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(join(root, 'release-set.json'), bytes);
  record.release_set_sha256 = sha256(bytes);
  writeRecord(root, record);
}
const cli = (root, args = []) => spawnSync(process.execPath, [join(root, 'scripts/check-release.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const rejects = (root, reason, options = {}) => assert.rejects(checkAdoptedRelease({ root, ...options }), { message: `adoption_${reason}` });

test('adoption: missing active-version record fails after existing checks', async t => {
  const root = temporary(t);
  await rejects(root, 'record_missing');
  const other = good(); other.version = '261019102826.0.0';
  fs.mkdirSync(join(root, 'adoption'));
  fs.writeFileSync(join(root, 'adoption', `${other.version}.json`), JSON.stringify(other));
  await rejects(root, 'record_missing');
  const result = cli(root, ['--require-adoption']);
  assert.equal(result.status, 1); assert.equal(result.stderr, 'release-check: adoption_record_missing\n');
  fs.appendFileSync(join(root, 'server.mjs'), '\n');
  await assert.rejects(checkAdoptedRelease({ root }), { message: 'closure_payload_mismatch' });
});

test('adoption: valid synthetic archive record passes without Git and returns only fixed release metadata', async t => {
  const root = temporary(t); writeRecord(root, good());
  assert.deepEqual(await checkAdoptedRelease({ root }), { ...checkRelease({ root }), authoritative: true, adopted: active.version });
  const result = cli(root, ['--require-adoption']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), await checkAdoptedRelease({ root }));
  assert.equal(result.stderr, '');
});

test('adoption: non-flag CLI bytes stay unchanged with absent, valid or malformed records and no adoption tools', t => {
  const root = temporary(t, { adoptionTools: false });
  const expected = JSON.stringify({ ok: true, candidate: active.version, contractSet: contracts.contract_set_sha256,
    presentation: 'integrated', authoritative: false }) + '\n';
  for (const record of [undefined, good(), '{']) {
    if (record !== undefined) { writeRecord(root, record); if (record === '{') fs.writeFileSync(recordPath(root), record); }
    const result = cli(root);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, expected); assert.equal(result.stderr, '');
  }
});

test('adoption: each active/reservation coordinate and contract mismatch has a distinct error', async t => {
  const root = temporary(t);
  for (const [field, value] of [['version', '261019102826.0.0'], ['version_scheme', 'inspr-calendar-v2'],
    ['release_channel', 'preview'], ['release_sequence', active.release_sequence + 1], ['contract_set_sha256', 'f'.repeat(64)]]) {
    const record = good(); put(record, field, value); writeRecord(root, record);
    await rejects(root, `${field}_mismatch`);
  }
});

test('adoption: malformed JSON fails with a value-free error', async t => {
  const root = temporary(t); writeRecord(root, good());
  fs.writeFileSync(recordPath(root), '{"untrusted":');
  await rejects(root, 'record_invalid_json');
});

for (const field of ['', 'source', 'deployment', 'live_checks', ...Object.keys(good().live_checks).map(name => `live_checks.${name}`), 'markus_ui_look']) {
  test(`adoption schema: exact keys and object types in ${field || 'record'}`, () => {
    const name = field.replaceAll('.', '_') || 'record';
    const error = { message: `adoption_${name}_keys` };
    for (const mutation of ['unknown', 'missing', 'null', 'array', 'string']) {
      const record = good(), target = field ? at(record, field) : record;
      if (mutation === 'unknown') target.unrecognized = true;
      else if (mutation === 'missing') delete target[Object.keys(target)[0]];
      else {
        const value = mutation === 'null' ? null : mutation === 'array' ? [] : 'object';
        if (!field) { assert.throws(() => validateAdoption(value), error); continue; }
        put(record, field, value);
      }
      assert.throws(() => validateAdoption(record), error);
    }
  });
}

for (const [field, values] of [
  ['schema', [null, 1, 'joedesk.adoption.v2']],
  ...['version', 'version_scheme', 'release_channel'].map(field => [field, [null, 25, '', ' ', '\n']]),
  ['release_sequence', [null, '25', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]],
  ...['source.commit', 'source.tree'].map(field => [field, [null, 123, 'HEAD', 'f'.repeat(39), 'F'.repeat(40)]]),
  ...['release_set_sha256', 'contract_set_sha256'].map(field => [field, [null, 123, '', 'f'.repeat(63), 'F'.repeat(64)]]),
  ['image_digest', [null, 123, '', 'f'.repeat(64), digest('F'), 'sha512:' + 'f'.repeat(64)]],
  ['validation_run_id', [null, 123456, '', '0', '01', '1.5']],
  ['decisions', [null, 'question', [], [null], ['not-a-uuid'], [123], [...good().decisions, ...good().decisions]]],
  ['deployment.operator_ticket', [null, 354, '', 'ops-354', 'OPS-0', 'OPS-0354', 'OPS-354 extra']],
  ['deployment.rollback_reference', [null, 1, '', ' ', '\n', 'x'.repeat(501)]],
  ...Object.keys(good().live_checks).map(name => [`live_checks.${name}.status`, [null, true, 'fail', 'pending']]),
  ['markus_ui_look.status', [null, true, 'pass', 'pending']],
]) test(`adoption schema: exact type and grammar for ${field}`, () => {
  for (const value of values) {
    const record = good(); put(record, field, value);
    assert.throws(() => validateAdoption(record), { message: `adoption_${field.replaceAll('.', '_')}_invalid` });
  }
});

for (const field of ['deployment.deployed_at', ...Object.keys(good().live_checks).map(name => `live_checks.${name}.checked_at`),
  'markus_ui_look.checked_at', 'adopted_at']) test(`adoption schema: real UTC instants required at ${field}`, () => {
  for (const value of [null, 123, '2026-10-19', '2026-10-19T16:00:00+00:00', '2026-02-30T16:00:00.000Z',
    '2026-10-19T24:00:00.000Z', '2026-10-19T16:00:00.00Z']) {
    const record = good(); put(record, field, value);
    assert.throws(() => validateAdoption(record), { message: `adoption_${field.replaceAll('.', '_')}_invalid` });
  }
  const record = good(); put(record, field, '2026-10-19T16:00:00Z');
  assert.equal(validateAdoption(record), record);
});

test('adoption: CLI fails for unknown keys, failed live checks and unconfirmed UI', async t => {
  const root = temporary(t);
  const unknown = good(); unknown.extra = true; writeRecord(root, unknown); await rejects(root, 'record_keys');
  for (const name of Object.keys(good().live_checks)) {
    const record = good(); record.live_checks[name].status = 'fail'; writeRecord(root, record);
    await rejects(root, `live_checks_${name}_status_invalid`);
  }
  const record = good(); record.markus_ui_look.status = 'pending'; writeRecord(root, record);
  await rejects(root, 'markus_ui_look_status_invalid');
});

test('adoption: Git accepts the source itself and descendants; rejects missing commits, non-commits, wrong trees and unrelated HEAD', async t => {
  const { root, record, makeCommit } = committed(t);
  assert.equal((await checkAdoptedRelease({ root })).adopted, active.version);
  git(root, ['update-ref', 'HEAD', makeCommit('JOED-51 synthetic adoption PR', record.source.commit)]);
  assert.equal((await checkAdoptedRelease({ root })).adopted, active.version);
  for (const [field, value, reason] of [
    ['source.commit', 'f'.repeat(40), 'source_commit_missing'],
    ['source.commit', record.source.tree, 'source_commit_invalid'],
    ['source.tree', 'f'.repeat(40), 'source_tree_mismatch'],
    ['source.commit', makeCommit('JOED-51 unrelated history'), 'source_not_ancestor'],
  ]) {
    const invalid = structuredClone(record); put(invalid, field, value); writeRecord(root, invalid);
    await rejects(root, reason);
  }
});

test('adoption: release-set binds exact bytes, image, run, commit and committed metadata via the shared verifier', async t => {
  const { root, record, makeCommit } = committed(t);
  const manifest = releaseSet(root, record);
  writeSet(root, record, manifest);
  const options = { releaseSet: 'release-set.json' };
  assert.equal((await checkAdoptedRelease({ root, ...options })).adopted, active.version);
  const result = cli(root, ['--require-adoption', '--release-set', join(root, 'release-set.json')]);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).adopted, active.version);
  for (const [field, value, reason] of [
    ['release_set_sha256', 'f'.repeat(64), 'release_set_sha256_mismatch'],
    ['image_digest', digest('e'), 'image_digest_mismatch'],
    ['validation_run_id', '999999', 'validation_run_id_mismatch'],
  ]) {
    const invalid = structuredClone(record); put(invalid, field, value); writeRecord(root, invalid);
    await rejects(root, reason, options);
  }
  writeRecord(root, record);
  fs.appendFileSync(join(root, 'release-set.json'), '\n');
  await rejects(root, 'release_set_sha256_mismatch', options);
  for (const [field, value] of [['extra', true], ['source.tree', 'f'.repeat(40)], ['closure_sha256', 'f'.repeat(64)],
    ['version', '261019102826.0.0'], ['contracts.contract_set_sha256', 'f'.repeat(64)], ['image.base_image', 'node:22']]) {
    const invalid = structuredClone(manifest); put(invalid, field, value); writeSet(root, record, invalid);
    await rejects(root, 'release_set_invalid', options);
  }
  writeSet(root, record, manifest);
  const ancestor = record.source.commit;
  record.source.commit = makeCommit('JOED-51 different source at same tree', ancestor);
  git(root, ['update-ref', 'HEAD', record.source.commit]);
  writeRecord(root, record);
  await rejects(root, 'source_commit_mismatch', options);
});

test('adoption: release-set missing/invalid JSON and adoption CLI usage fail closed', async t => {
  const root = temporary(t); writeRecord(root, good());
  await rejects(root, 'release_set_missing', { releaseSet: 'absent.json' });
  fs.writeFileSync(join(root, 'release-set.json'), '{');
  await rejects(root, 'release_set_invalid_json', { releaseSet: 'release-set.json' });
  for (const args of [['--require-adoption', '--release-set'], ['--require-adoption', '--unknown'],
    ['--require-adoption', '--require-adoption'], ['--require-adoption', '--release-set', '--unknown']]) {
    const result = cli(root, args);
    assert.equal(result.status, 1); assert.equal(result.stderr, 'release-check: adoption_usage\n');
  }
});

test('adoption: record directory is outside both the pinned closure and Docker COPY sources', t => {
  const root = temporary(t); writeRecord(root, good());
  assert.equal(checkRelease({ root }).ok, true, 'adding a record must not require resealing the closure');
  assert.equal(closure.files.some(file => file.path.startsWith('adoption/')), false);
  assert.equal(closure.files.some(file => file.path === 'scripts/check-release.mjs'), false);
  const copies = fs.readFileSync(join(repoRoot, 'Dockerfile'), 'utf8').split('\n').filter(line => line.startsWith('COPY '));
  assert.equal(copies.some(line => line.includes('adoption') || /^COPY\s+\.\s/.test(line)), false);
  assert.equal(copies.includes('COPY scripts/check-release.mjs ./scripts/check-release.mjs'), true);
});
