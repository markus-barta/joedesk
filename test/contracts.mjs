import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONTRACTS, SCHEMAS, SCHEMA_FILES, REASONS, validateContract, validateAndRetain } from '../contracts/index.mjs';
import { resolveRef } from '../contracts/schema-validator.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { panelState, panelStates, MONEY_FIELDS } from '../contracts/panel-state.mjs';

const samples = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const at = '2026-10-14T17:42:22.000Z';
const later = '2026-10-14T17:42:52.000Z';
const copy = v => structuredClone(v);
const ingress = v => { const next = copy(v); delete next.receivedAt; return next; };
const rejects = (result, rule, path, reason = 'contract_invalid') => {
  assert.equal(result.status, 422);
  assert.equal(result.reason, reason);
  assert.ok(result.errors.some(e => e.rule === rule && e.path === path),
    `Expected ${rule}@${path}: ${JSON.stringify(result.errors)}`);
};

for (const kind of Object.keys(SCHEMAS)) {
  test(`contract ${kind}: valid, invalid, old and unknown return explicit outcomes`, () => {
    assert.equal(validateContract(kind, samples[kind]).ok, true);
    const bad = { ...samples[kind], unexpected: 'synthetic' };
    rejects(validateContract(kind, bad), 'additionalProperties', '$');
    assert.strictEqual(validateAndRetain(kind, bad, samples[kind]).value, samples[kind]);
    for (const schema of ['legacy.v0', 'unknown.v99', null]) {
      const result = validateContract(kind, { ...samples[kind], schema });
      rejects(result, 'const', '$.schema', 'schema_unsupported');
      assert.strictEqual(validateAndRetain(kind, { ...samples[kind], schema }, samples[kind]).value, samples[kind]);
    }
    rejects(validateContract(kind, { schema: CONTRACTS.contracts[kind] }), 'required',
      `$.${SCHEMAS[kind].required.find(key => key !== 'schema')}`);
  });
}

test('only the documented JSON Schema vocabulary is used; every field has exactly one effective owner', () => {
  const vocabulary = new Set(['$schema', '$id', '$ref', '$defs', 'title', 'description', 'x-owner', 'type',
    'additionalProperties', 'required', 'properties', 'items', 'minimum', 'maximum', 'minLength', 'maxLength',
    'minItems', 'maxItems', 'pattern', 'format', 'enum', 'const', 'anyOf', 'allOf', 'contains', 'uniqueItems']);
  const allowedOwners = new Set(CONTRACTS.owners);
  const owners = {};
  function walk(schema, root, owner, path) {
    for (const keyword of Object.keys(schema)) assert.ok(vocabulary.has(keyword), `${path}: unsupported ${keyword}`);
    owner = schema['x-owner'] ?? owner;
    if (owner) assert.ok(allowedOwners.has(owner));
    if (schema.$ref) {
      const target = resolveRef(schema.$ref, root, SCHEMA_FILES);
      walk(target.schema, target.root, owner, path);
    }
    if (schema.properties) for (const [key, field] of Object.entries(schema.properties)) {
      assert.ok(allowedOwners.has(field['x-owner'] ?? owner), `${path}.${key}: missing owner`);
      owners[`${path}.${key}`] = field['x-owner'] ?? owner;
      walk(field, root, field['x-owner'] ?? owner, `${path}.${key}`);
    }
    for (const child of [...(schema.anyOf || []), ...(schema.allOf || []), ...(schema.contains ? [schema.contains] : [])]) walk(child, root, owner, path);
    if (schema.items) walk(schema.items, root, owner, `${path}[]`);
  }
  for (const [kind, schema] of Object.entries(SCHEMAS)) walk(schema, schema, schema['x-owner'], kind);
  assert.equal(owners['data.receivedAt'], 'server');
  assert.equal(owners['data.totals.equity.amount'], 'pusher');
  assert.equal(owners['data.brokerAccount.cash.amount'], 'pusher');
  assert.equal(owners['data.brokerAccount.reasons.cash'], 'pusher');
  assert.equal(owners['data.safety.executor.gatewayReachable'], 'paper executor 8470');
  assert.equal(owners['data.safety.executor.ledgerBytes'], 'paper executor 8470');
  assert.equal(owners['data.safety.executor.ledgerCapBytes'], 'paper executor 8470');
  assert.equal(owners['results.trades[].netEur.amount'], 'paper executor 8470');
  assert.equal(owners['history.points[].desks.j.money.equity.amount'], 'server');
  assert.equal(owners['fleet-config.desks.stage0.capEur'], 'server');
});

test('one closed reason enum is used everywhere, including field errors', () => {
  assert.equal(new Set(REASONS).size, REASONS.length);
  for (const reason of REASONS) {
    const data = copy(samples.data);
    data.totals.reasons = { equity: reason };
    assert.equal(validateContract('data', data).ok, true, reason);
    assert.doesNotThrow(() => panelState({ value: data }, data.totals.equity, reason, at));
  }
  const data = copy(samples.data);
  data.totals.reasons = { equity: 'new-unreviewed-reason' };
  rejects(validateContract('data', data), 'enum', '$.totals.reasons.equity');
});

test('rev 7 executor: rev 6 payloads remain valid; the reason enum is append-only', () => {
  assert.equal(CONTRACTS.revision, 8);
  assert.equal(CONTRACTS.contracts.data, 'inspr.joe.household.v2');
  assert.equal(REASONS.at(-4), 'executor_broker_disagreement');
  assert.equal(REASONS.at(-3), 'results_capture_failed');
  for (const [kind, payload] of Object.entries(samples)) {
    assert.equal(validateContract(kind, payload).ok, true, kind);
  }
  const data = copy(samples.data);
  data.safety.executor.status = 'degraded';
  // The rev 6 pusher can report degraded without a reason or ledger fields.
  delete data.safety.executor.reason;
  assert.equal(validateContract('data', data).ok, true);
  for (const reason of ['results_capture_failed', 'ledger_size_limit']) {
    data.safety.executor.reason = reason;
    assert.equal(validateContract('data', data).ok, true, reason);
  }
});

