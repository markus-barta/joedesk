import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { createImageEvidence, createReleaseSet, readOCI } from '../scripts/release-set.mjs';
import { JOBS, SBOM_FORMAT, PROVENANCE_FORMAT, sha256, validateReleaseSet, verifyReleaseSet } from '../scripts/verify-release-set.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, cwd = root, input) => execFileSync('git', args, { cwd, input, stdio: ['pipe', 'pipe', 'pipe'] });
const commit = git(['rev-parse', 'HEAD']).toString().trim();
const context = { repository: 'markus-barta/joedesk', commit, ref: 'refs/pull/49/merge', event: 'pull_request',
  run_id: '123456', run_attempt: '2', workflow: 'ci', server_url: 'https://github.com', generated_at: '2026-10-18T12:00:00.000Z' };
const digest = n => 'sha256:' + n.repeat(64);
const evidence = { source_commit: commit,
  image: { digest: digest('a'), index_digest: digest('b'), config_digest: digest('c'), platform: 'linux/amd64' },
  sbom: { format: SBOM_FORMAT, digest: digest('d') }, provenance: { format: PROVENANCE_FORMAT, digest: digest('e') },
  reproducible: { checked: true, identical: false } };
const goodFixture = createReleaseSet(structuredClone(evidence), context, root);
const good = () => structuredClone(goodFixture);
function temporary(t) { const dir = scratch('joed-release-set-'); t.after(() => discard(dir, 'release-set test')); return dir; }
function put(m, path, value) {
  const names = path.split('.'), last = names.pop();
  let obj = m;
  for (const key of names) obj = obj[key];
  obj[last] = value;
}

test('release-set good fixture verifies the exact commit and stable key order; PR merge is the source', () => {
  const m = good();
  assert.equal(verifyReleaseSet(m, { root, commit }), m);
  assert.equal(JSON.stringify(m), JSON.stringify(good()));
  assert.deepEqual(Object.keys(m), ['schema', 'version', 'version_scheme', 'release_channel', 'release_sequence', 'source',
    'contracts', 'closure_sha256', 'image', 'sbom', 'provenance', 'reproducible', 'validation_run', 'generated_at']);
  assert.deepEqual(Object.keys(m.source), ['repository', 'commit', 'tree', 'ref', 'event']);
  assert.deepEqual(Object.keys(m.contracts), ['manifest_revision', 'contract_set_sha256', 'contracts_json_sha256']);
  assert.deepEqual(Object.keys(m.image), ['digest', 'index_digest', 'config_digest', 'platform', 'base_image']);
  assert.deepEqual(m.validation_run.jobs, JOBS);
  assert.equal(m.generated_at, context.generated_at);
  assert.equal(m.version, '261016151218.0.0', 'use the reservation, never the generation clock');
  const main = createReleaseSet(evidence, { ...context, ref: 'refs/heads/main', event: 'push' }, root);
  assert.equal(main.source.event, 'push');
});

for (const [field, value, reason] of [
  ['source.commit', 'f'.repeat(40), /commit does not exist/],
  ['source.tree', 'f'.repeat(40), /source.tree/],
  ['version', '261018120000.0.0', /version:/],
  ['version_scheme', 'inspr-calendar-v2', /version_scheme:/],
  ['release_channel', 'preview', /release_channel:/],
  ['release_sequence', 25, /release_sequence:/],
  ['contracts.manifest_revision', goodFixture.contracts.manifest_revision + 1, /manifest_revision/],
  ['contracts.contract_set_sha256', 'f'.repeat(64), /contract_set_sha256/],
  ['contracts.contracts_json_sha256', 'f'.repeat(64), /contracts_json_sha256/],
  ['closure_sha256', 'f'.repeat(64), /closure_sha256/],
  ['image.base_image', 'node:22-alpine@' + digest('f'), /image.base_image/],
]) test(`release-set rejects tampered ${field}`, () => {
  const m = good(); put(m, field, value);
  assert.throws(() => verifyReleaseSet(m, { root }), reason);
});

test('release-set --commit binds to the full SHA and cannot silently select another commit', () => {
  for (const expected of ['f'.repeat(40), commit.slice(0, 7), 'HEAD', '--help']) {
    assert.throws(() => verifyReleaseSet(good(), { root, commit: expected }), /--commit/);
  }
});

