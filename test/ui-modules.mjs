// Pure UI modules under Node: health ranking, history continuity, formatting,
// the host gate and desk changes. The browser serves public/joe/time.mjs and
// public/joe/contracts/* from the repo root; this hook mirrors that mapping.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { observeBudgetTasks, attributeBudgetTasks } from '../scripts/browser/budget-tasks.mjs';
import { CI_GUARD, REFERENCE_BUDGET, TIMING_GUARDS, decideTaskGuard, runBudget, budgetTable } from '../scripts/browser/budget.mjs';
import { createGate } from '../scripts/browser/gate.mjs';
import { captureHeaderCrop } from '../scripts/browser/header-crop.mjs';
import './browser-settled.mjs';

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
const { isRTH } = await import('../time.mjs');
const format = await import('../public/joe/format.js');
const { cashCaption, stateCaption, reservedCaption, statePhrase, st } = await import('../public/joe/ui.js');
const { isCanonicalJoeHost } = await import('../public/joe/host.js');
const health = await import('../public/joe/health.js');
const hm = await import('../public/joe/history-model.js');
const { axis } = await import('../public/joe/chart.js');
const { diffDesk, createObservedEvents, learningLine } = await import('../public/joe/events.js');
const { cellView, cardStatus, headerHealth, executorProblem, heroLeft, keptHtml, positionsHtml } = await import('../public/joe/desk.js');
const { createFeed } = await import('../public/joe/feed.js');
const { DATA_PANELS } = await import('../contracts/panel-state.mjs');
const { readdirSync } = await import('node:fs');
const { periodOf, resultsToday } = await import('../public/joe/results.js');
const { TERMS } = await import('../public/joe/terms.js');
const { singleMissingDesk, coupledUnavailable } = await import('../scripts/browser/board.mjs');
const { switchSetSnapshot } = await import('../scripts/browser/settings-fixtures.mjs');

const read = file => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
const valid = read('valid.json');
const ingress = value => { const copy = structuredClone(value); delete copy.receivedAt; return copy; };
const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();

