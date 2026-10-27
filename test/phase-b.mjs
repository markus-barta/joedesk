import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateContract, CONTRACTS, REASONS } from '../contracts/index.mjs';
import { acceptSnapshot } from '../contracts/accept.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import { builders, htmlDocument } from './fixtures/preview-dom.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { atomicWrite } from '../server/storage.mjs';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { switchSetSnapshot } from '../scripts/browser/settings-fixtures.mjs';
import { scenario, NOW, at, advance } from '../scripts/browser/board.mjs';
const { heroLeft, positionsHtml, keptHtml, positionSectionReason, cellView, compactDesk } = await import('../public/joe/desk.js');
const { deskCard } = await builders('desk.js', ['deskCard']);
const { todayPercent, sincePercent } = await import('../public/joe/performance.js');
const { cellReason } = await import('../public/joe/health.js');
const { boardStates, NOT_EXACT_REASONS } = await import('../public/joe/board-state.js');

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url)));
const { exact, mixed } = read('phase-b');
const fields = ['equity', 'dayPnl', 'openPnl', 'totalPnl'];
const ingress = value => { const data = structuredClone(value); delete data.receivedAt; return data; };
const release33Store = file => {
  const stored = JSON.parse(readFileSync(file));
  for (const [name, cell] of Object.entries(stored.cells)) stored.cells[name] = {
    value: cell.value, valueReceivedAt: cell.valueReceivedAt,
  };
  writeFileSync(file, JSON.stringify(stored));
  return stored;
};
const context = data => {
  const feeds = { data: { value: data } }, now = data.receivedAt;
  return { feeds, now, states: panelStates(feeds, now) };
};
const rejects = (data, path, rule) => {
  const result = validateContract('data', data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.path === path && e.rule === rule), JSON.stringify(result.errors));
};

test('JOED-97 M1: replay the browser journey through the read model before asserting its Today wording', async t => {
  const dataDir = scratch('joed-97-journey-');
  t.after(() => discard(dataDir, 'JOED-97 journey replay'));
  let now = NOW;
  const model = createReadModel({ dataDir, clock: () => now, write: () => {} });
  const base = scenario(NOW).snapshot;
  assert.equal(model.accept(base).status, 200);
  const B = advance(base, at(NOW, 80), base.seq + 1);
  B.pnlSources.day.status = 'unavailable';
  for (const bag of [B.totals, ...B.desks.map(d => d.money)]) { bag.dayPnl = null; bag.reasons = { dayPnl: 'baseline_pending' }; }
  now = at(NOW, 80); assert.equal(model.accept(B).status, 200);
  const C = advance(B, at(NOW, 110), base.seq + 2);
  C.pnlSources.open.status = 'unavailable';
  for (const bag of [C.totals, ...C.desks.map(d => d.money)]) { bag.openPnl = null; bag.reasons = { dayPnl: 'baseline_pending', openPnl: 'open_pnl_unavailable' }; }
  C.desks[0].money.totalPnl = null; C.desks[0].money.reasons.totalPnl = 'retained_values';
  C.totals.totalPnl = null; C.totals.reasons.totalPnl = 'family_projection_unavailable';
  now = at(NOW, 110); assert.equal(model.accept(C).status, 200);
  now = at(NOW, 115);
  const view = model.view(), states = boardStates(view.feeds, now, view.panels), ctx = { feeds: view.feeds, now, states };
  const journey = readFileSync(new URL('../scripts/browser-p3.mjs', import.meta.url), 'utf8');
  const todayPattern = new RegExp(journey.match(/const today = \/(.+)\/, open = /)[1]);
  for (const id of ['j', 'joe', 'joel']) {
    const card = htmlDocument(deskCard(ctx, id, 50, true));
    const lines = card.querySelectorAll('.mini-label .st');
    const text = card.querySelector('.mini-label').textContent;
    assert.ok(text.startsWith('Today: unavailable · waiting on the start-of-day value'), text);
    assert.equal(states[`desks.${id}.dayPnl`].value, null);
    assert.equal(states[`desks.${id}.openPnl`].retained, true);
    assert.ok(todayPattern.test(lines[0].textContent), text);
  }
});

