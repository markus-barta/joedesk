// Desk: health line and details, Today, the three desks, positions and the
// kept holdings. Every number keeps its panel state; matching snapshot captions
// are shared once, while different ages and reasons stay beside their values.
import { $, icon, term, st, bn, pl, deskMark, inlineMark, symBadge, ageSpan, patch, statePhrase, stateCaption, reservedCaption, cashCaption } from './ui.js';
import { esc, amountOf, money, eur, age, quantity, sumByCurrency, timeHM, timeHMS, dayDDM, dayDM, dateTimeFull, isZero, localDay, ledgerSize, digits, MINUS, NB } from './format.js';
import { boardHealthPresentation, boardDiagnostics, brokerState, dataAge, cellReason, capital, deskValuesNotExact, STALE_AFTER_S, statusPresentation } from './health.js';
import { sessionBounds, nextOpen, zonedInstant, nyDay, wall, NY, VIENNA } from './time.mjs';
import { gatewayCheckAgeMs } from './contracts/gateway.mjs';
import { drawChart, eurAxis } from './chart.js';
import { intraday } from './history-model.js';
import { learningLine } from './events.js';
import { panelState } from './contracts/panel-state.mjs';
import { decimalUnits, divRound, unitsDecimal, UNIT } from './contracts/decimal.mjs';
import { STARTING_MONEY, exactCell, todayPercent, sincePercent, rankDesks } from './performance.js';
import { outageValue, withGenerationAge } from './board-state.js';

const DESKS = ['j', 'joe', 'joel'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const TONE_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
const STATE = {
  working: { tone: 'ok', icon: 'work', word: 'Working' },
  'sit-out': { tone: 'none', icon: 'pause', word: 'Sitting out' },
  stuck: { tone: 'bad', icon: 'stop', word: 'Stuck' },
};

// Phone disclosure choices last for this page visit only. No storage access,
// account state or server write; desktop always exposes the complete content.
const expanded = new Set();
export function syncDeskDisclosures(phone = matchMedia('(max-width: 480px)').matches) {
  for (const control of document.querySelectorAll('[data-desk-disclosure]')) {
    const open = !phone || expanded.has(control.dataset.deskDisclosure);
    control.setAttribute('aria-expanded', String(open));
    document.getElementById(control.getAttribute('aria-controls')).hidden = !open;
  }
  const sentence = document.querySelector('#heroL .say > span');
  if (sentence) {
    sentence.dataset.clamp = phone ? '1' : '2';
    sentence.parentElement.title = sentence.textContent;
  }
}
export function toggleDeskDisclosure(key) {
  if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
}

// Compare the reader's words: gateway_down and upstream_lost deliberately
// describe the same problem. Only repeated, affected reasons can be shared.
export function sharedSectionReason(cells) {
  const counts = new Map();
  for (const cell of cells) {
    if (!cell?.reason || cell.state === 'fresh') continue;
    const reason = cellReason(cell.reason);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).find(([, count]) => count > 1)?.[0] ?? null;
}

// Rank the actual selector states, including retained values. A fresh panel
// may still contain partial rows; those reasons join the same summary ranking.
export function disclosureProblem(candidates) {
  const severity = { bad: 3, warn: 2, none: 1 };
  const problems = candidates.flatMap(([label, cell]) => {
    const p = statePhrase(cell, '');
    if (p.state === 'fresh') return [];
    const state = cell?.retained ? 'last good' : p.state === 'stale' ? 'stale'
      : p.state === 'not reported' ? 'not reported' : 'unavailable';
    const reason = cell?.reason ?? (p.state === 'not reported' ? 'feed_not_received' : null);
    // Unavailable money leads even when its honest not-exact icon is neutral;
    // an old check-in must not obscure that the row's figures are unknown.
    const priority = cell?.state === 'broken' || state === 'unavailable' ? 3 : severity[p.tone];
    return [{ tone: p.tone, icon: p.icon ?? TONE_ICON[p.tone], priority, reason: reason ? cellReason(reason) : null, label: `${label}: ${state}` }];
  });
  problems.sort((a, b) => b.priority - a.priority || severity[b.tone] - severity[a.tone]);
  if (!problems.length) return null;
  const summarize = list => {
    if (!list.length) return null;
    const seen = new Set();
    const detail = list.map(p => {
      const suffix = p.reason && !seen.has(p.reason) ? ` · ${p.reason}` : '';
      seen.add(p.reason);
      return p.label + suffix;
    }).join('; ');
    const first = list[0];
    return { tone: first.tone, icon: first.icon, text: first.label + (first.reason ? ` · ${first.reason}` : ''), detail };
  };
  const sharedReason = sharedSectionReason(candidates.map(([, cell]) => cell)) ??
    candidates.filter(([, cell]) => Array.isArray(cell?.value)).map(([, cell]) => positionSectionReason(cell)).find(Boolean) ?? null;
  return { ...summarize(problems), sharedReason,
    expanded: sharedReason ? summarize(problems.filter(p => p.reason !== sharedReason)) : null };
}
function problemHtml(problem) {
  const html = p => p ? `${icon(p.icon, `i tone-${p.tone}`)}<span class="summary-text" title="${esc(p.detail)}" aria-hidden="true">${esc(p.text)}</span><span class="vh">${esc(p.detail)}</span>` : '';
  return problem?.sharedReason ? `<span class="collapsed-summary">${html(problem)}</span><span class="expanded-summary">${html(problem.expanded)}</span>` : html(problem);
}
function disclosureButton(key, label, bodyId, problem = null) {
  return `<button type="button" class="desk-disclosure" data-desk-disclosure="${key}" aria-expanded="${expanded.has(key)}" aria-controls="${bodyId}"><span>${esc(label)}</span><span class="disclosure-warning">${problemHtml(problem)}</span>${icon('chev-d', 'i disclosure-chevron')}</button>`;
}
export function rowProblems(cell) {
  return (cell?.value ?? []).flatMap(row => Object.entries(row.reasons ?? {}).map(([field, reason]) =>
    [`${row.symbol} ${POSITION_FIELDS[field] ?? field}`, { state: 'broken', value: null, reason }]));
}

function deskProblem(ctx, id) {
  const desk = ctx.feeds.data?.value?.desks.find(d => d.id === id);
  const cells = [['Today', ctx.states[`desks.${id}.dayPnl`]], ['Open positions', ctx.states[`desks.${id}.openPnl`]], ['Since start', ctx.states[`desks.${id}.totalPnl`]], ['History', ctx.states.history]];
  if (desk?.state === 'stuck') cells.unshift(['Desk stuck', { state: 'broken', value: null }]);
  if (desk?.learning?.status === 'blocked') cells.push(['Learning blocked', { state: 'broken', value: null }]);
  const elapsed = ctx.feeds.data?.generatedAdvancedAt ? Math.max(0, Date.parse(ctx.now) - Date.parse(ctx.feeds.data.generatedAdvancedAt)) : 0;
  const heartbeat = desk?.heartbeatAt ? gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, ctx.feeds.data.value.generatedAt, elapsed) : null;
  if (desk && (heartbeat == null || heartbeat / 1000 >= STALE_AFTER_S)) cells.unshift(['Check-in', { state: heartbeat == null ? 'not reported' : 'stale', value: heartbeat }]);
  return disclosureProblem(cells);
}
export function compactDesk(ctx, id) {
  const desk = ctx.feeds.data?.value?.desks.find(d => d.id === id);
  const info = STATE[desk?.state] ?? { tone: 'none', icon: 'ring', word: 'Not reported' };
  const shared = sharedSectionReason(['dayPnl', 'openPnl', 'totalPnl'].map(name => ctx.states[`desks.${id}.${name}`]));
  const figure = (name, label) => {
    const cell = ctx.states[`desks.${id}.${name}`], value = cellView(cell, `compact.${id}.${name}`, { label });
    const marker = cellIcon(cell, shared).replace('cell-state', 'compact-state');
    const characters = value.units === null ? 1 : eur(value.units, true).length;
    return `<span class="compact-figure" data-compact-value="${name}" style="--digits:${characters}"><span class="compact-label">${label}${marker}${name === 'dayPnl' ? dayEstimateMark(ctx, id) : ''}</span>${value.html}</span>`;
  };
  return `<button type="button" class="desk-disclosure desk-row" data-desk-disclosure="${id}" aria-expanded="${expanded.has(id)}" aria-controls="detail-${id}">
    ${deskMark(id)}<span class="compact-identity"><strong>${esc(desk?.label ?? LABEL[id])}</strong><span class="compact-word tone-${info.tone}">${icon(info.icon)}${info.word}</span></span>
    ${figure('dayPnl', 'Today')}${figure('totalPnl', 'Since start')}${icon('chev-d', 'i disclosure-chevron')}
    <span class="disclosure-warning">${problemHtml(deskProblem(ctx, id))}</span></button>`;
}