for (const field of ['', 'source', 'contracts', 'image', 'sbom', 'provenance', 'reproducible', 'validation_run']) {
  test(`release-set exact schema rejects unknown/missing keys in ${field || 'root'}`, () => {
    let m = good(), obj = field ? m[field] : m;
    obj.unknown = true; assert.throws(() => validateReleaseSet(m), /exact keys/);
    m = good(); obj = field ? m[field] : m;
    delete obj[Object.keys(obj)[0]]; assert.throws(() => validateReleaseSet(m), /exact keys/);
    if (field) { m = good(); m[field] = []; assert.throws(() => validateReleaseSet(m), /exact keys/); }
  });
}

for (const field of ['image.digest', 'image.index_digest', 'image.config_digest', 'sbom.digest', 'provenance.digest',
  'closure_sha256', 'contracts.contract_set_sha256', 'contracts.contracts_json_sha256']) {
  test(`release-set validates digest grammar for ${field}`, () => {
    for (const value of [null, 123, '', 'f'.repeat(63), 'sha256:' + 'F'.repeat(64), 'sha512:' + 'f'.repeat(64), '../blob']) {
      const m = good(); put(m, field, value);
      assert.throws(() => validateReleaseSet(m), /[Dd]igest|SHA256/);
    }
  });
}

for (const [field, value, reason] of [
  ['schema', 'joedesk.release-set.v2', /schema/], ['version', null, /version/],
  ['release_sequence', '24', /release_sequence/], ['release_sequence', 0, /release_sequence/],
  ['contracts.manifest_revision', 6.1, /manifest_revision/], ['source.repository', 'repo', /repository/],
  ['source.commit', 'HEAD', /full Git SHA/], ['source.tree', 'a'.repeat(39), /full Git SHA/],
  ['source.ref', 'main', /source.ref/], ['source.event', 'workflow_dispatch', /source.event/],
  ['image.platform', 'linux/arm64', /platform/], ['image.base_image', 'node:22-alpine', /immutable base/],
  ['sbom.format', 'spdx', /sbom.format/], ['provenance.format', 'unknown', /provenance.format/],
  ['reproducible.checked', 'true', /reproducible/], ['reproducible.identical', null, /reproducible/],
  ['validation_run.id', 123456, /validation_run.id/], ['validation_run.attempt', '0', /attempt/],
  ['validation_run.workflow', '', /workflow/], ['validation_run.jobs', ['package', 'docker'], /jobs/],
  ['validation_run.url', 'https://github.com/elsewhere/repo/actions/runs/123456', /url/],
  ['validation_run.url', 'https://github.com/markus-barta/joedesk/actions/runs/999', /url/],
  ['validation_run.url', 'http://github.com/markus-barta/joedesk/actions/runs/123456', /url/],
  ['generated_at', '2026-10-18T12:00:00+02:00', /UTC instant/],
  ['generated_at', '2026-02-30T12:00:00.000Z', /UTC instant/],
]) test(`release-set rejects malformed ${field}: ${JSON.stringify(value)}`, () => {
  const m = good(); put(m, field, value); assert.throws(() => validateReleaseSet(m), reason);
});

test('release-set represents an unchecked comparison without claiming identity', () => {
  const m = good(); m.reproducible = { checked: false, identical: null };
  assert.equal(validateReleaseSet(m), m);
  m.reproducible.identical = true; assert.throws(() => validateReleaseSet(m), /reproducible/);
});

// Make isolated Git objects as test data, without changing any source branch or
// running commit hooks. Each fixture has only the files read by the verifier.
function committedFixture(t, mutate = () => {}) {
  const dir = temporary(t);
  git(['init', '-q', dir]);
  const paths = ['release.json', 'release/preparation.json', 'release/contracts.json', 'release/closure.json', 'scripts/check-release.mjs',
    ...git(['ls-tree', '-r', '--name-only', commit, '--', 'contracts/']).toString().trim().split('\n')];
  const files = new Map(paths.map(name => [name, git(['show', `${commit}:${name}`])]));
  mutate(files);
  const tree = {};
  for (const [name, bytes] of files) {
    const parts = name.split('/'), leaf = parts.pop(); let parent = tree;
    for (const part of parts) parent = parent[part] ??= {};
    parent[leaf] = git(['hash-object', '-w', '--stdin'], dir, bytes).toString().trim();
  }
  function makeTree(node) {
    const lines = Object.entries(node).map(([name, value]) => typeof value === 'string' ?
      `100644 blob ${value}\t${name}\n` : `040000 tree ${makeTree(value)}\t${name}\n`).join('');
    return git(['mktree'], dir, lines).toString().trim();
  }
  const treeSHA = makeTree(tree);
  const fixtureCommit = git(['-c', 'user.name=Markus Barta', '-c', 'user.email=markus@barta.com', 'commit-tree', treeSHA], dir, 'JOED-37 test fixture\n').toString().trim();
  const m = good(); m.source.commit = fixtureCommit; m.source.tree = treeSHA;
  return { dir, manifest: m };
}