test('rev 7 executor: ledger bytes and optional cap validate without hiding over-cap reports', () => {
  for (const fields of [{}, { ledgerBytes: 0 }, { ledgerBytes: 3250000 },
    { ledgerBytes: 0, ledgerCapBytes: 1 }, { ledgerBytes: 8000000, ledgerCapBytes: 8000000 },
    { ledgerBytes: 9000000, ledgerCapBytes: 8000000 },
    { ledgerBytes: Number.MAX_SAFE_INTEGER, ledgerCapBytes: Number.MAX_SAFE_INTEGER }]) {
    const data = copy(samples.data);
    Object.assign(data.safety.executor, fields, { status: 'degraded', reason: 'results_capture_failed' });
    assert.equal(validateContract('data', data).ok, true, JSON.stringify(fields));
    assert.equal(validateContract('data', ingress(data), { stage: 'ingress' }).ok, true);
  }
  const capOnly = copy(samples.data);
  capOnly.safety.executor.ledgerCapBytes = 8000000;
  rejects(validateContract('data', capOnly), 'required', '$.safety.executor.ledgerBytes');
  rejects(validateContract('data', ingress(capOnly), { stage: 'ingress' }), 'required', '$.safety.executor.ledgerBytes');
  for (const [key, minimum] of [['ledgerBytes', 0], ['ledgerCapBytes', 1]]) {
    for (const value of [null, '8000000', true, {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1, minimum - 1]) {
      const data = copy(samples.data);
      Object.assign(data.safety.executor, { ledgerBytes: 0, [key]: value });
      const rule = value === minimum - 1 ? 'minimum' : 'type';
      rejects(validateContract('data', data), rule, `$.safety.executor.${key}`);
    }
  }
});

const ROW_FIELDS = ['quantity', 'mark', 'marketValue', 'dayPnl', 'openPnl'];
for (const field of ROW_FIELDS) test(`rev 8 positions: null ${field} requires its own closed reason in every scope`, () => {
  for (const scope of ['stage0', 'keep', 'legacy']) {
    const data = copy(samples.data), row = data.positions.rows[0];
    row.scope = scope;
    if (scope === 'keep') { row.desk = null; row.symbol = 'SXR8'; }
    row[field] = null;
    for (const stage of ['ingress', 'served']) {
      const payload = stage === 'ingress' ? ingress(data) : data;
      rejects(validateContract('data', payload, { stage }), 'reasonRequired', `$.positions.rows[0].${field}`);
    }
    for (const reason of ['not_exact_yet', 'source_unavailable', 'baseline_pending']) {
      row.reasons = { [field]: reason };
      assert.equal(validateContract('data', data).ok, true, `${scope}/${field}/${reason}`);
    }
    row.reasons[field] = 'unreviewed';
    rejects(validateContract('data', data), 'enum', `$.positions.rows[0].reasons.${field}`);
    row.reasons = { other: 'source_unavailable' };
    rejects(validateContract('data', data), 'additionalProperties', '$.positions.rows[0].reasons');
  }
});

test('rev 8 positions: panel reason applies only under the unchanged session-unavailable rule', () => {
  const data = copy(samples.data), row = data.positions.rows[0];
  for (const field of ROW_FIELDS) row[field] = null;
  data.positions.reason = 'source_unavailable';
  for (const field of ROW_FIELDS) rejects(validateContract('data', data), 'reasonRequired', `$.positions.rows[0].${field}`);
  for (const scenario of ['down', 'missing', 'stale-check']) {
    const unavailable = unavailableSession(copy(data));
    if (scenario === 'missing') delete unavailable.safety.gateway;
    if (scenario === 'stale-check') unavailable.safety.gateway = { apiSessionReady: true, checkedAt: '2026-10-14T17:40:22.000Z' };
    assert.equal(validateContract('data', unavailable).ok, true, scenario);
    delete unavailable.positions.reason;
    for (const field of ROW_FIELDS) rejects(validateContract('data', unavailable), 'reasonRequired', `$.positions.rows[0].${field}`);
    unavailable.positions.rows[0].reasons = Object.fromEntries(ROW_FIELDS.map(field => [field, 'source_unavailable']));
    rejects(validateContract('data', unavailable), 'reasonRequired', '$.positions.reason');
  }
  const session = unavailableSession(copy(samples.data));
  assert.equal(session.positions.rows[0].quantity, '2');
  assert.equal(validateContract('data', session).ok, true, 'unconfirmed sessions still permit the reported quantity');
  session.positions.rows[0].mark = copy(samples.data.positions.rows[0].mark);
  session.positions.rows[0].reasons = { mark: 'source_unavailable' };
  rejects(validateContract('data', session), 'sessionUnavailable', '$.positions.rows[0].mark');
});

test('rev 8 positions: reasoned rev 7 payloads stay valid; KEEP identity and reason ordering survive', () => {
  assert.deepEqual(REASONS.slice(-2), ['not_exact_yet', 'source_unavailable']);
  const data = JSON.parse(readFileSync(new URL('../fixtures/positions-null.json', import.meta.url)));
  assert.equal(validateContract('data', data).ok, true);
  assert.equal(Object.hasOwn(data.brokerAccount, 'cash'), false);
  const rev7 = copy(data);
  for (const row of rev7.positions.rows) {
    if (row.quantity === null) row.quantity = '1';
    for (const field of Object.keys(row.reasons)) row.reasons[field] = 'baseline_pending';
  }
  assert.equal(validateContract('data', rev7).ok, true, 'rev 7 shapes and existing reason codes remain accepted');
  const kept = data.positions.rows.filter(row => row.scope === 'keep');
  assert.deepEqual(kept.map(row => [row.symbol, row.side, row.desk]), [['SXR8', 'long', null], ['TSLA', 'long', null]]);
  for (const field of ['symbol', 'side']) {
    const bad = copy(data); delete bad.positions.rows[1][field];
    rejects(validateContract('data', bad), 'required', `$.positions.rows[1].${field}`);
  }
  const bad = copy(data); bad.positions.rows[1].desk = 'j';
  rejects(validateContract('data', bad), 'keepExcluded', '$.positions.rows[1]');
});

test('rev 8 cash: rev 7 payloads with or without the account still validate', () => {
  const data = copy(samples.data);
  assert.equal(Object.hasOwn(data.brokerAccount, 'cash'), false);
  assert.equal(validateContract('data', data).ok, true);
  delete data.brokerAccount;
  assert.equal(validateContract('data', data).ok, true);
  assert.equal(validateContract('data', ingress(data), { stage: 'ingress' }).ok, true);
});

test('rev 8 cash: exact EUR money or null with its own closed reason, never equity’s reason', () => {
  for (const amount of ['0', '-0.00000001', '12345.67890123', '9007199254740993.00500000']) {
    const data = copy(samples.data);
    data.brokerAccount.cash = { amount, currency: 'EUR' };
    assert.equal(validateContract('data', data).ok, true, amount);
    const accepted = acceptSnapshot('data', ingress(data), null, at);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.value.brokerAccount.cash.amount, amount);
  }
  const data = copy(samples.data);
  data.brokerAccount.cash = null;
  data.brokerAccount.reason = 'upstream_lost';
  for (const stage of ['served', 'ingress']) {
    const value = stage === 'ingress' ? ingress(data) : data;
    rejects(validateContract('data', value, { stage }), 'reasonRequired', '$.brokerAccount.cash');
  }
  for (const reason of REASONS) {
    data.brokerAccount.reasons = { cash: reason };
    assert.equal(validateContract('data', data).ok, true, reason);
  }
  data.brokerAccount.reasons.cash = 'unreviewed';
  rejects(validateContract('data', data), 'enum', '$.brokerAccount.reasons.cash');
  data.brokerAccount.reasons = { equity: 'upstream_lost' };
  rejects(validateContract('data', data), 'additionalProperties', '$.brokerAccount.reasons');
});

test('rev 8 cash: floats, malformed precision and foreign currency fail', () => {
  for (const cash of [1.25, '1.25', { amount: 1.25, currency: 'EUR' },
    { amount: '1.123456789', currency: 'EUR' }, { amount: '1e3', currency: 'EUR' },
    { amount: '01.25', currency: 'EUR' }, { amount: '1', currency: 'USD' }]) {
    const data = copy(samples.data); data.brokerAccount.cash = cash;
    assert.equal(validateContract('data', data).ok, false, JSON.stringify(cash));
  }
});

test('rev 8 cash: a value plus its reason mirrors equity acceptance and leaves equity independent', () => {
  const data = copy(samples.data);
  data.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  data.brokerAccount.reasons = { cash: 'retained_values' };
  assert.equal(validateContract('data', data).ok, true);
  const states = panelStates({ data: { value: data } }, later);
  assert.equal(states.paperAccount.state, 'fresh');
  assert.equal(states.paperCash.state, 'broken');
  assert.equal(states.paperCash.reason, 'retained_values');
  data.brokerAccount.reason = 'retained_values';
  assert.equal(validateContract('data', data).ok, true);
});

test('rev 8 cash: fresh, stale, broken retention, gateway expiry and recovery follow the account', () => {
  const data = copy(samples.data);
  data.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  const feed = { value: data, generatedAdvancedAt: at };
  const fresh = panelStates({ data: feed }, later);
  assert.equal(fresh.paperCash.state, 'fresh');
  assert.deepEqual(fresh.paperCash.value, data.brokerAccount.cash);
  const stale = panelStates({ data: feed }, '2026-10-14T17:43:52.000Z', fresh);
  assert.equal(stale.paperCash.state, 'stale');
  assert.equal(stale.paperCash.reason, 'snapshot_stale');
  assert.deepEqual(stale.paperCash.value, data.brokerAccount.cash);
  const missing = copy(data);
  missing.receivedAt = missing.generatedAt = later; missing.safety.gateway.checkedAt = later;
  missing.brokerAccount.cash = null; missing.brokerAccount.reasons = { cash: 'source_unavailable' };
  const broken = panelStates({ data: { value: missing, generatedAdvancedAt: later } }, later, fresh);
  assert.equal(broken.paperCash.state, 'broken');
  assert.equal(broken.paperCash.retained, true);
  assert.equal(broken.paperCash.valueReceivedAt, at);
  assert.equal(broken.paperAccount.state, 'fresh');
  const expiredFeed = { ...feed, value: copy(data) };
  expiredFeed.value.safety.gateway.checkedAt = '2026-10-14T17:42:12.000Z';
  const expired = panelStates({ data: expiredFeed }, '2026-10-14T17:43:12.000Z', fresh);
  assert.equal(expired.paperCash.reason, 'gateway_unconfirmed');
  assert.equal(expired.paperCash.retained, true);
  assert.equal(expired.paperCash.valueReceivedAt, at);
  assert.equal(panelStates({ data: feed }, later, broken).paperCash.state, 'fresh');
});

test('rev 8 cash: an unconfirmed session requires cash null with its own reason', () => {
  const data = copy(JSON.parse(readFileSync(new URL('../fixtures/failures/a-gateway-up-but-dead.json', import.meta.url))).payload);
  data.brokerAccount.cash = { amount: '12345.67890123', currency: 'EUR' };
  rejects(validateContract('data', data, { stage: 'ingress' }), 'sessionUnavailable', '$.brokerAccount.cash');
  data.brokerAccount.cash = null;
  rejects(validateContract('data', data, { stage: 'ingress' }), 'reasonRequired', '$.brokerAccount.cash');
  data.brokerAccount.reasons = { cash: 'gateway_unconfirmed' };
  assert.equal(validateContract('data', data, { stage: 'ingress' }).ok, true);
});

test('missing feed retains false HALT with its original receipt rather than treating it as absent', () => {
  const value = copy(samples.data); value.safety.halt = false;
  const cell = panelStates({ data: { value, reason: 'feed_not_received' } }, later).halt;
  assert.deepEqual(cell, { state: 'broken', ageSeconds: 30, reason: 'feed_not_received', value: false,
    retained: true, valueReceivedAt: at });
});