test('JOED-97 L2: first load of a release-33 store drops kept day/equity once, including behind a later outage', async t => {
  const dataDir = scratch('joed-97-upgrade-');
  t.after(() => discard(dataDir, 'JOED-97 upgrade store'));
  let now = exact.receivedAt;
  let model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(ingress(exact)).status, 200);
  const outage = ingress(exact); outage.seq++;
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(exact.receivedAt, 600);
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) for (const field of fields) {
    bag[field] = null; (bag.reasons ??= {})[field] = 'source_unavailable';
  }
  for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)]) for (const source of Object.values(sources)) {
    Object.assign(source, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  }
  assert.equal(model.accept(outage).status, 200);
  const file = join(dataDir, 'data-state.json'), stored = JSON.parse(readFileSync(file));
  // Release 33 wrote exactly these two keys: no reason or provenance exists
  // with which to distinguish an uncertain last-good from an exact one.
  for (const [name, cell] of Object.entries(stored.cells)) stored.cells[name] = {
    value: cell.value, valueReceivedAt: cell.valueReceivedAt,
  };
  writeFileSync(file, JSON.stringify(stored));
  model = createReadModel({ dataDir, clock: () => now });
  const cleared = Object.keys(stored.cells).filter(name => /\.(?:dayPnl|equity)$/.test(name));
  for (const name of cleared) assert.equal(model.panels()[name].value, null, name);
  assert.notEqual(model.panels()['desks.j.openPnl'].value, null, 'unrelated last-good survives upgrade');
  assert.notEqual(model.panels().paperAccount.value, null, 'account observation survives upgrade');
  const upgradedBytes = readFileSync(file, 'utf8'), upgraded = JSON.parse(upgradedBytes);
  assert.deepEqual(upgraded.feed, stored.feed, 'sequence and accepted snapshot are unchanged');
  for (const name of cleared) assert.equal(upgraded.cells[name].value, null, 'cleanup is persisted before another snapshot');
  model = createReadModel({ dataDir, clock: () => now });
  assert.equal(readFileSync(file, 'utf8'), upgradedBytes, 'second startup does not repeat the upgrade');
  for (const name of cleared) assert.equal(model.panels()[name].value, null, 'restart cannot recover the old cells');
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(exact.receivedAt, 1200); outage.seq++;
  assert.equal(model.accept(outage).status, 200);
  model = createReadModel({ dataDir, clock: () => now });
  for (const name of cleared) assert.equal(model.panels()[name].value, null, 'cleanup survives subsequent retention and restart');
  const recovery = ingress(exact); recovery.seq = outage.seq + 1;
  now = recovery.generatedAt = recovery.safety.gateway.checkedAt = at(exact.receivedAt, 1230);
  assert.equal(model.accept(recovery).status, 200);
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(exact.receivedAt, 1260); outage.seq = recovery.seq + 1;
  assert.equal(model.accept(outage).status, 200);
  const recoveredBytes = readFileSync(file, 'utf8');
  model = createReadModel({ dataDir, clock: () => now });
  assert.equal(readFileSync(file, 'utf8'), recoveredBytes, 'release-34 provenance prevents another cleanup');
  for (const name of cleared) assert.notEqual(model.panels()[name].value, null, 'new exact values retain normally after upgrade');
});

