#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { backupStore, restoreStore, migrateToV2, verifyBackup } from '../release/data-migration.mjs';

// Explicit offline opt-in and paths. No production defaults, switches or deletes.
const [command, offline, source, destination, schemaOrSnapshot, receivedAt] = process.argv.slice(2);
try {
  if (offline !== '--offline') throw new Error('offline_writers_must_be_stopped');
  let result;
  if (command === 'backup' && process.argv.length === 7) result = backupStore({ source, destination, boardSchema: schemaOrSnapshot });
  else if (command === 'restore' && process.argv.length === 7) result = restoreStore({ backup: source, destination, boardSchema: schemaOrSnapshot });
  else if (command === 'migrate-v2' && process.argv.length === 8) result = migrateToV2({ backup: source, destination, snapshot: JSON.parse(readFileSync(schemaOrSnapshot)), receivedAt });
  else if (command === 'verify' && process.argv.length === 5) result = { boardSchema: verifyBackup(source).boardSchema, verified: true };
  else throw new Error('usage');
  // Never print payloads, values, actor, filesystem paths or credentials.
  console.log(JSON.stringify(result));
} catch {
  console.error('Data preparation failed. Use backup|restore --offline SOURCE NEW_DEST v1|v2; migrate-v2 --offline V1_BACKUP NEW_DEST V2_SNAPSHOT UTC_RECEIPT; verify --offline BACKUP. Stop writers first. Existing destinations and incompatible schemas are refused.');
  process.exitCode = 1;
}
