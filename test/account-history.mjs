import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { scratch, discard } from '../scripts/browser/scratch.mjs';
import { createReadModel } from '../server/read-model.mjs';
import { atomicWrite } from '../server/storage.mjs';
import { CONTRACTS, validateContract } from '../contracts/index.mjs';
import { panelStates } from '../contracts/panel-state.mjs';
import './fixtures/preview-dom.mjs';
import { historyPoint, compactPoints, boundHistory, historyEnvelope, measureHistory, HISTORY_CAP, HISTORY_WARNING } from '../server/history.mjs';
import { accountObservation, validAccountObservation, appendAccountHistory, emptyAccountHistory, compactAccountPoints,
  validateAccountHistory, ACCOUNT_HISTORY_FORMAT, ACCOUNT_HISTORY_CAP, appendAccountClose, emptyAccountCloses,
  validateAccountCloses, accountClosesEnvelope, ACCOUNT_CLOSES_CAP, ACCOUNT_CLOSES_DAYS } from '../server/account-history.mjs';
import { viennaDay } from '../time.mjs';

const { basisKey } = await import('../public/joe/history-model.js');

const samples = JSON.parse(readFileSync(new URL('../fixtures/valid.json', import.meta.url)));
const T0 = '2026-10-24T21:59:59.000Z';
const eur = amount => ({ amount, currency: 'EUR' });
const at = seconds => new Date(Date.parse(T0) + seconds * 1000).toISOString();
function snapshot(seq = 101, t = T0) {
  const value = structuredClone(samples.data); delete value.receivedAt;
  value.seq = seq; value.generatedAt = value.safety.gateway.checkedAt = t;
  value.brokerAccount.observedAt = t; value.brokerAccount.cash = eur('100.00000001');
  return value;
}
function deskPoint(value = snapshot(), previous = {}) {
  const received = { ...value, receivedAt: value.generatedAt };
  return historyPoint(received, panelStates({ data: { value: received } }, received.receivedAt, previous));
}
function point(value = snapshot(), previous = {}) {
  const received = { ...value, receivedAt: value.generatedAt };
  return appendAccountHistory(emptyAccountHistory(), received,
    panelStates({ data: { value: received } }, received.receivedAt, previous), received.receivedAt).points[0];
}
function setup(t, options = {}) {
  const dataDir = options.dataDir ?? scratch('joed-150-account-');
  if (!options.dataDir) t.after(() => discard(dataDir, 'JOED-150 account history'));
  const model = createReadModel({ dataDir, clock: () => T0, ...options });
  return { dataDir, model };
}
const accountAt = (t, equity = eur('1'), cash = eur('0')) => ({ observedAt: t, equity, cash,
  ...(equity === null || cash === null ? { reasons: { ...(equity === null ? { equity: 'source_unavailable' } : {}),
    ...(cash === null ? { cash: 'source_unavailable' } : {}) } } : {}) });

test('account series preserves exact EUR lexemes, including zero/negative cash and large amounts', () => {
  for (const amount of ['0', '-0.00000001', '9007199254740993.12345678']) {
    const value = snapshot(); value.brokerAccount.equity = value.brokerAccount.cash = eur(amount);
    assert.deepEqual(point(value).account, { observedAt: T0, equity: eur(amount), cash: eur(amount) });
    assert.equal(validAccountObservation(point(value).account), true);
  }
});

test('account gaps keep independent reasons, never retained values or desk sums', () => {
  const value = snapshot();
  value.brokerAccount.equity = null; value.brokerAccount.reason = 'source_unavailable';
  const p = point(value, { paperAccount: { value: eur('999'), valueReceivedAt: at(-20) } });
  assert.equal(p.account.equity, null); assert.deepEqual(p.account.cash, eur('100.00000001'));
  assert.deepEqual(p.account.reasons, { equity: 'source_unavailable' });
  value.brokerAccount.equity = eur('999'); value.brokerAccount.reason = 'retained_values';
  value.brokerAccount.cash = null; value.brokerAccount.reasons = { cash: 'upstream_lost' };
  assert.deepEqual(point(value).account.reasons, { equity: 'retained_values', cash: 'upstream_lost' });
  assert.equal(point(value).account.equity, null);
  delete value.brokerAccount;
  assert.deepEqual(point(value).account, { observedAt: null, equity: null, cash: null,
    reasons: { equity: 'source_unavailable', cash: 'source_unavailable' } });
});