for (const committed of [false, true]) for (const code of ['ENOSPC', 'EACCES', undefined, null]) test(`JOED-97 fix3 L1: upgrade write failure (committed=${committed}, code=${code}) keeps the cleaned store and accepts snapshots`, async t => {
  const dataDir = scratch('joed-97-upgrade-write-');
  t.after(() => discard(dataDir, 'JOED-97 upgrade write failure'));
  let now = exact.receivedAt;
  let model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(ingress(exact)).status, 200);
  const outage = ingress(exact); outage.seq++;
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(now, 20);
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
    bag.dayPnl = bag.equity = null;
    bag.reasons = { dayPnl: 'source_unavailable', equity: 'source_unavailable' };
  }
  for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)]) {
    Object.assign(sources.day, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  }
  assert.equal(model.accept(outage).status, 200);
  const file = join(dataDir, 'data-state.json'), legacy = release33Store(file);
  const dropped = Object.keys(legacy.cells).filter(name => /\.(?:dayPnl|equity)$/.test(name));
  for (const name of dropped) assert.notEqual(legacy.cells[name].value, null, 'fixture has an older last-good');
  const logs = [], logger = t.mock.method(console, 'error', (...args) => logs.push(args));
  let writes = 0;
  model = createReadModel({ dataDir, clock: () => now, write: (...args) => {
    if (++writes === 1) {
      if (committed) atomicWrite(...args);
      if (code === null) throw null; // even a non-Error failure stays best effort
      throw Object.assign(new Error('private write detail must not be logged'), { committed, code });
    }
    return atomicWrite(...args);
  } });
  logger.mock.restore();
  assert.deepEqual(logs, [['read-model: upgrade_write_failed', code ?? 'unknown']], 'one value-free diagnostic with the error code, never the message or path');
  assert.deepEqual(model.view().feeds.data.value, legacy.feed.value, 'valid snapshot stays loaded');
  assert.equal(model.view().feeds.data.reason, null);
  for (const name of dropped) assert.equal(model.panels()[name].value, null, 'cleaned memory survives the failure');
  assert.deepEqual(model.panels()['desks.j.openPnl'].value, legacy.cells['desks.j.openPnl'].value);
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(now, 20); outage.seq++;
  assert.equal(model.accept(outage).status, 200, 'upgrade failure does not block acceptance');
  const persisted = JSON.parse(readFileSync(file));
  for (const name of dropped) assert.equal(persisted.cells[name].value, null, 'next acceptance persists the cleaned cells');
  model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.view().feeds.data.value.seq, outage.seq);
  for (const name of dropped) assert.equal(model.panels()[name].value, null, 'dropped cells stay gone after restart');
});

test('JOED-97 fix3 L2: legacy cleanup uses receipt identity independently of clock and gateway progress', async t => {
  const dataDir = scratch('joed-97-upgrade-receipts-');
  t.after(() => discard(dataDir, 'JOED-97 receipt cleanup'));
  let now = exact.receivedAt;
  const model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(ingress(exact)).status, 200);
  const skewed = ingress(exact); skewed.seq++;
  skewed.generatedAt = at(now, 1); // advancing producer, frozen gateway check
  now = at(now, 61);
  assert.equal(model.accept(skewed).status, 200);
  assert.equal(model.panels()['today.dayPnl'].reason, 'gateway_unconfirmed');
  assert.equal(model.panels()['today.dayPnl'].valueReceivedAt, exact.receivedAt);
  const file = join(dataDir, 'data-state.json'), legacy = release33Store(file);
  // A current observation must survive even if the boot clock is regressed
  // or a session problem would make the live selector call it retained.
  const current = 'desks.j.equity';
  legacy.cells[current].valueReceivedAt = legacy.feed.value.receivedAt;
  for (const bootTime of [exact.receivedAt, now, at(now, 3600)]) {
    writeFileSync(file, JSON.stringify(legacy));
    let clockCalls = 0;
    createReadModel({ dataDir, clock: () => { clockCalls++; return bootTime; } });
    assert.equal(clockCalls, 0, 'startup cleanup never consults the clock');
    const upgraded = JSON.parse(readFileSync(file));
    assert.deepEqual(upgraded.feed, legacy.feed);
    assert.deepEqual(upgraded.gatewayProgress, legacy.gatewayProgress);
    assert.deepEqual(upgraded.cells[current], legacy.cells[current], 'current receipt survives');
    for (const name of Object.keys(legacy.cells).filter(name => /\.(?:dayPnl|equity)$/.test(name) && name !== current)) {
      assert.equal(upgraded.cells[name].value, null, name);
      assert.equal(upgraded.cells[name].valueReceivedAt, null, name);
    }
    assert.deepEqual(upgraded.cells['desks.j.openPnl'], legacy.cells['desks.j.openPnl'], 'unrelated last-good survives');
  }
});

