// joedesk.adoption.v1: closed, value-free evidence recorded after live gates.
// Kept outside the runtime closure and Docker COPY set, like the records themselves.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, verifyReleaseSet } from './verify-release-set.mjs';

const coordinates = ['version', 'version_scheme', 'release_channel', 'release_sequence'];
const liveChecks = ['joed_live_check', 'ops_t76_live', 'smoke_release', 'spoof_check'];
const hex = /^[a-f0-9]{64}$/;
const oid = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const requireThat = (ok, reason) => { if (!ok) throw new Error(`adoption_${reason}`); };
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
function keys(value, expected, name) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${name}_keys`);
}
function instant(value, name) {
  const normalized = typeof value === 'string' && value.replace(/(?<=:\d\d)Z$/, '.000Z');
  requireThat(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(normalized)) && new Date(normalized).toISOString() === normalized, `${name}_invalid`);
}
export function validateAdoption(record) {
  keys(record, ['schema', ...coordinates, 'source', 'release_set_sha256', 'image_digest', 'contract_set_sha256',
    'validation_run_id', 'decisions', 'deployment', 'live_checks', 'markus_ui_look', 'adopted_at'], 'record');
  requireThat(record.schema === 'joedesk.adoption.v1', 'schema_invalid');
  for (const name of coordinates.slice(0, 3)) requireThat(text(record[name]), `${name}_invalid`);
  requireThat(Number.isSafeInteger(record.release_sequence) && record.release_sequence > 0, 'release_sequence_invalid');
  keys(record.source, ['commit', 'tree'], 'source');
  for (const name of ['commit', 'tree']) requireThat(typeof record.source[name] === 'string' && oid.test(record.source[name]), `source_${name}_invalid`);
  for (const name of ['release_set_sha256', 'contract_set_sha256']) requireThat(typeof record[name] === 'string' && hex.test(record[name]), `${name}_invalid`);
  requireThat(typeof record.image_digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(record.image_digest), 'image_digest_invalid');
  requireThat(typeof record.validation_run_id === 'string' && /^[1-9]\d*$/.test(record.validation_run_id), 'validation_run_id_invalid');
  requireThat(Array.isArray(record.decisions) && record.decisions.length > 0 &&
    record.decisions.every(id => typeof id === 'string' && uuid.test(id)) &&
    new Set(record.decisions).size === record.decisions.length, 'decisions_invalid');
  keys(record.deployment, ['deployed_at', 'operator_ticket', 'rollback_reference'], 'deployment');
  instant(record.deployment.deployed_at, 'deployment_deployed_at');
  requireThat(typeof record.deployment.operator_ticket === 'string' && /^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(record.deployment.operator_ticket), 'deployment_operator_ticket_invalid');
  requireThat(text(record.deployment.rollback_reference) && record.deployment.rollback_reference.length <= 500, 'deployment_rollback_reference_invalid');
  keys(record.live_checks, liveChecks, 'live_checks');
  for (const name of liveChecks) {
    keys(record.live_checks[name], ['status', 'checked_at'], `live_checks_${name}`);
    requireThat(record.live_checks[name].status === 'pass', `live_checks_${name}_status_invalid`);
    instant(record.live_checks[name].checked_at, `live_checks_${name}_checked_at`);
  }
  const look = record.markus_ui_look, delegated = look?.status === 'delegated';
  keys(look, ['status', 'checked_at', ...(delegated ? ['performed_by', 'delegation'] : [])], 'markus_ui_look');
  requireThat(look.status === 'confirmed' || delegated, 'markus_ui_look_status_invalid');
  instant(look.checked_at, 'markus_ui_look_checked_at');
  if (delegated) {
    requireThat(typeof look.performed_by === 'string' && /^[A-Z][A-Z0-9-]{1,31}$/.test(look.performed_by), 'markus_ui_look_performed_by_invalid');
    requireThat(text(look.delegation) && look.delegation.length <= 500, 'markus_ui_look_delegation_invalid');
  }
  instant(record.adopted_at, 'adopted_at');
  return record;
}

function readJSON(file, name) {
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) { throw new Error(`adoption_${name}_${error.code === 'ENOENT' ? 'missing' : 'unreadable'}`); }
  let value;
  try { value = JSON.parse(bytes); }
  catch { throw new Error(`adoption_${name}_invalid_json`); }
  return { bytes, value };
}
export function checkAdoption({ root, active, reservation, contractSet, releaseSet }) {
  const { value: record } = readJSON(path.join(root, 'adoption', `${active.version}.json`), 'record');
  validateAdoption(record);
  for (const name of coordinates) requireThat(record[name] === active[name] && record[name] === reservation[name], `${name}_mismatch`);
  requireThat(record.contract_set_sha256 === contractSet, 'contract_set_sha256_mismatch');
  if (fs.existsSync(path.join(root, '.git'))) {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let type;
    try { type = git(['cat-file', '-t', record.source.commit]); }
    catch { throw new Error('adoption_source_commit_missing'); }
    requireThat(type === 'commit', 'source_commit_invalid');
    requireThat(git(['rev-parse', `${record.source.commit}^{tree}`]) === record.source.tree, 'source_tree_mismatch');
    try { git(['merge-base', '--is-ancestor', record.source.commit, 'HEAD']); }
    catch { throw new Error('adoption_source_not_ancestor'); }
  }
  if (releaseSet !== undefined) {
    const { bytes, value: manifest } = readJSON(path.resolve(root, releaseSet), 'release_set');
    requireThat(sha256(bytes) === record.release_set_sha256, 'release_set_sha256_mismatch');
    try { verifyReleaseSet(manifest, { root, commit: record.source.commit }); }
    catch (error) {
      if (error.message === '--commit: does not match source.commit (full SHA required)') throw new Error('adoption_source_commit_mismatch');
      throw new Error('adoption_release_set_invalid');
    }
    requireThat(manifest.source.tree === record.source.tree, 'source_tree_mismatch');
    for (const name of coordinates) requireThat(manifest[name] === record[name], `${name}_mismatch`);
    requireThat(manifest.contracts.contract_set_sha256 === record.contract_set_sha256, 'contract_set_sha256_mismatch');
    requireThat(manifest.image.digest === record.image_digest, 'image_digest_mismatch');
    requireThat(manifest.validation_run.id === record.validation_run_id, 'validation_run_id_mismatch');
  }
  return record;
}