test('older feed without cash is not recorded as zero; a stale/session-blocked selector cannot record money', () => {
  const value = snapshot(); delete value.brokerAccount.cash;
  assert.equal(point(value).account.cash, null);
  assert.equal(point(value).account.reasons.cash, 'source_unavailable');
  const received = { ...snapshot(), receivedAt: T0 };
  const states = panelStates({ data: { value: received } }, at(60));
  assert.deepEqual(accountObservation(received, states).reasons, { equity: 'snapshot_stale', cash: 'snapshot_stale' });
  received.safety.gateway = { apiSessionReady: false, checkedAt: T0, reason: 'gateway_down' };
  assert.deepEqual(point(received).account.reasons, { equity: 'gateway_down', cash: 'gateway_down' });
});

test('future account timestamps are unavailable rather than poisoning daily close ordering', () => {
  const value = snapshot(); value.brokerAccount.observedAt = at(1);
  assert.deepEqual(point(value).account.reasons, { equity: 'clock_ahead', cash: 'clock_ahead' });
});

test('desk fields match the pre-account golden including null reasons and composite basis identity', () => {
  const value = snapshot();
  value.desks[0].accounting = { periodStart: at(-100), method: 'execution-fifo-net-current-fx', detail: 'Synthetic accounting' };
  const p = deskPoint(value), desk = p;
  const money = (equity, pnl) => ({ equity: eur(equity), dayPnl: eur(pnl), openPnl: eur('0'), totalPnl: eur(pnl) });
  const golden = { t: T0, desks: {
    j: { money: money('4999', '-1'), accounting: value.desks[0].accounting, historyBasis: 'j.paper.v2' },
    joe: { money: money('5000', '0'), historyBasis: 'joe.paper.v2' },
    joel: { money: money('5000', '0'), historyBasis: 'joel.paper.v2' },
  }, totals: money('14999', '-1') };
  assert.equal(JSON.stringify(desk), JSON.stringify(golden), 'unchanged desk bytes and field order');
  assert.equal(basisKey(p.desks.j), JSON.stringify(['j.paper.v2', at(-100), 'execution-fifo-net-current-fx']));
  const received = { ...value, receivedAt: T0 }, states = panelStates({ data: { value: received } }, T0);
  states['desks.j.equity'] = { value: eur('4999'), state: 'broken', retained: true, reason: 'upstream_lost' };
  const gap = historyPoint(received, states);
  golden.desks.j.money.equity = golden.totals.equity = null;
  golden.desks.j.money.reasons = { equity: 'upstream_lost' };
  golden.totals.reasons = { equity: 'family_projection_unavailable' };
  assert.deepEqual(gap, golden);
});

function compactFixture() {
  return Array.from({ length: 512 }, (_, i) => {
    const p = structuredClone(samples.history.points[0]); p.t = at(i);
    if (i === 31 || i === 32) p.desks.j.money.equity = eur(i === 31 ? '-100' : '90000');
    if (i >= 47 && i <= 49) p.desks.j.money.equity = null;
    if (i >= 80) p.desks.j.historyBasis = 'synthetic.new-basis';
    if (i >= 120) p.desks.j.accounting = { periodStart: at(120), method: 'execution-fifo-net-current-fx', detail: 'Synthetic' };
    return p;
  });
}

test('desk compaction retains the pre-account golden bytes and indices', () => {
  const deskKept = compactPoints(compactFixture());
  const digest = createHash('sha256').update(JSON.stringify(deskKept)).digest('hex');
  // Captured from the original compactPoints at base commit 6f89e38.
  assert.equal(digest, '02c28fef756f44c8ab15d1c385f59904b1c46188906e3861d01128e7f03eaf33');
});