// Accepted snapshots are immutable between reads. Format this snapshot-only
// explanation once, rather than redoing ledger arithmetic on Desk live ticks.
const executorProblems = new WeakMap();
export function executorProblem(data) {
  if (!data) return null;
  if (executorProblems.has(data)) return executorProblems.get(data);
  const executor = data.safety.executor;
  const problem = executor?.reason === 'ledger_size_limit' ? 'Trade record is full: new orders refused'
    : executor?.status === 'degraded' && executor.reason === 'results_capture_failed' ? 'Paper executor degraded: results capture failing, trading continues' : null;
  const ledger = problem ? ledgerSize(executor) : null;
  const sentence = problem ? `${problem}${ledger ? ` (${ledger.text})` : ''}.` : null;
  executorProblems.set(data, sentence);
  return sentence;
}

// One money cell: the value (or a dash) and a caption for exactly the state
// the shared selector gave it, with this cell's own age and reason. A fresh
// value keeps the designed caption.
export function cellView(cell, key, { signed = true, caption = '', sharedReason = null, label = null } = {}) {
  const value = cell?.value ?? null;
  const n = amountOf(value);
  const units = value ? decimalUnits(value.amount) : null;
  const missingLabel = `${label}: not reported${cell?.reason ? ` · ${cellReason(cell.reason)}` : ''}`;
  const html = value == null && label ? `<span class="bn muted" role="img" title="${esc(missingLabel)}" aria-label="${esc(missingLabel)}">—</span>` : bn(units, value?.currency ?? 'EUR', signed);
  return { html, caption: stateCaption(cell, key, caption, undefined, sharedReason), state: cell?.state ?? 'not reported', n, units };
}

// One snapshot-level caption. A different reason, age, retention or missing
// value remains local to its cell; only an identical state is shared.
export function boardCaptionCell(ctx) {
  const data = ctx.feeds.data?.value;
  if (!data || !ctx.now) return null;
  const cell = withGenerationAge(panelState(ctx.feeds.data, data, null, ctx.now), ctx.feeds.data, ctx.now);
  return cell.state === 'fresh' ? null : cell;
}
export function sharesBoardCaption(cell, board) {
  return Boolean(board && cell && ['state', 'reason', 'retained', 'ageSeconds'].every(k => cell[k] === board[k]) &&
    (cell.health?.available ?? (cell.value != null)) === (board.value != null));
}
function cellIcon(cell, sharedReason = null) {
  if (!cell || cell.state === 'fresh') return '';
  const p = statePhrase(cell, '');
  const label = `${capital(p.state)}${cell.reason && cellReason(cell.reason) !== sharedReason ? ` · ${cellReason(cell.reason)}` : ''}`;
  return `<span class="cell-state tone-${p.tone}" role="img" aria-label="${esc(label)}">${icon(p.icon ?? TONE_ICON[p.tone])}</span>`;
}
export function percentHtml(hundredths) {
  if (hundredths === null) return '';
  const sign = hundredths < 0n ? MINUS : hundredths > 0n ? '+' : '';
  return `<span class="performance-pct${hundredths ? hundredths > 0n ? ' gain' : ' loss' : ''}">${sign}${digits(hundredths * UNIT / 100n, 2)}${NB}%</span>`;
}

