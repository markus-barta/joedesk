// JOED-132: accepted synthetic holdings through the actual board and renderers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { validateContract } from '../contracts/index.mjs';

const { boardStates } = await import('../public/joe/board-state.js');
const { positionsHtml, keptHtml, renderDesk } = await import('../public/joe/desk.js');
const { resultsView } = await import('../public/joe/results.js');
const { indexResults } = await import('../public/joe/results-model.js');
const { quantity } = await import('../public/joe/format.js');
const { dayContent, dayNote } = await builders('results.js', ['dayContent', 'dayNote']);
const read = file => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url)));
const ALL = ['j', 'joe', 'joel'], DAY = '2026-10-14';
function snapshot(q = '1') {
  const data = read('phase-b.json').exact;
  const row = data.positions.rows.find(p => p.scope === 'stage0');
  row.quantity = q;
  row.openedAt = `${DAY}T15:00:00.000Z`;
  data.positions.rows = [row];
  if (q != null && /^-?0(?:\.0+)?$/.test(q)) {
    for (const field of ['marketValue', 'dayPnl', 'openPnl']) if (row[field]) row[field].amount = '0';
  }
  return data;
}
function context(data, reason = null, seconds = 0) {
  const checked = validateContract('data', data);
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  const now = new Date(Date.parse(data.receivedAt) + seconds * 1000).toISOString();
  const feeds = { data: { value: data, reason } }, states = boardStates(feeds, now);
  const record = read('results/empty.json');
  record.receivedAt = record.generatedAt = data.receivedAt;
  assert.ok(validateContract('results', record).ok);
  states.results = { state: 'fresh', value: { index: indexResults(record) }, reason: null };
  return { feeds, states, now };
}
const notes = ctx => {
  const day = dayContent(resultsView(ctx), DAY, ALL);
  return [false, true].map(phone => htmlDocument(dayNote(day, phone)).textContent);
};

