import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateContract, CONTRACTS, REASONS } from '../contracts/index.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { switchSetSnapshot } from '../scripts/browser/settings-fixtures.mjs';
const { heroLeft, positionsHtml, keptHtml, positionSectionReason } = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { todayPercent, sincePercent } = await import('../public/joe/performance.js');
const { cellReason } = await import('../public/joe/health.js');

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url)));
const { exact, mixed } = read('phase-b');
const fields = ['equity', 'dayPnl', 'openPnl', 'totalPnl'];
const ingress = value => { const data = structuredClone(value); delete data.receivedAt; return data; };
const context = data => {
  const feeds = { data: { value: data } }, now = data.receivedAt;
  return { feeds, now, states: panelStates(feeds, now) };
};
const rejects = (data, path, rule) => {
  const result = validateContract('data', data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.path === path && e.rule === rule), JSON.stringify(result.errors));
};

test('rev 10 is additive: rev 9 exact, null switch-set and reasoned-position payloads still validate', () => {
  assert.equal(CONTRACTS.revision, 10);
  assert.deepEqual(REASONS.slice(34), ['sod_missing', 'ledger_unreconciled', 'position_stale']);
  for (const data of [read('valid').data, read('positions-null'), switchSetSnapshot()]) {
    assert.equal(validateContract('data', ingress(data), { stage: 'ingress' }).ok, true);
  }
});

for (const [name, fixture] of Object.entries({ exact, mixed })) test(`Phase B ${name}: ingress and served acceptance preserve exact bytes, provenance and nulls`, () => {
  const accepted = acceptSnapshot('data', ingress(fixture), null, fixture.receivedAt);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.errors));
  assert.deepEqual(accepted.value, fixture);
  assert.equal(validateContract('data', accepted.value).ok, true);
  assert.equal(accepted.value.brokerAccount.cash.amount, '12345.67890123');
  assert.deepEqual(accepted.value.positions.rows.filter(p => p.scope === 'keep').map(p => [p.symbol, p.desk]), [['SXR8', null], ['TSLA', null]]);
  assert.ok(fixture.desks.every(d => !Object.hasOwn(d.money, 'cash')));
});

test('J conversion reuses money.fx: the used rate, direction, source and instant survive validation', () => {
  for (const field of fields) assert.deepEqual(exact.desks[0].money[field].fx, {
    base: 'USD', quote: 'EUR', rate: '0.92', source: 'Synthetic broker FX used by FIFO valuation', observedAt: exact.generatedAt,
  });
  for (const missing of ['rate', 'observedAt', 'source']) {
    const data = structuredClone(exact); delete data.desks[0].money.equity.fx[missing];
    rejects(data, '$.desks[0].money.equity', 'anyOf');
  }
  const zero = structuredClone(exact); zero.desks[0].money.equity.fx.rate = '0';
  rejects(zero, '$.desks[0].money.equity', 'anyOf');
});

test('scoped evidence permits independent exact desks without presenting a partial aggregate', () => {
  const { states } = context(mixed);
  assert.equal(states['desks.joe.openPnl'].state, 'fresh');
  assert.equal(states['desks.joel.dayPnl'].state, 'fresh');
  assert.equal(states['desks.joel.dayPnl'].reason, null, 'aggregate ledger failure must not mask an exact desk');
  assert.equal(states['desks.j.dayPnl'].reason, 'ledger_unreconciled');
  assert.equal(states['desks.joe.dayPnl'].reason, 'sod_missing');
  const later = structuredClone(mixed);
  later.generatedAt = later.receivedAt = '2026-10-14T17:42:52.000Z';
  assert.equal(validateContract('data', later).ok, true);
  const expired = panelStates({ data: { value: later } }, '2026-10-14T17:43:23.000Z', context(exact).states);
  assert.equal(expired['desks.j.equity'].reason, 'gateway_unconfirmed');
  assert.equal(expired['desks.j.equity'].value, null, 'session expiry cannot restore an invalidated ledger result');
  assert.equal(expired['desks.joe.dayPnl'].value, null, 'session expiry cannot restore a missing SOD result');
  for (const field of fields) {
    assert.equal(states[`today.${field}`].value, null);
    const partial = structuredClone(mixed); partial.totals[field] = structuredClone(exact.totals[field]);
    rejects(partial, `$.totals.${field}`, 'incompleteDeskSum');
  }
  const missing = structuredClone(mixed); delete missing.desks[2].pnlSources.day;
  rejects(missing, '$.pnlSources.day', 'evidenceRequired');
  const noBaseline = structuredClone(exact); delete noBaseline.desks[0].pnlSources.day.periodStart;
  rejects(noBaseline, '$.desks[0].pnlSources.day.periodStart', 'baselineRequired');
  for (const method of ['session-open-estimate', 'ib-daily-pnl']) {
    const estimate = structuredClone(exact); estimate.desks[0].pnlSources.day.method = method;
    rejects(estimate, '$.desks[0].pnlSources.day.method', 'exactDeskMethod');
  }
});

