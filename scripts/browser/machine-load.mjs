// Value-free host evidence, sampled before a budget attempt, outside its
// measured page work. Process inspection reads executable names, never argv.
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { quietWaitBudget, QUIET_WAIT_SECONDS } from './quiet-wait-budget.mjs';
import { probeCell } from './reference-probe.mjs';
import { ratioCells } from './ratio-guard.mjs';

// Only the runners' timing-only CI retry branch calls this helper. Load
// polling stays outside measured page work and never inspects process argv.
export async function waitForQuietHost({ load = os.loadavg, parallelism = os.availableParallelism,
  cpuList = os.cpus, now = () => performance.now(), sleep = setTimeout, budget = quietWaitBudget } = {}) {
  const threshold = (typeof parallelism === 'function' ? parallelism() : cpuList().length) / 2;
  let reservation;
  try {
    reservation = await budget((state, budgetState) => {
      const skipReason = state.failed ? 'an earlier wait never reached a quiet host'
        : state.remainingSeconds <= 0 ? 'budget exhausted' : null;
      const budgetBeforeSeconds = state.remainingSeconds;
      if (!skipReason) state.remainingSeconds = 0;
      return { budgetBeforeSeconds, budgetState, skipped: !!skipReason, skipReason };
    });
  } catch (error) {
    const startLoad1 = load()[0];
    return { waitedSeconds: 0, quiet: startLoad1 <= threshold, threshold, startLoad1,
      budgetBeforeSeconds: null, budgetAfterSeconds: null, skipped: true,
      skipReason: error.staleLock ? 'abandoned quiet-wait budget lock (>10 s)' : 'quiet-wait budget unavailable',
      budgetState: `unavailable (${error.code ?? 'unknown'})` };
  }
  const started = now(), startLoad1 = load()[0];
  let load1 = startLoad1;
  while (!reservation.skipped && load1 > threshold) {
    const remaining = reservation.budgetBeforeSeconds * 1000 - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(5000, remaining));
    load1 = load()[0];
  }
  const waitedSeconds = reservation.skipped ? 0 : (now() - started) / 1000;
  const quiet = load1 <= threshold;
  let budgetAfterSeconds = reservation.budgetBeforeSeconds, refundBudgetState, refundReason;
  if (!reservation.skipped) {
    try {
      budgetAfterSeconds = await budget((state, source) => {
        refundBudgetState = source;
        // A reset during refund must not replenish already-spent time.
        const remaining = source === 'existing' || source === 'per-process' ? state.remainingSeconds : 0;
        state.remainingSeconds = Math.min(QUIET_WAIT_SECONDS,
          remaining + Math.max(0, reservation.budgetBeforeSeconds - waitedSeconds));
        state.failed ||= !quiet;
        return state.remainingSeconds;
      });
    } catch (error) {
      refundBudgetState = `unavailable (${error.code ?? 'unknown'})`;
      budgetAfterSeconds = null;
      if (error.staleLock) refundReason = 'abandoned quiet-wait budget lock (>10 s) during refund';
    }
  }
  return { waitedSeconds, quiet, threshold, startLoad1, ...reservation, budgetAfterSeconds,
    ...(!reservation.skipped ? { refundBudgetState } : {}), ...(refundReason ? { refundReason } : {}) };
}

const loadCell = n => Number.isFinite(n) ? n.toFixed(2) : 'unavailable';
export function quietWaitCells(wait) {
  return wait ? ` ${wait.waitedSeconds.toFixed(1)} | ${wait.quiet ? 'yes' : 'no'} | ${wait.threshold} | ${loadCell(wait.startLoad1)} | ${wait.budgetBeforeSeconds?.toFixed(1) ?? 'unavailable'} | ${wait.budgetAfterSeconds?.toFixed(1) ?? 'unavailable'} | ${wait.skipped ? 'yes' : 'no'} | ${wait.skipReason ?? '—'} | ${wait.budgetState ?? 'unavailable'}${wait.refundBudgetState ? `; refund: ${wait.refundBudgetState}${wait.refundReason ? ` (${wait.refundReason})` : ''}` : ''} |`
    : ' — | — | — | — | — | — | — | — | — |';
}

