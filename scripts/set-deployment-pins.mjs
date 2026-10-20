#!/usr/bin/env node
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function setDeploymentPins(manifest, args) {
  const names = { '--producer': 'results', '--pusher': 'pusher', '--executor': 'executor' };
  const pins = new Map();
  if (!args.length || args.length % 2) throw new Error('pin_usage');
  for (let i = 0; i < args.length; i += 2) {
    const name = Object.hasOwn(names, args[i]) ? names[args[i]] : null, sha = args[i + 1];
    if (!name || pins.has(name) || !/^[a-fA-F0-9]{40}$/.test(sha)) throw new Error('pin_usage');
    pins.set(name, sha);
  }
  if (!pins.has('results')) throw new Error('pin_usage');
  if (manifest?.schema !== 'joedesk.release-contracts.v1') throw new Error('pin_manifest');
  const output = structuredClone(manifest);
  output.producers ??= {};
  if (typeof output.producers !== 'object' || Array.isArray(output.producers)) throw new Error('pin_manifest');
  for (const [name, deployment_pin] of pins) {
    output.producers[name] ??= {};
    if (typeof output.producers[name] !== 'object' || Array.isArray(output.producers[name])) throw new Error('pin_manifest');
    output.producers[name].deployment_pin = deployment_pin;
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
  catch { console.error('pins: expected --producer <sha40> [--pusher <sha40>] [--executor <sha40>]; update failed'); process.exitCode = 1; }
}
