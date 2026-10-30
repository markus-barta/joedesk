// Independent JOED-168 oracle: explicit Gregorian era, civil-day arithmetic,
// and linear scans of raw records. No Results implementation or frozen
// baseline imports; no hour rounding, binary searches or aggregate columns.
import { decimalUnits, divRound, UNIT } from '../../contracts/decimal.mjs';

const DAY = 86400000, CENT = 1000000n, SCRATCH = 500000n;
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna',
  calendar: 'gregory', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
const key = (y, m, d) => `${y < 0 ? '-' : ''}${String(Math.abs(y)).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = k => /^(-?\d+)-(\d+)-(\d+)$/.exec(k).slice(1).map(Number);
export function viennaDate(ms) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return key(p.era === 'BC' ? 1 - Number(p.year) : Number(p.year), Number(p.month), Number(p.day));
}

// Proleptic Gregorian days since 1970-01-01; floor division also covers BC.
export function ordinal(k) {
  let [y, m, d] = parts(k);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yo = y - era * 400;
  return era * 146097 + yo * 365 + Math.floor(yo / 4) - Math.floor(yo / 100)
    + Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1 - 719468;
}
export function addDays(k, n) {
  const dt = new Date((ordinal(k) + n) * DAY);
  return key(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function span(p, anchor, today, trackingStart) {
  const [y, m] = parts(anchor), [ty] = parts(today);
  if (p === 'day') return { start: anchor, end: anchor };
  if (p === 'week') {
    const weekday = ((ordinal(anchor) + 3) % 7 + 7) % 7, start = addDays(anchor, -weekday);
    return { start, end: addDays(start, 6) };
  }
  if (p === 'month') {
    const next = m === 12 ? key(y + 1, 1, 1) : key(y, m + 1, 1);
    return { start: key(y, m, 1), end: addDays(next, -1) };
  }
  if (p === 'ytd') return y >= ty ? { start: key(ty, 1, 1), end: today } : { start: key(y, 1, 1), end: key(y, 12, 31) };
  return { start: trackingStart, end: today };
}

// First instant of a local day, found independently of timezone offset math.
export function midnight(k) {
  const target = ordinal(k);
  let lo = target * DAY - DAY / 2, hi = target * DAY + DAY / 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ordinal(viennaDate(mid)) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cents = u => Number(divRound(u, CENT)) / 100;
const sum = (rows, field) => rows.reduce((v, t) => v + decimalUnits(t[field].amount), 0n);
const sorted = value => value.trades.slice().sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export function reference(value) {
  const trades = sorted(value).map((t, k) => ({ ...t, k, date: viennaDate(Date.parse(t.closedAt)) }));
  const dates = [...new Set([...value.days.map(d => d.date), ...trades.map(t => t.date)])].sort((a, b) => ordinal(a) - ordinal(b));
  const close = (desk, date, ctx) => {
    if (date === ctx.today) return ctx.todayUnits?.[['j', 'joe', 'joel'].indexOf(desk)] ?? null;
    if (ordinal(date) < ordinal(value.trackingStart)) return 5000n * UNIT;
    const rows = value.days.filter(d => ordinal(d.date) <= ordinal(date) && d.desks[desk]).sort((a, b) => ordinal(b.date) - ordinal(a.date));
    if (!rows.length) return 5000n * UNIT;
    return rows[0].desks[desk].equityClose ? decimalUnits(rows[0].desks[desk].equityClose.amount) : null;
  };
  const equity = (desks, date, ctx) => {
    const values = desks.map(d => close(d, date, ctx));
    return values.includes(null) ? null : values.reduce((a, b) => a + b, 0n);
  };
  const on = (date, desks) => trades.filter(t => t.date === date && desks.includes(t.desk));
  const display = t => t ? { k: t.k, id: t.id, desk: t.desk, symbol: t.symbol, company: t.company || null, side: t.side, quantity: t.quantity,
    entry: t.entryPrice, exit: t.exitPrice, fx: t.fx ? { base: t.fx.base, rate: t.fx.rate } : null,
    date: t.date, closedAt: Date.parse(t.closedAt), openedAt: Date.parse(t.openedAt),
    net: cents(decimalUnits(t.netEur.amount)), gross: cents(decimalUnits(t.grossEur.amount)), fees: cents(decimalUnits(t.feesEur.amount)),
    units: { net: decimalUnits(t.netEur.amount), gross: decimalUnits(t.grossEur.amount), fees: decimalUnits(t.feesEur.amount) } } : null;
  return {
    dates, trades,
    dayResult(date, desks) { const rows = on(date, desks), units = sum(rows, 'netEur'); return { count: rows.length, units, net: cents(units) }; },
    tradesOn(date, desks) { return on(date, desks).map(display); },
    rollup(per, desks, ctx) {
      const end = ordinal(per.end) > ordinal(ctx.today) ? ctx.today : per.end;
      const rows = trades.filter(t => desks.includes(t.desk) && ordinal(t.date) >= ordinal(per.start) && ordinal(t.date) <= ordinal(end));
      const wins = rows.filter(t => decimalUnits(t.netEur.amount) >= SCRATCH), losses = rows.filter(t => decimalUnits(t.netEur.amount) <= -SCRATCH);
      const realised = sum(rows, 'netEur'), gross = sum(rows, 'grossEur'), fees = sum(rows, 'feesEur'), winSum = sum(wins, 'netEur'), lossSum = sum(losses, 'netEur');
      const startE = equity(desks, addDays(per.start, -1), ctx), endE = ordinal(per.start) > ordinal(end) ? startE : equity(desks, end, ctx);
      const net = startE === null || endE === null ? null : endE - startE;
      const tradedDays = dates.filter(d => rows.some(t => t.date === d));
      let bestDay = null, worstDay = null;
      for (const date of tradedDays) {
        const result = this.dayResult(date, desks), day = { date, units: result.units, net: result.net };
        if (!bestDay || day.units > bestDay.units) bestDay = day;
        if (!worstDay || day.units <= worstDay.units) worstDay = day;
      }
      const path = [startE];
      if (per.p === 'day') path.push(...(ctx.intraday ?? []).map(p => p.units));
      else for (const date of dates) {
        if (date !== ctx.today && ordinal(date) >= ordinal(per.start) && ordinal(date) <= ordinal(end)
          && value.days.some(d => d.date === date && desks.some(id => d.desks[id]))) path.push(equity(desks, date, ctx));
      }
      if (ordinal(per.start) <= ordinal(end)) path.push(endE);
      const drawn = net !== null && !path.includes(null) && path.length > 1;
      let peak = null, dd = 0n, ddPeak = null;
      if (drawn) for (const v of path) { if (peak === null || v > peak) peak = v; if (v - peak < dd) { dd = v - peak; ddPeak = peak; } }
      const best = wins.slice().sort((a, b) => decimalUnits(a.netEur.amount) > decimalUnits(b.netEur.amount) ? -1 : decimalUnits(a.netEur.amount) < decimalUnits(b.netEur.amount) ? 1 : a.k - b.k)[0];
      const worst = losses.slice().sort((a, b) => decimalUnits(a.netEur.amount) < decimalUnits(b.netEur.amount) ? -1 : decimalUnits(a.netEur.amount) > decimalUnits(b.netEur.amount) ? 1 : a.k - b.k)[0];
      const mean = (u, n) => n ? divRound(u, BigInt(n) * CENT) * CENT : null;
      const ratio = (a, b) => Number(divRound(a * 100n, b)) / 100;
      const n = rows.length, w = wins.length, l = losses.length;
      return { start: per.start, end, empty: n === 0 && net !== null && net < SCRATCH && net > -SCRATCH,
        days: tradedDays.length, trades: n, won: w, lost: l, flat: n - w - l, cut: null,
        units: { net, realised, gross, fees, winSum, lossSum, startE, endE, dd: drawn ? dd : null, unreal: net === null ? null : net - realised,
          expectancy: mean(realised, n), avgWin: mean(winSum, w), avgLoss: mean(lossSum, l) },
        net: net === null ? null : cents(net), realised: cents(realised), unreal: net === null ? null : cents(net - realised), gross: cents(gross), fees: cents(fees),
        winRate: w + l ? Number(divRound(BigInt(w) * 100n, BigInt(w + l))) : null, small: w + l > 0 && w + l < 30,
        expectancy: n ? Number(divRound(realised, BigInt(n) * CENT)) / 100 : null,
        pf: l ? ratio(winSum, -lossSum) : null, wonEur: cents(winSum), lostEur: cents(-lossSum),
        avgWin: w ? Number(divRound(winSum, BigInt(w) * CENT)) / 100 : null, avgLoss: l ? Number(divRound(lossSum, BigInt(l) * CENT)) / 100 : null,
        sizeRatio: w && l ? ratio(winSum * BigInt(l), -lossSum * BigInt(w)) : null,
        best: display(best), worst: display(worst), dd: drawn ? cents(dd) : null,
        ddPct: drawn && ddPeak ? Number(divRound(dd * 10000n, ddPeak)) / 100 : drawn ? 0 : null, bestDay, worstDay };
    },
  };
}
