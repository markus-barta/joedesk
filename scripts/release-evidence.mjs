#!/usr/bin/env node
// Emits preparation evidence only. The coordinator adds built artifact digests,
// signatures and downstream compatibility before publishing a release set.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkRelease, CLOSURE_SHA256 } from './check-release.mjs';

try {
  checkRelease();
  const validationRun = process.argv[2];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(validationRun ?? '')) throw new Error('validation_run_required');
  const git = args => execFileSync('git', args, { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['status', '--porcelain']).length) throw new Error('clean_committed_source_required');
  const prep = JSON.parse(readFileSync(new URL('../release/preparation.json', import.meta.url)));
  const contracts = JSON.parse(readFileSync(new URL('../release/contracts.json', import.meta.url)));
  console.log(JSON.stringify({ schema: 'joedesk.release-evidence.v1', status: 'candidate-awaiting-coordinator-gates',
    source_commit: git(['rev-parse', 'HEAD']), source_tree: git(['rev-parse', 'HEAD^{tree}']),
    release: JSON.parse(readFileSync(new URL('../release.json', import.meta.url))), candidate: prep.reservation,
    runtime: prep.runtime, runtime_closure_sha256: CLOSURE_SHA256,
    preparation_sha256: createHash('sha256').update(readFileSync(new URL('../release/preparation.json', import.meta.url))).digest('hex'),
    contracts, validation_run: validationRun, published_artifacts: [], pending_gates: prep.gates }, null, 2));
} catch (error) { console.error(`release-evidence: ${error.message}`); process.exitCode = 1; }