function healthFacts(ctx, health) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const reason = esc(capital(health.reason === 'board_ok' ? 'numbers up to date' : health.explanation));
  const facts = [`<span class="st ${health.statusTone} why">${icon(TONE_ICON[health.statusTone])}<span>${reason}</span></span>`];
  if (data) {
    const broker = brokerState(states, data);
    const words = { OK: `checked ${ageSpan('strip.broker', `${age(states.gateway?.ageSeconds)} ago`)}`, degraded: 'unstable', down: 'down', unsure: 'has not checked in' };
    facts.push(st(broker.tone, `${term('broker')} ${words[broker.word]}`));
    facts.push(states.halt?.value == null ? st('none', `${term('halt')} not reported`) : st(states.halt.value ? 'bad' : 'ok', `${term('halt')} ${states.halt.value ? 'on' : 'off'}`));
    const { receipt, frozen } = dataAge(feeds, now);
    const dataTone = feeds.data.reason || frozen >= STALE_AFTER_S ? 'warn' : 'ok';
    facts.push(st(dataTone, `${term('datafrom', `Data from ${timeHMS(data.generatedAt)}`)}${receipt >= STALE_AFTER_S ? ` · ${ageSpan('strip.data', `${age(receipt)} old`)}` : ''}`));
  } else {
    const why = feeds.data?.reason && feeds.data.reason !== 'feed_not_received' ? feeds.data.reason : null;
    facts.push(st('none', `${term('broker')} not reported`), st('none', `${term('halt')} not reported`));
    facts.push(why ? st('bad', `No data · ${esc(cellReason(why))}`) : st('none', 'No data yet'));
  }
  return `<div class="health-facts">${facts.join('')}</div>`;
}

function dayMethodLabel(source) {
  if (!source || source.status !== 'available') return null;
  const start = source.periodStart ? timeHM(source.periodStart) : null;
  if (source.method === 'sod-virtual-equity') return start ? `Counted from ${start}${source.periodStart && wall(source.periodStart, NY).slice(11, 16) === '00:00' ? ' (midnight in New York)' : ''}` : 'Counted from the start of the day';
  if (source.method === 'session-open-estimate') return `Estimated from the session open${start ? ` at ${start}` : ''}`;
  if (source.method === 'ib-daily-pnl') return 'Reported by Interactive Brokers';
  return null;
}
function dayEstimateMark(ctx, id) {
  const cell = ctx.states[`desks.${id}.dayPnl`], source = cell?.valueSource;
  if (cell?.value == null || source?.status !== 'available' || source.method !== 'session-open-estimate') return '';
  return `<span class="estimate-mark" role="img" aria-label="${esc(dayMethodLabel(source))}">Estimated</span>`;
}
function openMethodLabel(source) {
  if (!source || source.status !== 'available') return null;
  return source.method === 'ib-unrealized-pnl' ? 'Valued by Interactive Brokers' : source.method === 'owned-lots-current-mark-fx' ? 'Valued from the desks’ own purchases at the last price' : null;
}

export function healthPop(ctx, health) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const problems = boardDiagnostics(states, feeds, now);
  const executor = executorProblem(data);
  if (executor) problems.push(executor);
  const rows = [];
  if (data) {
    const { receipt } = dataAge(feeds, now);
    const gateway = data.safety.gateway;
    const broker = brokerState(states, data);
    rows.push(['Data', `${dateTimeFull(data.generatedAt)} · ${ageSpan('pop.data', `${age(receipt)} old`)} · refreshes every 15${NB}s`]);
    rows.push(['Broker connection', `${broker.word === 'OK' ? 'Answering' : broker.word === 'down' ? 'Down' : broker.word === 'degraded' ? 'Unstable' : 'Not confirmed'}${gateway?.reason ? ` · ${esc(cellReason(gateway.reason))}` : ''}${gateway?.checkedAt ? ` · checked ${timeHMS(gateway.checkedAt)}` : ' · no check reported'}`]);
    rows.push(['Emergency stop', data.safety.halt ? `On: ${esc(cellReason(data.safety.haltReason))}` : 'Off']);
    rows.push([term('heartbeat'), data.desks.map(desk => {
      const elapsed = feeds.data.generatedAdvancedAt ? Math.max(0, Date.parse(now) - Date.parse(feeds.data.generatedAdvancedAt)) : 0;
      const ms = gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, data.generatedAt, elapsed);
      return `${esc(desk.label)}: ${ms == null ? 'not reported' : `${ageSpan(`pop.hb.${desk.id}`, `${age(ms / 1000)} ago`)}`}`;
    }).join(' · ')]);
    rows.push(['Today’s result', esc(dayMethodLabel(data.pnlSources?.day) ?? `Not available · ${cellReason(data.pnlSources?.day?.reason ?? states['today.dayPnl']?.reason ?? 'feed_not_received')}`)]);
    rows.push(['Open positions', esc(openMethodLabel(data.pnlSources?.open) ?? `Not available · ${cellReason(data.pnlSources?.open?.reason ?? states['today.openPnl']?.reason ?? 'feed_not_received')}`)]);
    rows.push(['Source', `${esc(data.source.label)} · paper only`]);
  }
  return `<h3>${icon(TONE_ICON[health.statusTone])}Board status details</h3>
    <p class="status-sentence">${esc(statusPresentation(ctx, health).sentence)}</p>
    ${healthFacts(ctx, health)}
    <p>${problems.length ? esc(problems.join(' ')) : 'No current problems.'}</p>
    ${deskValuesNotExact(states) ? `<p>${st('none', 'Desk values are not exact yet', 'info')}</p>` : ''}
    ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
    <p>If a light turns yellow or red: reload once. If it stays, tell Amy what the light says and how old the data is.</p>
    <p><button type="button" class="btn quiet link" data-go="history" data-anchor="j-accounting">${icon('book')}J’s bookkeeping${icon('chev-r')}</button></p>`;
}

