// Test-only: a deterministic closed-trade record (results v2) for the design
// scenario, never shipped and never under public/. Equity closes follow the
// P3 scenario's history (the last observation of each Vienna date) and walk
// back to € 5.000 per desk at the tracking start; trades sit in the regular
// New York session, with exact FX arithmetic: gross = quantity × price move ×
// close rate, net = gross − fees.
import { scenario, NOW, valid } from './board.mjs';
import { validateContract } from '../../contracts/index.mjs';
import { marketSession, zonedInstant, viennaDay, NY } from '../../time.mjs';
import { decimalUnits, unitsDecimal } from '../../contracts/decimal.mjs';

const DESKS = ['j', 'joe', 'joel'];
const SYMBOLS = [['BAC', 'Bank of America', 46], ['INTC', 'Intel', 24], ['F', 'Ford', 11.5], ['SOFI', 'SoFi Technologies', 14.5], ['T', 'AT&T', 27],
  ['PFE', 'Pfizer', 25], ['KO', 'Coca-Cola', 70], ['CSCO', 'Cisco', 58], ['VZ', 'Verizon', 41], ['AAL', 'American Airlines', 12.4],
  ['SNAP', 'Snap', 8.6], ['WBD', 'Warner Bros. Discovery', 11.9], ['NIO', 'NIO', 6.2], ['AMD', 'Advanced Micro Devices', 162], ['UBER', 'Uber', 78]];
