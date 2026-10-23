import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { P4_SCENARIOS, validateP4Scenarios, selectP4Scenarios, parseResultsGateArgs } from '../scripts/results-gate-plan.mjs';
import { runResultsGate } from '../scripts/run-results-gate.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const p4 = readFileSync(new URL('../scripts/browser-p4.mjs', import.meta.url), 'utf8');
const names = scenarios => scenarios.map(s => s.name);
const prArgs = ['--full', 'Europe/Vienna', '--subset', 'UTC', 'America/New_York'];
const prPlan = [{ timeZone: 'Europe/Vienna', mode: 'full' }, { timeZone: 'UTC', mode: 'subset' }, { timeZone: 'America/New_York', mode: 'subset' }];

test('P4 inventory covers every scenario and requires an explicit boolean zoneSensitive before browser startup', () => {
  const executed = ['host-timezone', ...p4.matchAll(/if \(run\('([^']+)'\)\)/g)].map(entry => typeof entry === 'string' ? entry : entry[1]);
  assert.deepEqual(names(P4_SCENARIOS), executed, 'new executable scenarios must declare metadata');
  assert.doesNotThrow(() => validateP4Scenarios(P4_SCENARIOS));
  for (const scenario of P4_SCENARIOS) {
    const { zoneSensitive, ...missing } = scenario;
    for (const invalid of [missing, { ...missing, zoneSensitive: undefined }, { ...missing, zoneSensitive: 'true' }]) {
      assert.throws(() => validateP4Scenarios(P4_SCENARIOS.map(s => s === scenario ? invalid : s)), /explicitly declare zoneSensitive/);
    }
  }
  assert.throws(() => validateP4Scenarios([...P4_SCENARIOS, P4_SCENARIOS[0]]), /unique name/);
  assert.throws(() => validateP4Scenarios(P4_SCENARIOS.map(s => s.name === 'host-timezone' ? { ...s, zoneSensitive: false } : s)), /host-timezone/);
  assert.throws(() => validateP4Scenarios(P4_SCENARIOS.map(s => s.name === 'budget' ? { ...s, zoneSensitive: true } : s)), /budget/);
  assert.ok(p4.indexOf('const selectedScenarios = selectP4Scenarios(') < p4.indexOf('const browser = await launch('));
});

test('P4 subset keeps host zones, every date-bearing group and all 14 differing baseline screenshots', () => {
  const subset = new Set(names(selectP4Scenarios({ zoneSubset: true })));
  for (const name of ['host-timezone', 'design', 'fixtures', 'states', 'vienna', 'r1', 'trade-amount',
    'phone-calendar', 'ingress', 'period-hint', 'partial-days', 'missing-days']) assert.ok(subset.has(name), name);
  assert.ok(subset.size > 0 && subset.size < P4_SCENARIOS.length);
  assert.deepEqual(P4_SCENARIOS.filter(s => !subset.has(s.name)).map(s => s.name), ['cards', 'budget']);
  // Run 39793917962: several differences occur at only one width/theme.
  // Keep their complete parent scenarios, including every other screenshot
  // and assertion, rather than treating render noise as a coverage exemption.
  const differing = [
    ['1024-dark-results-partial-desk-filtered-partial-today', 'partial-days'],
    ['1024-dark-results-partial-desk-filtered-reasoned-today', 'partial-days'],
    ['1024-dark-results-partial-today-no-trades', 'partial-days'],
    ['1024-dark-results-partial-trade-panel', 'partial-days'],
    ['1024-light-results-partial-counted', 'partial-days'],
    ['1024-light-results-partial-single-reason', 'partial-days'],
    ['1440-dark-results-ingress-live', 'ingress'],
    ['1440-dark-results-partial-desk-filtered-reasoned-today', 'partial-days'],
    ['1440-dark-results-partial-single-reason', 'partial-days'],
    ['1440-light-results-day', 'design'],
    ['1440-light-results-ingress-live', 'ingress'],
    ['1440-light-results-kept-mismatch', 'states'],
    ['1440-light-results-stale', 'states'],
    ['390-dark-results-ingress-live', 'ingress'],
  ];
  for (const [screenshot, scenario] of differing) assert.ok(subset.has(scenario), screenshot);
  assert.deepEqual(names(selectP4Scenarios()), names(P4_SCENARIOS));
  assert.deepEqual(names(selectP4Scenarios({ zoneSubset: true, only: ['vienna', 'budget'] })), ['host-timezone', 'vienna']);
  assert.deepEqual(names(selectP4Scenarios({ only: ['budget'] })), ['host-timezone', 'budget']);
  assert.throws(() => selectP4Scenarios({ only: ['typo'] }), /Unknown P4 scenario/);
});

test('Results gate CLI preserves positional/default full runs and parses explicit full/subset groups', () => {
  assert.deepEqual(parseResultsGateArgs(prArgs), prPlan);
  assert.deepEqual(parseResultsGateArgs([]), ['UTC', 'America/New_York'].map(timeZone => ({ timeZone, mode: 'full' })));
  assert.deepEqual(parseResultsGateArgs(['UTC', 'Europe/Vienna', 'America/New_York']),
    ['UTC', 'Europe/Vienna', 'America/New_York'].map(timeZone => ({ timeZone, mode: 'full' })));
  assert.deepEqual(parseResultsGateArgs(['--subset', 'UTC', '--full', 'Europe/Vienna', '--subset', 'America/New_York']),
    [prPlan[1], prPlan[0], prPlan[2]]);
  for (const args of [['--full'], ['--subset'], ['--full', '--subset', 'UTC'], ['--subset', 'UTC', '--full'],
    ['UTC', '--subset', 'America/New_York'], ['--unknown', 'UTC'], ['-x'], ['Mars/Olympus_Mons'],
    ['--full', 'Europe/Vienna', '--subset', 'Mars/Olympus_Mons'], ['--full', 'UTC', '--subset', 'UTC']]) {
    assert.throws(() => parseResultsGateArgs(args), undefined, args.join(' '));
  }
});

test('Results gate launches the planned modes sequentially with isolated zone artifacts and an accurate index', t => {
  const dir = scratch('joed-results-gate-');
  t.after(() => discard(dir, 'Results gate planning test'));
  for (const args of [prArgs, ['UTC', 'Europe/Vienna', 'America/New_York']]) {
    const qaRoot = join(dir, args === prArgs ? 'pr' : 'push'), launched = [];
    const status = runResultsGate(args, { qaRoot, spawn: (command, childArgs, options) => {
      assert.equal(command, process.execPath);
      assert.ok(childArgs[0].endsWith('/scripts/browser-p4.mjs'));
      assert.equal(options.stdio, 'inherit');
      launched.push({ timeZone: options.env.TZ, mode: childArgs.includes('--zone-subset') ? 'subset' : 'full' });
      assert.equal(options.env.JOED_QA_DIR, join(qaRoot, options.env.TZ.replaceAll('/', '-')));
      assert.deepEqual(childArgs.slice(1), launched.at(-1).mode === 'subset' ? ['--zone-subset'] : []);
      return { status: 0 };
    } });
    assert.equal(status, 0);
    assert.deepEqual(launched, parseResultsGateArgs(args));
    const index = readFileSync(join(qaRoot, 'index.md'), 'utf8');
    for (const run of launched) {
      assert.ok(index.includes(`| ${run.timeZone} | ${run.mode} |`));
      assert.ok(index.includes(`[zone index](${run.timeZone.replaceAll('/', '-')}/index.md)`));
      const section = index.split(`## ${run.timeZone} · ${run.mode}\n`)[1].split('\n## ')[0];
      assert.equal(section.includes('`budget`'), run.mode === 'full');
      for (const name of names(selectP4Scenarios({ zoneSubset: run.mode === 'subset' }))) assert.ok(section.includes(`\`${name}\``));
    }
    assert.equal((index.match(/\| passed \|/g) ?? []).length, 3);
  }
});

test('Results gate validates all zones before launch and stops with the failing child status', t => {
  const dir = scratch('joed-results-gate-fail-');
  t.after(() => discard(dir, 'Results gate failure test'));
  const invalidRoot = join(dir, 'invalid');
  assert.throws(() => runResultsGate(['UTC', 'Invalid/Zone'], { qaRoot: invalidRoot,
    spawn: () => assert.fail('invalid plan must not launch') }));
  assert.equal(existsSync(invalidRoot), false);
  for (const childStatus of [2, null]) {
    const qaRoot = join(dir, String(childStatus));
    let launched = 0;
    assert.equal(runResultsGate(prArgs, { qaRoot, spawn: () => {
      launched++;
      return { status: childStatus };
    } }), childStatus ?? 1);
    assert.equal(launched, 1);
    const index = readFileSync(join(qaRoot, 'index.md'), 'utf8');
    assert.match(index, /\| Europe\/Vienna \| full \| \d+ \| failed \|/);
    assert.match(index, /\| UTC \| subset \| \d+ \| not run \|/);
  }
});
