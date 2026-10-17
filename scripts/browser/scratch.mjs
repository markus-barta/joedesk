// Test scratch directories (browser profile, board store), made under the
// system temp folder and removed when done. A workstation sends them to the
// Trash; a CI runner has none, so there they are deleted outright and no run
// leaves a directory behind. Only a directory this run made is ever removed.
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = new Set();
export function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.add(dir);
  return dir;
}

export async function discard(dir, what) {
  if (!made.has(dir)) return; // already discarded, or not made here: never removed
  if (process.env.CI === 'true') {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    made.delete(dir);
    return;
  }
  const cleanup = spawnSync('trash', [dir], { stdio: 'ignore' });
  if (cleanup.status !== 0) console.error(`${what} kept at ${dir}: trash failed`);
  else made.delete(dir);
}
