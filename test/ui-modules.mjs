// Pure UI modules under Node: health ranking, history continuity, formatting,
// the host gate and desk changes. The browser serves public/joe/time.mjs and
// public/joe/contracts/* from the repo root; this hook mirrors that mapping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';

const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}

const { acceptSnapshot } = await import('../contracts/accept.mjs');
const { panelStates } = await import('../contracts/panel-state.mjs');
const format = await import('../public/joe/format.js');
const { isCanonicalJoeHost } = await import('../public/joe/host.js');
const health = await import('../public/joe/health.js');
const hm = await import('../public/joe/history-model.js');
const { axis } = await import('../public/joe/chart.js');
const { diffDesk, createObservedEvents, learningLine } = await import('../public/joe/events.js');
const { cellView } = await import('../public/joe/desk.js');
const { periodOf } = await import('../public/joe/results.js');
const { TERMS } = await import('../public/joe/terms.js');
const { singleMissingDesk, coupledUnavailable } = await import('../scripts/browser/board.mjs');

const read = file => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
const valid = read('valid.json');
const ingress = value => { const copy = structuredClone(value); delete copy.receivedAt; return copy; };
const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();

// The browser's view of the server: the shared acceptance and selector, with
// the previous accepted cells as retained last-good values.
function board(fixture, { cold = false } = {}) {
  const feeds = { 'fleet-config': { value: structuredClone(valid['fleet-config']), receivedAt: valid.data.receivedAt },
    results: { value: null, reason: 'results_not_wired' }, history: { value: structuredClone(valid.history) } };
  let previous = {};
  if (!cold) {
    feeds.data = acceptSnapshot('data', ingress(valid.data), null, valid.data.receivedAt);
    previous = panelStates(feeds, valid.data.receivedAt);
  }
  if (fixture.transportReason) feeds[fixture.feed] = { ...feeds[fixture.feed], reason: fixture.transportReason };
  else if (fixture.feed === 'data') feeds.data = acceptSnapshot('data', fixture.payload, feeds.data ?? null, fixture.receivedAt);
  if (fixture.fleetConfig) feeds['fleet-config'].value = fixture.fleetConfig;
  return { feeds, states: panelStates(feeds, fixture.now, previous), now: fixture.now };
}
const fixture = id => read(`failures/${id}.json`);
const presentation = (id, opts) => { const b = board(fixture(id), opts); return health.boardHealthPresentation(b.states, b.feeds, b.now); };

test('format: Austrian digits, true minus, joined units, zero without sign', () => {
  assert.equal(format.money(-4.05, 'EUR', true), '−€ 4,05');
  assert.equal(format.money(1234.5, 'USD', true), '+$ 1.234,50');
  assert.equal(format.money(0.004, 'EUR', true), '€ 0,00');
  assert.equal(format.pct(-0.04, 2, true), '−0,04 %');
  assert.equal(format.age(9), '9 s');
  assert.equal(format.age(8280), '2 h 18 min');
  assert.equal(format.age(172800), '2 days');
  assert.equal(format.joinUnits('every 15 s at € 4,10 and 38 %'), 'every 15 s at € 4,10 and 38 %');
  assert.deepEqual(format.sumByCurrency([{ amount: '0.1', currency: 'EUR' }, { amount: '0.2', currency: 'EUR' }, { amount: '441.2', currency: 'USD' }]),
    [{ currency: 'EUR', amount: 0.3 }, { currency: 'USD', amount: 441.2 }]);
  assert.equal(format.dayDDM('2026-10-14T17:42:22.000Z'), 'Wed 14 Oct');
  assert.equal(format.timeHMS('2026-10-14T17:42:22.000Z'), '19:42:22');
  assert.equal(format.timeHM('2026-10-28T13:30:00.000Z'), '14:30');
});

test('host gate: canonical hosts include the production host; others get the privacy stub', () => {
  for (const host of ['hsb1.lan', 'hsb1', 'localhost', '127.0.0.1', '::1', 'HSB1.LAN', '[::1]', '100.64.0.7', '100.64.0.0',
    '100.127.255.255', 'hsb1.tail1234.ts.net', 'foo.hsb1.ts.net', 'hsb1.ts.net', 'cs0.barta.cm', 'cs0', 'CS0.BARTA.CM']) assert.ok(isCanonicalJoeHost(host), host);
  for (const host of ['example.com', '8.8.8.8', '100.63.255.255', '100.128.0.1', '100.64.0.256', '100.64.0.07', '192.168.1.10',
    '10.0.0.1', 'example.ts.net', 'hsb1.example.com', 'cs0.barta.com']) assert.ok(!isCanonicalJoeHost(host), host);
});

