import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { waitForQuietHost, machineLoadTable, quietWaitCells } from '../scripts/browser/machine-load.mjs';
import { createQuietWaitBudget } from '../scripts/browser/quiet-wait-budget.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

function host(samples, parallelism = () => 26) {
  let elapsed = 0, reads = 0;
  const sleeps = [];
  return { sleeps, get reads() { return reads; }, options: {
    load: () => [samples[Math.min(reads++, samples.length - 1)], 0, 0],
    parallelism, cpuList: () => Array(32), now: () => elapsed, budget: createQuietWaitBudget(),
    sleep: async ms => { sleeps.push(ms); elapsed += ms; },
  } };
}

test('JOED-180 (a): busy then quiet returns at the first quiet sample with waited seconds', async () => {
  const h = host([43, 18, 13, 2]);
  const result = await waitForQuietHost(h.options);
  assert.deepEqual(result, { waitedSeconds: 10, quiet: true, threshold: 13, startLoad1: 43,
    budgetBeforeSeconds: 300, budgetAfterSeconds: 290, skipped: false, skipReason: null, budgetState: 'per-process', refundBudgetState: 'per-process' });
  assert.deepEqual(h.sleeps, [5000, 5000]);
  assert.equal(h.reads, 3, 'the inclusive threshold ends polling immediately');
  assert.match(machineLoadTable([{ viewport: '390', phase: 'live', attempt: 2, attempts: 2, quietWait: result }]),
    /2\/2 \| 10\.0 \| yes \| 13 \| 43\.00 \|/);
});

test('JOED-180 (b): never quiet returns at 300 seconds with quiet false', async () => {
  const h = host([43]);
  const result = await waitForQuietHost(h.options);
  assert.deepEqual(result, { waitedSeconds: 300, quiet: false, threshold: 13, startLoad1: 43,
    budgetBeforeSeconds: 300, budgetAfterSeconds: 0, skipped: false, skipReason: null, budgetState: 'per-process', refundBudgetState: 'per-process' });
  assert.equal(h.sleeps.length, 60);
  assert.ok(h.sleeps.every(ms => ms === 5000));
  assert.equal(h.reads, 61);
  assert.match(machineLoadTable([{ viewport: '390', phase: 'live', quietWait: result }]),
    /300\.0 \| no \| 13 \| 43\.00/);
});

test('JOED-180 (e): threshold uses availableParallelism before the injectable CPU-list fallback', async () => {
  const affinity = host([15, 13]);
  affinity.options.cpuList = () => { assert.fail('availableParallelism must take precedence'); };
  assert.equal((await waitForQuietHost(affinity.options)).waitedSeconds, 5);
  const fallback = host([15]);
  fallback.options.parallelism = null;
  assert.deepEqual(await waitForQuietHost(fallback.options),
    { waitedSeconds: 0, quiet: true, threshold: 16, startLoad1: 15,
      budgetBeforeSeconds: 300, budgetAfterSeconds: 300, skipped: false, skipReason: null, budgetState: 'per-process', refundBudgetState: 'per-process' });
});

test('JOED-180: an initially quiet host needs no sleep, and timer delays reduce the remaining polling time', async () => {
  const quiet = host([2]);
  assert.equal((await waitForQuietHost(quiet.options)).waitedSeconds, 0);
  assert.deepEqual(quiet.sleeps, []);
  const delayed = host([40]);
  let elapsed = 0;
  delayed.options.now = () => elapsed;
  delayed.options.sleep = async ms => { delayed.sleeps.push(ms); elapsed += ms + 1200; };
  const result = await waitForQuietHost(delayed.options);
  assert.equal(delayed.sleeps.at(-1), 2400, 'the last sleep uses only the remaining deadline');
  assert.equal(result.quiet, false);
  assert.equal(delayed.sleeps.length, 49);
});

