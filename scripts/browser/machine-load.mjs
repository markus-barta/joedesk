// Value-free host evidence, sampled before a budget attempt, outside its
// measured page work. Process inspection reads executable names, never argv.
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { basename } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Only the runners' timing-only CI retry branch calls this helper. Load
// polling stays outside measured page work and never inspects process argv.
export async function waitForQuietHost({ load = os.loadavg, parallelism = os.availableParallelism,
  cpuList = os.cpus, now = () => performance.now(), sleep = setTimeout } = {}) {
  const threshold = (typeof parallelism === 'function' ? parallelism() : cpuList().length) / 2;
  const started = now(), startLoad1 = load()[0];
  let load1 = startLoad1;
  while (load1 > threshold) {
    const remaining = 300_000 - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(5000, remaining));
    load1 = load()[0];
  }
  return { waitedSeconds: (now() - started) / 1000, quiet: load1 <= threshold, threshold, startLoad1 };
}

export function quietWaitCells(wait) {
  return wait ? ` ${wait.waitedSeconds.toFixed(1)} | ${wait.quiet ? 'yes' : 'no'} | ${wait.threshold} | ${wait.startLoad1.toFixed(2)} |`
    : ' — | — | — | — |';
}

export function captureMachineLoad({ clock = () => new Date(), cpuList = os.cpus, load = os.loadavg, ps = spawnSync } = {}) {
  const processes = ps('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  const known = !processes.error && processes.status === 0 && typeof processes.stdout === 'string';
  return { sampledAt: clock().toISOString(), loadavg: load(), cpuCount: cpuList().length,
    browserProcesses: known ? processes.stdout.split('\n').filter(line =>
      /^(?:chrome(?:[-_].*)?|chromium(?:[-_].*)?|headless_shell|Google Chrome(?: Helper.*)?|Chromium(?: Helper.*)?)$/i.test(basename(line.trim()))).length : null };
}

export function machineLoadTable(traces, lock = process.env) {
  return `Browser host lock (one acquisition for all CI browser phases):

| State | Wait started (UTC) | Acquired (UTC) | Waited seconds | Reason |
| --- | --- | --- | --- | --- |
| ${lock.JOED_BROWSER_LOCK_STATE ?? 'unavailable (outside CI wrapper)'} | ${lock.JOED_BROWSER_LOCK_WAIT_STARTED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_ACQUIRED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_WAIT_SECONDS ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_REASON || 'none recorded'} |

Machine load before each attempt (host-wide browser processes include this browser and its helpers; unavailable counts are not zero):

| Width | Phase | Attempt | Quiet wait seconds | Quiet reached | Quiet threshold (load1) | Wait start load1 | Sampled (UTC) | Loadavg 1 / 5 / 15 min | Logical CPUs | Browser processes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${traces.map(r => {
    const m = r.machineLoad;
    return `| ${r.viewport} | ${r.phase} | ${r.attempt ?? 1}/${r.attempts ?? 1} |${quietWaitCells(r.quietWait)} ${m?.sampledAt ?? 'unavailable'} | ${m?.loadavg.map(n => n.toFixed(2)).join(' / ') ?? 'unavailable'} | ${m?.cpuCount ?? 'unavailable'} | ${m?.browserProcesses ?? 'unavailable'} |`;
  }).join('\n')}
`;
}