test('health: every P1 fixture lands on today’s light, label and plain reason', () => {
  const expect = {
    'e-layout-storage-unavailable': ['green', 'board_ok', 'Board OK'],
    'b-session-open-estimate': ['green', 'board_ok', 'Board OK'],
    'missing-runtime-and-results': ['green', 'board_ok', 'Board OK'],
    'stale-receive-age': ['yellow', 'snapshot_stale', 'Stale 1 min'],
    'c-frozen-producer': ['yellow', 'snapshot_stale', 'Stale 2 min'],
    'a-missing-gateway': ['red', 'equity_unavailable', 'Needs fix'],
    'a-frozen-ready-gateway': ['red', 'equity_unavailable', 'Needs fix'],
    'b-incomplete-family': ['yellow', 'retained_values', 'Data delayed'],
    'b-equity-null-gateway-ready': ['yellow', 'retained_values', 'Data delayed'],
    'h-keep-policy-mismatch': ['yellow', 'retained_values', 'Data delayed'],
    'b-weekend-no-sod': ['yellow', 'day_pending', 'Data delayed'],
    'j-ny-midnight-gap': ['yellow', 'day_pending', 'Data delayed'],
    'a-gateway-up-but-dead': ['red', 'gateway_down', 'Needs fix'],
    'c-old-producer-image': ['red', 'feed_disconnected', 'Needs fix'],
    'unknown-schema': ['red', 'feed_disconnected', 'Needs fix'],
    'g-expired-sso': ['red', 'feed_disconnected', 'Needs fix'],
    'd-routing-stub': ['red', 'feed_disconnected', 'Needs fix'],
  };
  for (const [id, [tone, reason, label]] of Object.entries(expect)) {
    const p = presentation(id);
    assert.deepEqual([p.tone, p.reason, p.label], [tone, reason, label], id);
    assert.equal(p.explanation, health.REASON_COPY[reason]);
  }
});

test('health: one null keeps a yellow grace, a cold load or old carry is red, HALT and no data are red', () => {
  assert.equal(presentation('b-incomplete-family', { cold: true }).reason, 'equity_unavailable');
  const late = { ...fixture('b-incomplete-family'), now: at(fixture('b-incomplete-family').receivedAt, 40) };
  assert.equal(presentation('b-incomplete-family').tone, 'yellow');
  const b = board(late);
  assert.equal(b.states['today.equity'].retained, true);
  const halted = ingress(valid.data);
  halted.seq = 102; halted.generatedAt = at(valid.data.receivedAt, 30); halted.safety.gateway.checkedAt = halted.generatedAt;
  halted.safety.halt = true; halted.safety.haltReason = 'halt_on';
  const h = board({ feed: 'data', payload: halted, receivedAt: halted.generatedAt, now: at(halted.generatedAt, 2) });
  assert.equal(health.boardHealthPresentation(h.states, h.feeds, h.now).reason, 'halt_on');
  const none = health.boardHealthPresentation({}, { data: { value: null, reason: 'feed_not_received' } }, valid.data.receivedAt);
  assert.deepEqual([none.tone, none.reason, none.label], ['red', 'no_snapshot', 'Needs fix']);
  assert.match(health.boardDiagnostics(h.states, h.feeds, h.now).join(' '), /emergency stop is on/);
});