function random(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cents = c => { const s = (Math.abs(c) / 100).toFixed(2).replace(/\.?0+$/, ''); return `${c < 0 && s !== '0' ? '-' : ''}${s}`; };
const dec = (n, d) => { const s = n.toFixed(d).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const addDays = (k, n) => new Date(Date.parse(`${k}T00:00:00.000Z`) + n * 864e5).toISOString().slice(0, 10);
const session = k => { const s = marketSession(zonedInstant(k, '12:00:00', NY)); return s.reason !== 'market_closed'; };

// Exact decimal arithmetic in 10⁻⁶ steps for the generator's own sums.
const U = 1e6;
const toU = s => Math.round(Number(s) * U);
const fromU = u => dec(u / U, 6);

// Fixture builder: retain independently chosen equity closes, but supply real
// day/desk trade totals when a scenario replaces or expands the trade window.
export function withTradeSummaries(record) {
  const days = new Map(record.days.map(day => [day.date, day]));
  for (const day of record.days) for (const d of Object.values(day.desks)) {
    d.trades = 0; d.realisedNet = { amount: '0', currency: 'EUR' }; d.fees = { amount: '0', currency: 'EUR' };
  }
  for (const t of record.trades) {
    const d = days.get(viennaDay(t.closedAt))?.desks[t.desk];
    if (!d) continue;
    d.trades++;
    d.realisedNet.amount = unitsDecimal(decimalUnits(d.realisedNet.amount) + decimalUnits(t.netEur.amount));
    d.fees.amount = unitsDecimal(decimalUnits(d.fees.amount) + decimalUnits(t.feesEur.amount));
  }
  return record;
}

// JOED-30: only yesterday can remain Partial under T+1. Capture the traded
// and unattributed-only versions of that date as separate accepted snapshots.
export function partialDaysResults(now = '2026-10-16T12:00:00.000Z') {
  const dates = { partial: '2026-10-15', escalated: '2026-10-14', missing: '2026-10-13',
    normal: '2026-10-12', emptyEscalated: '2026-10-11', today: '2026-10-16' };
  const baseline = withTradeSummaries({ ...structuredClone(valid.results), generatedAt: now,
    days: [dates.emptyEscalated, dates.normal, dates.escalated, dates.partial, dates.today].map(date => ({ date,
      desks: date === dates.emptyEscalated ? {} : structuredClone(valid.results.days[0].desks),
      ...(date === dates.today ? { coverage: 'partial' } : {}) })),
    trades: [dates.normal, dates.missing, dates.escalated, dates.partial, dates.today].map((date, i) => ({
      ...structuredClone(valid.results.trades[0]), id: `rt-partial-${i}`,
      openedAt: `${date}T10:00:00.000Z`, closedAt: `${date}T10:10:00.000Z` })),
  });
  delete baseline.receivedAt;
  const partial = structuredClone(baseline);
  for (const day of partial.days.filter(d => [dates.partial, dates.escalated, dates.emptyEscalated].includes(d.date))) {
    day.coverage = 'partial';
    for (const desk of Object.values(day.desks)) desk.realisedNet = desk.fees = null;
  }
  const empty = structuredClone(partial);
  empty.trades = empty.trades.filter(t => viennaDay(t.closedAt) !== dates.partial);
  empty.days.find(d => d.date === dates.partial).desks = {};
  const missing = structuredClone(partial);
  missing.days = missing.days.filter(d => d.date !== dates.partial);
  const large = structuredClone(partial), template = large.trades.find(t => viennaDay(t.closedAt) === dates.partial);
  large.trades = large.trades.filter(t => viennaDay(t.closedAt) !== dates.partial);
  large.trades.push(...Array.from({ length: 99 }, (_, i) => {
    const t = structuredClone(template);
    t.id = `rt-partial-large-${i}`;
    t.netEur.amount = i === 98 ? '-999999.99' : '0';
    t.grossEur.amount = unitsDecimal(decimalUnits(t.netEur.amount) + decimalUnits(t.feesEur.amount));
    return t;
  }));
  const emptyMonth = withTradeSummaries({ ...structuredClone(empty), trades: [] });
  const reasons = structuredClone(partial);
  reasons.days.find(d => d.date === dates.partial).partialReasons = ['capture_gap', 'history_gap', 'broker_trade_count_mismatch',
    'broker_realised_pnl_mismatch', 'unattributed_activity', 'avg_cost_mismatch', 'fx_disabled', 'fx_missing', 'broker_evidence_missing'];
  reasons.days.find(d => d.date === dates.today).partialReasons = ['history_gap'];
  const singleReason = structuredClone(partial);
  singleReason.days.find(d => d.date === dates.partial).partialReasons = ['history_gap'];
  const counted = structuredClone(partial);
  Object.assign(counted.days.find(d => d.date === dates.partial), { partialReasons: ['unattributed_activity'], unattributedCount: 2 });
  return { dates, baseline, partial, empty, missing, large, emptyMonth, reasons, singleReason, counted };
}

export function designResults(now = NOW, { trackingStart = '2026-09-10', seq = 412 } = {}) {
  const R = random(20261015);
  const { history } = scenario(now);
  const today = viennaDay(now);
  // The last observed equity of each Vienna date in the History scenario.
  const observed = new Map();
  for (const p of history.points) observed.set(viennaDay(p.t), Object.fromEntries(DESKS.map(id => [id, Math.round(Number(p.desks[id].money.equity.amount) * 100)])));
  const historyDays = [...observed.keys()].filter(k => k < today).sort();
  const first = history.points[0];
  const anchor = Object.fromEntries(DESKS.map(id => [id, Math.round(Number(first.desks[id].money.equity.amount) * 100)]));
  const sessions = [];
  for (let k = trackingStart; k < today; k = addDays(k, 1)) if (session(k)) sessions.push(k);
  const before = sessions.filter(k => k < historyDays[0]);
  // A walk from € 5.000 that lands on the History scenario's first observation.
  const closes = new Map();
  const walk = Object.fromEntries(DESKS.map(id => [id, [500000]]));
  for (const k of before) for (const id of DESKS) walk[id].push(walk[id].at(-1) + Math.round((R() - 0.47) * 900));
  before.forEach((k, i) => closes.set(k, Object.fromEntries(DESKS.map(id => {
    const w = walk[id], drift = (anchor[id] - w.at(-1)) * (i + 1) / before.length;
    return [id, w[i + 1] + Math.round(drift)];
  }))));
  for (const k of historyDays) if (session(k)) closes.set(k, observed.get(k));
  const trades = [];
  const days = [];
  let id = 4000;
  const prev = Object.fromEntries(DESKS.map(d => [d, 500000]));
  for (const k of [...closes.keys()].sort().concat(today)) {
    const close = closes.get(k);
    const day = { date: k, desks: {} };
    for (const desk of DESKS) {
      // Joe sits out today; otherwise zero to four closed trades a session.
      const count = k === today ? (desk === 'j' ? 2 : 0) : Math.floor(R() * (desk === 'joel' ? 3 : 5));
      const change = close ? close[desk] - prev[desk] : 0;
      let netU = 0, feesU = 0;
      for (let i = 0; i < count; i++) {
        const [symbol, company, base] = SYMBOLS[Math.floor(R() * SYMBOLS.length)];
        const side = R() < 0.18 ? 'short' : 'long';
        const qty = Math.max(1, Math.floor(R() * Math.min(14, 220 / base)) + 1);
        const rate = (0.8450 + R() * 0.03).toFixed(4);
        const fees = (0.30 + Math.floor(R() * 40) / 100).toFixed(2);
        // Aim this trade at its share of the day's move, then let the price round.
        const share = (change / 100) * (0.55 + R() * 0.4) / count + (R() - 0.5) * 3;
        const move = ((share + Number(fees)) / (qty * Number(rate))) * (side === 'short' ? -1 : 1);
        const entry = Number((base * (0.96 + R() * 0.08)).toFixed(2));
        const exit = Math.max(0.5, Number((entry + move).toFixed(2)));
        const grossU = Math.round(qty * Math.round((exit - entry) * 100) * (side === 'short' ? -1 : 1) * Number(rate) * U / 100);
        const net = grossU - toU(fees);
        netU += net; feesU += toU(fees);
        const nyDay = k;
        const closeMin = k === today ? 13 * 60 + 40 + i * 140 : 13 * 60 + 35 + Math.floor(R() * 380);
        const heldMin = 6 + Math.floor(R() * 220);
        const overnight = k !== today && R() < 0.12;
        const closedAt = new Date(Date.parse(`${nyDay}T00:00:00.000Z`) + closeMin * 60000).toISOString();
        const openedAt = overnight ? new Date(Date.parse(closedAt) - (24 * 60 + heldMin) * 60000).toISOString() : new Date(Date.parse(closedAt) - Math.min(heldMin, closeMin - 13 * 60 - 31) * 60000).toISOString();
        trades.push({ id: `rt-${String(++id).padStart(6, '0')}`, desk, symbol, company, side, quantity: String(qty), openedAt, closedAt,
          entryPrice: { amount: dec(entry, 2), currency: 'USD' }, exitPrice: { amount: dec(exit, 2), currency: 'USD' },
          grossEur: { amount: fromU(grossU), currency: 'EUR' }, feesEur: { amount: fees.replace(/\.?0+$/, ''), currency: 'EUR' }, netEur: { amount: fromU(net), currency: 'EUR' },
          fx: { base: 'USD', quote: 'EUR', rate: rate.replace(/0+$/, ''), source: 'ib-close-rate', observedAt: closedAt }, method: 'execution-fifo-net-current-fx' });
      }
      if (close) day.desks[desk] = { equityClose: { amount: cents(close[desk]), currency: 'EUR' }, realisedNet: { amount: fromU(netU), currency: 'EUR' }, fees: { amount: fromU(feesU), currency: 'EUR' }, trades: count };
      if (close) prev[desk] = close[desk];
    }
    if (close) days.push(day);
  }
  const generatedAt = new Date(Date.parse(now) - 20000).toISOString();
  const payload = { schema: 'inspr.joe.household.results.v2', seq, generatedAt, receivedAt: new Date(Date.parse(now) - 18000).toISOString(),
    currency: 'EUR', timeZone: 'Europe/Vienna', trackingStart, days, trades, benchmark: null };
  const checked = validateContract('results', payload);
  if (!checked.ok) throw new Error(`design results invalid: ${JSON.stringify(checked.errors.slice(0, 5))}`);
  return payload;
}

// The largest record the 8 MiB contract allows for this trade shape, for the
// render budget: a year of sessions with many trades a day.
export function largeResults(now = NOW, trades = 14000) {
  const base = designResults(now);
  const out = structuredClone(base);
  const R = random(7);
  const sessions = [];
  for (let k = '2025-10-01'; k < viennaDay(now); k = addDays(k, 1)) if (session(k)) sessions.push(k);
  out.trackingStart = '2025-10-01';
  out.trades = [];
  for (let i = 0; i < trades; i++) {
    const t = structuredClone(base.trades[i % base.trades.length]);
    const k = sessions[Math.floor(i * sessions.length / trades)];
    const closedAt = new Date(Date.parse(`${k}T13:35:00.000Z`) + Math.floor(R() * 380) * 60000).toISOString();
    Object.assign(t, { id: `rt-big-${i}`, closedAt, openedAt: new Date(Date.parse(closedAt) - 600000).toISOString() });
    t.fx.observedAt = closedAt;
    out.trades.push(t);
  }
  const level = { j: 500000, joe: 500000, joel: 500000 };
  out.days = sessions.map(k => ({ date: k, desks: Object.fromEntries(DESKS.map(d => { level[d] += Math.round((R() - 0.5) * 400); return [d, { equityClose: { amount: cents(level[d]), currency: 'EUR' }, realisedNet: { amount: '0', currency: 'EUR' }, fees: { amount: '0', currency: 'EUR' }, trades: 0 }]; })) }));
  withTradeSummaries(out);
  const checked = validateContract('results', out);
  if (!checked.ok) throw new Error(`large results invalid: ${JSON.stringify(checked.errors.slice(0, 5))}`);
  return out;
}