test('desk compaction timing and size count only the original v2 desk envelope', () => {
  const p = deskPoint();
  const make = count => ({ schema: CONTRACTS.contracts.history, seq: 1, generatedAt: at(10000), receivedAt: at(10000), sizeBytes: 0,
    points: Array.from({ length: count }, (_, i) => ({ ...p, t: at(i) })) });
  // Independently measure the original v2 envelope to locate its size trigger.
  const originalBytes = value => {
    let bytes;
    do { bytes = value.sizeBytes; value.sizeBytes = Buffer.byteLength(JSON.stringify({ format: 'joedesk.history-store.v2', value })); }
    while (value.sizeBytes !== bytes);
    return bytes;
  };
  let low = 1, high = 10000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (originalBytes(make(mid)) >= HISTORY_WARNING) high = mid; else low = mid + 1;
  }
  const before = make(low - 1), after = make(low);
  const expectedBytes = originalBytes(before);
  boundHistory(before); boundHistory(after);
  assert.equal(before.points.length, low - 1);
  assert.equal(before.compactedThrough, undefined);
  assert.equal(before.sizeBytes, expectedBytes);
  assert.deepEqual(after.points, compactPoints(make(low).points));
  assert.equal(after.compactedThrough, at(low - 1));
  const abovePointCap = make(10001); boundHistory(abovePointCap);
  assert.ok(abovePointCap.points.length < 10001);
});

test('account compaction is bounded independently and preserves account extrema and gap edges', () => {
  const points = Array.from({ length: 10001 }, (_, i) => ({ t: at(i), account: accountAt(at(i)) }));
  points[31].account.equity = eur('-100'); points[32].account.equity = eur('90000');
  points[47].account = accountAt(at(47), null);
  const selected = compactAccountPoints(points);
  for (const i of [0, 31, 32, 46, 47, 48, 10000]) assert.ok(selected.includes(points[i]));
  const previous = { ...emptyAccountHistory(), generatedAt: at(10000), receivedAt: at(10000), points: points.slice(0, -1) };
  const value = snapshot(102, at(10000));
  const next = appendAccountHistory(previous, value, panelStates({ data: { value } }, value.generatedAt), value.generatedAt);
  assert.ok(next.points.length < 10001);
  assert.equal(validateAccountHistory(next), next);
  assert.ok(Buffer.byteLength(JSON.stringify({ format: ACCOUNT_HISTORY_FORMAT, value: next })) < ACCOUNT_HISTORY_CAP);
  assert.deepEqual(next.points[0], points[0]);
});

test('legacy desk file remains v2 with no account extensions; account series starts independently', t => {
  const { dataDir } = setup(t);
  const legacy = { ...structuredClone(samples.history), sizeBytes: 0 }; measureHistory(legacy);
  const file = join(dataDir, 'history-state.json');
  atomicWrite(file, historyEnvelope(legacy), HISTORY_CAP);
  const original = readFileSync(file, 'utf8');
  const model = createReadModel({ dataDir, clock: () => T0 });
  assert.deepEqual(model.feeds().history.value, legacy);
  assert.deepEqual(model.accountHistory().points, []);
  assert.equal(readFileSync(file, 'utf8'), original, 'load leaves old disk bytes untouched');
  assert.equal(model.accept(snapshot()).status, 200);
  const bytes = readFileSync(file), stored = JSON.parse(bytes);
  assert.equal(stored.format, 'joedesk.history-store.v2');
  assert.ok(stored.value.points.every(p => !Object.hasOwn(p, 'account')));
  assert.equal(stored.value.sizeBytes, bytes.length);
  assert.deepEqual(model.feeds().history.value, stored.value);
  const golden = { schema: legacy.schema, seq: legacy.seq + 1, generatedAt: T0, receivedAt: T0,
    points: [...legacy.points, deskPoint()], sizeBytes: 0 };
  measureHistory(golden);
  assert.equal(bytes.toString(), JSON.stringify({ format: 'joedesk.history-store.v2', value: golden }), 'stored desk file matches original shape, version and bytes');
  assert.deepEqual(model.accountHistory().points, [point()]);
  const short = JSON.parse(readFileSync(join(dataDir, 'account-history-state.json')));
  assert.equal(short.format, ACCOUNT_HISTORY_FORMAT);
  const restarted = createReadModel({ dataDir, clock: () => T0 });
  assert.deepEqual(restarted.accountHistory(), model.accountHistory());
  assert.equal(validateContract('history', restarted.feeds().history.value).ok, true);
});