export function headerHealth(ctx, health) {
  const status = statusPresentation(ctx, health);
  return { ...status, html: `${icon(health.tone === 'green' ? 'check' : TONE_ICON[health.statusTone], `i tone-${health.statusTone}`)}<span class="lbl"><b data-clamp="1" title="${esc(status.sentence)}"><span class="status-full">${esc(status.sentence)}</span><span class="status-compact">${esc(status.compact)}</span></b></span>${icon('chev-d', 'i status-chevron')}`,
    label: `${health.tone === 'green' ? 'Live. Numbers are up to date' : status.sentence}. Open status details.`, title: status.sentence };
}

function sessionRing(now) {
  if (!now) {
    const svg = `<svg viewBox="0 0 64 64" role="img" aria-label="Market session ring: the board server’s time is not known yet"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="5"/></svg>`;
    return `${svg}<div><b>Time not known</b><span>Waiting for the board server’s clock</span><span>${term('session')}</span></div>`;
  }
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

export function heroLeft(ctx) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const dayCell = states['today.dayPnl'];
  const board = boardCaptionCell(ctx);
  const shared = data ? sharedSectionReason(['today.dayPnl', 'today.totalPnl', 'today.openPnl', 'today.equity', 'paperAccount', 'paperCash'].map(name => states[name])) : null;
  const day = cellView(dayCell, 'hero.day', { sharedReason: shared, label: 'Today' });
  const kpi = (termKey, label, name, key, opts) => {
    const v = cellView(states[name], key, { ...opts, sharedReason: shared, label: label ?? { open: 'Open positions', desksmoney: 'Desks’ money', paperacct: 'Paper account' }[termKey] });
    const caption = reservedCaption(sharesBoardCaption(states[name], board) ? '' : v.caption, opts.captions ?? [opts.caption]);
    return `<div class="kpi" data-cell="${key}" data-state="${v.state}"><dt>${term(termKey, label)}${cellIcon(states[name], shared)}</dt><dd>${v.html}<span class="c">${caption}</span></dd></div>`;
  };
  const jIncomplete = data && (states['desks.j.equity']?.value == null || states['desks.j.totalPnl']?.value == null);
  const moneyCaptions = [`started with ${eur(STARTING_MONEY, false, 0)}`, 'J’s bookkeeping incomplete · desk total unavailable'];
  const why = dayCell?.reason ? cellReason(dayCell.reason) : null;
  // A dashed Today needs its own state/reason unless the section says it.
  const dayCaption = day.state === 'broken' && day.units === null && !sharesBoardCaption(dayCell, board) && (!shared || why !== shared) ? day.caption : '';
  const dayAmount = day.units === null ? null : eur(day.units < 0n ? -day.units : day.units);
  let say;
  if (day.n == null) {
    say = data ? `Today’s result is not available${why === shared ? '' : `: ${esc(why ?? 'not reported')}`}.`
      : day.state === 'not reported' ? 'No numbers yet: no board data has arrived.' : `No numbers: ${esc(why ?? 'not available')}.`;
  } else if (day.state === 'fresh') {
    const who = 'J, Joe and Joel';
    say = isZero(day.units) ? `Flat today for ${who}.` : `${day.units > 0n ? 'Up' : 'Down'} ${dayAmount} today across ${who}.`;
    const method = data?.pnlSources?.day?.method === 'session-open-estimate' ? dayMethodLabel(data.pnlSources.day) : null;
    if (method) say += ` ${method}.`;
  } else {
    // Not fresh: the amount, then this value's own state, age and reason.
    say = `${isZero(day.units) ? 'Flat' : `${day.units > 0n ? 'Up' : 'Down'} ${dayAmount}`} today.${sharesBoardCaption(dayCell, board) ? '' : ` ${day.caption}.`}`;
  }
  const sinceCell = states['today.totalPnl'], since = cellView(sinceCell, 'hero.since', { caption: 'after fees', sharedReason: shared, label: 'Since start' });
  const sharedCell = shared ? Object.values(states).find(cell => cell?.reason && cellReason(cell.reason) === shared && cell.state !== 'fresh') : null;
  const boardText = [board ? st(statePhrase(board, '').tone, stateCaption(board, 'board.caption')) : '',
    shared && (!board?.reason || cellReason(board.reason) !== shared) ? st(statePhrase(sharedCell, '').tone, `Numbers unavailable · ${esc(shared)}`, statePhrase(sharedCell, '').icon) : ''].filter(Boolean).join(' ');
  return `<div class="hero-primary"><div class="performance-date">${now ? dayDDM(now, NY) : ''}</div><div class="performance">
      <div class="primary" data-cell="hero.day" data-state="${day.state}"><div class="hero-k">${icon('clock')}${term('today')}${cellIcon(dayCell, shared)}</div>
        <div class="display">${day.html}</div><div class="pct-slot">${percentHtml(todayPercent(states, data?.pnlSources?.day))}</div>
        <span class="c primary-caption">${dayCaption}</span></div>
      <div class="primary since-primary" data-cell="hero.since" data-state="${since.state}"><div class="hero-k">${term('since')}${cellIcon(sinceCell, shared)}</div>
        <div class="display">${since.html}</div><div class="pct-slot">${percentHtml(sincePercent(states))}</div>
        <span class="c primary-caption">${reservedCaption(sharesBoardCaption(sinceCell, board) ? '' : since.caption, ['after fees'])}</span>
        <button type="button" class="phone-primary-note" data-say="since" aria-label="About Since start" aria-expanded="false"${sharesBoardCaption(sinceCell, board) ? ' disabled' : ''}><span data-clamp="3">${sharesBoardCaption(sinceCell, board) ? '&#160;' : stateCaption(sinceCell, 'hero.phone.since', 'after fees', undefined, shared)}</span></button></div>
    </div>
    <button type="button" class="say" data-say="today" aria-expanded="false"><span data-clamp="2">${say}</span></button>
    <p class="board-caption">${boardText}</p></div>
    <div class="account-section" id="accountSection">${disclosureButton('account', 'Account', 'accountDetail', disclosureProblem([
      ['Open positions', states['today.openPnl']], ['Desks’ money', states['today.equity']], ['Paper account', states.paperAccount], ['Cash', states.paperCash], ['Broker', states.gateway],
    ]))}<div class="disclosure-body" id="accountDetail"><p class="pstate account-state"${shared ? '' : ' aria-hidden="true"'}>${shared ? st(statePhrase(sharedCell, '').tone, `Numbers unavailable · ${esc(shared)}`, statePhrase(sharedCell, '').icon) : ''}</p><dl class="kpis">
      ${kpi('open', null, 'today.openPnl', 'hero.open', { caption: 'still moving until closed' })}
      ${kpi('desksmoney', null, 'today.equity', 'hero.equity', { signed: false, caption: moneyCaptions[jIncomplete ? 1 : 0], captions: moneyCaptions })}
      ${kpi('paperacct', null, 'paperAccount', 'hero.account', { signed: false, caption: 'includes the kept holdings' })}
      ${cashCaption(states.paperCash, 'hero.cash', { figure: true, sharedReason: shared })}
    </dl></div></div>`;
}

