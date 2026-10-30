import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const wrapper = fileURLToPath(new URL('../scripts/with-browser-lock.sh', import.meta.url));
const bash = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

test('browser shell retains strict failures, arguments and exit status; unknown environments fail closed', t => {
  const dir = scratch('joed-browser-lock-shell-');
  t.after(() => discard(dir, 'browser lock shell test'));
  const script = join(dir, 'step with spaces');
  writeFileSync(script, 'test "$1" = "argument with spaces"\nexit 7\n');
  const hosted = { env: { ...process.env, RUNNER_ENVIRONMENT: 'github-hosted' } };
  assert.equal(spawnSync(bash, [wrapper, script, 'argument with spaces'], hosted).status, 7);
  writeFileSync(script, 'false | true\nexit 0\n');
  assert.equal(spawnSync(bash, [wrapper, script], hosted).status, 1, 'pipefail survives the custom shell');
  for (const kind of ['unknown', '']) assert.equal(spawnSync(bash, [wrapper, script], {
    env: { ...process.env, RUNNER_ENVIRONMENT: kind },
  }).status, 1);
  // Isolated PATH proves a missing lock utility cannot launch the step.
  symlinkSync(bash, join(dir, 'bash'));
  writeFileSync(script, 'exit 0\n');
  const missing = spawnSync(bash, [wrapper, script], { encoding: 'utf8',
    env: { ...process.env, PATH: dir, RUNNER_ENVIRONMENT: 'self-hosted' } });
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /flock.*not found/);
});

test('browser shell queues four competing steps without replacement and releases after a failed step', { timeout: 15000 }, async t => {
  // macOS has no util-linux flock. Exercise the real wrapper with an adapter
  // that uses the same kernel flock primitive, mapping only the host path into
  // our scratch directory. Linux utility/agm2 integration remains a CI check.
  const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (python.status !== 0) { t.skip('python3 required for the portable kernel-lock adapter'); return; }
  const dir = scratch('joed-browser-lock-race-');
  t.after(() => discard(dir, 'browser lock race test'));
  const log = join(dir, 'events'), lock = join(dir, 'lock');
  writeFileSync(join(dir, 'flock'), `#!${python.stdout.trim()}
import fcntl, os, subprocess, sys
assert sys.argv[1:3] == ['--exclusive', '/dev/shm/joedesk-browser.lock']
with open(os.environ['JOED_TEST_LOCK'], 'a') as handle:
    fcntl.flock(handle, fcntl.LOCK_EX)
    result = subprocess.run(sys.argv[3:], pass_fds=(handle.fileno(),))
    sys.exit(result.returncode)
`, { mode: 0o700 });
  symlinkSync(bash, join(dir, 'bash'));
  const workload = join(dir, 'workload.mjs');
  writeFileSync(workload, `import { appendFileSync } from 'node:fs';
const [log, id] = process.argv.slice(2);
appendFileSync(log, id + ' enter\\n');
await new Promise(resolve => setTimeout(resolve, 80));
appendFileSync(log, id + ' exit\\n');
process.exitCode = id === '1' ? 7 : 0;
`);
  const step = join(dir, 'step');
  writeFileSync(step, '"$JOED_TEST_NODE" "$JOED_TEST_WORKLOAD" "$JOED_TEST_LOG" "$1"\n');
  const workers = Array.from({ length: 4 }, (_, id) => {
    const child = spawn(bash, [wrapper, step, String(id)], {
      env: { ...process.env, PATH: dir, RUNNER_ENVIRONMENT: 'self-hosted', JOED_TEST_LOCK: lock, JOED_TEST_NODE: process.execPath,
        JOED_TEST_WORKLOAD: workload, JOED_TEST_LOG: log }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    return once(child, 'close').then(([code]) => { assert.equal(code, id === 1 ? 7 : 0, stderr); });
  });
  await Promise.all(workers);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 8, 'every waiting step executes');
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 2) {
    const id = lines[i].split(' ')[0];
    assert.equal(lines[i], `${id} enter`);
    assert.equal(lines[i + 1], `${id} exit`, 'no second browser enters an occupied phase');
    seen.add(id);
  }
  assert.equal(seen.size, 4);
});
