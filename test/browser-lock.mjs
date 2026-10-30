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
const date = spawnSync(bash, ['-c', 'command -v date'], { encoding: 'utf8' }).stdout.trim();

function hostWrapper(dir) {
  // Exercise the production fd lifetime; translate only the Linux host path
  // into owned scratch space for macOS. No configurable production lock path.
  const source = readFileSync(wrapper, 'utf8');
  assert.ok(source.includes('exec 9>> /dev/shm/joedesk-browser.lock'));
  const local = join(dir, 'wrapper.sh');
  writeFileSync(local, source.replace('exec 9>> /dev/shm/joedesk-browser.lock', 'exec 9>> "$JOED_TEST_LOCK"'));
  symlinkSync(bash, join(dir, 'bash'));
  symlinkSync(date, join(dir, 'date'));
  return local;
}

test('browser shell retains strict failures, arguments and exit status; unknown environments fail closed', t => {
  const dir = scratch('joed-browser-lock-shell-');
  t.after(() => discard(dir, 'browser lock shell test'));
  const script = join(dir, 'step with spaces');
  writeFileSync(script, 'test "$1" = "argument with spaces"\nexit 7\n');
  const summary = join(dir, 'summary');
  const hosted = { env: { ...process.env, RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_STEP_SUMMARY: summary } };
  assert.equal(spawnSync(bash, [wrapper, script, 'argument with spaces'], hosted).status, 7);
  assert.match(readFileSync(summary, 'utf8'), /bypassed.*waited 0 seconds/);
  writeFileSync(script, 'false | true\nexit 0\n');
  assert.equal(spawnSync(bash, [wrapper, script], hosted).status, 1, 'pipefail survives the custom shell');
  for (const kind of ['unknown', '']) assert.equal(spawnSync(bash, [wrapper, script], {
    env: { ...process.env, RUNNER_ENVIRONMENT: kind },
  }).status, 1);
});

test('browser lock infrastructure failures warn and export unavailable state and reason to unlocked phases', t => {
  for (const failure of ['missing', 'open-denied', 'open-directory', 'acquisition-error']) {
    const dir = scratch(`joed-browser-lock-${failure}-`);
    t.after(() => discard(dir, 'browser lock unavailable test'));
    const local = hostWrapper(dir), summary = join(dir, 'summary');
    const lock = join(dir, 'lock');
    if (failure === 'open-denied') writeFileSync(lock, '', { mode: 0o400 });
    if (failure !== 'missing') writeFileSync(join(dir, 'flock'), '#!/bin/sh\necho FLOCK_CALLED >&2\nexit 69\n', { mode: 0o700 });
    const reason = failure === 'missing' ? 'flock not found' : failure.startsWith('open-')
      ? 'cannot open /dev/shm/joedesk-browser.lock' : 'flock failed (exit 69)';
    const result = spawnSync(bash, [local, '-c',
      'printf "PHASE_STARTED state=%s reason=%s acquired=%s\\n" "$JOED_BROWSER_LOCK_STATE" "$JOED_BROWSER_LOCK_REASON" "$JOED_BROWSER_LOCK_ACQUIRED_AT"; exit 7'], {
      encoding: 'utf8', env: { ...process.env, PATH: dir, RUNNER_ENVIRONMENT: 'self-hosted',
        GITHUB_STEP_SUMMARY: summary, JOED_TEST_LOCK: failure === 'open-directory' ? dir : lock,
        JOED_BROWSER_LOCK_STATE: 'held', JOED_BROWSER_LOCK_REASON: 'stale reason', JOED_BROWSER_LOCK_ACQUIRED_AT: 'stale time' },
    });
    assert.equal(result.status, 7, result.stderr);
    const warning = `Browser host lock unavailable (${reason}); running UNLOCKED, timing budgets may contend`;
    assert.ok(result.stderr.includes(`::warning::${warning}`), result.stderr);
    assert.ok(readFileSync(summary, 'utf8').includes(warning));
    assert.ok(result.stdout.includes(`PHASE_STARTED state=unavailable reason=${reason} acquired=unavailable`), result.stdout);
    assert.doesNotMatch(result.stderr, /::error::/);
    assert.doesNotMatch(result.stdout, /stale reason|stale time/);
    if (failure !== 'acquisition-error') assert.doesNotMatch(result.stderr, /FLOCK_CALLED/);
  }
});

