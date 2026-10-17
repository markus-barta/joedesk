// Results: the period switch and the desk switch drive every number, all
// from the closed-trade record (results v2) by spec r3 §4.2: the hero with
// its result-so-far chart, eight tiles, By desk, the calendar and a day's
// trades. Before a valid push arrives Results shows its existing unavailable
// state: dashes, never a zero or an estimate.
import { $, $$, icon, term, learnBtn, deskMark, inlineMark, swatch, patch, bn, pl, st, symBadge, ageSpan, statePhrase, openDialog } from './ui.js';
import { TERMS } from './terms.js';
import { esc, eur, digits, pct, money, isZero, MINUS, NB, timeHM, age } from './format.js';
import { cellReason, STALE_AFTER_S } from './health.js';
import { drawChart, eurAxis } from './chart.js';
import { viennaDay } from './time.mjs';
import { decimalUnits, divRound, UNIT } from './contracts/decimal.mjs';
import { basisKey } from './history-model.js';
import * as M from './results-model.js';

export { periodOf } from './results-model.js';
const DESKS = M.DESK_IDS;
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const KEEP_FLOOR = ['SXR8', 'TSLA'];
// The anchor, the selected day and the shown month follow the board's today
// (its clock can arrive after the first render) until the user moves them.
export const RS = { period: 'week', anchor: null, sel: null, desk: 'all', cal: null, moved: false };

// Before the server's clock is known Results labels its calendar by this
// browser's date; no number is shown without a clock, so none depends on it.
export const resultsToday = now => viennaDay(now ?? new Date().toISOString());

// The record, its state and everything the numbers need from the snapshot:
// each desk's money now (only a current value, never a retained one), the
// basis it is on, and History's observations with their bases.
export function resultsView(ctx) {
  const today = resultsToday(ctx.now);
  const cell = ctx.states.results;
  let ix = cell?.value?.index ?? null, reason = cell?.reason ?? (cell?.value ? null : 'feed_not_received');
  // The accepted kept-holdings policy wins: a record that still trades a kept
  // symbol is not authoritative, so nothing is derived from it.
  const keep = [...new Set([...KEEP_FLOOR, ...(ctx.feeds['fleet-config']?.value?.desks.keep ?? [])])];
  if (ix && M.keptInRecord(ix, keep).length) { ix = null; reason = 'source_not_authoritative'; }
  const todayUnits = DESKS.map(id => {
    const c = ctx.states[`desks.${id}.equity`];
    return c?.value && !c.retained ? decimalUnits(c.value.amount) : null;
  });
  const desksNow = ctx.feeds.data?.value?.desks ?? [];
  const current = Object.fromEntries(DESKS.map((id, i) => [id, todayUnits[i] === null ? null : desksNow.find(d => d.id === id) ?? null]));
  const nowMs = ctx.now ? Date.parse(ctx.now) : null, cols = ctx.feeds.history?.value?.columns ?? null;
  return { today, cell, ix, reason, trackingStart: ix?.meta.trackingStart ?? null, todayUnits, nowMs, cols,
    cuts: M.basisCuts(cols, current, nowMs), basis: DESKS.map(id => (current[id] ? basisKey(current[id]) : '')).join('|'), positions: ctx.states.positions?.value ?? [] };
}

export function stepPeriod(dir, view) {
  RS.anchor = RS.sel = M.stepAnchor(RS.period, RS.anchor, dir, view.today, view.trackingStart);
  RS.cal = M.ymOf(RS.anchor);
  RS.moved = true;
}

const D = '<span class="bn muted">—</span>';
const deskSet = () => (RS.desk === 'all' ? DESKS.slice() : [RS.desk]);
const whoOf = desks => (desks.length === 3 ? 'J, Joe and Joel' : LABEL[desks[0]]);
const names = ids => (ids.length === 1 ? LABEL[ids[0]] : `${ids.slice(0, -1).map(d => LABEL[d]).join(', ')} and ${LABEL[ids[ids.length - 1]]}`);
// Money text is formatted from exact units (BigInt), never from a Number.
const absUnits = u => (u < 0n ? -u : u);

