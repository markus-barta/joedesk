#!/usr/bin/env node
// Offline Node model timings, not a browser/render-budget verdict. Use the
// same large fixture and eleven control changes as the Results browser budget.
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { largeResults } from './browser/results.mjs';
import { NOW, scenario } from './browser/board.mjs';

// Mirror the server's shared-module routes, as test/results-model.mjs does.
const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}
const M = await import('../public/joe/results-model.js');
const { decimalUnits } = await import('../contracts/decimal.mjs');
const { priorRollupBase, priorRollupPercent } = await import('../test/fixtures/period-base-reference.mjs');

const value = largeResults(NOW), ix = M.indexResults(value), { snapshot } = scenario(NOW);
const today = M.viennaDate(Date.parse(NOW)), all = [...M.DESK_IDS];
const inputs = { today, nowMs: Date.parse(NOW), cuts: [],
  todayUnits: all.map(id => decimalUnits(snapshot.desks.find(d => d.id === id).money.equity.amount)) };
const previous = M.stepAnchor('month', today, -1, today, ix.meta.trackingStart);
const selected = previous.slice(0, 8) + '01';
const controls = [['all', today, all], ['all', today, ['j']], ['ytd', today, ['j']], ['ytd', today, all],
  ['month', today, all], ['month', previous, all], ['day', previous, all], ['day', selected, all],
  ['week', previous, all], ['week', previous, ['joel']], ['week', previous, all]];
const switches = controls.map(([p, anchor, desks]) => {
  const per = M.periodOf(p, anchor, today, ix.meta.trackingStart);
  const result = M.rollup(ix, per, desks, M.moneyContext(ix, inputs, per, desks));
  assert.equal(M.periodBase(ix, inputs, per, desks), priorRollupBase(ix, inputs, per, desks));
  assert.equal(M.periodPercent(ix, inputs, per, desks, result), priorRollupPercent(ix, inputs, per, desks, result));
  return { per, desks };
});

function cycle(base, percent) {
  let baseWorst = 0, modelWorst = 0;
  for (const { per, desks } of switches) {
    let start = performance.now();
    base(ix, inputs, per, desks);
    baseWorst = Math.max(baseWorst, performance.now() - start);
    start = performance.now();
    const result = M.rollup(ix, per, desks, M.moneyContext(ix, inputs, per, desks));
    percent(ix, inputs, per, desks, result);
    modelWorst = Math.max(modelWorst, performance.now() - start);
  }
  return { baseWorst, modelWorst };
}
const paths = { before: [priorRollupBase, priorRollupPercent], after: [M.periodBase, M.periodPercent] };
for (let i = 0; i < 30; i++) for (const args of Object.values(paths)) cycle(...args);
const samples = { before: [], after: [] };
for (let i = 0; i < 200; i++) {
  // Alternate order so the comparison shares the same process and GC conditions.
  for (const name of i % 2 ? ['after', 'before'] : ['before', 'after']) samples[name].push(cycle(...paths[name]));
}
const stats = (rows, key) => {
  const values = rows.map(row => row[key]).sort((a, b) => a - b);
  return Object.fromEntries([['median', values[100]], ['p95', values[189]], ['max', values.at(-1)]]
    .map(([name, ms]) => [name, Number(ms.toFixed(4))]));
};
console.log(JSON.stringify({ runtime: process.version, trades: value.trades.length, days: value.days.length,
  switches: switches.length, cycles: 200, units: 'ms', scope: 'Node model only; excludes DOM, chart and layout',
  ...Object.fromEntries(Object.entries(samples).map(([name, rows]) => [name, {
    baseWorst: stats(rows, 'baseWorst'), switchWorst: stats(rows, 'modelWorst'),
  }])) }, null, 2));
