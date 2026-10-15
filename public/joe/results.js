// Results: the period switch and the desk switch drive every number, all
// from the closed-trade record (results v2) by spec r3 §4.2: the hero with
// its result-so-far chart, eight tiles, By desk, the calendar and a day's
// trades. Without a valid record (JOED-20 writes it) Results shows its
// designed "not wired" state: dashes, never a zero or an estimate.
import { $, $$, icon, term, learnBtn, deskMark, inlineMark, swatch, patch, bn, pl, st, symBadge, ageSpan, statePhrase } from './ui.js';
import { TERMS } from './terms.js';
import { esc, eur, digits, pct, money, MINUS, NB, timeHM, age } from './format.js';
import { cellReason } from './health.js';
import { drawChart, eurAxis } from './chart.js';
import { viennaDay } from './time.mjs';
import { decimalUnits } from './contracts/decimal.mjs';
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

// The record, its state and everything the numbers need from the snapshot.
export function resultsView(ctx) {
  const today = resultsToday(ctx.now);
  const cell = ctx.states.results;
  let ix = cell?.value?.index ?? null, reason = cell?.reason ?? (cell?.value ? null : 'results_not_wired');
  // The accepted kept-holdings policy wins: a record that still trades a kept
  // symbol is not authoritative, so nothing is derived from it.
  const keep = [...new Set([...KEEP_FLOOR, ...(ctx.feeds['fleet-config']?.value?.desks.keep ?? [])])];
  if (ix && M.keptInRecord(ix, keep).length) { ix = null; reason = 'source_not_authoritative'; }
  const todayUnits = DESKS.map(id => {
    const c = ctx.states[`desks.${id}.equity`];
    return c?.value && !c.retained ? decimalUnits(c.value.amount) : null;
  });
  return { today, cell, ix, reason, trackingStart: ix?.meta.trackingStart ?? null, todayUnits, nowMs: ctx.now ? Date.parse(ctx.now) : null,
    cols: ctx.feeds.history?.value?.columns ?? null, positions: ctx.states.positions?.value ?? [] };
}

export function stepPeriod(dir, view) {
  RS.anchor = RS.sel = M.stepAnchor(RS.period, RS.anchor, dir, view.today, view.trackingStart);
  RS.cal = M.ymOf(RS.anchor);
  RS.moved = true;
}

const D = '<span class="bn muted">—</span>';
const deskSet = () => (RS.desk === 'all' ? DESKS.slice() : [RS.desk]);
const whoOf = desks => (desks.length === 3 ? 'J, Joe and Joel' : LABEL[desks[0]]);
const plain = n => (Math.abs(n) < 0.005 ? '<span class="pl">0,00</span>' : `<span class="pl">${icon(n > 0 ? 'up' : 'down')}${n < 0 ? MINUS : '+'}${digits(n)}</span>`);
const compact = n => (Math.abs(n) < 0.005 ? '<span class="pl">0</span>' : `<span class="pl">${icon(n > 0 ? 'up' : 'down')}${n < 0 ? MINUS : '+'}${digits(n, Math.abs(n) >= 9.95 ? 0 : 1)}</span>`);
const plural = (n, word) => `${n}${NB}${word}${n === 1 ? '' : 's'}`;
const signedWord = n => (Math.abs(n) < 0.005 ? 'Flat' : n > 0 ? `Up ${eur(Math.abs(n))}` : `Down ${eur(Math.abs(n))}`);
const startText = ts => (ts ? `${M.fmtDM(ts)} ${ts.slice(0, 4)}` : 'their first trading day');

// The context every number of one render shares.
function numbers(view, per, desks) {
  const ctx = { today: view.today, todayUnits: view.todayUnits, nowMs: view.nowMs, intraday: null };
  const end = per.end > view.today ? view.today : per.end;
  if (per.start === end) ctx.intraday = M.intraday(view.cols, per.start, desks);
  return ctx;
}

// The 1 s tick changes nothing here but ages: Results is rebuilt only when
// its inputs change (record, snapshot money, History, the controls, the width).
let last = null;
export const forgetResults = () => { last = null; };