// The browser's view of the server: the shared acceptance and selector, with
// the previous accepted cells as retained last-good values.
function board(fixture, { cold = false } = {}) {
  const feeds = { 'fleet-config': { value: structuredClone(valid['fleet-config']), receivedAt: valid.data.receivedAt },
    results: { value: null, reason: 'feed_not_received' }, history: { value: structuredClone(valid.history) } };
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
  assert.equal(format.joinUnits('Paper · fixed', { joinDot: true }), 'Paper · fixed');
  assert.equal(format.joinUnits(' · checked', { joinDot: true }), ' · checked');
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

test('cash formatting: exact broker lexemes display at two decimals without a floating-point round trip', () => {
  for (const [amount, text] of [['12345.67890123', '€ 12.345,68'], ['1.00500000', '€ 1,01'],
    ['-1.00500000', '−€ 1,01'], ['0.00000001', '€ 0,00'], ['-0.00000001', '€ 0,00'],
    ['9007199254740993.00500000', '€ 9.007.199.254.740.993,01'], ['12345.67000000', '€ 12.345,67']]) {
    const value = { amount, currency: 'EUR' };
    assert.deepEqual(format.cashAmount(value), { text, title: `Cash: EUR ${amount}` });
    assert.equal(value.amount, amount);
    for (const key of ['hero.cash', 'rt.cash']) {
      const html = cashCaption({ state: 'fresh', value }, key);
      assert.ok(html.includes(`title="Cash: EUR ${amount}" aria-label="Cash: EUR ${amount}"`));
      assert.ok(html.includes(`>${text}</span>`));
    }
  }
});

test('cash captions: null, omitted and broken retained values always explain why', () => {
  for (const key of ['hero.cash', 'rt.cash']) {
    const nullHtml = cashCaption({ state: 'broken', value: null, reason: 'gateway_unconfirmed' }, key);
    assert.match(nullHtml, />not reported · broker connection not confirmed<\/span>/);
    assert.match(nullHtml, /title="Cash not reported · broker connection not confirmed" aria-label="Cash not reported · broker connection not confirmed"/);
    const held = cashCaption({ state: 'broken', value: { amount: '12345.67890123', currency: 'EUR' },
      retained: true, reason: 'gateway_unconfirmed' }, key);
    assert.equal(held, nullHtml);
    assert.match(cashCaption(null, key), />not reported · no data received yet<\/span>/);
  }
});

test('cash captions: stale values keep exact accessibility and their own reason with the same reserve', () => {
  const value = { amount: '12345.67890123', currency: 'EUR' };
  const reserve = html => html.slice(html.indexOf('<span class="cash-sizing"'));
  const fresh = cashCaption({ state: 'fresh', value }, 'hero.cash');
  const stale = cashCaption({ state: 'stale', value, reason: 'snapshot_stale' }, 'hero.cash');
  const absent = cashCaption({ state: 'broken', value: null, reason: 'source_unavailable' }, 'hero.cash');
  assert.match(stale, />€ 12\.345,68 · updates are late<\/span>/);
  assert.match(stale, /aria-label="Cash: EUR 12345\.67890123 · updates are late"/);
  assert.equal(reserve(stale), reserve(fresh));
  assert.equal(reserve(absent), reserve(fresh));
});

test('cash captions: Amy’s label and caption stay fixed; every null and stale reason reserves its own words', () => {
  for (const [reason, why] of Object.entries(health.CELL_REASON)) {
    for (const key of ['hero.cash', 'rt.cash']) {
      const html = cashCaption({ state: 'broken', value: null, reason }, key);
      assert.ok(html.includes('<span class="cash-label">Cash</span><span class="cash-caption">cash · as the broker reports it</span>'));
      assert.ok(html.includes(`<span class="cash-sizing" aria-hidden="true">${format.esc(`not reported · ${why}`)}</span>`), reason);
      assert.ok(html.includes(`<span class="cash-sizing" aria-hidden="true">${format.esc(`−€ 999.999,99 · ${why}`)}</span>`), reason);
    }
  }
});

test('hero captions: every reason reserves retained, stale, broken and null wording with real ages', () => {
  const sizing = html => [...html.matchAll(/<span class="cash-sizing" aria-hidden="true">([^<]*)<\/span>/g)].map(m => m[1]);
  const html = reservedCaption('after fees', ['after fees']);
  const phrases = sizing(html);
  assert.ok(phrases.includes('after fees'));
  assert.ok(phrases.includes('Not reported'));
  assert.ok(phrases.includes('Unavailable · not available'));
  for (const why of new Set(Object.values(health.CELL_REASON))) {
    const escaped = format.esc(why), capital = health.capital(escaped);
    assert.ok(phrases.includes(`Unavailable · ${escaped}`), why);
    assert.ok(phrases.includes(`Not reported · ${escaped}`), why);
    for (const ago of ['999 days ago', '23 h 59 min ago', 'age unknown']) {
      assert.ok(phrases.includes(`Last good value, ${ago} · ${escaped}`), why);
      assert.ok(phrases.includes(`As of ${ago} · ${escaped}`), why);
      assert.ok(phrases.includes(`${capital} · as of ${ago}`), why);
    }
  }
  for (const ago of ['999 days ago', '23 h 59 min ago', 'age unknown']) {
    assert.ok(phrases.includes(`Last good value, ${ago}`));
    assert.ok(phrases.includes(`As of ${ago}`));
    assert.ok(phrases.includes(`Not available · as of ${ago}`));
  }
  assert.equal(phrases.length, new Set(phrases).size);
  assert.ok(phrases.every(text => !text.includes('data-age')));
  const visible = stateCaption({ state: 'broken', value: {}, retained: true, reason: 'gateway_unconfirmed', ageSeconds: 90 }, 'hero.open');
  assert.match(reservedCaption(visible, ['after fees']), /<span class="account-caption"><span>Last good value, <span class="age" data-age="hero.open">1 min ago<\/span> · broker connection not confirmed<\/span>/);
  assert.deepEqual(sizing(reservedCaption(visible, ['after fees'])), phrases, 'reserve stays identical across states');
});

test('hero captions: three supporting KPIs keep the same reserve through session loss and incomplete bookkeeping', () => {
  const fresh = { feeds: { data: { value: valid.data } }, states: panelStates({ data: { value: valid.data } }, valid.data.receivedAt), now: valid.data.receivedAt };
  const session = board(fixture('a-gateway-up-but-dead'));
  const incomplete = structuredClone(fresh);
  incomplete.states['desks.j.equity'].value = null;
  const kpis = ctx => [...heroLeft(ctx).matchAll(/<div class="kpi"[\s\S]*?<\/div>/g)].map(m => m[0]);
  const reserve = html => [...html.matchAll(/<span class="cash-sizing" aria-hidden="true">([^<]*)<\/span>/g)].map(m => m[1]);
  const baseline = kpis(fresh);
  assert.equal(baseline.length, 3);
  for (const ctx of [fresh, session, incomplete]) {
    const actual = kpis(ctx);
    assert.equal(actual.length, 3);
    actual.forEach((html, i) => {
      assert.match(html, /<span class="c"><span class="account-caption">/);
      assert.deepEqual(reserve(html), reserve(baseline[i]));
      assert.ok(reserve(html).includes('Last good value, 999 days ago · broker connection not confirmed'));
    });
  }
  assert.ok(reserve(baseline[1]).includes('started with € 15.000'));
  assert.ok(reserve(baseline[1]).includes('J’s bookkeeping incomplete · desk total unavailable'));
});

test('position rows: omitted optional P&L stays a plain dash without a reason or title', () => {
  for (const data of [valid.data, read('positions-null.json')]) {
    const ctx = { states: panelStates({ data: { value: data } }, data.receivedAt), feeds: { data: { value: data } }, now: data.receivedAt };
    const html = positionsHtml(ctx).html;
    assert.match(html, /<div class="r"><span class="muted">—<\/span><\/div>/);
    assert.doesNotMatch(html, /Open result:|Today’s result:|no data received yet/);
  }
  for (const field of ['dayPnl', 'openPnl']) for (const scope of ['stage0', 'keep']) {
    const row = structuredClone(valid.data.positions.rows.find(r => r.scope === scope));
    delete row.dayPnl; delete row.openPnl;
    row.reasons = { [field]: 'not_exact_yet' };
    const render = value => scope === 'keep' ? keptHtml({ states: { kept: { state: 'fresh', value: [value] } } })
      : positionsHtml({ states: { positions: { state: 'fresh', value: [value] } }, feeds: {}, now: valid.data.receivedAt }).html;
    assert.doesNotMatch(render(row), /not exact yet|no data received yet|Open result:|Today’s result:/, `${scope} absent ${field}`);
    row[field] = null;
    const html = render(row), label = field === 'openPnl' ? 'Open result' : 'Today’s result';
    assert.ok(html.includes(`${label}: not exact yet`), `${scope} null ${field}`);
    if (scope === 'stage0' && field === 'openPnl') assert.match(html, /title="Open result: not reported · not exact yet" aria-label="Open result: not reported · not exact yet">—<\/span>/);
    row[field] = { amount: '1.25', currency: 'EUR' };
    assert.doesNotMatch(render(row), /not exact yet|no data received yet|Open result:|Today’s result:/, `${scope} valued ${field}`);
    if (scope === 'stage0' && field === 'openPnl') assert.match(render(row), /\+€ 1,25/);
  }
});

test('position rows: null values expose their reasons visibly and in accessible dash names', () => {
  const data = read('positions-null.json');
  const cells = panelStates({ data: { value: data } }, data.receivedAt);
  const ctx = { states: cells, feeds: { data: { value: data } }, now: data.receivedAt };
  const kept = keptHtml(ctx), positions = positionsHtml(ctx).html;
  for (const label of ['Quantity', 'Last price', 'Worth']) for (const why of ['not exact yet', 'not reported by the broker']) {
    assert.ok(kept.includes(`title="${label}: not reported · ${why}" aria-label="${label}: not reported · ${why}">—</span>`));
    assert.ok(kept.includes(`${label}: ${why}`));
  }
  assert.match(positions, /title="Last price: not reported · not reported by the broker"/);
  assert.match(positions, /class="position-reasons">Last price: not reported by the broker/);
  assert.doesNotMatch(kept.slice(kept.indexOf('<div class="prow"')), /<(?:button|a|input)\b|tabindex=/);
  assert.match(kept, /data-keep="SXR8"/);
  assert.match(kept, /data-keep="TSLA"/);
  assert.equal(health.cellReason('not_exact_yet'), 'not exact yet');
  assert.equal(health.cellReason('source_unavailable'), 'not reported by the broker');
  assert.equal(health.cellReason('source_not_authoritative'), 'held back: the kept-holdings list disagrees');
});

test('position worth: null tracks stay hidden in place; valued tracks stay visible; KEEP has no track', () => {
  const mapped = valid.data.positions.rows.find(row => row.scope === 'stage0');
  const kept = valid.data.positions.rows.find(row => row.scope === 'keep');
  for (const source of [mapped, { ...mapped, desk: null, scope: 'legacy' }, read('positions-unmapped.json'), kept]) {
    for (const marketValue of [null, { amount: '0', currency: 'EUR' }, { amount: '12.5', currency: 'EUR' }]) {
      const row = { ...source, marketValue, reasons: { ...source.reasons } };
      if (marketValue === null) row.reasons.marketValue = 'not_exact_yet';
      else delete row.reasons.marketValue;
      const ctx = { states: { positions: { state: 'fresh', value: [row] }, kept: { state: 'fresh', value: [row] } }, feeds: {} };
      const html = row.scope === 'keep' ? keptHtml(ctx) : positionsHtml(ctx).html;
      if (row.scope === 'keep') assert.doesNotMatch(html, /class="vbar"/);
      else if (marketValue === null) assert.match(html, /<span class="vbar" style="visibility:hidden"><\/span>/,
        'retain the track element and its layout space without painting an unknown worth');
      else {
        assert.match(html, /<span class="vbar">/);
        assert.doesNotMatch(html, /visibility:hidden/);
      }
    }
  }
});

test('unmapped positions: visible reason, honest row count, neutral identity, last in desk order, excluded from figures', () => {
  const data = read('positions-null.json'), unmapped = read('positions-unmapped.json');
  const mapped = data.positions.rows[0];
  data.positions.rows.push(...['joe', 'joel'].map((desk, i) => ({ ...structuredClone(mapped), desk, symbol: `DESK${i}` })),
    { ...structuredClone(mapped), desk: null, symbol: 'OLD', scope: 'legacy' });
  const context = value => ({ states: panelStates({ data: { value } }, value.receivedAt), feeds: { data: { value } }, now: value.receivedAt });
  const before = context(data), baseline = positionsHtml(before);
  assert.equal(baseline.sub, '4 open · desk positions only · each in its own currency', 'no unmapped rows: byte-identical subtitle');
  // Put it first in the input, with a symbol that also sorts before the desks.
  data.positions.rows.unshift(unmapped);
  const after = context(data), rendered = positionsHtml(after);
  const row = rendered.html.slice(rendered.html.lastIndexOf('<div class="prow"'));
  const label = 'No desk · not matched to a desk';
  assert.ok(row.includes(`title="${label}" aria-label="${label}">${label}</span>`));
  assert.ok(row.includes('<span class="sym" aria-hidden="true">AAA</span>'));
  assert.doesNotMatch(row, /var\(--desk-|class="i im"|class="dmark"/);
  assert.deepEqual([...rendered.html.matchAll(/<div class="name"><b>([^<]+)<\/b>/g)].map(m => m[1]),
    ['OLD', 'DEMO', 'DESK0', 'DESK1', 'AAA'], 'legacy order and all mapped desk order stay unchanged');
  for (const field of ['Quantity', 'Last price', 'Worth', 'Open result']) {
    assert.ok(row.includes(`title="${field}: not reported · not exact yet" aria-label="${field}: not reported · not exact yet">—</span>`));
  }
  for (const field of ['Quantity', 'Last price', 'Worth', 'Today’s result', 'Open result']) assert.ok(row.includes(`${field}: not exact yet`));
  assert.equal(rendered.sub, '5 open · 1 not matched to a desk · each in its own currency');
  assert.equal(Number.parseInt(rendered.sub), [...rendered.html.matchAll(/<div class="prow" data-desk=/g)].length,
    'open count matches every listed row, including legacy and unmapped positions');
  for (const name of DATA_PANELS.filter(name => name !== 'positions')) {
    assert.deepEqual(after.states[name], before.states[name], `${name}: no guessed attribution or partial sum`);
  }
  assert.equal(heroLeft(after), heroLeft(before), 'Today totals and account figures stay unchanged');
  assert.equal(keptHtml(after), keptHtml(before));
  const only = context({ ...data, positions: { ...data.positions, rows: [unmapped] } });
  assert.equal(positionsHtml(only).sub, '1 open · 1 not matched to a desk · each in its own currency');
  assert.ok(positionsHtml(only).html.includes(label), 'zero desk rows still shows the unmapped position');
  const multiple = context({ ...data, positions: { ...data.positions, rows: [...data.positions.rows, { ...unmapped, symbol: 'BBB' }] } });
  assert.equal(positionsHtml(multiple).sub, '6 open · 2 not matched to a desk · each in its own currency');
});

test('kept worth: one null summand withholds the complete total rather than showing a partial sum', () => {
  const data = read('valid.json').data;
  const rows = data.positions.rows.filter(row => row.scope === 'keep');
  for (const state of ['fresh', 'stale', 'broken']) {
    const ctx = { states: { kept: { state, value: rows, reason: state === 'fresh' ? null : 'snapshot_stale', ageSeconds: 90 } } };
    assert.match(keptHtml(ctx), /worth € 600,00 and \$ 200,00/i);
    const incomplete = structuredClone(rows);
    incomplete[0].marketValue = null;
    incomplete[0].reasons = { marketValue: 'source_unavailable' };
    ctx.states.kept.value = incomplete;
    const html = keptHtml(ctx);
    assert.match(html, /Worth not available · not reported by the broker/);
    assert.doesNotMatch(html.slice(0, html.indexOf('<div class="prow"')), /worth \$ 200,00/i);
    assert.equal(format.sumByCurrency(incomplete.map(row => row.marketValue)), null);
  }
});

test('ledger size: decimal MB round half-even from exact integer bytes', () => {
  for (const [bytes, text] of [[0, '0,0'], [49999, '0,0'], [50000, '0,0'], [50001, '0,1'],
    [999999, '1,0'], [1000000, '1,0'], [3249999, '3,2'], [3250000, '3,2'], [3250001, '3,3'],
    [3349999, '3,3'], [3350000, '3,4'], [3350001, '3,4'], [9950000, '10,0']]) {
    assert.equal(format.ledgerAmount(bytes), `${text} MB`, String(bytes));
  }
  for (const bytes of [-1, 0.5, '1000000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => format.ledgerAmount(bytes), TypeError);
  }
  assert.equal(format.ledgerSize({}), null);
  assert.deepEqual(format.ledgerSize({ ledgerBytes: 3250000 }), { text: 'ledger 3,2 MB', title: 'Ledger: 3250000 bytes' });
  assert.deepEqual(format.ledgerSize({ ledgerBytes: 3250000, ledgerCapBytes: 8000000 }), {
    text: 'ledger 3,2 MB of 8,0 MB', title: 'Ledger: 3250000 bytes of 8000000 bytes',
  });
  assert.deepEqual(format.ledgerSize({ ledgerBytes: 9000000, ledgerCapBytes: 8000000 }), {
    text: 'ledger 9,0 MB of 8,0 MB', title: 'Ledger: 9000000 bytes of 8000000 bytes',
  });
});

test('ledger size: rounding promotes MB to GB and GB to TB; values beyond the reserve stay correct', () => {
  for (const [bytes, text] of [[999949999, '999,9 MB'], [999950000, '1,0 GB'], [1000000000, '1,0 GB'],
    [3250000000, '3,2 GB'], [3350000000, '3,4 GB'],
    [999949999999, '999,9 GB'], [999950000000, '1,0 TB'], [1000000000000, '1,0 TB'],
    [3250000000000, '3,2 TB'], [3350000000000, '3,4 TB'],
    [999900000000000, '999,9 TB'], [999949999999999, '999,9 TB'], [999950000000000, '1000,0 TB'],
    [8999850000000000, '8999,8 TB'], [8999950000000000, '9000,0 TB'],
    [9007150000000000, '9007,2 TB'], [Number.MAX_SAFE_INTEGER, '9007,2 TB']]) {
    assert.equal(format.ledgerAmount(bytes), text, String(bytes));
  }
  assert.deepEqual(format.ledgerSize({ ledgerBytes: Number.MAX_SAFE_INTEGER, ledgerCapBytes: 1000000000 }), {
    text: 'ledger 9007,2 TB of 1,0 GB', title: 'Ledger: 9007199254740991 bytes of 1000000000 bytes',
  });
});

test('executor presentation: degraded without a reason is yellow; capture warns and a full ledger is red', () => {
  const base = { status: 'running', halt: false, brakes: false, gatewayReachable: true };
  for (const [fields, expected] of [[{}, ['Running', 'ok', null]],
    [{ status: 'degraded' }, ['Degraded', 'warn', null]],
    [{ status: 'degraded', reason: 'results_capture_failed' }, ['Degraded', 'warn', 'results capture failing — trading continues']],
    [{ status: 'degraded', reason: 'ledger_size_limit' }, ['Degraded', 'bad', 'trade record is full — new orders refused']],
    [{ status: 'down', reason: 'results_capture_failed' }, ['Down', 'bad', 'results capture failing — trading continues']],
    [{ halt: true, reason: 'executor_broker_disagreement' }, ['Running', 'bad', 'executor and broker disagree']]]) {
    const p = health.executorPresentation({ ...base, ...fields });
    assert.deepEqual([p.status, p.tone, p.reason], expected);
  }
});

test('health: capture leaves board health unchanged; the full ledger is red immediately after halt', () => {
  const payload = ingress(valid.data);
  payload.seq++;
  const b = board({ feed: 'data', payload, receivedAt: valid.data.receivedAt, now: valid.data.receivedAt });
  const view = (states = b.states, feeds = b.feeds, now = b.now) => health.boardHealthPresentation(states, feeds, now);
  const healthy = view();
  Object.assign(b.feeds.data.value.safety.executor, { status: 'degraded', reason: 'results_capture_failed', ledgerBytes: 3250000, ledgerCapBytes: 8000000 });
  assert.deepEqual(view(), healthy);
  delete b.feeds.data.value.safety.executor.reason;
  assert.deepEqual(view(), healthy);
  b.feeds.data.value.safety.executor.reason = 'results_capture_failed';
  // Check every existing yellow and red fixture against the same executor warning.
  for (const id of ['stale-receive-age', 'c-frozen-producer', 'b-incomplete-family', 'b-equity-null-gateway-ready',
    'h-keep-policy-mismatch', 'b-weekend-no-sod', 'j-ny-midnight-gap', 'a-gateway-up-but-dead',
    'c-old-producer-image', 'unknown-schema', 'g-expired-sso', 'd-routing-stub']) {
    const other = board(fixture(id));
    const prior = health.boardHealthPresentation(other.states, other.feeds, other.now);
    Object.assign(other.feeds.data.value.safety.executor, { status: 'degraded', reason: 'results_capture_failed' });
    assert.deepEqual(health.boardHealthPresentation(other.states, other.feeds, other.now), prior, id);
  }
  for (const reason of ['gateway_degraded', 'gateway_unconfirmed']) {
    const feeds = structuredClone(b.feeds);
    Object.assign(feeds.data.value.safety.gateway, { apiSessionReady: false, reason });
    assert.equal(view(panelStates(feeds, b.now, b.states), feeds).reason, reason);
  }
  for (const [name, expected] of [['today.dayPnl', 'day_pending'], ['today.openPnl', 'open_unavailable_rth']]) {
    const states = structuredClone(b.states);
    states[name].value = null;
    assert.equal(view(states).reason, expected);
  }
  for (const status of ['running', 'degraded', 'down']) {
    Object.assign(b.feeds.data.value.safety.executor, { status, reason: 'ledger_size_limit' });
    const p = view();
    assert.deepEqual([p.tone, p.reason, p.label, p.statusTone], ['red', 'ledger_size_limit', 'Needs fix', 'bad']);
  }
  assert.equal(view().explanation, 'trade record is full — new orders refused');
  assert.equal(view(b.states, b.feeds, at(b.now, 200)).reason, 'ledger_size_limit');
  // Both ordinary and executor/broker disagreement halts keep precedence.
  b.states.halt.value = true;
  for (const haltReason of ['halt_on', 'executor_broker_disagreement']) {
    b.feeds.data.value.safety.haltReason = haltReason;
    assert.equal(view().reason, 'halt_on');
  }
});

test('header: every ranked reason carries a complete sentence and the existing tone', () => {
  const b = board(fixture('e-layout-storage-unavailable'));
  for (const reason of Object.keys(health.REASON_COPY)) for (const tone of ['green', 'yellow', 'red']) {
    const statusTone = { green: 'ok', yellow: 'warn', red: 'bad' }[tone];
    const view = headerHealth(b, { reason, tone, statusTone });
    const sentence = health.statusPresentation(b, { reason, tone, statusTone }).sentence;
    assert.ok(view.html.includes(`tone-${statusTone}`));
    assert.equal(view.label, `${tone === 'green' ? 'Live. Numbers are up to date' : sentence}. Open status details.`);
    assert.equal(view.title, sentence);
    assert.doesNotMatch(view.html, /lbl-long|Board OK|Broker OK/);
  }
});

test('header: capture leaves the header unchanged; ledger Needs fix carries its reason and recovers', () => {
  const payload = ingress(valid.data);
  payload.seq++;
  const b = board({ feed: 'data', payload, receivedAt: valid.data.receivedAt, now: valid.data.receivedAt });
  const view = () => headerHealth(b, health.boardHealthPresentation(b.states, b.feeds, b.now));
  const healthy = view();
  assert.match(healthy.html, /#i-check/);
  assert.equal(healthy.label, 'Live. Numbers are up to date. Open status details.');
  assert.equal(healthy.title, healthy.sentence);
  Object.assign(b.feeds.data.value.safety.executor, { status: 'degraded', reason: 'results_capture_failed' });
  assert.deepEqual(view(), healthy);
  delete b.feeds.data.value.safety.executor.reason;
  assert.deepEqual(view(), healthy);
  b.feeds.data.value.safety.executor.reason = 'ledger_size_limit';
  const header = view();
  assert.ok(header.html.includes('Trade record is full'));
  assert.ok(header.html.includes('tone-bad'));
  assert.equal(header.title, 'Trade record is full');
  assert.equal(header.label, 'Trade record is full. Open status details.');
  Object.assign(b.feeds.data.value.safety.executor, { status: 'running' });
  delete b.feeds.data.value.safety.executor.reason;
  assert.deepEqual(view(), healthy);
});

// Execute the actual production scheduler. Only its render body and the native
// frame queue are stand-ins; Blink consumes due callbacks even when disabled
// scripting makes their JS invocation return without running (JOED-47).
function headerFrameHarness(onRender = () => {}) {
  const app = readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8');
  const schedule = app.match(/^  function schedule\(reason = 'tick'\) \{[\s\S]*?^  \}/m)?.[0];
  assert.ok(schedule, 'use the production schedule(), not a rewritten copy');
  let next = 0;
  const queued = [];
  const board = runInNewContext(`(() => {
    let frame = 0, pending = null, renders = 0;
    function render(reason) { frame = 0; renders++; onRender(reason); }
    ${schedule}
    return { schedule, state: () => ({ frame, renders }) };
  })()`, { onRender, requestAnimationFrame: callback => { queued.push(callback); return ++next; } });
  return { ...board, queued, due: (scriptsEnabled = true) => {
    const callbacks = queued.splice(0);
    if (scriptsEnabled) for (const callback of callbacks) callback();
  } };
}

test('header crops: consuming a disabled rAF strands schedule(), deferring it preserves rendering', () => {
  const dropped = headerFrameHarness();
  dropped.schedule();
  dropped.due(false);
  assert.ok(dropped.state().frame > 0);
  for (const reason of ['data', 'tick', 'fleet-config']) dropped.schedule(reason);
  dropped.due();
  assert.equal(dropped.state().renders, 0, 're-enabling scripts cannot replay the consumed callback');
  assert.equal(dropped.queued.length, 0, 'refresh/tick cannot schedule while frame stays set');

  const deferred = headerFrameHarness();
  deferred.schedule();
  // No frame is consumed during a true pause; it remains queued on resume.
  assert.equal(deferred.queued.length, 1);
  deferred.due();
  deferred.schedule('data');
  deferred.due();
  assert.equal(deferred.state().renders, 2);
  assert.equal(deferred.state().frame, 0);
});

test('header crops: exact serialized clone survives live renders and is removed on success or failure', async () => {
  for (const fail of [false, true]) {
    const liveButton = { innerHTML: 'live header' }, button = {
      ...liveButton, attributes: { id: 'hdrHealth', title: 'previous title' },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
    };
    let mounted = null;
    const copy = { style: {}, attributes: {},
      querySelector: selector => { assert.equal(selector, '#hdrHealth'); return button; },
      querySelectorAll: selector => { assert.equal(selector, '[id]'); return [button]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      remove() { mounted = null; },
    };
    const live = { cloneNode: deep => { assert.equal(deep, true); return copy; },
      getBoundingClientRect: () => ({ left: 0, width: 390 }),
      parentElement: { append: node => { mounted = node; } },
    };
    const document = { documentElement: { scrollHeight: 2000 },
      querySelector: selector => selector === 'header.top' ? live : mounted,
    };
    const page = { evaluate: source => runInNewContext(source, { document, scrollX: 0 }) };
    const board = headerFrameHarness(() => { liveButton.innerHTML = 'next live header'; });
    const view = { html: '<b>Needs fix</b>', label: 'Needs fix. Open Desk.', title: null };
    board.schedule('tick');
    const capture = captureHeaderCrop(page, view, async selector => {
      assert.equal(selector, '[data-joedesk-header-crop]');
      assert.equal(mounted, copy);
      assert.equal(copy.style.position, 'absolute');
      assert.equal(copy.style.top, '2016px');
      assert.equal(copy.style.width, '390px');
      assert.equal(button.attributes.id, undefined, 'renders still find only the live header IDs');
      assert.equal(button.attributes.title, undefined, 'no stale tooltip on the clone');
      assert.equal(button.attributes['aria-label'], view.label);
      assert.equal(copy.inert, true);
      board.due();
      assert.equal(liveButton.innerHTML, 'next live header');
      assert.equal(button.innerHTML, view.html, 'capture keeps the requested production markup across a tick');
      board.schedule('data'); board.due();
      assert.equal(board.state().renders, 2, 'a refresh still renders while capture is in flight');
      if (fail) throw new Error('capture failed');
    });
    if (fail) await assert.rejects(capture, /capture failed/);
    else await capture;
    assert.equal(mounted, null, 'the temporary header is always removed');
    assert.equal(liveButton.innerHTML, 'next live header', 'cleanup never restores stale live markup');
  }
});

test('Desk executor problem: precise capture/full-ledger sentences, optional sizes and recovery', () => {
  const capture = 'Paper executor degraded: results capture failing, trading continues';
  const full = 'Trade record is full: new orders refused';
  const base = { status: 'degraded', reason: 'results_capture_failed' };
  for (const [fields, expected] of [
    [base, `${capture}.`],
    [{ ...base, ledgerBytes: 3250000, ledgerCapBytes: 8000000 }, `${capture} (ledger 3,2 MB of 8,0 MB).`],
    [{ ...base, ledgerBytes: 3350000 }, `${capture} (ledger 3,4 MB).`],
    [{ ...base, reason: 'ledger_size_limit', ledgerBytes: 9000000, ledgerCapBytes: 8000000 }, `${full} (ledger 9,0 MB of 8,0 MB).`],
    [{ status: 'running', reason: 'ledger_size_limit', ledgerBytes: 0 }, `${full} (ledger 0,0 MB).`],
    [{ status: 'down', reason: 'ledger_size_limit' }, `${full}.`],
    [{ status: 'degraded' }, null],
    [{ status: 'running' }, null],
    [{ status: 'down', reason: 'results_capture_failed' }, null],
  ]) assert.equal(executorProblem({ safety: { executor: fields } }), expected);
  assert.equal(executorProblem(null), null);
  assert.equal(executorProblem({ safety: {} }), null);
});

test('Desk executor problem: live ticks reuse the sentence; a new snapshot recomputes it', () => {
  let reads = 0;
  const executor = { status: 'degraded', reason: 'results_capture_failed', ledgerCapBytes: 8000000,
    get ledgerBytes() { reads++; return 3250000; } };
  const data = { safety: { executor } };
  const sentence = executorProblem(data), firstReads = reads;
  assert.ok(firstReads > 0);
  for (let tick = 0; tick < 60; tick++) assert.equal(executorProblem(data), sentence);
  assert.equal(reads, firstReads);
  assert.equal(executorProblem({ safety: { executor: { ...executor, ledgerBytes: 3350000 } } }),
    'Paper executor degraded: results capture failing, trading continues (ledger 3,4 MB of 8,0 MB).');
  assert.equal(executorProblem({ safety: { executor: { status: 'running' } } }), null);
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

function unconfirmedBoard(checkAge = 100, receiptAge = 9) {
  const payload = structuredClone(fixture('a-frozen-ready-gateway').payload);
  payload.safety.gateway.checkedAt = at(payload.generatedAt, receiptAge - checkAge);
  const b = board({ feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, receiptAge) }, { cold: true });
  assert.equal(b.feeds.data.status, 200);
  return b;
}

test('health: unconfirmed null money is yellow Broker unsure at 66, 100, 144 and 179 seconds, up to the stopped-check bound', () => {
  for (const checkAge of [66, 100, 144, 179, health.FEED_STOPPED_S - 0.001]) {
    const b = unconfirmedBoard(checkAge);
    assert.equal(b.states.gateway.ageSeconds, checkAge);
    for (const name of ['today.equity', 'desks.j.equity', 'desks.joe.equity', 'desks.joel.equity']) {
      assert.deepEqual([b.states[name].value, b.states[name].reason], [null, 'gateway_unconfirmed']);
      assert.equal(cellView(b.states[name], name).caption, 'Unavailable · broker connection not confirmed');
    }
    const p = health.boardHealthPresentation(b.states, b.feeds, b.now);
    assert.deepEqual([p.tone, p.reason, p.label, p.statusTone], ['yellow', 'gateway_unconfirmed', 'Broker unsure', 'warn']);
    assert.equal(p.explanation, 'the broker connection has not checked in — reload; if still old, tell Amy');
    assert.match(headerHealth(b, p).html, /tone-warn/);
  }
});

test('health: a missing gateway on a cold load cannot use receipt age to excuse null money', () => {
  const b = board(fixture('a-missing-gateway'), { cold: true });
  assert.equal(b.feeds.data.status, 200);
  assert.equal(b.feeds.data.value.safety.gateway, undefined);
  assert.equal(b.states.gateway.ageSeconds, 9, 'the missing-gateway panel only carries receipt age');
  assert.equal(b.states['today.equity'].value, null);
  assert.deepEqual(health.boardHealthPresentation(b.states, b.feeds, b.now), {
    tone: 'red', reason: 'equity_unavailable', label: 'Needs fix', statusTone: 'bad',
    explanation: health.REASON_COPY.equity_unavailable,
  });
});

test('health: invalid or absent real check timestamps cannot excuse null money even with a finite panel age', () => {
  // Ranking must fail closed even if an inconsistent selector still has an age.
  for (const checkedAt of [undefined, null, 'invalid', '2026-10-14T17:50:51Z',
    '2026-02-30T17:50:51.000Z', at(valid.data.generatedAt, 3600)]) {
    const b = unconfirmedBoard();
    b.feeds.data.value.safety.gateway.checkedAt = checkedAt;
    assert.equal(b.states.gateway.ageSeconds, 100);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' }, String(checkedAt));
  }
});

test('health: a 59-second OK broker with null unconfirmed money stays red in RTH and on Sunday', () => {
  for (const [generatedAt, rth] of [['2026-10-14T17:52:22.000Z', true], ['2026-10-18T17:52:22.000Z', false]]) {
    const payload = switchSetSnapshot(generatedAt);
    payload.safety.gateway.checkedAt = at(generatedAt, -50);
    for (const bag of [payload.totals, ...payload.desks.map(desk => desk.money)]) {
      for (const field of ['equity', 'dayPnl', 'openPnl', 'totalPnl']) bag.reasons[field] = 'gateway_unconfirmed';
    }
    const b = board({ feed: 'data', payload, receivedAt: generatedAt, now: at(generatedAt, 9) }, { cold: true });
    assert.equal(b.feeds.data.status, 200);
    assert.equal(isRTH(b.now), rth);
    assert.equal(b.states.gateway.ageSeconds, 59);
    assert.equal(health.brokerState(b.states, b.feeds.data.value).word, 'OK');
    assert.equal(b.states['today.equity'].value, null);
    const p = health.boardHealthPresentation(b.states, b.feeds, b.now);
    assert.deepEqual([p.tone, p.reason, p.label], ['red', 'equity_unavailable', 'Needs fix']);
  }
});

test('health: a degraded broker cannot excuse null unconfirmed equity', () => {
  const b = unconfirmedBoard();
  Object.assign(b.feeds.data.value.safety.gateway, { apiSessionReady: false, reason: 'gateway_degraded' });
  assert.equal(health.brokerState(b.states, b.feeds.data.value).word, 'degraded');
  assert.equal(b.states['today.equity'].reason, 'gateway_unconfirmed');
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' });
});

test('health: excused null money ranks Broker unsure ahead of a late receipt at every allowed check age', () => {
  for (const checkAge of [66, 100, 144, 179, health.FEED_STOPPED_S - 0.001, health.FEED_STOPPED_S, 200]) {
    const b = unconfirmedBoard(checkAge, 61);
    assert.equal(b.states.gateway.ageSeconds, checkAge);
    assert.equal(health.brokerState(b.states, b.feeds.data.value).word, 'unsure');
    assert.equal(health.dataAge(b.feeds, b.now).reason, 'snapshot_stale');
    const p = health.boardHealthPresentation(b.states, b.feeds, b.now);
    assert.deepEqual([p.tone, p.reason, p.label], checkAge < health.FEED_STOPPED_S
      ? ['yellow', 'gateway_unconfirmed', 'Broker unsure'] : ['red', 'equity_unavailable', 'Needs fix'], String(checkAge));
  }
});

test('health: one excused equity cell ranks Broker unsure ahead of other yellow warnings', () => {
  const names = ['today.equity', 'desks.j.equity', 'desks.joe.equity', 'desks.joel.equity'];
  const changes = [
    b => { b.feeds.data.reason = 'refresh_failed'; },
    b => { b.feeds.data.reason = 'contract_invalid'; },
    b => { Object.assign(b.states['today.totalPnl'], { value: { amount: '100', currency: 'EUR' }, retained: true }); },
    b => { b.feeds.data.value.desks[0].state = 'stuck'; },
  ];
  for (const name of names) for (const change of changes) {
    const b = unconfirmedBoard();
    for (const other of names) if (other !== name) b.states[other].reason = 'not_exact_yet';
    change(b);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'yellow', reason: 'gateway_unconfirmed' }, name);
  }
});

test('health: unconfirmed null money is red at 180 and 200 seconds or with an unknown check age', () => {
  for (const checkAge of [health.FEED_STOPPED_S, 200]) {
    const b = unconfirmedBoard(checkAge);
    assert.equal(b.states.gateway.ageSeconds, checkAge);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' });
  }
  // Unknown timing is a selector/ranking input, never an invalid wire timestamp.
  for (const checkAge of [null, undefined, NaN, Infinity, -1]) {
    const b = unconfirmedBoard(); b.states.gateway.ageSeconds = checkAge;
    assert.equal(health.localBoardHealth(b.states, b.feeds, b.now).reason, 'equity_unavailable');
  }
  const b = unconfirmedBoard(); delete b.states.gateway;
  assert.equal(health.localBoardHealth(b.states, b.feeds, b.now).reason, 'equity_unavailable');
});

test('health: broker-gap grace uses the shared gateway progress age, even while receipts advance', () => {
  for (const checkAge of [144, health.FEED_STOPPED_S]) {
    const b = unconfirmedBoard(66);
    b.feeds.data.gatewayProgress = { checkedAt: b.feeds.data.value.safety.gateway.checkedAt,
      advancedAt: b.now, initialAgeMs: checkAge * 1000 };
    b.states = panelStates(b.feeds, b.now);
    assert.equal(b.states.gateway.ageSeconds, checkAge);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), checkAge < health.FEED_STOPPED_S
      ? { tone: 'yellow', reason: 'gateway_unconfirmed' } : { tone: 'red', reason: 'equity_unavailable' });
  }
});

test('health: brief broker gaps keep other null-equity reasons red and not-exact values neutral', () => {
  for (const name of ['today.equity', 'desks.j.equity', 'desks.joe.equity', 'desks.joel.equity']) {
    for (const reason of ['source_unavailable', 'all_desk_equity_unavailable', 'family_projection_unavailable', 'gateway_down', null, undefined]) {
      const b = unconfirmedBoard(); b.states[name].reason = reason;
      assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' }, `${name}: ${reason}`);
    }
    const b = unconfirmedBoard(); b.states[name].reason = 'not_exact_yet';
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'yellow', reason: 'gateway_unconfirmed' });
  }
});

