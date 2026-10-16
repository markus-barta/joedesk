// Offline preparation only. Never mutates the source store or restores into
// an existing directory. OPS stops writers and selects compatible pins first.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { checkSchema } from '../contracts/schema-validator.mjs';
import actionSchema from '../public/joe/fleet-config-actions.schema.json' with { type: 'json' };

// The bounded shared validator supports anyOf. Express the audit schema's
// two nullable revision types in that equivalent vocabulary.
const auditSchema = structuredClone(actionSchema);
for (const key of ['revBefore', 'revAfter']) {
  const field = auditSchema.$defs.action.properties[key];
  field.anyOf = field.type.map(type => ({ type }));
  delete field.type;
}

const FILES = {
  v1: ['data.json', 'history.json', 'fleet-config.json', 'fleet-config-actions.json'],
  v2: ['data-state.json', 'history-state.json', 'feed-rejections.json', 'fleet-receipt.json', 'fleet-config.json', 'fleet-config-actions.json'],
};
const CAP = 16 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function read(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > CAP) throw new Error('backup_file_invalid');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > CAP) throw new Error('backup_file_invalid');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function directory(dir) {
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error('directory_required');
}
function separateDestination(source, destination) {
  // Resolve the existing parent too: an ancestor symlink must not put a new
  // backup/stage inside the very store or backup it promises to preserve.
  const target = path.resolve(destination);
  const actual = path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  const relative = path.relative(fs.realpathSync(source), actual);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('destination_overlaps_source');
}
function write(dir, name, bytes) {
  const fd = fs.openSync(path.join(dir, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function finish(dir, manifest) {
  write(dir, 'backup-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return manifest;
}
function checkStoreSchema(boardSchema, files) {
  const dataName = boardSchema === 'v1' ? 'data.json' : 'data-state.json';
  if (!files[dataName]) throw new Error('backup_snapshot_required');
  const snapshot = JSON.parse(files[dataName]);
  if (boardSchema === 'v1') {
    if (snapshot.schema !== 'inspr.joe.household.v1') throw new Error('backup_schema_mismatch');
    if (files['history.json'] && JSON.parse(files['history.json']).schema !== 'inspr.joe.household.history.v1') throw new Error('backup_schema_mismatch');
  } else {
    if (snapshot.format !== 'joedesk.data-store.v2' || !validateContract('data', snapshot.feed?.value).ok) throw new Error('backup_schema_mismatch');
    if (files['history-state.json']) {
      const history = JSON.parse(files['history-state.json']);
      if (history.format !== 'joedesk.history-store.v2' || !validateContract('history', history.value).ok) throw new Error('backup_schema_mismatch');
    }
  }
}
export function backupStore({ source, destination, boardSchema }) {
  directory(source);
  separateDestination(source, destination);
  const allowed = FILES[boardSchema];
  if (!allowed || path.resolve(source) === path.resolve(destination)) throw new Error('backup_schema_required');
  const names = fs.readdirSync(source).sort();
  if (!names.length || names.some(n => !allowed.includes(n))) throw new Error('backup_unexpected_file');
  // Read all bounded, allowlisted bytes before creating any output.
  const payloads = names.map(name => ({ name, bytes: read(path.join(source, name)) }));
  if (payloads.reduce((n, p) => n + p.bytes.length, 0) > 2 * CAP) throw new Error('backup_size_limit');
  const byName = Object.fromEntries(payloads.map(p => [p.name, p.bytes]));
  checkStoreSchema(boardSchema, byName);
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const p of payloads) write(destination, p.name, p.bytes);
  return finish(destination, { schema: 'joedesk.data-backup.v1', boardSchema, files: payloads.map(p => ({ name: p.name, size: p.bytes.length, sha256: digest(p.bytes) })) });
}
export function verifyBackup(backup) {
  directory(backup);
  const manifest = JSON.parse(read(path.join(backup, 'backup-manifest.json')));
  const allowed = FILES[manifest.boardSchema];
  if (manifest.schema !== 'joedesk.data-backup.v1' || !allowed || !Array.isArray(manifest.files) || !manifest.files.length ||
      manifest.files.length > allowed.length || new Set(manifest.files.map(f => f.name)).size !== manifest.files.length ||
      manifest.files.some(f => !allowed.includes(f.name))) throw new Error('backup_manifest_invalid');
  const expected = ['backup-manifest.json', ...manifest.files.map(f => f.name)].sort();
  if (JSON.stringify(fs.readdirSync(backup).sort()) !== JSON.stringify(expected)) throw new Error('backup_closure_mismatch');
  const payloads = {};
  for (const f of manifest.files) {
    const bytes = read(path.join(backup, f.name));
    if (bytes.length !== f.size || digest(bytes) !== f.sha256) throw new Error('backup_digest_mismatch');
    payloads[f.name] = bytes;
  }
  checkStoreSchema(manifest.boardSchema, payloads);
  return manifest;
}
export function restoreStore({ backup, destination, boardSchema }) {
  const manifest = verifyBackup(backup);
  separateDestination(backup, destination);
  if (boardSchema !== manifest.boardSchema) throw new Error('rollback_data_incompatible');
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const f of manifest.files) write(destination, f.name, read(path.join(backup, f.name)));
  return { boardSchema, files: manifest.files.length };
}
export function migrateToV2({ backup, destination, snapshot, receivedAt }) {
  const manifest = verifyBackup(backup);
  separateDestination(backup, destination);
  if (manifest.boardSchema !== 'v1') throw new Error('migration_requires_v1_backup');
  if (!validateContract('data', snapshot, { stage: 'ingress' }).ok) throw new Error('migration_requires_valid_v2_producer');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receivedAt ?? '') ||
      !Number.isFinite(Date.parse(receivedAt)) || new Date(receivedAt).toISOString() !== receivedAt) throw new Error('migration_receipt_required');
  let fleet = null, fleetBytes = null;
  if (manifest.files.some(f => f.name === 'fleet-config.json')) {
    fleetBytes = read(path.join(backup, 'fleet-config.json'));
    fleet = JSON.parse(fleetBytes);
    if (!validateContract('fleet-config', fleet).ok) throw new Error('migration_fleet_invalid');
  }
  let actions = null;
  if (manifest.files.some(f => f.name === 'fleet-config-actions.json')) {
    actions = read(path.join(backup, 'fleet-config-actions.json'));
    const errors = [];
    checkSchema(auditSchema, JSON.parse(actions), {}, errors);
    if (errors.length) throw new Error('migration_fleet_actions_invalid');
  }
  fs.mkdirSync(destination, { mode: 0o700 });
  // Legacy money, history and receipt ages cannot be proven under v2. Leave
  // those bytes in the verified v1 backup. Begin v2 only from producer evidence.
  if (fleet) write(destination, 'fleet-config.json', fleetBytes);
  // Same audited format in both boards: preserve ordering, pending/failure
  // entries and the original serialization byte-for-byte, without truncation.
  if (actions) write(destination, 'fleet-config-actions.json', actions);
  const model = createReadModel({ dataDir: destination, clock: () => receivedAt });
  if (fleet && !model.observeFleet(fleet).ok) throw new Error('migration_fleet_failed');
  const result = model.accept(snapshot);
  if (!result.ok || result.historyReason) throw new Error('migration_acceptance_failed');
  const restarted = createReadModel({ dataDir: destination, clock: () => receivedAt });
  if (!restarted.hasData() || restarted.feeds().data.value.seq !== snapshot.seq || restarted.feeds().data.reason) throw new Error('migration_restart_failed');
  return { schema: CONTRACTS.contracts.data, seq: snapshot.seq, legacyHistory: 'preserved-in-v1-backup-only' };
}
