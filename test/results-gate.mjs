import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { P4_SCENARIOS, P4_VIEWS, P4_DATE_PATHS, P4_ZONE_VARIANTS, P4_VIEW_DEPENDENCIES, createP4Views, createP4ViewRecorder, p4ViewKey, validateP4Scenarios, validateP4Views, selectP4Scenarios, selectP4Views, summarizeP4Views, parseResultsGateArgs } from '../scripts/results-gate-plan.mjs';
import { runResultsGate } from '../scripts/run-results-gate.mjs';
import { realResultsFixtures } from '../scripts/results-fixtures.mjs';
import { VIEWPORTS, THEMES } from '../scripts/browser/shots.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';

const p4 = readFileSync(new URL('../scripts/browser-p4.mjs', import.meta.url), 'utf8');
const names = scenarios => scenarios.map(s => s.name);
const prArgs = ['--full', 'Europe/Vienna', '--subset', 'UTC', 'America/New_York'];
const prPlan = [{ timeZone: 'Europe/Vienna', mode: 'full' }, { timeZone: 'UTC', mode: 'subset' }, { timeZone: 'America/New_York', mode: 'subset' }];
const realFixtureNames = realResultsFixtures().map(f => f.name);
const fullViews = createP4Views(realFixtureNames);

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
    if (view.coverage === 'host') {
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
  for (const [loop] of matrixLoops) assert.match(loop, /if \(!(?:view|hasViews)\('/, 'every width/theme view needs a selection guard');
  assert.ok(p4.indexOf('const selectedViews = selectP4Views(') < p4.indexOf('const browser = await launch('));
});

test('P4 subset keeps host zones and all 14 differing screenshot variants', () => {
  const selected = selectP4Views({ zoneSubset: true });
  const subset = new Set(names(selected));
  // Run 39793917962: retain the exact width/theme variants, including the
  // single-variant differences. Other date views are covered by code path.
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
  assert.deepEqual([...P4_ZONE_VARIANTS].sort(), differing.map(([screenshot, group, family]) => {
    const [width, theme] = screenshot.split('-');
    return p4ViewKey(group, family, width, theme);
  }).sort());
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
  for (const name of P4_ZONE_VARIANTS) {
    assert.throws(() => validateP4Views(P4_VIEWS.map(v => v.name === name ? { ...v, zoneSensitive: false } : v)), /date path|zone variant/);
  }
});

test('every documented date code path declares exactly one exercised representative in the subset', () => {
  // Static only: importing/parsing the plan and README never loads app code,
  // starts a server, launches Chrome or computes dates via the host zone.
  const plan = readFileSync(new URL('../scripts/results-gate-plan.mjs', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const declared = [...plan.matchAll(/\{ name: '([^']+)', source: '([^']+)', representative: '([^']+)' \}/g)]
    .map(([, name, source, representative]) => ({ name, source, representative }));
  const documented = [...readme.matchAll(/^\| `([^`]+)` \| (.+) \| `([^`]+)` \|$/gm)]
    .map(([, name, , representative]) => ({ name, representative }));
  assert.deepEqual(declared, P4_DATE_PATHS);
  assert.ok(declared.length > 0);
  assert.deepEqual(documented, declared.map(({ name, representative }) => ({ name, representative })));
  assert.equal(new Set(declared.map(path => path.name)).size, declared.length);
  const selected = selectP4Views({ zoneSubset: true });
  for (const path of declared) {
    const representatives = selected.filter(v => v.datePaths.includes(path.name));
    assert.deepEqual(names(representatives), [path.representative], path.name);
    assert.equal(representatives[0].width, '1440', path.name);
    assert.equal(representatives[0].theme, 'light', path.name);
    assert.ok(representatives[0].checks > 0, `${path.name}: actually asserted, not just a screenshot`);
    for (const source of path.source.split('; ')) {
      const [file, helpers] = source.split(': ');
      const content = readFileSync(new URL(`../public/joe/${file}`, import.meta.url), 'utf8');
      for (const helper of helpers.split(', ')) assert.match(content, new RegExp(`\\b${helper}\\b`), path.source);
    }
    assert.throws(() => validateP4Views(P4_VIEWS.map(v => v.name === path.representative ? { ...v, zoneSensitive: false } : v)), /date path/);
    assert.throws(() => validateP4Views(P4_VIEWS.map(v => v.name === path.representative ? { ...v, datePaths: [] } : v)), /date path/);
  }
  for (const dependency of P4_VIEW_DEPENDENCIES) {
    assert.ok(selected.some(v => v.name === dependency.requires), dependency.requires);
    assert.throws(() => validateP4Views(P4_VIEWS.map(v => v.name === dependency.requires ? { ...v, zoneSensitive: false } : v)), /requires/);
  }
  const expected = new Set(['host-timezone/hosts', ...P4_ZONE_VARIANTS,
    ...declared.map(path => path.representative), ...P4_VIEW_DEPENDENCIES.map(d => d.requires)]);
  assert.deepEqual(names(selected).sort(), [...expected].sort(), 'no repeated date-bearing views without a named path, measured variant or dependency');
  // Stateful families now guard independent transitions; keeping the old
  // requireView calls would force the full workflow back into the subset.
  assert.doesNotMatch(p4, /requireView\('(?:states|partial-days)'/);
  assert.match(p4, /if \(calendarSelected\) \{/);
  assert.match(p4, /if \(!hasViews\('period-hint'/);
});

test('P4 static counts reconcile to the baseline plus real fixtures and the subset stays at most 25%', t => {
  const baseline = summarizeP4Views(P4_VIEWS), full = summarizeP4Views(fullViews, fullViews);
  const subsetViews = selectP4Views({ zoneSubset: true }, fullViews);
  const subset = summarizeP4Views(subsetViews, fullViews);
  assert.equal(baseline.checks, 5187);
  assert.equal(full.views, baseline.views + 5 * realFixtureNames.length);
  assert.equal(full.checks, baseline.checks + 104 * realFixtureNames.length);
  for (const name of realFixtureNames) {
    assert.equal(fullViews.filter(v => v.family === name).length, 5);
    assert.equal(subsetViews.filter(v => v.family === name).length, 0);
  }
  assert.ok(subset.share <= .25, `${subset.checks}/${full.checks} exceeds 25%`);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`**${subset.views}/${full.views} views and ${subset.checks.toLocaleString('en-US')}/${full.checks.toLocaleString('en-US')} checks (${(100 * subset.share).toFixed(2)}%)**`));
  for (const group of subset.groups) assert.ok(readme.includes(`| ${group.name} | ${group.sensitive} | ${group.independent} |`));
  assert.ok(P4_VIEWS.some(v => v.coverage === 'date' && !v.zoneSensitive), 'reused date paths run only in full Vienna');
  // New anonymized fixtures join every declared viewport and all their checks.
  const nextFixture = `real-${realFixtureNames.length + 1}`;
  const extended = createP4Views([...realFixtureNames, nextFixture]);
  assert.doesNotThrow(() => validateP4Views(extended));
  assert.equal(extended.length - fullViews.length, 5);
  assert.equal(summarizeP4Views(extended, extended).checks - full.checks, 104);
  assert.equal(selectP4Views({}, extended).filter(v => v.family === nextFixture).length, 5);
  assert.equal(selectP4Views({ zoneSubset: true }, extended).filter(v => v.family === nextFixture).length, 0);
  assert.equal(summarizeP4Views(selectP4Views({ zoneSubset: true }, extended), extended).checks, subset.checks);
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
      const views = selectP4Views({ zoneSubset: run.mode === 'subset' }, fullViews);
      const summary = summarizeP4Views(views, fullViews);
      assert.equal(section.includes('`budget/render`'), run.mode === 'full');
      for (const name of names(views)) assert.ok(section.includes(`\`${name}\``));
      assert.ok(index.includes(`| ${run.timeZone} | ${run.mode} | ${views.length} | ${summary.checks} | ${(100 * summary.share).toFixed(2)}% |`));
      assert.equal(section.includes('`trade-amount/rows/390/dark`'), run.mode === 'full');
    }
    assert.equal((index.match(/\| passed \|/g) ?? []).length, 3);
    const subset = summarizeP4Views(selectP4Views({ zoneSubset: true }, fullViews), fullViews);
    assert.ok(index.includes(`${subset.checks}/${subset.fullChecks} checks (${(100 * subset.share).toFixed(2)}% of P4)`));
    for (const path of P4_DATE_PATHS) assert.ok(index.includes(`| ${path.name} | \`${path.representative}\` |`));
    for (const g of summarizeP4Views(fullViews, fullViews).groups) assert.ok(index.includes(`| ${g.name} | ${g.sensitive} | ${g.independent} |`));
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
    const full = summarizeP4Views(fullViews, fullViews);
    assert.ok(index.includes(`| Europe/Vienna | full | ${full.views} | ${full.checks} | 100.00% | failed |`));
    const subset = summarizeP4Views(selectP4Views({ zoneSubset: true }, fullViews), fullViews);
    assert.ok(index.includes(`| UTC | subset | ${subset.views} | ${subset.checks} | ${(100 * subset.share).toFixed(2)}% | not run |`));
  }
});
