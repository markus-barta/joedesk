// Desk: health line and details, Today, the three desks, positions and the
// kept holdings. Every number comes from one panel-state cell; each cell shows
// fresh, stale with age, not reported, or broken with its reason, on its own.
import { $, icon, term, st, bn, pl, deskMark, inlineMark, symBadge, ageSpan, patch } from './ui.js';
import { esc, amountOf, money, eur, age, quantity, sumByCurrency, timeHM, timeHMS, dayDDM, dayDM, dateTimeFull, isZero, NB } from './format.js';
import { boardHealthPresentation, boardDiagnostics, brokerState, dataAge, cellReason, capital, STALE_AFTER_S } from './health.js';
import { sessionBounds, nextOpen, zonedInstant, nyDay, wall, NY, VIENNA } from './time.mjs';
import { gatewayCheckAgeMs } from './contracts/gateway.mjs';
import { drawChart, eurAxis } from './chart.js';
import { intraday } from './history-model.js';
import { learningLine } from './events.js';

const DESKS = ['j', 'joe', 'joel'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const TONE_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
const STATE = {
  working: { tone: 'ok', icon: 'work', word: 'Working' },
  'sit-out': { tone: 'none', icon: 'pause', word: 'Sitting out' },
  stuck: { tone: 'bad', icon: 'stop', word: 'Stuck' },
};

// One money cell: the value (or a dash) plus a caption that says what state
// it is in. Fresh values keep the designed caption.
export function cellView(cell, key, { signed = true, caption = '' } = {}) {
  const value = cell?.value ?? null;
  const n = amountOf(value);
  const html = bn(n, value?.currency ?? 'EUR', signed);
  if (!cell || (value == null && !cell.reason)) return { html, caption: 'Not reported', state: 'not reported', n: null };
  if (value == null) return { html, caption: `Unavailable · ${cellReason(cell.reason)}`, state: 'broken', n: null };
  if (cell.retained) return { html, caption: `Last good value, ${ageSpan(key, cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`)} · ${cellReason(cell.reason)}`, state: 'broken', n };
  if (cell.state === 'stale') return { html, caption: `${caption ? `${caption} · ` : ''}as of ${ageSpan(key, `${age(cell.ageSeconds)} ago`)}`, state: 'stale', n };
  return { html, caption, state: cell.state, n };
}

function healthStrip(ctx, health) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const facts = [st(health.statusTone, esc(capital(health.reason === 'board_ok' ? 'numbers up to date' : health.explanation)))];
  if (data) {
    const broker = brokerState(states, data);
    const words = { OK: `checked ${ageSpan('strip.broker', `${age(states.gateway?.ageSeconds)} ago`)}`, degraded: 'unstable', down: 'down', unsure: 'has not checked in' };
    facts.push(st(broker.tone, `${term('broker')} ${words[broker.word]}`));
    facts.push(states.halt?.value == null ? st('none', `${term('halt')} not reported`) : st(states.halt.value ? 'bad' : 'ok', `${term('halt')} ${states.halt.value ? 'on' : 'off'}`));
    const { receipt, frozen } = dataAge(feeds, now);
    const dataTone = feeds.data.reason || frozen >= STALE_AFTER_S ? 'warn' : 'ok';
    facts.push(st(dataTone, `${term('datafrom', `Data from ${timeHMS(data.generatedAt)}`)}${receipt >= STALE_AFTER_S ? ` · ${ageSpan('strip.data', `${age(receipt)} old`)}` : ''}`));
  } else {
    facts.push(st('none', 'No data yet'));
  }
  return `${facts.join('')}<button type="button" class="btn quiet" id="healthMore" aria-expanded="false" aria-controls="healthPop">Details${icon('chev-d')}</button>`;
}

function dayMethodLabel(source) {
  if (!source || source.status !== 'available') return null;
  const start = source.periodStart ? timeHM(source.periodStart) : null;
  if (source.method === 'sod-virtual-equity') return start ? `Counted from ${start}${source.periodStart && wall(source.periodStart, NY).slice(11, 16) === '00:00' ? ' (midnight in New York)' : ''}` : 'Counted from the start of the day';
  if (source.method === 'session-open-estimate') return `Estimated from the session open${start ? ` at ${start}` : ''}`;
  if (source.method === 'ib-daily-pnl') return 'Reported by Interactive Brokers';
  return null;
}
function openMethodLabel(source) {
  if (!source || source.status !== 'available') return null;
  return source.method === 'ib-unrealized-pnl' ? 'Valued by Interactive Brokers' : source.method === 'owned-lots-current-mark-fx' ? 'Valued from the desks’ own purchases at the last price' : null;
}

function healthPop(ctx, health) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const problems = boardDiagnostics(states, feeds, now);
  const rows = [];
  if (data) {
    const { receipt } = dataAge(feeds, now);
    const gateway = data.safety.gateway;
    const broker = brokerState(states, data);
    rows.push(['Data', `${dateTimeFull(data.generatedAt)} · ${ageSpan('pop.data', `${age(receipt)} old`)} · refreshes every 15${NB}s`]);
    rows.push(['Broker connection', `${broker.word === 'OK' ? 'Answering' : broker.word === 'down' ? 'Down' : broker.word === 'degraded' ? 'Unstable' : 'Not confirmed'}${gateway?.reason ? ` · ${esc(cellReason(gateway.reason))}` : ''}${gateway?.checkedAt ? ` · checked ${timeHMS(gateway.checkedAt)}` : ' · no check reported'}`]);
    rows.push(['Emergency stop', data.safety.halt ? `On: ${esc(cellReason(data.safety.haltReason))}` : 'Off']);
    rows.push(['Today’s result', esc(dayMethodLabel(data.pnlSources?.day) ?? `Not available · ${cellReason(data.pnlSources?.day?.reason ?? states['today.dayPnl']?.reason ?? 'feed_not_received')}`)]);
    rows.push(['Open positions', esc(openMethodLabel(data.pnlSources?.open) ?? `Not available · ${cellReason(data.pnlSources?.open?.reason ?? states['today.openPnl']?.reason ?? 'feed_not_received')}`)]);
    rows.push(['Source', `${esc(data.source.label)} · paper only`]);
  }
  return `<h3>${icon(TONE_ICON[health.statusTone])}${esc(health.label)} · ${esc(health.explanation)}</h3>
    <p>${problems.length ? esc(problems.join(' ')) : 'No current problems.'}</p>
    ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
    <p>If a light turns yellow or red: reload once. If it stays, tell Amy what the light says and how old the data is.</p>
    <p><button type="button" class="btn quiet link" data-go="history" data-anchor="j-accounting">${icon('book')}J’s bookkeeping${icon('chev-r')}</button></p>`;
}

export function headerHealth(ctx, health) {
  const data = ctx.feeds.data?.value;
  const broker = data ? brokerState(ctx.states, data) : { word: 'unsure', tone: 'warn' };
  const words = { OK: 'Broker OK', degraded: 'Broker unstable', down: 'Broker down', unsure: 'Broker unsure' };
  return { html: `${icon(TONE_ICON[health.statusTone], `i tone-${health.statusTone}`)}<b>${esc(health.label)}</b><span class="lbl-long">· ${words[broker.word]}</span>`,
    label: `${health.label}, broker connection ${broker.word === 'OK' ? 'OK' : broker.word}. Open Desk.` };
}

function sinceLabel(data) {
  const starts = (data?.desks ?? []).map(d => d.accounting?.periodStart).filter(Boolean).sort();
  return starts.length ? `Since ${dayDM(starts[0], NY)}` : 'Since start';
}

function sessionRing(now) {
  const b = sessionBounds(now);
  const R = 26, C = 32, minutes = iso => { const w = wall(iso, VIENNA); return Number(w.slice(11, 13)) * 60 + Number(w.slice(14, 16)); };
  const a = m => (m / 1440) * 2 * Math.PI - Math.PI / 2;
  const pt = m => [C + R * Math.cos(a(m)), C + R * Math.sin(a(m))];
  const arc = (m0, m1, color) => {
    const [p0, p1] = [pt(m0), pt(m1)], big = ((m1 - m0 + 1440) % 1440) > 720 ? 1 : 0;
    return `<path d="M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${R} ${R} 0 ${big} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  };
  const day = nyDay(now);
  let arcs = '';
  if (b.openAt) {
    arcs += arc(minutes(zonedInstant(day, '04:00:00', NY)), minutes(b.openAt), 'var(--line-2)');
    arcs += arc(minutes(b.closeAt), minutes(zonedInstant(day, '20:00:00', NY)), 'var(--line-2)');
    arcs += arc(minutes(b.openAt), minutes(b.closeAt), 'var(--accent)');
  }
  const [nx, ny] = pt(minutes(now));
  const nyTime = timeHM(now, NY);
  const svg = `<svg viewBox="0 0 64 64" role="img" aria-label="Market session ring${b.openAt ? `: regular session ${timeHM(b.openAt)} to ${timeHM(b.closeAt)} Vienna` : ''}; now ${timeHM(now)} Vienna"><circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--line)" stroke-width="5"/>${arcs}<circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="4.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/><text x="32" y="30" text-anchor="middle" class="ring-t">${nyTime}</text><text x="32" y="42" text-anchor="middle" class="ring-s">New York</text></svg>`;
  let title, line;
  if (b.reason === 'calendar_unavailable') { title = 'Market hours not known'; line = 'The market calendar does not cover this date'; }
  else if (b.rth) {
    const left = (Date.parse(b.closeAt) - Date.parse(now)) / 1000;
    title = 'Market open'; line = `Closes in ${age(Math.max(60, left))}, at ${timeHM(b.closeAt)} Vienna`;
  } else {
    const next = nextOpen(now);
    title = 'Market closed';
    line = next ? `Opens ${nyDay(next) === day ? '' : `${dayDDM(next)}, `}at ${timeHM(next)} Vienna` : 'Next opening not known';
  }
  const session = b.openAt ? `${term('session')} ${timeHM(b.openAt)} to ${timeHM(b.closeAt)}` : term('session');
  return `${svg}<div><b>${title}</b><span>${line}</span><span>${session}</span></div>`;
}

