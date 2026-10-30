// Results: the period switch and the desk switch drive every number, all
// from the closed-trade record (results v2) by spec r3 §4.2: the hero with
// its result-so-far chart, eight tiles, By desk, the calendar and a day's
// trades, laid out as the approved board design. Before a valid push arrives
// Results shows its existing unavailable state: dashes, never a zero or an
// estimate.
import { $, $$, icon, term, deskMark, inlineMark, swatch, patch, bn, pl, st, symBadge, ageSpan, statePhrase, openDialog } from './ui.js';
import { TERMS } from './terms.js';
import { esc, eur, digits, pct, money, isZero, MINUS, NB, timeHM, age, quantity, currencySymbol } from './format.js';
import { cellReason, STALE_AFTER_S } from './health.js';
import { drawChart, eurAxis } from './chart.js';
import { decimalUnits, divRound, UNIT } from './contracts/decimal.mjs';
import { basisKey } from './history-model.js';
import { percentHtml } from './desk.js';
import { exactCell } from './performance.js';
import { outageValue } from './board-state.js';
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
// All instant-derived keys use the index's padded, era-aware conversion.
// Calendar keys use M.dateKey/addDays, sharing that same canonical form.
const dateKeyAt = instant => M.viennaDate(instant);
export const resultsToday = now => dateKeyAt(Date.parse(now ?? new Date().toISOString()));

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
  const todayUnits = DESKS.map(id => exactCell(ctx.states[`desks.${id}.equity`]));
  const moneyCells = DESKS.map(id => ctx.states[`desks.${id}.equity`]);
  const desksNow = ctx.feeds.data?.value?.desks ?? [];
  const current = Object.fromEntries(DESKS.map((id, i) => [id, todayUnits[i] === null ? null : desksNow.find(d => d.id === id) ?? null]));
  const nowMs = ctx.now ? Date.parse(ctx.now) : null, cols = ctx.feeds.history?.value?.columns ?? null;
  const positionsCell = ctx.states.positions;
  // A current contribution note needs current, nonzero desk holdings. Retained
  // observations stay on Desk with their own age/reason, outside this claim.
  const positions = positionsCell?.state === 'fresh' && !outageValue(positionsCell)
    ? (positionsCell.value ?? []).filter(p => p.scope === 'stage0' && DESKS.includes(p.desk) && !keep.includes(p.symbol)
      && p.quantity != null && decimalUnits(p.quantity) !== 0n) : [];
  return { today, clock: Boolean(ctx.now), cell, ix, reason, trackingStart: ix?.meta.trackingStart ?? null, todayUnits, moneyCells, nowMs, cols,
    cuts: M.basisCuts(cols, current, nowMs), basis: DESKS.map(id => (current[id] ? basisKey(current[id]) : '')).join('|'), positionsCell, positions };
}

// ---------- What the controls change (app.js) ----------
// The selected day always lies inside the shown period (All takes any day),
// so one date names both and a link restores exactly what was shown. Days
// still ahead are not selectable, as the stepper stops at today. A user's
// own change also drops a link that is still waiting (below).
export function stepPeriod(dir, view) {
  pendingRoute = null;
  RS.anchor = RS.sel = M.stepAnchor(RS.period, RS.anchor, dir, view.today, view.trackingStart);
  RS.cal = M.ymOf(RS.anchor);
  RS.moved = true;
}

// Day, Week and Month show the one that contains the selected day. This year
// is this calendar year, as its tab says (an earlier year comes only from a
// link or a day of that year), so a day of another year gives way to today.
// All holds every day.
function setPeriod(period, today) {
  const sel = RS.sel ?? today;
  RS.period = period;
  if (period === 'ytd' && M.ymOf(sel)[0] !== M.ymOf(today)[0]) {
    RS.anchor = RS.sel = today; RS.cal = M.ymOf(today); RS.moved = false;
    return;
  }
  RS.anchor = period === 'all' ? today : sel;
}

export function choosePeriod(period, view) {
  pendingRoute = null;
  setPeriod(period, view.today);
}

export function chooseDesk(desk) {
  pendingRoute = null;
  RS.desk = desk;
}

// Returns whether the day became the selected one: a link can name every
// day the calendar lets you select, and nothing after today.
export function selectDay(k, view) {
  if (!k || M.compareDates(k, view.today) > 0 || M.compareDates(k, M.firstStep(view.trackingStart)) < 0) return false;
  pendingRoute = null;
  RS.sel = k;
  // The period follows the day: Day that day, Week and Month the ones that
  // contain it, This year its calendar year. All keeps the whole record.
  if (RS.period !== 'all') RS.anchor = k;
  RS.moved = k !== view.today;
  return true;
}

export function showMonth(dir) {
  pendingRoute = null;
  const [y, m] = RS.cal;
  RS.cal = dir < 0 ? (m ? [y, m - 1] : [y - 1, 11]) : (m === 11 ? [y + 1, 0] : [y, m + 1]);
  RS.moved = true;
}

// ---------- Deep links (README: Results deep links) ----------
// A link from outside waits until the record's tracking start and the server's
// date are known: a cold load starts before either, and the browser's date
// or a fallback start could reject a valid link. Then it is checked and
// applied once. A newer address replaces it, even one that names nothing;
// a user's change drops it. Returns whether a link waits.
let pendingRoute = null;
export function requestResultsRoute(query) {
  const route = M.parseResultsRoute(query);
  pendingRoute = route.period || route.date || route.desk ? query : null;
  return pendingRoute !== null;
}
export const resultsRoutePending = () => pendingRoute !== null;
export function settleResultsRoute(view) {
  if (pendingRoute === null || !view.clock || !view.ix) return false;
  const query = pendingRoute;
  pendingRoute = null;
  return applyResultsRoute(query, view);
}

// A link sets what it names. Each missing or invalid part keeps the current
// view, which on a fresh page is This week, today and All desks; a date after
// today or before the first step is invalid too. Returns whether it applied.
export function applyResultsRoute(query, view) {
  const route = M.parseResultsRoute(query), today = view.today;
  const date = route.date && M.compareDates(route.date, today) <= 0 && M.compareDates(route.date, M.firstStep(view.trackingStart)) >= 0 ? route.date : null;
  if (!route.period && !route.desk && !date) return false;
  if (route.desk) RS.desk = route.desk;
  if (date) {
    // The date becomes the selected day and the period the one that contains
    // it (an earlier calendar year too); a link to today keeps following the
    // board's today.
    RS.period = route.period ?? RS.period;
    RS.anchor = RS.period === 'all' ? today : date;
    RS.sel = date;
    RS.cal = M.ymOf(date);
    RS.moved = date !== today;
  } else if (route.period) setPeriod(route.period, today);
  return true;
}

