// Import-free metadata and planning: inspecting the gate must never launch a
// browser. Each entry names one complete scenario group in browser-p4.mjs.
export const P4_SCENARIOS = [
  { name: 'host-timezone', zoneSensitive: true, reason: 'Server, page and dedicated worker host zones; always checked.' },
  { name: 'design', zoneSensitive: true, reason: 'Today, period boundaries, Vienna calendar days and dated trade panels (including the day screenshot).' },
  { name: 'fixtures', zoneSensitive: true, reason: 'Dated records, period anchors and days before tracking.' },
  { name: 'states', zoneSensitive: true, reason: 'Receipt age, stale and retained results, and kept-mismatch views.' },
  { name: 'vienna', zoneSensitive: true, reason: 'Vienna midnight, DST and the 2027-04-01 views.' },
  { name: 'cards', zoneSensitive: false, reason: 'Desk-card alignment and hit areas; the stress labels are injected literal strings.' },
  { name: 'r1', zoneSensitive: true, reason: 'Basis cuts, today, time axes and best/worst calendar days.' },
  { name: 'trade-amount', zoneSensitive: true, reason: 'Dated trade panels and sheets, including rendered close times; keep all geometry checks too.' },
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

export function selectP4Scenarios({ zoneSubset = false, only = [] } = {}, scenarios = P4_SCENARIOS) {
  validateP4Scenarios(scenarios);
  for (const name of only) {
    if (!scenarios.some(s => s.name === name)) throw new Error(`Unknown P4 scenario: ${name}`);
  }
  return scenarios.filter(s => s.name === 'host-timezone' ||
    ((!only.length || only.includes(s.name)) && (!zoneSubset || s.zoneSensitive)));
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