test('browser lock acquisition timeout fails clearly without launching phases', t => {
  const dir = scratch('joed-browser-lock-timeout-');
  t.after(() => discard(dir, 'browser lock timeout test'));
  const local = hostWrapper(dir), summary = join(dir, 'summary');
  writeFileSync(join(dir, 'flock'), '#!/bin/sh\ntest "$*" = "--exclusive --wait 3600 --conflict-exit-code 75 9" || exit 99\nexit 75\n', { mode: 0o700 });
  const options = { encoding: 'utf8', env: { ...process.env, PATH: dir, RUNNER_ENVIRONMENT: 'self-hosted',
    GITHUB_STEP_SUMMARY: summary, JOED_TEST_LOCK: join(dir, 'lock') } };
  const result = spawnSync(bash, [local, '-c', 'echo PHASE_STARTED'], options);
  assert.equal(result.status, 75, result.stderr);
  assert.doesNotMatch(result.stdout, /PHASE_STARTED/);
  assert.match(result.stdout, /waiting since \d{4}-.*Z \(limit 3600 seconds\)/);
  assert.match(result.stderr, /::error::Browser host lock acquisition failed.*wait limit 3600 seconds.*no browser phases started/);
  assert.match(readFileSync(summary, 'utf8'), /waiting since[\s\S]*acquisition failed/);
  assert.doesNotMatch(result.stderr, /::warning::|UNLOCKED/);
});

test('browser shell queues four whole jobs without replacement, retains one lock across phases and releases after failure', { timeout: 15000 }, async t => {
  // macOS has no util-linux flock. Exercise the real wrapper with an adapter
  // that uses the same kernel flock primitive, mapping only the host path into
  // our scratch directory. Linux utility/agm2 integration remains a CI check.
  const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (python.status !== 0) { t.skip('python3 required for the portable kernel-lock adapter'); return; }
  const dir = scratch('joed-browser-lock-race-');
  t.after(() => discard(dir, 'browser lock race test'));
  const local = hostWrapper(dir);
  const log = join(dir, 'events'), lock = join(dir, 'lock');
  writeFileSync(join(dir, 'flock'), `#!${python.stdout.trim()}
import fcntl, sys
assert sys.argv[1:] == ['--exclusive', '--wait', '3600', '--conflict-exit-code', '75', '9']
fcntl.flock(9, fcntl.LOCK_EX)
`, { mode: 0o700 });
  const workload = join(dir, 'workload.mjs');
  writeFileSync(workload, `import { appendFileSync } from 'node:fs';
const [log, id] = process.argv.slice(2);
appendFileSync(log, id + ' enter\\n');
await new Promise(resolve => setTimeout(resolve, 80));
appendFileSync(log, id + ' middle\\n');
await new Promise(resolve => setTimeout(resolve, 80));
appendFileSync(log, id + ' exit\\n');
process.exitCode = id === '1' ? 7 : 0;
`);
  const step = join(dir, 'step');
  writeFileSync(step, 'test "$JOED_BROWSER_LOCK_STATE" = held\ntest -z "$JOED_BROWSER_LOCK_REASON"\n"$JOED_TEST_NODE" "$JOED_TEST_WORKLOAD" "$JOED_TEST_LOG" "$1"\n');
  const workers = Array.from({ length: 4 }, (_, id) => {
    const child = spawn(bash, [local, step, String(id)], {
      env: { ...process.env, PATH: dir, RUNNER_ENVIRONMENT: 'self-hosted', JOED_TEST_LOCK: lock, JOED_TEST_NODE: process.execPath,
        JOED_BROWSER_LOCK_REASON: 'stale reason',
        GITHUB_STEP_SUMMARY: join(dir, `summary-${id}`), JOED_TEST_WORKLOAD: workload, JOED_TEST_LOG: log }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    return once(child, 'close').then(([code]) => {
      assert.equal(code, id === 1 ? 7 : 0, stderr);
      const summary = readFileSync(join(dir, `summary-${id}`), 'utf8');
      assert.match(summary, /held.*wait started \d{4}-.*Z; acquired \d{4}-.*Z; waited \d+ seconds/);
      assert.equal(summary.match(/Browser host lock \(held\)/g).length, 1, 'one acquisition per whole job');
    });
  });
  await Promise.all(workers);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 12, 'every waiting job executes all phases');
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 3) {
    const id = lines[i].split(' ')[0];
    assert.equal(lines[i], `${id} enter`);
    assert.equal(lines[i + 1], `${id} middle`);
    assert.equal(lines[i + 2], `${id} exit`, 'no other job enters between phases');
    seen.add(id);
  }
  assert.equal(seen.size, 4);
});