function heroLeft(ctx) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const day = cellView(states['today.dayPnl'], 'hero.day');
  const kpi = (termKey, label, cell, key, opts) => {
    const v = cellView(cell, key, opts);
    return `<div class="kpi" data-cell="${key}" data-state="${v.state}"><dt>${term(termKey, label)}</dt><dd>${v.html}<span class="c">${v.caption}</span></dd></div>`;
  };
  const jIncomplete = data && (states['desks.j.equity']?.value == null || states['desks.j.totalPnl']?.value == null);
  let say;
  if (!data) say = 'No numbers yet: no board data has arrived.';
  else if (day.n == null) say = `Today’s result is not available: ${esc(day.caption.replace(/^Unavailable · /, ''))}.`;
  else {
    const who = 'J, Joe and Joel';
    say = isZero(day.n) ? `Flat today for ${who}.` : `${day.n > 0 ? 'Up' : 'Down'} ${eur(Math.abs(day.n))} today across ${who}.`;
    const method = data.pnlSources?.day?.method === 'session-open-estimate' ? dayMethodLabel(data.pnlSources.day) : null;
    if (method) say += ` ${method}.`;
    if (day.state !== 'fresh') say += ` ${day.caption.charAt(0).toUpperCase()}${day.caption.slice(1)}.`;
  }
  const noData = !data ? { caption: 'Unavailable · no snapshot' } : null;
  const fallback = cell => (noData ? { value: null, reason: 'feed_not_received', state: 'not reported' } : cell);
  const k = (termKey, label, name, key, opts) => (noData
    ? `<div class="kpi" data-cell="${key}" data-state="not reported"><dt>${term(termKey, label)}</dt><dd>${bn(null)}<span class="c">Unavailable · no snapshot</span></dd></div>`
    : kpi(termKey, label, fallback(states[name]), key, opts));
  return `<div class="hero-k">${icon('clock')}<span>${term('today')} · ${dayDDM(now, NY)}</span></div>
    <div class="display" data-cell="hero.day" data-state="${noData ? 'not reported' : day.state}">${noData ? bn(null) : day.html}</div>
    <p class="say">${say}</p>
    <dl class="kpis">
      ${k('open', null, 'today.openPnl', 'hero.open', { caption: 'still moving until closed' })}
      ${k('since', sinceLabel(data), 'today.totalPnl', 'hero.since', { caption: 'after fees' })}
      ${k('desksmoney', null, 'today.equity', 'hero.equity', { signed: false, caption: jIncomplete ? 'J’s bookkeeping incomplete · desk total unavailable' : `started with ${eur(15000, false, 0)}` })}
      ${k('paperacct', null, 'paperAccount', 'hero.account', { signed: false, caption: 'includes the kept holdings' })}
    </dl>`;
}

