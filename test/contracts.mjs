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
  assert.equal(owners['data.safety.executor.gatewayReachable'], 'paper executor 8470');
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
  }
  const data = copy(samples.data);
  data.totals.reasons = { equity: 'new-unreviewed-reason' };
  rejects(validateContract('data', data), 'enum', '$.totals.reasons.equity');
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

test('production host remains inside the current canonical host gate', () => {
  const source = readFileSync(new URL('../public/joe/joe.js', import.meta.url), 'utf8');
  const start = source.indexOf('function isCanonicalJoeHost');
  const end = source.indexOf('\n  var LAYOUT_KEY', start);
  assert.ok(start >= 0 && end > start);
  const isCanonical = new Function(`${source.slice(start, end)}; return isCanonicalJoeHost;`)();
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