test('history compaction metadata is valid without a reason; legacy compaction reasons still follow receipt age', () => {
  const value = { ...copy(samples.history), compactedThrough: samples.history.points.at(-1).t };
  assert.equal(validateContract('history', value).ok, true);
  for (const legacy of [false, true]) {
    if (legacy) value.reason = 'history_compacted';
    for (const [elapsed, state, reason] of [[30000, 'fresh', null], [60000, 'stale', 'snapshot_stale']]) {
      const now = new Date(Date.parse(value.receivedAt) + elapsed).toISOString();
      const cell = panelStates({ history: { value } }, now).history;
      assert.equal(cell.state, state); assert.equal(cell.reason, reason); assert.equal(cell.ageSeconds, elapsed / 1000);
    }
  }
  delete value.compactedThrough;
  rejects(validateContract('history', value), 'required', '$.compactedThrough');
});

test('paper is fixed, KEEP is excluded from results and cannot be removed from fleet policy', () => {
  const data = { ...samples.data, mode: 'LIVE' };
  rejects(validateContract('data', data), 'const', '$.mode');
  for (const symbol of ['SXR8', 'TSLA']) {
    const results = copy(samples.results);
    results.trades[0].symbol = symbol;
    rejects(validateContract('results', results), 'keepExcluded', '$.trades[0].symbol');
    const fleet = copy(samples['fleet-config']);
    fleet.desks.keep = fleet.desks.keep.filter(s => s !== symbol);
    rejects(validateContract('fleet-config', fleet), 'contains', '$.desks.keep');
    const data = copy(samples.data);
    data.positions.rows[0].symbol = symbol;
    rejects(validateContract('data', data), 'keepExcluded', '$.positions.rows[0]');
  }
  rejects(validateContract('fleet-config', { ...samples['fleet-config'], mode: 'live' }), 'const', '$.mode');
});

test('results: full day/desk summaries reconcile counts and exact sums, including empty days and nulls', () => {
  for (const coverage of [undefined, 'full']) {
    const good = copy(samples.results);
    if (coverage) good.days[0].coverage = coverage;
    assert.equal(validateContract('results', good).ok, true);
    for (const [field, value, rule] of [
      ['trades', 2, 'dayTradeCount'], ['realisedNet', { amount: '-0.99', currency: 'EUR' }, 'dayNetSum'],
      ['fees', { amount: '0.64000001', currency: 'EUR' }, 'dayFeeSum'],
      ['realisedNet', null, 'dayNetSum'], ['fees', null, 'dayFeeSum'],
    ]) {
      const bad = copy(good); bad.days[0].desks.j[field] = value;
      rejects(validateContract('results', bad), rule, `$.days[0].desks.j.${field}`);
    }
    const empty = copy(good); empty.days[0].desks.joe.fees.amount = '0.01';
    rejects(validateContract('results', empty), 'dayFeeSum', '$.days[0].desks.joe.fees');
  }
});

test('results: gross and day sums keep sub-cent decimals without rounding in acceptance', () => {
  const exact = JSON.parse(readFileSync(new URL('../fixtures/results/exact-decimals.json', import.meta.url)));
  assert.equal(validateContract('results', exact).ok, true);
  const accepted = acceptSnapshot('results', ingress(exact), null, at);
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.value, exact);
  assert.equal(exact.days[0].desks.j.realisedNet.amount, '0.0278');
  assert.equal(exact.days[0].desks.j.fees.amount, '0.0118');
  for (const [field, rounded, rule] of [['realisedNet', '0.02', 'dayNetSum'], ['fees', '0.02', 'dayFeeSum']]) {
    const bad = ingress(exact); bad.seq++; bad.days[0].desks.j[field].amount = rounded;
    const rejected = acceptSnapshot('results', bad, accepted, later);
    rejects(rejected, rule, `$.days[0].desks.j.${field}`);
    assert.strictEqual(rejected.value, accepted.value);
  }
  const roundedGross = copy(exact); roundedGross.trades[0].grossEur.amount = '0';
  rejects(validateContract('results', roundedGross), 'netAfterFees', '$.trades[0]');
});

test('results: full days require every desk with closed trades, even when all desks are omitted', () => {
  const accepted = acceptSnapshot('results', ingress(samples.results), null, at);
  for (const coverage of [undefined, 'full']) for (const desk of ['j', 'joe', 'joel']) {
    const good = ingress(samples.results); good.seq++;
    if (coverage) good.days[0].coverage = coverage;
    good.trades[0].desk = desk;
    good.days[0].desks[desk] = copy(samples.results.days[0].desks.j);
    if (desk !== 'j') delete good.days[0].desks.j;
    assert.equal(validateContract('results', good, { stage: 'ingress' }).ok, true);
    for (const omitAll of [false, true]) {
      const bad = copy(good);
      if (omitAll) bad.days[0].desks = {}; else delete bad.days[0].desks[desk];
      const rejected = acceptSnapshot('results', bad, accepted, later);
      rejects(rejected, 'dayDeskRequired', `$.days[0].desks.${desk}`);
      assert.strictEqual(rejected.value, accepted.value);
      bad.days[0].coverage = 'partial';
      assert.equal(acceptSnapshot('results', bad, accepted, later).status, 200);
    }
  }
  const noTrades = copy(samples.results); noTrades.trades = []; noTrades.days[0].desks = {};
  assert.equal(validateContract('results', noTrades).ok, true);
});

test('results: Vienna fallback reconciles both repeated hours on 25 October on any host', () => {
  const dst = JSON.parse(readFileSync(new URL('../fixtures/results/dst-weeks.json', import.meta.url)));
  const accepted = acceptSnapshot('results', ingress(dst), null, dst.receivedAt);
  assert.equal(accepted.status, 200);
  assert.equal(dst.days[1].desks.joel.trades, 5);
  for (const date of ['2026-10-24', '2026-10-26']) {
    const wrongDay = ingress(dst); wrongDay.days[1].date = date;
    rejects(validateContract('results', wrongDay, { stage: 'ingress' }), 'dayTradeCount', '$.days[1].desks.joel.trades');
  }
});

test('results: trades without a days entry are skipped, while reported days still reconcile', () => {
  const r = copy(samples.results);
  const today = { ...copy(r.trades[0]), id: 'rt-before-daily-close', desk: 'joel',
    openedAt: '2026-10-14T22:00:00.000Z', closedAt: '2026-10-14T22:00:00.000Z' };
  r.trades.push(today);
  assert.equal(validateContract('results', r).ok, true);
  r.days.push({ date: '2026-10-15', desks: {} });
  rejects(validateContract('results', r), 'dayDeskRequired', '$.days[1].desks.joel');
  r.days[1].coverage = 'partial';
  assert.equal(validateContract('results', r).ok, true);
  r.days[0].desks.j.trades++;
  rejects(validateContract('results', r), 'dayTradeCount', '$.days[0].desks.j.trades');
  r.days = [];
  assert.equal(validateContract('results', r).ok, true);
});

test('JOED-28 results: accept and warn only for missing closed Vienna dates, including the 25-hour DST day', () => {
  for (const [receivedAt, closedAt, coverage, expected] of [
    ['2026-10-16T12:00:00.000Z', '2026-10-15T15:00:00.000Z', null, ['2026-10-15']],
    ['2026-10-15T21:59:59.999Z', '2026-10-15T15:00:00.000Z', null, []],
    ['2026-10-15T22:00:00.000Z', '2026-10-15T15:00:00.000Z', null, ['2026-10-15']],
    ['2026-10-16T12:00:00.000Z', '2026-10-15T15:00:00.000Z', 'partial', []],
    ['2026-10-26T12:00:00.000Z', '2026-10-24T22:00:00.000Z', null, ['2026-10-25']],
    ['2026-10-26T12:00:00.000Z', '2026-10-25T00:30:00.000Z', null, ['2026-10-25']],
    ['2026-10-26T12:00:00.000Z', '2026-10-25T01:30:00.000Z', null, ['2026-10-25']],
    ['2026-10-26T12:00:00.000Z', '2026-10-25T22:59:59.999Z', null, ['2026-10-25']],
    ['2026-10-26T12:00:00.000Z', '2026-10-25T23:00:00.000Z', null, []],
  ]) {
    const value = ingress(samples.results);
    value.trades.push({ ...copy(value.trades[0]), id: 'rt-missing-day', openedAt: closedAt, closedAt });
    if (coverage) value.days.push({ date: '2026-10-15', coverage, desks: {}, partialReasons: ['history_gap'] });
    const accepted = acceptSnapshot('results', value, null, receivedAt);
    assert.equal(accepted.status, 200, closedAt);
    assert.deepEqual(accepted.value.missingDays ?? [], expected, closedAt);
    assert.equal(validateContract('results', accepted.value).ok, true);
    assert.equal(Object.hasOwn(value, 'missingDays'), false);
  }
  const value = ingress(samples.results);
  value.days = [];
  for (const [i, date] of ['2026-10-15', '2026-10-13', '2026-10-15'].entries()) {
    const closedAt = `${date}T15:00:00.000Z`;
    value.trades.push({ ...copy(value.trades[0]), id: `rt-missing-${i}`, openedAt: closedAt, closedAt });
  }
  assert.deepEqual(acceptSnapshot('results', value, null, '2026-10-16T12:00:00.000Z').value.missingDays,
    ['2026-10-13', '2026-10-14', '2026-10-15']);
  for (const missingDays of [[], ['2026-10-15']]) {
    rejects(acceptSnapshot('results', { ...value, missingDays }, null, '2026-10-16T12:00:00.000Z'), 'serverOwned', '$.missingDays');
  }
});