function deskCard(ctx, id, maxDay, showBars) {
  const { states, feeds, now } = ctx;
  const data = feeds.data?.value;
  const desk = data?.desks.find(d => d.id === id);
  const info = STATE[desk?.state] ?? { tone: 'none', icon: 'ring', word: 'Not reported' };
  const since = desk?.stateSince && desk.state !== 'working' ? ` since ${timeHM(desk.stateSince)}` : '';
  const elapsed = feeds.data?.generatedAdvancedAt ? Math.max(0, Date.parse(now) - Date.parse(feeds.data.generatedAdvancedAt)) : 0;
  const hbMs = desk?.heartbeatAt ? gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, data.generatedAt, elapsed) : null;
  const snapshotAge = dataAge(feeds, now).receipt;
  const hb = hbMs != null ? hbMs / 1000 >= STALE_AFTER_S
    ? `${term('heartbeat')} ${ageSpan(`hb.${id}`, `${age(hbMs / 1000)} ago`)}` : ''
    : snapshotAge != null && snapshotAge >= STALE_AFTER_S ? `Data ${ageSpan(`hb.${id}`, `${age(snapshotAge)} old`)}` : '';
  const shared = sharedSectionReason(['dayPnl', 'openPnl', 'totalPnl'].map(name => states[`desks.${id}.${name}`]));
  const dayV = cellView(states[`desks.${id}.dayPnl`], `d.${id}.day`, { label: 'Today' });
  const openV = cellView(states[`desks.${id}.openPnl`], `d.${id}.open`, { label: 'Open positions' });
  const sinceV = cellView(states[`desks.${id}.totalPnl`], `d.${id}.since`, { label: 'Since start' });
  const sinceText = desk?.accounting?.periodStart ? `Since ${dayDM(desk.accounting.periodStart, NY)}` : 'Since start';
  const bar = showBars && exactCell(states[`desks.${id}.dayPnl`]) !== null && dayV.n != null && !isZero(dayV.n)
    ? `<i data-v="${dayV.n}" style="${dayV.n > 0 ? 'left' : 'right'}:50%;width:${(Math.abs(dayV.n) / maxDay * 50).toFixed(3)}%;background:var(--${dayV.n > 0 ? 'gain' : 'loss'})"></i>` : '';
  const board = boardCaptionCell(ctx);
  const num = (label, v, cell, extra = '') => {
    const characters = v.units === null ? 1 : eur(v.units, true).length;
    return `<div data-state="${v.state}"><span class="k">${label}${cellIcon(cell, shared)}</span><span class="v" style="--digits:${characters}">${v.html}</span>${extra}</div>`;
  };
  const status = cardStatus(id, [['Today', states[`desks.${id}.dayPnl`]], ['Open positions', states[`desks.${id}.openPnl`]], [sinceText, states[`desks.${id}.totalPnl`]]], board);
  const learning = learningLine(desk?.learning);
  return `<header>${deskMark(id)}<div class="who"><h3>${esc(desk?.label ?? LABEL[id])}</h3><div class="state st ${info.tone}">${icon(info.icon)}<span title="${esc(info.word + since)}">${info.word}${since}</span></div></div><span class="hb warn">${hb}</span></header>
      <p class="now">${desk ? esc(desk.action) : 'Waiting for the first valid snapshot.'}</p>
      <div class="dnums">
        ${num(term('today') + dayEstimateMark(ctx, id), dayV, states[`desks.${id}.dayPnl`], `<span class="dbar" role="img" aria-label="Today’s result on a shared scale">${bar}</span>`)}
        ${num(term('open'), openV, states[`desks.${id}.openPnl`])}
        ${num(term('since', sinceText), sinceV, states[`desks.${id}.totalPnl`])}
      </div>
      <div class="chart mini" id="mini-${id}"><div class="mini-label${status ? ' off' : ''}">${status || 'since start · last sessions'}</div></div>
      <footer>${icon('learning')}<span>${term('learning')}: ${learning ? esc(learning) : 'not reported'}${desk?.learning?.status === 'blocked' ? ' · blocked' : ''}</span></footer>`;
}