test('health: brief broker gaps preserve halt, ledger, gateway-down, stopped-feed and stuck-producer red precedence', () => {
  const cases = [
    [b => { b.states.halt.value = true; }, 'halt_on'],
    [b => { b.feeds.data.value.safety.executor.reason = 'ledger_size_limit'; }, 'ledger_size_limit'],
    ...['gateway_down', 'upstream_lost'].map(reason => [b => {
      Object.assign(b.feeds.data.value.safety.gateway, { apiSessionReady: false, reason });
    }, 'gateway_down']),
    [b => { b.now = at(b.feeds.data.value.receivedAt, health.FEED_STOPPED_S); }, 'feed_disconnected'],
    [b => { b.feeds.data.generatedAdvancedAt = at(b.now, -health.FEED_STOPPED_S); }, 'producer_stuck'],
  ];
  for (const [change, reason] of cases) {
    const b = unconfirmedBoard(); change(b);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason });
  }
});

let switchSet;
function notExactBoard() {
  const payload = structuredClone(switchSet ??= switchSetSnapshot());
  const b = board({ feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, 9) }, { cold: true });
  assert.equal(b.feeds.data.status, 200);
  return b;
}

test('health: not-exact switch values keep Board OK and one neutral Details fact without missing-money alarms', () => {
  const b = notExactBoard();
  assert.equal(health.NOT_EXACT_TONE, 'green');
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'green', reason: 'board_ok' });
  const p = health.boardHealthPresentation(b.states, b.feeds, b.now);
  assert.deepEqual([p.label, p.statusTone, p.explanation], ['Board OK', 'ok', 'numbers are up to date']);
  assert.match(headerHealth(b, p).html, /tone-ok/);
  assert.equal(health.deskValuesNotExact(b.states), true);
  assert.deepEqual(health.boardDiagnostics(b.states, b.feeds, b.now), []);
  for (const id of ['j', 'joe', 'joel']) {
    const html = cardStatus(id, ['dayPnl', 'openPnl', 'totalPnl'].map(field => [field, b.states[`desks.${id}.${field}`]]));
    assert.match(html, /class="st none"/);
    assert.match(html, /href="#i-info"/);
    assert.match(html, /Numbers: unavailable · not exact yet/);
    assert.doesNotMatch(html, /st bad|#i-stop/);
  }
});