test('JOED-28 results: served missing-day diagnostics reject duplicate dates', () => {
  const value = { ...copy(samples.results), missingDays: ['2026-10-13', '2026-10-15'] };
  assert.equal(validateContract('results', value).ok, true);
  value.missingDays.push('2026-10-13');
  rejects(validateContract('results', value), 'uniqueItems', '$.missingDays');
});

test('JOED-34 rev 6: partial reasons follow the server receipt Vienna day across midnight and both DST changes', () => {
  for (const [receivedAt, today, yesterday] of [
    ['2026-10-15T21:59:59.999Z', '2026-10-15', '2026-10-14'],
    ['2026-10-15T22:00:00.000Z', '2026-10-16', '2026-10-15'],
    ['2026-10-24T22:00:00.000Z', '2026-10-25', '2026-10-24'],
    ['2026-10-25T00:30:00.000Z', '2026-10-25', '2026-10-24'],
    ['2026-10-25T01:30:00.000Z', '2026-10-25', '2026-10-24'],
    ['2026-10-25T22:59:59.999Z', '2026-10-25', '2026-10-24'],
    ['2026-10-25T23:00:00.000Z', '2026-10-26', '2026-10-25'],
    ['2027-03-27T23:00:00.000Z', '2027-03-28', '2027-03-27'],
    ['2027-03-28T21:59:59.999Z', '2027-03-28', '2027-03-27'],
    ['2027-03-28T22:00:00.000Z', '2027-03-29', '2027-03-28'],
  ]) {
    const value = ingress(samples.results);
    value.generatedAt = new Date(Date.parse(receivedAt) - 1000).toISOString();
    value.days = [{ date: today, desks: {}, coverage: 'partial' }];
    value.trades[0].openedAt = value.trades[0].closedAt = `${yesterday}T12:00:00.000Z`;
    for (const partialReasons of [undefined, ['fx_missing']]) {
      if (partialReasons) value.days[0].partialReasons = partialReasons;
      const accepted = acceptSnapshot('results', value, null, receivedAt);
      assert.equal(accepted.status, 200, `${receivedAt}: ${JSON.stringify(accepted.errors)}`);
      assert.deepEqual(accepted.value.days, value.days, 'receipt adds no invented cause');
      assert.deepEqual(accepted.value.missingDays, [yesterday], 'missingDays shares the receipt date');
      assert.ok(validateContract('results', accepted.value).ok, 'served uses the persisted receipt');

      const closed = copy(value); closed.seq++;
      closed.days.push({ date: yesterday, desks: {}, coverage: 'partial' });
      const rejected = acceptSnapshot('results', closed, accepted, receivedAt);
      rejects(rejected, 'partialReasonsRequired', '$.days[1].partialReasons');
      assert.strictEqual(rejected.value, accepted.value);
      rejects(validateContract('results', { ...closed, receivedAt }), 'partialReasonsRequired', '$.days[1].partialReasons');
      rejects(validateContract('results', closed, { stage: 'ingress', receivedAt }), 'partialReasonsRequired', '$.days[1].partialReasons');
      closed.days[1].partialReasons = ['history_gap'];
      const repaired = acceptSnapshot('results', closed, accepted, receivedAt);
      assert.equal(repaired.status, 200);
      assert.deepEqual(repaired.value.missingDays ?? [], []);
    }
    value.days[0].partialReasons = [];
    rejects(acceptSnapshot('results', value, null, receivedAt), 'minItems', '$.days[0].partialReasons');
  }
});

test('results: explicit partial days skip reconciliation only for that day; coverage is a closed optional enum', () => {
  const partial = JSON.parse(readFileSync(new URL('../fixtures/results/partial-day.json', import.meta.url)));
  assert.equal(validateContract('results', partial).ok, true);
  assert.equal(acceptSnapshot('results', ingress(partial), null, at).status, 200);
  for (const coverage of [undefined, 'full']) {
    const bad = copy(partial);
    if (coverage) bad.days[0].coverage = coverage; else delete bad.days[0].coverage;
    rejects(validateContract('results', bad), 'dayTradeCount', '$.days[0].desks.j.trades');
  }
  for (const coverage of ['windowed', '', null, true]) {
    const bad = copy(partial); bad.days[0].coverage = coverage;
    rejects(validateContract('results', bad), 'enum', '$.days[0].coverage');
  }
  const otherDay = copy(partial); otherDay.days[1].desks.j.trades = 1;
  rejects(validateContract('results', otherDay), 'dayTradeCount', '$.days[1].desks.j.trades');
  const badTrade = copy(partial); badTrade.trades[0].netEur.amount = '999';
  rejects(validateContract('results', badTrade), 'netAfterFees', '$.trades[0]');
});

test('results: daily reconciliation uses Vienna close dates across midnight and the 25-hour DST day', () => {
  const r = copy(samples.results);
  r.days = ['2026-10-24', '2026-10-25', '2026-10-26'].map(date => {
    const d = copy(r.days[0]); d.date = date;
    d.desks.j.trades = 1;
    return d;
  });
  r.trades = ['2026-10-24T21:59:59.999Z', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'].map((closedAt, i) => ({
    ...copy(samples.results.trades[0]), id: `rt-midnight-${i}`, openedAt: closedAt, closedAt,
  }));
  assert.equal(validateContract('results', r).ok, true);
  r.trades[1].closedAt = '2026-10-24T21:59:59.999Z'; r.trades[1].openedAt = r.trades[1].closedAt;
  rejects(validateContract('results', r), 'dayTradeCount', '$.days[0].desks.j.trades');
  rejects(validateContract('results', r), 'dayTradeCount', '$.days[1].desks.j.trades');
});

test('results: KEEP fixture excludes SXR8 and TSLA from both trade records and day totals', () => {
  const { sourceTrades, snapshot } = JSON.parse(readFileSync(new URL('../fixtures/results-keep-exclusion.json', import.meta.url)));
  assert.deepEqual(sourceTrades.filter(t => ['SXR8', 'TSLA'].includes(t.symbol)).map(t => t.symbol), ['SXR8', 'TSLA']);
  assert.deepEqual(snapshot.trades, sourceTrades.filter(t => !['SXR8', 'TSLA'].includes(t.symbol)));
  assert.equal(validateContract('results', snapshot).ok, true);
  assert.deepEqual(snapshot.days[0].desks.joel, { equityClose: { amount: '5000', currency: 'EUR' },
    realisedNet: { amount: '0', currency: 'EUR' }, fees: { amount: '0', currency: 'EUR' }, trades: 0 });
  for (const t of sourceTrades.filter(t => ['SXR8', 'TSLA'].includes(t.symbol))) {
    const bad = copy(snapshot); bad.trades.push(t);
    rejects(validateContract('results', bad), 'keepExcluded', '$.trades[1].symbol');
    bad.days[0].coverage = 'partial';
    rejects(validateContract('results', bad), 'keepExcluded', '$.trades[1].symbol');
  }
  for (const [field, value, rule] of [['trades', 2, 'dayTradeCount'],
    ['realisedNet', { amount: '303', currency: 'EUR' }, 'dayNetSum'], ['fees', { amount: '2', currency: 'EUR' }, 'dayFeeSum']]) {
    const bad = copy(snapshot); bad.days[0].desks.joel[field] = value;
    rejects(validateContract('results', bad), rule, `$.days[0].desks.joel.${field}`);
  }
});

test('accepted receive time belongs to the server; old, unknown, invalid and replayed input keep last-good', () => {
  for (const kind of ['data', 'history', 'results']) {
    const initial = acceptSnapshot(kind, ingress(samples[kind]), null, at);
    assert.equal(initial.status, 200);
    assert.equal(initial.value.receivedAt, at);
    for (const [change, rule, path, reason] of [
      [p => { p.schema = 'legacy.v0'; }, 'const', '$.schema', 'schema_unsupported'],
      [p => { p.schema = 'future.v99'; }, 'const', '$.schema', 'schema_unsupported'],
      [p => { p.extra = true; }, 'additionalProperties', '$'],
      [p => { p.receivedAt = later; }, 'serverOwned', '$.receivedAt'],
      [p => { p.seq = 0; }, 'minimum', '$.seq'],
      [p => { p.seq -= 1; }, 'sequenceReplayed', '$.seq', 'sequence_replayed'],
      [p => {
        p.generatedAt = '2026-10-14T17:40:00.000Z'; p.seq += 1;
        if (p.safety?.gateway) p.safety.gateway.checkedAt = p.generatedAt;
      }, 'clockRegressed', '$.generatedAt', 'clock_regressed'],
    ]) {
      const candidate = ingress(samples[kind]); change(candidate);
      const rejected = acceptSnapshot(kind, candidate, initial, later);
      rejects(rejected, rule, path, reason);
      assert.strictEqual(rejected.value, initial.value, kind);
      assert.deepEqual(initial.value, samples[kind]);
    }
    rejects(acceptSnapshot(kind, ingress(samples[kind]), initial, later), 'sequenceReplayed', '$.seq', 'sequence_replayed');
    const candidate = ingress(samples[kind]); candidate.seq++;
    rejects(acceptSnapshot(kind, candidate, initial, '2026-10-14T17:42:21.000Z'), 'clockRegressed', '$.receivedAt', 'clock_regressed');
    const unknown = acceptSnapshot(kind, { schema: 'future.v99' }, null, later);
    rejects(unknown, 'const', '$.schema', 'schema_unsupported');
    assert.equal(unknown.value, null);
  }
});