// The view as its canonical link: the period, the selected day (which lies
// inside it) and the desk.
export function resultsUrl(view) {
  return `#results?${M.resultsRoute({ period: RS.period, date: RS.sel ?? RS.anchor ?? view.today, desk: RS.desk })}`;
}

const D = '<span class="bn muted">—</span>';
const deskSet = () => (RS.desk === 'all' ? DESKS.slice() : [RS.desk]);
const whoOf = desks => (desks.length === 3 ? 'All desks' : LABEL[desks[0]]);
// A signed amount that never wraps or parts from its sign, coloured by its sign.
const signed = u => (isZero(u) ? `<span class="nw">${money(0)}</span>` : `<span class="nw ${u > 0n ? 'gain' : 'loss'}">${eur(u, true)}</span>`);
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
const startText = ts => (ts ? `${M.fmtDM(ts)} ${M.ymOf(ts)[0]}` : 'their first trading day');
// A change of bookkeeping basis, said as such.
const cutText = cut => `${names(cut.desks)}’s bookkeeping basis changed on ${M.fmtDDM(dateKeyAt(cut.at))}`;

const missingDay = (ix, k, desks) => ix?.missingDays?.has(k) && M.dayResult(ix, k, desks).count > 0;
const missingDayText = k => `Stale: daily summary missing for ${M.fmtDay(k)}`;
const PARTIAL_REASON = M.PARTIAL_REASON;
const partialDay = (view, k) => M.compareDates(k, view.today) < 0 && view.ix?.partialDays?.has(k);
const partialHint = count => count ? ` ${st('warn', `incl. ${count} partial day${count === 1 ? '' : 's'}`)}` : '';
// One warning slot, with a missing summary taking priority over partial coverage.
function dayWarning(view, k, desks) {
  if (M.compareDates(k, view.today) >= 0) return null;
  if (missingDay(view.ix, k, desks)) return { label: 'Stale', text: missingDayText(k), note: 'Daily summary missing.' };
  if (partialDay(view, k)) {
    const reason = M.partialReasonLabel(view.ix.partialDetails?.get(k));
    return M.compareDates(k, M.addDays(view.today, -2)) <= 0
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
  // A waiting link applies against the authoritative today and tracking start.
  settleResultsRoute(view);
  const sig = [ix, view.cols, view.reason, view.cell?.state, today, view.todayUnits.join(), view.moneyCells.map(c => c?.reason).join(), view.basis, view.positions.map(p => `${p.desk}|${p.symbol}|${p.company}|${p.openedAt}`).join(),
    JSON.stringify(RS), $('#curve').clientWidth, $('#daySheet')?.open];
  // While a link waits, the address keeps it (app.js writes nothing).
  const address = () => (pendingRoute === null ? resultsUrl(view) : '');
  if (last && sig.every((v, i) => v === last[i])) { renderStatus(view); return address(); }
  last = sig;
  const per = M.periodOf(RS.period, RS.anchor, today, view.trackingStart);
  const desks = deskSet();
  $$('#periodSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === RS.period)));
  patch($('#deskSeg'), `<button type="button" data-desk="all" aria-pressed="${RS.desk === 'all'}">All desks</button>${DESKS.map(d => `<button type="button" data-desk="${d}" aria-pressed="${RS.desk === d}">${inlineMark(d)}${LABEL[d]}</button>`).join('')}`);
  // The stepper label keeps one width: its widest forms sit invisibly in the same cell.
  patch($('#perLabel'), `<span class="cur">${esc(per.lab)}</span>${['Last week · 28 Sep – 4 Oct', 'This week · 28 Sep – 4 Oct', 'Last month · September', 'Yesterday · Wed 30 Sep', 'All time · since 30 Sep'].map(t => `<span aria-hidden="true">${t}</span>`).join('')}`);
  const stepable = ['day', 'week', 'month'].includes(RS.period);
  $('#prevPer').disabled = !stepable || M.compareDates(per.start, M.firstStep(view.trackingStart)) <= 0;
  $('#nextPer').disabled = !stepable || M.compareDates(per.end, today) >= 0;
  $('#bdTitle').textContent = `By desk · ${per.head}`;
  const mctx = ix ? numbers(view, per, desks) : null;
  const R = ix ? M.rollup(ix, per, desks, mctx) : null;
  renderHero(view, per, desks, R);
  renderTiles(R);
  renderBreakdown(view, per, desks, ix ? DESKS.map(d => M.rollup(ix, per, [d], numbers(view, per, [d]))).concat(desks.length === 3 ? [R] : [M.rollup(ix, per, DESKS, numbers(view, per, DESKS))]) : null);
  renderCalendar(view, per, desks);
  renderStatus(view);
  renderCurve(view, per, desks, R, mctx);
  return address();
}

const cutSentence = (phrase, cut) => `No result ${phrase}: ${cutText(cut)}, and a change of basis is not a gain or a loss.`;
const unknownSentence = (phrase, when) => `The result ${phrase} is not known yet: the desks’ money ${when} is not available.`;
function heroSentence(view, per, R, partialDays) {
  if (!view.ix) return `Results are unavailable: ${cellReason(view.reason)}.`;
  if (R.cut) return cutSentence(per.phrase, R.cut);
  if (R.empty) return `No trades${partialDays ? ' recorded' : ''} ${per.phrase}. Paper results start on ${startText(view.trackingStart)}.`;
  if (R.net === null) return unknownSentence(per.phrase, R.end === view.today ? 'now' : `on ${M.fmtDDM(R.end)}`);
  return `${signedWord(R.units.net)} ${per.phrase}.`;
}

// The two explanations can outgrow the three-line sentence row (a change of
// basis across all three desks, an unknown result on a past date). Their
// widest forms sit invisibly in the same cell, so the split starts below the
// longest copy of that state wherever it shows: nothing overlaps, and
// switching period or desk within the state moves nothing. Widest forms:
// all three desks, a Wednesday in May (the widest weekday and month), and
// each of the widest period phrases (an older week, a month of another year,
// a past day), whose line breaks differ.
const WIDE_DATE = `Wed 27${NB}May`;
const WIDE_PHRASES = [`in the week of 25${NB}May`, 'in September 2025', `on ${WIDE_DATE}`];
const WIDE_CUT = { desks: DESKS, at: Date.parse('2026-05-27T12:00:00.000Z') };
const SENTENCE_RESERVE = {
  cut: WIDE_PHRASES.map(phrase => cutSentence(phrase, WIDE_CUT)),
  unknown: WIDE_PHRASES.map(phrase => unknownSentence(phrase, `on ${WIDE_DATE}`)),
};
export const sentenceReserve = (view, R) => (!view.ix || !R ? [] : R.cut ? SENTENCE_RESERVE.cut : !R.empty && R.net === null ? SENTENCE_RESERVE.unknown : []);

// The hero names what it shows (result, desks, period) above the figure, its
// percentage with the base it divides by, the sentence and the split. Each row
// keeps a fixed line box, so no sentence or amount moves another row.
export function renderHero(view, per, desks, R) {
  const none = !R || R.empty;
  // One quote: the percentage and the money it divides by. A second prefix
  // search would repeat the work periodPercent already does.
  const { percent, base } = M.periodQuote(view.ix, view, per, desks, R);
  const baseText = base === null ? '' : eur(base);
  const percentMarkup = percentHtml(percent);
  const percentDigits = percent === null ? 1 : digits(percent * UNIT / 100n, 2).length + (percent ? 1 : 0) + 2 + (baseText ? 4 + baseText.length : 0);
  const resultDigits = none || R.net === null ? 1 : eur(R.units.net, true).length;
  // Coverage qualifies a stated result, not an explanation of a missing one.
  const partialDays = view.ix && !R.cut && (R.empty || R.net !== null) ? M.countPartialDays(view.ix, per, view.today) : 0;
  const sentence = heroSentence(view, per, R, partialDays), reserve = sentenceReserve(view, R);
  patch($('#rheroL'), `
    <div class="hero-k">${icon('results')}<span>${term('result')} · ${esc(whoOf(desks))} · ${esc(per.head)}</span></div>
    <div class="result-figure" role="group" aria-label="Period result" style="--result-digits:${resultDigits};--percent-digits:${percentDigits}">
      <div class="display">${none || R.net === null ? D : bn(R.units.net)}</div>
      <div class="period-percent-slot">${percentMarkup}${percent === null ? '' : ` <button type="button" class="term of" data-term="result">of <span class="nw">${esc(baseText)}</span></button><span class="vh">, the money at the period start</span>`}</div>
    </div>
    <p class="say">${esc(partialDays ? sentence.replace(/\.$/, '') : sentence)}${partialHint(partialDays)}</p>${reserve.length
      ? `<p class="say-size" aria-hidden="true">${reserve.map(copy => `<span>${esc(copy)}</span>`).join('')}</p>` : ''}
    <dl class="split">
      <dt>${term('closed')}</dt><dd>${none ? '—' : signed(R.units.realised)}</dd>
      <dt>${term('stillopen')}</dt><dd>${none || R.unreal === null ? '—' : signed(R.units.unreal)}</dd>
      <dt>${term('beforefees')}</dt><dd>${none ? '—' : signed(R.units.gross)}</dd>
      <dt>${term('fees')}</dt><dd class="num">${none ? '—' : `<span class="nw">${eur(-R.units.fees)}</span>`}</dd>
    </dl>`);
}

// The eight tiles: a title with its explanation behind the info control, one
// value that steps its size down to the tile's width (never clips) and what
// it means. Their order and meanings follow spec r3 §4.2.
const TILES = ['trades', 'won', 'avgtrade', 'pf', 'typical', 'besttrade', 'dip', 'bestday'];
const size = html => Math.max(1, html.replace(/<[^>]*>/g, '').length);
const tile = (k, val, mean) => `<article class="card tile" role="listitem" data-tile="${k}"><div class="tile-top"><h3>${TERMS[k][0]}</h3><button type="button" class="learn metric-info" data-term="${k}" data-learn="1" aria-expanded="false" aria-label="Learn about ${TERMS[k][0]}">${icon('info')}</button></div><div class="tval" style="--characters:${size(val)}">${val}</div><p class="tmean">${mean}</p></article>`;
// Two signed amounts share a tile: one line where there is room, else one
// line each (phones). Each part carries its own length for that case.
const two = (a, b) => `<span class="pair-value" style="--characters:${size(a)}">${a}</span><span class="pair-value" style="--characters:${size(b) + 1}"><span class="sl">/</span>${b}</span>`;
const tradeName = t => `${esc(t.symbol)} (${LABEL[t.desk]})`;

// Best and worst day: one value and "only day" for a period with one trading
// day; else both, with their dates (equal days are two days, never one).
export function dayTile(R) {
  if (!R?.bestDay) return { val: D, mean: 'No trading day' };
  if (R.days === 1) return { val: bn(R.bestDay.units), mean: `${M.fmtDDM(R.bestDay.date)} · only day` };
  return { val: two(bn(R.bestDay.units), bn(R.worstDay.units)), mean: `${M.fmtDDM(R.bestDay.date)} · ${M.fmtDDM(R.worstDay.date)}` };
}

function renderTiles(R) {
  if (!R) {
    patch($('#tiles'), TILES.map(k => tile(k, D, 'Unavailable')).join(''));
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
    tile('typical', typical, R.sizeRatio !== null ? `A win is ${digits(R.sizeRatio)} times a loss` : 'Needs a win and a loss'),
    tile('besttrade', extremes, R.best && R.worst ? `${tradeName(R.best)} · ${tradeName(R.worst)}` : R.best ? `${tradeName(R.best)} · no losing trade` : R.worst ? `No winning trade · ${tradeName(R.worst)}` : 'No finished trades'),
    tile('dip', R.empty || R.dd === null ? D : bn(u.dd), R.empty ? 'No change in this period' : R.cut ? 'Bookkeeping basis changed' : R.dd === null ? 'The desks’ money is not available'
      : R.dd === 0 ? 'Never below its high point' : `${pct(-R.ddPct, 2)} below the high point`),
    tile('bestday', days.val, days.mean),
  ].join(''));
}

// Every desk and All desks on one scale; the row of the chosen desks is tinted.
function renderBreakdown(view, per, desks, rows) {
  const list = [...DESKS.map(d => ({ id: d, name: LABEL[d] })), { id: 'all', name: 'All desks' }];
  const who = r => `<div class="who">${r.id === 'all' ? '' : deskMark(r.id)}${r.name}</div>`;
  if (!rows) {
    patch($('#breakdown'), list.map(r => `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}" data-row="${r.id}">
      ${who(r)}
      <div class="track" role="img" aria-label="${r.name}: unavailable"><span class="z"></span></div>
      <div class="val"><span class="muted">—</span></div>
      <div class="facts">Unavailable</div>
    </div>`).join(''));
    return;
  }
  const max = Math.max(...rows.map(x => (x.net === null || x.empty ? 0 : Math.abs(x.net))), 0.01);
  patch($('#breakdown'), list.map((r, i) => {
    const x = rows[i], shown = !x.empty && x.net !== null, w = shown ? Math.abs(x.net) / max * 50 : 0;
    const bar = shown && Math.abs(x.net) >= 0.005 ? `<span class="b" data-v="${x.net}" style="${x.net > 0 ? `left:50%;width:${w.toFixed(3)}%` : `right:50%;width:${w.toFixed(3)}%`};background:${x.net > 0 ? 'var(--gain)' : 'var(--loss)'}"></span>` : '';
    return `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}" data-row="${r.id}">
      ${who(r)}
      <div class="track" role="img" aria-label="${r.name}: ${x.empty ? 'no change' : x.cut ? 'bookkeeping basis changed' : x.net === null ? 'not known yet' : eur(x.units.net, true)}"><span class="z"></span>${bar}</div>
      <div class="val">${shown ? pl(x.units.net) : '<span class="muted">—</span>'}</div>
      <div class="facts">${x.trades ? `${plural(x.trades, 'trade')} · ${x.winRate === null ? 'none decided' : `${x.winRate}${NB}% won`} · fees <span class="nw">${eur(x.units.fees)}</span>` : 'No trades'}</div>
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
  if (M.compareDates(k, today) > 0) return { cls: 'fut', note: '', aria: 'still ahead' };
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
  if (M.compareDates(k, view.trackingStart) < 0) return { cls: 'we pre', note: '', aria: 'before paper results start' };
  return { cls: 'none', note: 'no trades', aria: 'no trades' };
}

export function renderCalendar(view, per, desks) {
  const { ix, today } = view;
  const [y, m] = RS.cal;
  const first = M.dateKey(y, m, 1);
  patch($('#calTitle'), `<span class="cur">${M.MONTH[m]} ${y}</span><span aria-hidden="true">September 2026</span>`);
  $('#prevMonth').disabled = M.compareDates(first, M.firstStep(view.trackingStart)) <= 0;
  $('#nextMonth').disabled = M.compareDates(first, M.dateKey(...M.ymOf(today), 1)) >= 0;
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
  const start = M.monday(first);
  const inPer = k => (RS.period === 'day' || RS.period === 'week') && M.compareDates(k, per.start) >= 0 && M.compareDates(k, per.end) <= 0;
  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow" aria-hidden="true">${d}</div>`).join('') + '<div class="dow wkh" aria-hidden="true">Week</div>';
  for (let r = 0; r < 6; r++) {
    const wk = M.addDays(start, r * 7);
    let inMonth = false, wkCount = 0, wkUnits = 0n, wkDays = 0;
    for (let c = 0; c < 7; c++) {
      const k = M.addDays(wk, c), [cy, cm] = M.ymOf(k);
      if (ix && M.compareDates(k, today) <= 0) { const res = M.dayResult(ix, k, desks); if (res.count) { wkCount += res.count; wkUnits += res.units; wkDays++; } }
      if (cy !== y || cm !== m) { html += '<div class="cell out" aria-hidden="true"></div>'; continue; }
      inMonth = true;
      const s = dayState(view, k, desks, max);
      const warning = dayWarning(view, k, desks);
      // Both warnings inherit heatmap ink on tinted cells. Only a Partial
      // warning on a neutral no-trade cell uses the warning token.
      const cls = ['cell', s.cls, warning ? 'day-incomplete' : '', k === today ? 'today' : '', k === RS.sel ? 'sel' : '', inPer(k) ? 'inper' : ''].filter(Boolean).join(' ');
      const value = s.r ? `<span class="vl">${plain(s.r.units)}</span><span class="vs">${compact(s.r.units)}</span>` : s.dash ? '<span class="muted">—</span>' : '';
      html += `<button type="button" class="${cls}" data-day="${k}"${s.cls === 'fut' ? ' disabled' : ''} aria-pressed="${k === RS.sel}" aria-label="${M.fmtDay(k)}${k === today ? ', today' : ''}: ${esc(s.aria)}${warning ? `; ${esc(warning.text)}` : ''}"><span class="d"><span class="agenda-date">${M.fmtDDM(k)}</span><span class="grid-date">${M.dayOf(k)}</span></span>${warning ? `<span class="day-warning st${warning.label === 'Partial' && s.cls === 'none' ? ' warn' : ''}" title="${esc(warning.text)}" aria-hidden="true">${icon('half')}</span>` : ''}<span class="v">${value}</span><span class="n">${warning ? warning.label : s.note}</span></button>`;
    }
    // A week still ahead has nothing to sum yet.
    const ahead = M.compareDates(wk, today) > 0;
    const wkValue = ahead ? '<span class="v"></span>' : !ix ? '<span class="v muted">—</span>' : `<span class="v">${wkCount ? plain(wkUnits) : '—'}</span>`;
    html += inMonth ? `<div class="wk" role="group" aria-label="Week of ${M.fmtDay(wk)}"><span>${!ix || ahead ? '' : wkDays ? plural(wkDays, 'day') : 'no trades'}</span>${wkValue}</div>` : '<div class="wk" style="visibility:hidden" aria-hidden="true"></div>';
  }
  patch($('#cal'), html);
  patch($('#calLegend'), `<span class="nowrap">Loss <span class="ramp"><i style="background:var(--l4)"></i><i style="background:var(--l3)"></i><i style="background:var(--l2)"></i><i style="background:var(--l1)"></i></span></span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--flat)"></i></span> Flat</span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--g1)"></i><i style="background:var(--g2)"></i><i style="background:var(--g3)"></i><i style="background:var(--g4)"></i></span> Gain</span>
    <span>${!ix ? 'Tints appear once results arrive' : max > 0n ? `Darkest: ${eur(max * 3n / 4n)} to ${eur(max)} in a day` : 'No trading day yet'}</span>`);
  const day = dayContent(view, RS.sel, desks);
  patch($('#daypanel'), `<div class="dp-head"><h3>Trades on ${M.fmtDDM(RS.sel)}</h3><span class="dp-sum">${day.sum}</span></div><div class="dp-list">${day.body}${dayNote(day)}${currencyNote(day)}</div>`);
  const roots = [$('#daypanel')];
  const sheet = $('#daySheet');
  if (sheet?.open) {
    $('#sheetTitle').textContent = `Trades on ${M.fmtDDM(RS.sel)}`;
    patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${dayNote(day, true)}${currencyNote(day)}`);
    roots.push($('#sheetBody'));
  }
  fitLayouts(roots, $('#calSum'), sheet?.open ? sheet : null);
}

// Measure full wording and the visible count on natural-state copies in
// the very same read pass as the trades; the live summary is never reset.
function prepareMonthSummary(el, copies) {
  if (!el?.cloneNode || !styleOf(el) || styleOf(el).display === 'none') return () => () => {};
  const parent = measurementCopy(el.parentElement, copies);
  const sum = parent.querySelector('#calSum');
  token(sum, 'compact', false);
  return () => {
    const compact = Boolean(sum.clientWidth && parent.scrollWidth > parent.clientWidth);
    return () => token(el, 'compact', compact);
  };
}
function prepareDaySummary(root, copies) {
  const sum = root?.querySelector?.('.dp-sum'), count = sum?.querySelector('.dp-trades');
  if (!count || !sum.cloneNode || !styleOf(sum)) return () => () => {};
  const head = root.querySelector('.dp-head');
  const copy = measurementCopy(head ?? sum, copies);
  const nextSum = head ? copy.querySelector('.dp-sum') : copy;
  nextSum.querySelector('.dp-trades').hidden = false;
  return () => {
    const hidden = Boolean(nextSum.clientWidth && (nextSum.scrollWidth > nextSum.clientWidth || (head && copy.scrollWidth > copy.clientWidth)));
    return Object.assign(() => { if (count.hidden !== hidden) count.hidden = hidden; }, { summary: sum, hidden });
  };
}

// ---------- A day's trades ----------
export const stripSoftHyphens = text => text.replaceAll('\u00ad', '').replaceAll('\u00a0', ' ');
export function copyDayText(event) {
  const root = event.currentTarget, selection = root.ownerDocument.getSelection();
  if (!event.clipboardData || !selection || selection.isCollapsed || !selection.rangeCount) return;
  for (let i = 0; i < selection.rangeCount; i++) {
    if (!root.contains(selection.getRangeAt(i).commonAncestorContainer)) return;
  }
  event.clipboardData.setData('text/plain', stripSoftHyphens(selection.toString()));
  event.preventDefault();
}

function held(t) {
  const opened = M.viennaDate(t.openedAt);
  if (opened !== t.date) return `held since ${M.fmtDM(opened)}`;
  const min = Math.max(0, Math.round((t.closedAt - t.openedAt) / 60000));
  return `held ${min >= 60 ? `${Math.floor(min / 60)}${NB}h ${min % 60}${NB}min` : `${min}${NB}min`}`;
}
// A price in full, exactly as recorded (at least two decimals).
const price = p => money(decimalUnits(p.amount), p.currency, false, Math.max(2, (p.amount.split('.')[1] ?? '').length));
// Company letters only: deterministic breaks need no browser dictionary.
// Each opportunity leaves at least three source letters on either side.
const softHyphens = word => word.replace(/\p{L}{8,}/gu, letters => letters.replace(/(\p{L}{3})(?=\p{L}{3})/gu, '$1\u00ad'));
const tradeWords = text => text.split(/(\s+)/u).map(word => /^\s+$/u.test(word) ? esc(word) : `<span class="word">${esc(softHyphens(word))}</span>`).join('');
const metaSuffix = '<span class="meta-sep" aria-hidden="true"> ·</span>';
// The trade's own rate as recorded: euro per one unit of its price currency.
// A price already in euro has no rate to show.
function rate(t) {
  if (!t.fx?.rate || t.fx.base === 'EUR') return '';
  const shown = money(decimalUnits(t.fx.rate), 'EUR', false, Math.max(2, (t.fx.rate.split('.')[1] ?? '').length));
  return `<span role="group" aria-label="Exchange rate">at ${shown} per ${esc(currencySymbol(t.fx.base))}</span>`;
}
function tradeRows(ts) {
  return `<div role="list" aria-label="Closed trades">${ts.map(t => `<div class="trow" data-trade="${esc(t.id)}" role="listitem">
    ${symBadge(t.symbol, t.desk)}
    <div class="name" lang="en"><b class="word">${esc(t.symbol)}</b>${t.company ? ` · ${tradeWords(t.company)}` : ''}<span class="meta"><span class="meta-unit">${inlineMark(t.desk)} ${LABEL[t.desk]}${metaSuffix}</span> <span class="meta-unit">${icon(t.side === 'short' ? 'short' : 'long', 'i side')} ${t.side === 'short' ? 'Short' : 'Long'} ${esc(quantity(t.quantity))}${metaSuffix}</span> <span class="meta-unit">closed ${timeHM(new Date(t.closedAt).toISOString())}${metaSuffix}</span> <span class="meta-unit">${held(t)}</span></span></div>
    <div class="px"><span class="ln"><span role="group" aria-label="Entry price">${price(t.entry)}</span><span role="group" aria-label="Exit price">${icon('arrow')}${price(t.exit)}</span>${rate(t)}</span><span class="fee">fees ${eur(t.units.fees)}</span></div>
    <div class="net" role="group" aria-label="Net after fees">${pl(t.units.net)}</div>
  </div>`).join('')}</div>`;
}

// Natural rows share their real scrolling container on a measurement copy.
// Every fit scans only through the first overflow; any overflow delegates
// the entire live panel to the frozen legacy fitter, without simulation.
const token = (el, name, on) => { if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on); };
const styleOf = el => globalThis.getComputedStyle?.(el);
const columnOf = row => {
  const px = row.querySelector('.px'), ln = px?.querySelector('.ln');
  return { row, px, ln, prices: [...ln?.children ?? []].filter(el => el?.classList),
    fee: px?.querySelector('.fee'), units: [...row.querySelectorAll('.meta-unit')] };
};
function measurementCopy(el, copies, preserveHeight = false) {
  const copy = el.cloneNode(true), cs = styleOf(el);
  // Keep the same selector ancestry, inherited typography, box sizing and
  // fractional content width. Fixed positioning keeps copies out of flow.
  Object.assign(copy.style, { position: 'fixed', left: '-100000px', top: '0',
    width: cs.width, height: preserveHeight ? cs.height : 'auto', maxHeight: preserveHeight ? cs.maxHeight : 'none', visibility: 'hidden', pointerEvents: 'none' });
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copies.push([el.parentElement, copy]);
  return copy;
}
const overflows = (el, column) => {
  const box = column.getBoundingClientRect(), range = document.createRange();
  range.selectNodeContents(el);
  return el.scrollWidth > el.clientWidth || [...range.getClientRects()].some(r => r.left < box.left || r.right > box.right);
};
// Exactly the legacy first-decision predicate, including its short circuits.
const needsFit = ({ px, ln, prices, fee }) => px.clientWidth &&
  (prices.some(el => overflows(el, ln)) || overflows(fee, px));

function measureLineEnds(units) {
  // Metadata still fits when a price column alone is hidden.
  const active = units.map(unit => Boolean(unit.querySelector('.meta-sep') && unit.clientWidth));
  const boxes = units.map((unit, i) => active[i] || active[i - 1] ? unit.getBoundingClientRect() : null);
  return active.map((on, i) => on ? !boxes[i + 1] || boxes[i + 1].top >= boxes[i].bottom - 0.5 : null);
}

function applyPlan(columns, plan) {
  columns.forEach((col, i) => {
    const step = plan[i];
    token(col.px, 'small', step.small);
    token(col.px, 'wrap-fee', step.wrap);
    token(col.row, 'prices-below', step.below);
    col.units.forEach((unit, u) => {
      if (step.lineEnds[u] !== null) token(unit.querySelector('.meta-sep'), 'line-end', step.lineEnds[u]);
    });
  });
}
function prepareTrades(root, copies) {
  const columns = [...root?.querySelectorAll?.('.trow') ?? []].map(columnOf);
  if (!columns.length) return () => () => {};
  // Non-browser markup callers have no CSSOM and cannot measure layout.
  if (!globalThis.getComputedStyle) return () => () => {
    for (const col of columns) { token(col.row, 'prices-below', false); token(col.px, 'small', false); token(col.px, 'wrap-fee', false); }
  };
  // Preserve the full panel's fixed height and flex/overflow descendants.
  // Restoring natural rows inside it restores the natural scrollbar too.
  const copy = measurementCopy(root, copies, true);
  const probe = [...copy.querySelectorAll('.trow')].map(columnOf);
  for (const col of probe) {
    token(col.row, 'prices-below', false);
    token(col.px, 'small', false);
    token(col.px, 'wrap-fee', false);
  }
  return () => {
    // No attached-copy writes during this scan. Stop at the first witness:
    // a full prescan would duplicate work the legacy fitter short-circuits.
    if (probe.some(needsFit)) return () => fitTradeRowsLegacy(root);
    // With no natural overflow the legacy second pass cannot add a class.
    const plan = probe.map(col => ({ small: false, wrap: false, below: false, lineEnds: measureLineEnds(col.units) }));
    return () => applyPlan(columns, plan);
  };
}
// Frozen verbatim from 9becb33 (private name/export only changed).
function fitTradeRowsLegacy(root) {
  const rows = [...root?.querySelectorAll?.('.trow') ?? []];
  const columns = rows.map(row => {
    const px = row.querySelector('.px');
    row.classList.remove('prices-below');
    px.classList.remove('small', 'wrap-fee');
    const ln = px.querySelector('.ln'), prices = [...ln.children], fee = px.querySelector('.fee');
    return { row, px, ln, prices, fee };
  });
  const overflows = (el, column) => {
    const box = column.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(el);
    // scrollWidth misses overflow to the left of right-aligned fee text.
    return el.scrollWidth > el.clientWidth || [...range.getClientRects()].some(r => r.left < box.left || r.right > box.right);
  };
  const needsSmall = columns.some(({ px, ln, prices, fee }) => px.clientWidth &&
    (prices.some(el => overflows(el, ln)) || overflows(fee, px)));
  // Decide once for the panel, before any fee or below-row fallback.
  if (needsSmall) for (const { px } of columns) px.classList.add('small');
  for (const { row, px, ln, prices, fee } of columns) {
    if (!px.clientWidth) continue;
    const pricesOverflow = () => prices.some(el => overflows(el, ln));
    if (pricesOverflow() || overflows(fee, px)) px.classList.add('wrap-fee');
    // Beyond the supported long-price fixture, keep an indivisible price
    // visible beneath the first row if even the small token cannot fit.
    if (pricesOverflow()) row.classList.add('prices-below');
  }
  for (const row of rows) {
    const units = [...row.querySelectorAll('.meta-unit')];
    for (const [i, unit] of units.entries()) {
      const suffix = unit.querySelector('.meta-sep');
      if (!suffix || !unit.clientWidth) continue;
      const box = unit.getBoundingClientRect(), next = units[i + 1]?.getBoundingClientRect();
      // Visibility keeps the suffix's width. Repeated fits and resizes cannot
      // move a unit back onto the preceding line and flip the dot on again.
      suffix.classList.toggle('line-end', !next || next.top >= box.bottom - 0.5);
    }
  }
}

function fitLayouts(roots, month = null, sheet = null) {
  const copies = [];
  try {
    const read = roots.map(root => prepareTrades(root, copies));
    read.push(...roots.map(root => prepareDaySummary(root, copies)));
    read.push(prepareMonthSummary(month, copies));
    for (const [parent, copy] of copies) parent.appendChild(copy);
    const write = read.map(measure => measure());
    // Remove measurement copies before applying any live class/visibility.
    for (const [, copy] of copies) copy.remove();
    for (const apply of write) apply();
    if (sheet) fitDaySheet(sheet);
  } finally {
    for (const [, copy] of copies) if (copy.parentElement) copy.remove();
  }
}
export function fitTradeRows(root) { fitLayouts([root]); }

function dayContent(view, k, desks) {
  const { ix, today } = view;
  const ts = ix ? M.tradesOn(ix, k, desks) : [];
  if (!ix) {
    return { sum: '—', body: `<p class="dp-empty">${icon('info')}<span>${M.compareDates(k, today) > 0 ? `${M.fmtDDM(k)} is still ahead.`
      : `No closed-trade record for ${M.fmtDDM(k)}: ${esc(cellReason(view.reason))}.`}</span></p>`, note: '' };
  }
  const r = M.dayResult(ix, k, desks);
  const warning = dayWarning(view, k, desks);
  const partial = M.compareDates(k, today) <= 0 && ix.partialDays?.has(k), incomplete = partial && !ts.length;
  const summary = partial ? ts.length
    ? `<span class="dp-trades">${plural(ts.length, 'trade')} · </span><span class="dp-amount">${eur(r.units, true)} so far</span>`
    : k === today ? 'No trades so far' : 'record incomplete'
    : ts.length ? `${plural(ts.length, 'trade')} · ${eur(r.units, true)}` : 'No trades';
  const sum = warning ? `${st('warn', warning.label)} · ${summary}` : summary;
  const closed = M.isWeekend(k) || M.marketHoliday(k);
  const why = M.compareDates(k, today) > 0 ? `${M.fmtDDM(k)} is still ahead.` : closed ? `No trades on ${M.fmtDDM(k)}: ${M.isWeekend(k) ? 'weekend' : 'US market holiday'}, markets closed.`
    : M.compareDates(k, view.trackingStart) < 0 ? `No trades on ${M.fmtDDM(k)}: paper results start on ${startText(view.trackingStart)}.` : `No trades on ${M.fmtDDM(k)}: the desks sat out.`;
  const body = ts.length ? tradeRows(ts) : incomplete ? '' : `<p class="dp-empty">${icon(closed ? 'clock' : 'info')}<span>${esc(why)}</span></p>`;
  // A lot opened this day and still held counts in Still open and on Desk.
  const opened = (view.positions ?? []).filter(p => p.openedAt && desks.includes(p.desk) && dateKeyAt(Date.parse(p.openedAt)) === k);
  const reasons = partial && !missingDay(ix, k, desks) ? M.partialReasons(ix.partialDetails?.get(k)) : [];
  const note = reasons.length || k === today ? '' : warning?.note ?? (partial ? PARTIAL_REASON : '');
  const positionNote = opened.map(p => `${p.company ? `${p.company} (${p.symbol}, ${LABEL[p.desk]})` : `${p.symbol} (${LABEL[p.desk]})`}, opened ${k === today ? `today at ${timeHM(p.openedAt)}` : 'this day'}, is still open; it counts as Still open and on Desk.`).join(' ');
  return { sum, body, note, reasons, deskNote: partial && desks.length === 1 && (note || reasons.length) ? M.PARTIAL_DESK_NOTE : '', positionNote,
    currencies: [...new Set(ts.flatMap(t => [t.entry.currency, t.exit.currency, ...(t.fx?.base ? [t.fx.base] : [])]))] };
}

// How a listed day reads: prices as traded, euro at each trade's own rate. A
// day without listed trades has no prices to explain. Plain words only: a
// control here would join the phone sheet's focus order after its body.
function currencyNote(day) {
  const list = day.currencies ?? [];
  if (!list.length) return '';
  const usd = list.length === 1 && list[0] === 'USD';
  return `<p class="dp-fx">${icon('info')}<span>${usd ? 'Prices in USD, as traded.' : 'Prices as traded, each in its own currency.'} Fees and results in EUR at each trade’s Interactive Brokers rate${usd ? ' (€ per $)' : ''}. Kept holdings never appear here.</span></p>`;
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

// The typography MutationObserver joins units before this microtask, as in
// the legacy sheet fitter. Both disclosure heights still finish before any
// live summary/height write in this deferred pass.
function fitDaySheet(sheet) {
  if (!sheet?.getBoundingClientRect) return;
  queueMicrotask(() => {
    if (!sheet.open || (sheet.querySelector('.dp-reasons-extra') && !sheet.querySelector('.dp-reasons-more'))) return;
    const copies = [], body = sheet.querySelector('.dlg-b');
    try {
      const read = prepareDaySummary(body, copies);
      for (const [parent, copy] of copies) parent.appendChild(copy);
      const summary = read();
      for (const [, copy] of copies) copy.remove();
      const height = measureSheetHeight(sheet, summary, copies);
      for (const [, copy] of copies) copy.remove();
      summary();
      height();
    } finally {
      for (const [, copy] of copies) if (copy.parentElement) copy.remove();
    }
  });
}

// Prepare both sheet disclosure states from the fitted, unit-joined live body.
// These copies stay detached while their classes/visibility are set. Their
// heights are read before the deferred summary and height writes.
function measureSheetHeight(sheet, summary, copies) {
  if (!sheet?.getBoundingClientRect) return () => {};
  const extra = sheet.querySelector('.dp-reasons-extra'), button = sheet.querySelector('.dp-reasons-more');
  if (extra && !button) return () => {};
  if (!extra || !button) return () => { sheet.style.height = ''; };
  const body = sheet.querySelector('.dlg-b'), head = sheet.querySelector('.dlg-h');
  const start = copies.length;
  const collapsed = measurementCopy(body, copies), expanded = measurementCopy(body, copies);
  for (const copy of [collapsed, expanded]) {
    const count = copy.querySelector('.dp-trades');
    if (count && summary.summary) count.hidden = summary.hidden;
  }
  expanded.querySelector('.dp-reasons-extra').hidden = false;
  expanded.querySelector('.dp-reasons-more').hidden = true;
  for (const [parent, copy] of copies.slice(start)) parent.appendChild(copy);
  const height = Math.ceil(head.getBoundingClientRect().height + Math.max(collapsed.scrollHeight, expanded.scrollHeight));
  return () => { sheet.style.height = `${height}px`; };
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
  patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${dayNote(day, true)}${currencyNote(day)}`);
  openDialog(sheet, { pointer });
  fitLayouts([$('#sheetBody')], null, sheet);
}

// ---------- The record's own state, inside the chart's fixed box ----------
function renderStatus(view) {
  const cell = view.cell, el = $('#resStatus');
  if (!el) return;
  // The current-money input has its own feed. Explain its absence even when
  // the closed-trade record is fresh, inside the existing fixed chart box.
  const data = deskSet().map(id => view.moneyCells?.[DESKS.indexOf(id)])
    .find(cell => outageValue(cell) || cell?.outageExpired);
  const dataText = data ? `Desks’ money is not available: ${esc(cellReason(data.reason))}.` : '';
  if (!view.ix || !cell) { patch(el, ''); return; }
  if (cell.state === 'fresh') {
    patch(el, dataText ? `<div class="res-state" data-state="stale">${st('warn', dataText)}</div>` : '');
    return;
  }
  const p = statePhrase(cell, 'res', 'last good results');
  const why = cell.reason ? esc(cellReason(cell.reason)) : null;
  const ago = () => ageSpan('res', cell.ageSeconds == null ? 'an unknown time' : `${age(cell.ageSeconds)} ago`);
  const text = cell.retained ? `${cell.reason === 'sequence_replayed' ? 'Results update not used' : 'Results refresh failed'}: ${why ?? 'not available'}. Showing the last good results from ${ago()}.`
    : p.state === 'stale' ? `Results as of ${ago()}${why ? ` · ${why}` : ''}.` : `Results: ${why ?? 'not available'} · as of ${ago()}.`;
  const stale = p.state === 'stale' || cell.ageSeconds >= STALE_AFTER_S;
  patch(el, `<div class="res-state" data-state="${p.state}">${st(p.tone, `${stale ? 'Stale · ' : ''}${text}${dataText ? ` ${dataText}` : ''}`)}</div>`);
}

// ---------- The hero chart: result so far, from € 0 ----------
// renderCurve describes the period's line; drawResultChart, the one seam to
// the chart renderer, draws that description. The shared time-chart
// component replaces only drawResultChart: the points, scale and words stay.
function renderCurve(view, per, desks, R, mctx) {
  const el = $('#curve'), color = desks.length === 1 ? `var(--desk-${desks[0]})` : 'var(--accent)';
  patch($('#curveLegend'), `<span class="lg">${swatch(color)}<span>Result so far · ${esc(whoOf(desks))}</span></span><span class="lg">${swatch('var(--ink-3)', '3 3', 1.4)}Zero</span><span class="lg muted">${swatch('var(--est)', '1 3.5', 1.6)}${term('benchmark', 'No index chosen')}</span>`);
  const top = 12 + Math.ceil($('#resStatus')?.offsetHeight ?? 0);
  if (!view.ix) {
    drawResultChart(el, { empty: 'Results are unavailable', label: 'Result so far: unavailable', top });
    return;
  }
  const c = M.curve(view.ix, per, desks, mctx);
  const pts = c.pts, known = pts.filter(p => p.v !== null);
  if (c.cut) {
    drawResultChart(el, { empty: cutText(c.cut), label: `Result so far, ${per.lab}: not shown, ${cutText(c.cut)}`, top });
    return;
  }
  if (R.empty || known.length < 2) {
    drawResultChart(el, { empty: R.net === null && !R.empty ? 'The desks’ money is not available' : 'No change in this period', label: `Result so far, ${per.lab}: ${R.empty ? 'no change' : 'not known yet'}`, top });
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
  const trackAt = c.day ? (view.trackingStart && M.compareDates(per.start, view.trackingStart) <= 0 ? x0 : null) : c.tracking;
  drawResultChart(el, {
    pts, domain: [x0, x1], color, live: M.compareDates(per.end, view.today) >= 0, top, grid: c.day ? [] : timeMarks(per.start, x0, x1),
    // Honest scale: zero is always in view, and the span is at least ±0,5 % of the
    // desks' money at the period start, so a few euros never look like a crash.
    base: M.unitsCents(c.startE),
    xLabels: marks.map((p, i, list) => ({ x: p.x, text: axisText(p), anchor: i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle' })),
    marker: trackAt !== null && trackAt !== undefined ? { x: trackAt, text: `tracking from ${M.fmtDM(view.trackingStart)}` } : null,
    label: `Result so far, ${per.lab}: ${R.net === null ? 'not known yet' : eur(R.units.net, true)}`,
    tipFmt: n => `<b>${esc(n[0].lab)}</b> · result so far ${eur(n[0].u ?? n[0].v, true)}`,
  });
}

// The design's quiet time marks, at Vienna midnights inside the domain: every
// day up to 16 days, every Monday up to 120 days, else every first of a month.
export function timeMarks(start, x0, x1) {
  const days = (x1 - x0) / 864e5, out = [];
  // Outside the proven window retain daily traversal and exact midnights.
  if (!M.isModernResultsDate(start) || !M.isModernResultsInstant(x0) || !M.isModernResultsInstant(x1)) {
    for (let k = M.addDays(start, 1), x = M.viennaMidnight(k); x < x1; k = M.addDays(k, 1), x = M.viennaMidnight(k)) {
      if (days <= 16 || (days <= 120 ? M.dowOf(k) === 1 : M.dayOf(k) === 1)) out.push(x);
    }
    return out;
  }
  const end = dateKeyAt(x1);
  const nextMonth = k => M.addDays(M.dateKey(...M.ymOf(k), 1), M.daysIn(...M.ymOf(k)));
  // Only resolve midnights that will be drawn. Walking every calendar day
  // made the first All-time switch resolve a year's unmarked weekends too.
  let k = days <= 16 ? M.addDays(start, 1) : days <= 120 ? M.addDays(M.monday(start), 7) : nextMonth(start);
  while (M.compareDates(k, end) <= 0) {
    const x = M.viennaMidnight(k);
    if (x >= x1) break;
    out.push(x);
    k = days <= 16 ? M.addDays(k, 1) : days <= 120 ? M.addDays(k, 7) : nextMonth(k);
  }
  return out;
}

// The seam. A description is either { empty, label, top } or the line: its
// points ({ x, v, u, lab }, v null for a break), x domain, colour, whether it
// runs to now, the period-start money for the minimum span, the time marks,
// axis labels, the tracking marker, the accessible label and the crosshair
// text. The design's line: one thin stroke without an area, its end marked,
// zero dashed (CSS).
function drawResultChart(el, spec) {
  if (spec.empty) {
    drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: spec.empty, label: spec.label, pad: { t: spec.top } });
    return;
  }
  drawChart(el, {
    series: [{ pts: spec.pts, color: spec.color, live: spec.live, w: 1.8, area: false }], xDomain: spec.domain, zero: true, strongZero: true, yFmt: eurAxis, ticks: 4,
    base: spec.base, pad: { t: spec.top }, vlines: (spec.grid ?? []).map(x => ({ x })), xLabels: spec.xLabels, marker: spec.marker, label: spec.label, tipFmt: spec.tipFmt,
  });
}
