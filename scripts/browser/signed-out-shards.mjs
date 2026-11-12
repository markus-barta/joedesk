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
  if (input) createInterface({ input, crlfDelay: Infinity }).on('line', line => output.write(`[${label}] ${line}\n`));
}

const KILL_AFTER_MS = 10000;
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };

// Each shard leads its own process group, which also holds its Chromium and
// helpers. A shard counts as finished only once its whole group is gone.
const groupAlive = pgid => {
  try { process.kill(-pgid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
const signalGroup = (pgid, signal) => {
  if (pgid === undefined) return;
  try { process.kill(-pgid, signal); } catch {}
};
const waitGroupGone = (pgid, ms) => new Promise(resolve => {
  const end = Date.now() + ms;
  const poll = setInterval(() => {
    if (!groupAlive(pgid)) { clearInterval(poll); resolve(true); }
    else if (Date.now() >= end) { clearInterval(poll); resolve(false); }
  }, 50);
});
async function drainGroup(pgid, killAfterMs) {
  if (pgid === undefined || !groupAlive(pgid)) return true;
  signalGroup(pgid, 'SIGTERM');
  if (await waitGroupGone(pgid, killAfterMs)) return true;
  signalGroup(pgid, 'SIGKILL');
  return waitGroupGone(pgid, killAfterMs);
}

// Never rejects: a shard that cannot start resolves as failed and calls
// onStartFailure, so the runner stops and awaits the shards already running.
function runShard(spawnShard, script, index, count, report, children, onStartFailure, killAfterMs) {
  const label = `shard ${index}/${count}`, started = Date.now();
  return new Promise(resolve => {
    let child, settled = false;
    const done = result => {
      if (settled) return;
      settled = true; children.delete(child);
      resolve({ label, report, minutes: minutes(started), ...result });
    };
    try {
      child = spawnShard(process.execPath, [script, '--full', '--shard', `${index}/${count}`, '--report', report],
        { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: true });
    } catch (error) {
      onStartFailure(label); done({ code: 1, error: error.message }); return;
    }
    children.add(child);
    // Handlers first. A failed spawn (no pid) reports 'error' and may never
    // close; any other 'error' (e.g. a failed kill) waits for 'close'.
    child.on('error', error => {
      if (child.pid !== undefined) { console.error(`[${label}] ${error.message}`); return; }
      onStartFailure(label); done({ code: 1, error: error.message });
    });
    // After the shard exits, stop whatever its group left behind (a browser
    // still shutting down) and wait until the group is empty.
    child.on('close', async (code, signal) => {
      const drained = await drainGroup(child.pid, killAfterMs);
      done(drained ? { code: code ?? 1, signal } : { code: 1, signal, error: 'process group did not exit' });
    });
    try {
      prefixLines(child.stdout, process.stdout, label);
      prefixLines(child.stderr, process.stderr, label);
    } catch (error) {
      onStartFailure(label); signalGroup(child.pid, 'SIGKILL');
    }
  });
}

// Cancellation (SIGINT/SIGTERM to this process, or `signal` aborting) signals
// every shard's process group (SIGKILL after killAfterMs), waits until every
// group is empty, cleans up and fails the phase, so no shard browser can still
// run when the next CI phase starts.
export async function runSignedOutShards({ count, plan, shapes, endpoints, script = pagesScript, signal, spawnShard = spawn, killAfterMs = KILL_AFTER_MS }) {
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'joedesk-signed-out-shards-'));
  const started = Date.now(), children = new Set();
  let peak = loadavg()[0], cancelled = null, killTimer = null;
  const sampler = setInterval(() => { peak = Math.max(peak, loadavg()[0]); }, 5000);
  sampler.unref();
  const cancel = reason => {
    if (cancelled) return;
    cancelled = reason;
    console.error(`Signed-out shards: ${reason}; stopping ${children.size} running shard(s)`);
    for (const child of children) signalGroup(child.pid, 'SIGTERM');
    killTimer = setTimeout(() => { for (const child of children) signalGroup(child.pid, 'SIGKILL'); }, killAfterMs);
  };
  const onSigint = () => cancel('SIGINT'), onSigterm = () => cancel('SIGTERM'), onAbort = () => cancel('aborted');
  process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    console.log(`Signed-out matrix: full; ${plan.caseCount} planned cases in ${count} parallel shards`);
    const results = await Promise.all(Array.from({ length: count }, (_, i) => cancelled
      ? Promise.resolve({ label: `shard ${i + 1}/${count}`, code: 1, signal: 'not started', minutes: '0.0' })
      : runShard(spawnShard, script, i + 1, count, join(dir, `shard-${i + 1}.json`), children, label => cancel(`${label} failed to start`), killAfterMs)));
    peak = Math.max(peak, loadavg()[0]);
    console.log(`Signed-out shards: ${results.map(r => `${r.label} ${r.minutes} min exit ${r.signal ?? r.code}`).join('; ')}; wall ${minutes(started)} min; peak load1 ${peak.toFixed(2)}`);
    if (cancelled) {
      console.error(`Signed-out shards cancelled (${cancelled}); every shard and its browser processes have exited`);
      return SIGNAL_EXIT[cancelled] ?? 1;
    }
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
    clearInterval(sampler); clearTimeout(killTimer);
    process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);
    signal?.removeEventListener('abort', onAbort);
    rmSync(dir, { recursive: true, force: true });
  }
}