test('health: the 20-second-old check reads fresh, then broken, then stale (P3 copy sign-off)', () => {
  const payload = ingress(valid.data);
  payload.seq = 102; payload.generatedAt = at(valid.data.receivedAt, 30); payload.safety.gateway.checkedAt = at(payload.generatedAt, -20);
  const base = { feed: 'data', payload, receivedAt: payload.generatedAt };
  const view = seconds => { const b = board({ ...base, now: at(payload.generatedAt, seconds) }); return { b, p: health.boardHealthPresentation(b.states, b.feeds, b.now) }; };
  const fresh = view(39);
  assert.equal(fresh.b.states['today.equity'].state, 'fresh');
  assert.equal(fresh.p.reason, 'board_ok');
  const broken = view(45);
  assert.deepEqual([broken.b.states['today.equity'].state, broken.b.states['today.equity'].reason], ['broken', 'gateway_unconfirmed']);
  assert.deepEqual([broken.p.label, broken.p.reason], ['Broker unsure', 'gateway_unconfirmed']);
  assert.match(cellView(broken.b.states['today.equity'], 'k').caption, /^Last good value, .* · broker connection not confirmed$/);
  const stale = view(61);
  assert.equal(stale.b.states['today.equity'].state, 'stale');
  assert.deepEqual([stale.p.label, stale.p.reason], ['Stale 1 min', 'snapshot_stale']);
  assert.match(cellView(stale.b.states['today.equity'], 'k', { caption: 'after fees' }).caption, /^after fees · as of .*1 min ago/);
});

test('isolation: a single missing desk keeps its siblings fresh with their own ages; the light stays yellow', () => {
  const b = board(singleMissingDesk());
  assert.equal(b.feeds.data.status, 200);
  assert.deepEqual([b.states['desks.j.equity'].state, b.states['desks.j.equity'].retained], ['broken', true]);
  assert.deepEqual([b.states['today.equity'].state, b.states['today.equity'].reason], ['broken', 'family_projection_unavailable']);
  for (const id of ['joe', 'joel']) assert.deepEqual([b.states[`desks.${id}.equity`].state, b.states[`desks.${id}.equity`].ageSeconds], ['fresh', 9]);
  assert.equal(b.states['desks.j.totalPnl'].state, 'fresh');
  const p = health.boardHealthPresentation(b.states, b.feeds, b.now);
  assert.deepEqual([p.tone, p.reason], ['yellow', 'retained_values']);
  const cold = board(singleMissingDesk(), { cold: true });
  assert.equal(health.boardHealthPresentation(cold.states, cold.feeds, cold.now).reason, 'equity_unavailable');
  assert.equal(cellView(cold.states['desks.joe.equity'], 'k').state, 'fresh');
});

test('isolation: equity and total result unavailable together never show a fresh result', () => {
  const b = board(coupledUnavailable());
  assert.equal(b.feeds.data.status, 200);
  for (const name of ['today.equity', 'today.totalPnl', 'desks.j.equity', 'desks.j.totalPnl', 'desks.joel.totalPnl']) {
    assert.deepEqual([b.states[name].state, b.states[name].reason, b.states[name].retained], ['broken', 'all_desk_equity_unavailable', true], name);
  }
  assert.equal(b.states['today.dayPnl'].state, 'fresh');
  assert.match(cellView(b.states['today.totalPnl'], 'k').caption, /^Last good value, .* · desks’ money not available$/);
  assert.equal(health.boardHealthPresentation(b.states, b.feeds, b.now).reason, 'retained_values');
});

test('cells: fresh, stale with age, not reported and broken with reason all read plainly', () => {
  assert.equal(cellView({ state: 'fresh', value: { amount: '4.75', currency: 'EUR' }, reason: null }, 'k', { caption: 'after fees' }).caption, 'after fees');
  assert.equal(cellView({ state: 'not reported', value: null, reason: null }, 'k').caption, 'Not reported');
  assert.equal(cellView({ state: 'broken', value: null, reason: 'upstream_lost' }, 'k').caption, 'Unavailable · broker connection down');
  assert.equal(cellView(undefined, 'k').html, '<span class="bn muted">—</span>');
  for (const reason of JSON.parse(readFileSync(new URL('../contracts/reason.schema.json', import.meta.url))).enum) {
    assert.ok(health.CELL_REASON[reason], `closed reason ${reason} has plain copy`);
    assert.doesNotMatch(health.CELL_REASON[reason], /\b(IB|HALT|Gateway|P&L|NAV|KEEP|FIFO|FX|Snapshot)\b/);
  }
});

test('KEEP: kept symbols leave the desk positions; a policy mismatch withholds desk money', () => {
  const fresh = board(fixture('e-layout-storage-unavailable'));
  assert.deepEqual(fresh.states.positions.value.map(r => r.symbol), ['DEMO']);
  assert.deepEqual(fresh.states.kept.value.map(r => r.symbol), ['SXR8', 'TSLA']);
  const mismatch = board(fixture('h-keep-policy-mismatch'));
  assert.equal(mismatch.states['desks.j.equity'].reason, 'source_not_authoritative');
  assert.ok(!mismatch.states.positions.value?.some(r => mismatch.feeds['fleet-config'].value.desks.keep.includes(r.symbol)));
});