test('JOED-180 (g): separate runner processes share only the remaining file-backed budget', t => {
  const dir = scratch('joed-quiet-budget-');
  t.after(() => discard(dir, 'JOED-180 shared budget test'));
  const root = join(dir, 'job-temp');
  const module = new URL('../scripts/browser/machine-load.mjs', import.meta.url).href;
  const run = (quietAt, qaRoot = '') => {
    const source = `import { waitForQuietHost } from ${JSON.stringify(module)};
      let elapsed = 0;
      const result = await waitForQuietHost({ load: () => [elapsed >= ${quietAt} ? 2 : 43],
        parallelism: () => 26, now: () => elapsed, sleep: async ms => { elapsed += ms; } });
      console.log(JSON.stringify(result));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: root, JOED_QA_ROOT: qaRoot }, timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  const first = run(12_000); // Three 5 s polls; the unused allowance is returned.
  assert.equal(first.waitedSeconds, 15);
  assert.equal(first.budgetBeforeSeconds, 300);
  assert.equal(first.budgetAfterSeconds, 285);
  assert.equal(first.budgetState, 'created');
  const second = run(Infinity);
  assert.equal(second.waitedSeconds, 285);
  assert.equal(second.budgetBeforeSeconds, 285);
  assert.equal(second.budgetAfterSeconds, 0);
  assert.equal(second.quiet, false);
  assert.equal(second.budgetState, 'existing');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'joedesk-quiet-wait-budget.json'))),
    { remainingSeconds: 0, failed: true });
  const qa = run(0, join(dir, 'qa-root'));
  assert.equal(qa.budgetBeforeSeconds, 300, 'JOED_QA_ROOT takes precedence over RUNNER_TEMP');
});

test('JOED-180 (i): absent and corrupt budget files are safely initialised and the reset is recorded', async t => {
  const dir = scratch('joed-quiet-corrupt-');
  t.after(() => discard(dir, 'JOED-180 corrupt budget test'));
  const file = join(dir, 'joedesk-quiet-wait-budget.json');
  for (const invalid of [undefined, '', '{', 'null', '{}', '{"remainingSeconds":301,"failed":false}',
    '{"remainingSeconds":-1,"failed":false}', '{"remainingSeconds":"300","failed":false}',
    '{"remainingSeconds":10,"failed":"false"}']) {
    if (invalid !== undefined) writeFileSync(file, invalid);
    const h = host([43, 2]);
    const result = await waitForQuietHost({ ...h.options, budget: createQuietWaitBudget(dir) });
    assert.equal(result.budgetBeforeSeconds, 300);
    assert.equal(result.budgetAfterSeconds, 295);
    assert.equal(result.budgetState, invalid === undefined ? 'created' : 'corrupt (reset to 300 s)');
    assert.ok(quietWaitCells(result).includes(result.budgetState));
    assert.deepEqual(JSON.parse(readFileSync(file)), { remainingSeconds: 295, failed: false });
    assert.deepEqual(readdirSync(dir), ['joedesk-quiet-wait-budget.json'], 'atomic writes leave no temporary file or lock');
  }
});

test('JOED-180: exhausted budgets skip without sleeping, and local calls share a per-process allowance', async () => {
  const budget = createQuietWaitBudget();
  const h = host([43, 2]);
  const first = await waitForQuietHost({ ...h.options, budget });
  assert.equal(first.budgetAfterSeconds, 295);
  await budget(state => { state.remainingSeconds = 0; });
  const next = host([43]);
  const skipped = await waitForQuietHost({ ...next.options, budget });
  assert.deepEqual(next.sleeps, []);
  assert.equal(skipped.waitedSeconds, 0);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.skipReason, 'budget exhausted');
  assert.equal(skipped.budgetBeforeSeconds, 0);
  assert.equal(skipped.budgetAfterSeconds, 0);
});

for (const code of ['EEXIST', 'EACCES', 'ENOSPC', 'EISDIR']) {
  test(`JOED-180 budget I/O ${code}: reservation and refund failures are recorded without rejecting`, async t => {
    for (const failingTransaction of [1, 2]) {
      const root = scratch(`joed-budget-${code.toLowerCase()}-`);
      t.after(() => discard(root, `JOED-180 ${code} budget test`));
      const file = join(root, 'joedesk-quiet-wait-budget.json');
      let transactions = 0;
      // Permission/disk-full failures are injected at the real I/O boundary,
      // independent of host privileges or the workstation's free disk space.
      const io = { ...filesystem,
        readFile: async (...args) => {
          if (code === 'EACCES' && transactions === failingTransaction) throw Object.assign(new Error(code), { code });
          return filesystem.readFile(...args);
        },
        writeFile: async (...args) => {
          if (code === 'ENOSPC' && transactions === failingTransaction) throw Object.assign(new Error(code), { code });
          return filesystem.writeFile(...args);
        },
      };
      const store = createQuietWaitBudget(root, io);
      const budget = async change => {
        if (++transactions === failingTransaction) {
          if (code === 'EEXIST') await filesystem.mkdir(`${file}.lock`);
          if (code === 'EISDIR') {
            if (failingTransaction === 2) await filesystem.rename(file, `${file}.saved`);
            await filesystem.mkdir(file);
          }
        }
        return store(change);
      };
      const h = host([43, 2]);
      const result = await waitForQuietHost({ ...h.options, budget });
      assert.equal(result.budgetState, `unavailable (${code})`);
      assert.equal(result.budgetAfterSeconds, null, 'failed persistence leaves the allowance unknown');
      assert.ok(quietWaitCells(result).includes(`unavailable (${code})`));
      if (failingTransaction === 1) {
        assert.equal(result.skipped, true);
        assert.equal(result.skipReason, 'quiet-wait budget unavailable');
        assert.equal(result.budgetBeforeSeconds, null);
        assert.equal(result.waitedSeconds, 0);
        assert.deepEqual(h.sleeps, []);
        assert.equal(transactions, 1, 'an unavailable reservation never attempts a refund');
      } else {
        assert.equal(result.refundBudgetState, `unavailable (${code})`);
        assert.equal(result.budgetBeforeSeconds, 300);
        assert.equal(result.waitedSeconds, 5);
        assert.equal(result.quiet, true);
        assert.equal(transactions, 2);
      }
      if (code !== 'EEXIST') assert.ok(!readdirSync(root).includes('joedesk-quiet-wait-budget.json.lock'), 'the owned transaction lock is released');
      assert.ok(!readdirSync(root).some(name => name.endsWith('.tmp')), 'failed atomic writes leave no temporary files');
    }
  });
}

test('JOED-180 budget stale lock: abandoned reservation and refund locks skip safely and are recorded', async t => {
  for (const failingTransaction of [1, 2]) {
    const root = scratch('joed-budget-stale-lock-');
    t.after(() => discard(root, 'JOED-180 stale lock test'));
    const lock = join(root, 'joedesk-quiet-wait-budget.json.lock');
    const store = createQuietWaitBudget(root);
    let transactions = 0;
    const budget = async change => {
      if (++transactions === failingTransaction) {
        await filesystem.mkdir(lock);
        const old = new Date(Date.now() - 20_000);
        await filesystem.utimes(lock, old, old);
      }
      return store(change);
    };
    const h = host([43, 2]);
    const result = await waitForQuietHost({ ...h.options, budget });
    assert.equal(result.budgetState, 'unavailable (EEXIST)');
    assert.match(result.skipReason, /abandoned quiet-wait budget lock \(>10 s\)/);
    assert.equal(result.waitedSeconds, failingTransaction === 1 ? 0 : 5);
    assert.equal(result.skipped, failingTransaction === 1);
    if (failingTransaction === 2) assert.equal(result.refundBudgetState, 'unavailable (EEXIST)');
    assert.ok((await filesystem.stat(lock)).isDirectory(), 'an unowned lock is never deleted');
    assert.ok(quietWaitCells(result).includes('abandoned quiet-wait budget lock'));
  }
});

test('JOED-180 budget refund: absent and corrupt resets record their own source without replenishing spent time', async t => {
  for (const source of ['created', 'corrupt (reset to 300 s)']) {
    const root = scratch('joed-budget-refund-source-');
    t.after(() => discard(root, 'JOED-180 refund source test'));
    const file = join(root, 'joedesk-quiet-wait-budget.json');
    const store = createQuietWaitBudget(root);
    await store(state => { state.remainingSeconds = 100; });
    const h = host([43, 2]);
    const result = await waitForQuietHost({ ...h.options, budget: store, sleep: async ms => {
      await h.options.sleep(ms);
      if (source === 'created') await filesystem.rename(file, `${file}.saved`);
      else await filesystem.writeFile(file, '{corrupt');
    } });
    assert.equal(result.budgetState, 'existing');
    assert.equal(result.refundBudgetState, source);
    assert.equal(result.budgetBeforeSeconds, 100);
    assert.equal(result.budgetAfterSeconds, 95);
    assert.ok(quietWaitCells(result).includes(`refund: ${source}`));
    assert.deepEqual(JSON.parse(readFileSync(file)), { remainingSeconds: 95, failed: false });
  }
});

test('JOED-180: overlapping waits cannot spend the same allowance twice', async t => {
  const root = scratch('joed-overlapping-waits-');
  t.after(() => discard(root, 'JOED-180 overlapping waits test'));
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let elapsed = 0;
  const first = waitForQuietHost({ budget: createQuietWaitBudget(root), parallelism: () => 26,
    load: () => [elapsed === 0 ? 43 : 2], now: () => elapsed,
    sleep: async ms => { entered.resolve(); await release.promise; elapsed += ms; } });
  await entered.promise;
  try {
    const other = host([43]);
    const second = await waitForQuietHost({ ...other.options, budget: createQuietWaitBudget(root) });
    assert.equal(second.skipReason, 'budget exhausted');
    assert.equal(second.waitedSeconds, 0);
    assert.equal(second.budgetBeforeSeconds, 0);
    assert.deepEqual(other.sleeps, []);
  } finally { release.resolve(); }
  assert.equal((await first).budgetAfterSeconds, 295);
  const next = host([43, 2]);
  assert.equal((await waitForQuietHost({ ...next.options, budget: createQuietWaitBudget(root) })).budgetBeforeSeconds, 295);
});

test('JOED-180: simultaneous file transactions preserve every budget deduction', async t => {
  const root = scratch('joed-atomic-budget-');
  t.after(() => discard(root, 'JOED-180 atomic budget test'));
  const remaining = await Promise.all(Array.from({ length: 8 }, () => createQuietWaitBudget(root)(state => {
    state.remainingSeconds -= 5;
    return state.remainingSeconds;
  })));
  assert.deepEqual(remaining.sort((a, b) => b - a), [295, 290, 285, 280, 275, 270, 265, 260]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'joedesk-quiet-wait-budget.json'))),
    { remainingSeconds: 260, failed: false });
});

test('JOED-180: non-numeric load samples render as unavailable in both wait and load cells', () => {
  for (const startLoad1 of [undefined, null, NaN, Infinity, '43', {}]) {
    const quietWait = { waitedSeconds: 0, quiet: false, threshold: 13, startLoad1,
      budgetBeforeSeconds: 300, budgetAfterSeconds: 300, skipped: false };
    assert.match(quietWaitCells(quietWait), /0\.0 \| no \| 13 \| unavailable \|/);
    assert.match(machineLoadTable([{ quietWait, machineLoad: { loadavg: [startLoad1, 2, 3] } }]),
      /unavailable \/ 2\.00 \/ 3\.00/);
  }
});