test('clock-ahead tolerance: exactly five seconds is valid; one more millisecond retains last-good', () => {
  for (const kind of ['data', 'history', 'results']) {
    const original = ingress(samples[kind]);
    const accepted = acceptSnapshot(kind, original, null, at);
    const candidate = ingress(samples[kind]); candidate.seq++;
    candidate.generatedAt = '2026-10-14T17:42:27.000Z';
    assert.equal(acceptSnapshot(kind, candidate, accepted, at).status, 200, kind);
    candidate.generatedAt = '2026-10-14T17:42:27.001Z';
    const rejected = acceptSnapshot(kind, candidate, accepted, at);
    rejects(rejected, 'clockAhead', '$.generatedAt', 'clock_ahead');
    assert.strictEqual(rejected.value, accepted.value);
    assert.equal(rejected.generatedAdvancedAt, accepted.generatedAdvancedAt);
  }
});

test('freshness is <60 seconds from receipt; frozen pushes stay stale until generation advances', () => {
  let data = acceptSnapshot('data', ingress(samples.data), null, at);
  const equity = now => panelState(data, data.value.totals.equity, null, now);
  assert.equal(equity('2026-10-14T17:43:21.999Z').state, 'fresh');
  assert.equal(equity('2026-10-14T17:43:22.000Z').state, 'stale');
  const candidate = ingress(samples.data); candidate.seq++;
  data = acceptSnapshot('data', candidate, data, '2026-10-14T17:44:22.000Z');
  const frozen = equity('2026-10-14T17:44:31.000Z');
  assert.equal(frozen.reason, 'producer_frozen');
  assert.equal(frozen.ageSeconds, 129);
  candidate.seq++; candidate.generatedAt = '2026-10-14T17:44:30.000Z';
  candidate.safety.gateway.checkedAt = candidate.generatedAt;
  data = acceptSnapshot('data', candidate, data, '2026-10-14T17:44:32.000Z');
  assert.equal(panelStates({ data }, '2026-10-14T17:44:33.000Z')['today.equity'].state, 'fresh');
});

test('field absence, known-empty and explicit failure differ; null equity preserves sibling values and last-good', () => {
  const feed = { value: copy(samples.data), generatedAdvancedAt: at };
  const previous = panelStates({ data: feed }, later);
  feed.value.totals.equity = null;
  feed.value.totals.reasons = { equity: 'family_projection_unavailable' };
  feed.value.positions.rows = [];
  delete feed.value.safety.executor;
  const states = panelStates({ data: feed }, later, previous);
  assert.equal(states['today.equity'].state, 'broken');
  assert.deepEqual(states['today.equity'].value, previous['today.equity'].value);
  assert.equal(states['today.equity'].retained, true);
  assert.equal(states['today.dayPnl'].state, 'fresh');
  assert.equal(states.positions.state, 'fresh');
  assert.deepEqual(states.positions.value, []);
  assert.equal(states.executor.state, 'not reported');
  delete feed.value.positions;
  assert.equal(panelStates({ data: feed }, later).positions.state, 'not reported');
});

test('contracts and panel selectors work when browser layout globals and storage are unavailable', async () => {
  const names = ['localStorage', 'sessionStorage', 'GridStack'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, {
      configurable: true, get() { throw new Error('Layout/storage is unavailable'); },
    });
    const module = await import('../contracts/index.mjs?no-layout');
    assert.equal(module.validateContract('data', samples.data).ok, true);
    const feed = acceptSnapshot('data', ingress(samples.data), null, at);
    assert.equal(panelStates({ data: feed }, later)['today.equity'].state, 'fresh');
  } finally {
    names.forEach((name, i) => {
      if (saved[i]) Object.defineProperty(globalThis, name, saved[i]);
      else delete globalThis[name];
    });
  }
});

test('money stays decimal-safe and currency/evidence errors are rejected', () => {
  assert.equal(decimalUnits('0.1') + decimalUnits('0.2'), decimalUnits('0.3'));
  assert.equal(decimalUnits('-0.005'), -500000n);
  assert.throws(() => decimalUnits('0.000000001'));
  for (const [modify, rule, path] of [
    [p => { p.totals.equity.amount = 14999; }, 'anyOf', '$.totals.equity'],
    [p => { p.totals.equity.amount = '14999.00000001'; }, 'deskSum', '$.totals.equity'],
    [p => { p.totals.equity.currency = 'USD'; }, 'EUR', '$.totals.equity'],
    [p => { delete p.pnlSources; }, 'evidenceRequired', '$.pnlSources.day'],
    [p => { delete p.pnlSources.day.periodStart; }, 'baselineRequired', '$.pnlSources.day.periodStart'],
    [p => { p.positions.source = 'book-sidefile'; }, 'const', '$.positions.source'],
    [p => { p.safety.gateway.apiSessionReady = false; }, 'reasonRequired', '$.safety.gateway.reason'],
  ]) {
    const payload = copy(samples.data); modify(payload);
    rejects(validateContract('data', payload), rule, path);
  }
  const results = copy(samples.results); results.trades[0].netEur.amount = '0';
  rejects(validateContract('results', results), 'netAfterFees', '$.trades[0]');
  const converted = copy(samples.data);
  converted.totals.equity.fx = copy(samples.results.trades[0].fx);
  assert.equal(validateContract('data', converted).ok, true);
  converted.totals.equity.fx.rate = '0.000';
  rejects(validateContract('data', converted), 'positiveFxRate', '$.totals.equity.fx');
});

test('calendar-invalid instants, duplicate desks, unbounded arrays and unordered history are rejected', () => {
  for (const value of ['2026-02-29T00:00:00.000Z', '2026-10-14T24:00:00.000Z', '2026-10-14T17:42:22Z']) {
    rejects(validateContract('data', { ...samples.data, generatedAt: value }), 'date-time', '$.generatedAt');
  }
  const duplicate = copy(samples.data); duplicate.desks[1].id = 'j';
  rejects(validateContract('data', duplicate), 'uniqueDesk', '$.desks');
  const history = copy(samples.history); history.points.reverse();
  rejects(validateContract('history', history), 'strictOrder', '$.points[1].t');
  history.points = Array(10001).fill(samples.history.points[0]);
  rejects(validateContract('history', history), 'maxItems', '$.points');
  const oversized = copy(samples.data); oversized.source.label = 'x'.repeat(262145);
  rejects(validateContract('data', oversized), 'maxBytes', '$');
});

test('healthz is an exact allowlist: nested money, identifiers, arbitrary text and missing feeds fail closed', () => {
  for (const [modify, rule, path] of [
    [p => { p.accountHint = 'synthetic'; }, 'additionalProperties', '$'],
    [p => { p.money = { amount: '1', currency: 'EUR' }; }, 'additionalProperties', '$'],
    [p => { p.feeds.data.detail = 'synthetic diagnostic'; }, 'additionalProperties', '$.feeds.data'],
    [p => { p.feeds.data.id = 'synthetic'; }, 'additionalProperties', '$.feeds.data'],
    [p => { delete p.feeds.results; }, 'required', '$.feeds.results'],
    [p => { p.feeds.data.state = 'stale'; }, 'reasonRequired', '$.feeds.data.reason'],
    [p => { p.version = '260229120000.0.0'; }, 'calendarCoordinate', '$.version'],
  ]) {
    const health = copy(samples.healthz); modify(health);
    rejects(validateContract('healthz', health), rule, path);
  }
});

test('production host remains inside the current canonical host gate', async () => {
  // P3 replaced the legacy board script with public/joe/host.js (ADR §8).
  const { isCanonicalJoeHost: isCanonical } = await import('../public/joe/host.js');
  assert.equal(isCanonical('cs0.barta.cm'), true);
  assert.equal(isCanonical('CS0.BARTA.CM'), true);
  assert.equal(isCanonical('example.invalid'), false);
});

function unavailableSession(payload) {
  payload.safety.gateway.apiSessionReady = false;
  payload.safety.gateway.reason = 'upstream_lost';
  for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) {
    bag.reasons = {};
    for (const field of ['equity', 'dayPnl', 'openPnl', 'totalPnl']) {
      bag[field] = null;
      bag.reasons[field] = 'upstream_lost';
    }
  }
  for (const source of Object.values(payload.pnlSources)) {
    source.status = 'unavailable';
    source.reason = 'upstream_lost';
  }
  payload.brokerAccount.equity = null;
  payload.brokerAccount.reason = 'upstream_lost';
  payload.positions.reason = 'upstream_lost';
  for (const row of payload.positions.rows) {
    for (const field of ['mark', 'marketValue', 'dayPnl', 'openPnl']) row[field] = null;
  }
  return payload;
}

