// Checkout-only planning: no browser, fixture server or page imports.
// Manual redirects become opaqueredirect in the browser. Keep them in one
// path so the full reason sweeps also reach a non-redirect transport branch.
export const nativeAuthPaths = Object.freeze({
  '302 to SSO': 'redirect', '303 to SSO': 'redirect', opaqueredirect: 'redirect',
  '401': 'status', '403': 'status',
  'HTML content type': 'html-content-type', 'HTML body': 'html-body', 'HTML fragment': 'html-body',
});

const USAGE = 'Signed-out matrix: use --full or --subset, optionally --full --parallel N or --full --shard K/N --report FILE';
const MAX_SHARDS = 16;

// JOED-190: --parallel N runs the full matrix as N shard processes; --shard K/N
// is one such process. The subset stays in one process because its cross-shape
// DOM invariant compares captures across shapes.
export function parseSignedOutOptions(args) {
  const options = { mode: null, parallel: null, shard: null, report: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full' || arg === '--subset') {
      if (options.mode) throw new Error(USAGE);
      options.mode = arg.slice(2);
    } else if (arg === '--parallel' || arg === '--shard' || arg === '--report') {
      const key = arg.slice(2), value = args[++i];
      if (value === undefined || value.startsWith('--') || options[key] !== null) throw new Error(USAGE);
      options[key] = value;
    } else throw new Error(USAGE);
  }
  options.mode ??= 'full';
  if ((options.parallel !== null || options.shard !== null) && options.mode !== 'full') throw new Error(`${USAGE} (shards need the full matrix)`);
  if (options.parallel !== null && options.shard !== null) throw new Error(USAGE);
  if (options.report !== null && options.shard === null) throw new Error(USAGE);
  if (options.parallel !== null) {
    if (!/^[1-9][0-9]?$/.test(options.parallel) || Number(options.parallel) < 2 || Number(options.parallel) > MAX_SHARDS) throw new Error(USAGE);
    options.parallel = Number(options.parallel);
  }
  if (options.shard !== null) {
    const match = /^([1-9][0-9]?)\/([1-9][0-9]?)$/.exec(options.shard);
    if (!match) throw new Error(USAGE);
    const index = Number(match[1]), count = Number(match[2]);
    if (count < 2 || count > MAX_SHARDS || index > count || !options.report) throw new Error(USAGE);
    options.shard = { index, count };
  }
  return options;
}

export function parseSignedOutArgs(args) {
  return parseSignedOutOptions(args).mode;
}

export function planSignedOutMatrix({ mode = 'full', widths, shapes, reasons, screens, endpoints }) {
  if (!['full', 'subset'].includes(mode)) throw new Error(`Unknown signed-out matrix mode: ${mode}`);
  for (const [name, list] of Object.entries({ widths, shapes, reasons, screens, endpoints })) {
    if (!Array.isArray(list) || !list.length) throw new Error(`Signed-out matrix requires nonempty ${name}`);
  }
  const fullShapes = [];
  const sampledReasons = ['refresh_failed', 'feed_not_received'];
  if (mode === 'subset') {
    for (const shape of shapes) {
      if (!Object.hasOwn(nativeAuthPaths, shape)) throw new Error(`Unclassified native auth shape: ${shape}`);
    }
    for (const path of ['redirect', 'status', 'html-content-type', 'html-body']) {
      const shape = shapes.find(shape => nativeAuthPaths[shape] === path);
      if (shape) fullShapes.push(shape);
    }
    for (const reason of sampledReasons) {
      if (!reasons.includes(reason)) throw new Error(`Signed-out subset requires sampled reason: ${reason}`);
    }
  }
  const views = widths.map((width, index) => {
    const fullShape = mode === 'full' ? null : fullShapes[index % fullShapes.length];
    const sampledReason = mode === 'full' ? reasons[index % reasons.length] : sampledReasons[index % sampledReasons.length];
    return { width, fullShape, sampledReason,
      matrix: shapes.map(shape => ({ shape,
        reasons: mode === 'full' || shape === fullShape ? [null, ...reasons] : [null, sampledReason] })),
      opaque: endpoints.flatMap(endpoint => screens.map(screen => ({ endpoint, screen }))),
      // Fresh documents with identical inputs make the cross-shape DOM
      // invariant independent of the preceding matrix's interaction history.
      invariant: mode === 'subset' ? shapes.flatMap(shape => screens.map(screen => ({ shape, screen }))) : [] };
  });
  const matrixCases = views.reduce((n, view) => n + view.matrix.reduce((m, entry) => m + entry.reasons.length * screens.length, 0), 0);
  if (mode === 'subset' && new Set(views.map(view => nativeAuthPaths[view.fullShape])).size < 2) {
    throw new Error('Signed-out subset requires at least two distinct auth paths across widths');
  }
  const opaqueCases = views.reduce((n, view) => n + view.opaque.length, 0);
  const invariantCases = views.reduce((n, view) => n + view.invariant.length, 0);
  return { mode, shapes: [...shapes], screens: [...screens], views, matrixCases, opaqueCases, invariantCases,
    caseCount: matrixCases + opaqueCases + invariantCases };
}

