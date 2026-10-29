import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parseBoardSweepArgs, createBoardSweepPlan, boardSweepErrors, boardSweepTable } from '../scripts/board-sweep-plan.mjs';

const p3 = readFileSync(new URL('../scripts/browser-p3.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
const javascript = readdirSync(new URL('../public/joe/', import.meta.url)).filter(n => n.endsWith('.js'))
  .map(n => readFileSync(new URL(`../public/joe/${n}`, import.meta.url), 'utf8'));
const compact = Number(/const COMPACT = (\d+);/.exec(p3)[1]);
const plan = mode => createBoardSweepPlan({ mode, css, javascript, compact });
const keys = p => p.variants.flatMap(v => v.widths.map(width => `${v.theme}/${v.wide}/${v.screen}/${width}`));

test('Board sweep: CLI defaults to full and rejects ambiguous or unknown plans before browser startup', () => {
  assert.equal(parseBoardSweepArgs([]), 'full');
  assert.equal(parseBoardSweepArgs(['--full']), 'full');
  assert.equal(parseBoardSweepArgs(['--subset']), 'subset');
  for (const args of [['--ful'], ['--subset', '--full'], ['--subset', 'extra'], ['push']]) {
    assert.throws(() => parseBoardSweepArgs(args), /use --full or --subset/);
  }
  assert.ok(p3.indexOf('parseBoardSweepArgs(process.argv.slice(2))') < p3.indexOf('mkdirSync(QA_DIR'));
});

test('Board sweep: full adds code-derived boundaries in both themes/fonts; every PR round is covered on main', () => {
  const full = plan('full'), subset = plan('subset');
  assert.deepEqual(subset.breakpoints, [382, 480, 700, 701, 900, 960, 1100, 1180, 1181]);
  assert.deepEqual(subset.boundaryWidths, [360, 372, 382, 392, 470, 480, 490, 690, 691, 700, 701, 710, 711,
    890, 900, 910, 950, 960, 970, 1024, 1090, 1100, 1110, 1170, 1171, 1180, 1181, 1190, 1191, 1440]);
  assert.equal(subset.variants.length, 16);
  assert.equal(full.gridWidths.length, 109);
  assert.ok(full.gridWidths.every((w, i) => w === 360 + i * 10));
  assert.deepEqual(full.fullWidths, [...new Set([...full.gridWidths, ...full.boundaryWidths])].sort((a, b) => a - b));
  assert.equal(full.fullWidths.length, 119);
  assert.ok(full.variants.every(v => v.widths === full.fullWidths));
  assert.ok(subset.variants.filter(v => v.theme === 'light').every(v => v.widths === subset.gridWidths));
  assert.ok(subset.variants.filter(v => v.theme === 'dark').every(v => v.widths === subset.boundaryWidths));
  const fullKeys = new Set(keys(full));
  assert.ok(keys(subset).every(key => fullKeys.has(key)), 'every PR theme/font/screen/width runs on main');
  for (const p of [full, subset]) {
    assert.equal(p.checks, 137);
    assert.equal(p.screenshots, 6);
    assert.ok(p.boundaryWidths.every(w => w >= 360 && w <= 1440));
  }
  assert.equal(full.rounds, 1904);
  assert.equal(subset.rounds, 1112);
  const future = createBoardSweepPlan({ mode: 'subset', compact, css: `${css}\n@media (max-width: 1230px) { .x { color: red; } }`,
    javascript: [...javascript, "matchMedia('(max-width: 810px)')"] });
  for (const w of [800, 810, 820, 1220, 1230, 1240]) {
    assert.ok(future.boundaryWidths.includes(w), `new breakpoint: ${w}`);
    assert.ok(future.fullWidths.includes(w), `new full-plan boundary: ${w}`);
  }
  assert.ok(!subset.breakpoints.includes(339.98), 'container width is not a viewport width');
  for (const query of ['(max-width: 60em)', '(width <= 800px)']) {
    assert.throws(() => createBoardSweepPlan({ css: `${css}\n@media ${query} { .x {} }`, javascript, compact }), /Unsupported viewport/);
  }
  assert.throws(() => createBoardSweepPlan({ css, javascript: [...javascript, 'matchMedia(dynamicQuery)'], compact }), /Unsupported dynamic/);
  assert.throws(() => createBoardSweepPlan({ css, javascript, compact: 1234 }), /COMPACT must match/);
});

test('Board sweep: actual-count reconciliation rejects missing/extra checks, captures and resize variants in both plans', () => {
  for (const mode of ['full', 'subset']) {
    const p = plan(mode), counts = { checks: p.checks, screenshots: p.screenshots, rounds: keys(p) };
    assert.deepEqual(boardSweepErrors(p, counts), []);
    for (const field of ['checks', 'screenshots']) for (const delta of [-1, 1]) {
      assert.equal(boardSweepErrors(p, { ...counts, [field]: counts[field] + delta }).length, 1);
    }
    for (const rounds of [counts.rounds.slice(1), [...counts.rounds, counts.rounds[0]],
      [counts.rounds[1], counts.rounds[0], ...counts.rounds.slice(2)]]) {
      assert.match(boardSweepErrors(p, { ...counts, rounds }).join(), /width\/theme\/font\/screen execution differs/);
    }
    assert.match(boardSweepTable(p, true), new RegExp(`Plan: \\*\\*${mode}\\*\\*; executed`));
    assert.match(boardSweepTable(p, false), /not selected/);
    assert.match(boardSweepTable(p, true), new RegExp(`Expected sweep: 137 checks, 6 screenshots, ${p.rounds} resize/measure rounds`));
    assert.match(boardSweepTable(p, true), /Boundary widths \(30\): 360, 372, 382, 392, 470/);
    assert.match(boardSweepTable(p, true), mode === 'full' ? /Light: 119 widths: the 109-width .* ∪ the boundary widths below/ : /Light: 109 widths, 360–1440 px in 10 px steps/);
  }
});

// Execute the real sweep block with synthetic CDP/audit replies. This proves
// loop selection, stable check identities, six captures and count wiring;
// no browser, server, clock delay or artifact directory is needed.
async function executeSweep(mode) {
  const sweepPlan = plan(mode), results = [], shots = [], sweepErrors = [], observed = [];
  let viewport, theme, wide = false, screen = 'desk';
  const context = { sweepPlan, results, shots, sweepErrors, sweepRan: false, COMPACT: compact,
    THEMES: (await import('../scripts/browser/shots.mjs')).THEMES, WIDE_FONT: 'wide', VIEWPORTS: [{ width: 1440 }], NOW: 'fixture', HEALTH_LINES: ['a', 'b', 'c', 'd'],
    boardSweepErrors, run: name => name === 'sweep', scenario: () => ({ snapshot: {}, history: {} }), at: () => 'fixture',
    fmt: { age: () => 'fixture' }, newBoard: async () => ({ setNow() {}, push: async () => ({ status: 200 }), url: 'fixture' }),
    configure: async (_, v, t) => { viewport = v; theme = t; }, load: async (_, __, s) => { screen = s; wide = false; },
    go: async (_, s) => { screen = s; }, settle: async () => {}, setDeskDisclosures: async () => {}, TOUCH: 'touch', MOUSE: 'mouse',
    pointerMedia: async () => viewport.width <= 700 ? 'touch' : 'mouse',
    page: { evaluate: async source => {
      if (source.startsWith('__audit.sweep(')) {
        observed.push(`${theme}/${wide}/${screen}/${viewport.width}`);
        return { scroll: viewport.width, inner: viewport.width, past: [], header: [], nav: true, targets: [], icons: [], overlaps: [], labels: [], cards: [] };
      }
      if (source.includes("setProperty('--font'")) wide = true;
    } },
    check: (ac, name, ok) => results.push({ ac, name, ok }),
    shot: async (_, __, name) => shots.push(name),
  };
  const start = p3.indexOf("  if (run('sweep')) {");
  const block = p3.slice(start, p3.indexOf("  if (run('history')) {", start));
  await runInNewContext(`(async () => { ${block} })()`, context);
  assert.equal(context.sweepRan, true);
  assert.equal(results.length, sweepPlan.checks);
  assert.ok(results.every(r => r.ok));
  assert.ok(results.some(r => r.name === 'sweep light desk: no horizontal page scroll at any of 109 widths from 360 to 1440 px'), 'retain the existing grid-based check name');
  assert.equal(shots.length, sweepPlan.screenshots);
  assert.deepEqual(sweepErrors, []);
  assert.deepEqual(observed, keys(sweepPlan));
  return { results, shots };
}

test('Board sweep: executable full/subset loops reconcile and retain identical checks and screenshots', async () => {
  assert.deepEqual(await executeSweep('subset'), await executeSweep('full'));
});

test('Board CI: only PRs choose subset; main pushes and workflow_dispatch choose full', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const runLine = /^        run: node scripts\/browser-p3\.mjs (.+)$/m.exec(workflow)?.[1];
  assert.ok(runLine);
  const evaluate = new Function('github', `return (${runLine.slice(3, -2)});`);
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    const argument = evaluate({ event_name: event });
    assert.equal(parseBoardSweepArgs([argument]), event === 'pull_request' ? 'subset' : 'full');
  }
});