test('health: any other missing equity reason stays red, including a missing cell, mixed with not-exact values', () => {
  for (const name of ['today.equity', 'desks.j.equity', 'desks.joe.equity', 'desks.joel.equity']) {
    for (const reason of ['source_unavailable', 'all_desk_equity_unavailable', 'unavailable', null, undefined]) {
      const b = notExactBoard();
      b.states[name] = { ...b.states[name], reason };
      assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' }, `${name}: ${reason}`);
    }
    const b = notExactBoard(); delete b.states[name];
    assert.equal(health.localBoardHealth(b.states, b.feeds, b.now).reason, 'equity_unavailable');
  }
});

test('health: not-exact equity during regular hours is green when day and open results are current', () => {
  const payload = ingress(valid.data);
  for (const bag of [payload.totals, ...payload.desks.map(desk => desk.money)]) {
    bag.equity = null;
    bag.reasons = { ...bag.reasons, equity: 'not_exact_yet' };
  }
  const b = board({ feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, 9) }, { cold: true });
  assert.equal(b.feeds.data.status, 200);
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'green', reason: 'board_ok' });
});

test('health: not-exact equity coexists with current equity and preserves retained-value grace', () => {
  const b = notExactBoard(), name = 'desks.j.equity';
  b.states[name] = { ...b.states[name], value: { amount: '5000', currency: 'EUR' }, reason: null, state: 'fresh' };
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'green', reason: 'board_ok' });
  b.states[name] = { ...b.states[name], reason: 'not_exact_yet', retained: true, ageSeconds: health.RETAINED_GRACE_S };
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'yellow', reason: 'retained_values' });
  b.states[name].ageSeconds++;
  assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone: 'red', reason: 'equity_unavailable' });
  b.states[name].ageSeconds = null;
  assert.equal(health.localBoardHealth(b.states, b.feeds, b.now).reason, 'equity_unavailable');
});

