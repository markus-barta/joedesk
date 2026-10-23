// Import-free metadata and planning: inspecting the gate must never launch a
// browser. Groups retain the focused CLI; views below own subset selection.
// Scenario flags describe date content, not a requirement to select the group.
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

// Counts are static successful-run check counts, reconciled to the 4,957-check
// baseline in run 39929690916 (including fresh check-ins). A view is one fixture/interaction at one width
// and theme; a workflow may also capture its sheet, tooltip or detail crop.
// coverage describes what a view tests, independently of zone selection.
// Repeated date assertions stay in the full run; the subset below covers
// each date code path once, plus measured variants and required setup.
const DESKTOP = [['1440', 'light'], ['1440', 'dark'], ['1024', 'light'], ['1024', 'dark']];
const STANDARD = [...DESKTOP, ['390', 'light'], ['390', 'dark']];
const PHONE = [['390', 'light'], ['390', 'dark'], ['360', 'light'], ['360', 'dark']];
const PAIR = [['1440', 'light'], ['390', 'dark']];
const ALL = [...STANDARD, ['360', 'light'], ['360', 'dark']];
const HINT = [...ALL, ['768', 'light'], ['768', 'dark']];
const auditChecks = width => ['390', '360'].includes(width) ? 19 : 17;
export const p4ViewKey = (group, family, width = '', theme = '') => [group, family, width, theme].filter(Boolean).join('/');

// Call-site families found in public/joe/*.js, scoped to Results and the
// shared board shell it renders. Each path has ONE exercised representative.
// Width/theme variations of the same helper are not additional date paths.
export const P4_DATE_PATHS = [
  { name: 'wall-clock-formatters', source: 'format.js: parts, timeHM, dateTimeFull; app.js: renderHeader', representative: 'design/matrix/1440/light' },
  { name: 'calendar-day-labels', source: 'results-model.js: fmtDM, fmtDDM, fmtDay; results.js: renderCalendar', representative: 'design/matrix/1440/light' },
  { name: 'period-labels-and-stepping', source: 'results-model.js: periodOf, rangeLabel, stepAnchor, addDays, monday, daysIn', representative: 'design/matrix/1440/light' },
  { name: 'best-worst-day-labels', source: 'results.js: dayTile', representative: 'r1/large-amounts/1440/light' },
  { name: 'today-money-boundary', source: 'results.js: resultsView; results-model.js: equityAt, moneyContext', representative: 'r1/money-now/1440/light' },
  { name: 'basis-cut-date', source: 'results.js: cutText; results-model.js: moneyContext, viennaMidnight', representative: 'r1/basis/1440/light' },
  { name: 'chart-day-session-and-times', source: 'results-model.js: dayWindow, intraday; results.js: renderCurve', representative: 'design/matrix/1440/light' },
  { name: 'chart-period-midnights-and-gaps', source: 'results-model.js: curve, viennaMidnight; results.js: renderCurve', representative: 'r1/time-axis/1440/light' },
  { name: 'tracking-start-date', source: 'results.js: startText, heroSentence, dayState', representative: 'fixtures/before-tracking/1440/light' },
  { name: 'closed-partial-days', source: 'results-model.js: countPartialDays; results.js: partialDay, dayWarning', representative: 'partial-days/calendar/1440/light' },
  { name: 'open-today-partial', source: 'results.js: dayWarning, dayContent', representative: 'partial-days/today-reason/1440/light' },
  { name: 'missing-closed-and-open-days', source: 'results.js: missingDayText, dayWarning, dayState', representative: 'missing-days/closed-open-recovery/1440/light' },
  { name: 'period-partial-day-hints', source: 'results.js: renderHero, renderCalendar; results-model.js: countPartialDays', representative: 'period-hint/partial/1440/light' },
  { name: 'trade-open-close-and-held', source: 'results.js: held, tradeRows; format.js: timeHM', representative: 'trade-amount/rows/1440/light' },
  { name: 'open-position-today-time', source: 'results.js: dayContent; results-model.js: viennaDate', representative: 'partial-days/desk-filtered-reasoned/1440/light' },
  { name: 'receipt-ingress-clock', source: 'feed.js: serverClock, createFeed; history-worker.js: serverClock, clockNow', representative: 'ingress/live-stale-recovery/1440/light' },
  { name: 'stale-retained-ago', source: 'results.js: renderStatus; format.js: age; ui.js: ageSpan', representative: 'states/stale-retained/1440/light' },
  { name: 'worker-date-indexing', source: 'history-worker.js: pollResults; results-model.js: indexResults, viennaDate', representative: 'ingress/live-stale-recovery/1440/light' },
  { name: 'today-rollover-retained-receipt', source: 'results.js: resultsToday, renderResults; results-model.js: addDays', representative: 'partial-days/retained-midnight/1440/light' },
  { name: 'vienna-dst-and-2027-04-01', source: 'results-model.js: viennaDate, marketHoliday; results.js: renderCalendar, tradeRows', representative: 'vienna/dst-calendar/1440/light' },
];

