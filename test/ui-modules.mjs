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
const { cellView, cardStatus } = await import('../public/joe/desk.js');
const { createFeed } = await import('../public/joe/feed.js');
const { DATA_PANELS } = await import('../contracts/panel-state.mjs');
const { readdirSync } = await import('node:fs');
const { periodOf, resultsToday } = await import('../public/joe/results.js');
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
  assert.match(cellView(stale.b.states['today.equity'], 'k', { caption: 'after fees' }).caption, /^As of <span class="age" data-age="k">1\smin ago<\/span> · updates are late$/);
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

test('cells: every P1 panel state reaches the screen unchanged, with its own age and reason', () => {
  const ids = readdirSync(new URL('../fixtures/failures/', import.meta.url)).map(f => f.replace(/\.json$/, ''));
  let checked = 0;
  for (const id of ids) {
    const f = fixture(id);
    if (f.feed !== 'data') continue;
    for (const cold of [false, true]) {
      const b = board(f, { cold });
      for (const name of DATA_PANELS.filter(n => /^(today|desks)\.|^paperAccount$/.test(n))) {
        const cell = b.states[name], v = cellView(cell, 'k', { caption: 'designed' });
        assert.equal(v.state, cell.state, `${id}${cold ? ' cold' : ''} ${name}`);
        if (cell.state === 'fresh') assert.equal(v.caption, 'designed');
        else if (cell.state === 'not reported') assert.match(v.caption, /^Not reported/);
        else {
          assert.ok(v.caption.includes(health.cellReason(cell.reason)), `${id} ${name} shows its reason`);
          if (cell.value != null) assert.match(v.caption, /data-age="k"/, `${id} ${name} shows its age`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 400, `${checked} cells`);
  // A feed that has not arrived stays "not reported"; it is never shown as broken.
  const none = panelStates({ data: { value: null, reason: 'feed_not_received' } }, valid.data.receivedAt);
  for (const name of ['today.equity', 'desks.j.dayPnl', 'paperAccount']) {
    assert.deepEqual([none[name].state, cellView(none[name], 'k').state, cellView(none[name], 'k').caption], ['not reported', 'not reported', 'Not reported · no data received yet']);
  }
  assert.match(cardStatus('j', [['Today', none['desks.j.dayPnl']], ['Open positions', none['desks.j.openPnl']], ['Since start', none['desks.j.totalPnl']]]), /Numbers: not reported · no data received yet/);
  // A replayed push keeps the last good values: stale with their age, not broken.
  const first = acceptSnapshot('data', ingress(valid.data), null, valid.data.receivedAt);
  const feeds = { data: first, 'fleet-config': { value: valid['fleet-config'], receivedAt: valid.data.receivedAt } };
  const previous = panelStates(feeds, valid.data.receivedAt);
  const replay = ingress(valid.data); replay.desks[0].action = 'Changed without a new sequence number';
  feeds.data = acceptSnapshot('data', replay, first, at(valid.data.receivedAt, 20));
  const replayed = panelStates(feeds, at(valid.data.receivedAt, 30), previous);
  const eq = replayed['today.equity'];
  assert.deepEqual([eq.state, eq.retained, eq.reason], ['stale', true, 'sequence_replayed']);
  const view = cellView(eq, 'k', { caption: 'designed' });
  assert.equal(view.state, 'stale');
  assert.match(view.caption, /^Last good value, <span class="age" data-age="k">30\ss ago<\/span> · last update repeated an old one$/);
});

test('desk cards: every affected number keeps its own state, age and reason', () => {
  const now = '2026-10-14T17:45:00.000Z';
  const cell = (state, reason, value, receivedAt, retained = value != null && state !== 'fresh') => ({ state, reason, value: value == null ? null : { amount: value, currency: 'EUR' }, retained,
    valueReceivedAt: receivedAt, ageSeconds: receivedAt ? (Date.parse(now) - Date.parse(receivedAt)) / 1000 : null });
  const lines = cardStatus('joe', [
    ['Today', cell('broken', 'day_pnl_unavailable', null, null)],
    ['Open positions', cell('broken', 'gateway_down', '1.5', '2026-10-14T17:43:00.000Z')],
    ['Since 10 Sep', cell('broken', 'gateway_down', '4.5', '2026-10-14T17:40:00.000Z')],
  ]);
  const text = lines.replace(/<[^>]+>/g, '');
  assert.match(text, /Today: unavailable · today’s result not available/);
  assert.match(text, /Open positions: last good, 2\smin ago · broker connection down/);
  assert.match(text, /Since 10 Sep: last good, 5\smin ago · broker connection down/);
  const same = cardStatus('j', [['Today', cell('stale', 'snapshot_stale', '1', '2026-10-14T17:43:30.000Z', false)], ['Open positions', cell('stale', 'snapshot_stale', '1', '2026-10-14T17:43:30.000Z', false)],
    ['Since start', cell('fresh', null, '1', '2026-10-14T17:44:50.000Z')]]);
  assert.match(same.replace(/<[^>]+>/g, ''), /^Today and Open positions: as of 1\smin ago · updates are late$/);
  assert.equal(cardStatus('j', [['Today', cell('fresh', null, '1', now)], ['Open positions', cell('fresh', null, '1', now)], ['Since start', cell('fresh', null, '1', now)]]), '');
});

test('cold start: without the server clock every panel still shows its own state and reason', async () => {
  const realFetch = globalThis.fetch;
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  try {
    for (const [answer, reason] of [[() => json(401, { ok: false, reason: 'auth_required' }), 'auth_required'], [() => json(404, { ok: false, error: 'not found' }), 'route_not_found'],
      [() => json(503, { ok: false }), 'refresh_failed'], [() => { throw new TypeError('offline'); }, 'refresh_failed'], [() => new Response('<html>', { status: 200 }), 'refresh_failed']]) {
      globalThis.fetch = async () => answer();
      const feed = createFeed(() => {});
      await feed.refresh();
      const s = feed.select();
      assert.equal(s.now, null, reason);
      assert.ok(feed.settled());
      for (const name of DATA_PANELS) assert.deepEqual([s.states[name].state, s.states[name].reason, s.states[name].ageSeconds], ['broken', reason, null], `${reason} ${name}`);
      assert.deepEqual([s.states.history.state, s.states.history.reason], ['broken', reason]);
      assert.deepEqual([s.states.results.state, s.states.results.reason], ['broken', 'results_not_wired']);
    }
    // State is unreachable, History answers: History keeps its own value and age at the server's stamp.
    const stamp = at(valid.history.receivedAt, 7);
    globalThis.fetch = async url => (String(url).includes('history.json') ? json(200, valid.history, { 'X-Joe-Server-Now': stamp })
      : String(url).includes('fleet-config') ? json(200, valid['fleet-config'], { 'X-Joe-Server-Now': stamp, 'X-Joe-Received-At': valid.data.receivedAt, ETag: '"1"' })
        : json(404, { ok: false, error: 'not found' }));
    const feed = createFeed(() => {});
    await feed.refresh();
    const s = feed.select();
    assert.ok(Math.abs(Date.parse(s.now) - Date.parse(stamp)) < 1000);
    assert.deepEqual([s.states.history.state, Math.round(s.states.history.ageSeconds)], ['fresh', 7]);
    assert.deepEqual([s.states['today.equity'].state, s.states['today.equity'].reason], ['broken', 'route_not_found']);
    // Only the HTTP date: the clock is known to the second, still the server's.
    globalThis.fetch = async () => json(401, { ok: false, reason: 'auth_required' }, { Date: 'Wed, 14 Oct 2026 17:42:22 GMT' });
    const dated = createFeed(() => {});
    await dated.refresh();
    assert.ok(Math.abs(Date.parse(dated.select().now) - Date.parse('2026-10-14T17:42:22.000Z')) < 1000);
  } finally { globalThis.fetch = realFetch; }
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
  const end = T0 + 10 * 60000;
  const all = hm.rangeWindow(cols, 'all', end);
  assert.equal(hm.latestCompatibleBasis(cols, 'j').start, 1);
  assert.deepEqual(hm.basisNotice(cols, ['j', 'joe'], all, end), ['j']);
  const compare = hm.sharedWindowCompare(cols, ['j', 'joe'], all, end);
  assert.equal(compare.ok, true);
  assert.equal(compare.startAt, iso(1));
  assert.deepEqual(compare.desks.map(d => Number(d.pct.toFixed(2))), [0.2, -0.2]);
  const pair = hm.toColumns([pt(iso(0), { j: 5000 }), pt(iso(1), { j: 5000 })]);
  assert.equal(hm.sharedWindowCompare(pair, ['j', 'joe'], hm.rangeWindow(pair, 'all', T0 + 60000), T0 + 60000).reason, 'incomplete-coverage');
  assert.equal(hm.sharedWindowCompare(cols, ['j'], all, end).reason, 'insufficient-selection');
  // Before the history arrives every desk is still chosen: there is just nothing to compare yet.
  const none = hm.toColumns([]);
  assert.equal(hm.sharedWindowCompare(none, ['j', 'joe', 'joel'], hm.rangeWindow(none, '1w', end), end).reason, 'insufficient-points');
  assert.equal(hm.sharedWindowCompare(none, ['j'], hm.rangeWindow(none, '1w', end), end).reason, 'insufficient-selection');
});

// The chart's points for a desk: the observed values it draws, by time.
const drawn = (cols, id, range, end) => new Map(hm.continuitySeries(cols, id, range, end).observed.filter(p => p.y !== null).map(p => [p.x, p.y]));

test('history: a zoom compares exactly the points the chart draws, never a record it leaves out', () => {
  // J changes its bookkeeping basis at 12:00; Joe never does. Every point is observed.
  const points = [];
  for (let m = 0; m <= 8 * 60; m += 5) {
    const t = Date.parse('2026-10-13T08:00:00.000Z') + m * 60000, before = t < Date.parse('2026-10-13T12:00:00.000Z');
    points.push(pt(new Date(t).toISOString(), { j: before ? 4000 + m / 5 : 5000 + m / 5, joe: 5000 - m / 10 }, { j: before ? 'j.paper.v1' : 'j.paper.v2', joe: 'joe.paper.v2' }));
  }
  const cols = hm.toColumns(points);
  const now = Date.parse('2026-10-13T16:30:00.000Z');
  // Zoomed wholly before J's change: the chart draws no J observation there,
  // so nothing about J is compared and the basis notice names J.
  const early = [Date.parse('2026-10-13T09:00:00.000Z'), Date.parse('2026-10-13T11:00:00.000Z')];
  const inView = ([a, b]) => [...drawn(cols, 'j', '1d', now).keys()].filter(x => x >= a && x <= b);
  assert.equal(inView(early).length, 0, 'the chart plots no J observation before the change');
  const before = hm.sharedWindowCompare(cols, ['j', 'joe'], early, now);
  assert.deepEqual([before.ok, before.reason], [false, 'incompatible-basis'], 'no J number from records the chart left out');
  assert.deepEqual(hm.basisNotice(cols, ['j', 'joe'], early, now), ['j']);
  // The same window without J compares Joe, whose records are all drawn.
  assert.equal(hm.sharedWindowCompare(cols, ['joe', 'joel'], early, now).ok, false, 'Joel has no records');
  // Zoomed across the change: the comparison starts at J's first drawn point
  // and its numbers are the chart's own points at both ends.
  for (const zoom of [[Date.parse('2026-10-13T11:00:00.000Z'), Date.parse('2026-10-13T13:00:00.000Z')], [Date.parse('2026-10-13T13:10:00.000Z'), Date.parse('2026-10-13T15:50:00.000Z')]]) {
    const result = hm.sharedWindowCompare(cols, ['j', 'joe'], zoom, now);
    assert.equal(result.ok, true);
    assert.ok(Date.parse(result.startAt) >= Date.parse('2026-10-13T12:00:00.000Z') && Date.parse(result.startAt) >= zoom[0] && Date.parse(result.endAt) <= zoom[1]);
    for (const d of result.desks) {
      const chart = drawn(cols, d.id, '1d', now);
      assert.deepEqual([d.start, d.end], [chart.get(Date.parse(result.startAt)), chart.get(Date.parse(result.endAt))], `${d.id} compares the chart's points`);
      assert.equal(d.pct, (d.end - d.start) / d.start * 100);
    }
    assert.deepEqual(hm.basisNotice(cols, ['j', 'joe'], zoom, now), zoom[0] < Date.parse('2026-10-13T12:00:00.000Z') ? ['j'] : []);
  }
});

test('history: compare uses exactly the chart window, anchored to the board time, not the last observation', () => {
  // Observations end on 14 Oct; the board's time is 17 Oct.
  const points = [];
  for (let m = 0; m < 3 * 24 * 60; m += 30) points.push(pt(new Date(Date.parse('2026-10-12T00:00:00.000Z') + m * 60000).toISOString(), { j: 5000 + m / 30, joe: 5000 - m / 60, joel: 5000 }));
  const cols = hm.toColumns(points);
  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const day = hm.rangeWindow(cols, '1d', now);
  assert.deepEqual(day, [now - 864e5, now]);
  assert.deepEqual([hm.continuitySeries(cols, 'j', '1d', now).startAt, hm.continuitySeries(cols, 'j', '1d', now).endAt], day, 'chart and compare share the window');
  assert.equal(hm.continuitySeries(cols, 'j', '1d', now).observed.filter(p => p.y !== null).length, 0, 'the Day chart has no observed point');
  assert.deepEqual([hm.sharedWindowCompare(cols, ['j', 'joe'], day, now).ok, hm.sharedWindowCompare(cols, ['j', 'joe'], day, now).reason], [false, 'insufficient-points']);
  const week = hm.rangeWindow(cols, '1w', now);
  const compare = hm.sharedWindowCompare(cols, ['j', 'joe'], week, now);
  assert.equal(compare.ok, true);
  assert.ok(Date.parse(compare.startAt) >= week[0] && Date.parse(compare.endAt) <= week[1]);
  const zoom = [Date.parse('2026-10-13T00:00:00.000Z'), Date.parse('2026-10-13T06:00:00.000Z')];
  const zoomed = hm.sharedWindowCompare(cols, ['j', 'joe'], zoom, now);
  assert.deepEqual([zoomed.startAt, zoomed.endAt], ['2026-10-13T00:00:00.000Z', '2026-10-13T06:00:00.000Z'], 'a zoom narrows the comparison with the chart');
  const chart = drawn(cols, 'j', '1w', now);
  assert.deepEqual([zoomed.desks[0].start, zoomed.desks[0].end], [chart.get(zoom[0]), chart.get(zoom[1])], 'the zoomed numbers are the chart\'s points');
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
  // Before the server's clock is known Results still has a date to label: this browser's.
  assert.equal(resultsToday('2026-10-14T22:30:00.000Z'), '2026-10-15', 'the server clock, as a Vienna date');
  assert.match(resultsToday(null), /^\d{4}-\d{2}-\d{2}$/, 'no clock: no throw, a date to label');
  assert.equal(periodOf('week', resultsToday(null), resultsToday(null)).lab.startsWith('This week · '), true);
});

test('terms: every entry has a plain label, a meaning and the trade term', () => {
  for (const [key, [label, meaning, also]] of Object.entries(TERMS)) {
    assert.ok(label && meaning && also, key);
    assert.doesNotMatch(label, /\b(P&L|IB|HALT|KEEP|NAV|FIFO|Gateway)\b/, key);
  }
});