// One check() tag per planned case, in execution order. The browser records
// the tags it actually checked; shard merges compare against this list.
export function signedOutCaseTags(plan) {
  return plan.views.flatMap(view => [
    ...view.matrix.flatMap(({ shape, reasons }) => reasons.flatMap(reason => plan.screens.map(screen => `${view.width}/${shape}/${reason}/${screen}`))),
    ...view.opaque.map(({ endpoint, screen }) => `${view.width}/opaque-only/${endpoint}/${screen}`),
    ...view.invariant.map(({ shape, screen }) => `${view.width}/${shape}/${view.sampledReason}/${screen}: cross-shape DOM invariant`),
  ]);
}

// Contiguous, balanced split of the full matrix's (width, auth shape) blocks.
// Every shard repeats its widths' preamble regressions (not counted as cases);
// a width's opaque-only cases run in the shard that holds its last block, so
// the shards concatenate to exactly the unsharded execution order.
export function shardSignedOutPlan(plan, index, count) {
  if (plan.mode !== 'full') throw new Error('Signed-out shards require the full matrix');
  const units = plan.views.flatMap((view, v) => view.matrix.map((_, m) => ({ v, m })));
  if (!Number.isInteger(count) || count < 2 || count > Math.min(MAX_SHARDS, units.length)) throw new Error(`Signed-out shard count must be 2..${Math.min(MAX_SHARDS, units.length)}`);
  if (!Number.isInteger(index) || index < 1 || index > count) throw new Error(`Signed-out shard index must be 1..${count}`);
  const lo = Math.floor((index - 1) * units.length / count), hi = Math.floor(index * units.length / count);
  const views = plan.views.flatMap((view, v) => {
    const matrix = units.slice(lo, hi).filter(unit => unit.v === v).map(unit => view.matrix[unit.m]);
    if (!matrix.length) return [];
    const last = units.findLastIndex(unit => unit.v === v);
    return [{ ...view, matrix, opaque: last >= lo && last < hi ? view.opaque : [], invariant: [] }];
  });
  const matrixCases = views.reduce((n, view) => n + view.matrix.reduce((m, entry) => m + entry.reasons.length * plan.screens.length, 0), 0);
  const opaqueCases = views.reduce((n, view) => n + view.opaque.length, 0);
  return { ...plan, shard: { index, count }, views, matrixCases, opaqueCases, invariantCases: 0, caseCount: matrixCases + opaqueCases };
}

export function assertSignedOutTransportCoverage(visited, shapes, endpoints) {
  for (const auth of shapes) for (const endpoint of endpoints) {
    if (!visited.has(`${auth}/${endpoint}`)) throw new Error(`${auth}/${endpoint}: actual auth response exercised`);
  }
}

// Union of shard reports: each shard ran exactly its planned cases in order,
// every case of the full plan ran exactly once, and every native auth shape
// reached every protected transport somewhere.
export function mergeSignedOutShards(plan, reports, { shapes, endpoints }) {
  const expected = signedOutCaseTags(plan);
  if (new Set(expected).size !== expected.length) throw new Error('Signed-out plan tags must be unique');
  const seen = new Map();
  reports.forEach((report, i) => {
    const label = `${i + 1}/${reports.length}`;
    if (report?.schema !== 'joedesk.signed-out-shard.v1' || report.shard !== label) throw new Error(`shard ${label}: missing or foreign report`);
    const planned = signedOutCaseTags(shardSignedOutPlan(plan, i + 1, reports.length));
    if (report.caseCount !== planned.length || JSON.stringify(report.tags) !== JSON.stringify(planned)) throw new Error(`shard ${label}: did not execute exactly its planned cases in order`);
    for (const tag of report.tags) seen.set(tag, (seen.get(tag) ?? 0) + 1);
  });
  for (const tag of expected) if (seen.get(tag) !== 1) throw new Error(`${tag}: must run exactly once across shards (ran ${seen.get(tag) ?? 0})`);
  if (seen.size !== expected.length) throw new Error('an unplanned signed-out case ran');
  assertSignedOutTransportCoverage(new Set(reports.flatMap(report => report.visited)), shapes, endpoints);
  return expected.length;
}
