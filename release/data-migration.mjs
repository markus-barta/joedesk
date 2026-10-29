// Offline preparation only. Never mutates the source store or restores into
// an existing directory. OPS stops writers and selects compatible pins first.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { validateBoardSettings, BOARD_SETTINGS_MAX_BYTES } from '../server/board-settings.mjs';
import { validContinuity, CONTINUITY_CAP } from '../public/joe/history-continuity.js';
import { validateAccountHistory, ACCOUNT_HISTORY_FORMAT, ACCOUNT_HISTORY_CAP,
  validateAccountCloses, ACCOUNT_CLOSES_FORMAT, ACCOUNT_CLOSES_CAP } from '../server/account-history.mjs';
import { validInstant } from '../contracts/schema-validator.mjs';
import { inspectFleetConfig, normalizeFleetConfig, fleetInvalid, validateFleetActions,
  appendFleetNormalizationAudit } from '../server/fleet-normalization.mjs';

const FILES = {
  v1: ['data.json', 'history.json', 'fleet-config.json', 'fleet-config-actions.json'],
  v2: ['data-state.json', 'history-state.json', 'results-state.json', 'feed-rejections.json', 'fleet-receipt.json', 'fleet-config.json', 'fleet-config-actions.json',
    'board-settings.json', 'history-continuity.json', 'account-history-state.json', 'account-closes-state.json',
    'account-history-state.json.discontinuity.json', 'account-closes-state.json.discontinuity.json'],
};
const CAP = 16 * 1024 * 1024;
const DAMAGED_MAX = 64;
const ACCOUNT_STORES = [
  ['account-history-state.json', ACCOUNT_HISTORY_FORMAT, ACCOUNT_HISTORY_CAP, validateAccountHistory],
  ['account-closes-state.json', ACCOUNT_CLOSES_FORMAT, ACCOUNT_CLOSES_CAP, validateAccountCloses],
];
function damagedCopy(name) {
  if (typeof name !== 'string') return false;
  const account = /^(account-(?:history|closes)-state\.json)\.damaged-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)(?:-[1-9][0-9]*)?$/.exec(name);
  if (account?.[0] === name && validInstant(account[2])) return true;
  const continuity = /^history-continuity\.json\.damaged-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.exec(name);
  return continuity?.[0] === name;
}
function allowedFiles(boardSchema, names) {
  const allowed = FILES[boardSchema];
  return allowed && names.length <= allowed.length + (boardSchema === 'v2' ? DAMAGED_MAX : 0) &&
    names.filter(damagedCopy).length <= DAMAGED_MAX &&
    names.every(name => allowed.includes(name) || (boardSchema === 'v2' && damagedCopy(name)));
}
// account-store's validMarker is private. Check its persisted three-field shape
// with the shared instant validator and the exact names its writer generates.
function checkMarker(marker, store) {
  if (!marker || Object.keys(marker).length !== 3 || !validInstant(marker.at) ||
      marker.reason !== 'contract_invalid' || !damagedCopy(marker.preservedAs) ||
      !marker.preservedAs.startsWith(`${store}.damaged-`)) throw new Error('backup_schema_mismatch');
}
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
    if (files['results-state.json']) {
      const results = JSON.parse(files['results-state.json']);
      if (results.format !== 'joedesk.results-store.v2' || !validateContract('results', results.feed?.value).ok) throw new Error('backup_schema_mismatch');
    }
    const boundedJson = (name, cap) => {
      if (files[name].length > cap) throw new Error('backup_schema_mismatch');
      return JSON.parse(files[name]);
    };
    if (files['board-settings.json'] && validateBoardSettings(boundedJson('board-settings.json', BOARD_SETTINGS_MAX_BYTES))) throw new Error('backup_schema_mismatch');
    if (files['history-continuity.json'] && !validContinuity(boundedJson('history-continuity.json', CONTINUITY_CAP))) throw new Error('backup_schema_mismatch');
    for (const [name, format, cap, validate] of ACCOUNT_STORES) {
      if (files[name]) {
        const stored = boundedJson(name, cap);
        if (stored?.format !== format) throw new Error('backup_schema_mismatch');
        validate(stored.value);
        if (stored.discontinuity !== undefined) checkMarker(stored.discontinuity, name);
      }
      const journal = `${name}.discontinuity.json`;
      if (files[journal]) checkMarker(boundedJson(journal, 4096), name);
    }
  }
}
export function backupStore({ source, destination, boardSchema }) {
  directory(source);
  separateDestination(source, destination);
  const allowed = FILES[boardSchema];
  if (!allowed || path.resolve(source) === path.resolve(destination)) throw new Error('backup_schema_required');
  const names = fs.readdirSync(source).sort();
  if (!names.length || !allowedFiles(boardSchema, names)) throw new Error('backup_unexpected_file');
  // Read all bounded, allowlisted bytes before creating any output.
  let total = 0;
  const payloads = names.map(name => {
    const bytes = read(path.join(source, name));
    total += bytes.length;
    if (total > 2 * CAP) throw new Error('backup_size_limit');
    return { name, bytes };
  });
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
      new Set(manifest.files.map(f => f?.name)).size !== manifest.files.length ||
      !allowedFiles(manifest.boardSchema, manifest.files.map(f => f?.name))) throw new Error('backup_manifest_invalid');
  const expected = ['backup-manifest.json', ...manifest.files.map(f => f.name)].sort();
  if (JSON.stringify(fs.readdirSync(backup).sort()) !== JSON.stringify(expected)) throw new Error('backup_closure_mismatch');
  const payloads = {};
  let total = 0;
  for (const f of manifest.files) {
    const bytes = read(path.join(backup, f.name));
    if (bytes.length !== f.size || digest(bytes) !== f.sha256) throw new Error('backup_digest_mismatch');
    total += bytes.length;
    if (total > 2 * CAP) throw new Error('backup_size_limit');
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

function parseFleet(bytes) {
  try { return JSON.parse(bytes); }
  catch { throw fleetInvalid([{ path: '$', rule: 'json' }]); }
}

function parseFleetActions(bytes) {
  let log;
  try { log = JSON.parse(bytes); }
  catch { throw new Error('migration_fleet_actions_invalid'); }
  validateFleetActions(log);
  return log;
}

// Live-store preflight is deliberately read-only and needs no offline opt-in.
// A backup still has to pass its complete existing integrity checks.
export function checkFleet(source) {
  directory(source);
  if (fs.existsSync(path.join(source, 'backup-manifest.json'))) {
    if (verifyBackup(source).boardSchema !== 'v1') throw new Error('migration_requires_v1_backup');
  }
  const bytes = read(path.join(source, 'fleet-config.json'));
  let config, result;
  try { config = parseFleet(bytes); result = inspectFleetConfig(config); }
  catch (error) { result = { ok: false, added: [], errors: error.detail }; }
  let actionsOk = true;
  try {
    let log = { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] };
    try { log = parseFleetActions(read(path.join(source, 'fleet-config-actions.json'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (result.ok && result.added.length) {
      // Exercise the migration's exact normalization/audit validation in memory.
      // Reusing the stored receipt here does not write or freshen any evidence.
      const normalized = normalizeFleetConfig(config, config.updatedAt);
      appendFleetNormalizationAudit(log, config, normalized.value, normalized.value.updatedAt);
    }
  } catch { actionsOk = false; }
  return { ok: result.ok && actionsOk, added: result.added, errors: result.errors, actionsOk };
}

export function migrateToV2({ backup, destination, snapshot, receivedAt }) {
  const manifest = verifyBackup(backup);
  separateDestination(backup, destination);
  if (manifest.boardSchema !== 'v1') throw new Error('migration_requires_v1_backup');
  if (!validateContract('data', snapshot, { stage: 'ingress' }).ok) throw new Error('migration_requires_valid_v2_producer');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receivedAt ?? '') ||
      !Number.isFinite(Date.parse(receivedAt)) || new Date(receivedAt).toISOString() !== receivedAt) throw new Error('migration_receipt_required');
  let fleet = null, fleetBytes = null, originalFleet = null, changed = false;
  if (manifest.files.some(f => f.name === 'fleet-config.json')) {
    fleetBytes = read(path.join(backup, 'fleet-config.json'));
    originalFleet = parseFleet(fleetBytes);
    const normalized = normalizeFleetConfig(originalFleet, receivedAt);
    fleet = normalized.value;
    changed = normalized.added.length > 0;
    if (changed) fleetBytes = JSON.stringify(fleet, null, 2) + '\n';
  }
  let actions = null;
  if (manifest.files.some(f => f.name === 'fleet-config-actions.json')) {
    actions = read(path.join(backup, 'fleet-config-actions.json'));
    parseFleetActions(actions);
  }
  if (changed) {
    const log = actions ? JSON.parse(actions) : { schema: 'inspr.joe.fleet-config.actions.v1', entries: [] };
    actions = JSON.stringify(appendFleetNormalizationAudit(log, originalFleet, fleet, receivedAt), null, 2) + '\n';
  }
  fs.mkdirSync(destination, { mode: 0o700 });
  // Legacy money, history and receipt ages cannot be proven under v2. Leave
  // those bytes in the verified v1 backup. Begin v2 only from producer evidence.
  if (fleet) write(destination, 'fleet-config.json', fleetBytes);
  // Unchanged config/log retain exact bytes. Normalization uses the board's
  // bounded ring; the verified v1 backup retains the full original log bytes.
  if (actions) write(destination, 'fleet-config-actions.json', actions);
  const model = createReadModel({ dataDir: destination, clock: () => receivedAt });
  if (fleet && !model.observeFleet(fleet).ok) throw new Error('migration_fleet_failed');
  const result = model.accept(snapshot);
  if (!result.ok || result.historyReason) throw new Error('migration_acceptance_failed');
  const restarted = createReadModel({ dataDir: destination, clock: () => receivedAt });
  if (!restarted.hasData() || restarted.feeds().data.value.seq !== snapshot.seq || restarted.feeds().data.reason) throw new Error('migration_restart_failed');
  return { schema: CONTRACTS.contracts.data, seq: snapshot.seq, legacyHistory: 'preserved-in-v1-backup-only' };
}
