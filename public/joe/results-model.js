// Results model (pure; shared by the page, the read worker and the tests). The
// validated closed-trade record (results v2) is indexed once into columns,
// then every Results number is derived from that index exactly as spec r3
// §4.2 defines it. Money stays in exact 10⁻⁸ units as BigInt, at any size the
// contract accepts (never a 64-bit or floating-point stand-in), and is rounded
// once, for display. A trade's day is the Vienna date of closedAt.
import { wall, marketSession, sessionBounds, zonedInstant, VIENNA, NY } from './time.mjs';
import { decimalUnits, divRound, UNIT } from './contracts/decimal.mjs';
import { basisKey, meaningful, rowAt } from './history-model.js';

export const DESK_IDS = Object.freeze(['j', 'joe', 'joel']);
const DESK_INDEX = Object.freeze({ j: 0, joe: 1, joel: 2 });
// Before tracking starts each desk holds its € 5.000 of practice capital.
export const START_EQUITY = 5000n * UNIT;
// A trade is won at € 0,005 or more and lost at −€ 0,005 or less; the rest is flat.
export const SCRATCH = 500000n;
export const SMALL_SAMPLE = 30;
const CENT = 1000000n;

// Rev-5 reasons in their canonical presentation order. Unknown future codes
// never become copy; a legacy partial row keeps the generic fallback.
export const PARTIAL_REASON = "Part of this day's activity couldn't be confirmed, so its result may be incomplete.";
export const PARTIAL_DESK_NOTE = 'Applies to the whole day; this desk may be unaffected.';
export const PARTIAL_REASONS = Object.freeze([
  ['capture_gap', 'Capture gap', 'Trade capture had a gap on this day.'],
  ['history_gap', 'History gap', 'The trade history has a gap that covers this day.'],
  ['broker_trade_count_mismatch', 'Broker trade count mismatch', "Our trade count differs from the broker's."],
  ['broker_realised_pnl_mismatch', 'Broker result mismatch', "Our result differs from the broker's by more than €0.01."],
  ['unattributed_activity', 'Unattributed activity', "Some trades couldn't be matched to a desk."],
  ['avg_cost_mismatch', 'Average-cost mismatch', "Our average cost differs from the broker's."],
  ['fx_disabled', 'FX sampling off', 'EUR conversion was switched off for this day.'],
  ['fx_missing', 'FX missing', 'No EUR exchange rate was recorded for this day.'],
  ['broker_evidence_missing', 'Broker evidence missing', "The broker hasn't confirmed fees or results for some trades yet."],
].map(Object.freeze));
export function partialReasons(day) {
  const codes = new Set(day?.partialReasons ?? []);
  if (codes.has('fx_disabled')) codes.delete('fx_missing');
  return PARTIAL_REASONS.filter(([code]) => codes.has(code)).map(([code, label, sentence]) => ({ label,
    text: code === 'unattributed_activity' && Number.isInteger(day.unattributedCount) && day.unattributedCount >= 0
      ? `${day.unattributedCount} trade${day.unattributedCount === 1 ? '' : 's'} couldn't be matched to a desk.` : sentence }));
}
export function partialReasonLabel(day) {
  const reasons = partialReasons(day);
  return reasons.length ? `${reasons[0].label}${reasons.length > 1 ? `, and ${reasons.length - 1} more` : ''}` : PARTIAL_REASON;
}

// ---------- Vienna dates ----------
// Vienna's midnight always falls on a whole UTC hour (its offsets are whole
// hours), so one UTC hour has one Vienna date: one Intl call per hour.
const hourDays = new Map();
export function viennaDate(ms) {
  const hour = Math.floor(ms / 3600000);
  let day = hourDays.get(hour);
  if (day === undefined) {
    day = wall(new Date(hour * 3600000).toISOString(), VIENNA).slice(0, 10);
    if (hourDays.size >= 100000) hourDays.clear();
    hourDays.set(hour, day);
  }
  return day;
}
// The instant a Vienna date begins (its midnight is never inside a DST change).
const midnights = new Map();
export function viennaMidnight(k) {
  let ms = midnights.get(k);
  if (ms === undefined) {
    ms = Date.parse(zonedInstant(k, '00:00:00', VIENNA));
    if (midnights.size >= 8192) midnights.clear();
    midnights.set(k, ms);
  }
  return ms;
}