test('daily store keeps the last exact field with its own timestamp and does not fill missing days', () => {
  let closes = appendAccountClose(emptyAccountCloses(), T0, accountAt(T0));
  closes = appendAccountClose(closes, at(0.5), accountAt(at(0.5), null, eur('-2.00000001')));
  assert.deepEqual(closes.days[0], { day: '2026-10-24', t: at(0.5), equity: eur('1'), cash: eur('-2.00000001'), equityAt: T0, cashAt: at(0.5) });
  assert.equal(appendAccountClose(closes, at(0.7), accountAt(at(0.7), null, null)), closes);
  closes = appendAccountClose(closes, at(1), accountAt(at(1), eur('2'), null));
  assert.deepEqual(closes.days[1], { day: '2026-10-25', t: at(1), equity: eur('2'), cash: null, equityAt: at(1), cashAt: null });
  const later = '2026-10-28T12:00:00.000Z';
  closes = appendAccountClose(closes, later, accountAt(later));
  assert.deepEqual(closes.days.map(d => d.day), ['2026-10-24', '2026-10-25', '2026-10-28']);
  assert.equal(appendAccountClose(closes, T0, accountAt(T0)), closes);
  assert.equal(appendAccountClose(closes, later, accountAt(later, eur('999'))), closes);
});

test('Vienna daily closes survive repeated DST hours, spring-forward and NY/Vienna mismatches', () => {
  for (const [times, days] of [
    [['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'], ['2026-10-25']],
    [['2027-03-28T00:30:00.000Z', '2027-03-28T01:30:00.000Z'], ['2027-03-28']],
    [['2026-10-24T21:59:59.000Z', '2026-10-24T22:00:00.000Z'], ['2026-10-24', '2026-10-25']],
    [['2026-12-31T22:59:59.000Z', '2026-12-31T23:00:00.000Z'], ['2026-12-31', '2027-01-01']],
  ]) {
    let value = emptyAccountCloses();
    for (const t of times) value = appendAccountClose(value, t, accountAt(t));
    assert.deepEqual(value.days.map(d => d.day), days);
    assert.equal(value.days.at(-1).t, times.at(-1));
  }
});

test('late account observations advance each field independently without regressing newer closes', () => {
  let value = appendAccountClose(emptyAccountCloses(), T0, accountAt(T0));
  value = appendAccountClose(value, at(0.8), accountAt(at(0.8), null, eur('8')));
  value = appendAccountClose(value, at(0.5), accountAt(at(0.5), eur('5'), eur('5')));
  assert.equal(value.days[0].equityAt, at(0.5)); assert.deepEqual(value.days[0].equity, eur('5'));
  assert.equal(value.days[0].cashAt, at(0.8)); assert.deepEqual(value.days[0].cash, eur('8'));
  assert.equal(value.days[0].t, at(0.8));
  value = appendAccountClose(value, at(1), accountAt(at(1)));
  value = appendAccountClose(value, at(0.9), accountAt(at(0.9), eur('9'), null));
  assert.equal(value.days[0].equityAt, at(0.9)); assert.equal(value.days[1].equityAt, at(1));
});

test('daily closes persist with mode 0600, survive restart and the 14-day short-history cut', t => {
  const { dataDir } = setup(t); let now = T0;
  let model = createReadModel({ dataDir, clock: () => now });
  assert.equal(model.accept(snapshot()).accountClosesReason, null);
  const file = join(dataDir, 'account-closes-state.json');
  const stored = JSON.parse(readFileSync(file));
  const { reason, ...closes } = model.accountHistory().dailyCloses;
  assert.deepEqual(stored, accountClosesEnvelope(closes));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readdirSync(dataDir).some(name => name.endsWith('.next')));
  model = createReadModel({ dataDir, clock: () => now });
  const original = model.accountHistory().dailyCloses.days[0];
  now = at(15 * 86400);
  assert.equal(model.accept(snapshot(102, now)).status, 200);
  assert.deepEqual(model.feeds().history.value.points.map(p => p.t), [now]);
  assert.deepEqual(model.accountHistory().points.map(p => p.t), [now]);
  assert.deepEqual(model.accountHistory().dailyCloses.days[0], original);
  assert.equal(model.accountHistory().dailyCloses.days.length, 2);
  assert.deepEqual(createReadModel({ dataDir, clock: () => now }).accountHistory(), model.accountHistory());
});

