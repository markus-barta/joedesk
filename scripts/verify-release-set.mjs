#!/usr/bin/env node
// Verify source evidence using Git objects, never the potentially dirty checkout.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const JOBS = ['package', 'browser', 'docker'];
export const SBOM_FORMAT = 'https://spdx.dev/Document';
export const PROVENANCE_FORMAT = 'https://slsa.dev/provenance/v0.2';
export const PROVENANCE_FORMATS = [PROVENANCE_FORMAT, 'https://slsa.dev/provenance/v1'];
const hex = /^[a-f0-9]{64}$/;
const oid = /^[a-f0-9]{40}$/;
export function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
function keys(value, expected, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${name}: exact keys required`);
}
function text(value) { return typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value); }
export function validateReleaseSet(m) {
  keys(m, ['schema', 'version', 'version_scheme', 'release_channel', 'release_sequence', 'source', 'contracts',
    'closure_sha256', 'image', 'sbom', 'provenance', 'reproducible', 'validation_run', 'generated_at'], 'release-set');
  requireThat(m.schema === 'joedesk.release-set.v1', 'schema: unsupported release-set');
  for (const k of ['version', 'version_scheme', 'release_channel']) requireThat(text(m[k]), `${k}: nonempty string required`);
  requireThat(Number.isSafeInteger(m.release_sequence) && m.release_sequence > 0, 'release_sequence: positive integer required');
  keys(m.source, ['repository', 'commit', 'tree', 'ref', 'event'], 'source');
  requireThat(typeof m.source.repository === 'string' && /^[\w.-]+\/[\w.-]+$/.test(m.source.repository), 'source.repository: owner/repo required');
  for (const k of ['commit', 'tree']) requireThat(typeof m.source[k] === 'string' && oid.test(m.source[k]), `source.${k}: full Git SHA required`);
  requireThat(text(m.source.ref) && m.source.ref.startsWith('refs/'), 'source.ref: full ref required');
  requireThat(['push', 'pull_request', 'workflow_dispatch'].includes(m.source.event), 'source.event: push, pull_request or workflow_dispatch required');
  keys(m.contracts, ['manifest_revision', 'contract_set_sha256', 'contracts_json_sha256'], 'contracts');
  requireThat(Number.isSafeInteger(m.contracts.manifest_revision) && m.contracts.manifest_revision > 0, 'contracts.manifest_revision: positive integer required');
  for (const [name, value] of Object.entries({ closure_sha256: m.closure_sha256,
    'contracts.contract_set_sha256': m.contracts.contract_set_sha256, 'contracts.contracts_json_sha256': m.contracts.contracts_json_sha256 })) {
    requireThat(typeof value === 'string' && hex.test(value), `${name}: lowercase SHA256 required`);
  }
  keys(m.image, ['digest', 'index_digest', 'config_digest', 'platform', 'base_image'], 'image');
  keys(m.sbom, ['format', 'digest'], 'sbom');
  keys(m.provenance, ['format', 'digest'], 'provenance');
  for (const [name, value] of Object.entries({ 'image.digest': m.image.digest, 'image.index_digest': m.image.index_digest,
    'image.config_digest': m.image.config_digest, 'sbom.digest': m.sbom.digest, 'provenance.digest': m.provenance.digest })) {
    requireThat(typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value), `${name}: sha256 digest required`);
  }
  requireThat(m.image.platform === 'linux/amd64', 'image.platform: expected linux/amd64');
  requireThat(typeof m.image.base_image === 'string' && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(m.image.base_image), 'image.base_image: immutable base required');
  requireThat(m.sbom.format === SBOM_FORMAT, 'sbom.format: expected SPDX in-toto predicate');
  requireThat(PROVENANCE_FORMATS.includes(m.provenance.format), 'provenance.format: expected SLSA v0.2 or v1 in-toto predicate');
  keys(m.reproducible, ['checked', 'identical'], 'reproducible');
  requireThat(typeof m.reproducible.checked === 'boolean' && (m.reproducible.checked ?
    typeof m.reproducible.identical === 'boolean' : m.reproducible.identical === null), 'reproducible: unchecked requires null, checked requires boolean');
  keys(m.validation_run, ['id', 'attempt', 'workflow', 'url', 'jobs'], 'validation_run');
  for (const k of ['id', 'attempt']) requireThat(typeof m.validation_run[k] === 'string' && /^[1-9]\d*$/.test(m.validation_run[k]), `validation_run.${k}: positive decimal string required`);
  requireThat(text(m.validation_run.workflow), 'validation_run.workflow: name required');
  let url;
  try { url = new URL(m.validation_run.url); } catch { throw new Error('validation_run.url: valid URL required'); }
  requireThat(url.protocol === 'https:' && url.origin === 'https://github.com' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === `/${m.source.repository}/actions/runs/${m.validation_run.id}`, 'validation_run.url: must identify this repository and run');
  requireThat(JSON.stringify(m.validation_run.jobs) === JSON.stringify(JOBS), 'validation_run.jobs: package, browser, docker required');
  requireThat(typeof m.generated_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.generated_at) &&
    Number.isFinite(Date.parse(m.generated_at)) && new Date(m.generated_at).toISOString() === m.generated_at, 'generated_at: UTC instant required');
  return m;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function readCommitMetadata(root, commit) {
  requireThat(typeof commit === 'string' && oid.test(commit), 'source.commit: full Git SHA required');
  try { requireThat(git(root, ['cat-file', '-t', commit]).toString().trim() === 'commit', 'source.commit: not a commit'); }
  catch { throw new Error('source.commit: commit does not exist locally'); }
  const blob = name => git(root, ['show', `${commit}:${name}`]);
  const json = name => JSON.parse(blob(name));
  const release = json('release.json'), prep = json('release/preparation.json');
  for (const k of ['version', 'version_scheme', 'release_channel', 'release_sequence']) {
    requireThat(release[k] === prep.reservation[k], `${k}: release.json and reservation disagree at commit`);
  }
  const contractBytes = blob('release/contracts.json'), contracts = JSON.parse(contractBytes);
  const entries = git(root, ['ls-tree', '-rz', '--full-tree', commit, '--', 'contracts/']).toString().split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t'), [mode, type] = line.slice(0, tab).split(' '), name = line.slice(tab + 1);
    requireThat(['100644', '100755'].includes(mode) && type === 'blob', 'contracts: regular files required');
    const bytes = blob(name);
    return { path: name, size: bytes.length, sha256: sha256(bytes) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const contractSet = sha256(JSON.stringify(entries));
  requireThat(entries.length > 0 && contractSet === contracts.contract_set_sha256, 'contracts.contract_set_sha256: committed contracts/ do not match');
  const manifest = json('contracts/manifest.json');
  requireThat(manifest.revision === contracts.manifest_revision, 'contracts.manifest_revision: committed manifest disagrees');
  const pin = blob('scripts/check-release.mjs').toString().match(/^export const CLOSURE_SHA256 = '([a-f0-9]{64})';$/m)?.[1];
  requireThat(pin && pin === sha256(blob('release/closure.json')), 'closure_sha256: committed closure does not match CLOSURE_SHA256 pin');
  return {
    release, tree: git(root, ['rev-parse', `${commit}^{tree}`]).toString().trim(),
    contracts: { manifest_revision: manifest.revision, contract_set_sha256: contractSet, contracts_json_sha256: sha256(contractBytes) },
    closure_sha256: pin, base_image: prep.runtime.image,
  };
}

export function verifyReleaseSet(manifest, { root = process.cwd(), commit } = {}) {
  validateReleaseSet(manifest);
  if (commit !== undefined) requireThat(oid.test(commit) && commit === manifest.source.commit, '--commit: does not match source.commit (full SHA required)');
  const expected = readCommitMetadata(root, manifest.source.commit);
  requireThat(manifest.source.tree === expected.tree, 'source.tree: does not match commit tree');
  for (const k of ['version', 'version_scheme', 'release_channel', 'release_sequence']) requireThat(manifest[k] === expected.release[k], `${k}: does not match committed reservation`);
  for (const k of Object.keys(expected.contracts)) requireThat(manifest.contracts[k] === expected.contracts[k], `contracts.${k}: does not match commit`);
  requireThat(manifest.closure_sha256 === expected.closure_sha256, 'closure_sha256: does not match committed pin');
  requireThat(manifest.image.base_image === expected.base_image, 'image.base_image: does not match committed runtime pin');
  return manifest;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, flag, commit, ...extra] = process.argv.slice(2);
    requireThat(file && !extra.length && (flag === undefined || (flag === '--commit' && commit)), 'usage: verify-release-set.mjs <release-set.json> [--commit <sha>]');
    const manifest = verifyReleaseSet(JSON.parse(readFileSync(file)), { commit });
    console.log(`release-set: verified ${manifest.source.commit} (${manifest.version})`);
  } catch (error) { console.error(`release-set: ${error.message}`); process.exitCode = 1; }
}
