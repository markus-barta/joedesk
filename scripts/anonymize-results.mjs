#!/usr/bin/env node
// Offline only. Diagnostics contain paths/counts, never payloads or I/O errors.
import { openSync, closeSync, fchmodSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { SCHEMAS, SCHEMA_FILES, validateContract } from '../contracts/index.mjs';
import { resolveRef } from '../contracts/schema-validator.mjs';

export class ResultsFixtureError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

const common = SCHEMA_FILES['common.schema.json'].$defs;
const trade = SCHEMAS.results.properties.trades.items.properties;
// Every free-form schema string needs an explicit decision. New strings do not
// silently become safe when a producer vendors a later contract revision.
const identifying = new Map([
  [trade.id, 'rt-anon'], [trade.company, 'company'],
  [trade.fx.properties.source, 'source'], [common.fx.properties.source, 'source'],
]);
const values = new Set([
  common.date, common.instant, common.decimal, common.money.properties.currency,
  common.fx.properties.base, common.fx.properties.rate,
  trade.symbol, trade.fx.properties.base, trade.fx.properties.rate,
]);

function schemaPolicies() {
  const policies = new Map(), paths = new Set();
  function visit(schema, root, path) {
    paths.add(path);
    if (schema.$ref) {
      const ref = resolveRef(schema.$ref, root, SCHEMA_FILES);
      visit(ref.schema, ref.root, path);
    }
    if (schema.type === 'string' || typeof schema.const === 'string' || schema.enum?.some(v => typeof v === 'string')) {
      const policy = identifying.get(schema) ??
        (values.has(schema) || schema.enum || typeof schema.const === 'string' ? 'keep' : 'unknown');
      policies.set(path, policy);
    }
    for (const [key, field] of Object.entries(schema.properties ?? {})) visit(field, root, `${path}.${key}`);
    if (schema.items) visit(schema.items, root, `${path}[]`);
    for (const branch of [...schema.anyOf ?? [], ...schema.allOf ?? []]) visit(branch, root, path);
  }
  visit(SCHEMAS.results, SCHEMAS.results, '$');
  return { policies, paths };
}

const { policies, paths } = schemaPolicies();
export function resultsStringPolicies() { return new Map(policies); }
function walk(value, string, path = '$', shape = '$') {
  if (typeof value === 'string') return string(value, path, shape);
  if (Array.isArray(value)) return value.map((v, i) => walk(v, string, `${path}[${i}]`, `${shape}[]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) =>
    [key, walk(v, string, `${path}.${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`, `${shape}.${key}`)]));
  return value;
}

function validate(value) {
  // The producer emits ingress; captured board responses carry a server receipt.
  const stage = Object.hasOwn(value ?? {}, 'receivedAt') ? 'served' : 'ingress';
  const result = validateContract('results', value, { stage });
  // Unknown strings take precedence over the contract rejection so the operator
  // gets the precise unclassified path. Unknown numeric fields remain invalid.
  walk(value, (v, path, shape) => {
    if (!paths.has(shape) || policies.get(shape) === 'unknown')
      throw new ResultsFixtureError(`unclassified string at ${path}`);
    return v;
  });
  if (!result.ok) throw new ResultsFixtureError('invalid results contract at $', 2);
}

export function nonIdentifyingProjection(value) {
  return walk(value, (v, path, shape) => {
    const policy = policies.get(shape);
    if (!policy || policy === 'unknown') throw new ResultsFixtureError(`unclassified string at ${path}`);
    return policy === 'keep' ? v : null;
  });
}

export function anonymizeResults(value) {
  validate(value);
  const tokens = new Map();
  let replacements = 0;
  const output = walk(value, (v, path, shape) => {
    const policy = policies.get(shape);
    if (policy === 'keep') return v;
    if (!tokens.has(policy)) tokens.set(policy, new Map());
    const group = tokens.get(policy);
    if (!group.has(v)) group.set(v, `${policy}-${group.size + 1}`);
    const token = group.get(v);
    if (v !== token) replacements++;
    return token;
  });
  validate(output);
  if (!isDeepStrictEqual(nonIdentifyingProjection(value), nonIdentifyingProjection(output)))
    throw new ResultsFixtureError('projection mismatch at $');
  return { output, replacements };
}

export function assertAlreadyAnonymous(value) {
  // A closed schema plus exact canonical tokens is stronger than attempting to
  // enumerate account masks, broker ids, personal names and host name patterns.
  const { output } = anonymizeResults(value);
  walk(value, (v, path, shape) => {
    if (policies.get(shape) !== 'keep' && !isDeepStrictEqual(v, getAtShape(output, path)))
      throw new ResultsFixtureError(`identifier at ${path}`);
    return v;
  });
  return true;
}

function getAtShape(value, path) {
  return path.slice(2).replace(/\[(\d+)\]/g, '.$1').split('.').reduce((v, key) => v?.[key], value);
}

export function readResults(file) {
  let bytes;
  try { bytes = readFileSync(file, 'utf8'); }
  catch { throw new ResultsFixtureError('input read failed at $'); }
  try { return JSON.parse(bytes); }
  catch { throw new ResultsFixtureError('invalid JSON at $', 2); }
}

export function main(args) {
  if (args.length === 2 && args[0] === '--check') {
    assertAlreadyAnonymous(readResults(args[1]));
    console.log('anonymous check passed at $');
    return;
  }
  if (args.length !== 2 || args.some(a => a.startsWith('--')))
    throw new ResultsFixtureError('usage: anonymize-results.mjs <in.json> <out.json> | --check <in.json>');
  const { output, replacements } = anonymizeResults(readResults(args[0]));
  let fd;
  try {
    // Refuse existing outputs, symlinks and accidental in-place sanitization.
    fd = openSync(args[1], 'wx', 0o600);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, JSON.stringify(output, null, 2) + '\n');
  } catch { throw new ResultsFixtureError('output write failed at $'); }
  finally { if (fd !== undefined) closeSync(fd); }
  console.log(`anonymized strings: ${replacements}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof ResultsFixtureError ? error.message : 'anonymization failed at $');
    process.exitCode = error instanceof ResultsFixtureError ? error.exitCode : 1;
  }
}