// The card's numbers that are not fresh, each with its own state, age and
// reason. Numbers that share all three share a line. The lines sit in the
// chart's own fixed box, so a fresh card keeps the approved spacing and a
// change of state moves nothing.
export function cardStatus(id, cells, board = null) {
  const groups = [];
  for (const [label, cell] of cells) {
    if ((cell?.state ?? 'not reported') === 'fresh' || sharesBoardCaption(cell, board)) continue;
    const key = JSON.stringify([cell?.state, cell?.reason, cell?.ageSeconds, cell?.retained, cell?.value == null, cell?.retained ? cell.valueReceivedAt : null]);
    const group = groups.find(g => g.key === key);
    if (group) group.labels.push(label); else groups.push({ key, labels: [label], cell });
  }
  if (!groups.length) return '';
  const seen = new Set();
  return groups.map((g, i) => {
    const reason = g.cell?.reason ? cellReason(g.cell.reason) : null;
    const p = statePhrase(g.cell, `card.${id}.${i}`, 'last good', seen.has(reason) ? reason : null);
    seen.add(reason);
    const who = g.labels.length === cells.length ? 'Numbers' : g.labels.length === 2 ? `${g.labels[0]} and ${g.labels[1]}` : g.labels[0];
    return st(p.tone, `${esc(who)}: ${p.text}`, p.icon);
  }).join('');
}

// One reserved line per section for its own panel state: fresh says so, any
// other state gives its age and reason. It never appears or disappears, so a
// change of state moves nothing below it.
function sectionState(cell, key, { fresh, held, missing, absent, sharedReason = null, detail = '' }) {
  const p = statePhrase(cell, key, held, sharedReason);
  const text = sharedReason ? `Prices unavailable · ${esc(sharedReason)}${p.text ? ` · ${p.text}` : ''}` : p.state === 'fresh' ? fresh
    : cell?.value == null ? (p.state === 'not reported' ? absent : `${missing}: ${esc(cellReason(cell?.reason ?? 'feed_not_received'))}.`)
      : capital(p.text);
  const indicator = sharedReason && p.state === 'fresh' ? statePhrase(positionProblems(cell).find(c => cellReason(c.reason) === sharedReason), '') : p;
  return `<p class="pstate" data-state="${p.state}">${st(indicator.tone, text + detail, indicator.icon)}</p>`;
}

const POSITION_FIELDS = { quantity: 'Quantity', mark: 'Last price', marketValue: 'Worth', dayPnl: 'Today’s result', openPnl: 'Open result' };
const presentNull = (row, field) => Object.hasOwn(row, field) && row[field] === null;
const rowReason = (row, field, cell) => cellReason(row.reasons?.[field] ?? cell?.reason ?? 'feed_not_received');
const missingPositionFields = row => Object.entries(POSITION_FIELDS).filter(([field]) =>
  presentNull(row, field) || (['mark', 'marketValue'].includes(field) && row[field] == null));
function positionProblems(cell) {
  return (cell?.value ?? []).flatMap(row => missingPositionFields(row).map(([field]) =>
    ({ state: 'broken', value: null, reason: row.reasons?.[field] ?? cell?.reason ?? 'feed_not_received' })));
}
export function positionSectionReason(cell) {
  return sharedSectionReason([cell, ...positionProblems(cell)]);
}
function positionValue(row, field, cell) {
  const value = row[field];
  if (value != null) return field === 'quantity' ? quantity(value) : money(decimalUnits(value.amount), value.currency);
  const label = `${POSITION_FIELDS[field]}: not reported · ${rowReason(row, field, cell)}`;
  return `<span class="position-value" role="img" title="${esc(label)}" aria-label="${esc(label)}">—</span>`;
}
function positionReasons(row, cell, sharedReason = null) {
  const missing = missingPositionFields(row).filter(([field]) => rowReason(row, field, cell) !== sharedReason);
  const reasons = missing.length ? `<span class="position-reasons">${missing.map(([field, label]) =>
    `${esc(label)}: ${esc(rowReason(row, field, cell))}`).join(' · ')}</span>` : '';
  // Today's result has no value column. Name a shared-reason null here,
  // while independent reasons keep their existing field list.
  const day = sharedReason && presentNull(row, 'dayPnl') && rowReason(row, 'dayPnl', cell) === sharedReason
    ? `<span class="position-day">Today’s result: ${positionValue(row, 'dayPnl', cell)}</span>` : '';
  return `<span class="position-notes"${reasons || day ? '' : ' aria-hidden="true"'}>${day}${reasons}</span>`;
}

