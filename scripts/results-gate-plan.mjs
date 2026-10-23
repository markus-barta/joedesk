// Import-free metadata and planning: inspecting the gate must never launch a
// browser. Groups retain the focused CLI; views below own subset selection.
export const P4_SCENARIOS = [
  { name: 'host-timezone', zoneSensitive: true, reason: 'Server, page and dedicated worker host zones; always checked.' },
  { name: 'design', zoneSensitive: true, reason: 'Today, period boundaries, Vienna calendar days and dated trade panels (including the day screenshot).' },
  { name: 'fixtures', zoneSensitive: true, reason: 'Dated records, period anchors and days before tracking.' },
  { name: 'states', zoneSensitive: true, reason: 'Receipt age, stale and retained results, and kept-mismatch views.' },
  { name: 'vienna', zoneSensitive: true, reason: 'Vienna midnight, DST and the 2027-04-01 views.' },
  { name: 'cards', zoneSensitive: false, reason: 'Desk-card alignment and hit areas; the stress labels are injected literal strings.' },
  { name: 'r1', zoneSensitive: true, reason: 'Basis cuts, today, time axes and best/worst calendar days.' },
  { name: 'trade-amount', zoneSensitive: true, reason: 'Trade panels/sheets: one date-cell representative; other variants test amounts, words and geometry.' },
  { name: 'phone-calendar', zoneSensitive: true, reason: 'Vienna day cells, missing-day warnings and dated sheets.' },
  { name: 'ingress', zoneSensitive: true, reason: 'Live ingress, receipt time, the stale boundary and retained age.' },
  { name: 'period-hint', zoneSensitive: true, reason: 'Partial-day counts, today and dated period sentences.' },
  { name: 'partial-days', zoneSensitive: true, reason: 'All partial/today and desk-filtered families, trade panels, counted/single reasons and retained midnight receipts.' },
  { name: 'missing-days', zoneSensitive: true, reason: 'Closed Vienna days, missing-day warnings and the open day.' },
  { name: 'budget', zoneSensitive: false, reason: 'Worker/render performance budget; measured only in full runs.' },
];

export function validateP4Scenarios(scenarios) {
  const names = new Set();
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario.name !== 'string' || !scenario.name || names.has(scenario.name)) {
      throw new Error('Every P4 scenario needs a unique name');
    }
    if (!Object.hasOwn(scenario, 'zoneSensitive') || typeof scenario.zoneSensitive !== 'boolean') {
      throw new Error(`P4 scenario ${scenario.name} must explicitly declare zoneSensitive: true or false`);
    }
    names.add(scenario.name);
  }
  if (!scenarios.some(s => s.name === 'host-timezone' && s.zoneSensitive)) {
    throw new Error('P4 host-timezone must be zoneSensitive and always run');
  }
  if (scenarios.some(s => s.name === 'budget' && s.zoneSensitive)) {
    throw new Error('P4 budget runs only in the full gate');
  }
}

// Counts are static successful-run check counts, reconciled to the 4,954-check
// baseline in run 39793917962. A view is one fixture/interaction at one width
// and theme; a workflow may also capture its sheet, tooltip or detail crop.
// Pure layout views can contain incidental date cells: one representative in
// their group retains those cells in the zone matrix. Date assertions never
// become layout coverage merely because their screenshots matched.
const DESKTOP = [['1440', 'light'], ['1440', 'dark'], ['1024', 'light'], ['1024', 'dark']];
const STANDARD = [...DESKTOP, ['390', 'light'], ['390', 'dark']];
const PHONE = [['390', 'light'], ['390', 'dark'], ['360', 'light'], ['360', 'dark']];
const PAIR = [['1440', 'light'], ['390', 'dark']];
const ALL = [...STANDARD, ['360', 'light'], ['360', 'dark']];
const HINT = [...ALL, ['768', 'light'], ['768', 'dark']];
const auditChecks = width => ['390', '360'].includes(width) ? 19 : 17;
export const p4ViewKey = (group, family, width = '', theme = '') => [group, family, width, theme].filter(Boolean).join('/');