function deskCard(ctx, id, maxDay, showBars) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const desk = data?.desks.find(d => d.id === id);
  const info = STATE[desk?.state] ?? { tone: 'none', icon: 'ring', word: 'Not reported' };
  const since = desk?.stateSince && desk.state !== 'working' ? ` since ${timeHM(desk.stateSince)}` : '';
  const elapsed = feeds.data?.generatedAdvancedAt ? Math.max(0, Date.parse(now) - Date.parse(feeds.data.generatedAdvancedAt)) : 0;
  const hbMs = desk?.heartbeatAt ? gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, data.generatedAt, elapsed) : null;
  const hb = hbMs != null ? `${term('heartbeat')} ${ageSpan(`hb.${id}`, `${age(hbMs / 1000)} ago`)}`
    : data ? `Data ${ageSpan(`hb.${id}`, `${age(dataAge(feeds, now).receipt)} old`)}` : '';
  const dayV = cellView(states[`desks.${id}.dayPnl`], `d.${id}.day`);
  const openV = cellView(states[`desks.${id}.openPnl`], `d.${id}.open`);
  const sinceV = cellView(states[`desks.${id}.totalPnl`], `d.${id}.since`);
  const sinceText = desk?.accounting?.periodStart ? `Since ${dayDM(desk.accounting.periodStart, NY)}` : 'Since start';
  const bar = showBars && dayV.n != null && !isZero(dayV.n)
    ? `<i data-v="${dayV.n}" style="${dayV.n > 0 ? 'left' : 'right'}:50%;width:${(Math.abs(dayV.n) / maxDay * 50).toFixed(3)}%;background:var(--${dayV.n > 0 ? 'gain' : 'loss'})"></i>` : '';
  const num = (label, v, extra = '') => `<div data-state="${v.state}"><span class="k">${label}</span><span class="v">${v.html}</span>${extra}</div>`;
  const status = cardStatus(id, [['Today', dayV, states[`desks.${id}.dayPnl`]], ['Open positions', openV, states[`desks.${id}.openPnl`]], [sinceText, sinceV, states[`desks.${id}.totalPnl`]]]);
  const learning = learningLine(desk?.learning);
  return `<header>${deskMark(id)}<div class="who"><h3>${esc(desk?.label ?? LABEL[id])}</h3><div class="state st ${info.tone}">${icon(info.icon)}<span>${info.word}${since}</span></div></div><span class="hb">${hb}</span></header>
      <p class="now">${desk ? esc(desk.action) : 'Waiting for the first valid snapshot.'}</p>
      <div class="dnums">
        ${num(term('today'), dayV, `<span class="dbar" role="img" aria-label="Today’s result on a shared scale">${bar}</span>`)}
        ${num(term('open'), openV)}
        ${num(term('since', sinceText), sinceV)}
      </div>
      <div class="chart mini" id="mini-${id}"><div class="mini-label">${status || 'since start · last sessions'}</div></div>
      <footer>${icon('learning')}<span>${term('learning')}: ${learning ? esc(learning) : 'not reported'}${desk?.learning?.status === 'blocked' ? ' · blocked' : ''}</span></footer>`;
}