// A calendar amount in its cell's room, from exact units and rounded once.
// Desktop (also the week column): "4,10", "123", "12k", "1,2M" … "9e15";
// phones: "1", "4,1", "123", "1k", "1,2k", "12k", "1M", "0,1M" … "9e15",
// with no trailing ",0", the scaled forms a step smaller. Rounded phone zero
// has no sign. Phone cells omit the arrow; the exact amount is in the label
// and the day's trades. Desktop and the week column retain their arrows.
const SCALES = [['k', 3], ['M', 6], ['B', 9], ['T', 12]];
export function calAmount(u, phone = false) {
  const a = absUnits(u), at = (exp, d) => divRound(a * 10n ** BigInt(d), 10n ** BigInt(exp) * UNIT);
  const one = m => phone && m % 10n === 0n ? `${m / 10n}` : `${m / 10n},${m % 10n}`;
  if (phone ? at(0, 1) < 100n : at(0, 2) < 10000n) return { text: phone ? one(at(0, 1)) : digits(u), cls: '' };
  if (at(0, 0) < (phone ? 1000n : 10000n)) return { text: digits(at(0, 0) * UNIT, 0), cls: '' };
  // From here on: a unit with at most two (phones) or three digits, one decimal below 10.
  for (const [unit, exp] of SCALES) {
    if (!phone && exp === 3) { if (at(3, 0) < 1000n) return { text: `${at(3, 0)}k`, cls: '' }; continue; }
    if (at(exp, 1) < 100n) return { text: `${one(at(exp, 1))}${unit}`, cls: phone ? (exp === 3 ? 'sc' : 'sx') : '' };
    if (at(exp, 0) < (phone ? 100n : 1000n)) return { text: `${at(exp, 0)}${unit}`, cls: phone ? (exp === 3 ? 'sc' : 'sx') : '' };
  }
  // Past a thousand (phones: a hundred) trillion: its leading digit and power of ten.
  let e = String(a / UNIT).length - 1, n = at(e, 0);
  if (n >= 10n) n = at(++e, 0);
  return { text: `${n}e${e}`, cls: phone ? 'sx' : '' };
}
const calHtml = (u, phone) => {
  if (isZero(u)) return `<span class="pl">${phone ? '0' : '0,00'}</span>`;
  const { text, cls } = calAmount(u, phone);
  if (phone && text === '0') return '<span class="pl">0</span>';
  return `<span class="pl${cls ? ` ${cls}` : ''}">${phone ? '' : icon(u > 0n ? 'up' : 'down')}${u < 0n ? MINUS : '+'}${text}</span>`;
};
const plain = u => calHtml(u, false);
const compact = u => calHtml(u, true);
const plural = (n, word) => `${n}${NB}${word}${n === 1 ? '' : 's'}`;
const signedWord = u => (isZero(u) ? 'Flat' : u > 0n ? `Up ${eur(absUnits(u))}` : `Down ${eur(absUnits(u))}`);
const startText = ts => (ts ? `${M.fmtDM(ts)} ${ts.slice(0, 4)}` : 'their first trading day');
// A change of bookkeeping basis, said as such.
const cutText = cut => `${names(cut.desks)}’s bookkeeping basis changed on ${M.fmtDDM(M.viennaDate(cut.at))}`;

const missingDay = (ix, k, desks) => ix?.missingDays?.has(k) && M.dayResult(ix, k, desks).count > 0;
const missingDayText = k => `Stale: daily summary missing for ${M.fmtDay(k)}`;
const PARTIAL_REASON = M.PARTIAL_REASON;
const partialDay = (view, k) => k < view.today && view.ix?.partialDays?.has(k);
const partialHint = count => count ? ` · ${st('warn', `incl. ${count} partial day${count === 1 ? '' : 's'}`)}` : '';
// One warning slot, with a missing summary taking priority over partial coverage.
function dayWarning(view, k, desks) {
  if (k >= view.today) return null;
  if (missingDay(view.ix, k, desks)) return { label: 'Stale', text: missingDayText(k), note: 'Daily summary missing.' };
  if (partialDay(view, k)) {
    const reason = M.partialReasonLabel(view.ix.partialDetails?.get(k));
    return k <= M.addDays(view.today, -2)
      ? { label: 'Stale', text: `Stale: still incomplete; ${reason}`, note: PARTIAL_REASON }
      : { label: 'Partial', text: `Partial: this day's record is incomplete. ${reason}`, note: PARTIAL_REASON };
  }
  return null;
}

// The context every number of one render shares (the model builds it).
const numbers = (view, per, desks) => M.moneyContext(view.ix, view, per, desks);

// The 1 s tick changes nothing here but ages: Results is rebuilt only when
// its inputs change (record, snapshot money, History, the controls, the width).
let last = null;
export const forgetResults = () => { last = null; };