test('health: not-exact values still run gateway, stuck-desk, transport, feed and halt checks', () => {
  const cases = [
    [b => { b.states.gateway.state = 'broken'; }, 'yellow', 'gateway_unconfirmed'],
    [b => { b.feeds.data.value.desks[0].state = 'stuck'; }, 'yellow', 'retained_values'],
    [b => { b.feeds.data.reason = 'refresh_failed'; }, 'yellow', 'refresh_failed'],
    [b => { b.feeds.data.reason = 'contract_invalid'; }, 'yellow', 'retained_values'],
    [b => { b.now = at(b.feeds.data.value.receivedAt, 61); }, 'yellow', 'snapshot_stale'],
    [b => { b.now = at(b.feeds.data.value.receivedAt, health.FEED_STOPPED_S); }, 'red', 'feed_disconnected'],
    [b => { b.states.halt.value = true; }, 'red', 'halt_on'],
    [b => { Object.assign(b.feeds.data.value.safety.gateway, { apiSessionReady: false, reason: 'gateway_down' }); }, 'red', 'gateway_down'],
  ];
  for (const [change, tone, reason] of cases) {
    const b = notExactBoard(); change(b);
    assert.deepEqual(health.localBoardHealth(b.states, b.feeds, b.now), { tone, reason });
  }
  const payload = switchSetSnapshot(valid.data.generatedAt);
  const rth = board({ feed: 'data', payload, receivedAt: payload.generatedAt, now: at(payload.generatedAt, 9) }, { cold: true });
  assert.equal(health.localBoardHealth(rth.states, rth.feeds, rth.now).reason, 'day_pending');
  rth.states['today.dayPnl'] = { value: { amount: '0', currency: 'EUR' }, retained: false };
  assert.equal(health.localBoardHealth(rth.states, rth.feeds, rth.now).reason, 'open_unavailable_rth');
});

