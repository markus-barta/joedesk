// JOED-149: synthetic proof only; no broker rates are exposed by Details.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { acceptRead } from '../contracts/read.mjs';
import { htmlDocument } from './fixtures/preview-dom.mjs';
import { nyDay, viennaDay, zonedInstant, NY } from '../time.mjs';
const { boardStates, classifyDays } = await import('../public/joe/board-state.js');
const { boardHealthPresentation } = await import('../public/joe/health.js');
const { healthPop, heroLeft, compactDesk } = await import('../public/joe/desk.js');
const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url)));
const { exact, mixed } = read('fixtures/phase-b.json');
const fixture = read('fixtures/day-fx.json');
const copy = v => structuredClone(v);
const withFx = () => {
  const data = copy(exact);
  data.desks[0].pnlSources.day.fx = copy(fixture.fx);
  return data;
};
const ingress = data => { const v = copy(data); delete v.receivedAt; return v; };
const context = data => {
  const feeds = { data: { value: data } }, now = data.receivedAt;
  return { feeds, now, states: boardStates(feeds, now) };
};
const details = ctx => htmlDocument(healthPop(ctx, boardHealthPresentation(ctx.states, ctx.feeds, ctx.now)));

test('rev 11: legacy rev 10 exact and mixed payloads and no-fx snapshots keep their board behaviour', () => {
  assert.equal(CONTRACTS.revision, 11);
  for (const data of [exact, mixed]) {
    assert.equal(validateContract('data', data).ok, true);
    const accepted = acceptRead('data', { status: 200, payload: data });
    assert.strictEqual(accepted.value, data);
    assert.equal(accepted.reason, null);
    const ctx = context(data), classes = classifyDays(ctx.states, data);
    assert.equal(classes.j.kind, data === exact ? 'exact' : 'notExact');
    assert.equal(classes.joel.kind, 'exact');
    assert.doesNotMatch(details(ctx).textContent, /Today conversion|converted at/);
  }
});

test('rev 11: the two proven observations survive producer/server/browser validation; money and exactness stay unchanged', () => {
  const data = withFx(), result = acceptSnapshot('data', ingress(data), null, data.receivedAt);
  assert.equal(result.status, 200, JSON.stringify(result.errors));
  assert.deepEqual(result.value, data);
  const feed = acceptRead('data', { status: 200, payload: result.value });
  assert.equal(feed.reason, null);
  const before = context(exact), after = context(feed.value);
  assert.deepEqual(classifyDays(after.states, data), classifyDays(before.states, exact));
  assert.equal(heroLeft(after), heroLeft(before));
  for (const id of ['j', 'joe', 'joel']) assert.equal(compactDesk(after, id), compactDesk(before, id));
  const doc = details(after);
  assert.match(doc.textContent, /J Today conversion/);
  assert.match(doc.textContent, /converted at the start-of-day rate from 05:59 and the current rate from 19:42/);
  assert.doesNotMatch(doc.textContent, /ib-account-ExchangeRate|0\.9|rate value/);
  assert.deepEqual(data.desks.map(d => d.money), exact.desks.map(d => d.money));
});

for (const bad of fixture.invalid) test(`rev 11 rejects ${bad.name} with a field-specific reason`, () => {
  const data = withFx();
  const keys = bad.path.split('.'), key = keys.pop();
  const parent = keys.reduce((v, k) => v[k], data.desks[0].pnlSources.day);
  if (bad.remove) delete parent[key]; else parent[key] = bad.value;
  for (const stage of ['served', 'ingress']) {
    const result = validateContract('data', stage === 'served' ? data : ingress(data), { stage });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'contract_invalid');
    assert.ok(result.errors.some(e => e.path === bad.errorPath && e.rule === bad.rule), JSON.stringify(result.errors));
  }
});

test('rev 11: fx is desk DAY-only; aggregate, OPEN and money proof shapes cannot be confused', () => {
  for (const place of ['aggregate', 'open', 'money']) {
    const data = copy(exact);
    if (place === 'aggregate') data.pnlSources.day.fx = copy(fixture.fx);
    if (place === 'open') data.desks[0].pnlSources.open.fx = copy(fixture.fx);
    if (place === 'money') data.desks[0].money.dayPnl.fx = copy(fixture.fx);
    const result = validateContract('data', data);
    assert.equal(result.reason, 'contract_invalid', place);
    assert.ok(result.errors.some(e => e.rule === (place === 'money' ? 'anyOf' : 'additionalProperties')), place);
  }
});

test('rev 11: inclusive ordering allows a boundary observation and identical start/end instants', () => {
  const data = withFx(), day = data.desks[0].pnlSources.day;
  day.fx.start.observedAt = day.fx.end.observedAt = day.periodStart;
  assert.equal(validateContract('data', data).ok, true);
});