test('new failures withhold older exact cells, including after durable restart; session expiry keeps scoped served evidence valid', async t => {
  const dataDir = scratch('joed-phase-b-');
  t.after(() => discard(dataDir, 'Phase B unit store'));
  let now = exact.receivedAt;
  const model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(ingress(exact)).status, 200);
  now = '2026-10-14T17:42:32.000Z';
  const next = ingress(mixed); next.seq++; next.generatedAt = now;
  assert.equal(model.accept(next).status, 200);
  for (const view of [model.view(), createReadModel({ dataDir, clock: () => now }).view()]) {
    assert.equal(validateContract('data', view.data).ok, true);
    assert.equal(view.panels['desks.j.equity'].value, null);
    assert.equal(view.panels['desks.joe.dayPnl'].value, null);
    assert.equal(view.panels['desks.joel.dayPnl'].state, 'fresh');
  }
  // The envelope still advances, but its original API check expires.
  const expired = ingress(exact); expired.seq += 2; expired.generatedAt = '2026-10-14T17:43:12.000Z'; now = expired.generatedAt;
  assert.equal(model.accept(expired).status, 200);
  const view = model.view('2026-10-14T17:43:23.000Z');
  assert.equal(view.data.desks[0].money.dayPnl, null);
  assert.equal(view.data.desks[0].pnlSources.day.status, 'unavailable');
  assert.equal(validateContract('data', view.data).ok, true);
});

test('new unavailability reasons require nulls; stale callbacks cannot carry a fresh value', () => {
  const badDesk = structuredClone(mixed); badDesk.desks[1].money.dayPnl = structuredClone(exact.desks[1].money.dayPnl);
  rejects(badDesk, '$.desks[1].money.dayPnl', 'unavailableValue');
  const badLedger = structuredClone(mixed); badLedger.desks[0].money.equity = structuredClone(exact.desks[0].money.equity);
  rejects(badLedger, '$.desks[0].money.equity', 'unavailableValue');
  for (const field of ['quantity', 'mark', 'marketValue', 'openPnl']) {
    const bad = structuredClone(mixed); bad.positions.rows[1][field] = structuredClone(exact.positions.rows[1][field]);
    rejects(bad, `$.positions.rows[1].${field}`, 'unavailableValue');
    const unreasoned = structuredClone(mixed); delete unreasoned.positions.rows[1].reasons[field];
    rejects(unreasoned, `$.positions.rows[1].${field}`, 'reasonRequired');
  }
});

test('unknown since-start base withholds the result, while KEEP and desk cash stay outside desk money', () => {
  const data = structuredClone(exact);
  data.desks[0].money.totalPnl = null; data.desks[0].money.reasons = { totalPnl: 'not_exact_yet' };
  data.totals.totalPnl = null; data.totals.reasons = { totalPnl: 'not_exact_yet' };
  assert.equal(validateContract('data', data).ok, true);
  assert.equal(sincePercent(context(data).states), null);
  const cash = structuredClone(exact); cash.desks[0].money.cash = { amount: '1', currency: 'EUR' };
  rejects(cash, '$.desks[0].money', 'additionalProperties');
  const keep = structuredClone(exact); keep.positions.rows[2].desk = 'j';
  rejects(keep, '$.positions.rows[2]', 'keepExcluded');
});

test('exact money renders through the real selectors, with Today and Since start percentages', () => {
  const ctx = context(exact), doc = htmlDocument(heroLeft(ctx));
  assert.equal(todayPercent(ctx.states, exact.pnlSources.day), 33n);
  assert.equal(sincePercent(ctx.states), 100n);
  assert.equal(doc.querySelectorAll('.performance-pct').length, 2);
  assert.equal(doc.querySelector('[data-cell="hero.day"] .bn').textContent, '+€50,00');
  assert.equal(doc.querySelector('[data-cell="hero.since"] .bn').textContent, '+€150,00');
  assert.match(htmlDocument(deskCard(ctx, 'j', 50, true)).textContent, /\+€4,60/);
  const positions = htmlDocument(positionsHtml(ctx).html);
  assert.match(positions.textContent, /\$\s*20,00/);
  assert.match(positions.textContent, /\$\s*40,00/);
  assert.match(positions.textContent, /\+\$\s*5,00/);
  const kept = htmlDocument(keptHtml(ctx));
  assert.equal(kept.querySelectorAll('[data-keep]').length, 2);
  for (const row of kept.querySelectorAll('[data-keep]')) assert.equal(row.querySelectorAll('button, a, input, [tabindex]').length, 0);
});

test('mixed rendering keeps exact desks visible, explains each failure and shares repeated reasons once', () => {
  const ctx = context(mixed), hero = htmlDocument(heroLeft(ctx));
  assert.equal(hero.querySelectorAll('.performance-pct').length, 0);
  const j = htmlDocument(deskCard(ctx, 'j', 50, false));
  assert.equal(j.textContent.match(/desk ledger not reconciled/g)?.length, 1);
  assert.match(htmlDocument(deskCard(ctx, 'joe', 50, false)).textContent, /start-of-day value missing/);
  assert.equal(htmlDocument(deskCard(ctx, 'joel', 50, false)).querySelectorAll('.dnums .v .bn').length, 3);
  const positions = htmlDocument(positionsHtml(ctx).html);
  assert.equal(positionSectionReason(ctx.states.positions), cellReason('position_stale'));
  assert.equal(positions.textContent.match(/position update is old/g)?.length, 1);
  for (const dash of positions.querySelectorAll('.position-value')) {
    assert.equal(dash.textContent, '—');
    assert.match(dash.getAttribute('aria-label'), /position update is old/);
    assert.equal(dash.getAttribute('title'), dash.getAttribute('aria-label'));
  }
  assert.match(positions.textContent, /\$\s*40,00/, 'fresh callbacks remain exact beside the stale row');
});