// One line for the card's numbers when any is not fresh; it takes the chart
// label's place, so a fresh card keeps the approved spacing.
function cardStatus(id, cells) {
  const off = cells.filter(([, v]) => v.state !== 'fresh');
  if (!off.length) return '';
  const describe = cell => (cell?.value != null && cell.retained ? `last good, ${ageSpan(`card.${id}`, `${age(cell.ageSeconds)} old`)}`
    : cell?.value != null ? `${ageSpan(`card.${id}`, `${age(cell.ageSeconds)} old`)}`
      : cell?.reason ? 'unavailable' : 'not reported');
  const kind = cell => (cell?.value != null ? (cell.retained ? 'retained' : 'stale') : cell?.reason ? 'broken' : 'none');
  const same = off.length === cells.length && off.every(([, , c]) => kind(c) === kind(off[0][2]));
  const [label, , cell] = off[0];
  const tone = { retained: 'warn', stale: 'warn', broken: 'bad', none: 'none' }[kind(cell)];
  return st(tone, `${same ? 'Numbers' : esc(label)} ${describe(cell)}`);
}

function positionsHtml(ctx) {
  const { states } = ctx;
  const cell = states.positions;
  const rows = cell?.value;
  const header = `<div class="prow hd"><span></span><span class="sub">Holding</span><span class="sub c-side">${term('side')}</span><span class="sub r c-px">${term('lastprice')}</span><span class="sub c-worth">${term('worth')}</span><span class="sub r">${term('open', 'Open result')}</span><span class="sub r c-opened">Updated</span></div>`;
  let note = '';
  if (rows && cell.retained) note = `<p class="pnote">${icon('info')}<span>Last good positions, ${ageSpan('pos', cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`)} · ${esc(cellReason(cell.reason))}</span></p>`;
  else if (rows && cell.state === 'stale') note = `<p class="pnote">${icon('info')}<span>Positions as of ${ageSpan('pos', `${age(cell.ageSeconds)} ago`)}</span></p>`;
  else if (rows && cell.state === 'broken') note = `<p class="pnote">${icon('info')}<span>Prices and results are held back: ${esc(cellReason(cell.reason))}.</span></p>`;
  if (!rows) {
    const text = !ctx.feeds.data?.value || !cell || cell.state === 'not reported' ? 'Position detail is not present in this snapshot.' : `Position detail is unavailable: ${cellReason(cell.reason)}.`;
    return { sub: 'Desk positions only · each in its own currency', html: `<p class="empty-line">${icon('info')}<span>${esc(text)}</span></p>` };
  }
  if (!rows.length) return { sub: '0 open · desk positions only · each in its own currency', html: `${note}<p class="empty-line">${icon('info')}<span>No open positions.</span></p>` };
  const sorted = [...rows].sort((a, b) => DESKS.indexOf(a.desk) - DESKS.indexOf(b.desk) || a.symbol.localeCompare(b.symbol));
  const maxByCurrency = new Map();
  for (const r of sorted) { const v = Math.abs(amountOf(r.marketValue) ?? 0); const c = r.marketValue?.currency; if (c) maxByCurrency.set(c, Math.max(maxByCurrency.get(c) ?? 0, v)); }
  const body = sorted.map(r => {
    const cur = r.mark?.currency ?? r.marketValue?.currency ?? 'USD';
    const value = amountOf(r.marketValue), max = maxByCurrency.get(r.marketValue?.currency) || 0;
    const opened = r.openedAt ? ` · opened ${nyDay(r.openedAt) === nyDay(ctx.now) ? `today ${timeHM(r.openedAt)}` : dayDDM(r.openedAt)}` : '';
    const legacy = r.scope === 'legacy' ? ` · older holding, outside the ${term('stage0', 'first stage')}` : '';
    return `<div class="prow" data-desk="${esc(r.desk ?? '')}">
      ${symBadge(r.symbol, r.desk)}
      <div class="name"><b>${esc(r.symbol)}</b>${r.company ? ` · ${esc(r.company)}` : ''}<span>${r.desk ? `${inlineMark(r.desk)} ${LABEL[r.desk]}` : 'No desk'}${opened}${legacy}</span></div>
      <div class="side c-side">${icon(r.side)}${r.side === 'long' ? 'Long' : 'Short'} ${quantity(r.quantity)}</div>
      <div class="r c-px num">${money(amountOf(r.mark), cur)}</div>
      <div class="c-worth"><span class="num">${money(value, r.marketValue?.currency ?? cur)}</span><span class="vbar">${value != null && max ? `<i data-v="${value}" data-cur="${esc(r.marketValue.currency)}" style="width:${(Math.abs(value) / max * 100).toFixed(3)}%"></i>` : ''}</span></div>
      <div class="r">${pl(amountOf(r.openPnl), r.openPnl?.currency ?? cur)}</div>
      <div class="r c-opened num">${r.updatedAt ? timeHM(r.updatedAt) : '—'}</div>
    </div>`;
  }).join('');
  return { sub: `${rows.length} open · desk positions only · each in its own currency`, html: `${note}${header}${body}` };
}

function keptHtml(ctx) {
  const { states } = ctx;
  const cell = states.kept;
  const rows = cell?.value;
  const nav = states.paperAccount?.value ? eur(amountOf(states.paperAccount.value)) : '—';
  const worth = rows?.length ? sumByCurrency(rows.map(r => r.marketValue)).map(s => money(s.amount, s.currency)).join(' and ') : null;
  const caption = `<p class="keep-cap">${icon('keep')}<span>Read-only. Left out of every desk result and of Results; counted in the ${term('paperacct', 'paper account')} (${nav}).${worth ? ` Worth ${worth} now, each in its own currency.` : ''}</span></p>`;
  if (!rows) {
    const text = !ctx.feeds.data?.value || !cell || cell.state === 'not reported' ? 'Kept holdings are not present in this snapshot.' : `Kept holdings are unavailable: ${cellReason(cell.reason)}.`;
    return `${caption}<p class="empty-line">${icon('info')}<span>${esc(text)}</span></p>`;
  }
  if (!rows.length) return `${caption}<p class="empty-line">${icon('info')}<span>No kept holdings in this snapshot.</span></p>`;
  const note = cell.retained ? `<p class="pnote">${icon('info')}<span>Last good values, ${ageSpan('kept', cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`)} · ${esc(cellReason(cell.reason))}</span></p>`
    : cell.state === 'broken' ? `<p class="pnote">${icon('info')}<span>Prices are held back: ${esc(cellReason(cell.reason))}.</span></p>` : '';
  return `${caption}${note}${[...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(r => {
    const cur = r.mark?.currency ?? r.marketValue?.currency ?? 'EUR';
    return `<div class="prow" data-keep="${esc(r.symbol)}">
      ${symBadge(r.symbol)}
      <div class="name"><b>${esc(r.symbol)}</b>${r.company ? ` · ${esc(r.company)}` : ''}<span>${r.side === 'long' ? 'Long' : 'Short'} ${quantity(r.quantity)} · last price ${money(amountOf(r.mark), cur)}</span></div>
      <div class="side c-side">${icon(r.side)}${r.side === 'long' ? 'Long' : 'Short'} ${quantity(r.quantity)}</div>
      <div class="r c-px num">${money(amountOf(r.mark), cur)}</div>
      <div class="c-worth num">${money(amountOf(r.marketValue), r.marketValue?.currency ?? cur)}</div>
      <div class="r"><span class="kept-label">${icon('keep')}Kept · not traded by any desk</span></div>
    </div>`;
  }).join('')}`;
}

const chartKeys = new Map();
function chartOnce(el, key, draw) {
  if (!el) return;
  if (chartKeys.get(el.id) === key && el.querySelector('svg')) return;
  chartKeys.set(el.id, key);
  draw();
}
export const forgetCharts = () => chartKeys.clear();

function drawHeroChart(ctx, history) {
  const el = $('#heroChart');
  const b = sessionBounds(ctx.now);
  const nowMs = Date.parse(ctx.now);
  const minuteKey = Math.floor(nowMs / 60000);
  const key = JSON.stringify([b.openAt, minuteKey, history?.seq, history?.receivedAt, el?.clientWidth, el?.clientHeight]);
  if (chartKeys.get(el?.id) === key && el?.querySelector('svg')) return;
  const series = b.openAt && history ? intraday(history.columns, 'dayPnl', b.openAt, b.closeAt) : [];
  chartOnce(el, key, () => {
    if (!b.openAt) { drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: 'Market closed today', label: 'Market closed today' }); return; }
    const open = Date.parse(b.openAt), close = Date.parse(b.closeAt);
    const empty = !series.length;
    drawChart(el, {
      series: [{ pts: series, color: 'var(--accent)', live: b.rth }], xDomain: [open, close], zero: true, ticks: 3, yFmt: eurAxis, pad: { l: 52 },
      future: b.rth ? [nowMs, close] : null, empty, emptyText: nowMs < open ? `The session opens at ${timeHM(b.openAt)}` : 'No result points for this session yet',
      xLabels: [{ x: open, text: timeHM(b.openAt), anchor: 'start' }, ...(b.rth && nowMs - open > (close - open) * 0.18 && close - nowMs > (close - open) * 0.18 ? [{ x: nowMs, text: `now ${timeHM(ctx.now)}` }] : []), { x: close, text: timeHM(b.closeAt), anchor: 'end' }],
      label: `Today’s result through the regular session${series.length ? `: ${eur(series.at(-1).v, true)}` : ''}`,
      tipFmt: near => `<b>${timeHM(new Date(near[0].x).toISOString())}</b> · ${eur(near[0].v, true)}`,
    });
  });
}

