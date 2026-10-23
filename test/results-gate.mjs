import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { P4_SCENARIOS, P4_VIEWS, P4_SUBSET_EXCEPTION, createP4Views, createP4ViewRecorder, p4ViewKey, validateP4Scenarios, validateP4Views, selectP4Scenarios, selectP4Views, summarizeP4Views, parseResultsGateArgs } from '../scripts/results-gate-plan.mjs';
import { runResultsGate } from '../scripts/run-results-gate.mjs';
import { VIEWPORTS, THEMES } from '../scripts/browser/shots.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const p4 = readFileSync(new URL('../scripts/browser-p4.mjs', import.meta.url), 'utf8');
const names = scenarios => scenarios.map(s => s.name);
const prArgs = ['--full', 'Europe/Vienna', '--subset', 'UTC', 'America/New_York'];
const prPlan = [{ timeZone: 'Europe/Vienna', mode: 'full' }, { timeZone: 'UTC', mode: 'subset' }, { timeZone: 'America/New_York', mode: 'subset' }];

test('P4 inventory covers executable groups and explicitly classifies every view before browser startup', () => {
  const executed = ['host-timezone', ...p4.matchAll(/if \(run\('([^']+)'\)\)/g)].map(entry => typeof entry === 'string' ? entry : entry[1]);
  assert.deepEqual(names(P4_SCENARIOS), executed, 'new executable groups must declare metadata');
  assert.doesNotThrow(() => validateP4Scenarios(P4_SCENARIOS));
  assert.doesNotThrow(() => validateP4Views(P4_VIEWS));
  for (const view of P4_VIEWS) {
    const { zoneSensitive, ...missing } = view;
    for (const invalid of [missing, { ...missing, zoneSensitive: undefined }, { ...missing, zoneSensitive: 'true' }]) {
      assert.throws(() => validateP4Views(P4_VIEWS.map(v => v === view ? invalid : v)), /explicitly declare zoneSensitive/);
    }
    if (['date', 'host'].includes(view.coverage)) {
      assert.throws(() => validateP4Views(P4_VIEWS.map(v => v === view ? { ...v, zoneSensitive: false } : v)), /must be zoneSensitive/);
    }
  }
  assert.throws(() => validateP4Views([...P4_VIEWS, P4_VIEWS[0]]), /unique declared name/);
  assert.throws(() => validateP4Views(P4_VIEWS.filter(v => v.group !== 'host-timezone')), /host-timezone/);
  assert.throws(() => validateP4Views(P4_VIEWS.map(v => v.group === 'budget' ? { ...v, zoneSensitive: true } : v)), /budget/);
  // Literal guards cannot introduce an undeclared view family. Dynamic names
  // are the fixture names, the five gallery cases, and normal/wide-font cards.
  for (const [, group, family] of p4.matchAll(/(?:view|requireView)\('([^']+)', '([^']+)'/g)) {
    assert.ok(P4_VIEWS.some(v => v.group === group && v.family === family), `${group}/${family}`);
  }
  const declaredFamilies = new Set([...p4.matchAll(/(?:view|requireView)\('([^']+)', '([^']+)'/g)].map(([, group, family]) => `${group}/${family}`));
  for (const [group, families] of [
    ['design', ['day', 'month-joe', 'all', 'ytd-joel', 'month']],
    ['fixtures', ['scratches', 'no-losers', 'drawdown', 'empty']],
    ['cards', ['normal', 'wide-font']],
    ['partial-days', ['traded-detail', 'empty-detail', 'single-reason', 'counted', 'desk-filtered-partial', 'desk-filtered-reasoned', 'today-empty-filtered', 'today-no-trades']],
  ]) for (const family of families) {
    assert.ok(p4.includes(`'${family}'`) || family.startsWith('desk-filtered-'), family);
    declaredFamilies.add(`${group}/${family}`);
  }
  for (const v of P4_VIEWS) assert.ok(declaredFamilies.has(`${v.group}/${v.family}`), `unwired inventory entry: ${v.name}`);
  for (const [group, family] of [['design', 'matrix'], ['ingress', 'live-stale-recovery'], ['missing-days', 'closed-open-recovery']]) {
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      assert.ok(P4_VIEWS.some(v => v.name === p4ViewKey(group, family, viewport.name, theme)), 'shared viewport/theme additions need metadata');
    }
  }
  const matrixLoops = [...p4.matchAll(/for \(const viewport of (?:VIEWPORTS|viewports)\) for \(const theme of THEMES\) \{([^\n]*\n[^\n]*)/g)];
  assert.equal(matrixLoops.length, 8);
  for (const [loop] of matrixLoops) assert.match(loop, /if \(!view\('/, 'every width/theme view needs a selection guard');
  assert.ok(p4.indexOf('const selectedViews = selectP4Views(') < p4.indexOf('const browser = await launch('));
});

test('P4 subset keeps host zones, date-bearing representatives and all 14 differing screenshot variants', () => {
  const selected = selectP4Views({ zoneSubset: true });
  const subset = new Set(names(selected));
  for (const group of P4_SCENARIOS.filter(s => s.zoneSensitive)) {
    assert.ok(selected.some(v => v.group === group.name && ['host', 'date'].includes(v.coverage)), group.name);
  }
  // Run 39793917962: retain the exact width/theme variants, including the
  // single-variant differences. Matching screenshot bytes do not exempt dates.
  const differing = [
    ['1024-dark-results-partial-desk-filtered-partial-today', 'partial-days', 'desk-filtered-partial'],
    ['1024-dark-results-partial-desk-filtered-reasoned-today', 'partial-days', 'desk-filtered-reasoned'],
    ['1024-dark-results-partial-today-no-trades', 'partial-days', 'today-no-trades'],
    ['1024-dark-results-partial-trade-panel', 'partial-days', 'traded-detail'],
    ['1024-light-results-partial-counted', 'partial-days', 'counted'],
    ['1024-light-results-partial-single-reason', 'partial-days', 'single-reason'],
    ['1440-dark-results-ingress-live', 'ingress', 'live-stale-recovery'],
    ['1440-dark-results-partial-desk-filtered-reasoned-today', 'partial-days', 'desk-filtered-reasoned'],
    ['1440-dark-results-partial-single-reason', 'partial-days', 'single-reason'],
    ['1440-light-results-day', 'design', 'day'],
    ['1440-light-results-ingress-live', 'ingress', 'live-stale-recovery'],
    ['1440-light-results-kept-mismatch', 'states', 'kept-mismatch'],
    ['1440-light-results-stale', 'states', 'stale-retained'],
    ['390-dark-results-ingress-live', 'ingress', 'live-stale-recovery'],
  ];
  for (const [screenshot, group, family] of differing) {
    const [width, theme] = screenshot.split('-');
    assert.ok(subset.has(p4ViewKey(group, family, width, theme)), screenshot);
  }
  assert.deepEqual(selectP4Views(), P4_VIEWS, 'full mode drops no views or checks');
  assert.deepEqual(names(selectP4Scenarios({ zoneSubset: true, only: ['vienna', 'budget'] })), ['host-timezone', 'vienna']);
  assert.deepEqual(names(selectP4Scenarios({ only: ['budget'] })), ['host-timezone', 'budget']);
  assert.throws(() => selectP4Views({ only: ['typo'] }), /Unknown P4 scenario/);
  // A selected group contains both included and omitted views; group-level
  // zoneSensitive must never override those individual declarations.
  for (const group of ['design', 'trade-amount', 'period-hint', 'partial-days']) {
    assert.ok(P4_VIEWS.some(v => v.group === group && !v.zoneSensitive));
    assert.ok(selected.some(v => v.group === group));
  }
  const tradeRows = selected.filter(v => v.group === 'trade-amount' && v.family === 'rows');
  assert.deepEqual(names(tradeRows), ['trade-amount/rows/1440/light']);
});

test('P4 static counts reconcile to the baseline and record the honest exception to the 30% target', t => {
  const full = summarizeP4Views(P4_VIEWS), subset = summarizeP4Views(selectP4Views({ zoneSubset: true }));
  assert.equal(full.checks, 4954);
  assert.equal(subset.checks, 4610);
  assert.ok(subset.checks < 4936, 'per-view selection improves on the 4936-check group subset');
  if (subset.share > .3) {
    assert.match(P4_SUBSET_EXCEPTION, /Date-bearing matrix checks/);
    assert.match(P4_SUBSET_EXCEPTION, /period hints, partial\/today reasons, missing days/);
    assert.equal(subset.checks, P4_VIEWS.filter(v => ['date', 'host'].includes(v.coverage)).reduce((n, v) => n + v.checks, 0));
  } else assert.ok(subset.share <= .3);
  // New anonymized fixtures join every declared viewport and all their checks.
  const extended = createP4Views(['real-1']);
  assert.doesNotThrow(() => validateP4Views(extended));
  assert.equal(extended.length - P4_VIEWS.length, 5);
  assert.equal(summarizeP4Views(extended).checks - full.checks, 104);
  assert.ok(selectP4Views({ zoneSubset: true }, extended).filter(v => v.family === 'real-1').every(v => v.zoneSensitive));
  t.diagnostic(JSON.stringify({ views: subset.views, fullViews: full.views, checks: subset.checks, share: subset.share, groups: subset.groups }));
});

test('P4 observed view counts detect dropped checks, omitted views and unselected work', () => {
  const views = selectP4Views({ zoneSubset: true });
  const recorder = createP4ViewRecorder(views);
  assert.throws(() => recorder.record(), /outside a declared view/);
  assert.throws(() => recorder.enter('budget/render'), /Unselected P4 view/);
  for (const v of views) {
    recorder.enter(v.name);
    recorder.record(v.checks);
  }
  assert.deepEqual(recorder.errors(), []);
  // Re-entering host checks later accumulates them rather than losing history.
  recorder.enter(views[0].name);
  recorder.record();
  assert.match(recorder.errors().join('\n'), /expected 3 checks; observed 4/);
  const incomplete = createP4ViewRecorder(views);
  incomplete.enter(views[0].name);
  incomplete.record(2);
  assert.match(incomplete.errors().join('\n'), /expected 3 checks; observed 2/);
  assert.match(incomplete.errors().join('\n'), /view not entered/);
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
      const views = selectP4Views({ zoneSubset: run.mode === 'subset' });
      const summary = summarizeP4Views(views);
      assert.equal(section.includes('`budget/render`'), run.mode === 'full');
      for (const name of names(views)) assert.ok(section.includes(`\`${name}\``));
      assert.ok(index.includes(`| ${run.timeZone} | ${run.mode} | ${views.length} | ${summary.checks} | ${(100 * summary.share).toFixed(2)}% |`));
      assert.equal(section.includes('`trade-amount/rows/390/dark`'), run.mode === 'full');
    }
    assert.equal((index.match(/\| passed \|/g) ?? []).length, 3);
    assert.ok(index.includes('4610/4954 checks (93.06% of P4)'));
    assert.ok(index.includes(P4_SUBSET_EXCEPTION));
    for (const g of summarizeP4Views(P4_VIEWS).groups) assert.ok(index.includes(`| ${g.name} | ${g.sensitive} | ${g.independent} |`));
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
    assert.match(index, /\| Europe\/Vienna \| full \| \d+ \| 4954 \| 100\.00% \| failed \|/);
    assert.match(index, /\| UTC \| subset \| \d+ \| 4610 \| 93\.06% \| not run \|/);
  }
});
