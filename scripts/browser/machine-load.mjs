// Value-free host evidence, sampled before a budget attempt, outside its
// measured page work. Process inspection reads executable names, never argv.
import { spawnSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { basename } from 'node:path';

export function captureMachineLoad({ clock = () => new Date(), cpuList = cpus, load = loadavg, ps = spawnSync } = {}) {
  const processes = ps('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  const known = !processes.error && processes.status === 0 && typeof processes.stdout === 'string';
  return { sampledAt: clock().toISOString(), loadavg: load(), cpuCount: cpuList().length,
    browserProcesses: known ? processes.stdout.split('\n').filter(line =>
      /^(?:chrome(?:[-_].*)?|chromium(?:[-_].*)?|headless_shell|Google Chrome(?: Helper.*)?|Chromium(?: Helper.*)?)$/i.test(basename(line.trim()))).length : null };
}

export function machineLoadTable(traces, lock = process.env) {
  return `Browser host lock (one acquisition for all CI browser phases):

| State | Wait started (UTC) | Acquired (UTC) | Waited seconds |
| --- | --- | --- | --- |
| ${lock.JOED_BROWSER_LOCK_STATE ?? 'unavailable (outside CI wrapper)'} | ${lock.JOED_BROWSER_LOCK_WAIT_STARTED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_ACQUIRED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_WAIT_SECONDS ?? 'unavailable'} |

Machine load before each attempt (host-wide browser processes include this browser and its helpers; unavailable counts are not zero):

| Width | Phase | Attempt | Sampled (UTC) | Loadavg 1 / 5 / 15 min | Logical CPUs | Browser processes |
| --- | --- | --- | --- | --- | --- | --- |
${traces.map(r => {
    const m = r.machineLoad;
    return `| ${r.viewport} | ${r.phase} | ${r.attempt ?? 1}/${r.attempts ?? 1} | ${m?.sampledAt ?? 'unavailable'} | ${m?.loadavg.map(n => n.toFixed(2)).join(' / ') ?? 'unavailable'} | ${m?.cpuCount ?? 'unavailable'} | ${m?.browserProcesses ?? 'unavailable'} |`;
  }).join('\n')}
`;
}