test('fix2 finding 1: dead sessions cannot publish current money or marks through advancing pushes', () => {
  const contradictory = copy(samples.data);
  contradictory.safety.gateway.apiSessionReady = false;
  contradictory.safety.gateway.reason = 'upstream_lost';
  const rejected = validateContract('data', contradictory);
  rejects(rejected, 'sessionUnavailable', '$.totals.equity');

  let feed = acceptSnapshot('data', ingress(samples.data), null, at);
  let previous = panelStates({ data: feed }, at);
  for (let tick = 1; tick <= 20; tick++) {
    const receivedAt = new Date(Date.parse(at) + tick * 30000).toISOString();
    const candidate = unavailableSession(ingress(samples.data));
    candidate.seq += tick;
    candidate.generatedAt = receivedAt;
    // API observation times intentionally remain frozen while seq/generation advance.
    feed = acceptSnapshot('data', candidate, feed, receivedAt);
    assert.equal(feed.status, 200);
    const states = panelStates({ data: feed }, receivedAt, previous);
    for (const name of ['today.equity', 'today.dayPnl', 'today.openPnl', 'today.totalPnl',
      'paperAccount', 'desks.j.equity', 'desks.joe.equity', 'desks.joel.equity', 'positions', 'kept']) {
      assert.equal(states[name].state, 'broken', name);
      assert.equal(states[name].reason, 'upstream_lost', name);
    }
    for (const name of ['today.equity', 'paperAccount', 'desks.j.equity']) {
      assert.equal(states[name].retained, true);
      assert.equal(states[name].valueReceivedAt, at);
      assert.equal(states[name].ageSeconds, tick * 30);
    }
    assert.equal(states.positions.retained, false); // Current null marks are not last-good marks.
    assert.equal(states.positions.value[0].mark, null);
    previous = states;
  }
  for (const [mutate, path] of [
    [p => { p.totals.equity = copy(samples.data.totals.equity); }, '$.totals.equity'],
    [p => { p.desks[0].money.totalPnl = copy(samples.data.desks[0].money.totalPnl); }, '$.desks[0].money.totalPnl'],
    [p => { p.brokerAccount.equity = copy(samples.data.brokerAccount.equity); }, '$.brokerAccount.equity'],
    [p => { p.positions.rows[0].mark = copy(samples.data.positions.rows[0].mark); }, '$.positions.rows[0].mark'],
  ]) {
    const candidate = unavailableSession(copy(samples.data)); mutate(candidate);
    rejects(validateContract('data', candidate), 'sessionUnavailable', path);
  }
  const missingReason = unavailableSession(copy(samples.data));
  delete missingReason.totals.reasons.equity;
  rejects(validateContract('data', missingReason), 'reasonRequired', '$.totals.equity');
});

test('fix2 finding 2: every history field requires all three desks and their exact sum', () => {
  for (const field of ['equity', 'dayPnl', 'openPnl', 'totalPnl']) {
    for (const missing of ['null', 'field', 'desk', 'sum']) {
      const history = copy(samples.history);
      const point = history.points[1];
      if (missing === 'null') point.desks.j.money[field] = null;
      if (missing === 'field') delete point.desks.j.money[field];
      if (missing === 'desk') delete point.desks.j;
      if (missing === 'sum') point.totals[field].amount = '12345';
      const result = validateContract('history', history);
      rejects(result, missing === 'sum' ? 'deskSum' : 'incompleteDeskSum', `$.points[1].totals.${field}`);
    }
    const gap = copy(samples.history);
    gap.points[1].desks.j.money[field] = null;
    gap.points[1].totals[field] = null;
    gap.points[1].totals.reasons = { [field]: 'family_projection_unavailable' };
    assert.equal(validateContract('history', gap).ok, true);
  }
});

test('fix2 finding 3: legacy observation, estimate and unavailable semantics have explicit v2 homes', () => {
  const observed = copy(samples.data);
  observed.desks[0].moneyEvidence = { status: 'observed', observedAt: at };
  assert.equal(validateContract('data', observed).ok, true);
  observed.desks[0].moneyEvidence.status = 'carried';
  rejects(validateContract('data', observed), 'const', '$.desks[0].moneyEvidence.status');

  const estimate = copy(samples.data);
  estimate.pnlSources.day.detail = 'session_open_proxy: synthetic session observation';
  rejects(validateContract('data', estimate), 'estimateMethodRequired', '$.pnlSources.day.method');
  estimate.pnlSources.day.method = 'session-open-estimate';
  estimate.pnlSources.open.detail = 'Synthetic owned-lot valuation';
  assert.equal(validateContract('data', estimate).ok, true);
  delete estimate.pnlSources.day.periodStart;
  rejects(validateContract('data', estimate), 'baselineRequired', '$.pnlSources.day.periodStart');
  estimate.pnlSources.day.periodStart = at;
  estimate.pnlSources.day.method = 'unreviewed-estimate';
  rejects(validateContract('data', estimate), 'anyOf', '$.pnlSources.day.method');

  const unavailable = unavailableSession(copy(samples.data));
  unavailable.pnlSources.day.detail = 'Synthetic source unavailable';
  assert.equal(validateContract('data', unavailable).ok, true);
  unavailable.pnlSources.day.reason = 'arbitrary producer wording';
  rejects(validateContract('data', unavailable), 'enum', '$.pnlSources.day.reason');
  const pending = copy(samples.data);
  pending.pnlSources.day.status = 'unavailable';
  pending.pnlSources.day.reason = 'baseline_pending';
  for (const bag of [pending.totals, ...pending.desks.map(d => d.money)]) bag.dayPnl = null;
  assert.equal(validateContract('data', pending).ok, true);
  assert.equal(panelStates({ data: { value: pending } }, later)['today.dayPnl'].reason, 'baseline_pending');
});

test('fix2 finding 4: rejected and unreachable feeds expose retention with the last-good age', () => {
  const accepted = acceptSnapshot('data', ingress(samples.data), null, at);
  const failedAt = '2026-10-14T17:52:22.000Z';
  const now = '2026-10-14T17:52:31.000Z';
  const rejected = acceptSnapshot('data', { ...ingress(samples.data), schema: 'old.v0' }, accepted, failedAt);
  for (const feed of [rejected, { ...accepted, reason: 'refresh_failed', rejectedAt: failedAt }]) {
    const state = panelStates({ data: feed }, now)['today.equity'];
    assert.equal(state.retained, true);
    assert.strictEqual(state.value, accepted.value.totals.equity);
    assert.equal(state.ageSeconds, 609);
    assert.equal(feed.value.receivedAt, at);
  }
  const empty = copy(accepted);
  empty.value.positions.rows = [];
  const retained = panelStates({ data: { ...empty, reason: 'refresh_failed' } }, now);
  assert.equal(retained.positions.retained, true);
  assert.equal(retained.halt.retained, true); // false is a reported last-good value.
  assert.equal(panelStates({ data: { reason: 'refresh_failed' } }, now)['today.equity'].retained, false);
});

test('fix2 finding 5: fleet KEEP policy routes rows regardless of producer scope and flags disagreement', () => {
  const data = { value: copy(samples.data) };
  const policy = copy(samples['fleet-config']);
  policy.desks.keep.push('DEMO');
  const feeds = { data, 'fleet-config': { value: policy } };
  let states = panelStates(feeds, later);
  assert.deepEqual(states.positions.value, []);
  assert.deepEqual(states.kept.value.map(p => p.symbol), ['DEMO', 'SXR8', 'TSLA']);
  assert.equal(states.kept.reason, 'source_not_authoritative');
  assert.equal(states.positions.reason, 'source_not_authoritative');
  assert.equal(states['today.equity'].state, 'broken');
  assert.equal(states['today.equity'].value, null);
  assert.equal(states['desks.j.equity'].state, 'broken');
  assert.equal(states['desks.joe.equity'].state, 'fresh');
  assert.equal(data.value.positions.rows[0].scope, 'stage0'); // Never rewrite producer evidence.
  data.value.positions.rows[0].scope = 'keep';
  data.value.positions.rows[0].desk = null;
  states = panelStates(feeds, later);
  assert.equal(states.kept.state, 'fresh');
  policy.desks.keep = policy.desks.keep.filter(s => s !== 'DEMO');
  states = panelStates(feeds, later);
  assert.deepEqual(states.positions.value.map(p => p.symbol), ['DEMO']);
  assert.equal(states.positions.reason, 'source_not_authoritative');
});

const moneyPanels = [
  ...MONEY_FIELDS.map(field => `today.${field}`), 'paperAccount',
  ...['j', 'joe', 'joel'].flatMap(id => MONEY_FIELDS.map(field => `desks.${id}.${field}`)),
];
const gatedPanels = [...moneyPanels, 'positions', 'kept', 'gateway'];
function unconfirmedSession(payload, scenario) {
  payload.safety.gateway ??= { apiSessionReady: false, checkedAt: at };
  unavailableSession(payload);
  if (scenario === 'missing') delete payload.safety.gateway;
  else payload.safety.gateway = { apiSessionReady: true, checkedAt: at };
  for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) {
    for (const field of MONEY_FIELDS) bag.reasons[field] = 'gateway_unconfirmed';
  }
  for (const source of Object.values(payload.pnlSources)) source.reason = 'gateway_unconfirmed';
  payload.brokerAccount.reason = payload.positions.reason = 'gateway_unconfirmed';
  return payload;
}