const pt = (t, values, basis = {}) => ({ t, desks: Object.fromEntries(hm.DESK_IDS.map(id => [id, {
  money: values[id] === undefined ? {} : { equity: values[id] === null ? null : { amount: String(values[id]), currency: 'EUR' } },
  ...(basis[id] ? { historyBasis: basis[id] } : {}) }])), totals: {} });
const T0 = Date.parse('2026-10-14T10:00:00.000Z');
const iso = minutes => new Date(T0 + minutes * 60000).toISOString();

test('history: empty, leading, internal and trailing gaps are dotted; solid is observed only', () => {
  const end = T0 + 600 * 60000;
  const empty = hm.continuitySeries(hm.toColumns([]), 'j', '1d', end);
  assert.deepEqual(empty.observed, []);
  assert.deepEqual(empty.gaps[0].map(p => [p.y, p.assumption]), [[5000, 'no-history-baseline'], [5000, 'no-history-baseline']]);
  const points = [pt(iso(60), { j: 5001 }), pt(iso(61), { j: 5002 }), pt(iso(62), { j: null }), pt(iso(63), { j: 5003 }), pt(iso(200), { j: 4990 })];
  const s = hm.continuitySeries(hm.toColumns(points), 'j', '1d', end);
  assert.equal(s.gaps[0][0].assumption, 'assumed-baseline');
  assert.equal(s.gaps[0][0].y, 5000, 'leading estimate starts from the assumed € 5.000');
  assert.ok(s.gaps.some(g => g[0].x === Date.parse(iso(61)) && g.at(-1).x === Date.parse(iso(63))), 'explicit null becomes an interpolated gap');
  assert.ok(s.gaps.some(g => g[0].x === Date.parse(iso(63)) && g.at(-1).x === Date.parse(iso(200))), 'a span over five minutes is an estimate');
  assert.deepEqual(s.gaps.at(-1).map(p => [p.y, p.assumption]), [[4990, 'last-value-carry'], [4990, 'last-value-carry']]);
  assert.ok(s.observed.every(p => p.y === null || [5001, 5002, 5003, 4990].includes(p.y)), 'observed carries no estimate');
  const outage = hm.continuitySeries(hm.toColumns([pt(iso(0), { j: 5000 }), pt(iso(10), { j: 5001 })]), 'j', '1d', T0 + 3 * 864e5);
  assert.deepEqual(outage.observed, []);
  assert.ok(outage.gaps.length && outage.gaps.every(g => g.every(p => p.y === 5001)), 'a range wholly inside an outage holds the last value dotted');
});

test('history: basis breaks exclude older records and compare stays on observed, compatible points', () => {
  const points = [pt(iso(0), { j: 4000, joe: 5000 }, { j: 'j.old' }), pt(iso(1), { j: 5000, joe: 5000 }, { j: 'j.paper.v2' }),
    pt(iso(2), { j: 5010, joe: 4990 }, { j: 'j.paper.v2' })];
  const cols = hm.toColumns(points);
  assert.equal(hm.latestCompatibleBasis(cols, 'j').start, 1);
  assert.deepEqual(hm.basisNotice(cols, ['j', 'joe'], 'all'), ['j']);
  const compare = hm.sharedWindowCompare(cols, ['j', 'joe'], 'all');
  assert.equal(compare.ok, true);
  assert.equal(compare.startAt, iso(1));
  assert.deepEqual(compare.desks.map(d => Number(d.pct.toFixed(2))), [0.2, -0.2]);
  assert.equal(hm.sharedWindowCompare(hm.toColumns([pt(iso(0), { j: 5000 }), pt(iso(1), { j: 5000 })]), ['j', 'joe'], 'all').reason, 'incomplete-coverage');
  assert.equal(hm.sharedWindowCompare(cols, ['j'], 'all').reason, 'insufficient-selection');
});

