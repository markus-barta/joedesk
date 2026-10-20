#!/usr/bin/env node
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function setDeploymentPins(manifest, args) {
  const names = { '--producer': 'producer', '--pusher': 'pusher', '--executor': 'executor' };
  const pins = new Map();
  const usage = 'pin_usage: expected at least one of --producer <sha40>, --pusher <sha40>, --executor <sha40>; each pin must be a 40-hex nixcfg commit';
  if (!args.length || args.length % 2) throw new Error(usage);
  for (let i = 0; i < args.length; i += 2) {
    const name = Object.hasOwn(names, args[i]) ? names[args[i]] : null, sha = args[i + 1];
    if (!name || pins.has(name) || !/^[a-fA-F0-9]{40}$/.test(sha)) throw new Error(usage);
    pins.set(name, sha);
  }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (manifest?.schema !== 'joedesk.release-contracts.v1' || !object(manifest.participants))
    throw new Error('pin_manifest: expected release-contracts.v1 with participants');
  const output = structuredClone(manifest);
  for (const [name, deployment_pin] of pins) {
    // The release validator permits an additional participant. Only the Results
    // producer is introduced here; existing participants must never be invented.
    if (name === 'producer' && !Object.hasOwn(output.participants, name)) {
      if (!/^[a-f0-9]{64}$/.test(output.contract_set_sha256))
        throw new Error('pin_manifest: producer requires the active contract_set_sha256');
      output.participants.producer = {
        required_contract_set_sha256: output.contract_set_sha256,
        required_data_schema: 'inspr.joe.household.results.v2',
        deployment_pin: null,
        status: 'Amy JOED-20 real producer rehearsal/sign-off required',
      };
    }
    if (!Object.hasOwn(output.participants, name) || !object(output.participants[name]) ||
        !Object.hasOwn(output.participants[name], 'deployment_pin'))
      throw new Error(`pin_manifest: missing or invalid participants.${name}`);
    output.participants[name].deployment_pin = deployment_pin;
  }
  return output;
}

export function main(args, file = new URL('../release/contracts.json', import.meta.url)) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const output = setDeploymentPins(manifest, args);
  writeFileSync(file, JSON.stringify(output, null, 2) + '\n');
  console.log('deployment pins updated; next release closure must be prepared');
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`pins: ${/^pin_(usage|manifest):/.test(error.message) ? error.message : 'manifest read or update failed'}`);
    process.exitCode = 1;
  }
}