test('JOED-97 fix3 L2: upgrading a current legacy Today estimate preserves its source, date and next-outage mark', async t => {
  const dataDir = scratch('joed-97-upgrade-estimate-');
  t.after(() => discard(dataDir, 'JOED-97 legacy estimate'));
  const fixture = read('failures/b-session-open-estimate');
  let now = at(fixture.receivedAt, 5);
  let model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(fixture.payload).status, 200);
  const file = join(dataDir, 'data-state.json'), legacy = release33Store(file);
  model = createReadModel({ dataDir, clock: () => now });
  const upgraded = JSON.parse(readFileSync(file));
  for (const name of Object.keys(upgraded.cells).filter(name => name.endsWith('.dayPnl'))) {
    assert.deepEqual(upgraded.cells[name].value, legacy.cells[name].value);
    assert.equal(upgraded.cells[name].valueReceivedAt, now);
    assert.equal(upgraded.cells[name].valueObservedAt, fixture.payload.pnlSources.day.observedAt);
    assert.deepEqual(upgraded.cells[name].valueSource, fixture.payload.pnlSources.day);
  }
  const outage = structuredClone(fixture.payload); outage.seq++;
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(now, 20);
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
    bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = 'source_unavailable';
  }
  Object.assign(outage.pnlSources.day, { status: 'unavailable', observedAt: null, reason: 'source_unavailable' });
  assert.equal(model.accept(outage).status, 200);
  model = createReadModel({ dataDir, clock: () => now });
  const view = model.view(), ctx = { feeds: view.feeds, now, states: boardStates(view.feeds, now, view.panels) };
  for (const id of ['j', 'joe', 'joel']) {
    const cell = ctx.states[`desks.${id}.dayPnl`];
    assert.equal(cell.retained, true);
    assert.equal(cell.valueObservedAt, fixture.payload.pnlSources.day.observedAt);
    assert.deepEqual(cell.valueSource, fixture.payload.pnlSources.day);
    for (const html of [deskCard(ctx, id, 50, true), compactDesk(ctx, id)]) {
      assert.equal(htmlDocument(html).querySelectorAll('.estimate-mark').length, 1);
    }
  }
});

test('JOED-97 L4: retained estimates keep their original source and mark through outage and restart, until expiry or exact recovery', async t => {
  const dataDir = scratch('joed-97-estimate-');
  t.after(() => discard(dataDir, 'JOED-97 estimate store'));
  const fixture = read('failures/b-session-open-estimate');
  let now = fixture.receivedAt;
  let model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(fixture.payload).status, 200);
  const outage = structuredClone(fixture.payload); outage.seq++;
  now = outage.generatedAt = outage.safety.gateway.checkedAt = at(fixture.receivedAt, 20);
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
    bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = 'source_unavailable';
  }
  Object.assign(outage.pnlSources.day, { status: 'unavailable', observedAt: null, reason: 'source_unavailable' });
  assert.equal(model.accept(outage).status, 200);
  model = createReadModel({ dataDir, clock: () => now });
  const render = () => {
    const view = model.view();
    return { feeds: view.feeds, now, states: boardStates(view.feeds, now, view.panels) };
  };
  for (const id of ['j', 'joe', 'joel']) {
    const ctx = render();
    assert.equal(ctx.states[`desks.${id}.dayPnl`].retained, true);
    assert.deepEqual(ctx.states[`desks.${id}.dayPnl`].valueSource, fixture.payload.pnlSources.day);
    for (const html of [deskCard(ctx, id, 50, true), compactDesk(ctx, id)]) assert.equal(htmlDocument(html).querySelectorAll('.estimate-mark').length, 1);
  }
  now = at(fixture.receivedAt, 3600);
  assert.equal(htmlDocument(compactDesk(render(), 'j')).querySelectorAll('.estimate-mark').length, 0, 'expired estimate is a dash');
  const recovery = ingress(exact); recovery.seq = outage.seq + 1;
  recovery.generatedAt = recovery.safety.gateway.checkedAt = now;
  assert.equal(model.accept(recovery).status, 200);
  assert.equal(htmlDocument(compactDesk(render(), 'j')).querySelectorAll('.estimate-mark').length, 0, 'exact recovery clears the mark');
  assert.notEqual(render().states['desks.j.dayPnl'].value, null);
});