test('daily close uses the actual account observation day, not a new transport day', t => {
  let now = T0; const { dataDir } = setup(t);
  const model = createReadModel({ dataDir, clock: () => now });
  model.accept(snapshot());
  const file = join(dataDir, 'account-closes-state.json'), original = readFileSync(file, 'utf8');
  now = at(1); const value = snapshot(102, now); value.brokerAccount.observedAt = T0;
  assert.equal(model.accept(value).status, 200);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(model.accountHistory().dailyCloses.days.length, 1);
  assert.equal(model.accountHistory().points.at(-1).account.observedAt, T0);
});

for (const [name, format, cap] of [
  ['account-closes-state.json', 'joedesk.account-closes-store.v1', ACCOUNT_CLOSES_CAP],
  ['account-history-state.json', ACCOUNT_HISTORY_FORMAT, ACCOUNT_HISTORY_CAP],
]) {
  const series = model => name.startsWith('account-closes') ? model.accountHistory().dailyCloses : model.accountHistory();
  const length = view => (view.days ?? view.points).length;
  test(`${name}: damaged bytes survive the next write and discontinuity survives restart`, t => {
    for (const body of [null, '{', JSON.stringify({ format: 'wrong' }),
      JSON.stringify({ format, value: { invalid: true } }), ' '.repeat(cap + 1)]) {
      const { dataDir } = setup(t), file = join(dataDir, name);
      if (body !== null) writeFileSync(file, body);
      let model = createReadModel({ dataDir, clock: () => T0 });
      assert.equal(length(series(model)), 0);
      assert.equal(series(model).reason, body === null ? 'feed_not_received' : 'contract_invalid');
      if (body !== null) assert.equal(readFileSync(file, 'utf8'), body);
      assert.equal(model.accept(snapshot()).status, 200);
      assert.equal(length(series(model)), 1);
      assert.equal(series(model).reason, body === null ? null : 'contract_invalid');
      if (body !== null) {
        const marker = series(model).discontinuity;
        assert.equal(marker.at, T0); assert.equal(marker.reason, 'contract_invalid');
        assert.equal(readFileSync(join(dataDir, marker.preservedAs), 'utf8'), body);
        assert.deepEqual(JSON.parse(readFileSync(file)).discontinuity, marker);
      }
      const before = series(model);
      model = createReadModel({ dataDir, clock: () => at(1) });
      assert.deepEqual(series(model), before);
      assert.equal(model.accept(snapshot(102, at(1))).status, 200);
      assert.equal(series(model).reason, body === null ? null : 'contract_invalid');
      assert.deepEqual(series(model).discontinuity, before.discontinuity);
    }
  });

  test(`${name}: future versions are read-only and never overwritten or moved`, t => {
    for (const version of [2, 10, 100]) {
      const { dataDir } = setup(t), file = join(dataDir, name);
      const body = JSON.stringify({ format: format.replace(/v1$/, `v${version}`), value: { future: true },
        ...(version === 100 ? { padding: ' '.repeat(cap) } : {}) });
      writeFileSync(file, body);
      for (let i = 0; i < 2; i++) {
        const model = createReadModel({ dataDir, clock: () => at(i) });
        assert.equal(series(model).reason, 'store_version_unsupported');
        assert.equal(model.accept(snapshot(101 + i, at(i))).status, 200);
        assert.equal(series(model).reason, 'store_version_unsupported');
        assert.equal(readFileSync(file, 'utf8'), body);
        assert.equal(length(series(model)), 0);
        assert.equal(model.feeds().history.reason, null);
      }
      assert.ok(!readdirSync(dataDir).some(n => n.startsWith(name + '.')));
    }
  });

  test(`${name}: recovery journal survives interruption after preserving damaged bytes`, t => {
    const { dataDir } = setup(t), file = join(dataDir, name), body = '{';
    writeFileSync(file, body);
    const model = createReadModel({ dataDir, clock: () => T0, write: (target, ...args) => {
      if (target === file) throw new Error('synthetic recovery interruption');
      atomicWrite(target, ...args);
    } });
    assert.equal(model.accept(snapshot()).status, 200);
    assert.equal(series(model).reason, 'history_write_failed');
    const marker = series(model).discontinuity;
    assert.equal(readFileSync(join(dataDir, marker.preservedAs), 'utf8'), body);
    const restarted = createReadModel({ dataDir, clock: () => at(1) });
    assert.equal(series(restarted).reason, 'contract_invalid');
    assert.deepEqual(series(restarted).discontinuity, marker);
    assert.equal(restarted.accept(snapshot(102, at(1))).status, 200);
    assert.equal(series(restarted).reason, 'contract_invalid');
    assert.deepEqual(series(restarted).discontinuity, marker);
  });

  test(`${name}: failed preservation journal cannot overwrite damaged bytes`, t => {
    const { dataDir } = setup(t), file = join(dataDir, name), body = '{';
    writeFileSync(file, body);
    const model = createReadModel({ dataDir, clock: () => T0, write: (target, ...args) => {
      if (target === `${file}.discontinuity.json`) throw new Error('synthetic journal failure');
      atomicWrite(target, ...args);
    } });
    assert.equal(model.accept(snapshot()).status, 200);
    assert.equal(series(model).reason, 'history_write_failed');
    assert.equal(readFileSync(file, 'utf8'), body);
    assert.equal(model.feeds().history.reason, null);
  });
}