test('release-set reads the recorded commit even in a dirty unrelated checkout', t => {
  const { dir, manifest } = committedFixture(t);
  writeFileSync(join(dir, 'release.json'), '{"version":"tampered checkout"}');
  assert.equal(verifyReleaseSet(manifest, { root: dir }), manifest);
});

for (const [name, mutate, reason] of [
  ['contracts/ payload', files => files.set('contracts/index.mjs', Buffer.from('tampered')), /contract_set_sha256/],
  ['extra contract', files => files.set('contracts/extra.json', Buffer.from('{}')), /contract_set_sha256/],
  ['missing contract', files => files.delete('contracts/index.mjs'), /contract_set_sha256/],
  ['contract revision', files => { const contracts = JSON.parse(files.get('release/contracts.json')); contracts.manifest_revision++;
    files.set('release/contracts.json', Buffer.from(JSON.stringify(contracts))); }, /manifest_revision/],
  ['release reservation', files => { const prep = JSON.parse(files.get('release/preparation.json')); prep.reservation.release_sequence++;
    files.set('release/preparation.json', Buffer.from(JSON.stringify(prep))); }, /reservation disagree/],
  ['closure bytes', files => files.set('release/closure.json', Buffer.concat([files.get('release/closure.json'), Buffer.from('\n')])), /committed closure/],
  ['closure pin', files => files.set('scripts/check-release.mjs', Buffer.from(`export const CLOSURE_SHA256 = '${'f'.repeat(64)}';\n`)), /committed closure/],
]) test(`release-set rejects inconsistent committed ${name}`, t => {
  const { dir, manifest } = committedFixture(t, mutate);
  assert.throws(() => verifyReleaseSet(manifest, { root: dir }), reason);
});

test('release-set contracts_json_sha256 covers exact bytes beyond the contract-set pin', t => {
  const { dir, manifest } = committedFixture(t, files => files.set('release/contracts.json', Buffer.concat([files.get('release/contracts.json'), Buffer.from('\n')])));
  assert.throws(() => verifyReleaseSet(manifest, { root: dir }), /contracts_json_sha256/);
});

const INDEX = 'application/vnd.oci.image.index.v1+json', MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
function ociFixture(dir, options = {}) {
  mkdirSync(join(dir, 'blobs/sha256'), { recursive: true });
  const write = (value, mediaType, extra = {}) => {
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), hash = sha256(bytes);
    writeFileSync(join(dir, 'blobs/sha256', hash), bytes);
    return { mediaType, digest: `sha256:${hash}`, size: bytes.length, ...extra };
  };
  const config = write({ os: 'linux', architecture: 'amd64', created: options.created ?? '2026-10-16T15:12:18Z' }, 'application/vnd.oci.image.config.v1+json');
  const image = write({ schemaVersion: 2, mediaType: MANIFEST, config, layers: [write('fixture layer', 'application/vnd.oci.image.layer.v1.tar+gzip')] }, MANIFEST,
    { platform: { os: 'linux', architecture: options.platform ?? 'amd64' } });
  const statement = format => write({ _type: options.emptySubject ? 'https://in-toto.io/Statement/v1' : 'https://in-toto.io/Statement/v0.1', predicateType: format,
    subject: options.emptySubject ? [] : [{ name: '_', digest: { sha256: options.subject ?? image.digest.slice(7) } }],
    predicate: { fixture: true, spdxVersion: 'SPDX-2.3', invocation: options.invocation ?? 'first' },
  }, 'application/vnd.in-toto+json', { annotations: { 'in-toto.io/predicate-type': options.annotation ?? format } });
  const layers = [statement(options.provenanceFormat ?? PROVENANCE_FORMAT), ...(options.noSBOM ? [] : [statement(SBOM_FORMAT)])];
  if (options.duplicate) layers.push(statement(SBOM_FORMAT));
  const target = options.target ?? image.digest;
  const att = write({ schemaVersion: 2, mediaType: MANIFEST, config: write({}, 'application/vnd.oci.empty.v1+json'), layers,
    ...(options.artifact ? { artifactType: 'application/vnd.docker.attestation.manifest.v1+json', subject: { ...image, digest: target } } : {}),
  }, MANIFEST, { platform: { os: 'unknown', architecture: 'unknown' }, annotations: {
    'vnd.docker.reference.type': 'attestation-manifest', 'vnd.docker.reference.digest': target,
  } });
  const index = { schemaVersion: 2, mediaType: INDEX, manifests: [image, att] }, descriptor = write(index, INDEX);
  writeFileSync(join(dir, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(options.direct ? index : { schemaVersion: 2, mediaType: INDEX, manifests: [descriptor] }));
  return { image, config, index: descriptor, layers };
}