for (const reason of NOT_EXACT_REASONS) test(`JOED-98 ${reason}: uncertain observations clear durable last-good, with and without an older exact value`, async t => {
  const dataDir = scratch('joed-98-');
  t.after(() => discard(dataDir, 'JOED-98 unit store'));
  let now = exact.receivedAt, seq = exact.seq;
  let model = createReadModel({ dataDir, clock: () => now });
  const names = ['paperAccount', 'paperCash', ...fields.flatMap(field => [`today.${field}`, ...['j', 'joe', 'joel'].map(id => `desks.${id}.${field}`)])];
  function push(data, seconds) {
    now = new Date(Date.parse(exact.receivedAt) + seconds * 1000).toISOString();
    const payload = ingress(data); payload.seq = ++seq;
    payload.generatedAt = payload.safety.gateway.checkedAt = now;
    const accepted = model.accept(payload);
    assert.equal(accepted.status, 200, JSON.stringify(accepted));
  }
  const unsure = structuredClone(exact);
  unsure.brokerAccount.reason = reason; unsure.brokerAccount.reasons = { cash: reason };
  for (const bag of [unsure.totals, ...unsure.desks.map(d => d.money)]) {
    bag.reasons = Object.fromEntries(fields.map(f => [f, reason]));
    // Rev 10 already rejects value + these three reasons in money bags.
    // The rev-9 reasons still allow values, the latent JOED-93 failure.
    if (['sod_missing', 'ledger_unreconciled', 'position_stale'].includes(reason)) for (const field of fields) bag[field] = null;
  }
  if (unsure.totals.dayPnl == null) for (const sources of [unsure.pnlSources, ...unsure.desks.map(d => d.pnlSources)]) {
    for (const source of Object.values(sources)) Object.assign(source, { status: 'unavailable', method: null, observedAt: null, reason });
  }
  const outage = structuredClone(exact);
  outage.brokerAccount.equity = outage.brokerAccount.cash = null;
  outage.brokerAccount.reason = 'source_unavailable'; outage.brokerAccount.reasons = { cash: 'source_unavailable' };
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) for (const field of fields) {
    bag[field] = null; (bag.reasons ??= {})[field] = 'source_unavailable';
  }
  for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)]) for (const source of Object.values(sources)) {
    Object.assign(source, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  }
  for (const start of [0, 1200]) {
    if (start) push(exact, start); // exact → unsure → outage, as well as cold unsure → outage
    push(unsure, start + 10);
    const stored = JSON.parse(readFileSync(join(dataDir, 'data-state.json')));
    for (const name of names) assert.deepEqual(stored.cells[name], { value: null, valueReceivedAt: null,
      ...(name.endsWith('.dayPnl') ? { valueObservedAt: null, valueSource: null } : {}) }, name);
    model = createReadModel({ dataDir, clock: () => now });
    push(outage, start + 610);
    for (const m of [model, createReadModel({ dataDir, clock: () => now })]) {
      const view = m.view(), shown = boardStates(view.feeds, now, view.panels);
      for (const name of names) {
        assert.equal(view.panels[name].value, null, name);
        assert.equal(shown[name].value, null, name);
        assert.equal(shown[name].retained, false, name);
        assert.equal(shown[name].reason, 'source_unavailable', name);
      }
    }
  }
  push(exact, 2400); push(outage, 3000);
  const view = model.view(), shown = boardStates(view.feeds, now, view.panels);
  for (const name of ['paperAccount', 'paperCash', 'desks.j.equity', 'desks.j.dayPnl']) {
    assert.notEqual(shown[name].value, null, name);
    assert.equal(shown[name].retained, true, name);
    assert.match(cellView(shown[name]).caption, /Last good value.*10\smin ago/);
  }
});

test('JOED-94: durable Today observation dates survive later receipts, outages and restart across NY midnight', async t => {
  const dataDir = scratch('joed-94-');
  t.after(() => discard(dataDir, 'JOED-94 unit store'));
  const before = '2026-10-15T03:59:50.000Z', after = '2026-10-15T04:00:10.000Z';
  let now = before;
  const model = createReadModel({ dataDir, clock: () => now });
  const first = ingress(exact); first.generatedAt = first.safety.gateway.checkedAt = before;
  for (const sources of [first.pnlSources, ...first.desks.map(d => d.pnlSources)]) sources.day.observedAt = before;
  assert.equal(model.accept(first).status, 200);
  // A late receipt with the original observation cannot move Today into tomorrow.
  now = after; const late = structuredClone(first); late.seq++; late.generatedAt = late.safety.gateway.checkedAt = after;
  assert.equal(model.accept(late).status, 200);
  const outage = structuredClone(late); outage.seq++;
  for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
    bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = 'source_unavailable';
  }
  for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)]) {
    Object.assign(sources.day, { status: 'unavailable', method: null, observedAt: null, reason: 'source_unavailable' });
  }
  assert.equal(model.accept(outage).status, 200);
  const restarted = createReadModel({ dataDir, clock: () => now });
  for (const m of [model, restarted]) {
    const view = m.view(), states = boardStates(view.feeds, now, view.panels);
    for (const id of ['j', 'joe', 'joel']) {
      const name = `desks.${id}.dayPnl`;
      assert.equal(view.panels[name].valueObservedAt, before);
      assert.equal(view.panels[name].retained, true, 'contract retention stays unchanged');
      assert.equal(states[name].value, null, 'board rejects the previous NY day');
      assert.equal(states[name].reason, 'source_unavailable');
      assert.notEqual(states[`desks.${id}.totalPnl`].value, null, 'Since start remains current');
    }
  }
});