test('health: the single NOT_EXACT_TONE constant can opt into yellow, after other checks', async () => {
  const url = new URL('../public/joe/health.js', import.meta.url);
  // Exercise the actual module with only its presentation policy changed;
  // absolute imports mirror the browser route mapping without writing files.
  const source = readFileSync(url, 'utf8').replace("export const NOT_EXACT_TONE = 'green';", "export const NOT_EXACT_TONE = 'yellow';")
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(mapped(specifier, url.href), url).href}'`);
  const yellow = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal(yellow.NOT_EXACT_TONE, 'yellow');
  const b = notExactBoard();
  assert.deepEqual(yellow.localBoardHealth(b.states, b.feeds, b.now), { tone: 'yellow', reason: 'values_not_exact' });
  const p = yellow.boardHealthPresentation(b.states, b.feeds, b.now);
  assert.deepEqual([p.statusTone, p.explanation], ['warn', 'desk values are not exact yet']);
  b.states.gateway.state = 'broken';
  assert.equal(yellow.localBoardHealth(b.states, b.feeds, b.now).reason, 'gateway_unconfirmed');
  b.states['desks.j.equity'].reason = 'source_unavailable';
  assert.equal(yellow.localBoardHealth(b.states, b.feeds, b.now).reason, 'equity_unavailable');
  assert.equal(yellow.localBoardHealth({}, { data: null }, b.now).reason, 'no_snapshot');
  const fresh = board(fixture('e-layout-storage-unavailable'));
  assert.equal(yellow.localBoardHealth(fresh.states, fresh.feeds, fresh.now).tone, 'green');
});

test('cell presentation: null not-exact values use neutral info; other failures and retained values keep their tone', () => {
  for (const state of ['broken', 'stale', 'not reported']) {
    const p = statePhrase({ state, value: null, reason: 'not_exact_yet' }, 'test');
    assert.deepEqual([p.tone, p.icon], ['none', 'info']);
    assert.match(st(p.tone, p.text, p.icon), /class="st none".*href="#i-info"/);
  }
  for (const reason of ['source_unavailable', 'gateway_unconfirmed', null]) {
    const p = statePhrase({ state: 'broken', value: null, reason }, 'test');
    assert.equal(p.tone, 'bad');
    assert.match(st(p.tone, p.text, p.icon), /href="#i-stop"/);
  }
  assert.equal(statePhrase({ state: 'broken', value: {}, retained: true, ageSeconds: 9, reason: 'not_exact_yet' }, 'test').tone, 'warn');
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
      // P4: the closed-trade record has its own read, so a cold failure gives it its own reason too.
      assert.deepEqual([s.states.results.state, s.states.results.reason], ['broken', reason]);
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

test('JOED-30 reads: the actual results worker and fallback both preserve partial coverage and exact trade money', async () => {
  const realWorker = globalThis.Worker, realFetch = globalThis.fetch, realSelf = globalThis.self;
  const value = structuredClone(valid.results);
  value.days[0].coverage = 'partial';
  for (const desk of Object.values(value.days[0].desks)) desk.realisedNet = desk.fees = null;
  value.days.push({ date: '2026-10-13', desks: {}, coverage: 'partial', partialReasons: ['history_gap'] });
  const { indexResults } = await import('../public/joe/results-model.js');
  const expected = indexResults(value);
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(value), { headers: { 'X-Joe-Server-Now': value.receivedAt } });
    let reply;
    const message = new Promise(resolve => { reply = resolve; });
    globalThis.self = { postMessage: (data, transfer) => reply(structuredClone(data, { transfer })) };
    await import('../public/joe/history-worker.js?joed30-partial');
    self.onmessage({ data: 'results' });
    const result = await message;
    assert.equal(result.kind, 'results');
    assert.deepEqual(result.index.partialDays, expected.partialDays);
    assert.deepEqual(result.index.agg, expected.agg);
    globalThis.Worker = undefined;
    const feed = createFeed(() => {});
    await feed.refreshResults();
    assert.equal(feed.usesWorker(), false);
    const cell = feed.select().states.results;
    assert.equal(cell.state, 'fresh');
    assert.deepEqual(cell.value.index.partialDays, expected.partialDays);
    assert.deepEqual(cell.value.index.agg, expected.agg);
  } finally {
    globalThis.Worker = realWorker; globalThis.fetch = realFetch;
    if (realSelf === undefined) delete globalThis.self;
    else globalThis.self = realSelf;
  }
});

test('refresh: await the worker before the next results push, including unchanged replies', async () => {
  const realWorker = globalThis.Worker, realFetch = globalThis.fetch;
  const { indexResults } = await import('../public/joe/results-model.js');
  let worker, stamp = valid.results.receivedAt;
  const index = indexResults(valid.results);
  class HeldWorker {
    messages = [];
    constructor() { worker = this; }
    postMessage(message) { this.messages.push(message); }
    reply(data) { this.onmessage({ data: { ...data, ms: 0 } }); }
  }
  try {
    globalThis.Worker = HeldWorker;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), {
      status: 503, headers: { 'X-Joe-Server-Now': stamp },
    });
    const feed = createFeed(() => {});
    const turn = () => new Promise(resolve => setImmediate(resolve));
    for (const phase of ['live', 'stale', 'rejected', 'recovered']) {
      if (phase === 'stale') stamp = at(valid.results.receivedAt, 60);
      let finished = false;
      const refreshed = feed.refresh().then(() => { finished = true; });
      await turn();
      // A fast state/clock read can make the retained record stale while its
      // worker read is still in flight. This is not a completed refresh.
      if (phase === 'stale') assert.equal(feed.select().states.results.state, 'stale');
      assert.equal(finished, false, `${phase}: the worker is still reading`);
      let concurrentFinished = false;
      const concurrent = feed.refreshResults().then(() => { concurrentFinished = true; });
      assert.deepEqual(worker.messages.splice(0), ['poll', 'results'], 'one read per feed');
      worker.reply({ kind: 'unchanged', feed: 'history' });
      await turn();
      assert.equal(finished, false, `${phase}: history cannot complete results`);
      assert.equal(concurrentFinished, false, `${phase}: overlapping callers await the same read`);
      if (phase === 'stale') worker.reply({ kind: 'unchanged', feed: 'results' });
      else worker.reply({ kind: 'results', index, reason: phase === 'rejected' ? 'contract_invalid' : null });
      await Promise.all([refreshed, concurrent]);
      assert.equal(finished, true);
      const cell = feed.select().states.results;
      assert.equal(cell.value.index, index);
      assert.equal(cell.valueReceivedAt, valid.results.receivedAt, 'refresh never freshens the receipt');
      assert.equal(cell.reason, phase === 'rejected' ? 'contract_invalid' : phase === 'live' ? null : 'snapshot_stale');
      assert.equal(cell.retained, phase === 'rejected');
    }
  } finally { globalThis.Worker = realWorker; globalThis.fetch = realFetch; }
});

