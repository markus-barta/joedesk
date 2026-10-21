#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { backupStore, restoreStore, migrateToV2, verifyBackup, checkFleet } from '../release/data-migration.mjs';

// Explicit offline opt-in and paths. No production defaults, switches or deletes.
const [command, offline, source, destination, schemaOrSnapshot, receivedAt] = process.argv.slice(2);
const errorList = errors => errors.map(({ path, rule }) => `${path}/${rule}`).join(', ');
try {
  if (command === 'check-fleet' && process.argv.length === 4) {
    const result = checkFleet(offline);
    if (result.errors.length) {
      console.log(`fleet invalid: ${errorList(result.errors)}`);
    } else if (result.added.length) console.log(`fleet normalizable (keep: ${result.added.map(symbol => '+' + symbol).join(' ')})`);
    else console.log('fleet ok');
    console.log(result.actionsOk ? 'actions ok' : 'actions invalid');
    if (!result.ok) process.exitCode = 1;
  } else {
    if (offline !== '--offline') throw new Error('offline_writers_must_be_stopped');
    let result;
    if (command === 'backup' && process.argv.length === 7) result = backupStore({ source, destination, boardSchema: schemaOrSnapshot });
    else if (command === 'restore' && process.argv.length === 7) result = restoreStore({ backup: source, destination, boardSchema: schemaOrSnapshot });
    else if (command === 'migrate-v2' && process.argv.length === 8) result = migrateToV2({ backup: source, destination, snapshot: JSON.parse(readFileSync(schemaOrSnapshot)), receivedAt });
    else if (command === 'verify' && process.argv.length === 5) result = { boardSchema: verifyBackup(source).boardSchema, verified: true };
    else throw new Error('usage');
    // Never print payloads, values, actor, filesystem paths or credentials.
    console.log(JSON.stringify(result));
  }
} catch (error) {
  // Raw JSON/OS exception messages can contain private bytes and paths. Only
  // application codes, fixed OS codes and validator path/rule pairs may escape.
  const code = /^[a-z][a-z0-9_]*$/.test(error.message) ? error.message
    : error instanceof SyntaxError ? 'input_json_invalid'
    : /^[A-Z][A-Z0-9_]*$/.test(error.code) ? error.code : 'data_preparation_failed';
  const detail = code === 'migration_fleet_invalid' ? `: ${errorList(error.detail)}` : '';
  console.error(`Data preparation failed: ${code}${detail}`);
  process.exitCode = 1;
}