export function renderResults(ctx) {
  const view = resultsView(ctx);
  const { today, ix } = view;
  if (!RS.moved || !RS.anchor) { RS.anchor = RS.sel = today; RS.cal = M.ymOf(today); }
  const sig = [ix, view.cols, view.reason, view.cell?.state, today, view.todayUnits.join(), view.basis, view.positions.map(p => `${p.desk}|${p.symbol}|${p.company}|${p.openedAt}`).join(),
    JSON.stringify(RS), $('#curve').clientWidth, $('#daySheet')?.open];
  if (last && sig.every((v, i) => v === last[i])) { renderStatus(view); return; }
  last = sig;
  const per = M.periodOf(RS.period, RS.anchor, today, view.trackingStart);
  const desks = deskSet();
  $$('#periodSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === RS.period)));
  patch($('#deskSeg'), `<button type="button" data-desk="all" aria-pressed="${RS.desk === 'all'}">All desks</button>${DESKS.map(d => `<button type="button" data-desk="${d}" aria-pressed="${RS.desk === d}">${inlineMark(d)}${LABEL[d]}</button>`).join('')}`);
  // The stepper label keeps one width: its widest forms sit invisibly in the same cell.
  patch($('#perLabel'), `<span class="cur">${esc(per.lab)}</span>${['Last week · 28 Sep – 4 Oct', 'This week · 28 Sep – 4 Oct', 'Last month · September', 'Yesterday · Wed 30 Sep', 'All time · since 30 Sep'].map(t => `<span aria-hidden="true">${t}</span>`).join('')}`);
  const stepable = ['day', 'week', 'month'].includes(RS.period);
  $('#prevPer').disabled = !stepable || per.start <= M.firstStep(view.trackingStart);
  $('#nextPer').disabled = !stepable || per.end >= today;
  $('#bdTitle').textContent = `By desk · ${per.head}`;
  const mctx = ix ? numbers(view, per, desks) : null;
  const R = ix ? M.rollup(ix, per, desks, mctx) : null;
  renderHero(view, per, desks, R);
  renderTiles(R);
  renderBreakdown(view, per, desks, ix ? DESKS.map(d => M.rollup(ix, per, [d], numbers(view, per, [d]))).concat(desks.length === 3 ? [R] : [M.rollup(ix, per, DESKS, numbers(view, per, DESKS))]) : null);
  renderCalendar(view, per, desks);
  renderStatus(view);
  renderCurve(view, per, desks, R, mctx);
}

function heroSentence(view, per, R, partialDays) {
  if (!view.ix) return `Results are unavailable: ${cellReason(view.reason)}.`;
  if (R.cut) return `No result ${per.phrase}: ${cutText(R.cut)}, and a change of basis is not a gain or a loss.`;
  if (R.empty) return `No trades${partialDays ? ' recorded' : ''} ${per.phrase}. Paper results start on ${startText(view.trackingStart)}.`;
  if (R.net === null) return `The result ${per.phrase} is not known yet: the desks’ money ${R.end === view.today ? 'now' : `on ${M.fmtDDM(R.end)}`} is not available.`;
  return `${signedWord(R.units.net)} ${per.phrase}.`;
}

export function renderHero(view, per, desks, R) {
  const none = !R || R.empty;
  const partialDays = M.countPartialDays(view.ix, per, view.today);
  const sentence = heroSentence(view, per, R, partialDays);
  patch($('#rheroL'), `
    <div class="hero-k">${icon('results')}<span>${term('result')} · ${esc(whoOf(desks))}</span></div>
    <div class="display">${none || R.net === null ? D : bn(R.units.net)}</div>
    <p class="say">${esc(partialDays ? sentence.replace(/\.$/, '') : sentence)}${partialHint(partialDays)}</p>
    <dl class="split">
      <dt>${term('closed')}</dt><dd>${none ? '—' : pl(R.units.realised)}</dd>
      <dt>${term('stillopen')}</dt><dd>${none || R.unreal === null ? '—' : pl(R.units.unreal)}</dd>
      <dt>${term('beforefees')}</dt><dd>${none ? '—' : pl(R.units.gross)}</dd>
      <dt>${term('fees')}</dt><dd class="num">${none ? '—' : eur(-R.units.fees)}</dd>
    </dl>
    <div class="bench"><span>${term('benchmark')}</span><span class="muted">No index chosen</span></div>`);
}

const TILE_ICON = { trades: 'repeat', won: 'target', avgtrade: 'equal', pf: 'scale', typical: 'updown', besttrade: 'award', dip: 'dip', bestday: 'days' };
const tile = (k, val, mean, foot = 'From closed trades · after fees', tight = false) => `<article class="card tile" role="listitem" data-tile="${k}"><div class="tile-top"><span class="ico-sq">${icon(TILE_ICON[k])}</span><h3>${TERMS[k][0]}</h3>${learnBtn(k)}</div><div class="tval${tight ? ' tight' : ''}">${val}</div><p class="tmean">${mean}</p><div class="tfoot">${icon('receipt')}${foot}</div></article>`;
const two = (a, b) => `${a}<span class="sl">/</span>${b}`;
// Two signed amounts share a tile; long ones step the size down, never clip.
const tightPair = (...values) => values.filter(v => v != null).reduce((n, v) => n + eur(v, true).length, 0) > 17;
const tradeName = t => `${esc(t.symbol)} (${LABEL[t.desk]})`;

// Best and worst day: one value and "only day" for a period with one trading
// day; else both, with their dates (equal days are two days, never one).
export function dayTile(R) {
  if (!R?.bestDay) return { val: D, mean: 'No trading day', tight: false };
  if (R.days === 1) return { val: bn(R.bestDay.units), mean: `${M.fmtDDM(R.bestDay.date)} · only day`, tight: false };
  return { val: two(bn(R.bestDay.units), bn(R.worstDay.units)), mean: `${M.fmtDDM(R.bestDay.date)} · ${M.fmtDDM(R.worstDay.date)}`, tight: tightPair(R.bestDay.units, R.worstDay.units) };
}

function renderTiles(R) {
  if (!R) {
    patch($('#tiles'), Object.keys(TILE_ICON).map(k => tile(k, D, 'Unavailable', k === 'dip' ? 'From the desks’ money' : undefined)).join(''));
    return;
  }
  const n = R.trades, decided = R.won + R.lost, u = R.units;
  const typical = R.avgWin === null && R.avgLoss === null ? D : two(R.avgWin === null ? '—' : bn(u.avgWin), R.avgLoss === null ? '—' : bn(u.avgLoss));
  const extremes = R.best || R.worst ? two(R.best ? bn(R.best.units.net) : '—', R.worst ? bn(R.worst.units.net) : '—') : D;
  const days = dayTile(R);
  patch($('#tiles'), [
    tile('trades', n ? `<span class="num">${n}</span>` : D, n ? `${R.won} won · ${R.lost} lost · ${R.flat} flat` : 'No finished trades'),
    tile('won', R.winRate === null ? D : `<span class="num">${digits(R.winRate, 0)}</span><small>%</small>`, R.winRate === null ? 'Needs a won or lost trade' : `${R.won} of ${decided}${R.small ? ' · small sample' : ''}`),
    tile('avgtrade', R.expectancy === null ? D : bn(u.expectancy), R.expectancy === null ? 'No finished trades'
      : isZero(u.expectancy) ? 'A typical trade breaks even' : u.expectancy > 0n ? 'A typical trade earns' : 'A typical trade loses, after fees'),
    tile('pf', R.pf === null ? D : `<span class="num">${digits(R.pf)}</span>`, R.pf === null ? 'Needs a losing trade' : R.pf > 1 ? 'Above 1: won more than lost' : R.pf < 1 ? 'Below 1: lost more than won' : 'Exactly 1: won as much as lost'),
    tile('typical', typical, R.sizeRatio !== null ? `A win is ${digits(R.sizeRatio)} times a loss` : 'Needs a win and a loss', undefined, tightPair(u.avgWin, u.avgLoss)),
    tile('besttrade', extremes, R.best && R.worst ? `${tradeName(R.best)} · ${tradeName(R.worst)}` : R.best ? `${tradeName(R.best)} · no losing trade` : R.worst ? `No winning trade · ${tradeName(R.worst)}` : 'No finished trades',
      undefined, tightPair(R.best?.units.net, R.worst?.units.net)),
    tile('dip', R.empty || R.dd === null ? D : bn(u.dd), R.empty ? 'No change in this period' : R.cut ? 'Bookkeeping basis changed' : R.dd === null ? 'The desks’ money is not available'
      : R.dd === 0 ? 'Never below its high point' : `${pct(-R.ddPct, 2)} below the high point`, 'From the desks’ money'),
    tile('bestday', days.val, days.mean, undefined, days.tight),
  ].join(''));
}

function renderBreakdown(view, per, desks, rows) {
  const list = [...DESKS.map(d => ({ id: d, name: LABEL[d] })), { id: 'all', name: 'Total' }];
  if (!rows) {
    patch($('#breakdown'), list.map(r => `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}" data-row="${r.id}">
      <div class="who">${r.id === 'all' ? '<span class="dmark" aria-hidden="true"><svg viewBox="0 0 28 28"><use href="#i-logo"/></svg></span>' : deskMark(r.id)}${r.name}</div>
      <div class="track" role="img" aria-label="${r.name}: unavailable"><span class="z"></span></div>
      <div class="val"><span class="muted">—</span></div>
      <div class="facts">Unavailable</div>
    </div>`).join(''));
    return;
  }
  const max = Math.max(...rows.map(x => (x.net === null || x.empty ? 0 : Math.abs(x.net))), 0.01);
  patch($('#breakdown'), list.map((r, i) => {
    const x = rows[i], shown = !x.empty && x.net !== null, w = shown ? Math.abs(x.net) / max * 50 : 0;
    const bar = shown && Math.abs(x.net) >= 0.005 ? `<span class="b" data-v="${x.net}" style="${x.net > 0 ? `left:50%;width:${w.toFixed(3)}%` : `right:50%;width:${w.toFixed(3)}%`};background:${r.id === 'all' ? 'var(--ink-2)' : x.net > 0 ? 'var(--gain)' : 'var(--loss)'}"></span>` : '';
    return `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}" data-row="${r.id}">
      <div class="who">${r.id === 'all' ? '<span class="dmark" aria-hidden="true"><svg viewBox="0 0 28 28"><use href="#i-logo"/></svg></span>' : deskMark(r.id)}${r.name}</div>
      <div class="track" role="img" aria-label="${r.name}: ${x.empty ? 'no change' : x.cut ? 'bookkeeping basis changed' : x.net === null ? 'not known yet' : eur(x.units.net, true)}"><span class="z"></span>${bar}</div>
      <div class="val">${shown ? pl(x.units.net) : '<span class="muted">—</span>'}</div>
      <div class="facts">${x.trades ? `${plural(x.trades, 'trade')} · ${x.winRate === null ? 'none decided' : `${x.winRate}${NB}% won`} · fees ${eur(x.units.fees)}` : 'No trades'}</div>
    </div>`;
  }).join(''));
}

// ---------- Calendar ----------
const maxCache = new WeakMap();
function maxDay(ix, desks) {
  const key = desks.join();
  let byDesks = maxCache.get(ix);
  if (!byDesks) maxCache.set(ix, byDesks = new Map());
  if (!byDesks.has(key)) byDesks.set(key, M.maxAbsDay(ix, desks));
  return byDesks.get(key);
}

// One day's state: future, closed (weekend or a US holiday), before tracking,
// a session without trades, or its trades with their tint (sign + arrow + tint).
function dayState(view, k, desks, max) {
  const { ix, today } = view;
  if (k > today) return { cls: 'fut', note: '', aria: 'still ahead' };
  const r = ix ? M.dayResult(ix, k, desks) : { count: 0 };
  if (r.count) {
    const note = plural(r.count, 'trade');
    if (isZero(r.units)) return { cls: 'flat', r, note, aria: `${money(0)} from ${note}` };
    return { cls: `${r.units > 0n ? 'g' : 'l'}${M.tintStep(r.units, max)}`, r, note, aria: `${eur(r.units, true)} from ${note}` };
  }
  if (partialDay(view, k)) return { cls: 'none', note: 'Partial', aria: 'no complete record', dash: true };
  const closed = M.isWeekend(k) || M.marketHoliday(k);
  if (closed) return { cls: 'we', note: 'closed', aria: M.isWeekend(k) ? 'weekend, markets closed' : 'US market holiday, markets closed' };
  if (!ix) return { cls: 'nw', note: '', aria: 'unavailable', dash: true };
  if (k < view.trackingStart) return { cls: 'we pre', note: '', aria: 'before paper results start' };
  return { cls: 'none', note: 'no trades', aria: 'no trades' };
}

export function renderCalendar(view, per, desks) {
  const { ix, today } = view;
  const [y, m] = RS.cal;
  const first = M.dateKey(y, m, 1);
  patch($('#calTitle'), `<span class="cur">${M.MONTH[m]} ${y}</span><span aria-hidden="true">September 2026</span>`);
  $('#prevMonth').disabled = first <= M.firstStep(view.trackingStart);
  $('#nextMonth').disabled = first >= M.dateKey(...M.ymOf(today), 1);
  const max = ix ? maxDay(ix, desks) : 0n;
  const partialDays = M.countPartialDays(ix, { start: first, end: M.dateKey(y, m, M.daysIn(y, m)) }, today);
  let monthCount = 0, monthUnits = 0n, monthDays = 0;
  if (ix) for (let d = 1; d <= M.daysIn(y, m); d++) {
    const k = M.dateKey(y, m, d), r = M.dayResult(ix, k, desks);
    if (r.count) { monthCount += r.count; monthUnits += r.units; monthDays++; }
  }
  const monthSum = !ix ? 'Unavailable' : monthCount
    ? `${signedWord(monthUnits)} <span class="month-long">over ${plural(monthDays, 'trading day')}</span><span class="month-short">in ${plural(monthDays, 'day')}</span>`
    : partialDays ? 'No trades recorded this month' : 'No trades this month';
  patch($('#calSum'), `${monthSum}${partialHint(partialDays)}`);
  fitMonthSummary($('#calSum'));
  const start = M.monday(first);
  const inPer = k => (RS.period === 'day' || RS.period === 'week') && k >= per.start && k <= per.end;
  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow" role="columnheader">${d}</div>`).join('') + '<div class="dow wkh" role="columnheader">Week</div>';
  for (let r = 0; r < 6; r++) {
    const wk = M.addDays(start, r * 7);
    let inMonth = false, wkCount = 0, wkUnits = 0n, wkDays = 0;
    for (let c = 0; c < 7; c++) {
      const k = M.addDays(wk, c), [cy, cm] = M.ymOf(k);
      if (ix && k <= today) { const res = M.dayResult(ix, k, desks); if (res.count) { wkCount += res.count; wkUnits += res.units; wkDays++; } }
      if (cy !== y || cm !== m) { html += '<div class="cell out" aria-hidden="true"></div>'; continue; }
      inMonth = true;
      const s = dayState(view, k, desks, max);
      const warning = dayWarning(view, k, desks);
      // Both warnings inherit heatmap ink on tinted cells. Only a Partial
      // warning on a neutral no-trade cell uses the warning token.
      const cls = ['cell', s.cls, warning ? 'day-incomplete' : '', k === today ? 'today' : '', k === RS.sel ? 'sel' : '', inPer(k) ? 'inper' : ''].filter(Boolean).join(' ');
      const value = s.r ? `<span class="vl">${plain(s.r.units)}</span><span class="vs">${compact(s.r.units)}</span>` : s.dash ? '<span class="muted">—</span>' : '';
      html += `<button type="button" class="${cls}" data-day="${k}" aria-pressed="${k === RS.sel}" aria-label="${M.fmtDay(k)}${k === today ? ', today' : ''}: ${esc(s.aria)}${warning ? `; ${esc(warning.text)}` : ''}"><span class="d">${Number(k.slice(8))}</span>${warning ? `<span class="day-warning st${warning.label === 'Partial' && s.cls === 'none' ? ' warn' : ''}" title="${esc(warning.text)}" aria-hidden="true">${icon('half')}</span>` : ''}<span class="v">${value}</span><span class="n">${warning ? warning.label : s.note}</span></button>`;
    }
    // A week still ahead has nothing to sum yet.
    const ahead = wk > today;
    const wkValue = ahead ? '<span class="v"></span>' : !ix ? '<span class="v muted">—</span>' : `<span class="v">${wkCount ? plain(wkUnits) : '—'}</span>`;
    html += inMonth ? `<div class="wk"><span>${!ix || ahead ? '' : wkDays ? plural(wkDays, 'day') : 'no trades'}</span>${wkValue}</div>` : '<div class="wk" style="visibility:hidden" aria-hidden="true"></div>';
  }
  patch($('#cal'), html);
  patch($('#calLegend'), `<span class="nowrap">Loss <span class="ramp"><i style="background:var(--l4)"></i><i style="background:var(--l3)"></i><i style="background:var(--l2)"></i><i style="background:var(--l1)"></i></span></span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--flat)"></i></span> Flat</span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--g1)"></i><i style="background:var(--g2)"></i><i style="background:var(--g3)"></i><i style="background:var(--g4)"></i></span> Gain</span>
    <span>${!ix ? 'Tints appear once results arrive' : max > 0n ? `Darkest: ${eur(max * 3n / 4n)} to ${eur(max)} in a day` : 'No trading day yet'}</span>`);
  const day = dayContent(view, RS.sel, desks);
  patch($('#daypanel'), `<div class="dp-head"><h3>Trades on ${M.fmtDDM(RS.sel)}</h3><span class="dp-sum">${day.sum}</span></div><div class="dp-list">${day.body}${dayNote(day)}</div>`);
  fitDaySummary($('#daypanel'));
  const sheet = $('#daySheet');
  if (sheet?.open) {
    $('#sheetTitle').textContent = `Trades on ${M.fmtDDM(RS.sel)}`;
    patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${dayNote(day, true)}`);
    fitDaySummary($('#sheetBody'));
    fitDaySheet(sheet);
  }
}

// Measure in the actual font and available room. Keep fixed line heights;
// shorten the month wording and drop the optional trade count before money.
function fitMonthSummary(el) {
  if (!el?.getBoundingClientRect || !el.clientWidth) return;
  el.classList.remove('compact');
  if (el.parentElement.scrollWidth > el.parentElement.clientWidth) el.classList.add('compact');
}
function fitDaySummary(root) {
  const sum = root?.querySelector?.('.dp-sum'), count = sum?.querySelector('.dp-trades');
  if (!count || !sum.clientWidth) return;
  count.hidden = false;
  const head = root.querySelector('.dp-head');
  if (sum.scrollWidth > sum.clientWidth || (head && head.scrollWidth > head.clientWidth)) count.hidden = true;
}

// ---------- A day's trades ----------
function held(t) {
  const opened = M.viennaDate(t.openedAt);
  if (opened !== t.date) return `held since ${M.fmtDM(opened)}`;
  const min = Math.max(0, Math.round((t.closedAt - t.openedAt) / 60000));
  return `held ${min >= 60 ? `${Math.floor(min / 60)}${NB}h ${min % 60}${NB}min` : `${min}${NB}min`}`;
}
// A price in full, exactly as recorded (at least two decimals).
const price = p => money(decimalUnits(p.amount), p.currency, false, Math.max(2, (p.amount.split('.')[1] ?? '').length));
function tradeRows(ts) {
  return ts.map(t => `<div class="trow" data-trade="${esc(t.id)}">
    ${symBadge(t.symbol, t.desk)}
    <div class="name"><b>${esc(t.symbol)}</b>${t.company ? ` · ${esc(t.company)}` : ''}<span>${inlineMark(t.desk)} ${LABEL[t.desk]} · ${icon(t.side === 'short' ? 'short' : 'long', 'i side')} ${t.side === 'short' ? 'Short' : 'Long'} ${esc(t.quantity.replace('.', ','))} · closed ${timeHM(new Date(t.closedAt).toISOString())}, ${held(t)}</span></div>
    <div class="px"><span class="ln"><span>${price(t.entry)}</span><span>${icon('arrow')}${price(t.exit)}</span></span><span class="fee">fees ${eur(t.units.fees)}</span></div>
    <div class="net">${pl(t.units.net)}</div>
  </div>`).join('');
}

function dayContent(view, k, desks) {
  const { ix, today } = view;
  const ts = ix ? M.tradesOn(ix, k, desks) : [];
  if (!ix) {
    return { sum: '—', body: `<p class="dp-empty">${icon('info')}<span>${k > today ? `${M.fmtDDM(k)} is still ahead.`
      : `No closed-trade record for ${M.fmtDDM(k)}: ${esc(cellReason(view.reason))}.`}</span></p>`, note: '' };
  }
  const r = M.dayResult(ix, k, desks);
  const warning = dayWarning(view, k, desks);
  const partial = k <= today && ix.partialDays?.has(k), incomplete = partial && !ts.length;
  const summary = partial ? ts.length
    ? `<span class="dp-trades">${plural(ts.length, 'trade')} · </span><span class="dp-amount">${eur(r.units, true)} so far</span>`
    : k === today ? 'No trades so far' : 'record incomplete'
    : ts.length ? `${plural(ts.length, 'trade')} · ${eur(r.units, true)}` : 'No trades';
  const sum = warning ? `${st('warn', warning.label)} · ${summary}` : summary;
  const closed = M.isWeekend(k) || M.marketHoliday(k);
  const why = k > today ? `${M.fmtDDM(k)} is still ahead.` : closed ? `No trades on ${M.fmtDDM(k)}: ${M.isWeekend(k) ? 'weekend' : 'US market holiday'}, markets closed.`
    : k < view.trackingStart ? `No trades on ${M.fmtDDM(k)}: paper results start on ${startText(view.trackingStart)}.` : `No trades on ${M.fmtDDM(k)}: the desks sat out.`;
  const body = ts.length ? tradeRows(ts) : incomplete ? '' : `<p class="dp-empty">${icon(closed ? 'clock' : 'info')}<span>${esc(why)}</span></p>`;
  // A lot opened this day and still held counts in Still open and on Desk.
  const opened = (view.positions ?? []).filter(p => p.openedAt && desks.includes(p.desk) && M.viennaDate(Date.parse(p.openedAt)) === k);
  const reasons = partial && !missingDay(ix, k, desks) ? M.partialReasons(ix.partialDetails?.get(k)) : [];
  const note = reasons.length || k === today ? '' : warning?.note ?? (partial ? PARTIAL_REASON : '');
  const positionNote = opened.map(p => `${p.company ? `${p.company} (${p.symbol}, ${LABEL[p.desk]})` : `${p.symbol} (${LABEL[p.desk]})`}, opened ${k === today ? `today at ${timeHM(p.openedAt)}` : 'this day'}, is still open; it counts as Still open and on Desk.`).join(' ');
  return { sum, body, note, reasons, deskNote: partial && desks.length === 1 && (note || reasons.length) ? M.PARTIAL_DESK_NOTE : '', positionNote };
}

// The sheet already has room for every reason. Remove the one-way disclosure
// and focus its first revealed line without scrolling anything under the tap.
export function toggleDayReasons(button) {
  const extra = button.parentElement.querySelector('.dp-reasons-extra');
  if (!extra) return;
  extra.hidden = false;
  button.remove();
  extra.querySelector('.dp-reason')?.focus({ preventScroll: true });
}

function dayNote(day, sheet = false) {
  const { reasons = [], note, deskNote, positionNote } = day;
  const line = (reason, revealed = false) => `<span class="dp-reason"${revealed ? ' tabindex="-1"' : ''}>${esc(reason.text)}</span>`;
  const more = reasons.length - 2;
  const reasonLines = reasons.length ? `<span class="dp-note-lead">Result may be incomplete.</span>${reasons.slice(0, sheet ? 2 : reasons.length).map(reason => line(reason)).join('')}${sheet && more > 0
    ? `<button type="button" class="dp-reasons-more" aria-expanded="false" aria-controls="dayReasonsExtra" aria-label="Show ${more} more reason${more === 1 ? '' : 's'}">+${more} more</button><span class="dp-reasons-extra" id="dayReasonsExtra" aria-live="polite" hidden>${reasons.slice(2).map(reason => line(reason, true)).join('')}</span>` : ''}` : '';
  const explanation = `${reasonLines}${note ? `<span>${esc(note)}</span>` : ''}${deskNote ? `<span class="dp-desk-note">${esc(deskNote)}</span>` : ''}`;
  const content = `${explanation ? `<p class="dp-note-lines">${explanation}</p>` : ''}${positionNote ? `<p class="dp-position-note">${esc(positionNote)}</p>` : ''}`;
  return content ? `<div class="dp-note">${icon('info')}<div class="dp-note-copy">${content}</div></div>` : '';
}

// Measure after the house typography observer joins numbers and units, still
// before paint, so wrapping matches the text that will actually be shown.
// The collapsed body leaves this room at the bottom; CSS caps it at 80vh.
// body.scrollHeight includes the gap before the separate positions paragraph.
function fitDaySheet(sheet) {
  if (!sheet?.getBoundingClientRect) return;
  queueMicrotask(() => {
    if (!sheet.open) return;
    const extra = sheet.querySelector('.dp-reasons-extra'), button = sheet.querySelector('.dp-reasons-more');
    if (extra && !button) return;
    sheet.style.height = '';
    const body = sheet.querySelector('.dlg-b');
    fitDaySummary(body);
    if (!extra || !button) return;
    const head = sheet.querySelector('.dlg-h'), collapsed = body.scrollHeight;
    extra.hidden = false;
    button.hidden = true;
    const height = Math.ceil(head.getBoundingClientRect().height + Math.max(collapsed, body.scrollHeight));
    extra.hidden = true;
    button.hidden = false;
    sheet.style.height = `${height}px`;
  });
}

// Opened by a tap, focus goes to the sheet's heading without a ring; from the
// keyboard, to its close button with the ring (ui.js openDialog).
export function openDaySheet(view, k, { pointer = false } = {}) {
  const sheet = $('#daySheet');
  if (!sheet) return;
  const day = dayContent(view, k, deskSet());
  $('#sheetTitle').textContent = `Trades on ${M.fmtDDM(k)}`;
  // Rebuild even when patch's cached source matches the last opening: the
  // disclosure may have removed itself from that DOM in the meantime.
  patch($('#sheetBody'), '');
  patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${dayNote(day, true)}`);
  openDialog(sheet, { pointer });
  fitDaySummary($('#sheetBody'));
  fitDaySheet(sheet);
}

// ---------- The record's own state, inside the chart's fixed box ----------
function renderStatus(view) {
  const cell = view.cell, el = $('#resStatus');
  if (!el) return;
  if (!view.ix || !cell || cell.state === 'fresh') { patch(el, ''); return; }
  const p = statePhrase(cell, 'res', 'last good results');
  const why = cell.reason ? esc(cellReason(cell.reason)) : null;
  const ago = () => ageSpan('res', cell.ageSeconds == null ? 'an unknown time' : `${age(cell.ageSeconds)} ago`);
  const text = cell.retained ? `${cell.reason === 'sequence_replayed' ? 'Results update not used' : 'Results refresh failed'}: ${why ?? 'not available'}. Showing the last good results from ${ago()}.`
    : p.state === 'stale' ? `Results as of ${ago()}${why ? ` · ${why}` : ''}.` : `Results: ${why ?? 'not available'} · as of ${ago()}.`;
  const stale = p.state === 'stale' || cell.ageSeconds >= STALE_AFTER_S;
  patch(el, `<div class="res-state" data-state="${p.state}">${st(p.tone, `${stale ? 'Stale · ' : ''}${text}`)}</div>`);
}

// ---------- The hero chart: result so far, from € 0 ----------
function renderCurve(view, per, desks, R, mctx) {
  const el = $('#curve'), color = desks.length === 1 ? `var(--desk-${desks[0]})` : 'var(--accent)';
  patch($('#curveLegend'), `<span class="lg"><b class="lg-b">${term('result', 'Result')} so far · ${esc(per.head)}</b></span><span class="lg">${swatch(color)}${esc(whoOf(desks))}</span><span class="lg">${swatch('var(--ink-3)', '', 1.4)}Zero</span><span class="lg muted">${swatch('var(--est)', '1 3.5', 1.6)}No index chosen</span>`);
  const top = 12 + Math.ceil($('#resStatus')?.offsetHeight ?? 0);
  if (!view.ix) {
    drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: 'Results are unavailable', label: 'Result so far: unavailable', pad: { t: top } });
    return;
  }
  const c = M.curve(view.ix, per, desks, mctx);
  const pts = c.pts, known = pts.filter(p => p.v !== null);
  if (c.cut) {
    drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: cutText(c.cut), label: `Result so far, ${per.lab}: not shown, ${cutText(c.cut)}`, pad: { t: top } });
    return;
  }
  if (R.empty || known.length < 2) {
    drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: R.net === null && !R.empty ? 'The desks’ money is not available' : 'No change in this period', label: `Result so far, ${per.lab}: ${R.empty ? 'no change' : 'not known yet'}`, pad: { t: top } });
    return;
  }
  // Trades closed at each intraday point, for the crosshair.
  const closes = c.day && !c.edges ? M.tradesOn(view.ix, per.start, desks) : [];
  const lab = (p, i) => {
    if (c.day) {
      if (p.edge) return p.edge === 'start' ? 'Start of day' : p.edge === 'now' ? 'Now' : 'Close';
      const prev = i > 0 ? pts[i - 1].at : -Infinity, sym = closes.filter(t => t.closedAt > prev && t.closedAt <= p.at).map(t => t.symbol);
      return `${timeHM(new Date(p.at).toISOString())}${p.now ? ', now' : ''}${sym.length ? ` · ${sym.join(', ')} closed` : ''}`;
    }
    return p.gap ? '' : p.edge === 'start' ? 'Start of period' : p.edge === 'tracking' ? `Tracking from ${M.fmtDM(p.k)}` : p.now ? 'Today, now' : M.fmtDDM(p.k);
  };
  pts.forEach((p, i) => { p.lab = lab(p, i); });
  const axisText = p => (c.day ? (p.edge ? (p.edge === 'start' ? 'start' : p.edge) : timeHM(new Date(p.at).toISOString())) : p.edge === 'start' ? 'start' : M.fmtDM(p.k));
  // The axis is real time: the period's own span (Day: its points), labelled at
  // the first and last points and the point nearest the middle, if it is clear of both.
  const [x0, x1] = c.domain, span = x1 - x0 || 1;
  const first = known[0], last = known[known.length - 1];
  const middle = known.reduce((a, p) => (Math.abs(p.x - (x0 + x1) / 2) < Math.abs(a.x - (x0 + x1) / 2) ? p : a));
  const marks = [first, ...(middle.x - first.x > span / 5 && last.x - middle.x > span / 5 ? [middle] : []), last];
  const trackAt = c.day ? (view.trackingStart && per.start <= view.trackingStart ? x0 : null) : c.tracking;
  drawChart(el, {
    series: [{ pts, color, live: per.end >= view.today }], xDomain: [x0, x1], zero: true, strongZero: true, yFmt: eurAxis, ticks: 4,
    // Honest scale: zero is always in view, and the span is at least ±0,5 % of the
    // desks' money at the period start, so a few euros never look like a crash.
    base: M.unitsCents(c.startE), pad: { t: top },
    xLabels: marks.map((p, i, list) => ({ x: p.x, text: axisText(p), anchor: i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle' })),
    marker: trackAt !== null && trackAt !== undefined ? { x: trackAt, text: `tracking from ${M.fmtDM(view.trackingStart)}` } : null,
    label: `Result so far, ${per.lab}: ${R.net === null ? 'not known yet' : eur(R.units.net, true)}`,
    tipFmt: n => `<b>${esc(n[0].lab)}</b> · result so far ${eur(n[0].u ?? n[0].v, true)}`,
  });
}