// Exact differing width/theme views from run 39793917962 (14/231 screens).
// Preserve their associated checks even if a difference was render noise.
export const P4_ZONE_VARIANTS = [
  'partial-days/desk-filtered-partial/1024/dark',
  'partial-days/desk-filtered-reasoned/1024/dark',
  'partial-days/today-no-trades/1024/dark',
  'partial-days/traded-detail/1024/dark',
  'partial-days/counted/1024/light',
  'partial-days/single-reason/1024/light',
  'ingress/live-stale-recovery/1440/dark',
  'partial-days/desk-filtered-reasoned/1440/dark',
  'partial-days/single-reason/1440/dark',
  'design/day/1440/light',
  'ingress/live-stale-recovery/1440/light',
  'states/kept-mismatch/1440/light',
  'states/stale-retained/1440/light',
  'ingress/live-stale-recovery/390/dark',
];

export const P4_VIEW_DEPENDENCIES = [
  { view: 'trade-amount/rows/1440/light', requires: 'trade-amount/ingress', reason: 'Validate the trade fixture before rendering its rows.' },
  { view: 'period-hint/partial/1440/light', requires: 'period-hint/baseline/1440/light', reason: 'Compare the hint against its unhinted chart and geometry.' },
];

export function createP4Views(realFixtures = []) {
  const views = [];
  const add = (group, family, variants, metadata) => {
    for (const [width, theme] of variants) views.push({
      group, family, width, theme, name: p4ViewKey(group, family, width, theme),
      ...metadata, checks: typeof metadata.checks === 'function' ? metadata.checks(width, theme) : metadata.checks,
    });
  };
  const date = (group, family, variants, checks) => add(group, family, variants, {
    zoneSensitive: false, coverage: 'date', checks, reason: 'Repeated date-path coverage in the full Vienna run.',
  });
  const layout = (group, family, variants, checks, reason) => add(group, family, variants, {
    zoneSensitive: false, coverage: 'layout', checks, reason,
  });
  add('host-timezone', 'hosts', [['', '']], { zoneSensitive: true, coverage: 'host', checks: 3,
    reason: 'Server, page and dedicated worker host zones; always checked.' });
  // JOED-77: 18 info/geometry checks plus geometry at 20 period/desk switches.
  date('design', 'matrix', STANDARD, w => w === '390' ? 188 : 183);
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
  layout('cards', 'normal', [['390', 'light'], ['390', 'dark']], 4, 'Fresh check-ins hidden, then stale heartbeat stress strings and desk-card hit areas.');
  layout('cards', 'wide-font', [['390', 'light']], 4, 'Fresh check-ins hidden, then stale heartbeat stress strings in a wide font.');
  for (const family of ['basis', 'money-now']) {
    date('r1', family + '-inputs', [['', '']], 1);
    date('r1', family, PAIR, w => 40 + auditChecks(w));
  }
  date('r1', 'time-axis', PAIR, 4);
  date('r1', 'large-amounts', PAIR, w => 7 + auditChecks(w));
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
  for (const view of views) {
    view.datePaths = P4_DATE_PATHS.filter(path => path.representative === view.name).map(path => path.name);
    const measured = P4_ZONE_VARIANTS.includes(view.name);
    const dependencies = P4_VIEW_DEPENDENCIES.filter(d => d.requires === view.name);
    if (view.datePaths.length || measured || dependencies.length) {
      view.zoneSensitive = true;
      view.reason = [view.datePaths.length ? `Date paths: ${view.datePaths.join(', ')}.` : '',
        measured ? 'Measured zone-variant screenshot (run 39793917962).' : '',
        ...dependencies.map(d => `Setup for ${d.view}: ${d.reason}`)].filter(Boolean).join(' ');
    }
  }
  return views;
}

export const P4_VIEWS = createP4Views();

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
    if (view.coverage === 'host' && !view.zoneSensitive) throw new Error(`Host view must be zoneSensitive: ${view.name}`);
    if (view.group === 'budget' && view.zoneSensitive) throw new Error('P4 budget runs only in the full gate');
    names.add(view.name);
  }
  if (!views.some(v => v.group === 'host-timezone' && v.zoneSensitive)) throw new Error('P4 host-timezone must always run');
  for (const path of P4_DATE_PATHS) {
    if (!views.some(v => v.name === path.representative && v.zoneSensitive && v.datePaths?.includes(path.name))) {
      throw new Error(`P4 date path ${path.name} needs its declared representative: ${path.representative}`);
    }
  }
  for (const name of P4_ZONE_VARIANTS) {
    if (!views.some(v => v.name === name && v.zoneSensitive)) throw new Error(`P4 measured zone variant must run: ${name}`);
  }
  for (const dependency of P4_VIEW_DEPENDENCIES) {
    if (views.some(v => v.name === dependency.view && v.zoneSensitive) &&
      !views.some(v => v.name === dependency.requires && v.zoneSensitive)) {
      throw new Error(`P4 ${dependency.view} requires ${dependency.requires}`);
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
