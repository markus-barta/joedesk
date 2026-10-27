// Checkout-only planning. Importing this module never starts a browser.
export function parseBoardSweepArgs(args) {
  if (!args.length) return 'full';
  if (args.length === 1 && ['--full', '--subset'].includes(args[0])) return args[0].slice(2);
  throw new Error('Board gate: use --full or --subset');
}

export function createBoardSweepPlan({ mode = 'full', css, javascript, compact }) {
  if (!['full', 'subset'].includes(mode)) throw new Error(`Unknown Board sweep mode: ${mode}`);
  const gridWidths = Array.from({ length: (1440 - 360) / 10 + 1 }, (_, i) => 360 + i * 10);
  // Only viewport queries belong here: card @container and history.js clientWidth thresholds
  // describe element boxes, not viewports. The full light grid still tests their geometry.
  const queries = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media\b([^{}]+)/g)].map(m => m[1]);
  const cssQueryCount = queries.length;
  for (const source of javascript) {
    const calls = [...source.matchAll(/\bmatchMedia\s*\(/g)];
    const literals = [...source.matchAll(/\bmatchMedia\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g)];
    if (calls.length !== literals.length) throw new Error('Unsupported dynamic matchMedia query; declare its sweep boundary');
    queries.push(...literals.map(m => m[2]));
  }
  const breakpoints = new Set([compact]);
  for (const query of queries) {
    const widths = [...query.matchAll(/\(\s*(?:min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/g)];
    // A new unit/range syntax must be handled deliberately, never silently
    // omitted from the subset. Other media features do not affect this list.
    if (/\bwidth\b/.test(query.replace(/\(\s*(?:min|max)-width\s*:\s*\d+(?:\.\d+)?px\s*\)/g, ''))) {
      throw new Error(`Unsupported viewport width query: ${query}`);
    }
    for (const match of widths) breakpoints.add(Number(match[1]));
  }
  if (!Number.isFinite(compact) || !queries.slice(0, cssQueryCount).some(q =>
    [...q.matchAll(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/g)].some(m => Number(m[1]) === compact))) {
    throw new Error('COMPACT must match a CSS viewport breakpoint');
  }
  const boundaryWidths = [...new Set([360, 1024, 1440, ...[...breakpoints].flatMap(w => [w - 10, w, w + 10])])]
    .filter(w => w >= 360 && w <= 1440).sort((a, b) => a - b);
  const fullWidths = [...new Set([...gridWidths, ...boundaryWidths])].sort((a, b) => a - b);
  const variants = ['light', 'dark'].flatMap(theme => [false, true].flatMap(wide =>
    ['desk', 'results', 'history', 'settings'].map(screen => ({ theme, wide, screen,
      widths: mode === 'full' ? fullWidths : theme === 'dark' ? boundaryWidths : gridWidths }))));
  return { mode, gridWidths, fullWidths, boundaryWidths, breakpoints: [...breakpoints].sort((a, b) => a - b), variants,
    // One fixture check, then eight checks per screen plus two for Desk.
    checks: 1 + variants.reduce((n, v) => n + 8 + (v.screen === 'desk' ? 2 : 0), 0),
    screenshots: 6, rounds: variants.reduce((n, v) => n + v.widths.length, 0) };
}

// Reconcile both plans to actual execution, including every width per view.
// A lost/extra check, screenshot or resize fails the gate without adding checks.
export function boardSweepErrors(plan, { checks, screenshots, rounds }) {
  const expected = plan.variants.flatMap(v => v.widths.map(width => `${v.theme}/${v.wide}/${v.screen}/${width}`));
  const errors = [];
  for (const [name, actual, wanted] of [['checks', checks, plan.checks], ['screenshots', screenshots, plan.screenshots]]) {
    if (actual !== wanted) errors.push(`sweep ${plan.mode}: expected ${wanted} ${name}; observed ${actual}`);
  }
  if (expected.length !== rounds.length || expected.some((key, i) => key !== rounds[i])) {
    errors.push(`sweep ${plan.mode}: width/theme/font/screen execution differs from the ${expected.length}-round plan (observed ${rounds.length})`);
  }
  return errors;
}

export function boardSweepTable(plan, ran) {
  return `## Width sweep plan

Plan: **${plan.mode}**; ${ran ? 'executed' : 'not selected (JOED_P3_ONLY)'}. Both fonts and all four screens.
Light: ${plan.mode === 'full' ? `${plan.fullWidths.length} widths: the ${plan.gridWidths.length}-width 360–1440 px grid in 10 px steps ∪ the boundary widths below` : `${plan.gridWidths.length} widths, 360–1440 px in 10 px steps`}.
Dark: ${plan.mode === 'full' ? 'the same grid ∪ boundary widths' : `${plan.boundaryWidths.length} boundary widths only`}.
Boundary widths (${plan.boundaryWidths.length}): ${plan.boundaryWidths.join(', ')} px.
Boundaries: app.css viewport @media queries and public/joe/*.js matchMedia queries, each ±10 px, plus COMPACT and 360/1024/1440.
Card @container queries and history.js clientWidth thresholds describe element widths; the full light grid covers their geometry.
Expected sweep: ${plan.checks} checks, ${plan.screenshots} screenshots, ${plan.rounds} resize/measure rounds.
Check names retain the full-grid inventory description in both plans; this table records the widths actually selected.
`;
}