export function positionsHtml(ctx) {
  const { states } = ctx;
  const cell = states.positions;
  const rows = cell?.value;
  const data = ctx.feeds.data?.value;
  const shared = positionSectionReason(cell);
  const header = `<div class="prow hd"><span></span><span class="sub">Holding</span><span class="sub c-side">${term('side')}</span><span class="sub r c-px">${term('lastprice')}</span><span class="sub c-worth">${term('worth')}</span><span class="sub r">${term('open', 'Open result')}</span><span class="sub r c-opened">Updated</span></div>`;
  const observed = data?.positions?.observedAt ?? data?.generatedAt;
  const state = sectionState(cell, 'pos', { fresh: `Up to date · prices from ${observed ? timeHMS(observed) : 'the last snapshot'}`, held: 'last good positions',
    missing: 'Position detail is unavailable', absent: 'Position detail is not present in this snapshot.', sharedReason: shared });
  if (!rows) return { sub: 'Desk positions only · each in its own currency', html: state };
  if (!rows.length) return { sub: '0 open · desk positions only · each in its own currency', html: `${state}<p class="empty-line">${icon('info')}<span>No open positions.</span></p>` };
  const unmapped = row => row.scope === 'stage0' && row.desk === null;
  const deskOrder = row => unmapped(row) ? DESKS.length : DESKS.indexOf(row.desk);
  const sorted = [...rows].sort((a, b) => deskOrder(a) - deskOrder(b) || a.symbol.localeCompare(b.symbol));
  const maxByCurrency = new Map();
  for (const r of sorted) {
    if (!r.marketValue) continue;
    const units = decimalUnits(r.marketValue.amount), abs = units < 0n ? -units : units, currency = r.marketValue.currency;
    if (abs > (maxByCurrency.get(currency) ?? 0n)) maxByCurrency.set(currency, abs);
  }
  const today = ctx.now ? localDay(ctx.now, NY) : null;
  const body = sorted.map(r => {
    const cur = r.mark?.currency ?? r.marketValue?.currency ?? 'USD';
    const value = r.marketValue ? decimalUnits(r.marketValue.amount) : null, max = maxByCurrency.get(r.marketValue?.currency) ?? 0n;
    // A bounded percent, rounded to three decimal places from exact money.
    const width = !outageValue(cell) && value != null && max > 0n ? unitsDecimal(divRound((value < 0n ? -value : value) * 100000n, max) * (UNIT / 1000n)) : null;
    const opened = r.openedAt ? ` · opened ${localDay(r.openedAt, NY) === today ? `today ${timeHM(r.openedAt)}` : dayDDM(r.openedAt)}` : '';
    const legacy = r.scope === 'legacy' ? ` · older holding, outside the ${term('stage0', 'first stage')}` : '';
    const deskLabel = unmapped(r) ? `No desk · ${cellReason(r.reasons.desk)}` : null;
    return `<div class="prow" data-desk="${esc(r.desk ?? '')}">
      ${symBadge(r.symbol, r.desk)}
      <div class="name"><b>${esc(r.symbol)}</b>${r.company ? ` · ${esc(r.company)}` : ''}<span${deskLabel ? ` title="${esc(deskLabel)}" aria-label="${esc(deskLabel)}"` : ''}>${deskLabel ? esc(deskLabel) : r.desk ? `${inlineMark(r.desk)} ${LABEL[r.desk]}` : 'No desk'}${opened}${legacy}</span><span class="position-mobile">${r.side === 'long' ? 'Long' : 'Short'} ${positionValue(r, 'quantity', cell)} · last price ${positionValue(r, 'mark', cell)} · worth ${positionValue(r, 'marketValue', cell)}</span>${positionReasons(r, cell, shared)}</div>
      <div class="side c-side">${icon(r.side)}${r.side === 'long' ? 'Long' : 'Short'} ${positionValue(r, 'quantity', cell)}</div>
      <div class="r c-px num">${positionValue(r, 'mark', cell)}</div>
      <div class="c-worth"><span class="num">${positionValue(r, 'marketValue', cell)}</span><span class="vbar"${value == null ? ' style="visibility:hidden"' : ''}>${width !== null ? `<i data-v="${esc(r.marketValue.amount)}" data-cur="${esc(r.marketValue.currency)}" style="width:${width}%"></i>` : ''}</span></div>
      <div class="r">${presentNull(r, 'openPnl') ? positionValue(r, 'openPnl', cell) : pl(r.openPnl ? decimalUnits(r.openPnl.amount) : null, r.openPnl?.currency ?? cur)}</div>
      <div class="r c-opened num">${r.updatedAt ? timeHM(r.updatedAt) : '—'}</div>
    </div>`;
  }).join('');
  const unmatched = rows.filter(unmapped).length;
  return { sub: `${rows.length} open · ${unmatched ? `${unmatched} not matched to a desk` : 'desk positions only'} · each in its own currency`, html: `${state}${header}${body}` };
}

// Kept holdings: the read-only caption, then the section's own state line with
// what they are worth (in the past tense of their age when not fresh).
export function keptHtml(ctx) {
  const { states } = ctx;
  const cell = states.kept;
  const rows = cell?.value;
  const shared = positionSectionReason(cell);
  const navUnits = exactCell(states.paperAccount), nav = navUnits === null ? '—' : eur(navUnits);
  const incomplete = rows?.filter(r => r.marketValue == null) ?? [];
  const worth = !outageValue(cell) && rows?.length ? sumByCurrency(rows.map(r => r.marketValue))?.map(s => money(s.units, s.currency)).join(' and ') : null;
  const worthReasons = [...new Set(incomplete.map(r => rowReason(r, 'marketValue', cell)))].filter(reason => reason !== shared);
  const unavailableWorth = `Worth not available${worthReasons.length ? ` · ${worthReasons.map(esc).join(' · ')}` : ''}`;
  const caption = `<p class="keep-cap">${icon('keep')}<span>Read-only. Left out of every desk result and of Results; counted in the ${term('paperacct', 'paper account')} (${nav}).</span></p>`;
  const p = statePhrase(cell, 'kept', 'last good values', shared);
  const fresh = incomplete.length ? unavailableWorth : worth ? `Worth ${worth} now, each in its own currency.` : 'Up to date.';
  const state = shared
    ? sectionState(cell, 'kept', { held: 'last good values', sharedReason: shared,
      detail: outageValue(cell) ? ' · worth —' : incomplete.length ? ' · worth not available' : worth ? ` · worth ${worth}, each in its own currency` : '' })
    : incomplete.length
    ? `<p class="pstate" data-state="${p.state}">${st(p.state === 'fresh' ? 'none' : p.tone, `${p.text ? `${capital(p.text)} · ` : ''}${unavailableWorth}`, p.icon)}</p>`
    : rows && (worth || outageValue(cell)) && p.state !== 'fresh'
    ? `<p class="pstate" data-state="${p.state}">${st(p.tone, `${capital(p.text)} · worth ${worth ? `${worth}, each in its own currency` : '—'}`, p.icon)}</p>`
    : sectionState(cell, 'kept', { fresh, held: 'last good values', missing: 'Kept holdings are unavailable', absent: 'Kept holdings are not present in this snapshot.' });
  if (!rows) return `${caption}${state}`;
  if (!rows.length) return `${caption}${state}<p class="empty-line">${icon('info')}<span>No kept holdings in this snapshot.</span></p>`;
  return `${caption}${state}${[...rows].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(r => {
    return `<div class="prow" data-keep="${esc(r.symbol)}">
      ${symBadge(r.symbol)}
      <div class="name"><b>${esc(r.symbol)}</b>${r.company ? ` · ${esc(r.company)}` : ''}<span class="position-summary">${r.side === 'long' ? 'Long' : 'Short'} ${positionValue(r, 'quantity', cell)} · last price ${positionValue(r, 'mark', cell)}</span><span class="position-mobile">Worth ${positionValue(r, 'marketValue', cell)}</span>${positionReasons(r, cell, shared)}</div>
      <div class="side c-side">${icon(r.side)}${r.side === 'long' ? 'Long' : 'Short'} ${positionValue(r, 'quantity', cell)}</div>
      <div class="r c-px num">${positionValue(r, 'mark', cell)}</div>
      <div class="c-worth num">${positionValue(r, 'marketValue', cell)}</div>
      <div class="r"><span class="kept-label">${icon('keep')}Kept · not traded by any desk</span></div>
    </div>`;
  }).join('')}`;
}