for (const scenario of ['missing', 'frozen-ready']) {
  test(`fix3 finding 1: ${scenario} gateway cannot freshen money over 20 advancing pushes`, () => {
    let feed = acceptSnapshot('data', ingress(samples.data), null, at);
    let previous = panelStates({ data: feed }, at);
    let lastGoodAt = at;
    for (let tick = 1; tick <= 20; tick++) {
      const now = new Date(Date.parse(at) + tick * 30000).toISOString();
      const current = ingress(samples.data);
      current.seq += tick;
      current.generatedAt = now;
      if (scenario === 'missing') delete current.safety.gateway;
      const unconfirmed = scenario === 'missing' || tick >= 2;
      const attempt = acceptSnapshot('data', current, feed, now);
      if (!unconfirmed) {
        assert.equal(attempt.status, 200);
        feed = attempt;
        previous = panelStates({ data: feed }, now, previous);
        assert.equal(previous['today.equity'].state, 'fresh');
        lastGoodAt = now;
        continue;
      }
      rejects(attempt, 'sessionUnavailable', '$.totals.equity');
      assert.strictEqual(attempt.value, feed.value);
      const withoutPush = panelStates({ data: feed }, now, previous);
      // In the frozen case the last accepted ready check expires independently
      // of receipt/generation progress, even without another acceptance call.
      if (scenario === 'frozen-ready') for (const name of gatedPanels) {
        assert.equal(withoutPush[name].state, 'broken', name);
        assert.equal(withoutPush[name].reason, 'gateway_unconfirmed', name);
      }
      const candidate = unconfirmedSession(current, scenario);
      const missingReason = copy(candidate);
      delete missingReason.totals.reasons.equity;
      rejects(validateContract('data', missingReason, { stage: 'ingress' }), 'reasonRequired', '$.totals.equity');
      feed = acceptSnapshot('data', candidate, feed, now);
      assert.equal(feed.status, 200);
      assert.equal(feed.value.generatedAt, now);
      const states = panelStates({ data: feed }, now, previous);
      for (const name of gatedPanels) {
        assert.equal(states[name].state, 'broken', name);
        assert.equal(states[name].reason, 'gateway_unconfirmed', name);
      }
      for (const name of moneyPanels) {
        assert.equal(states[name].retained, true, name);
        assert.equal(states[name].valueReceivedAt, lastGoodAt, name);
        assert.equal(states[name].ageSeconds, (Date.parse(now) - Date.parse(lastGoodAt)) / 1000, name);
      }
      for (const name of ['positions', 'kept']) for (const row of states[name].value) {
        for (const field of ['mark', 'marketValue', 'dayPnl', 'openPnl']) assert.equal(row[field], null);
      }
      assert.equal(states.halt.state, 'fresh');
      assert.equal(panelStates({ data: feed }, now)['today.equity'].value, null);
      previous = states;
    }
    const recovered = ingress(samples.data);
    recovered.seq += 21;
    recovered.generatedAt = recovered.safety.gateway.checkedAt = '2026-10-14T17:52:52.000Z';
    feed = acceptSnapshot('data', recovered, feed, recovered.generatedAt);
    assert.equal(feed.status, 200);
    for (const name of gatedPanels) assert.equal(panelStates({ data: feed }, recovered.generatedAt, previous)[name].state, 'fresh', name);
  });
}

test('fix3 finding 1: check age is bounded at 60s and future checks cannot confirm money', () => {
  // The check expires while this receipt is still only 30 seconds old.
  const payload = ingress(samples.data);
  payload.generatedAt = later;
  const feed = acceptSnapshot('data', payload, null, later);
  assert.equal(feed.status, 200);
  assert.equal(panelStates({ data: feed }, '2026-10-14T17:43:21.999Z')['today.equity'].state, 'fresh');
  const previous = panelStates({ data: feed }, later);
  const expired = panelStates({ data: feed }, '2026-10-14T17:43:22.000Z', previous);
  for (const name of gatedPanels) assert.equal(expired[name].reason, 'gateway_unconfirmed', name);
  assert.equal(expired.positions.retained, true);
  assert.equal(expired.positions.valueReceivedAt, later);
  for (const offset of [59999, 60000, -1]) {
    const payload = copy(samples.data);
    payload.generatedAt = new Date(Date.parse(at) + offset).toISOString();
    if (offset === 59999) assert.equal(validateContract('data', payload).ok, true);
    else rejects(validateContract('data', payload), 'sessionUnavailable', '$.totals.equity');
  }
});

test('fix4 A: receipt and frozen-generation boundaries stay stale instead of becoming gateway failures', () => {
  const initial = acceptSnapshot('data', ingress(samples.data), null, at);
  const repeat = ingress(samples.data); repeat.seq++;
  const frozen = acceptSnapshot('data', repeat, initial, later);
  assert.equal(frozen.status, 200);
  for (const [feed, staleReason] of [[initial, 'snapshot_stale'], [frozen, 'producer_frozen']]) {
    let previous = panelStates({ data: feed }, later);
    for (const elapsed of [59999, 60000, 60001, 90000]) {
      const now = new Date(Date.parse(at) + elapsed).toISOString();
      const states = panelStates({ data: feed }, now, previous);
      for (const name of gatedPanels) {
        assert.equal(states[name].state, elapsed < 60000 ? 'fresh' : 'stale', name);
        assert.equal(states[name].reason, elapsed < 60000 ? null : staleReason, name);
        const age = (feed === frozen && elapsed < 60000 && name !== 'gateway' ? elapsed - 30000 : elapsed) / 1000;
        assert.equal(states[name].ageSeconds, age, name);
        assert.deepEqual(states[name].value, previous[name].value, name);
        assert.equal(states[name].retained, false, name);
      }
      previous = states;
    }
  }
});

test('fix4 A: cold loads at and after 60 seconds show stale money without prior selector state', () => {
  const feed = acceptSnapshot('data', ingress(samples.data), null, at);
  const original = panelStates({ data: feed }, at);
  for (const elapsed of [60000, 609000]) {
    const now = new Date(Date.parse(at) + elapsed).toISOString();
    const states = panelStates({ data: feed }, now);
    for (const name of moneyPanels) {
      assert.equal(states[name].state, 'stale', name);
      assert.equal(states[name].reason, 'snapshot_stale', name);
      assert.equal(states[name].ageSeconds, elapsed / 1000, name);
      assert.deepEqual(states[name].value, original[name].value, name);
      assert.notEqual(states[name].value, null, name);
    }
  }
});

for (const skewMs of [5000, -61000]) {
  test(`fix4 B: producer clock skew ${skewMs}ms confirms generation-time checks without flicker`, () => {
    let feed = null;
    for (let tick = 0; tick < 20; tick++) {
      const receivedAt = new Date(Date.parse(at) + tick * 30000).toISOString();
      const payload = ingress(samples.data);
      payload.seq += tick;
      payload.generatedAt = payload.safety.gateway.checkedAt = new Date(Date.parse(receivedAt) + skewMs).toISOString();
      feed = acceptSnapshot('data', payload, feed, receivedAt);
      assert.equal(feed.status, 200);
      for (const elapsed of [0, 1000, 4999, 5000, 29999]) {
        const now = new Date(Date.parse(receivedAt) + elapsed).toISOString();
        const states = panelStates({ data: feed }, now);
        for (const name of gatedPanels) assert.equal(states[name].state, 'fresh', name);
        assert.equal(states.gateway.ageSeconds, elapsed / 1000);
        assert.deepEqual(states['today.equity'].value, samples.data.totals.equity);
      }
    }
  });
}

test('fix4 B: gateway displays check age, including its initial age and frozen-generation elapsed time', () => {
  const payload = ingress(samples.data);
  payload.safety.gateway.checkedAt = '2026-10-14T17:42:02.000Z'; // 20 seconds before generation.
  const initial = acceptSnapshot('data', payload, null, at);
  assert.equal(initial.status, 200);
  for (const [elapsed, state, reason] of [
    [9000, 'fresh', null], [45000, 'broken', 'gateway_unconfirmed'], [60000, 'stale', 'snapshot_stale'],
  ]) {
    const now = new Date(Date.parse(at) + elapsed).toISOString();
    const gateway = panelStates({ data: initial }, now).gateway;
    assert.equal(gateway.state, state);
    assert.equal(gateway.reason, reason);
    assert.equal(gateway.ageSeconds, 20 + elapsed / 1000);
  }
  payload.seq++;
  const frozen = acceptSnapshot('data', payload, initial, '2026-10-14T17:44:22.000Z');
  assert.equal(frozen.status, 200);
  const states = panelStates({ data: frozen }, '2026-10-14T17:44:31.000Z');
  assert.equal(states.gateway.ageSeconds, 149);
  assert.equal(states.gateway.state, 'stale');
  assert.equal(states.gateway.reason, 'producer_frozen');
  assert.equal(states['today.equity'].ageSeconds, 129);
  assert.equal(states['today.equity'].state, 'stale');
});

