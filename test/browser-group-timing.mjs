import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGroupTiming, groupTimingTable } from '../scripts/browser/group-timing.mjs';

test('group timing: sums separated blocks, including audit checks and direct screenshots', () => {
  let clock = 100;
  const results = [], shots = [];
  const timing = createGroupTiming({ results, shots, now: () => clock });
  clock += 100;
  timing.enter('design');
  results.push({ name: 'first', ok: true }, { name: 'second', ok: false, detail: 'fixture-only detail' });
  shots.push({ file: 'fixture-only-first.png', what: 'fixture-only description' });
  clock += 1000;
  timing.enter('fixtures');
  results.push({ name: 'fixture', ok: true });
  shots.push({ file: 'fixture-only-second.png' }, { file: 'fixture-only-crop.png' });
  clock += 500;
  timing.enter('design');
  // Shared audit/check functions append to the same log, as do manual captures.
  results.push(...['audit-a', 'audit-b', 'audit-c'].map(name => ({ name, ok: true })));
  shots.push({ file: 'fixture-only-third.png' });
  clock += 2000;
  timing.enter('cleanup');
  clock += 400;
  const original = structuredClone({ results, shots });
  const report = timing.finish();
  assert.deepEqual(report, { totalMs: 4000, groups: [
    { name: 'design', ms: 3000, checks: 5, screenshots: 2 },
    { name: 'fixtures', ms: 500, checks: 1, screenshots: 2 },
    { name: 'cleanup', ms: 400, checks: 0, screenshots: 0 },
    { name: 'setup', ms: 100, checks: 0, screenshots: 0 },
  ] });
  assert.equal(report.groups.reduce((n, g) => n + g.ms, 0), report.totalMs);
  assert.equal(report.groups.reduce((n, g) => n + g.checks, 0), results.length);
  assert.equal(report.groups.reduce((n, g) => n + g.screenshots, 0), shots.length);
  assert.equal(groupTimingTable(report), `## Time per group

Wall time: 4.000 s (setup through cleanup). Repeated blocks are summed.

| Group | Seconds | Checks | Screenshots | Share |
| --- | ---: | ---: | ---: | ---: |
| design | 3.000 | 5 | 2 | 75.0% |
| fixtures | 0.500 | 1 | 2 | 12.5% |
| cleanup | 0.400 | 0 | 0 | 10.0% |
| setup | 0.100 | 0 | 0 | 2.5% |
`);
  assert.doesNotMatch(groupTimingTable(report), /fixture-only|audit-a|second/);
  assert.deepEqual({ results, shots }, original);
});

for (const only of [[], ['design'], ['fixtures'], ['absent']]) {
  test(`group timing: full/subset selection preserves check order and captures (${only.join() || 'full'})`, () => {
    function execute(measure) {
      let clock = 0;
      const results = [], shots = [];
      const timing = createGroupTiming({ results, shots, now: () => clock });
      for (const [name, ms] of [['design', 1000], ['fixtures', 2000], ['design', 3000]]) {
        const selected = !only.length || only.includes(name);
        if (!selected) continue;
        if (measure) timing.enter(name);
        results.push({ name: `${name}-${ms}`, ok: true });
        shots.push({ file: `${name}-${ms}.png` });
        clock += ms;
      }
      timing.enter('cleanup');
      return { results, shots, report: timing.finish() };
    }
    const measured = execute(true), baseline = execute(false);
    assert.deepEqual(measured.results, baseline.results);
    assert.deepEqual(measured.shots, baseline.shots);
    const groups = measured.report.groups.filter(g => !['setup', 'cleanup'].includes(g.name));
    assert.deepEqual(groups.map(g => g.name), only.length ? only.filter(n => n !== 'absent') : ['design', 'fixtures']);
    assert.equal(groups.reduce((n, g) => n + g.checks, 0), measured.results.length);
    assert.equal(groups.reduce((n, g) => n + g.screenshots, 0), measured.shots.length);
    assert.equal(groups.reduce((n, g) => n + g.ms, 0), measured.report.totalMs);
    assert.match(groupTimingTable(measured.report), /## Time per group/);
  });
}

test('group timing: mandatory blocks reconcile separately from selected groups', () => {
  let clock = 0;
  const results = [], shots = [];
  const timing = createGroupTiming({ results, shots, now: () => clock });
  timing.enter('host-timezone');
  results.push({ ok: true }, { ok: true });
  clock += 20;
  timing.enter('design');
  results.push({ ok: true });
  clock += 80;
  timing.enter('host-timezone');
  results.push({ ok: false });
  clock += 10;
  timing.enter('network');
  results.push({ ok: true });
  clock += 5;
  const report = timing.finish();
  assert.deepEqual(report.groups.find(g => g.name === 'host-timezone'),
    { name: 'host-timezone', ms: 30, checks: 3, screenshots: 0 });
  assert.deepEqual(report.groups.find(g => g.name === 'network'),
    { name: 'network', ms: 5, checks: 1, screenshots: 0 });
  assert.equal(report.groups.reduce((n, g) => n + g.checks, 0), results.length);
});

test('group timing: zero wall time is finite and finish fixes the reporting boundary', () => {
  let clock = 0;
  const timing = createGroupTiming({ results: [], shots: [], now: () => clock });
  timing.enter('empty');
  const report = timing.finish();
  assert.match(groupTimingTable(report), /\| empty \| 0\.000 \| 0 \| 0 \| 0\.0% \|/);
  assert.doesNotMatch(groupTimingTable(report), /NaN|Infinity/);
  clock = 9999;
  assert.strictEqual(timing.finish(), report);
  assert.throws(() => timing.enter('late'), /already finished/);
});
