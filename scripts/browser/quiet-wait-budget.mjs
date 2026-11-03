// One allowance for all Board/Results processes in a browser job. Transactions
// reserve time before polling, so even overlapping callers cannot spend it twice.
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

export const QUIET_WAIT_SECONDS = 300;
const fresh = () => ({ remainingSeconds: QUIET_WAIT_SECONDS, failed: false });

// Constructing a store performs no I/O; reference measurements never call it.
export function createQuietWaitBudget(root = null, io = filesystem) {
  let local = fresh();
  return async change => {
    if (!root) return change(local, 'per-process');
    await io.mkdir(root, { recursive: true });
    const file = join(root, 'joedesk-quiet-wait-budget.json');
    const lock = `${file}.lock`;
    const deadline = performance.now() + 2000;
    for (;;) {
      try { await io.mkdir(lock); break; }
      catch (error) {
        if (error.code !== 'EEXIST' || performance.now() >= deadline) throw error;
        // Transactions take milliseconds. Do not remove another process's
        // lock: record an abandoned one and let this re-measure skip waiting.
        try {
          if (Date.now() - (await io.stat(lock)).mtimeMs > 10_000) {
            error.staleLock = true;
            throw error;
          }
        } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
        await setTimeout(10);
      }
    }
    try {
      let state, source = 'existing';
      try {
        state = JSON.parse(await io.readFile(file, 'utf8'));
        if (!state || !Number.isFinite(state.remainingSeconds) || state.remainingSeconds < 0
          || state.remainingSeconds > QUIET_WAIT_SECONDS || typeof state.failed !== 'boolean') {
          throw new SyntaxError('invalid quiet-wait budget');
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        state = fresh();
        source = error.code === 'ENOENT' ? 'created' : 'corrupt (reset to 300 s)';
      }
      const result = change(state, source);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await io.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
        await io.rename(temporary, file);
      } finally {
        await io.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      return result;
    } finally { await io.rmdir(lock); }
  };
}

export const quietWaitBudget = createQuietWaitBudget(process.env.JOED_QA_ROOT || process.env.RUNNER_TEMP);