test('history: the real gap fixture keeps observed siblings and a null J gap', () => {
  const gap = read('failures/f-history-gap.json').payload;
  const end = Date.parse(gap.points.at(-1).t) + 1000;
  const cols = hm.toColumns(gap.points);
  const j = hm.continuitySeries(cols, 'j', 'all', end);
  const joe = hm.continuitySeries(cols, 'joe', 'all', end);
  assert.ok(j.observed.some(p => p.y === null));
  assert.ok(joe.observed.filter(p => p.y !== null).length >= j.observed.filter(p => p.y !== null).length);
});

test('history: session closes keep the last observed value per New York session, skipping weekends', () => {
  const points = [];
  for (const [day, hours] of [['2026-10-09', [14, 19]], ['2026-10-10', [15]], ['2026-10-12', [14, 18, 23]], ['2026-10-13', [3, 15]]]) {
    for (const h of hours) points.push({ t: `${day}T${String(h).padStart(2, '0')}:00:00.000Z`, desks: { j: { money: { totalPnl: { amount: String(h), currency: 'EUR' } } } }, totals: {} });
  }
  const closes = hm.sessionCloses(hm.toColumns(points), 'j', 'totalPnl', 9);
  assert.deepEqual(closes.map(c => [c.day, c.v]), [['2026-10-09', 19], ['2026-10-12', 3], ['2026-10-13', 15]], 'a 03:00 UTC point still belongs to the previous New York day');
  assert.deepEqual(hm.intraday(hm.toColumns(valid.history.points), 'dayPnl', '2026-10-14T13:30:00.000Z', '2026-10-14T20:00:00.000Z').map(p => p.v), [0, -1]);
});

test('charts: money axes span at least 1 % of their base; result axes include zero', () => {
  for (const [lo, hi, base] of [[4998, 5003, 5000], [14990, 15004, 15000], [4000, 6000, 5000], [5000, 5000, 5000]]) {
    const a = axis(lo, hi, 5, base);
    assert.ok(a.hi - a.lo >= base * 0.01 - 1e-9, `${lo}-${hi}`);
    assert.ok(a.lo <= lo && a.hi >= hi);
  }
  for (const [lo, hi] of [[1, 5], [-4, -1], [-2, 3]]) { const a = axis(lo, hi, 3, 0, true); assert.ok(a.lo <= 0 && a.hi >= 0); }
});

test('desk changes: state, action, learning and issues; the first snapshot is the baseline', () => {
  const desk = { id: 'j', state: 'working', action: 'Holding', learning: { status: 'iterating', headline: 'Smaller first position', detail: 'Half size', iteration: 18 } };
  const fields = { state: 'sit-out', action: 'Watching', learning: '', issues: '' };
  const events = diffDesk(fields, desk, '2026-10-14T17:42:22.000Z', 'paper');
  assert.deepEqual(events.map(e => e.kind), ['state', 'learning']);
  assert.equal(events[0].summary, 'Now working: Holding');
  assert.equal(learningLine(desk.learning), 'Smaller first position · Half size · round 18');
  const store = new Map();
  const memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const observed = createObservedEvents(memory);
  observed.observe({ generatedAt: '2026-10-14T17:42:22.000Z', source: { label: 'paper' }, desks: [desk] });
  assert.equal(observed.recent().length, 0);
  observed.observe({ generatedAt: '2026-10-14T17:42:52.000Z', source: { label: 'paper' }, desks: [{ ...desk, action: 'Sold' }] });
  assert.deepEqual(observed.recent().map(e => e.summary), ['Sold']);
  const throwing = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } };
  assert.doesNotThrow(() => createObservedEvents(throwing).observe({ generatedAt: '2026-10-14T17:42:22.000Z', desks: [desk] }));
});

test('results: period labels use plain words; no YTD or week-number shorthand', () => {
  const today = '2026-10-14';
  assert.equal(periodOf('week', today, today).lab, 'This week · 12–18 Oct');
  assert.equal(periodOf('ytd', today, today).lab, 'This year · since 1 Jan');
  assert.equal(periodOf('day', '2026-10-13', today).lab, 'Yesterday · Tue 13 Oct');
  assert.equal(periodOf('month', '2026-09-30', today).lab, 'Last month · September');
});

test('terms: every entry has a plain label, a meaning and the trade term', () => {
  for (const [key, [label, meaning, also]] of Object.entries(TERMS)) {
    assert.ok(label && meaning && also, key);
    assert.doesNotMatch(label, /\b(P&L|IB|HALT|KEEP|NAV|FIFO|Gateway)\b/, key);
  }
});
