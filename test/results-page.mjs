// Exercise the actual Results renderer and controls with extreme-year clocks.
// RESULTS_PAGE_PARENT=1 replays these assertions against d848cd0, in memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';

const root = new URL('../', import.meta.url);
const moduleUrl = file => new URL(`public/joe/${file}`, root);
function sourceModule(file, revision, modelUrl) {
  const url = moduleUrl(file);
  const source = revision ? execFileSync('git', ['show', `${revision}:public/joe/${file}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(url, 'utf8');
  const absolute = source.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) => {
    const target = specifier === './results-model.js' && modelUrl ? modelUrl
      : new URL(specifier === './time.mjs' || specifier.startsWith('./contracts/') ? `../../${specifier.slice(2)}` : specifier, url).href;
    return `from ${JSON.stringify(target)}`;
  });
  return `data:text/javascript,${encodeURIComponent(absolute)}`;
}
async function loadPage(revision) {
  const modelUrl = sourceModule('results-model.js', revision);
  return { page: await import(sourceModule('results.js', revision, modelUrl)), model: await import(modelUrl) };
}
const { page, model: M } = await loadPage(process.env.RESULTS_PAGE_PARENT === '1' ? 'd848cd0' : null);
const ALL = ['j', 'joe', 'joel'];
const rollover = '9999-12-31T23:30:00.000Z';
const fixture = JSON.parse(readFileSync(new URL('fixtures/results/exact-decimals.json', root), 'utf8'));
function record(date, closedAt, { partial = false, trackingStart = date, net = '7' } = {}) {
  const trade = structuredClone(fixture.trades[0]);
  Object.assign(trade, { id: 'rt-page-date', desk: 'j', symbol: 'KO', openedAt: closedAt, closedAt,
    grossEur: { amount: net, currency: 'EUR' }, netEur: { amount: net, currency: 'EUR' }, feesEur: { amount: '0', currency: 'EUR' } });
  trade.fx.observedAt = closedAt;
  const day = structuredClone(fixture.days[0]);
  Object.assign(day, { date, ...(partial ? { coverage: 'partial', partialReasons: ['capture_gap'] } : {}) });
  for (const id of ALL) Object.assign(day.desks[id], { trades: id === 'j' ? 1 : 0,
    realisedNet: { amount: id === 'j' ? net : '0', currency: 'EUR' }, fees: { amount: '0', currency: 'EUR' } });
  return { ...fixture, trackingStart, days: [day], trades: [trade] };
}
function context(value, now) {
  const ix = M.indexResults(value);
  return { now, states: { results: { state: 'fresh', value: { index: ix } } }, feeds: {} };
}
function capture(t, target = page) {
  const before = globalThis.document, state = { ...target.RS }, nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', clientWidth: 0, clientHeight: 0,
      querySelector: () => null, querySelectorAll: () => [] });
    return nodes.get(id);
  };
  globalThis.document = { querySelector: node, querySelectorAll: () => [], activeElement: null };
  Object.assign(target.RS, { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false });
  target.forgetResults();
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (before === undefined) delete globalThis.document;
    else globalThis.document = before;
    Object.assign(target.RS, state);
    target.forgetResults();
  };
  t.after(restore);
  const dom = id => htmlDocument(node(id).innerHTML);
  return { node, dom, restore, cell: date => dom('#cal').querySelector(`[data-day="${date}"]`) };
}
function select(date, period = 'week') {
  Object.assign(page.RS, { period, anchor: date, sel: date, cal: M.ymOf(date), moved: true });
}

for (const [date, now] of [['0000-01-01', '0000-01-01T12:00:00.000Z'], ['0999-06-15', '0999-06-15T10:00:00.000Z']]) {
  test(`JOED-168 page: ${date} today, day rollup, trade list and calendar share the canonical key`, t => {
    const c = capture(t), ctx = context(record(date, now), now);
    page.choosePeriod('day', page.resultsView(ctx));
    page.renderResults(ctx);
    assert.equal(page.resultsToday(now), date);
    assert.equal(page.RS.sel, date);
    assert.equal(c.dom('#daypanel').querySelectorAll('.trow').length, 1);
    assert.equal(c.dom('#tiles').querySelector('[data-tile="trades"] .tval').textContent, '1');
    assert.match(c.cell(date).getAttribute('aria-label'), /1\u00a0trade/);
    assert.equal(c.cell(date).getAttribute('aria-pressed'), 'true');
  });
}

for (const [date, instant, clock] of [
  ['0000-01-01', '0000-01-01T12:00:00.000Z', '13:05'],
  ['0999-06-15', '0999-06-15T10:00:00.000Z', '11:05'],
  ['10000-01-01', rollover, '00:30'],
]) {
  test(`JOED-168 page: Day trade closing at ${instant} shows ${clock}`, t => {
    const c = capture(t), ctx = context(record(date, instant), instant);
    select(date, 'day');
    page.renderResults(ctx);
    const rows = c.dom('#daypanel').querySelectorAll('.trow');
    assert.equal(rows.length, 1);
    const closed = rows[0].querySelectorAll('.meta-unit').find(unit => unit.textContent.startsWith('closed '));
    assert.equal(closed?.textContent, `closed ${clock} ·`);
  });
}

test('JOED-168 page: rollover renders December 31 as past, in-period, with its boundary-week amount', t => {
  const c = capture(t), ctx = context(record('9999-12-31', '9999-12-31T12:00:00.000Z'), rollover);
  assert.equal(page.resultsToday(rollover), '10000-01-01');
  select('9999-12-31');
  page.renderResults(ctx);
  assert.equal(c.cell('9999-12-31').getAttribute('disabled'), null);
  assert.equal(c.cell('9999-12-31').classList.contains('fut'), false);
  assert.equal(c.cell('9999-12-31').classList.contains('inper'), true);
  const week = c.dom('#cal').querySelectorAll('.wk').find(w => w.getAttribute('aria-label').includes('27'));
  assert.match(week.textContent, /1\u00a0day.*\+7,00/);
  assert.equal(c.node('#nextMonth').disabled, false);
});

test('JOED-168 page: expanded-year day cells show 15 and future cells stay disabled', t => {
  const c = capture(t), ctx = context(record('9999-12-31', '9999-12-31T12:00:00.000Z'), rollover);
  page.renderResults(ctx);
  const future = c.cell('10000-01-15');
  assert.equal(future.querySelector('.grid-date').textContent, '15');
  assert.equal(future.classList.contains('fut'), true);
  assert.notEqual(future.getAttribute('disabled'), null);
  assert.equal(c.cell('10000-01-01').classList.contains('today'), true);
  assert.equal(c.node('#prevMonth').disabled, false);
  assert.equal(c.node('#nextMonth').disabled, true);
});

test('JOED-168 page: Next and Prev traverse the year boundary and stop at today and the tracking floor', t => {
  const c = capture(t), ctx = context(record('9999-12-31', '9999-12-31T12:00:00.000Z', { trackingStart: '9999-12-01' }), rollover);
  const view = page.resultsView(ctx);
  select('9999-12-20');
  page.renderResults(ctx);
  assert.equal(c.node('#nextPer').disabled, false);
  assert.equal(c.node('#prevPer').disabled, false);
  page.stepPeriod(1, view);
  assert.equal(page.RS.sel, '9999-12-27');
  page.renderResults(ctx);
  assert.equal(c.node('#nextPer').disabled, true);
  page.stepPeriod(-1, view);
  assert.equal(page.RS.sel, '9999-12-20');
  select('9999-08-01');
  page.renderResults(ctx);
  assert.equal(c.node('#prevPer').disabled, true);
});

test('JOED-168 page: YTD replaces selected year 1000 with year 10000', t => {
  capture(t);
  select('1000-06-15');
  page.choosePeriod('ytd', { today: page.resultsToday(rollover) });
  assert.equal(page.RS.anchor, '10000-01-01');
  assert.equal(page.RS.sel, '10000-01-01');
  assert.deepEqual(page.RS.cal, [10000, 0]);
  assert.equal(M.periodOf(page.RS.period, page.RS.anchor, '10000-01-01').start, '10000-01-01');
});

test('JOED-168 page: selectDay accepts past December 31 and rejects future dates and dates before tracking', t => {
  capture(t);
  const view = { today: page.resultsToday(rollover), trackingStart: '9999-12-01' };
  assert.equal(page.selectDay('9999-12-31', view), true);
  assert.equal(page.RS.sel, '9999-12-31');
  assert.equal(page.selectDay('10000-01-02', view), false);
  assert.equal(page.selectDay('9999-07-31', view), false);
  assert.equal(page.RS.sel, '9999-12-31');
});

test('JOED-168 page: immediate route applies past December 31 against year-10000 today', t => {
  capture(t);
  assert.equal(page.applyResultsRoute('date=9999-12-31', { today: page.resultsToday(rollover), trackingStart: '9999-12-01' }), true);
  assert.equal(page.RS.sel, '9999-12-31');
  assert.equal(page.RS.anchor, '9999-12-31');
});

test('JOED-168 page: pending route settles to December 31 when the authoritative clock arrives', t => {
  capture(t);
  const view = page.resultsView(context(record('9999-12-31', '9999-12-31T12:00:00.000Z'), rollover));
  assert.equal(page.requestResultsRoute('date=9999-12-31'), true);
  assert.equal(page.settleResultsRoute({ ...view, clock: false }), false);
  assert.equal(page.settleResultsRoute(view), true);
  assert.equal(page.RS.sel, '9999-12-31');
  assert.equal(page.resultsRoutePending(), false);
});

test('JOED-168 page: emitted expanded-year URL restores its selected date', t => {
  capture(t);
  const view = { today: page.resultsToday(rollover), trackingStart: '9999-12-01' };
  select('10000-01-01', 'day');
  const query = page.resultsUrl(view).split('?')[1];
  select('9999-12-31');
  assert.equal(page.applyResultsRoute(query, view), true);
  assert.equal(page.RS.sel, '10000-01-01');
});

test('JOED-168 page: December 31 partial warning survives the expanded-year boundary', t => {
  const c = capture(t), ctx = context(record('9999-12-31', '9999-12-31T12:00:00.000Z', { partial: true }), rollover);
  select('9999-12-31');
  page.renderResults(ctx);
  assert.equal(c.cell('9999-12-31').classList.contains('day-incomplete'), true);
  assert.match(c.cell('9999-12-31').textContent, /Partial/);
  assert.match(c.cell('9999-12-31').getAttribute('aria-label'), /Partial: this day's record is incomplete/);
  ctx.now = '+010000-01-02T12:00:00.000Z';
  page.renderResults(ctx);
  assert.match(c.cell('9999-12-31').getAttribute('aria-label'), /Stale: still incomplete/);
});

test('JOED-168 page: modern renderer output and controls remain byte-identical to d848cd0', t => {
  // Frozen from the actual d848cd0 renderer with these same inputs. Normal
  // unit runs need no Git history; parent replay independently verifies pins.
  const expected = {
    day: 'a52f0bba46d56e76543a4c38cd40962828cbe74a40ef57707d2766082727b622',
    week: 'acaa7be3de3280ff3af8e66fcaf476d715f33ab398404cf2c8119716102e57bd',
    month: '91de4427876251a19ac9a30d29d08bef0de4ec1ca946aab2b9e160f552dc5307',
    ytd: '86e5531639b753086b7c9dfc0ff45c0442f7cd9d29614b7cf9782f0dce260335',
    all: '18a9de118a2f111c25fc9d809dfbd38a15cd111f775e8099bf5cab8a70ddc7be',
  };
  for (const period of ['day', 'week', 'month', 'ytd', 'all']) {
    const c = capture(t);
    select('2026-10-14', period);
    const value = record('2026-10-14', '2026-10-14T12:00:00.000Z', { trackingStart: '2026-10-01' });
    const url = page.renderResults(context(value, '2026-10-14T17:42:22.000Z'));
    const output = { url, html: ['#rheroL', '#tiles', '#breakdown', '#cal', '#daypanel', '#curveLegend', '#perLabel', '#calSum'].map(id => c.node(id).innerHTML),
      disabled: ['#prevPer', '#nextPer', '#prevMonth', '#nextMonth'].map(id => c.node(id).disabled) };
    assert.equal(createHash('sha256').update(JSON.stringify(output)).digest('hex'), expected[period], period);
    c.restore();
  }
});