test('JOED-98: scoped source exactness still clears last-good when a bag reason masks it', async t => {
  const dataDir = scratch('joed-98-source-');
  t.after(() => discard(dataDir, 'JOED-98 scoped source store'));
  let now = exact.receivedAt;
  const model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(ingress(exact)).status, 200);
  const unsure = ingress(exact); unsure.seq++;
  now = unsure.generatedAt = unsure.safety.gateway.checkedAt = '2026-10-14T17:42:32.000Z';
  for (const bag of [unsure.totals, ...unsure.desks.map(d => d.money)]) (bag.reasons ??= {}).dayPnl = 'source_unavailable';
  for (const sources of [unsure.pnlSources, ...unsure.desks.map(d => d.pnlSources)]) sources.day.reason = 'not_exact_yet';
  assert.equal(model.accept(unsure).status, 200);
  const stored = JSON.parse(readFileSync(join(dataDir, 'data-state.json')));
  const states = boardStates(model.feeds(), now, model.panels());
  for (const name of ['today.dayPnl', ...['j', 'joe', 'joel'].map(id => `desks.${id}.dayPnl`)]) {
    assert.equal(stored.cells[name].value, null);
    assert.equal(states[name].value, null);
  }
});

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
  assert.match(positions.textContent, /\$\s*20,01/);
  assert.match(positions.textContent, /\$\s*40,01/);
  assert.match(positions.textContent, /\+\$\s*5,01/);
  const kept = htmlDocument(keptHtml(ctx));
  assert.equal(kept.querySelectorAll('[data-keep]').length, 2);
  for (const row of kept.querySelectorAll('[data-keep]')) assert.equal(row.querySelectorAll('button, a, input, [tabindex]').length, 0);
});

test('JOED-97 fix4: detail sizing counts the displayed signed amount, including grouping and rounding', () => {
  for (const [amount, digits] of [['150', 9], ['-1234567.895', 15], ['0', 6], [null, 1]]) {
    const data = structuredClone(exact);
    data.desks[0].money.totalPnl = amount === null ? null : { amount, currency: 'EUR' };
    if (amount === null) data.desks[0].money.reasons = { totalPnl: 'source_unavailable' };
    const doc = htmlDocument(deskCard(context(data), 'j', 50, false));
    const value = doc.querySelectorAll('.dnums .v')[2];
    assert.equal(value.getAttribute('style'), `--digits:${digits}`, `width budget for ${amount}`);
    assert.equal(value.querySelectorAll('.bn').length, 1);
  }
});