const pad = n => String(n).padStart(2, '0');
export const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const kOf = dt => dateKey(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
export const addDays = (k, n) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return kOf(d); };
export const dowOf = k => parse(k).getUTCDay();
export const ymOf = k => [parse(k).getUTCFullYear(), parse(k).getUTCMonth()];
export const monday = k => addDays(k, -((dowOf(k) + 6) % 7));
export const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const isWeekend = k => dowOf(k) === 0 || dowOf(k) === 6;
// A US market holiday (the pinned calendar): no regular session on that date.
const holidays = new Map();
export function marketHoliday(k) {
  if (!holidays.has(k)) {
    if (holidays.size >= 4096) holidays.clear();
    holidays.set(k, !isWeekend(k) && marketSession(zonedInstant(k, '12:00:00', NY)).reason === 'market_closed');
  }
  return holidays.get(k);
}

// A day and its month never part (r3.1): they are joined by a non-breaking space.
const NB = '\u00a0';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDM = k => { const d = parse(k); return `${d.getUTCDate()}${NB}${MON[d.getUTCMonth()]}`; };
export const fmtDDM = k => `${DOW[dowOf(k)]} ${fmtDM(k)}`;
export const fmtDay = k => `${fmtDDM(k)} ${k.slice(0, 4)}`;
function rangeLabel(s, e, today) {
  const a = parse(s), b = parse(e), year = b.getUTCFullYear() === Number(today.slice(0, 4)) ? '' : ` ${b.getUTCFullYear()}`;
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()}${NB}${MON[b.getUTCMonth()]}${year}`
    : `${fmtDM(s)}${a.getUTCFullYear() === b.getUTCFullYear() ? '' : ` ${a.getUTCFullYear()}`} – ${fmtDM(e)}${year}`;
}

// The stepper stops at 1 Aug of the first tracked year (never after tracking starts).
export function firstStep(trackingStart) {
  const floor = `${(trackingStart ?? '2026-08-01').slice(0, 4)}-08-01`;
  return trackingStart && trackingStart < floor ? `${trackingStart.slice(0, 7)}-01` : floor;
}

// A period: its dates, the stepper label, the heading token and the sentence phrase.
export function periodOf(p, a, today, trackingStart = null) {
  const [y, m] = ymOf(a);
  if (p === 'day') {
    const yesterday = a === addDays(today, -1);
    return { p, start: a, end: a, lab: a === today ? `Today · ${fmtDDM(a)}` : yesterday ? `Yesterday · ${fmtDDM(a)}` : fmtDay(a),
      head: a === today ? 'today' : fmtDDM(a), phrase: a === today ? 'today' : yesterday ? 'yesterday' : `on ${fmtDDM(a)}` };
  }
  if (p === 'week') {
    const s = monday(a), e = addDays(s, 6), cur = s === monday(today), prev = s === addDays(monday(today), -7), r = rangeLabel(s, e, today);
    return { p, start: s, end: e, lab: cur ? `This week · ${r}` : prev ? `Last week · ${r}` : r,
      head: cur ? 'this week' : prev ? 'last week' : `week of ${fmtDM(s)}`, phrase: cur ? 'this week' : prev ? 'last week' : `in the week of ${fmtDM(s)}` };
  }
  if (p === 'month') {
    const [ty, tm] = ymOf(today), cur = y === ty && m === tm, prev = (y === ty && m === tm - 1) || (y === ty - 1 && tm === 0 && m === 11);
    const name = y === ty ? MONTH[m] : `${MONTH[m]} ${y}`;
    return { p, start: dateKey(y, m, 1), end: dateKey(y, m, daysIn(y, m)), lab: cur ? `This month · ${MONTH[m]}` : prev ? `Last month · ${MONTH[m]}` : `${MONTH[m]} ${y}`,
      head: cur ? 'this month' : prev ? 'last month' : name, phrase: cur ? 'this month' : prev ? 'last month' : `in ${name}` };
  }
  if (p === 'ytd') return { p, start: `${today.slice(0, 4)}-01-01`, end: today, lab: `This year · since 1${NB}Jan`, head: 'this year', phrase: 'this year' };
  const start = trackingStart ?? firstStep(null);
  return { p: 'all', start, end: today, lab: trackingStart ? `All time · since ${fmtDM(trackingStart)}` : 'All time', head: 'all time',
    phrase: trackingStart ? `since ${fmtDM(trackingStart)}` : 'so far' };
}

// The anchor one Day, Week or Month on, clamped to [first step, today].
export function stepAnchor(period, anchor, dir, today, trackingStart = null) {
  const a = parse(anchor);
  if (period === 'day') a.setUTCDate(a.getUTCDate() + dir);
  if (period === 'week') a.setUTCDate(a.getUTCDate() + 7 * dir);
  if (period === 'month') { a.setUTCDate(1); a.setUTCMonth(a.getUTCMonth() + dir); }
  const k = kOf(a), first = firstStep(trackingStart);
  return k > today ? today : k < first ? first : k;
}

// ---------- Index ----------
const FIELD = '\u001f';
const cmpTrade = (ms, ids) => (a, b) => ms[a] - ms[b] || (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0);
// Exact money columns: BigInt has no fixed width, so no amount or sum the
// contract accepts can wrap (a BigInt64Array would, past € 92 billion).
const exact = n => new Array(n).fill(0n);

// One pass over a validated results v2 payload. Trades are sorted by closedAt;
// every (Vienna date, desk) cell carries its counts and exact sums, and each
// desk's equity close (0 none that day, 1 a value, 2 reported unknown).
export function indexResults(value) {
  const raw = value.trades, n = raw.length;
  const closed = new Float64Array(n), ids = raw.map(t => t.id);
  for (let i = 0; i < n; i++) closed[i] = Date.parse(raw[i].closedAt);
  const order = Array.from({ length: n }, (_, i) => i).sort(cmpTrade(closed, ids));
  const tradeDates = order.map(i => viennaDate(closed[i]));
  const dates = [...new Set([...value.days.map(d => d.date), ...tradeDates])].sort();
  const di = new Map(dates.map((d, i) => [d, i]));
  const cells = dates.length * 3;
  const agg = { count: new Int32Array(cells), won: new Int32Array(cells), lost: new Int32Array(cells), net: exact(cells), gross: exact(cells),
    fees: exact(cells), winSum: exact(cells), lossSum: exact(cells), best: new Int32Array(cells).fill(-1), worst: new Int32Array(cells).fill(-1) };
  const trades = { n, desk: new Uint8Array(n), date: new Int32Array(n), closedAt: new Float64Array(n), openedAt: new Float64Array(n),
    net: exact(n), gross: exact(n), fees: exact(n), offsets: new Uint32Array(n + 1), blob: '' };
  const text = [], symbols = new Map();
  let length = 0;
  for (let k = 0; k < n; k++) {
    const t = raw[order[k]], desk = DESK_INDEX[t.desk], date = di.get(tradeDates[k]), cell = date * 3 + desk;
    const net = decimalUnits(t.netEur.amount);
    trades.desk[k] = desk; trades.date[k] = date; trades.closedAt[k] = closed[order[k]]; trades.openedAt[k] = Date.parse(t.openedAt);
    trades.net[k] = net; trades.gross[k] = decimalUnits(t.grossEur.amount); trades.fees[k] = decimalUnits(t.feesEur.amount);
    const record = [t.id, t.symbol, t.company ?? '', t.side, t.quantity, t.entryPrice.amount, t.entryPrice.currency, t.exitPrice.amount, t.exitPrice.currency].join(FIELD);
    text.push(record); trades.offsets[k] = length; length += record.length;
    symbols.set(t.symbol, (symbols.get(t.symbol) ?? 0) | (1 << desk));
    agg.count[cell]++; agg.net[cell] += net; agg.gross[cell] += trades.gross[k]; agg.fees[cell] += trades.fees[k];
    if (net >= SCRATCH) {
      agg.won[cell]++; agg.winSum[cell] += net;
      if (agg.best[cell] < 0 || net > trades.net[agg.best[cell]]) agg.best[cell] = k;
    } else if (net <= -SCRATCH) {
      agg.lost[cell]++; agg.lossSum[cell] += net;
      if (agg.worst[cell] < 0 || net < trades.net[agg.worst[cell]]) agg.worst[cell] = k;
    }
  }
  trades.offsets[n] = length;
  trades.blob = text.join('');
  const close = { amount: exact(cells), state: new Uint8Array(cells), entry: new Int32Array(cells).fill(-1) };
  for (const day of value.days) {
    const i = di.get(day.date);
    for (const [id, d] of Object.entries(day.desks)) {
      const cell = i * 3 + DESK_INDEX[id];
      close.state[cell] = d.equityClose ? 1 : 2;
      close.amount[cell] = d.equityClose ? decimalUnits(d.equityClose.amount) : 0n;
    }
  }
  // Each desk's latest close on or before every date (sessionless days carry it).
  for (let desk = 0; desk < 3; desk++) {
    let last = -1;
    for (let i = 0; i < dates.length; i++) { if (close.state[i * 3 + desk]) last = i; close.entry[i * 3 + desk] = last; }
  }
  return {
    meta: { schema: value.schema, seq: value.seq, generatedAt: value.generatedAt, receivedAt: value.receivedAt, reason: value.reason ?? null,
      trackingStart: value.trackingStart, days: value.days.length, trades: n },
    missingDays: new Set(value.missingDays ?? []),
    partialDays: new Set(value.days.filter(d => d.coverage === 'partial').map(d => d.date)),
    partialDetails: new Map(value.days.filter(d => d.coverage === 'partial').map(d => [d.date,
      { partialReasons: d.partialReasons, unattributedCount: d.unattributedCount }])),
    dates, agg, close, trades, symbols: [...symbols.keys()], symbolDesks: Uint8Array.from(symbols.values()),
  };
}

// The typed columns move by transfer; the exact money columns are cloned.
export const transferables = ix => [...Object.values(ix.agg), ...Object.values(ix.close), ...Object.values(ix.trades), ix.symbolDesks]
  .filter(a => ArrayBuffer.isView(a)).map(a => a.buffer);

// Symbols the accepted kept-holdings policy protects that the record still
// trades: the record is then not authoritative and no number is derived.
export const keptInRecord = (ix, keep) => ix.symbols.filter(s => keep.includes(s));

// First index with dates[i] > k (dates are sorted ISO strings).
function upper(dates, k) {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] <= k) lo = mid + 1; else hi = mid; }
  return lo;
}

// The date of a desk's latest close on or before a Vienna date (null before
// tracking starts or before its first close).
function closeDate(ix, desk, k) {
  if (k < ix.meta.trackingStart) return null;
  const i = upper(ix.dates, k) - 1;
  const at = i < 0 ? -1 : ix.close.entry[i * 3 + desk];
  return at < 0 ? null : ix.dates[at];
}

// A desk's equity close on a Vienna date: its latest close on or before it;
// € 5.000 before tracking starts or before its first close. Null when the
// record says the close is unknown.
export function closeUnits(ix, desk, k) {
  if (k < ix.meta.trackingStart) return START_EQUITY;
  const i = upper(ix.dates, k) - 1;
  const at = i < 0 ? -1 : ix.close.entry[i * 3 + desk];
  if (at < 0) return START_EQUITY;
  return ix.close.state[at * 3 + desk] === 1 ? ix.close.amount[at * 3 + desk] : null;
}

const deskIdx = desks => desks.map(d => DESK_INDEX[d]);

// E(d) of the selected desks. Today it is now: the snapshot's current desk
// equity (ctx.todayUnits) and nothing else. Without it, or with only a
// retained one (the page passes null), E(today) is unknown: a close in the
// record never stands in for the money now.
export function equityAt(ix, desks, k, ctx) {
  let sum = 0n;
  for (const desk of deskIdx(desks)) {
    const v = k === ctx.today ? ctx.todayUnits?.[desk] ?? null : closeUnits(ix, desk, k);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

// ---------- Bookkeeping basis ----------
// A change of a desk's bookkeeping basis is not a profit or loss (History
// contract), so no Results number is derived across one. The bases come from
// History (every observation carries its desk's basis) and from the snapshot
// (the basis of the money now); the record carries none, so each of its
// closes is on the basis of that date's last observation. A cut is one desk's
// change between two observations: rows up to `from` are on the old basis,
// rows from `at` on the new one.
function cutsIn(cols, ids, r0, r1) {
  const cuts = [];
  for (const id of ids) {
    const b = cols.desks[id].basis;
    let prev = -1;
    for (let i = r0 - 1; i >= 0 && prev < 0; i--) if (meaningful(cols, id, i)) prev = i;
    for (let i = r0; i < r1; i++) {
      if (!meaningful(cols, id, i)) continue;
      if (prev >= 0 && b[i] !== b[prev]) cuts.push({ desk: id, from: cols.t[prev], at: cols.t[i] });
      prev = i;
    }
  }
  return cuts;
}
const cutOf = cuts => ({ desks: DESK_IDS.filter(d => cuts.some(c => c.desk === d)), at: Math.min(...cuts.map(c => c.at)) });

// Every cut in History (once per accepted History), plus one at now for each
// desk whose current snapshot (`current[id]`, given only while its money now
// is known) is on another basis than its last observation.
const historyCuts = new WeakMap();
export function basisCuts(cols, current = {}, nowMs = null) {
  if (!cols?.n) return [];
  let h = historyCuts.get(cols);
  if (!h) {
    h = { cuts: cutsIn(cols, DESK_IDS, 0, cols.n), last: {} };
    for (const id of DESK_IDS) for (let i = cols.n - 1; i >= 0; i--) if (meaningful(cols, id, i)) { h.last[id] = i; break; }
    historyCuts.set(cols, h);
  }
  const cuts = h.cuts.slice();
  for (const id of DESK_IDS) {
    const i = h.last[id], now = current?.[id];
    if (i === undefined || !now || nowMs === null || nowMs <= cols.t[i]) continue;
    if (cols.basisKeys[cols.desks[id].basis[i]] !== basisKey(now)) cuts.push({ desk: id, from: cols.t[i], at: nowMs, now: true });
  }
  return cuts.sort((a, b) => a.at - b.at);
}

// Observed intraday equity of the selected desks on one Vienna date, from the
// History columns' exact equity (observed rows only; estimates never enter
// Results). Every observation's basis is checked: across a change of basis
// (from the last observation before the date on) there are no points, only the cut.
export function intraday(cols, k, desks) {
  if (!cols?.n) return { pts: [], cut: null };
  const r0 = rowAt(cols, viennaMidnight(k)), r1 = rowAt(cols, viennaMidnight(addDays(k, 1)));
  const cuts = cutsIn(cols, desks, r0, r1);
  if (cuts.length) return { pts: [], cut: cutOf(cuts) };
  const pts = [];
  for (let i = r0; i < r1; i++) {
    let sum = 0n, ok = true;
    for (const id of desks) {
      const v = cols.desks[id].equityUnits[i];
      if (v === null) { ok = false; break; }
      sum += v;
    }
    if (ok) pts.push({ t: cols.t[i], units: sum });
  }
  return { pts, cut: null };
}

// Everything one period's money needs beyond the record: today's money now,
// the board's time, History's intraday points (the Day period only, by its
// kind) and the change of bookkeeping basis its money would cross, if any:
// for each desk, after the close E(S−1) stands on and up to the close E(end)
// stands on, or now. The page and the browser gate both build it here.
export function moneyContext(ix, inputs, per, desks) {
  const ctx = { today: inputs.today, todayUnits: inputs.todayUnits, nowMs: inputs.nowMs ?? null, intraday: null, cut: null };
  const end = per.end > ctx.today ? ctx.today : per.end;
  if (per.start > end) return ctx;
  const hits = [];
  for (const desk of desks) {
    const d0 = closeDate(ix, DESK_INDEX[desk], addDays(per.start, -1));
    const from = viennaMidnight(d0 ? addDays(d0, 1) : per.start);
    let to = from;
    if (end === ctx.today) to = ctx.nowMs === null ? Infinity : ctx.nowMs + 1;
    else { const d1 = closeDate(ix, DESK_INDEX[desk], end); if (d1) to = viennaMidnight(addDays(d1, 1)); }
    for (const c of inputs.cuts ?? []) if (c.desk === desk && c.at >= from && c.at < to) hits.push(c);
  }
  if (hits.length) ctx.cut = cutOf(hits);
  else if (per.p === 'day') ({ pts: ctx.intraday, cut: ctx.cut } = intraday(inputs.cols, per.start, desks));
  return ctx;
}

const cents = units => Number(divRound(units, CENT)) / 100;
const centsOf = (units, count) => Number(divRound(units, BigInt(count) * CENT)) / 100;
const hundredths = (num, den) => Number(divRound(num * 100n, den)) / 100;

// Every §4.2 number for one period and desk set. Display values are rounded
// once from exact sums; the exact sums ride along as units. Day uses the
// observed intraday points; every other period (also a Week on its Monday,
// a Month on its first) uses session closes.
export function rollup(ix, per, desks, ctx) {
  const end = per.end > ctx.today ? ctx.today : per.end, day = per.p === 'day', cut = ctx.cut ?? null;
  const sel = deskIdx(desks);
  const i0 = upper(ix.dates, addDays(per.start, -1)), i1 = upper(ix.dates, end);
  let trades = 0, won = 0, lost = 0, realised = 0n, gross = 0n, fees = 0n, winSum = 0n, lossSum = 0n, best = -1, worst = -1, days = 0;
  let bestDay = null, worstDay = null;
  const tn = ix.trades.net;
  for (let i = i0; i < i1; i++) {
    let dayCount = 0, dayNet = 0n;
    for (const desk of sel) {
      const c = i * 3 + desk, count = ix.agg.count[c];
      if (!count) continue;
      dayCount += count; dayNet += ix.agg.net[c];
      trades += count; won += ix.agg.won[c]; lost += ix.agg.lost[c];
      realised += ix.agg.net[c]; gross += ix.agg.gross[c]; fees += ix.agg.fees[c]; winSum += ix.agg.winSum[c]; lossSum += ix.agg.lossSum[c];
      const b = ix.agg.best[c], w = ix.agg.worst[c];
      if (b >= 0 && (best < 0 || tn[b] > tn[best] || (tn[b] === tn[best] && b < best))) best = b;
      if (w >= 0 && (worst < 0 || tn[w] < tn[worst] || (tn[w] === tn[worst] && w < worst))) worst = w;
    }
    if (!dayCount) continue;
    days++;
    const result = { date: ix.dates[i], units: dayNet, net: cents(dayNet) };
    // Ties: the best day is the first, the worst the last, so equal days name two dates.
    if (!bestDay || dayNet > bestDay.units) bestDay = result;
    if (!worstDay || dayNet <= worstDay.units) worstDay = result;
  }
  // The money: E(S−1) and E(end). Across a change of bookkeeping basis no
  // result is derived (cut); a value that is not known stays unknown.
  const startE = cut ? null : equityAt(ix, desks, addDays(per.start, -1), ctx);
  const endE = cut ? null : per.start > end ? startE : equityAt(ix, desks, end, ctx);
  const net = startE !== null && endE !== null ? endE - startE : null;
  // Drawdown path: E(S−1), each session's close (Day: every observed intraday
  // point), then E(end). One unknown value on it leaves the drawdown unknown.
  let known = net !== null;
  const path = known ? [startE] : [];
  if (known && day) for (const p of ctx.intraday ?? []) path.push(p.units);
  else if (known) for (let i = i0; i < i1; i++) {
    if (ix.dates[i] === ctx.today || !sel.some(desk => ix.close.state[i * 3 + desk])) continue;
    const e = equityAt(ix, desks, ix.dates[i], ctx);
    if (e === null) { known = false; break; }
    path.push(e);
  }
  if (known && per.start <= end) path.push(endE);
  let peak = null, dd = 0n, ddPeak = null;
  for (const v of path) {
    if (peak === null || v > peak) peak = v;
    if (v - peak < dd) { dd = v - peak; ddPeak = peak; }
  }
  const drawn = known && path.length > 1;
  const decided = won + lost;
  const empty = trades === 0 && net !== null && (net < SCRATCH && net > -SCRATCH);
  // Means are rounded once, to the cent, and kept in units for exact display.
  const mean = (units, count) => (count ? divRound(units, BigInt(count) * CENT) * CENT : null);
  return {
    start: per.start, end, empty, days, trades, won, lost, flat: trades - won - lost, cut,
    units: { net, realised, gross, fees, winSum, lossSum, startE, endE, dd: drawn ? dd : null, unreal: net === null ? null : net - realised,
      expectancy: mean(realised, trades), avgWin: mean(winSum, won), avgLoss: mean(lossSum, lost) },
    net: net === null ? null : cents(net), realised: cents(realised), unreal: net === null ? null : cents(net - realised),
    gross: cents(gross), fees: cents(fees),
    winRate: decided ? Number(divRound(BigInt(won) * 100n, BigInt(decided))) : null, small: decided > 0 && decided < SMALL_SAMPLE,
    expectancy: trades ? centsOf(realised, trades) : null,
    pf: lost ? hundredths(winSum, -lossSum) : null, wonEur: cents(winSum), lostEur: cents(-lossSum),
    avgWin: won ? centsOf(winSum, won) : null, avgLoss: lost ? centsOf(lossSum, lost) : null,
    sizeRatio: won && lost ? hundredths(winSum * BigInt(lost), -lossSum * BigInt(won)) : null,
    best: best >= 0 ? trade(ix, best) : null, worst: worst >= 0 ? trade(ix, worst) : null,
    dd: drawn ? cents(dd) : null, ddPct: drawn && ddPeak ? Number(divRound(dd * 10000n, ddPeak)) / 100 : drawn ? 0 : null,
    bestDay, worstDay,
  };
}

// One trade for display, from the index.
export function trade(ix, k) {
  const t = ix.trades;
  const [id, symbol, company, side, quantity, entry, entryCur, exit, exitCur] = t.blob.slice(t.offsets[k], t.offsets[k + 1]).split(FIELD);
  return { k, id, desk: DESK_IDS[t.desk[k]], symbol, company: company || null, side, quantity,
    entry: { amount: entry, currency: entryCur }, exit: { amount: exit, currency: exitCur },
    date: ix.dates[t.date[k]], closedAt: t.closedAt[k], openedAt: t.openedAt[k],
    net: cents(t.net[k]), gross: cents(t.gross[k]), fees: cents(t.fees[k]), units: { net: t.net[k], gross: t.gross[k], fees: t.fees[k] } };
}

// A day's closed trades of the selected desks, oldest first.
export function tradesOn(ix, k, desks) {
  const i = upper(ix.dates, k) - 1;
  if (i < 0 || ix.dates[i] !== k) return [];
  const sel = new Set(deskIdx(desks)), out = [];
  // Trades are sorted by closedAt, so one date's trades are one run.
  let lo = 0, hi = ix.trades.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.trades.date[mid] < i) lo = mid + 1; else hi = mid; }
  for (let k2 = lo; k2 < ix.trades.n && ix.trades.date[k2] === i; k2++) if (sel.has(ix.trades.desk[k2])) out.push(trade(ix, k2));
  return out;
}

// One Vienna date's closed-trade result for the selected desks.
export function dayResult(ix, k, desks) {
  const i = upper(ix.dates, k) - 1;
  if (i < 0 || ix.dates[i] !== k) return { count: 0, units: 0n, net: 0 };
  let count = 0, units = 0n;
  for (const desk of deskIdx(desks)) { count += ix.agg.count[i * 3 + desk]; units += ix.agg.net[i * 3 + desk]; }
  return { count, units, net: cents(units) };
}

// The largest single-day result (either sign) over every tracked day for the
// selected desks: the calendar's tint scale.
export function maxAbsDay(ix, desks) {
  let max = 0n;
  for (let i = 0; i < ix.dates.length; i++) {
    let v = 0n;
    for (const desk of deskIdx(desks)) v += ix.agg.net[i * 3 + desk];
    if (v < 0n) v = -v;
    if (v > max) max = v;
  }
  return max;
}
// The tint step 1–4 of a day: |net| over the largest day, in quarters.
export function tintStep(units, max) {
  if (max <= 0n) return 1;
  const abs = units < 0n ? -units : units, step = (4n * abs + max - 1n) / max;
  return Number(step < 1n ? 1n : step > 4n ? 4n : step);
}
export const unitsCents = cents;

// The hero chart: the period's result so far from € 0 (v for drawing, u in
// exact units for the text), on a real time axis. Day draws every observed
// intraday point and now. Other periods put each session close at the end of
// its Vienna date and today's money at now, over the period's own dates
// (domain): missing dates keep their width, a session the record has no close
// for breaks the line, and before tracking the line is zero by definition.
// Across a change of bookkeeping basis nothing is drawn (cut).
export function curve(ix, per, desks, ctx) {
  const end = per.end > ctx.today ? ctx.today : per.end, day = per.p === 'day';
  if (ctx.cut) return { pts: [], startE: null, day, cut: ctx.cut };
  const startE = equityAt(ix, desks, addDays(per.start, -1), ctx);
  if (startE === null || per.start > end) return { pts: [], startE, day };
  if (day) {
    const pts = dayWindow((ctx.intraday ?? []).map(p => ({ x: p.t, v: cents(p.units - startE), u: p.units - startE, at: p.t })), per.start);
    const endE = equityAt(ix, desks, end, ctx);
    if (end === ctx.today && endE !== null && ctx.nowMs && (!pts.length || ctx.nowMs > pts[pts.length - 1].x)) pts.push({ x: ctx.nowMs, v: cents(endE - startE), u: endE - startE, at: ctx.nowMs, now: true });
    if (pts.length < 2 && endE !== null) {
      return { pts: [{ x: 0, v: 0, u: 0n, edge: 'start' }, { x: 1, v: cents(endE - startE), u: endE - startE, edge: end === ctx.today ? 'now' : 'close' }], startE, day: true, edges: true, domain: [0, 1] };
    }
    return { pts, startE, day: true, domain: pts.length ? [pts[0].x, pts[pts.length - 1].x] : [0, 1] };
  }
  const live = end === ctx.today, ts = ix.meta.trackingStart, sel = deskIdx(desks);
  const x0 = viennaMidnight(per.start);
  const x1 = live && ctx.nowMs !== null ? Math.max(ctx.nowMs, x0 + 1) : viennaMidnight(addDays(end, 1));
  const tracking = per.start <= ts && ts <= end ? viennaMidnight(ts) : null;
  const pts = [{ x: x0, v: 0, u: 0n, edge: 'start', k: per.start }];
  let prev = addDays(per.start, -1);
  if (per.start < ts && ts <= end) { pts.push({ x: tracking, v: 0, u: 0n, edge: 'tracking', k: ts }); prev = addDays(ts, -1); }
  // A regular session after tracking starts, strictly between two dates.
  const missing = (a, b) => { for (let k = addDays(a, 1); k < b; k = addDays(k, 1)) if (k >= ts && !isWeekend(k) && !marketHoliday(k)) return true; return false; };
  const point = (k, x, e, extra) => {
    if (missing(prev, k)) pts.push({ x: (pts[pts.length - 1].x + x) / 2, v: null, gap: true });
    pts.push({ x, v: e === null ? null : cents(e - startE), u: e === null ? null : e - startE, k, ...extra });
    prev = k;
  };
  const i0 = upper(ix.dates, addDays(per.start, -1)), i1 = upper(ix.dates, end);
  for (let i = i0; i < i1; i++) {
    const k = ix.dates[i];
    if (k === ctx.today || !sel.some(desk => ix.close.state[i * 3 + desk])) continue;
    point(k, viennaMidnight(addDays(k, 1)), equityAt(ix, desks, k, ctx));
  }
  if (live) point(end, x1, equityAt(ix, desks, end, ctx), { now: true });
  return { pts, startE, day: false, domain: [x0, x1], tracking };
}

// A day's chart shows its regular New York session (in Vienna time), widened
// to any change outside it; the flat night before it is not drawn.
function dayWindow(pts, k) {
  const s = sessionBounds(zonedInstant(k, '12:00:00', NY));
  if (!s.openAt || pts.length < 2) return pts;
  let lo = Date.parse(s.openAt), hi = Date.parse(s.closeAt);
  const open = lo, close = hi;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].v === pts[i - 1].v) continue;
    if (pts[i].x < open) lo = Math.min(lo, pts[i - 1].x);
    if (pts[i].x > close) hi = Math.max(hi, pts[i].x);
  }
  const kept = pts.filter(p => p.x >= lo && p.x <= hi);
  const before = pts.filter(p => p.x < lo).at(-1);
  if (before && (!kept.length || kept[0].x > lo)) kept.unshift({ ...before, x: lo, at: lo });
  return kept.length >= 2 ? kept : pts;
}

// The FX arithmetic behind a trade's result, exactly: quantity × (exit − entry)
// for a long (entry − exit for a short), at the close rate, in euro units.
export function grossFromFx(t) {
  const q = decimalUnits(t.quantity), move = decimalUnits(t.exitPrice.amount) - decimalUnits(t.entryPrice.amount);
  const native = divRound(q * (t.side === 'short' ? -move : move), UNIT);
  return divRound(native * decimalUnits(t.fx.rate), UNIT);
}
