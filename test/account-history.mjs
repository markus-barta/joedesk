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
import { historyPoint, compactPoints, boundHistory, historyEnvelope, deskHistory, measureHistory, HISTORY_CAP } from '../server/history.mjs';
import { accountObservation, validAccountObservation, appendAccountClose, emptyAccountCloses,
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
function point(value = snapshot(), previous = {}) {
  const received = { ...value, receivedAt: value.generatedAt };
  return historyPoint(received, panelStates({ data: { value: received } }, received.receivedAt, previous));
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
  const p = point(value), { account, ...desk } = p;
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
  assert.deepEqual(deskHistory({ points: [gap] }).points[0], golden);
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

test('compaction keeps complete account observations at exactly the golden desk indices', () => {
  const legacy = compactFixture();
  const enriched = legacy.map((p, i) => ({ ...p, account: accountAt(p.t, i % 5 ? eur(String(i)) : null, eur(String(-i))) }));
  const kept = compactPoints(enriched), deskKept = compactPoints(legacy);
  assert.deepEqual(kept.map(p => p.t), deskKept.map(p => p.t));
  for (const p of kept) assert.equal(p, enriched.find(original => original.t === p.t));
  assert.deepEqual(deskHistory({ points: kept }).points, deskKept);
  const digest = createHash('sha256').update(JSON.stringify(deskKept)).digest('hex');
  // Captured from the original compactPoints at base commit 6f89e38.
  assert.equal(digest, '02c28fef756f44c8ab15d1c385f59904b1c46188906e3861d01128e7f03eaf33');
});

test('automatic compaction bounds enriched history and keeps its account timestamps aligned', () => {
  const p = point();
  const value = { schema: CONTRACTS.contracts.history, seq: 1, generatedAt: at(10000), receivedAt: at(10000), sizeBytes: 0,
    points: Array.from({ length: 10001 }, (_, i) => ({ ...p, t: at(i), account: accountAt(at(i)) })) };
  boundHistory(value);
  assert.ok(value.points.length < 10001);
  assert.ok(value.points.every(p => p.account.observedAt === p.t));
  assert.equal(value.sizeBytes, Buffer.byteLength(JSON.stringify(historyEnvelope(value))));
  assert.equal(validateContract('history', deskHistory(value)).ok, true);
});

test('legacy desk-only store loads without fabricating account observations and upgrades on new ingress', t => {
  const { dataDir } = setup(t);
  const legacy = { ...structuredClone(samples.history), sizeBytes: 0 }; measureHistory(legacy);
  atomicWrite(join(dataDir, 'history-state.json'), historyEnvelope(legacy), HISTORY_CAP);
  const model = createReadModel({ dataDir, clock: () => T0 });
  assert.deepEqual(model.feeds().history.value, legacy);
  assert.ok(model.accountHistory().points.every(p => !Object.hasOwn(p, 'account')));
  assert.equal(model.accept(snapshot()).status, 200);
  const stored = JSON.parse(readFileSync(join(dataDir, 'history-state.json')));
  assert.equal(stored.format, 'joedesk.history-store.v3');
  assert.ok(!Object.hasOwn(stored.value.points[0], 'account'));
  assert.deepEqual(stored.value.points.at(-1).account, point().account);
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

test('missing/corrupt/oversized daily files start empty with reasons and recover on an exact observation', t => {
  for (const body of [null, '{', JSON.stringify({ format: 'wrong' }),
    JSON.stringify(accountClosesEnvelope({ ...emptyAccountCloses(), days: [{ day: 'bad' }] })), ' '.repeat(ACCOUNT_CLOSES_CAP + 1)]) {
    const { dataDir } = setup(t);
    const file = join(dataDir, 'account-closes-state.json');
    if (body !== null) writeFileSync(file, body);
    const model = createReadModel({ dataDir, clock: () => T0 });
    assert.deepEqual(model.accountHistory().dailyCloses.days, []);
    assert.equal(model.accountHistory().dailyCloses.reason, body === null ? 'feed_not_received' : 'contract_invalid');
    if (body !== null) assert.equal(readFileSync(file, 'utf8'), body, 'read does not overwrite damaged store');
    assert.equal(model.accept(snapshot()).status, 200);
    assert.equal(model.accountHistory().dailyCloses.reason, null);
    assert.equal(model.accountHistory().dailyCloses.days.length, 1);
  }
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

test('short-history corruption cannot prevent independent daily recording', t => {
  const { dataDir } = setup(t);
  writeFileSync(join(dataDir, 'history-state.json'), '{');
  const model = createReadModel({ dataDir, clock: () => T0 });
  assert.equal(model.accept(snapshot()).status, 200);
  assert.equal(model.accountHistory().reason, 'history_write_failed');
  assert.equal(model.accountHistory().dailyCloses.days.length, 1);
  assert.equal(readFileSync(join(dataDir, 'history-state.json'), 'utf8'), '{');
});

test('corrupt account extensions fail the short store closed without erasing desk history', t => {
  const { dataDir, model } = setup(t); model.accept(snapshot());
  const file = join(dataDir, 'history-state.json');
  const stored = JSON.parse(readFileSync(file));
  stored.value.points[0].account.cash.currency = 'USD'; measureHistory(stored.value);
  writeFileSync(file, JSON.stringify(stored));
  const before = readFileSync(file, 'utf8');
  const restarted = createReadModel({ dataDir, clock: () => at(1) });
  assert.equal(restarted.feeds().history.reason, 'history_write_failed');
  assert.deepEqual(restarted.accountHistory().points, []);
  assert.equal(restarted.accept(snapshot(102, at(1))).status, 200);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(restarted.accountHistory().dailyCloses.days.length, 2);
});

test('replays, frozen generations and rejected ingress do not write history or daily closes', t => {
  let now = T0; const writes = [];
  const { dataDir } = setup(t);
  const model = createReadModel({ dataDir, clock: () => now, write: (file, ...args) => { writes.push(basename(file)); atomicWrite(file, ...args); } });
  assert.equal(model.accept(snapshot()).status, 200); writes.length = 0;
  assert.equal(model.accept(snapshot()).status, 422); assert.deepEqual(writes, []);
  now = at(20); assert.equal(model.accept(snapshot(102)).status, 200);
  assert.ok(!writes.includes('history-state.json') && !writes.includes('account-closes-state.json'));
  writes.length = 0;
  const bad = snapshot(103, now); bad.mode = 'LIVE';
  assert.equal(model.accept(bad).status, 422);
  assert.ok(writes.every(file => file === 'feed-rejections.json'));
});