test('position and KEEP money round exact decimal units once, including signed ties and large amounts', () => {
  for (const [amount, expected, signed] of [
    ['1.00500000', '$ 1,01', '+$ 1,01'],
    ['-1.00500000', '−$ 1,01', '−$ 1,01'],
    ['1.00499999', '$ 1,00', '+$ 1,00'],
    ['-1.00499999', '−$ 1,00', '−$ 1,00'],
    ['1.00500001', '$ 1,01', '+$ 1,01'],
    ['0.00499999', '$ 0,00', '$ 0,00'],
    ['-0.00499999', '$ 0,00', '$ 0,00'],
    ['0.00500000', '$ 0,01', '+$ 0,01'],
    ['-0.00500000', '−$ 0,01', '−$ 0,01'],
    ['9007199254740993.00500000', '$ 9.007.199.254.740.993,01', '+$ 9.007.199.254.740.993,01'],
    ['-9007199254740993.00500000', '−$ 9.007.199.254.740.993,01', '−$ 9.007.199.254.740.993,01'],
  ]) {
    const data = structuredClone(exact);
    const row = data.positions.rows[0], keep = data.positions.rows.find(r => r.symbol === 'TSLA');
    for (const field of ['mark', 'marketValue', 'openPnl']) row[field] = { amount, currency: 'USD' };
    for (const field of ['mark', 'marketValue']) keep[field] = { amount, currency: 'USD' };
    data.brokerAccount.equity.amount = amount;
    assert.equal(validateContract('data', data).ok, true, amount);
    const ctx = context(data), position = htmlDocument(positionsHtml(ctx).html).querySelector('[data-desk="j"]');
    assert.equal(position.querySelector('.c-px').textContent, expected, amount);
    assert.equal(position.querySelector('.c-worth .num').textContent, expected, amount);
    assert.equal(position.querySelector('.pl').textContent, signed, amount);
    assert.ok(position.querySelector('.position-mobile').textContent.includes(`last price ${expected} · worth ${expected}`));
    if (signed === '$ 0,00') assert.equal(position.querySelector('.pl .i'), null, 'rounded zero has no arrow');
    const kept = htmlDocument(keptHtml(ctx)), holding = kept.querySelector('[data-keep="TSLA"]');
    assert.equal(holding.querySelector('.c-px').textContent, expected, amount);
    assert.equal(holding.querySelector('.c-worth').textContent, expected, amount);
    assert.ok(holding.querySelector('.position-mobile').textContent.includes(`Worth ${expected}`));
    assert.ok(kept.querySelector('.pstate').textContent.includes(expected), amount);
    assert.ok(kept.querySelector('.keep-cap').textContent.includes(expected.replace('$', '€')), amount);
  }
});

test('KEEP worth sums full precision per currency before rounding, including cancellation', () => {
  for (const [amounts, expected] of [
    [['0.50249999', '0.50250001'], '€ 1,01'],
    [['0.004', '0.004'], '€ 0,01'],
    [['-0.50249999', '-0.50250001'], '−€ 1,01'],
    [['9007199254740993.00500000', '-9007199254740992'], '€ 1,01'],
  ]) {
    const data = structuredClone(exact);
    data.positions.rows.filter(r => r.scope === 'keep').forEach((row, i) => {
      for (const field of ['mark', 'marketValue']) row[field] = { amount: amounts[i], currency: 'EUR' };
    });
    assert.equal(validateContract('data', data).ok, true);
    for (const [state, reason] of [['fresh', null], ['stale', 'snapshot_stale'], ['broken', 'snapshot_stale'], ['broken', 'source_unavailable']]) {
      const ctx = context(data);
      Object.assign(ctx.states.kept, { state, reason, ageSeconds: 90 });
      const prefix = state === 'fresh' ? 'Worth' : 'worth';
      const worth = htmlDocument(keptHtml(ctx)).querySelector('.pstate').textContent;
      if (reason === 'snapshot_stale') {
        assert.match(worth, /worth —/);
        assert.ok(!worth.includes(expected), `${state}: stale worth is withheld`);
      } else assert.ok(worth.includes(`${prefix} ${expected}`), `${state}: ${amounts.join(' + ')}`);
    }
  }
});

test('position worth bars use exact magnitudes on independent native-currency scales', () => {
  for (const [amounts, widths] of [
    [['9007199254740993.00500000', '-4503599627370496.50250000'], ['100', '50']],
    [['0.00000001', '-0.00000003'], ['33.333', '100']],
    [['0', '0'], [null, null]],
  ]) {
    const data = structuredClone(exact);
    data.positions.rows.filter(r => r.desk).forEach((row, i) => { row.marketValue.amount = amounts[i]; });
    const rows = htmlDocument(positionsHtml(context(data)).html).querySelectorAll('.prow[data-desk]');
    rows.forEach((row, i) => {
      const bar = row.querySelector('.vbar i');
      if (widths[i] === null) assert.equal(bar, null);
      else {
        assert.equal(bar.getAttribute('style'), `width:${widths[i]}%`);
        assert.equal(bar.dataset.v, amounts[i], 'data attribute preserves the source decimal');
      }
    });
    data.positions.rows[1].mark.currency = data.positions.rows[1].marketValue.currency = data.positions.rows[1].openPnl.currency = 'EUR';
    for (const row of htmlDocument(positionsHtml(context(data)).html).querySelectorAll('.prow[data-desk]')) {
      assert.equal(row.querySelector('.vbar i')?.getAttribute('style') ?? null, widths[0] === null ? null : 'width:100%');
    }
  }
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
  assert.match(positions.textContent, /\$\s*40,01/, 'fresh callbacks remain exact beside the stale row');
});