export function renderResults(ctx) {
  const view = resultsView(ctx);
  const { today, ix } = view;
  if (!RS.moved || !RS.anchor) { RS.anchor = RS.sel = today; RS.cal = M.ymOf(today); }
  const sig = [ix, view.cols, view.reason, view.cell?.state, today, view.todayUnits.join(), view.positions.map(p => `${p.desk}|${p.symbol}|${p.company}|${p.openedAt}`).join(),
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
  renderTiles(R, view);
  renderBreakdown(view, per, desks, ix ? DESKS.map(d => M.rollup(ix, per, [d], numbers(view, per, [d]))).concat(desks.length === 3 ? [R] : [M.rollup(ix, per, DESKS, numbers(view, per, DESKS))]) : null);
  renderCalendar(view, per, desks);
  renderStatus(view);
  renderCurve(view, per, desks, R, mctx);
}

function heroSentence(view, per, R) {
  if (!view.ix) return view.reason === 'results_not_wired' ? 'Results are not wired yet. The board has no closed-trade record for this period.' : `Results are unavailable: ${cellReason(view.reason)}.`;
  if (R.empty) return `No trades ${per.phrase}. Paper results start on ${startText(view.trackingStart)}.`;
  if (R.net === null) return `The result ${per.phrase} is not known yet: the desks’ money ${R.end === view.today ? 'now' : `on ${M.fmtDDM(R.end)}`} is not available.`;
  return `${signedWord(R.net)} ${per.phrase}.`;
}

function renderHero(view, per, desks, R) {
  const none = !R || R.empty;
  patch($('#rheroL'), `
    <div class="hero-k">${icon('results')}<span>${term('result')} · ${esc(whoOf(desks))}</span></div>
    <div class="display">${none || R.net === null ? D : bn(R.net)}</div>
    <p class="say">${esc(heroSentence(view, per, R))}</p>
    <dl class="split">
      <dt>${term('closed')}</dt><dd>${none ? '—' : pl(R.realised)}</dd>
      <dt>${term('stillopen')}</dt><dd>${none || R.unreal === null ? '—' : pl(R.unreal)}</dd>
      <dt>${term('beforefees')}</dt><dd>${none ? '—' : pl(R.gross)}</dd>
      <dt>${term('fees')}</dt><dd class="num">${none ? '—' : eur(R.fees ? -R.fees : 0)}</dd>
    </dl>
    <div class="bench"><span>${term('benchmark')}</span><span class="muted">No index chosen</span></div>`);
}

const TILE_ICON = { trades: 'repeat', won: 'target', avgtrade: 'equal', pf: 'scale', typical: 'updown', besttrade: 'award', dip: 'dip', bestday: 'days' };
const tile = (k, val, mean, foot = 'From closed trades · after fees', tight = false) => `<article class="card tile" role="listitem" data-tile="${k}"><div class="tile-top"><span class="ico-sq">${icon(TILE_ICON[k])}</span><h3>${TERMS[k][0]}</h3>${learnBtn(k)}</div><div class="tval${tight ? ' tight' : ''}">${val}</div><p class="tmean">${mean}</p><div class="tfoot">${icon('receipt')}${foot}</div></article>`;
const two = (a, b) => `${a}<span class="sl">/</span>${b}`;
// Two signed amounts share a tile; long ones step the size down, never clip.
const tightPair = (...values) => values.filter(v => v != null).reduce((n, v) => n + eur(v, true).length, 0) > 17;
const tradeName = t => `${esc(t.symbol)} (${LABEL[t.desk]})`;

function renderTiles(R, view) {
  if (!R) {
    const why = view.reason === 'results_not_wired' ? 'Not wired yet' : 'Unavailable';
    patch($('#tiles'), Object.keys(TILE_ICON).map(k => tile(k, D, why, k === 'dip' ? 'From the desks’ money' : undefined)).join(''));
    return;
  }
  const n = R.trades, decided = R.won + R.lost;
  const typical = R.avgWin === null && R.avgLoss === null ? D : two(R.avgWin === null ? '—' : bn(R.avgWin), R.avgLoss === null ? '—' : bn(R.avgLoss));
  const extremes = R.best || R.worst ? two(R.best ? bn(R.best.net) : '—', R.worst ? bn(R.worst.net) : '—') : D;
  const oneDay = R.bestDay && R.bestDay.date === R.worstDay.date;
  patch($('#tiles'), [
    tile('trades', n ? `<span class="num">${n}</span>` : D, n ? `${R.won} won · ${R.lost} lost · ${R.flat} flat` : 'No finished trades'),
    tile('won', R.winRate === null ? D : `<span class="num">${digits(R.winRate, 0)}</span><small>%</small>`, R.winRate === null ? 'Needs a won or lost trade' : `${R.won} of ${decided}${R.small ? ' · small sample' : ''}`),
    tile('avgtrade', R.expectancy === null ? D : bn(R.expectancy), R.expectancy === null ? 'No finished trades'
      : Math.abs(R.expectancy) < 0.005 ? 'A typical trade breaks even' : R.expectancy > 0 ? 'A typical trade earns' : 'A typical trade loses, after fees'),
    tile('pf', R.pf === null ? D : `<span class="num">${digits(R.pf)}</span>`, R.pf === null ? 'Needs a losing trade' : R.pf > 1 ? 'Above 1: won more than lost' : R.pf < 1 ? 'Below 1: lost more than won' : 'Exactly 1: won as much as lost'),
    tile('typical', typical, R.sizeRatio !== null ? `A win is ${digits(R.sizeRatio)} times a loss` : 'Needs a win and a loss', undefined, tightPair(R.avgWin, R.avgLoss)),
    tile('besttrade', extremes, R.best && R.worst ? `${tradeName(R.best)} · ${tradeName(R.worst)}` : R.best ? `${tradeName(R.best)} · no losing trade` : R.worst ? `No winning trade · ${tradeName(R.worst)}` : 'No finished trades',
      undefined, tightPair(R.best?.net, R.worst?.net)),
    tile('dip', R.empty || R.dd === null ? D : bn(R.dd), R.empty ? 'No change in this period' : R.dd === null ? 'The desks’ money is not available'
      : R.dd === 0 ? 'Never below its high point' : `${pct(-R.ddPct, 2)} below the high point`, 'From the desks’ money'),
    tile('bestday', !R.bestDay ? D : oneDay ? bn(R.bestDay.net) : two(bn(R.bestDay.net), bn(R.worstDay.net)), !R.bestDay ? 'No trading day'
      : oneDay ? `${M.fmtDDM(R.bestDay.date)} · only day` : `${M.fmtDDM(R.bestDay.date)} · ${M.fmtDDM(R.worstDay.date)}`, undefined, !oneDay && R.bestDay && tightPair(R.bestDay.net, R.worstDay.net)),
  ].join(''));
}

function renderBreakdown(view, per, desks, rows) {
  const list = [...DESKS.map(d => ({ id: d, name: LABEL[d] })), { id: 'all', name: 'Total' }];
  if (!rows) {
    patch($('#breakdown'), list.map(r => `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}" data-row="${r.id}">
      <div class="who">${r.id === 'all' ? '<span class="dmark" aria-hidden="true"><svg viewBox="0 0 28 28"><use href="#i-logo"/></svg></span>' : deskMark(r.id)}${r.name}</div>
      <div class="track" role="img" aria-label="${r.name}: ${view.reason === 'results_not_wired' ? 'not wired yet' : 'unavailable'}"><span class="z"></span></div>
      <div class="val"><span class="muted">—</span></div>
      <div class="facts">${view.reason === 'results_not_wired' ? 'Not wired yet' : 'Unavailable'}</div>
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
      <div class="track" role="img" aria-label="${r.name}: ${x.empty ? 'no change' : x.net === null ? 'not known yet' : eur(x.net, true)}"><span class="z"></span>${bar}</div>
      <div class="val">${shown ? pl(x.net) : '<span class="muted">—</span>'}</div>
      <div class="facts">${x.trades ? `${plural(x.trades, 'trade')} · ${x.winRate === null ? 'none decided' : `${x.winRate}${NB}% won`} · fees ${eur(x.fees)}` : 'No trades'}</div>
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
    if (Math.abs(r.net) < 0.005) return { cls: 'flat', r, note, aria: `${money(0)} from ${note}` };
    return { cls: `${r.units > 0n ? 'g' : 'l'}${M.tintStep(r.units, max)}`, r, note, aria: `${eur(r.net, true)} from ${note}` };
  }
  const closed = M.isWeekend(k) || M.marketHoliday(k);
  if (closed) return { cls: 'we', note: 'closed', aria: M.isWeekend(k) ? 'weekend, markets closed' : 'US market holiday, markets closed' };
  if (!ix) return { cls: 'nw', note: '', aria: view.reason === 'results_not_wired' ? 'not wired yet' : 'unavailable', dash: true };
  if (k < view.trackingStart) return { cls: 'we pre', note: '', aria: 'before paper results start' };
  return { cls: 'none', note: 'no trades', aria: 'no trades' };
}

function renderCalendar(view, per, desks) {
  const { ix, today } = view;
  const [y, m] = RS.cal;
  const first = M.dateKey(y, m, 1);
  patch($('#calTitle'), `<span class="cur">${M.MONTH[m]} ${y}</span><span aria-hidden="true">September 2026</span>`);
  $('#prevMonth').disabled = first <= M.firstStep(view.trackingStart);
  $('#nextMonth').disabled = first >= M.dateKey(...M.ymOf(today), 1);
  const max = ix ? maxDay(ix, desks) : 0n;
  let monthCount = 0, monthUnits = 0n, monthDays = 0;
  if (ix) for (let d = 1; d <= M.daysIn(y, m); d++) {
    const r = M.dayResult(ix, M.dateKey(y, m, d), desks);
    if (r.count) { monthCount += r.count; monthUnits += r.units; monthDays++; }
  }
  $('#calSum').textContent = !ix ? (view.reason === 'results_not_wired' ? 'Not wired yet' : 'Unavailable')
    : monthCount ? `${signedWord(M.unitsCents(monthUnits))} over ${plural(monthDays, 'trading day')}` : 'No trades this month';
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
      const cls = ['cell', s.cls, k === today ? 'today' : '', k === RS.sel ? 'sel' : '', inPer(k) ? 'inper' : ''].filter(Boolean).join(' ');
      const value = s.r ? `<span class="vl">${plain(s.r.net)}</span><span class="vs">${compact(s.r.net)}</span>` : s.dash ? '<span class="muted">—</span>' : '';
      html += `<button type="button" class="${cls}" data-day="${k}" aria-pressed="${k === RS.sel}" aria-label="${M.fmtDay(k)}${k === today ? ', today' : ''}: ${esc(s.aria)}"><span class="d">${Number(k.slice(8))}</span><span class="v">${value}</span><span class="n">${s.note}</span></button>`;
    }
    // A week still ahead has nothing to sum yet.
    const ahead = wk > today;
    const wkValue = ahead ? '<span class="v"></span>' : !ix ? '<span class="v muted">—</span>' : `<span class="v">${wkCount ? plain(M.unitsCents(wkUnits)) : '—'}</span>`;
    html += inMonth ? `<div class="wk"><span>${!ix || ahead ? '' : wkDays ? plural(wkDays, 'day') : 'no trades'}</span>${wkValue}</div>` : '<div class="wk" style="visibility:hidden" aria-hidden="true"></div>';
  }
  patch($('#cal'), html);
  patch($('#calLegend'), `<span class="nowrap">Loss <span class="ramp"><i style="background:var(--l4)"></i><i style="background:var(--l3)"></i><i style="background:var(--l2)"></i><i style="background:var(--l1)"></i></span></span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--flat)"></i></span> Flat</span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--g1)"></i><i style="background:var(--g2)"></i><i style="background:var(--g3)"></i><i style="background:var(--g4)"></i></span> Gain</span>
    <span>${!ix ? 'Tints appear once results are wired' : max > 0n ? `Darkest: ${eur(M.unitsCents(max * 3n / 4n))} to ${eur(M.unitsCents(max))} in a day` : 'No trading day yet'}</span>`);
  const day = dayContent(view, RS.sel, desks);
  patch($('#daypanel'), `<div class="dp-head"><h3>Trades on ${M.fmtDDM(RS.sel)}</h3><span class="dp-sum">${day.sum}</span></div><div class="dp-list">${day.body}${day.note ? `<p class="dp-note">${icon('info')}<span>${esc(day.note)}</span></p>` : ''}</div>`);
  const sheet = $('#daySheet');
  if (sheet?.open) {
    $('#sheetTitle').textContent = `Trades on ${M.fmtDDM(RS.sel)}`;
    patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${day.note ? `<p class="dp-note">${icon('info')}<span>${esc(day.note)}</span></p>` : ''}`);
  }
}

// ---------- A day's trades ----------
function held(t) {
  const opened = M.viennaDate(t.openedAt);
  if (opened !== t.date) return `held since ${M.fmtDM(opened)}`;
  const min = Math.max(0, Math.round((t.closedAt - t.openedAt) / 60000));
  return `held ${min >= 60 ? `${Math.floor(min / 60)}${NB}h ${min % 60}${NB}min` : `${min}${NB}min`}`;
}
const price = p => money(Number(p.amount), p.currency, false, Math.max(2, (p.amount.split('.')[1] ?? '').length));
function tradeRows(ts) {
  return ts.map(t => `<div class="trow" data-trade="${esc(t.id)}">
    ${symBadge(t.symbol, t.desk)}
    <div class="name"><b>${esc(t.symbol)}</b>${t.company ? ` · ${esc(t.company)}` : ''}<span>${inlineMark(t.desk)} ${LABEL[t.desk]} · ${icon(t.side === 'short' ? 'short' : 'long', 'i side')} ${t.side === 'short' ? 'Short' : 'Long'} ${esc(t.quantity.replace('.', ','))} · closed ${timeHM(new Date(t.closedAt).toISOString())}, ${held(t)}</span></div>
    <div class="px"><span class="ln"><span>${price(t.entry)}</span><span>${icon('arrow')}${price(t.exit)}</span></span><span class="fee">fees ${eur(t.fees)}</span></div>
    <div class="net">${pl(t.net)}</div>
  </div>`).join('');
}

function dayContent(view, k, desks) {
  const { ix, today } = view;
  const ts = ix ? M.tradesOn(ix, k, desks) : [];
  if (!ix) {
    return { sum: '—', body: `<p class="dp-empty">${icon('info')}<span>${k > today ? `${M.fmtDDM(k)} is still ahead.`
      : view.reason === 'results_not_wired' ? `No closed-trade record for ${M.fmtDDM(k)} yet: results are not wired.` : `No closed-trade record for ${M.fmtDDM(k)}: ${esc(cellReason(view.reason))}.`}</span></p>`, note: '' };
  }
  const r = M.dayResult(ix, k, desks);
  const sum = ts.length ? `${plural(ts.length, 'trade')} · ${eur(r.net, true)}` : 'No trades';
  const closed = M.isWeekend(k) || M.marketHoliday(k);
  const why = k > today ? `${M.fmtDDM(k)} is still ahead.` : closed ? `No trades on ${M.fmtDDM(k)}: ${M.isWeekend(k) ? 'weekend' : 'US market holiday'}, markets closed.`
    : k < view.trackingStart ? `No trades on ${M.fmtDDM(k)}: paper results start on ${startText(view.trackingStart)}.` : `No trades on ${M.fmtDDM(k)}: the desks sat out.`;
  const body = ts.length ? tradeRows(ts) : `<p class="dp-empty">${icon(closed ? 'clock' : 'info')}<span>${esc(why)}</span></p>`;
  // A lot opened this day and still held counts in Still open and on Desk.
  const opened = (view.positions ?? []).filter(p => p.openedAt && desks.includes(p.desk) && M.viennaDate(Date.parse(p.openedAt)) === k);
  const note = opened.map(p => `${p.company ? `${p.company} (${p.symbol}, ${LABEL[p.desk]})` : `${p.symbol} (${LABEL[p.desk]})`}, opened ${k === today ? `today at ${timeHM(p.openedAt)}` : 'this day'}, is still open; it counts as Still open and on Desk.`).join(' ');
  return { sum, body, note };
}

export function openDaySheet(view, k) {
  const sheet = $('#daySheet');
  if (!sheet) return;
  const day = dayContent(view, k, deskSet());
  $('#sheetTitle').textContent = `Trades on ${M.fmtDDM(k)}`;
  patch($('#sheetBody'), `<p class="dp-sum">${day.sum}</p>${day.body}${day.note ? `<p class="dp-note">${icon('info')}<span>${esc(day.note)}</span></p>` : ''}`);
  if (!sheet.open) sheet.showModal();
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
  patch(el, `<div class="res-state" data-state="${p.state}">${st(p.tone, text)}</div>`);
}

// ---------- The hero chart: result so far, from € 0 ----------
function renderCurve(view, per, desks, R, mctx) {
  const el = $('#curve'), color = desks.length === 1 ? `var(--desk-${desks[0]})` : 'var(--accent)';
  patch($('#curveLegend'), `<span class="lg"><b class="lg-b">${term('result', 'Result')} so far · ${esc(per.head)}</b></span><span class="lg">${swatch(color)}${esc(whoOf(desks))}</span><span class="lg">${swatch('var(--ink-3)', '', 1.4)}Zero</span><span class="lg muted">${swatch('var(--est)', '1 3.5', 1.6)}No index chosen</span>`);
  const top = 12 + Math.ceil($('#resStatus')?.offsetHeight ?? 0);
  if (!view.ix) {
    drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: view.reason === 'results_not_wired' ? 'Results are not wired yet' : 'Results are unavailable', label: `Result so far: ${view.reason === 'results_not_wired' ? 'not wired yet' : 'unavailable'}`, pad: { t: top } });
    return;
  }
  const c = M.curve(view.ix, per, desks, mctx);
  const pts = c.pts, known = pts.filter(p => p.v !== null);
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
    return p.edge === 'start' ? 'Start of period' : p.now ? 'Today, now' : M.fmtDDM(p.k);
  };
  pts.forEach((p, i) => { p.lab = lab(p, i); });
  const axisText = p => (c.day ? (p.edge ? (p.edge === 'start' ? 'start' : p.edge) : timeHM(new Date(p.at).toISOString())) : p.edge === 'start' ? 'start' : M.fmtDM(p.k));
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
  const marks = [pts[0], pts[Math.floor((pts.length - 1) / 2)], pts[pts.length - 1]];
  drawChart(el, {
    series: [{ pts, color, live: per.end >= view.today }], xDomain: [x0, x1], zero: true, strongZero: true, yFmt: eurAxis, ticks: 4,
    // Honest scale: zero is always in view, and the span is at least ±0,5 % of the
    // desks' money at the period start, so a few euros never look like a crash.
    base: M.unitsCents(c.startE), pad: { t: top },
    xLabels: marks.filter((p, i) => i !== 1 || (p !== marks[0] && p !== marks[2])).map((p, i, list) => ({ x: p.x, text: axisText(p), anchor: i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle' })),
    marker: view.trackingStart && per.start <= view.trackingStart ? { x: x0, text: `tracking from ${M.fmtDM(view.trackingStart)}` } : null,
    label: `Result so far, ${per.lab}: ${R.net === null ? 'not known yet' : eur(R.net, true)}`,
    tipFmt: n => `<b>${esc(n[0].lab)}</b> · result so far ${eur(n[0].v, true)}`,
  });
}
