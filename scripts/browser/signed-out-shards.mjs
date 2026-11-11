// JOED-190: runs the full signed-out matrix as parallel shard processes of
// signed-out-pages.mjs. Each shard owns its own fixture server and headless
// browser; the merge proves that every planned case ran exactly once.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mergeSignedOutShards } from '../signed-out-plan.mjs';

const pagesScript = fileURLToPath(new URL('./signed-out-pages.mjs', import.meta.url));
const minutes = since => ((Date.now() - since) / 60000).toFixed(1);

function prefixLines(input, output, label) {
  createInterface({ input, crlfDelay: Infinity }).on('line', line => output.write(`[${label}] ${line}\n`));
}

function runShard(script, index, count, report) {
  const label = `shard ${index}/${count}`, started = Date.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script, '--full', '--shard', `${index}/${count}`, '--report', report],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    prefixLines(child.stdout, process.stdout, label);
    prefixLines(child.stderr, process.stderr, label);
    child.on('error', error => resolve({ label, report, code: 1, error: error.message, minutes: minutes(started) }));
    child.on('close', (code, signal) => resolve({ label, report, code: code ?? 1, signal, minutes: minutes(started) }));
  });
}

export async function runSignedOutShards({ count, plan, shapes, endpoints, script = pagesScript }) {
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'joedesk-signed-out-shards-'));
  const started = Date.now();
  let peak = loadavg()[0];
  const sampler = setInterval(() => { peak = Math.max(peak, loadavg()[0]); }, 5000);
  sampler.unref();
  try {
    console.log(`Signed-out matrix: full; ${plan.caseCount} planned cases in ${count} parallel shards`);
    const results = await Promise.all(Array.from({ length: count }, (_, i) => runShard(script, i + 1, count, join(dir, `shard-${i + 1}.json`))));
    peak = Math.max(peak, loadavg()[0]);
    console.log(`Signed-out shards: ${results.map(r => `${r.label} ${r.minutes} min exit ${r.signal ?? r.code}`).join('; ')}; wall ${minutes(started)} min; peak load1 ${peak.toFixed(2)}`);
    const failed = results.filter(r => r.code !== 0);
    if (failed.length) {
      console.error(`Signed-out shards failed: ${failed.map(r => `${r.label}${r.error ? ` (${r.error})` : ''}`).join(', ')}`);
      return 1;
    }
    const total = mergeSignedOutShards(plan, results.map(r => JSON.parse(readFileSync(r.report, 'utf8'))), { shapes, endpoints });
    console.log(`${total} signed-out browser cases passed across ${count} shards, each exactly once; all native auth shapes exercised on every transport`);
    return 0;
  } catch (error) {
    console.error(`Signed-out shard merge failed: ${error.message}`);
    return 1;
  } finally {
    clearInterval(sampler);
    rmSync(dir, { recursive: true, force: true });
  }
}