// Independent, best-effort reads: missing Linux evidence must never stop a run.
// Keep the full cgroup path for lookup, even when its displayed value is capped.
function cpuEvidence({ platform, parallelism, readFile }) {
  const evidence = { availableParallelism: 'unavailable', cpusAllowed: 'unavailable', cgroup: 'unavailable', cpuMax: 'unavailable' };
  if (platform !== 'linux') return evidence;
  const cell = value => value.trim().replace(/[|\r\n]/g, ' ').slice(0, 80) || 'unavailable';
  try { evidence.availableParallelism = parallelism(); } catch {}
  try { evidence.cpusAllowed = cell(readFile('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:.*$/m)?.[0] ?? ''); } catch {}
  try {
    const cgroup = readFile('/proc/self/cgroup', 'utf8').match(/^0::(\/[^\r\n]*)$/m)?.[1];
    if (cgroup && !cgroup.split('/').includes('..')) {
      evidence.cgroup = cell(cgroup);
      try { evidence.cpuMax = cell(readFile(`/sys/fs/cgroup${cgroup === '/' ? '' : cgroup}/cpu.max`, 'utf8')); } catch {}
    }
  } catch {}
  return evidence;
}

export function captureMachineLoad({ clock = () => new Date(), cpuList = os.cpus, load = os.loadavg, ps = spawnSync,
  platform = process.platform, parallelism = os.availableParallelism, readFile = readFileSync } = {}) {
  const processes = ps('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  const known = !processes.error && processes.status === 0 && typeof processes.stdout === 'string';
  return { sampledAt: clock().toISOString(), loadavg: load(), cpuCount: cpuList().length,
    ...cpuEvidence({ platform, parallelism, readFile }),
    browserProcesses: known ? processes.stdout.split('\n').filter(line =>
      /^(?:chrome(?:[-_].*)?|chromium(?:[-_].*)?|headless_shell|Google Chrome(?: Helper.*)?|Chromium(?: Helper.*)?)$/i.test(basename(line.trim()))).length : null };
}

// Print independently of the report tables, including clean first attempts.
export function budgetAttemptLine(name, row) {
  const m = row.machineLoad, p = row.probe, w = row.quietWait;
  const ms = n => Number.isFinite(n) ? n.toFixed(1) : 'unavailable';
  const quiet = w ? [
    `waitedSeconds=${ms(w.waitedSeconds)}, quiet=${w.quiet ? 'yes' : 'no'}, threshold=${w.threshold ?? 'unavailable'}, startLoad1=${loadCell(w.startLoad1)}`,
    `budgetBeforeSeconds=${ms(w.budgetBeforeSeconds)}, budgetAfterSeconds=${ms(w.budgetAfterSeconds)}, skipped=${w.skipped ? 'yes' : 'no'}`,
    `skipReason=${w.skipReason ?? 'none'}, budgetState=${w.budgetState ?? 'unavailable'}`,
    `refundBudgetState=${w.refundBudgetState ?? 'unavailable'}, refundReason=${w.refundReason ?? 'none'}`,
  ].join(', ') : 'not needed';
  return [
    `Budget attempt: ${name} ${row.viewport}px`, `phase: ${row.phase}`, `attempt: ${row.attempt}`,
    `reference probe: layout/JS=${probeCell(row)} ms, median=${ms(row.probeMs)} ms, min=${ms(p?.minMs)} ms, max=${ms(p?.maxMs)} ms, reps=${p?.reps ?? 'unavailable'}`,
    `CPU: logical=${m?.cpuCount ?? 'unavailable'}, availableParallelism=${m?.availableParallelism ?? 'unavailable'}, cpusAllowed=${m?.cpusAllowed ?? 'unavailable'}, cgroup=${m?.cgroup ?? 'unavailable'}, cpuMax=${m?.cpuMax ?? 'unavailable'}`,
    `load1=${loadCell(m?.loadavg?.[0])}`, `quietWait: ${quiet}`,
  ].join('; ').replace(/[\r\n]/g, ' ');
}

export function machineLoadTable(traces, lock = process.env) {
  return `Browser host lock (one acquisition for all CI browser phases):

| State | Wait started (UTC) | Acquired (UTC) | Waited seconds | Reason |
| --- | --- | --- | --- | --- |
| ${lock.JOED_BROWSER_LOCK_STATE ?? 'unavailable (outside CI wrapper)'} | ${lock.JOED_BROWSER_LOCK_WAIT_STARTED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_ACQUIRED_AT ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_WAIT_SECONDS ?? 'unavailable'} | ${lock.JOED_BROWSER_LOCK_REASON || 'none recorded'} |

Machine load before each attempt (host-wide browser processes include this browser and its helpers; unavailable counts are not zero):

| Width | Phase | Probe layout / JS (ms) | k | Applied limits patch / history / task (ms) | Ratio evidence | Attempt | Quiet wait seconds | Quiet reached | Quiet threshold (load1) | Wait start load1 | Job wait budget before (s) | Job wait budget after (s) | Wait skipped | Skip reason | Budget state | Sampled (UTC) | Loadavg 1 / 5 / 15 min | Logical CPUs | availableParallelism | cpusAllowed | cgroup | cpuMax | Browser processes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${traces.map(r => {
    const m = r.machineLoad;
    return `| ${r.viewport} | ${r.phase} | ${probeCell(r)} |${ratioCells(r, { patchMs: 'unavailable', historyMs: 'unavailable', taskMs: 'unavailable' })} ${r.attempt ?? 1}/${r.attempts ?? 1} |${quietWaitCells(r.quietWait)} ${m?.sampledAt ?? 'unavailable'} | ${m?.loadavg?.map(loadCell).join(' / ') ?? 'unavailable'} | ${m?.cpuCount ?? 'unavailable'} | ${m?.availableParallelism ?? 'unavailable'} | ${m?.cpusAllowed ?? 'unavailable'} | ${m?.cgroup ?? 'unavailable'} | ${m?.cpuMax ?? 'unavailable'} | ${m?.browserProcesses ?? 'unavailable'} |`;
  }).join('\n')}
`;
}