export function createP4Views(realFixtures = []) {
  const views = [];
  const add = (group, family, variants, metadata) => {
    for (const [width, theme] of variants) views.push({
      group, family, width, theme, name: p4ViewKey(group, family, width, theme),
      ...metadata, checks: typeof metadata.checks === 'function' ? metadata.checks(width, theme) : metadata.checks,
    });
  };
  const date = (group, family, variants, checks) => add(group, family, variants, {
    zoneSensitive: true, coverage: 'date', checks, reason: 'Date, Vienna day, today, period boundary or receipt/age behavior.',
  });
  const layout = (group, family, variants, checks, reason) => add(group, family, variants, {
    zoneSensitive: false, coverage: 'layout', checks, reason,
  });
  add('host-timezone', 'hosts', [['', '']], { zoneSensitive: true, coverage: 'host', checks: 3,
    reason: 'Server, page and dedicated worker host zones; always checked.' });
  date('design', 'matrix', STANDARD, w => w === '390' ? 150 : 145);
  for (const [family, width, theme] of [['day', '1440', 'light'], ['month-joe', '1440', 'light'],
    ['all', '1440', 'dark'], ['ytd-joel', '1024', 'dark'], ['month', '390', 'light']]) {
    date('design', family, [[width, theme]], 0);
  }
  layout('design', 'wide-font', [['390', 'light'], ['1024', 'dark'], ['1440', 'light']],
    w => auditChecks(w) + 2, 'Wide-font clipping and geometry only; design/matrix retains date rendering.');
  const fixtureVariants = [['1440', 'light'], ['1440', 'dark'], ['1024', 'dark'], ['390', 'light'], ['390', 'dark']];
  for (const name of ['scratches', 'no-losers', 'drawdown', 'empty', ...realFixtures]) {
    date('fixtures', name, fixtureVariants, w => auditChecks(w) + 3);
  }
  date('fixtures', 'before-tracking', [['1440', 'light']], 1);
  date('states', 'not-received', STANDARD, 3);
  date('states', 'stale-retained', STANDARD.filter(([, t]) => t === 'light'), 2);
  for (const family of ['auth', 'invalid']) date('states', family, STANDARD.filter(([, t]) => t === 'light'), 1);
  date('states', 'kept-mismatch', PAIR, 1);
  date('vienna', 'dst-calendar', PAIR, w => w === '1440' ? 11 : 10);
  layout('cards', 'normal', [['390', 'light'], ['390', 'dark']], 3, 'Literal heartbeat stress strings and desk-card hit areas.');
  layout('cards', 'wide-font', [['390', 'light']], 3, 'Literal heartbeat stress strings in a wide font.');
  for (const family of ['basis', 'money-now']) {
    date('r1', family + '-inputs', [['', '']], 1);
    date('r1', family, PAIR, w => 40 + auditChecks(w));
  }
  date('r1', 'time-axis', PAIR, 4);
  date('r1', 'large-amounts', PAIR, w => 6 + auditChecks(w));
  date('trade-amount', 'ingress', [['', '']], 2);
  date('trade-amount', 'rows', [['1440', 'light']], 35);
  layout('trade-amount', 'rows', ALL.filter(([w, t]) => w !== '1440' || t !== 'light'),
    w => ({ '1440': 35, '1024': 32, '390': 29, '360': 31 })[w],
    'Amounts, prices, words, copy and layout; identical date cells retained by the 1440 light representative.');
  date('phone-calendar', 'contract', [['', '']], 1);
  date('phone-calendar', 'months', PHONE, 111);
  date('phone-calendar', 'desktop', [['1440', 'light']], 11);
  date('ingress', 'live-stale-recovery', STANDARD, 7);
  date('period-hint', 'baseline', HINT, w => ['390', '360'].includes(w) ? 2 : 3);
  date('period-hint', 'partial', HINT, w => w === '1024' ? 124 : 123);
  date('period-hint', 'empty', HINT, w => ['390', '360'].includes(w) ? 7 : 6);
  for (const family of ['no-hint', 'unknown', 'unknown-full', 'cleared']) date('period-hint', family, HINT, 2);
  layout('period-hint', 'literal-wording', HINT, 4, 'Injected literal long sentences: wrapping and unchanged geometry.');
  date('partial-days', 'calendar', ALL, w => 11 + (w === '360' ? 0 : auditChecks(w)));
  date('partial-days', 'traded-detail', ALL, w => ['390', '360'].includes(w) ? 4 : 3);
  date('partial-days', 'empty-detail', ALL, w => ['390', '360'].includes(w) ? 6 : 5);
  for (const family of ['missing-handoff', 'large-summary']) date('partial-days', family, ALL, 3);
  date('partial-days', 'empty-month', ALL, 2);
  date('partial-days', 'nine-reasons', ALL, w => ['390', '360'].includes(w) ? 22 : 5);
  date('partial-days', 'single-reason', ALL, w => ['390', '360'].includes(w) ? 5 : 4);
  date('partial-days', 'counted', ALL, 4);
  date('partial-days', 'three-reasons', ALL, w => ['390', '360'].includes(w) ? 20 : 4);
  date('partial-days', 'growing-reasons', PHONE, 17);
  for (const family of ['desk-filtered-partial', 'desk-filtered-reasoned']) date('partial-days', family, ALL, 5);
  date('partial-days', 'today-without-reasons', ALL, 4);
  date('partial-days', 'today-reason', ALL, 3);
  date('partial-days', 'today-empty-filtered', ALL, 1);
  date('partial-days', 'today-no-trades', ALL, 2);
  layout('partial-days', 'contrast', ALL, 1, 'Computed color contrast of cloned tint cells; no date calculation.');
  date('partial-days', 'retained-midnight', ALL, 2);
  date('missing-days', 'closed-open-recovery', STANDARD, w => 13 + auditChecks(w));
  add('budget', 'render', [['', '']], { zoneSensitive: false, coverage: 'budget', checks: 9,
    reason: 'Worker/render performance budget; measured only in full runs.' });
  return views;
}