test('OCI fixture extracts the platform image and exported index, not the wrapper or attestation manifest', t => {
  const dir = temporary(t), descriptors = ociFixture(dir), result = readOCI(dir);
  assert.equal(result.image.digest, descriptors.image.digest);
  assert.equal(result.image.index_digest, descriptors.index.digest);
  assert.equal(result.image.config_digest, descriptors.config.digest);
  assert.equal(result.sbom.digest, descriptors.layers[1].digest);
  assert.equal(result.provenance.digest, descriptors.layers[0].digest);
  assert.equal(createReleaseSet({ source_commit: commit, ...result, reproducible: { checked: true, identical: true } }, context, root).source.commit, commit);
});

test('OCI supports direct index and OCI artifact attestation storage', t => {
  for (const options of [{ direct: true }, { artifact: true }, { artifact: true, emptySubject: true, provenanceFormat: 'https://slsa.dev/provenance/v1' }]) {
    const dir = join(temporary(t), 'oci'); const descriptors = ociFixture(dir, options);
    assert.equal(readOCI(dir).image.index_digest, descriptors.index.digest);
    assert.equal(readOCI(dir).provenance.format, options.provenanceFormat ?? PROVENANCE_FORMAT);
    const manifest = createReleaseSet({ source_commit: commit, ...readOCI(dir), reproducible: { checked: true, identical: true } }, context, root);
    assert.equal(verifyReleaseSet(manifest, { root }), manifest);
  }
});

for (const [options, reason] of [
  [{ platform: 'arm64' }, /exactly one linux\/amd64/], [{ noSBOM: true }, /SBOM and one supported provenance/],
  [{ emptySubject: true }, /subject\/predicate/],
  [{ target: digest('f') }, /targets another image/], [{ subject: 'f'.repeat(64) }, /subject\/predicate/],
  [{ annotation: 'unknown' }, /predicate annotation/], [{ duplicate: true }, /duplicate attestation/],
]) test(`OCI rejects invalid attestation/image fixture ${JSON.stringify(options)}`, t => {
  const dir = temporary(t); ociFixture(dir, options); assert.throws(() => readOCI(dir), reason);
});

test('OCI hashes referenced blobs instead of trusting their digest filenames', t => {
  for (const field of ['image', 'config', 'index', 'sbom', 'provenance']) {
    const dir = join(temporary(t), 'oci'), d = ociFixture(dir);
    const descriptor = field === 'sbom' ? d.layers[1] : field === 'provenance' ? d.layers[0] : d[field];
    writeFileSync(join(dir, 'blobs/sha256', descriptor.digest.slice(7)), '{}');
    assert.throws(() => readOCI(dir), /blob digest\/size mismatch/);
  }
});

test('reproducibility compares platform image bytes; attestation timestamps may differ and mismatches are recorded', t => {
  const dir = temporary(t), first = join(dir, 'first'), repeat = join(dir, 'repeat'), different = join(dir, 'different');
  ociFixture(first); ociFixture(repeat, { invocation: 'repeat' }); ociFixture(different, { created: '2026-10-18T12:00:00Z' });
  assert.notEqual(readOCI(first).image.index_digest, readOCI(repeat).image.index_digest);
  assert.deepEqual(createImageEvidence(first, repeat, commit).reproducible, { checked: true, identical: true });
  const e = createImageEvidence(first, different, commit);
  assert.deepEqual(e.reproducible, { checked: true, identical: false });
  assert.equal(createReleaseSet(e, context, root).reproducible.identical, false);
  assert.throws(() => createReleaseSet({ ...e, source_commit: 'f'.repeat(40) }, context, root), /source commit mismatch/);
});

test('verifier CLI exits 0 for a good file and 1 with a clear reason for tampering, malformed JSON and usage', t => {
  const dir = temporary(t), file = join(dir, 'release-set.json'), script = resolve(root, 'scripts/verify-release-set.mjs');
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  writeFileSync(file, JSON.stringify(good()));
  const ok = run([file, '--commit', commit]); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /verified/);
  const bad = good(); bad.source.tree = 'f'.repeat(40); writeFileSync(file, JSON.stringify(bad));
  const tampered = run([file]); assert.equal(tampered.status, 1); assert.match(tampered.stderr, /source.tree/);
  writeFileSync(file, '{'); assert.equal(run([file]).status, 1);
  assert.equal(run([file, '--commit']).status, 1); assert.equal(run([]).status, 1);
  assert.equal(run([file, '--unknown']).status, 1);
});
