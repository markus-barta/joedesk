import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONTRACTS, SCHEMAS, SCHEMA_FILES, REASONS, validateContract, validateAndRetain } from '../contracts/index.mjs';
import { resolveRef } from '../contracts/schema-validator.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { decimalUnits } from '../contracts/decimal.mjs';
import { panelStates } from '../contracts/panel-state.mjs';

const samples = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const at = '2026-10-14T17:42:22.000Z';
const later = '2026-10-14T17:42:52.000Z';
const copy = v => structuredClone(v);
const ingress = v => { const next = copy(v); delete next.receivedAt; return next; };

for (const kind of Object.keys(SCHEMAS)) {
  test(`contract ${kind}: valid, invalid, old and unknown return explicit outcomes`, () => {
    assert.equal(validateContract(kind, samples[kind]).ok, true);
    const bad = { ...samples[kind], unexpected: 'synthetic' };
    assert.equal(validateContract(kind, bad).status, 422);
    assert.strictEqual(validateAndRetain(kind, bad, samples[kind]).value, samples[kind]);
    for (const schema of ['legacy.v0', 'unknown.v99', null]) {
      const result = validateContract(kind, { ...samples[kind], schema });
      assert.equal(result.status, 422);
      assert.equal(result.reason, 'schema_unsupported');
      assert.strictEqual(validateAndRetain(kind, { ...samples[kind], schema }, samples[kind]).value, samples[kind]);
    }
    assert.equal(validateContract(kind, { schema: CONTRACTS.contracts[kind] }).status, 422);
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
  assert.equal(validateContract('data', data).status, 422);
});

test('paper is fixed, KEEP is excluded from results and cannot be removed from fleet policy', () => {
  const data = { ...samples.data, mode: 'LIVE' };
  assert.equal(validateContract('data', data).status, 422);
  for (const symbol of ['SXR8', 'TSLA']) {
    const results = copy(samples.results);
    results.trades[0].symbol = symbol;
    assert.equal(validateContract('results', results).status, 422);
    const fleet = copy(samples['fleet-config']);
    fleet.desks.keep = fleet.desks.keep.filter(s => s !== symbol);
    assert.equal(validateContract('fleet-config', fleet).status, 422);
    const data = copy(samples.data);
    data.positions.rows[0].symbol = symbol;
    assert.equal(validateContract('data', data).status, 422);
  }
  assert.equal(validateContract('fleet-config', { ...samples['fleet-config'], mode: 'live' }).status, 422);
});

test('accepted receive time belongs to the server; old, unknown, invalid and replayed input keep last-good', () => {
  for (const kind of ['data', 'history', 'results']) {
    const initial = acceptSnapshot(kind, ingress(samples[kind]), null, at);
    assert.equal(initial.status, 200);
    assert.equal(initial.value.receivedAt, at);
    for (const change of [
      p => { p.schema = 'legacy.v0'; }, p => { p.schema = 'future.v99'; },
      p => { p.extra = true; }, p => { p.receivedAt = later; },
      p => { p.seq = 0; }, p => { p.seq -= 1; },
      p => { p.generatedAt = '2026-10-14T17:40:00.000Z'; p.seq += 1; },
    ]) {
      const candidate = ingress(samples[kind]); change(candidate);
      const rejected = acceptSnapshot(kind, candidate, initial, later);
      assert.equal(rejected.status, 422, kind);
      assert.strictEqual(rejected.value, initial.value, kind);
      assert.deepEqual(initial.value, samples[kind]);
    }
    assert.equal(acceptSnapshot(kind, ingress(samples[kind]), initial, later).reason, 'sequence_replayed');
    const candidate = ingress(samples[kind]); candidate.seq++;
    assert.equal(acceptSnapshot(kind, candidate, initial, '2026-10-14T17:42:21.000Z').reason, 'clock_regressed');
    assert.equal(acceptSnapshot(kind, { schema: 'future.v99' }, null, later).value, null);
  }
});

test('freshness is <60 seconds from receipt; frozen pushes stay stale until generation advances', () => {
  let data = acceptSnapshot('data', ingress(samples.data), null, at);
  assert.equal(panelStates({ data }, '2026-10-14T17:43:21.999Z')['today.equity'].state, 'fresh');
  assert.equal(panelStates({ data }, '2026-10-14T17:43:22.000Z')['today.equity'].state, 'stale');
  const candidate = ingress(samples.data); candidate.seq++;
  data = acceptSnapshot('data', candidate, data, '2026-10-14T17:44:22.000Z');
  const frozen = panelStates({ data }, '2026-10-14T17:44:31.000Z')['today.equity'];
  assert.equal(frozen.reason, 'producer_frozen');
  assert.equal(frozen.ageSeconds, 129);
  candidate.seq++; candidate.generatedAt = '2026-10-14T17:44:30.000Z';
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
  for (const modify of [
    p => { p.totals.equity.amount = 14999; },
    p => { p.totals.equity.amount = '14999.00000001'; },
    p => { p.totals.equity.currency = 'USD'; },
    p => { delete p.pnlSources; },
    p => { delete p.pnlSources.day.periodStart; },
    p => { p.positions.source = 'book-sidefile'; },
    p => { p.safety.gateway.apiSessionReady = false; },
  ]) {
    const payload = copy(samples.data); modify(payload);
    assert.equal(validateContract('data', payload).status, 422);
  }
  const results = copy(samples.results); results.trades[0].netEur.amount = '0';
  assert.equal(validateContract('results', results).status, 422);
  const converted = copy(samples.data);
  converted.totals.equity.fx = copy(samples.results.trades[0].fx);
  assert.equal(validateContract('data', converted).ok, true);
  converted.totals.equity.fx.rate = '0.000';
  assert.equal(validateContract('data', converted).status, 422);
});

test('calendar-invalid instants, duplicate desks, unbounded arrays and unordered history are rejected', () => {
  for (const value of ['2026-02-29T00:00:00.000Z', '2026-10-14T24:00:00.000Z', '2026-10-14T17:42:22Z']) {
    assert.equal(validateContract('data', { ...samples.data, generatedAt: value }).status, 422);
  }
  const duplicate = copy(samples.data); duplicate.desks[1].id = 'j';
  assert.equal(validateContract('data', duplicate).status, 422);
  const history = copy(samples.history); history.points.reverse();
  assert.equal(validateContract('history', history).status, 422);
  history.points = Array(10001).fill(samples.history.points[0]);
  assert.equal(validateContract('history', history).status, 422);
  const oversized = copy(samples.data); oversized.source.label = 'x'.repeat(262145);
  assert.ok(validateContract('data', oversized).errors.some(e => e.rule === 'maxBytes'));
});

test('healthz is an exact allowlist: nested money, identifiers, arbitrary text and missing feeds fail closed', () => {
  for (const modify of [
    p => { p.accountHint = 'synthetic'; }, p => { p.money = { amount: '1', currency: 'EUR' }; },
    p => { p.feeds.data.detail = 'synthetic diagnostic'; }, p => { p.feeds.data.id = 'synthetic'; },
    p => { delete p.feeds.results; }, p => { p.feeds.data.state = 'stale'; },
    p => { p.version = '260229120000.0.0'; },
  ]) {
    const health = copy(samples.healthz); modify(health);
    assert.equal(validateContract('healthz', health).status, 422);
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
  assert.equal(rejected.status, 422);
  assert.ok(rejected.errors.some(e => e.rule === 'sessionUnavailable'));

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
  for (const mutate of [
    p => { p.totals.equity = copy(samples.data.totals.equity); },
    p => { p.desks[0].money.totalPnl = copy(samples.data.desks[0].money.totalPnl); },
    p => { p.brokerAccount.equity = copy(samples.data.brokerAccount.equity); },
    p => { p.positions.rows[0].mark = copy(samples.data.positions.rows[0].mark); },
  ]) {
    const candidate = unavailableSession(copy(samples.data)); mutate(candidate);
    assert.ok(validateContract('data', candidate).errors.some(e => e.rule === 'sessionUnavailable'));
  }
  const missingReason = unavailableSession(copy(samples.data));
  delete missingReason.totals.reasons.equity;
  assert.ok(validateContract('data', missingReason).errors.some(e => e.rule === 'reasonRequired'));
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
      assert.equal(result.status, 422, `${field}: ${missing}`);
      assert.ok(result.errors.some(e => e.path === `$.points[1].totals.${field}` &&
        e.rule === (missing === 'sum' ? 'deskSum' : 'incompleteDeskSum')));
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
  assert.equal(validateContract('data', observed).status, 422);

  const estimate = copy(samples.data);
  estimate.pnlSources.day.detail = 'session_open_proxy: synthetic session observation';
  assert.ok(validateContract('data', estimate).errors.some(e => e.rule === 'estimateMethodRequired'));
  estimate.pnlSources.day.method = 'session-open-estimate';
  estimate.pnlSources.open.detail = 'Synthetic owned-lot valuation';
  assert.equal(validateContract('data', estimate).ok, true);
  delete estimate.pnlSources.day.periodStart;
  assert.ok(validateContract('data', estimate).errors.some(e => e.rule === 'baselineRequired'));
  estimate.pnlSources.day.periodStart = at;
  estimate.pnlSources.day.method = 'unreviewed-estimate';
  assert.equal(validateContract('data', estimate).status, 422);

  const unavailable = unavailableSession(copy(samples.data));
  unavailable.pnlSources.day.detail = 'Synthetic source unavailable';
  assert.equal(validateContract('data', unavailable).ok, true);
  unavailable.pnlSources.day.reason = 'arbitrary producer wording';
  assert.equal(validateContract('data', unavailable).status, 422);
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