export const P4_VIEWS = createP4Views();
// Explicit exception to the 30% target: the retained date-asserting views
// dominate the baseline. Do not label them layout to satisfy a speed target.
export const P4_SUBSET_EXCEPTION = 'Date-bearing matrix checks (including period hints, partial/today reasons, missing days and calendar/date comparisons) remain in every host zone; only pure layout views are excluded. Runtime improvement must be measured on agm2.';

export function validateP4Views(views) {
  validateP4Scenarios(P4_SCENARIOS);
  const names = new Set();
  for (const view of views) {
    if (!view || !view.name || names.has(view.name) || !P4_SCENARIOS.some(s => s.name === view.group) ||
      view.name !== p4ViewKey(view.group, view.family, view.width, view.theme)) throw new Error('Every P4 view needs a unique declared name and group');
    if (!Object.hasOwn(view, 'zoneSensitive') || typeof view.zoneSensitive !== 'boolean') {
      throw new Error(`P4 view ${view.name} must explicitly declare zoneSensitive: true or false`);
    }
    if (!Number.isSafeInteger(view.checks) || view.checks < 0) throw new Error(`Invalid check count for ${view.name}`);
    if (!['host', 'date', 'layout', 'budget'].includes(view.coverage) || !view.reason) throw new Error(`Missing coverage/reason for ${view.name}`);
    if (['host', 'date'].includes(view.coverage) && !view.zoneSensitive) throw new Error(`Date/host view must be zoneSensitive: ${view.name}`);
    if (view.group === 'budget' && view.zoneSensitive) throw new Error('P4 budget runs only in the full gate');
    names.add(view.name);
  }
  if (!views.some(v => v.group === 'host-timezone' && v.zoneSensitive)) throw new Error('P4 host-timezone must always run');
  for (const group of P4_SCENARIOS.filter(s => s.zoneSensitive)) {
    if (!views.some(v => v.group === group.name && v.coverage === (group.name === 'host-timezone' ? 'host' : 'date') && v.zoneSensitive)) {
      throw new Error(`P4 ${group.name} needs a date-bearing representative`);
    }
  }
}