const chartKeys = new Map();
function chartOnce(el, key, draw) {
  if (!el || !el.clientWidth) return;
  if (chartKeys.get(el.id) === key && el.querySelector(':scope > svg')) return;
  chartKeys.set(el.id, key);
  draw();
}
export const forgetCharts = () => chartKeys.clear();

function drawHeroChart(ctx, history) {
  const el = $('#heroChart');
  if (!ctx.now) {
    chartOnce(el, JSON.stringify(['no-clock', el?.clientWidth, el?.clientHeight]), () => drawChart(el, { series: [], xDomain: [0, 1], empty: true, emptyText: 'Waiting for the board server’s clock', label: 'Today’s result: the board server’s time is not known yet' }));
    return;
  }
  const b = sessionBounds(ctx.now);
  const nowMs = Date.parse(ctx.now);
  const minuteKey = Math.floor(nowMs / 60000);
  const key = JSON.stringify([b.openAt, minuteKey, history?.seq, history?.receivedAt, el?.clientWidth, el?.clientHeight]);
  if (chartKeys.get(el?.id) === key && el?.querySelector(':scope > svg')) return;
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
  // With no closes to draw, the empty chart says what History's own state is.
  const hist = ctx.states.history;
  const emptyText = hist?.state === 'not reported' ? 'History has not arrived yet' : hist?.value == null && hist?.state === 'broken' ? 'History unavailable' : 'History fills as sessions pass';
  for (const id of DESKS) {
    const el = $(`#mini-${id}`);
    const pts = series[id];
    // The chart draws below the label or state lines, inside its fixed box.
    const top = Math.max(14, Math.ceil(el?.querySelector('.mini-label')?.offsetHeight ?? 0) + 2);
    chartOnce(el, JSON.stringify([pts, shared, el?.clientWidth, top, emptyText]), () => {
      drawChart(el, { series: [{ pts, color: `var(--desk-${id})` }], xDomain: [0, Math.max(1, pts.length - 1)], zero: true, include: shared, ticks: 2, noY: true,
        pad: { l: 2, r: 6, t: top, b: 4 }, empty: pts.length < 2 || top > (el?.clientHeight ?? 84) - 18, emptyText: top > (el?.clientHeight ?? 84) - 18 ? ' ' : emptyText,
        label: `${LABEL[id]}: result since start over the last ${pts.length} sessions` });
      // The plotted inputs, observed values only, for the browser checks.
      const svg = el?.querySelector(':scope > svg');
      if (svg) svg.dataset.values = pts.map(p => p.v).join(' ');
    });
  }
}

export function renderDesk(ctx) {
  const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
  patch($('#heroL'), heroLeft(ctx));
  patch($('#heroSession'), sessionRing(ctx.now));
  const data = ctx.feeds.data?.value;
  const working = data ? data.desks.filter(d => d.state === 'working').length : 0;
  $('#desksSub').textContent = data ? `${working} of 3 working · kept holdings left out` : 'Waiting for the first valid snapshot';
  const days = DESKS.map(id => exactCell(ctx.states[`desks.${id}.dayPnl`]) === null ? null : amountOf(ctx.states[`desks.${id}.dayPnl`].value));
  const showBars = days.every(v => v != null);
  const maxDay = Math.max(...days.filter(v => v != null).map(Math.abs), 0.01);
  let redraw = false;
  for (const id of DESKS) {
    const card = $(`#desk-${id}`);
    if (!card.querySelector('.desk-detail')) card.innerHTML = `<div class="compact-row"></div><div class="desk-detail disclosure-body" id="detail-${id}"></div>`;
    patch(card.querySelector('.compact-row'), compactDesk(ctx, id));
    const changed = patch(card.querySelector('.desk-detail'), deskCard(ctx, id, maxDay, showBars));
    if (changed) { chartKeys.delete(`mini-${id}`); redraw = true; }
  }
  patch($('#chartSummary'), problemHtml(disclosureProblem([
    ['History', ctx.states.history], ...(!ctx.now ? [['Clock', { state: 'not reported', value: null }]]
      : sessionBounds(ctx.now).reason === 'calendar_unavailable' ? [['Market hours', { state: 'broken', value: null, reason: 'calendar_unavailable' }]] : []),
  ])));
  $('#positionsTitle').textContent = `Positions · ${ctx.states.positions?.value?.length ?? '—'} open`;
  $('#keptTitle').textContent = `Kept holdings · ${ctx.states.kept?.value?.length ?? '—'}`;
  patch($('#positionsSummary'), problemHtml(disclosureProblem([['Positions', ctx.states.positions], ...rowProblems(ctx.states.positions)])));
  patch($('#keptSummary'), problemHtml(disclosureProblem([['Kept holdings', ctx.states.kept], ...rowProblems(ctx.states.kept)])));
  syncDeskDisclosures();
  const grid = $('.desk-grid');
  const currentOrder = [...grid.children].map(card => card.id.slice(5));
  for (const [index, id] of rankDesks(ctx.states, currentOrder).entries()) {
    const card = $(`#desk-${id}`);
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index]);
  }
  // Charts measure their boxes before the long sections below change, so an
  // update never forces a layout of the whole position list mid-render.
  const history = ctx.states.history?.value?.columns ? ctx.states.history.value : null;
  drawHeroChart(ctx, history);
  drawMiniCharts(ctx, history);
  const pos = positionsHtml(ctx);
  $('#posSub').textContent = pos.sub;
  patch($('#positions'), pos.html);
  patch($('#kept'), keptHtml(ctx));
  return { health, redraw };
}