for (const scenario of ['missing', 'frozen-ready']) {
  test(`fix5 C: ${scenario} gateway stays unconfirmed at 60s and 300s after receipt`, () => {
    const initial = acceptSnapshot('data', ingress(samples.data), null, at);
    const previous = panelStates({ data: initial }, at);
    const payload = unconfirmedSession(ingress(samples.data), scenario);
    payload.seq++;
    payload.generatedAt = '2026-10-14T17:52:22.000Z'; // Ready check already 600s old at generation.
    const feed = acceptSnapshot('data', payload, initial, payload.generatedAt);
    assert.equal(feed.status, 200);
    for (const elapsed of [60000, 300000]) {
      const now = new Date(Date.parse(feed.value.receivedAt) + elapsed).toISOString();
      for (const prior of [{}, previous]) {
        const states = panelStates({ data: feed }, now, prior);
        for (const name of gatedPanels) {
          assert.equal(states[name].state, 'broken', name);
          assert.equal(states[name].reason, 'gateway_unconfirmed', name);
        }
        if (scenario === 'frozen-ready') assert.equal(states.gateway.ageSeconds, 600 + elapsed / 1000);
        for (const name of moneyPanels) {
          assert.deepEqual(states[name].value, prior[name]?.value ?? null, name);
          assert.equal(states[name].retained, Boolean(prior[name]), name);
          assert.equal(states[name].valueReceivedAt, prior[name]?.valueReceivedAt ?? feed.value.receivedAt, name);
          assert.equal(states[name].ageSeconds, prior[name] ? 600 + elapsed / 1000 : elapsed / 1000, name);
        }
      }
    }
  });
}

test('fix5 D: missing receipt or invalid receipt/progress timing fails closed before selecting money', () => {
  const initial = acceptSnapshot('data', ingress(samples.data), null, at);
  const previous = panelStates({ data: initial }, at);
  for (const corrupt of [
    feed => { delete feed.value.receivedAt; },
    feed => { delete feed.value.receivedAt; delete feed.generatedAdvancedAt; },
    feed => { delete feed.value.receivedAt; feed.receivedAt = at; },
    feed => { feed.value.receivedAt = 'invalid'; },
    ...['invalid', '2026-02-29T00:00:00.000Z', null, 0].map(value =>
      feed => { feed.generatedAdvancedAt = value; }),
  ]) {
    const feed = copy(initial);
    corrupt(feed);
    for (const elapsed of [0, 60000, 600000]) {
      const now = new Date(Date.parse(at) + elapsed).toISOString();
      for (const prior of [{}, previous]) {
        const states = panelStates({ data: feed }, now, prior);
        for (const name of gatedPanels) {
          assert.equal(states[name].state, 'broken', name);
          assert.equal(states[name].reason, 'contract_invalid', name);
          assert.ok(REASONS.includes(states[name].reason), name);
        }
        for (const name of moneyPanels) {
          assert.deepEqual(states[name].value, prior[name]?.value ?? null, name);
          assert.equal(states[name].retained, Boolean(prior[name]), name);
          assert.ok(states[name].ageSeconds === null || Number.isFinite(states[name].ageSeconds), name);
          if (prior[name]) {
            assert.equal(states[name].valueReceivedAt, prior[name].valueReceivedAt, name);
            assert.equal(states[name].ageSeconds, elapsed / 1000, name);
          }
        }
      }
    }
  }
});

test('fix3 low 4: unavailable or unconfirmed sessions reject observed money evidence even with null money', () => {
  for (const scenario of ['dead', 'missing', 'frozen-ready']) for (let i = 0; i < 3; i++) {
    const payload = scenario === 'dead' ? unavailableSession(copy(samples.data)) : unconfirmedSession(copy(samples.data), scenario);
    payload.generatedAt = '2026-10-14T17:52:22.000Z';
    payload.desks[i].moneyEvidence = { status: 'observed', observedAt: at };
    rejects(validateContract('data', payload), 'sessionUnavailable', `$.desks[${i}].moneyEvidence`);
    delete payload.desks[i].moneyEvidence;
    assert.equal(validateContract('data', payload).ok, true);
  }
});

test('fix3 low 6: a retained value without its receipt time keeps unknown age across newer feeds', () => {
  for (const receivedAt of [at, later, '2026-10-14T17:52:22.000Z']) {
    const retained = panelState({ value: { receivedAt } }, null, 'gateway_unconfirmed',
      '2026-10-14T17:52:31.000Z', samples.data.totals.equity);
    assert.equal(retained.retained, true);
    assert.equal(retained.valueReceivedAt, null);
    assert.equal(retained.ageSeconds, null);
  }
});

test('fix3 low 7: baselineRequired names the source period that lacks its start', () => {
  for (const period of ['day', 'open']) {
    const payload = copy(samples.data);
    payload.pnlSources[period].method = 'sod-virtual-equity';
    payload.pnlSources[period].status = 'unavailable';
    for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) bag[`${period}Pnl`] = null;
    delete payload.pnlSources[period].periodStart;
    rejects(validateContract('data', payload), 'baselineRequired', `$.pnlSources.${period}.periodStart`);
  }
});

test('fix3 low 5: carried valuation maps to null plus retained_values with its original receipt age', () => {
  const initial = { value: copy(samples.data) };
  const previous = panelStates({ data: initial }, at);
  const payload = copy(samples.data);
  payload.receivedAt = later;
  for (const bag of [payload.totals, ...payload.desks.map(d => d.money)]) {
    bag.equity = bag.totalPnl = null;
    bag.reasons = { equity: 'retained_values', totalPnl: 'retained_values' };
  }
  assert.equal(validateContract('data', payload).ok, true);
  const states = panelStates({ data: { value: payload } }, later, previous);
  for (const name of ['today.equity', 'today.totalPnl', 'desks.j.equity', 'desks.joe.totalPnl']) {
    assert.equal(states[name].reason, 'retained_values');
    assert.equal(states[name].retained, true);
    assert.equal(states[name].valueReceivedAt, at);
    assert.equal(states[name].ageSeconds, 30);
  }
  assert.equal(states['today.dayPnl'].state, 'fresh');
});


test('JOED-30 rev 5: optional canonical partial reasons, reserved code and empty desks accept through ingress', () => {
  const codes = ['capture_gap', 'history_gap', 'broker_trade_count_mismatch', 'broker_realised_pnl_mismatch',
    'unattributed_activity', 'avg_cost_mismatch', 'fx_disabled', 'fx_missing', 'broker_evidence_missing'];
  assert.deepEqual(SCHEMAS.results.properties.days.items.properties.partialReasons.items.enum, codes);
  for (const partialReasons of [undefined, ['history_gap'], ['avg_cost_mismatch'], codes]) {
    const value = ingress(samples.results);
    value.days[0] = { date: value.days[0].date, desks: {}, coverage: 'partial',
      ...(partialReasons ? { partialReasons } : {}) };
    for (const unattributedCount of partialReasons === codes ? [undefined, 1, 2] : [undefined]) {
      if (unattributedCount !== undefined) value.days[0].unattributedCount = unattributedCount;
      const accepted = acceptSnapshot('results', value, null, at);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.errors));
      assert.deepEqual(accepted.value.days, value.days);
      assert.equal(validateContract('results', accepted.value).ok, true);
    }
  }
});

test('JOED-30 rev 5: each partial-reason semantic violation returns a per-day 422 and retains last good', () => {
  const value = ingress(samples.results);
  value.days[0] = { date: value.days[0].date, desks: {}, coverage: 'partial', partialReasons: ['history_gap'] };
  const good = acceptSnapshot('results', value, null, at).value;
  for (const [mutate, rule, field] of [
    [d => { delete d.coverage; }, 'partialCoverageRequired', 'partialReasons'],
    [d => { d.coverage = 'full'; }, 'partialCoverageRequired', 'partialReasons'],
    [d => { d.partialReasons = ['history_gap', 'capture_gap']; }, 'canonicalOrder', 'partialReasons'],
    [d => { d.unattributedCount = 1; }, 'unattributedReasonRequired', 'unattributedCount'],
    [d => { delete d.partialReasons; d.unattributedCount = 1; }, 'unattributedReasonRequired', 'unattributedCount'],
  ]) {
    const bad = copy(value); bad.seq++; mutate(bad.days[0]);
    const accepted = acceptSnapshot('results', bad, { value: good }, later);
    rejects(accepted, rule, `$.days[0].${field}`);
    assert.strictEqual(accepted.value, good);
  }
});

test('JOED-30 rev 5: reasons are nonempty, unique and closed; counts are positive integers', () => {
  for (const [field, item, rule, path] of [
    ['partialReasons', [], 'minItems', 'partialReasons'],
    ['partialReasons', ['capture_gap', 'capture_gap'], 'uniqueItems', 'partialReasons'],
    ['partialReasons', ['future_code'], 'enum', 'partialReasons[0]'],
    ['partialReasons', [1], 'type', 'partialReasons[0]'],
    ['unattributedCount', -1, 'minimum', 'unattributedCount'],
    ['unattributedCount', 0, 'minimum', 'unattributedCount'],
    ['unattributedCount', 1.5, 'type', 'unattributedCount'],
    ['unattributedCount', null, 'type', 'unattributedCount'],
  ]) {
    const value = ingress(samples.results);
    value.days[0] = { date: value.days[0].date, desks: {}, coverage: 'partial', partialReasons: ['unattributed_activity'], [field]: item };
    rejects(acceptSnapshot('results', value, null, at), rule, `$.days[0].${path}`);
  }
});