test('rev 11: each exact desk keeps its own conversion clocks beside an inexact sibling', () => {
  const data = copy(mixed);
  data.desks[0] = copy(exact.desks[0]);
  data.desks[0].pnlSources.day.fx = copy(fixture.fx);
  data.desks[2].pnlSources.day.fx = copy(fixture.fx);
  data.desks[2].pnlSources.day.fx.end.observedAt = '2026-10-14T17:41:00.000Z';
  assert.equal(validateContract('data', data).ok, true);
  const ctx = context(data), doc = details(ctx);
  assert.equal(classifyDays(ctx.states, data).joe.kind, 'notExact');
  assert.match(doc.textContent, /J Today conversionconverted at the start-of-day rate from 05:59 and the current rate from 19:42/);
  assert.match(doc.textContent, /Joel Today conversionconverted at the start-of-day rate from 05:59 and the current rate from 19:41/);
  assert.doesNotMatch(doc.textContent, /Joe Today conversion/);
});

test('rev 11: an invalid pair retains last good values with an honest rejection; it never supplies conversion text', () => {
  const before = acceptRead('data', { status: 200, payload: exact });
  const bad = withFx(); bad.desks[0].pnlSources.day.fx.end.source = 'unproven';
  const after = acceptRead('data', { status: 200, payload: bad }, before);
  assert.strictEqual(after.value, exact);
  assert.equal(after.reason, 'contract_invalid');
  const ctx = context(exact); ctx.feeds.data = after; ctx.states = boardStates(ctx.feeds, ctx.now);
  assert.notEqual(classifyDays(ctx.states, exact).j.kind, 'exact');
  assert.doesNotMatch(details(ctx).textContent, /converted at/);
  assert.match(details(ctx).textContent, /last update was rejected/);
});

// NY midnight moves independently of Vienna's date and DST. Both autumn
// fallbacks and the spring gap use explicit UTC observations, never host TZ.
const vectors = [
  ['2026-10-24T22:30:00.000Z', '2026-10-24T04:00:00.000Z', '2026-10-24', '2026-10-25', '06:00', '00:30'],
  ['2026-10-25T01:30:00.000Z', '2026-10-24T04:00:00.000Z', '2026-10-24', '2026-10-25', '06:00', '02:30'],
  ['2026-10-25T04:00:00.000Z', '2026-10-25T04:00:00.000Z', '2026-10-25', '2026-10-25', '04:59', '04:59'],
  ['2026-11-01T06:30:00.000Z', '2026-11-01T04:00:00.000Z', '2026-11-01', '2026-11-01', '05:00', '07:30'],
  ['2026-11-02T05:00:00.000Z', '2026-11-02T05:00:00.000Z', '2026-11-02', '2026-11-02', '05:59', '05:59'],
  ['2026-03-29T01:30:00.000Z', '2026-03-28T04:00:00.000Z', '2026-03-28', '2026-03-29', '05:00', '03:30'],
];
for (const [at, period, ny, vienna, startHM, endHM] of vectors) test(`rev 11 Vienna conversion clocks at ${at}`, () => {
  assert.equal(nyDay(at), ny); assert.equal(viennaDay(at), vienna);
  assert.equal(zonedInstant(ny, '00:00:00', NY), period);
  const data = withFx();
  data.generatedAt = data.receivedAt = data.safety.gateway.checkedAt = at;
  for (const desk of data.desks) desk.pnlSources.day.observedAt = at;
  const source = data.desks[0].pnlSources.day;
  source.observedAt = at; source.periodStart = period;
  // Midnight's exact SOD observation may predate the boundary slightly.
  const boundary = at === period;
  source.fx.start.observedAt = boundary ? new Date(Date.parse(period) - 1000).toISOString() : period;
  source.fx.end.observedAt = boundary ? source.fx.start.observedAt : at;
  assert.equal(validateContract('data', data).ok, true);
  assert.match(details(context(data)).textContent, new RegExp(`converted at the start-of-day rate from ${startHM} and the current rate from ${endHM}`));
});

test('rev 11: a valid pair cannot override a desk exactness reason', () => {
  const data = withFx();
  data.desks[0].money.reasons = { dayPnl: 'not_exact_yet' };
  assert.equal(validateContract('data', data).ok, true);
  const ctx = context(data);
  assert.equal(classifyDays(ctx.states, data).j.kind, 'notExact');
  assert.doesNotMatch(details(ctx).textContent, /converted at/);
});

test('rev 11: release participant requirements name the complete current contract set', () => {
  const release = read('release/contracts.json'), closure = read('release/closure.json');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  // Preserve the established rev-10 digest convention and ordering without
  // resealing the release closure; that belongs to the later release.
  assert.deepEqual(readdirSync(new URL('../contracts/', import.meta.url)).sort(),
    closure.files.filter(f => f.path.startsWith('contracts/')).map(f => f.path.slice('contracts/'.length)).sort());
  const entries = closure.files.filter(f => f.path.startsWith('contracts/')).map(f => {
    const bytes = readFileSync(new URL(`../${f.path}`, import.meta.url));
    return { path: f.path, size: bytes.length, sha256: sha(bytes) };
  });
  assert.equal(release.manifest_revision, 11);
  assert.equal(release.contract_set_sha256, sha(Buffer.from(JSON.stringify(entries))));
  for (const participant of ['pusher', 'executor', 'producer']) {
    assert.equal(release.participants[participant].required_contract_set_sha256, release.contract_set_sha256);
  }
});