for (const committed of [false, true]) test(`short account write failure is independent (committed=${committed})`, t => {
  let now = T0, fail = false;
  const { dataDir } = setup(t);
  const model = createReadModel({ dataDir, clock: () => now, write: (file, ...args) => {
    if (fail && basename(file) === 'account-history-state.json') {
      if (committed) atomicWrite(file, ...args);
      throw Object.assign(new Error('synthetic short write failure'), { committed });
    }
    atomicWrite(file, ...args);
  } });
  model.accept(snapshot()); fail = true; now = at(1);
  assert.equal(model.accept(snapshot(102, now)).status, 200);
  assert.equal(model.accountHistory().reason, 'history_write_failed');
  assert.equal(model.accountHistory().points.length, committed ? 2 : 1);
  assert.equal(model.accountHistory().dailyCloses.days.length, 2);
  assert.equal(model.feeds().history.value.points.length, 2);
  assert.equal(model.feeds().history.reason, null);
  fail = false; now = at(2);
  model.accept(snapshot(103, now));
  assert.equal(model.accountHistory().reason, null);
});

test('daily store bounds more than five years even with every calendar day recorded', t => {
  const start = Date.parse('2020-01-01T12:00:00.000Z');
  const days = Array.from({ length: ACCOUNT_CLOSES_DAYS }, (_, i) => {
    const t = new Date(start + i * 86400000).toISOString();
    return { day: viennaDay(t), t, equity: eur('9007199254740993.12345678'), cash: eur('-0.00000001'), equityAt: t, cashAt: t };
  });
  let value = validateAccountCloses({ ...emptyAccountCloses(), days });
  const next = new Date(start + ACCOUNT_CLOSES_DAYS * 86400000).toISOString();
  value = appendAccountClose(value, next, accountAt(next));
  assert.equal(value.days.length, ACCOUNT_CLOSES_DAYS); assert.equal(value.days[0].day, days[1].day);
  assert.ok(Date.parse(value.days.at(-1).t) - Date.parse(value.days[0].t) > 5 * 366 * 86400000);
  assert.ok(Buffer.byteLength(JSON.stringify(accountClosesEnvelope(value))) < ACCOUNT_CLOSES_CAP);
  const { dataDir } = setup(t);
  atomicWrite(join(dataDir, 'account-closes-state.json'), accountClosesEnvelope(value), ACCOUNT_CLOSES_CAP);
  assert.deepEqual(createReadModel({ dataDir }).accountHistory().dailyCloses.days, value.days);
});