// Run the real markup updates through the title, stopping at the later viewport
// disclosure pass. Chart/geometry work is outside this browser-free regression.
function deskTitle(ctx) {
  const before = { document: globalThis.document, matchMedia: globalThis.matchMedia };
  const nodes = new Map(), stop = new Error('markup captured');
  const sink = key => {
    if (!nodes.has(key)) nodes.set(key, { innerHTML: '', textContent: '', dataset: {},
      querySelectorAll: () => [], querySelector: selector => sink(`${key} ${selector}`) });
    return nodes.get(key);
  };
  globalThis.document = { querySelector: sink, activeElement: null };
  globalThis.matchMedia = () => { throw stop; };
  try { assert.throws(() => renderDesk(ctx), error => error === stop); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
  return sink('#positionsTitle').textContent;
}

test('JOED-132 zero: actual Desk title follows the same open eligibility as its list', () => {
  assert.equal(deskTitle(context(snapshot('0'))), 'Positions · 0 open');
  assert.equal(deskTitle(context(snapshot('0.00000001'))), 'Positions · 1 open');
});

test('JOED-132 zero: confirmed decimal zero is absent from open counts, rows and both Results notes', () => {
  for (const q of ['0', '-0', '0.00000000', '-0.00000000']) {
    const ctx = context(snapshot(q)), rendered = positionsHtml(ctx);
    assert.match(rendered.sub, /^0 open/, q);
    const doc = htmlDocument(rendered.html);
    assert.equal(doc.querySelector('.prow:not(.hd)'), null, q);
    assert.match(doc.textContent, /No open positions\./);
    for (const note of notes(ctx)) assert.equal(note, '', q);
  }
});

test('JOED-132 zero: mixed lists retain unknown and smallest nonzero quantities with honest counts', () => {
  const data = snapshot('0'), base = structuredClone(data.positions.rows[0]);
  data.positions.rows.push({ ...structuredClone(base), symbol: 'TINY', quantity: '0.00000001' },
    { ...structuredClone(base), symbol: 'SHORT', quantity: '-0.00000001', side: 'short' },
    { ...structuredClone(base), symbol: 'UNKNOWN', quantity: null, reasons: { quantity: 'source_unavailable' } });
  const ctx = context(data), rendered = positionsHtml(ctx), doc = htmlDocument(rendered.html);
  assert.match(rendered.sub, /^3 open/);
  assert.equal(doc.querySelectorAll('.prow:not(.hd)').length, 3);
  assert.match(doc.textContent, /TINY/);
  assert.match(doc.textContent, /SHORT/);
  assert.match(doc.textContent, /UNKNOWN/);
  assert.doesNotMatch(doc.textContent, /Long 0(?:\s|$)/);
  const unknown = htmlDocument(positionsHtml(context({ ...data, positions: { ...data.positions,
    rows: [data.positions.rows.at(-1)] } })).html);
  assert.match(unknown.textContent, /Quantity: not reported/);
  const unknownCtx = context({ ...data, positions: { ...data.positions, rows: [data.positions.rows.at(-1)] } });
  for (const note of notes(unknownCtx)) assert.equal(note, '', 'unknown quantity is no verified current contribution');
});

test('JOED-132 retained: Results withholds current holding claims on retained and stopped-feed observations', () => {
  const data = snapshot(), fresh = context(data);
  for (const note of notes(fresh)) assert.match(note, /is still open; it counts as Still open and on Desk/);
  for (const [reason, seconds] of [['refresh_failed', 90], [null, 90], [null, 301], ['refresh_failed', 3600]]) {
    const ctx = context(data, reason, seconds);
    assert.ok(ctx.states.positions.retained || ctx.states.positions.reason === 'snapshot_stale' || ctx.states.positions.value === null);
    for (const note of notes(ctx)) assert.equal(note, '', `${reason} at ${seconds}s`);
  }
  // Recovery may reuse the row identities: the current eligibility must recover too.
  for (const note of notes(fresh)) assert.match(note, /is still open/);
});

test('JOED-132 scope: legacy and kept holdings never claim a desk Results contribution', () => {
  for (const scope of ['legacy', 'keep']) {
    const data = snapshot();
    data.positions.rows[0].scope = scope;
    if (scope === 'keep') data.positions.rows[0].desk = null;
    const ctx = context(data);
    for (const note of notes(ctx)) assert.equal(note, '', scope);
  }
  // A current KEEP policy also excludes an old desk-tagged observation.
  const ctx = context(snapshot());
  const policy = read('valid.json')['fleet-config'];
  policy.desks.keep.push(ctx.states.positions.value[0].symbol);
  assert.ok(validateContract('fleet-config', policy).ok);
  ctx.feeds['fleet-config'] = { value: policy };
  for (const note of notes(ctx)) assert.equal(note, '', 'accepted KEEP policy');
});

test('JOED-132 quantity: exact accepted decimals share one display across Desk, KEEP and Results', () => {
  for (const [q, expected] of [
    ['9007199254740993', '9.007.199.254.740.993'],
    ['999999999999.99999999', '999.999.999.999,99999999'],
    ['1000000000.00000001', '1.000.000.000,00000001'],
    ['1234.50000000', '1.234,50000000'],
    ['-1234.00000001', '−1.234,00000001'],
    ['0.00000001', '0,00000001'],
  ]) {
    const data = read('phase-b.json').exact;
    for (const row of data.positions.rows) row.quantity = q;
    const ctx = context(data);
    assert.equal(quantity(q), expected);
    const desk = htmlDocument(positionsHtml(ctx).html), kept = htmlDocument(keptHtml(ctx));
    for (const node of [...desk.querySelectorAll('.c-side:not(.sub)'), ...desk.querySelectorAll('.position-mobile'),
      ...kept.querySelectorAll('.c-side'), ...kept.querySelectorAll('.position-summary')]) {
      assert.ok(node.textContent.includes(expected), node.textContent);
    }
    const record = read('results/exact-decimals.json');
    // Closed trade quantities are positive; short direction is a separate field.
    record.trades[0].quantity = q.replace(/^-/, '');
    if (q.startsWith('-')) record.trades[0].side = 'short';
    const valid = validateContract('results', record);
    assert.ok(valid.ok, JSON.stringify(valid.errors));
    ctx.states.results.value.index = indexResults(record);
    const day = dayContent(resultsView(ctx), record.trades[0].closedAt.slice(0, 10), ALL);
    const result = htmlDocument(day.body).querySelector(`[data-trade="${record.trades[0].id}"] .meta`);
    assert.ok(result.textContent.includes(expected.replace(/^−/, '')), result.textContent);
  }
});