function drawMiniCharts(ctx, history) {
  const series = {};
  for (const id of DESKS) {
    const closes = history?.closes?.[id] ?? [];
    const cell = ctx.states[`desks.${id}.totalPnl`];
    const nowValue = cell && !cell.retained && cell.value ? amountOf(cell.value) : null;
    series[id] = [...closes.map((c, i) => ({ x: i, v: c.v })), ...(nowValue != null ? [{ x: closes.length, v: nowValue }] : [])];
  }
  const shared = Object.values(series).flat().map(p => p.v);
  for (const id of DESKS) {
    const el = $(`#mini-${id}`);
    const pts = series[id];
    chartOnce(el, JSON.stringify([pts, shared, el?.clientWidth]), () => {
      drawChart(el, { series: [{ pts, color: `var(--desk-${id})` }], xDomain: [0, Math.max(1, pts.length - 1)], zero: true, include: shared, ticks: 2, noY: true,
        pad: { l: 2, r: 6, t: 14, b: 4 }, empty: pts.length < 2, emptyText: 'History fills as sessions pass',
        label: `${LABEL[id]}: result since start over the last ${pts.length} sessions` });
    });
  }
}

export function renderDesk(ctx) {
  const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
  patch($('#health'), healthStrip(ctx, health));
  patch($('#healthPop'), healthPop(ctx, health));
  patch($('#heroL'), heroLeft(ctx));
  patch($('#heroSession'), sessionRing(ctx.now));
  const data = ctx.feeds.data?.value;
  const working = data ? data.desks.filter(d => d.state === 'working').length : 0;
  $('#desksSub').textContent = data ? `${working} of 3 working · kept holdings left out` : 'Waiting for the first valid snapshot';
  const days = DESKS.map(id => amountOf(ctx.states[`desks.${id}.dayPnl`]?.value));
  const showBars = days.every(v => v != null);
  const maxDay = Math.max(...days.filter(v => v != null).map(Math.abs), 0.01);
  let redraw = false;
  for (const id of DESKS) {
    const changed = patch($(`#desk-${id}`), deskCard(ctx, id, maxDay, showBars));
    if (changed) { chartKeys.delete(`mini-${id}`); redraw = true; }
  }
  const pos = positionsHtml(ctx);
  $('#posSub').textContent = pos.sub;
  patch($('#positions'), pos.html);
  patch($('#kept'), keptHtml(ctx));
  const history = ctx.states.history?.value?.columns ? ctx.states.history.value : null;
  drawHeroChart(ctx, history);
  drawMiniCharts(ctx, history);
  return { health, redraw };
}