test('invalid daily/account shapes fail closed, including duplicate dates and unreasoned or non-EUR money', () => {
  const value = appendAccountClose(emptyAccountCloses(), T0, accountAt(T0));
  for (const mutate of [
    v => v.days.push(v.days[0]), v => { v.days[0].equity.currency = 'USD'; },
    v => { v.days[0].equity.amount = 1; }, v => { v.days[0].cashAt = at(1); },
    v => { v.days[0].day = '2026-10-25'; }, v => { v.days[0].extra = true; },
  ]) {
    const damaged = structuredClone(value); mutate(damaged);
    assert.throws(() => validateAccountCloses(damaged), /contract_invalid/);
  }
  for (const account of [{ equity: null, cash: null }, { ...accountAt(T0), equity: eur('1e3') },
    { ...accountAt(T0), equity: { amount: '1', currency: 'USD' } }]) assert.equal(validAccountObservation(account), false);
});

for (const committed of [false, true]) test(`daily write failure is independent and reports an honest reason (committed=${committed})`, t => {
  let now = T0, fail = false;
  const { dataDir } = setup(t);
  const model = createReadModel({ dataDir, clock: () => now, write: (file, ...args) => {
    if (fail && basename(file) === 'account-closes-state.json') {
      if (committed) atomicWrite(file, ...args);
      throw Object.assign(new Error('synthetic write failure'), { committed });
    }
    atomicWrite(file, ...args);
  } });
  model.accept(snapshot()); fail = true; now = at(0.5);
  const value = snapshot(102, now); value.brokerAccount.equity = eur('2');
  assert.equal(model.accept(value).accountClosesReason, 'history_write_failed');
  assert.equal(model.feeds().history.reason, null); assert.equal(model.feeds().data.value.seq, 102);
  assert.equal(model.accountHistory().dailyCloses.days[0].equity.amount, committed ? '2' : '28000');
  assert.equal(model.accountHistory().dailyCloses.reason, 'history_write_failed');
  fail = false; now = at(0.7);
  assert.equal(model.accept(snapshot(103, now)).accountClosesReason, null);
});

test('desk-history corruption cannot prevent independent short account and daily recording', t => {
  const { dataDir } = setup(t);
  writeFileSync(join(dataDir, 'history-state.json'), '{');
  const model = createReadModel({ dataDir, clock: () => T0 });
  assert.equal(model.accept(snapshot()).status, 200);
  assert.equal(model.feeds().history.reason, 'history_write_failed');
  assert.equal(model.accountHistory().reason, null);
  assert.equal(model.accountHistory().points.length, 1);
  assert.equal(model.accountHistory().dailyCloses.days.length, 1);
  assert.equal(readFileSync(join(dataDir, 'history-state.json'), 'utf8'), '{');
});

test('corrupt short account store recovers without affecting desk history or daily closes', t => {
  const { dataDir, model } = setup(t); model.accept(snapshot());
  const file = join(dataDir, 'account-history-state.json');
  const stored = JSON.parse(readFileSync(file));
  stored.value.points[0].account.cash.currency = 'USD';
  writeFileSync(file, JSON.stringify(stored));
  const before = readFileSync(file, 'utf8');
  const restarted = createReadModel({ dataDir, clock: () => at(1) });
  assert.equal(restarted.accountHistory().reason, 'contract_invalid');
  assert.equal(restarted.feeds().history.reason, null);
  assert.deepEqual(restarted.accountHistory().points, []);
  assert.equal(restarted.accept(snapshot(102, at(1))).status, 200);
  assert.equal(readFileSync(join(dataDir, restarted.accountHistory().discontinuity.preservedAs), 'utf8'), before);
  assert.equal(restarted.accountHistory().dailyCloses.days.length, 2);
  assert.equal(restarted.feeds().history.value.points.length, 2);
});

test('replays, frozen generations and rejected ingress do not write history or daily closes', t => {
  let now = T0; const writes = [];
  const { dataDir } = setup(t);
  const model = createReadModel({ dataDir, clock: () => now, write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  assert.equal(model.accept(snapshot()).status, 200); writes.length = 0;
  assert.equal(model.accept(snapshot()).status, 422); assert.deepEqual(writes, []);
  now = at(20); assert.equal(model.accept(snapshot(102)).status, 200);
  assert.ok(!writes.includes('history-state.json') && !writes.includes('account-closes-state.json') && !writes.includes('account-history-state.json'));
  writes.length = 0;
  const bad = snapshot(103, now); bad.mode = 'LIVE';
  assert.equal(model.accept(bad).status, 422);
  assert.ok(writes.every(file => file === 'feed-rejections.json'));
});
