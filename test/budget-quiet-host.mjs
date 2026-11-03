import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForQuietHost, machineLoadTable } from '../scripts/browser/machine-load.mjs';
import { CI_GUARD, decideTaskGuard } from '../scripts/browser/budget.mjs';

function host(samples, parallelism = () => 26) {
  let elapsed = 0, reads = 0;
  const sleeps = [];
  return { sleeps, get reads() { return reads; }, options: {
    load: () => [samples[Math.min(reads++, samples.length - 1)], 0, 0],
    parallelism, cpuList: () => Array(32), now: () => elapsed,
    sleep: async ms => { sleeps.push(ms); elapsed += ms; },
  } };
}

test('JOED-180 (a): busy then quiet returns at the first quiet sample with waited seconds', async () => {
  const h = host([43, 18, 13, 2]);
  const result = await waitForQuietHost(h.options);
  assert.deepEqual(result, { waitedSeconds: 10, quiet: true, threshold: 13, startLoad1: 43 });
  assert.deepEqual(h.sleeps, [5000, 5000]);
  assert.equal(h.reads, 3, 'the inclusive threshold ends polling immediately');
  assert.match(machineLoadTable([{ viewport: '390', phase: 'live', attempt: 2, attempts: 2, quietWait: result }]),
    /2\/2 \| 10\.0 \| yes \| 13 \| 43\.00 \|/);
});

test('JOED-180 (b): never quiet returns at 300 seconds with quiet false', async () => {
  const h = host([43]);
  const result = await waitForQuietHost(h.options);
  assert.deepEqual(result, { waitedSeconds: 300, quiet: false, threshold: 13, startLoad1: 43 });
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
    { waitedSeconds: 0, quiet: true, threshold: 16, startLoad1: 15 });
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

test('JOED-180 (f): the decideTaskGuard contract for identical measurements is unchanged by a wait', async () => {
  for (const first of [{ patchBudget: false }, { renderBudget: false, taskBudget: false }]) {
    for (const second of [first, { worker: false }, { patchBudget: true, taskBudget: true }]) {
      const expected = decideTaskGuard(first, second, CI_GUARD);
      await waitForQuietHost(host([40, 2]).options);
      assert.deepEqual(decideTaskGuard(first, second, CI_GUARD), expected);
      assert.deepEqual(expected, { ok: Object.values(second).every(Boolean), remeasure: false, remeasured: true, attempts: 2 });
    }
  }
});