test('refresh: a worker failure completes pending callers after the fallback read', async () => {
  const realWorker = globalThis.Worker, realFetch = globalThis.fetch;
  let worker, release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    globalThis.Worker = class {
      constructor() { worker = this; }
      postMessage() {}
    };
    globalThis.fetch = async url => {
      if (String(url).includes('results.json')) {
        await held;
        return new Response(JSON.stringify(valid.results), { headers: { 'X-Joe-Server-Now': valid.results.receivedAt } });
      }
      return new Response('{}', { status: 503 });
    };
    const feed = createFeed(() => {});
    let finished = false;
    const refreshed = feed.refresh().then(() => { finished = true; });
    worker.onerror();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'the fallback has not answered yet');
    release();
    await refreshed;
    assert.equal(feed.usesWorker(), false);
    assert.equal(feed.select().states.results.state, 'fresh');
    assert.equal(feed.feeds.results.value.seq, valid.results.seq);
    assert.equal(feed.feeds.results.value.receivedAt, valid.results.receivedAt);
  } finally { release(); globalThis.Worker = realWorker; globalThis.fetch = realFetch; }
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

test('browser budget: setup stays separate while boundary-crossing and live tasks keep the 125 ms guard', () => {
  assert.equal(REFERENCE_BUDGET.taskMs, 50);
  assert.equal(CI_GUARD.taskMs, 125);
  assert.equal(CI_GUARD.patchMs / REFERENCE_BUDGET.patchMs, 2.5);
  assert.equal(CI_GUARD.historyMs / REFERENCE_BUDGET.historyMs, 2.5);
  const tasks = [{ startTime: 0, duration: 90 }, { startTime: 90, duration: 132 },
    { startTime: 260, duration: 132 }, { startTime: 450, duration: 125 }, { startTime: 650, duration: 60 }];
  const windows = [{ name: 'desk updates', start: 100, end: 250 }, { name: 'history setup', start: 250, end: 400 },
    { name: 'history updates', start: 400, end: 650 }];
  const worker = { reason: 'history-worker', at: 455, ms: 600 };
  const render = { reason: 'data', at: 110, ms: 28 };
  const frame = { startTime: 90, duration: 140, scripts: [{ invoker: 'Window.requestAnimationFrame', forcedStyleAndLayoutDuration: 100 }] };
  const details = attributeBudgetTasks({ tasks, frames: [frame] }, [worker, render], windows);
  assert.deepEqual(details.map(t => t.phases), [[], ['desk updates'], ['history setup'], ['history updates'], []]);
  assert.deepEqual(details.filter(t => t.phases.some(p => p.endsWith('updates'))).filter(t => t.duration >= CI_GUARD.taskMs).map(t => t.duration), [132, 125]);
  assert.deepEqual(details[1].events, [render], '600 ms in the worker is not a 600 ms task on the page');
  assert.deepEqual(details[3].events, [worker], 'the worker reply is attributed at receipt time');
  assert.deepEqual(details[1].frames, [frame], 'style/layout evidence is retained beside the task');
  assert.deepEqual(details[3].frames, []);
});

test('browser budget: every timing-only combination gets one final re-measure, with no condition mutation', () => {
  const keys = ['patchBudget', 'historyBudget', 'renderBudget', 'taskBudget'];
  const clean = Object.freeze(Object.fromEntries(keys.map(key => [key, true])));
  for (let mask = 1; mask < 1 << keys.length; mask++) {
    const first = Object.freeze(Object.fromEntries(keys.map((key, i) => [key, !(mask & 1 << i)])));
    assert.deepEqual(decideTaskGuard(first, null, CI_GUARD), { ok: false, remeasure: true, remeasured: false, attempts: 1 });
    assert.deepEqual(decideTaskGuard(first, clean, CI_GUARD), { ok: true, remeasure: false, remeasured: true, attempts: 2 });
    for (const second of [first, { ...clean, patchBudget: false }, { ...clean, worker: false }]) {
      assert.deepEqual(decideTaskGuard(first, second, CI_GUARD), { ok: false, remeasure: false, remeasured: true, attempts: 2 });
    }
    assert.equal(Object.values(first).filter(value => !value).length, mask.toString(2).replaceAll('0', '').length);
  }
  for (const second of [null, clean]) assert.deepEqual(decideTaskGuard(clean, second, CI_GUARD),
    { ok: true, remeasure: false, remeasured: false, attempts: 1 });
});

test('browser budget: any non-timing or unknown failure prevents a re-measure even with timing breaches', () => {
  for (const key of ['measured', 'worker', 'historyRead', 'noMainThreadHistory', 'drawn', 'deskPushes', 'historyPushes',
    'finite', 'redraws', 'historyReads', 'nearMaximum', 'notCompacted', 'unknownBudget']) {
    for (const timingOK of [true, false]) {
      const first = { [key]: false, patchBudget: timingOK, historyBudget: timingOK, renderBudget: timingOK, taskBudget: timingOK };
      for (const second of [null, Object.fromEntries(Object.keys(first).map(key => [key, true]))]) {
        assert.deepEqual(decideTaskGuard(first, second, CI_GUARD), { ok: false, remeasure: false, remeasured: false, attempts: 1 }, key);
      }
    }
  }
});

test('browser budget: reference limits stay strict with no re-measure', () => {
  const keys = ['patchBudget', 'historyBudget', 'renderBudget', 'taskBudget'];
  for (let mask = 1; mask < 1 << keys.length; mask++) {
    const first = Object.fromEntries(keys.map((key, i) => [key, !(mask & 1 << i)]));
    for (const second of [null, Object.fromEntries(keys.map(key => [key, true]))]) {
      assert.deepEqual(decideTaskGuard(first, second, REFERENCE_BUDGET),
        { ok: false, remeasure: false, remeasured: false, attempts: 1 });
    }
  }
  assert.equal(REFERENCE_BUDGET.atMost, false);
  assert.equal(CI_GUARD.atMost, true);
});

// Exercise the exact runner with synthetic CDP replies, without a browser,
// servers or real time. Each load consumes one phase's scripted measurement.
async function simulatedBudget({ cold = [{}], live = [{}], limits = CI_GUARD } = {}) {
  let phase, sample, reads;
  const loads = { cold: 0, live: 0 }, boards = [], checks = [];
  const timings = (reason, count, ms) => Array.from({ length: count }, (_, i) => ({ reason, at: 200 + i * 20, ms }));
  const page = {
    async s() { return { identifier: 'observer' }; },
    async evaluate(source) {
      if (source.includes('tasks: window.__budgetTasks.snapshot()')) {
        const task = { startTime: phase === 'cold' ? 210 : 150, duration: sample.taskMs ?? 60, attribution: [] };
        return { timings: [...timings('history-worker', 3, 10), ...timings('history', 3, sample.historyMs ?? 10)],
          tasks: { tasks: [task], frames: [], hasFrames: false }, worker: sample.worker ?? true, lines: 3, end: 400 };
      }
      if (source.includes('timings.splice(0)')) {
        reads++;
        return { timings: reads === 2 ? timings('data', sample.pushes ?? 5, sample.patchMs ?? 10) : [], end: reads * 100 };
      }
      if (source.includes("filter(t => t.reason === 'history').length")) return 0;
      assert.ok(source.includes('.click()') || source === 'window.__joedesk.refresh()', source);
    },
  };
  const context = { decideTaskGuard, TIMING_GUARDS, observeBudgetTasks, attributeBudgetTasks,
    max: list => list.length ? Math.max(...list) : NaN,
    VIEWPORTS: [{ name: '390' }], NOW: '2026-10-14T17:42:22.000Z', ACTOR: 'fixture',
    largeScenario: (now, points = 9000) => ({ snapshot: { seq: 1001 }, history: { receivedAt: now, points: Array(points) } }),
    wideSnapshot: (snapshot, when, seq, shift) => ({ when, seq, shift }), at: (base, seconds) => `${base}/${seconds}`,
    configure: async () => {}, go: async () => {}, settle: async () => {}, waitFor: async () => {},
    load: async (page, url, panel) => {
      phase = panel === 'desk' ? 'live' : 'cold';
      const samples = phase === 'live' ? live : cold;
      sample = samples[loads[phase]++];
      assert.ok(sample, `unexpected extra ${phase} attempt`);
      reads = 0;
    },
    fetch: async () => ({ json: async () => ({ points: Array(7209), sizeBytes: 6 * 1048576 }) }),
  };
  const execute = runInNewContext(`(${runBudget.toString()})`, context);
  const traces = await execute({ page, limits,
    newBoard: async ({ history }) => {
      const board = { history, url: `http://fixture/${boards.length}/`, pushes: [], setNow() {},
        async push(payload) { this.pushes.push(payload); return { status: 200 }; } };
      boards.push(board);
      return board;
    },
    check: (ac, name, ok, detail) => checks.push({ name, ok, detail }),
  });
  return { traces, checks, loads, boards };
}