export function selectP4Views({ zoneSubset = false, only = [] } = {}, views = P4_VIEWS) {
  validateP4Views(views);
  for (const name of only) {
    if (!P4_SCENARIOS.some(s => s.name === name)) throw new Error(`Unknown P4 scenario: ${name}`);
  }
  return views.filter(v => v.group === 'host-timezone' ||
    ((!only.length || only.includes(v.group)) && (!zoneSubset || v.zoneSensitive)));
}

export function selectP4Scenarios(options = {}, views = P4_VIEWS) {
  const groups = new Set(selectP4Views(options, views).map(v => v.group));
  return P4_SCENARIOS.filter(s => groups.has(s.name));
}

export function summarizeP4Views(views, full = P4_VIEWS) {
  const checks = views.reduce((n, v) => n + v.checks, 0);
  const fullChecks = full.reduce((n, v) => n + v.checks, 0);
  return { views: views.length, checks, fullChecks, share: checks / fullChecks,
    groups: P4_SCENARIOS.map(s => ({ name: s.name,
      sensitive: full.filter(v => v.group === s.name && v.zoneSensitive).length,
      independent: full.filter(v => v.group === s.name && !v.zoneSensitive).length,
    })) };
}

// Reconcile declared counts against the real gate, including checks emitted
// by the shared craft audit. A forgotten view or a lost check fails CI rather
// than making the static subset look smaller than it is.
export function createP4ViewRecorder(views) {
  const expected = new Map(views.map(v => [v.name, v.checks]));
  const observed = new Map();
  let current;
  return {
    enter(name) {
      if (!expected.has(name)) throw new Error(`Unselected P4 view: ${name}`);
      current = name;
      if (!observed.has(name)) observed.set(name, 0);
    },
    record(count = 1) {
      if (!current) throw new Error('P4 check outside a declared view');
      observed.set(current, observed.get(current) + count);
    },
    counts() { return Object.fromEntries(observed); },
    errors() {
      return [...expected].flatMap(([name, checks]) => observed.has(name) && observed.get(name) === checks ? [] :
        [`${name}: expected ${checks} checks; observed ${observed.has(name) ? observed.get(name) : 'view not entered'}`]);
    },
  };
}

// Preserve the positional CLI and its local defaults. Explicit mode flags
// apply to the following zone(s), up to the next flag; validate the entire
// plan before creating artifacts or starting the first child.
export function parseResultsGateArgs(args) {
  if (!args.length) args = ['UTC', 'America/New_York'];
  const explicit = args.some(arg => arg.startsWith('--'));
  const plan = [];
  let mode = explicit ? null : 'full', needsZone = false;
  for (const arg of args) {
    if (arg === '--full' || arg === '--subset') {
      if (needsZone) throw new Error(`--${mode} requires a time zone`);
      mode = arg.slice(2);
      needsZone = true;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown Results gate option: ${arg}`);
    if (!mode) throw new Error('Use positional zones alone, or introduce every group with --full/--subset');
    new Intl.DateTimeFormat('en', { timeZone: arg });
    if (plan.some(run => run.timeZone === arg)) throw new Error(`Duplicate Results gate zone: ${arg}`);
    plan.push({ timeZone: arg, mode });
    needsZone = false;
  }
  if (needsZone) throw new Error(`--${mode} requires a time zone`);
  return plan;
}
