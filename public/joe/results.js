// Results in its designed "not wired" state: the period and desk switches,
// the stepper and the calendar's dates work; every number is a dash, never a
// zero or an estimate, until the closed-trade record (JOED-20) arrives.
import { $, $$, icon, term, learnBtn, deskMark, inlineMark, swatch, patch } from './ui.js';
import { TERMS } from './terms.js';
import { esc, MONTH } from './format.js';
import { cellReason } from './health.js';
import { drawChart } from './chart.js';
import { viennaDay } from './time.mjs';

const DESKS = ['j', 'joe', 'joel'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIRST_TRACKED = '2026-08-01';
export const RS = { period: 'week', anchor: null, sel: null, desk: 'all', cal: null };

const pad = n => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const kOf = dt => key(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
const addDays = (k, n) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return kOf(d); };
const dowOf = k => parse(k).getUTCDay();
const ymOf = k => [parse(k).getUTCFullYear(), parse(k).getUTCMonth()];
const fmtDM = k => { const d = parse(k); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const fmtDDM = k => `${DOW[dowOf(k)]} ${fmtDM(k)}`;
const monday = k => addDays(k, -((dowOf(k) + 6) % 7));
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isoWeek = k => { const d = parse(k); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const range = (s, e) => { const a = parse(s), b = parse(e); return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MON[b.getUTCMonth()]}` : `${fmtDM(s)} – ${fmtDM(e)}`; };

export function periodOf(p, a, today) {
  const [y, m] = ymOf(a);
  if (p === 'day') return { start: a, end: a, lab: a === today ? `Today · ${fmtDDM(a)}` : a === addDays(today, -1) ? `Yesterday · ${fmtDDM(a)}` : `${fmtDDM(a)} ${a.slice(0, 4)}`, head: a === today ? 'today' : fmtDDM(a) };
  if (p === 'week') {
    const s = monday(a), e = addDays(s, 6), cur = s === monday(today), prev = s === addDays(monday(today), -7);
    return { start: s, end: e, lab: `${cur ? 'This week · ' : prev ? 'Last week · ' : `Week ${isoWeek(s)} · `}${range(s, e)}`, head: cur ? 'this week' : prev ? 'last week' : `week of ${fmtDM(s)}` };
  }
  if (p === 'month') {
    const [ty, tm] = ymOf(today), cur = y === ty && m === tm, prev = (y === ty && m === tm - 1) || (y === ty - 1 && tm === 0 && m === 11);
    return { start: key(y, m, 1), end: key(y, m, dim(y, m)), lab: cur ? `This month · ${MONTH[m]}` : prev ? `Last month · ${MONTH[m]}` : `${MONTH[m]} ${y}`, head: cur ? 'this month' : MONTH[m] };
  }
  if (p === 'ytd') return { start: `${today.slice(0, 4)}-01-01`, end: today, lab: 'This year · since 1 Jan', head: 'this year' };
  return { start: FIRST_TRACKED, end: today, lab: 'All time', head: 'all time' };
}

export function stepPeriod(dir, today) {
  const a = parse(RS.anchor);
  if (RS.period === 'day') a.setUTCDate(a.getUTCDate() + dir);
  if (RS.period === 'week') a.setUTCDate(a.getUTCDate() + 7 * dir);
  if (RS.period === 'month') { a.setUTCDate(1); a.setUTCMonth(a.getUTCMonth() + dir); }
  let k = kOf(a);
  if (k > today) k = today;
  if (k < FIRST_TRACKED) k = FIRST_TRACKED;
  RS.anchor = RS.sel = k; RS.cal = ymOf(k);
}

const D = '<span class="bn muted">—</span>';
const TILES = [['trades', 'repeat'], ['won', 'target'], ['avgtrade', 'equal'], ['pf', 'scale'], ['typical', 'updown'], ['besttrade', 'award'], ['dip', 'dip'], ['bestday', 'days']];

export function renderResults(ctx) {
  const today = viennaDay(ctx.now);
  RS.anchor ??= today; RS.sel ??= today; RS.cal ??= ymOf(today);
  const per = periodOf(RS.period, RS.anchor, today);
  const reason = ctx.states.results?.reason ?? 'results_not_wired';
  const why = reason === 'results_not_wired' ? 'Results are not wired yet.' : `Results are unavailable: ${cellReason(reason)}.`;
  const who = RS.desk === 'all' ? 'J, Joe and Joel' : LABEL[RS.desk];
  $$('#periodSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.period === RS.period)));
  patch($('#deskSeg'), `<button type="button" data-desk="all" aria-pressed="${RS.desk === 'all'}">All desks</button>${DESKS.map(d => `<button type="button" data-desk="${d}" aria-pressed="${RS.desk === d}">${inlineMark(d)}${LABEL[d]}</button>`).join('')}`);
  $('#perLabel').textContent = per.lab;
  const stepable = ['day', 'week', 'month'].includes(RS.period);
  $('#prevPer').disabled = !stepable || per.start <= FIRST_TRACKED;
  $('#nextPer').disabled = !stepable || per.end >= today;
  patch($('#rheroL'), `
    <div class="hero-k">${icon('results')}<span>${term('result')} · ${esc(who)}</span></div>
    <div class="display">${D}</div>
    <p class="say">${esc(why)} The board has no closed-trade record for this period.</p>
    <dl class="split">
      <dt>${term('closed')}</dt><dd>—</dd>
      <dt>${term('stillopen')}</dt><dd>—</dd>
      <dt>${term('beforefees')}</dt><dd>—</dd>
      <dt>${term('fees')}</dt><dd>—</dd>
    </dl>
    <div class="bench"><span>${term('benchmark')}</span><span class="muted">No index chosen</span></div>`);
  const color = RS.desk === 'all' ? 'var(--accent)' : `var(--desk-${RS.desk})`;
  patch($('#curveLegend'), `<span class="lg"><b class="lg-b">${term('result', 'Result')} so far · ${esc(per.head)}</b></span><span class="lg">${swatch(color)}${esc(who)}</span><span class="lg">${swatch('var(--ink-3)', '', 1.4)}Zero</span><span class="lg muted">${swatch('var(--est)', '1 3.5', 1.6)}No index chosen</span>`);
  drawChart($('#curve'), { series: [], xDomain: [0, 1], empty: true, emptyText: 'Results are not wired yet', label: 'Result so far: not wired yet' });
  patch($('#tiles'), TILES.map(([k, ic]) => `<article class="card tile" role="listitem" data-tile="${k}"><div class="tile-top"><span class="ico-sq">${icon(ic)}</span><h3>${TERMS[k][0]}</h3>${learnBtn(k)}</div><div class="tval">${D}</div><p class="tmean">Not wired yet</p><div class="tfoot">${icon('receipt')}From closed trades · after fees</div></article>`).join(''));
  $('#bdTitle').textContent = `By desk · ${per.head}`;
  patch($('#breakdown'), [...DESKS.map(d => ({ id: d, name: LABEL[d] })), { id: 'all', name: 'Total' }].map(r => `
    <div class="brow${r.id === 'all' ? ' total' : ''}${RS.desk === r.id ? ' sel' : ''}">
      <div class="who">${r.id === 'all' ? '<span class="dmark" aria-hidden="true"><svg viewBox="0 0 28 28"><use href="#i-logo"/></svg></span>' : deskMark(r.id)}${r.name}</div>
      <div class="track" role="img" aria-label="${r.name}: not wired yet"><span class="z"></span></div>
      <div class="val"><span class="muted">—</span></div>
      <div class="facts">Not wired yet</div>
    </div>`).join(''));
  renderCalendar(today);
}

function renderCalendar(today) {
  const [y, m] = RS.cal;
  $('#calTitle').textContent = `${MONTH[m]} ${y}`;
  $('#prevMonth').disabled = key(y, m, 1) <= FIRST_TRACKED;
  $('#nextMonth').disabled = key(y, m, 1) >= key(...ymOf(today), 1);
  $('#calSum').textContent = 'Not wired yet';
  const per = periodOf(RS.period, RS.anchor, today);
  const start = monday(key(y, m, 1));
  let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow" role="columnheader">${d}</div>`).join('') + '<div class="dow wkh" role="columnheader">Week</div>';
  for (let r = 0; r < 6; r++) {
    const wk = addDays(start, r * 7);
    let inMonth = false;
    for (let c = 0; c < 7; c++) {
      const k = addDays(wk, c), [cy, cm] = ymOf(k);
      if (cy !== y || cm !== m) { html += '<div class="cell out" aria-hidden="true"></div>'; continue; }
      inMonth = true;
      const weekend = dowOf(k) === 0 || dowOf(k) === 6;
      const inPer = (RS.period === 'day' || RS.period === 'week') && k >= per.start && k <= per.end;
      const cls = ['cell', k > today ? 'fut' : weekend ? 'we' : 'nw', k === today ? 'today' : '', k === RS.sel ? 'sel' : '', inPer ? 'inper' : ''].filter(Boolean).join(' ');
      const note = k > today ? '' : weekend ? 'closed' : '—';
      html += `<button type="button" class="${cls}" data-day="${k}" aria-pressed="${k === RS.sel}" aria-label="${fmtDDM(k)} ${k.slice(0, 4)}${k === today ? ', today' : ''}: ${k > today ? 'still ahead' : weekend ? 'weekend' : 'not wired yet'}"><span class="d">${parse(k).getUTCDate()}</span><span class="v">${note === '—' ? '<span class="muted">—</span>' : ''}</span><span class="n">${note === 'closed' ? 'closed' : ''}</span></button>`;
    }
    html += inMonth ? `<div class="wk"><span>Week ${isoWeek(wk)}</span><span class="v muted">—</span></div>` : '<div class="wk" style="visibility:hidden" aria-hidden="true"></div>';
  }
  patch($('#cal'), html);
  patch($('#calLegend'), `<span class="nowrap">Loss <span class="ramp"><i style="background:var(--l4)"></i><i style="background:var(--l3)"></i><i style="background:var(--l2)"></i><i style="background:var(--l1)"></i></span></span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--flat)"></i></span> Flat</span>
    <span class="nowrap"><span class="ramp"><i style="background:var(--g1)"></i><i style="background:var(--g2)"></i><i style="background:var(--g3)"></i><i style="background:var(--g4)"></i></span> Gain</span>
    <span>Tints appear once results are wired</span>`);
  const k = RS.sel;
  const body = k > today ? `${fmtDDM(k)} is still ahead.` : `No closed-trade record for ${fmtDDM(k)} yet: results are not wired.`;
  patch($('#daypanel'), `<div class="dp-head"><h3>Trades on ${fmtDDM(k)}</h3><span class="dp-sum">—</span></div><div class="dp-list"><p class="dp-empty">${icon('info')}<span>${body}</span></p></div>`);
}