test('browser budget: cold and live re-measure on fresh boards, retaining both attributed rows and table attempts', async () => {
  const { traces, checks, loads, boards } = await simulatedBudget({ cold: [{ taskMs: 129, historyMs: 126 }, {}], live: [{ taskMs: 155, patchMs: 44.5, historyMs: 126 }, {}] });
  assert.deepEqual(loads, { cold: 2, live: 2 });
  assert.equal(boards.length, 4);
  assert.deepEqual(boards[0].history, boards[1].history);
  assert.deepEqual(boards[2].history, boards[3].history);
  assert.deepEqual(boards[2].pushes, boards[3].pushes, 'same sequence, times and workload on the fresh live board');
  assert.equal(boards[2].pushes.length, 9, 'one setup push, five Desk updates, three History updates');
  assert.ok(checks.every(c => c.ok));
  assert.equal(traces.length, 4);
  assert.ok(traces.every(r => r.attempts === 2 && r.remeasured));
  assert.deepEqual(Array.from(traces, r => r.attempt), [1, 2, 1, 2]);
  for (const [index, duration, phase] of [[0, 129, 'cold history'], [2, 155, 'desk updates']]) {
    assert.equal(traces[index].offendingTasks[0].duration, duration);
    assert.ok(traces[index].offendingTasks[0].phases.includes(phase));
    assert.ok(traces[index].offendingTasks[0].events.length > 0);
  }
  const guards = checks.filter(c => Object.keys(c.detail.conditions).some(key => TIMING_GUARDS.includes(key)));
  assert.equal(guards.length, 4);
  assert.ok(guards.every(c => c.name.includes('; re-measured once after a breach)') && c.detail.attemptRows.length === 2));
  const table = budgetTable(traces, CI_GUARD);
  assert.match(table, /Attempt/);
  assert.equal(table.match(/1\/2 \(re-measured\)/g).length, 2);
  assert.equal(table.match(/2\/2 \(re-measured\)/g).length, 2);
});

test('browser budget: runBudget stops after reproduced breaches and does not retry other failed checks', async () => {
  for (const sample of [{ patchMs: 44.5 }, { historyMs: 126 }, { taskMs: 129 }, { taskMs: 155, patchMs: 44.5 },
    { taskMs: 129, historyMs: 126 }, { taskMs: 155, patchMs: 44.5, worker: false }, { taskMs: 129, pushes: 4 }]) {
    const reproduced = sample.worker === undefined && sample.pushes === undefined;
    const { checks, loads } = await simulatedBudget({ live: [sample, sample] });
    assert.equal(loads.live, reproduced ? 2 : 1);
    assert.ok(checks.some(c => !c.ok));
    assert.ok(checks.filter(c => c.name.includes('live pushes')).every(c => c.detail.remeasured === reproduced));
  }
});

test('browser budget: timing-only breaches can clear once; any second measurement failure remains final', async () => {
  for (const sample of [{ patchMs: 44.5 }, { historyMs: 126 }, { taskMs: 155, patchMs: 44.5 }]) {
    const clean = await simulatedBudget({ live: [sample, {}] });
    assert.equal(clean.loads.live, 2);
    assert.ok(clean.checks.every(c => c.ok));
    for (const second of [{ worker: false }, { pushes: 4 }, { historyMs: 126 }]) {
      const failed = await simulatedBudget({ live: [sample, second] });
      assert.equal(failed.loads.live, 2);
      assert.ok(failed.checks.some(c => !c.ok));
    }
  }
  const cold = await simulatedBudget({ cold: [{ historyMs: 126 }, {}] });
  assert.equal(cold.loads.cold, 2);
  assert.ok(cold.checks.every(c => c.ok));
});

test('browser budget: reproduced patch/task breaches print both measurements before long attribution is truncated', async () => {
  const { checks } = await simulatedBudget({ live: [{ patchMs: 44.5, taskMs: 155 }, { patchMs: 42, taskMs: 140 }] });
  const failures = checks.filter(c => !c.ok);
  assert.equal(failures.length, 2);
  const messages = [], original = console.error;
  console.error = message => messages.push(message);
  try {
    const gate = createGate('unused');
    for (const c of failures) {
      assert.match(c.name, /; re-measured once after a breach\)/);
      assert.equal(c.detail.attemptRows.length, 2);
      // The real gate truncates JSON detail to 2400 characters. Simulate a
      // busy trace to ensure the concise measurements survive that boundary.
      gate.check('budget', c.name, c.ok, { ...c.detail, offendingTasks: [{ attribution: 'x'.repeat(4000) }] });
    }
  } finally { console.error = original; }
  assert.equal(messages.length, 2);
  for (const message of messages) {
    assert.match(message, /"measurements":\[\{"attempt":1,"patchMs":44\.5,"historyMs":10,"taskMs":155\},\{"attempt":2,"patchMs":42,"historyMs":10,"taskMs":140\}\]/);
  }
});

test('browser budget: 124.9 ms tasks pass and 125 ms tasks breach despite CI atMost render semantics', async () => {
  const clean = await simulatedBudget({ cold: [{ taskMs: 124.9, historyMs: 125 }], live: [{ taskMs: 124.9, patchMs: 40, historyMs: 125 }] });
  assert.ok(clean.checks.every(c => c.ok));
  assert.deepEqual(clean.loads, { cold: 1, live: 1 });
  assert.doesNotMatch(budgetTable(clean.traces, CI_GUARD), /re-measured/);
  const breach = await simulatedBudget({ cold: [{ taskMs: 125 }, { taskMs: 125 }], live: [{ taskMs: 125 }, { taskMs: 125 }] });
  assert.deepEqual(breach.loads, { cold: 2, live: 2 });
  assert.equal(breach.checks.filter(c => !c.ok && c.detail.failed.includes('taskBudget')).length, 2);
  const reference = await simulatedBudget({ cold: [{ taskMs: 50, historyMs: 50 }], live: [{ taskMs: 50, patchMs: 16, historyMs: 50 }], limits: REFERENCE_BUDGET });
  assert.deepEqual(reference.loads, { cold: 1, live: 1 });
  assert.ok(reference.checks.some(c => c.detail.failed.includes('patchBudget')));
  assert.ok(reference.checks.some(c => c.detail.failed.includes('renderBudget')));
  assert.ok(reference.checks.some(c => c.detail.failed.includes('taskBudget')));
});

test('browser budget: runBudget statically allows at most one re-measure per viewport and phase', () => {
  const source = runBudget.toString();
  const runner = source.slice(source.indexOf('const runViewport ='), source.indexOf('const full ='));
  assert.equal(runner.match(/await measure\(viewport\)/g).length, 2);
  assert.match(runner, /const second = decision\.remeasure \? await measure\(viewport\) : null/);
  assert.doesNotMatch(runner, /\bwhile\s*\(|runViewport\(/);
  assert.equal(source.match(/for \(const viewport of VIEWPORTS\) await runViewport\(viewport, measure(?:Cold|Live)\)/g).length, 2);
  assert.match(source, /const measureCold = async viewport => \{\s*const cold = await newBoard/);
  assert.match(source, /const measureLive = async viewport => \{\s*const b = await newBoard/);
});

test('browser budget: observer snapshots drain undelivered entries once, with attribution and optional frame support', () => {
  for (const hasFrames of [true, false]) {
    const observers = [];
    class Observer {
      static supportedEntryTypes = hasFrames ? ['longtask', 'long-animation-frame'] : ['longtask'];
      constructor(callback) { this.callback = callback; this.queued = []; observers.push(this); }
      observe(options) { this.options = options; }
      takeRecords() { return this.queued.splice(0); }
    }
    const window = {};
    // Execute the exact serialized browser payload without a browser or any
    // imported closure. Queue records without invoking their delivery callback.
    runInNewContext(`(${observeBudgetTasks.toString()})()`, { window, PerformanceObserver: Observer });
    const attribution = { name: 'unknown', containerType: 'window', containerId: '', containerName: '', containerSrc: '' };
    observers[0].queued.push({ startTime: 90, duration: 132, name: 'self', attribution: [attribution] });
    if (hasFrames) observers[1].queued.push({ startTime: 90, duration: 140, blockingDuration: 90,
      renderStart: 95, styleAndLayoutStart: 120, scripts: [{ invoker: 'Window.requestAnimationFrame', duration: 28, forcedStyleAndLayoutDuration: 2 }] });
    const snapshot = window.__budgetTasks.snapshot();
    assert.equal(snapshot.hasFrames, hasFrames);
    assert.equal(snapshot.tasks[0].duration, 132);
    assert.deepEqual({ ...snapshot.tasks[0].attribution[0] }, attribution);
    assert.equal(snapshot.frames.length, hasFrames ? 1 : 0);
    if (hasFrames) assert.equal(snapshot.frames[0].scripts[0].forcedStyleAndLayoutDuration, 2);
    assert.equal(window.__budgetTasks.snapshot().tasks.length, 1, 'drained entries are never duplicated');
    assert.deepEqual({ ...observers[0].options }, { type: 'longtask', buffered: true });
    observers[0].callback({ getEntries: () => [{ startTime: 450, duration: 125, name: 'self', attribution: [] }] });
    assert.equal(window.__budgetTasks.snapshot().tasks.length, 2, 'delivered entries are retained too');
  }
});
