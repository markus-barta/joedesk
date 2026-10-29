// Desk: health line and details, Today, the three desks, positions and the
// kept holdings. Every number keeps its panel state; matching snapshot captions
// are shared once, while different ages and reasons stay beside their values.
import { $, icon, term, st, bn, pl, deskMark, inlineMark, symBadge, ageSpan, patch, statePhrase, stateCaption, reservedCaption, interactionWithin, NOT_EXACT, dashWords } from './ui.js';
import { esc, amountOf, money, eur, age, quantity, sumByCurrency, timeHM, timeHMS, dayDDM, dayDM, dateTimeFull, isZero, localDay, ledgerSize, digits, MINUS, NB } from './format.js';
import { boardHealthPresentation, boardDiagnostics, brokerState, dataAge, cellReason, capital, deskValuesNotExact, STALE_AFTER_S, STUCK_REASON, statusPresentation, executorPresentation } from './health.js';
import { sessionBounds, nextOpen, zonedInstant, nyDay, viennaDay, wall, NY, VIENNA, sessionLabel, sessionDayName, zoneGap, USUAL_GAP_HOURS } from './time.mjs';
import { gatewayCheckAgeMs } from './contracts/gateway.mjs';
import { termLabel } from './terms.js';
import { drawChart } from './chart.js';
import { intraday } from './history-model.js';
import { learningLine } from './events.js';
import { panelState } from './contracts/panel-state.mjs';
import { decimalUnits, divRound, unitsDecimal, UNIT } from './contracts/decimal.mjs';
import { STARTING_MONEY, sinceStarts, exactCell, todayPercent, todayBase, sincePercent, percentOf, rankDesks } from './performance.js';
import { NOT_EXACT_REASONS, notExactDash, waitingOnPrices, classifyDay, classifyDays, classifyCells, dayChannels, absentPnl, outageValue, withGenerationAge } from './board-state.js';
// Results' own view of the record (keep policy, money now, bookkeeping
// cuts). results.js imports percentHtml from here; both modules only call
// each other's functions at render time, so the cycle is safe.
import { resultsView } from './results.js';
import * as RM from './results-model.js';

const DESKS = ['j', 'joe', 'joel'];
const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
const TONE_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
// The Open figure's own label (JOED-153: "Open result"), which JOED-157's
// price-wait and fault wording key on wherever the figure is shown.
const OPEN = termLabel('open');
// "10 Sep" for a New York day; "Since 10 Sep", or "Since start" when the day is unknown.
const dayText = day => dayDM(zonedInstant(day, '12:00:00', NY), NY);
export const sinceLabel = day => day ? `Since ${dayText(day)}` : 'Since start';
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

// Shared hero and Account lines use the same not-exact words as the cards.
export function sharedSectionPhrase(cell) {
  return cell?.value == null && NOT_EXACT_REASONS.has(cell?.reason)
    ? `Numbers: ${statePhrase(cell, '').text}`
    : `Numbers unavailable · ${esc(cellReason(cell.reason))}`;
}

// Open's pending prices have their own word. Keep this scoped to Open so
// Today's fault vocabulary and last-good observation ages stay unchanged.
function figurePhrase(cell, key, label, held, sharedReason = null) {
  const p = statePhrase(cell, key, held, sharedReason);
  if (label === OPEN && waitingOnPrices(cell)) return { ...p, text: 'waiting on prices' };
  if (['Today', OPEN].includes(label) && cell?.state === 'broken' && cell.value != null && !cell.retained)
    return { ...p, text: `unavailable · ${p.text}` };
  return p;
}

// Rank the actual selector states, including retained values. A fresh panel
// may still contain partial rows; those reasons join the same summary ranking.
export function disclosureProblem(candidates) {
  const severity = { bad: 3, warn: 2, none: 1 };
  const problems = candidates.flatMap(([label, cell, caption]) => {
    // A figure's own marker (Results' Partial or Stale, the record's state, a
    // missing day's money), in its own words.
    if (cell?.mark) return [{ tone: cell.mark.tone, icon: cell.mark.icon, priority: cell.mark.priority ?? (cell.mark.tone === 'bad' ? 3 : severity[cell.mark.tone] ?? 2),
      why: null, reason: cell.mark.why, label: `${label}: ${cell.mark.state}` }];
    const p = figurePhrase(cell, '', label);
    if (p.state === 'fresh') return [];
    const state = label === OPEN && waitingOnPrices(cell) ? 'waiting on prices'
      : notExactDash(cell) ? NOT_EXACT : cell?.retained ? 'last good' : p.state === 'stale' ? 'stale'
      : p.state === 'not reported' ? 'not reported' : 'unavailable';
    const reason = cell?.reason ?? (p.state === 'not reported' ? 'feed_not_received' : null);
    // Unavailable money leads even when its honest not-exact icon is neutral;
    // an old check-in must not obscure that the row's figures are unknown.
    const priority = cell?.state === 'broken' || state === 'unavailable' ? 3 : severity[p.tone];
    const why = state === 'waiting on prices' ? null : reason ? cellReason(reason) : null;
    return [{ tone: p.tone, icon: p.icon ?? TONE_ICON[p.tone], priority, why, reason: caption || why === state ? null : why, label: `${label}: ${caption ? caption[0].toLowerCase() + caption.slice(1) : state}` }];
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
    expanded: sharedReason ? summarize(problems.filter(p => p.why !== sharedReason)) : null };
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

// Only a feed that sends check-ins can show one as missing; the v2 feed sends
// none, so its desks never warn about a check-in that does not exist.
export const carriesCheckIns = data => Boolean(data?.desks?.some(desk => desk.heartbeatAt != null));
// The paper pusher's own valuation sentences say nothing about what a desk is
// doing; the card's header says that from the desk's state instead (M5).
const PUSHER_STATUS = new Set(['Paper desk values are available.', 'Some paper desk values are unavailable.',
  'Valuation is not exact yet.', 'Valuation unavailable pending exact source validation.']);

// A phone row's warning: the desk's own figures, state and check-in (History
// no longer feeds a card, so its state is not a desk's problem). Before the
// open the row's first figure is the last session's from Results, so its
// marker or its fault is the problem instead of the Today cell's.
function deskProblem(ctx, id, facts = null) {
  const desk = ctx.feeds.data?.value?.desks.find(d => d.id === id);
  const first = facts?.label?.phase === 'last' ? lastSessionProblems(facts.view, facts.last[id]) : [['Today', ctx.states[`desks.${id}.dayPnl`]]];
  // The card shows Results' bars (and before the open its first figure) in
  // every phase, so the row names the Results feed's own state in every phase:
  // an old or kept record, or a failed read. A record that has simply not
  // arrived yet is the bars' own note in the session; before the open it is
  // the row's first figure, so the row says it then.
  const feed = facts?.view ? resultsFeedProblem(facts.view) : null;
  const sayFeed = feed && (facts.label?.phase === 'last' || feed.state !== 'not reported');
  const cells = [...first, [termLabel('open'), ctx.states[`desks.${id}.openPnl`]], [sinceLabel(sinceStarts(ctx.feeds).days[id]), ctx.states[`desks.${id}.totalPnl`]]];
  if (desk?.state === 'stuck') cells.unshift(['Desk stuck', { state: 'broken', value: null }]);
  if (desk?.learning?.status === 'blocked') cells.push(['Learning blocked', { state: 'broken', value: null }]);
  const elapsed = ctx.feeds.data?.generatedAdvancedAt ? Math.max(0, Date.parse(ctx.now) - Date.parse(ctx.feeds.data.generatedAdvancedAt)) : 0;
  const heartbeat = desk?.heartbeatAt ? gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, ctx.feeds.data.value.generatedAt, elapsed) : null;
  if (desk && carriesCheckIns(ctx.feeds.data.value) && (heartbeat == null || heartbeat / 1000 >= STALE_AFTER_S)) cells.unshift(['Check-in', { state: heartbeat == null ? 'not reported' : 'stale', value: heartbeat }]);
  if (sayFeed) cells.push(['Results', feed]);
  return disclosureProblem(cells);
}
// The last session's figure as row problems: the day's own Partial/Stale
// marker (beside an amount or an empty day's dash) and a day whose money is
// not known. The Results feed's own state is its own row problem (deskProblem).
// A dash that only states a fact (no trades, before the start, a basis change)
// adds nothing itself.
function lastSessionProblems(view, f) {
  const out = [];
  if (!f) return out;
  if ((f.units !== null || f.kind === 'empty') && f.warning) {
    out.push([termLabel('lastsession'), { mark: { state: f.warning.label.toLowerCase(), why: f.warning.text.replace(/^(Partial|Stale): /, ''), tone: 'warn', icon: 'half' } }]);
  }
  if (f.kind === 'money') out.push([termLabel('lastsession'), { mark: { state: 'unavailable', why: f.reason, tone: 'bad', icon: TONE_ICON.bad } }]);
  return out;
}
// The Results feed's own state as a row problem, or null while it is fresh
// and used: a record kept after a rejected read is "last good", an old one
// "stale", each with its age and reason; without a record, its reason.
export function resultsFeedProblem(view) {
  const cell = view.cell;
  if (view.ix) {
    if (!cell || cell.state === 'fresh') return null;
    const ago = cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`;
    // A refused refresh outranks a day's marker in the row's one visible line.
    return { mark: { state: cell.retained ? 'last good' : 'stale', why: cell.reason ? `${ago} · ${cellReason(cell.reason)}` : ago, tone: 'warn', icon: 'half', priority: cell.retained ? 3 : 2 } };
  }
  if (!cell || cell.state === 'not reported') return { state: 'not reported', value: null, reason: view.reason ?? 'feed_not_received' };
  return { state: 'broken', value: null, reason: view.reason ?? cell.reason ?? null };
}
// The phone's one-line desk row (JOED-79): the desk, what it is doing, its
// first figure for the session the hero names (labelled "Today" or by the
// session's weekday) and Since start; a tap opens the whole card.
export function compactDesk(ctx, id, facts = deskFacts(ctx)) {
  const desk = ctx.feeds.data?.value?.desks.find(d => d.id === id);
  const info = STATE[desk?.state] ?? { tone: 'none', icon: 'ring', word: 'Not reported' };
  const shared = sharedSectionReason(['dayPnl', 'openPnl', 'totalPnl'].map(name => ctx.states[`desks.${id}.${name}`]));
  // One start day for all desks sits once in the phone's Desks heading, read
  // before the rows; each row then says "Since" (a dash keeps the whole label).
  const starts = sinceStarts(ctx.feeds), since = sinceLabel(starts.days[id]);
  const first = deskFirst(ctx, facts, id);
  const figure = (name, label, shown = label) => {
    const cell = ctx.states[`desks.${id}.${name}`], value = cellView(cell, `compact.${id}.${name}`, { label });
    const marker = cellIcon(cell, shared, name === 'openPnl' ? OPEN : null).replace('cell-state', 'compact-state');
    const characters = value.units === null ? 1 : eur(value.units, true).length;
    return `<span class="compact-figure" data-compact-value="${name}" style="--digits:${characters}"><span class="compact-label">${shown}${marker}${name === 'dayPnl' ? dayEstimateMark(ctx, id) : ''}</span>${value.html}</span>`;
  };
  // Before the open: the last session's Results figure, with Results' marker
  // (its words are in the row's warning line, visible and in the name).
  const lastFigure = f => {
    const marks = lastMarks(facts.view, f);
    const name = f.units === null ? lastDashName(`${LABEL[id]} · ${first.label}`, f, marks) : `${LABEL[id]} · ${first.label}: ${eur(f.units, true)}${marksText(marks)}`;
    const html = f.units === null ? `<span class="bn muted" role="img" title="${esc(name)}" aria-label="${esc(name)}">—</span>` : bn(f.units);
    const marker = marks.length ? `<span class="compact-state tone-warn" role="img" aria-label="${esc(marks.map(m => m.label).join(', '))}">${icon('half')}</span>` : '';
    return `<span class="compact-figure" data-compact-value="dayPnl" style="--digits:${f.units === null ? 1 : eur(f.units, true).length}"><span class="compact-label">${first.short}${marker}</span>${html}</span>`;
  };
  const counts = positionCounts(ctx.states), held = facts.label?.phase === 'live' ? 'open' : 'held';
  const word = `${info.word}${counts?.[id] ? ` · ${counts[id]}${NB}${held}` : ''}`;
  return `<button type="button" class="desk-disclosure desk-row" data-desk-disclosure="${id}" aria-expanded="${expanded.has(id)}" aria-controls="detail-${id}">
    ${deskMark(id)}<span class="compact-identity"><strong>${esc(desk?.label ?? LABEL[id])}</strong><span class="compact-word tone-${info.tone}">${icon(info.icon)}${word}</span></span>
    ${first.last ? lastFigure(first.last) : figure('dayPnl', first.label, first.short)}${figure('totalPnl', since, starts.common ? 'Since' : since)}${icon('chev-d', 'i disclosure-chevron')}
    <span class="disclosure-warning">${problemHtml(deskProblem(ctx, id, facts))}</span></button>`;
}

// Accepted snapshots are immutable between reads. Format this snapshot-only
// explanation once, rather than redoing ledger arithmetic on Desk live ticks.
const executorProblems = new WeakMap();
export function executorProblem(data) {
  if (!data) return null;
  if (executorProblems.has(data)) return executorProblems.get(data);
  const executor = data.safety.executor;
  const problem = executor?.reason === 'ledger_size_limit' ? 'Trade record is full: new orders refused'
    : executor?.status === 'degraded' && executor.reason === 'results_capture_failed'
      ? `Paper executor degraded: ${executorPresentation(executor, data.safety.halt).reason.replace(' — ', ', ')}` : null;
  const ledger = problem ? ledgerSize(executor) : null;
  const sentence = problem ? `${problem}${ledger ? ` (${ledger.text})` : ''}.` : null;
  executorProblems.set(data, sentence);
  return sentence;
}

// Dashes are named by dashWords (ui.js), shared with Cash.
export { dashWords };

// One money cell: the value (or a dash) and a caption for exactly the state
// the shared selector gave it, with this cell's own age and reason. A fresh
// value keeps the designed caption.
export function cellView(cell, key, { signed = true, caption = '', sharedReason = null, label = null } = {}) {
  const value = cell?.value ?? null;
  const n = amountOf(value);
  const units = value ? decimalUnits(value.amount) : null;
  const priceWait = label === OPEN && waitingOnPrices(cell);
  const missingLabel = `${label}: ${priceWait ? 'waiting on prices' : dashWords(cell?.reason)}`;
  const html = value == null && label ? `<span class="bn muted" role="img" title="${esc(missingLabel)}" aria-label="${esc(missingLabel)}">—</span>` : bn(units, value?.currency ?? 'EUR', signed);
  return { html, caption: priceWait ? 'Waiting on prices' : stateCaption(cell, key, caption, undefined, sharedReason), state: cell?.state ?? 'not reported', n, units };
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
function cellIcon(cell, sharedReason = null, figureLabel = null) {
  if (!cell || cell.state === 'fresh') return '';
  const p = figurePhrase(cell, '', figureLabel);
  if (figureLabel === OPEN && waitingOnPrices(cell)) return `<span class="cell-state tone-${p.tone}" role="img" aria-label="Waiting on prices">${icon(p.icon)}</span>`;
  // A not-exact dash names itself (dashWords); its info icon only marks it, with
  // the same words as a pointer tip, so a screen reader hears the reason once.
  if (notExactDash(cell)) return `<span class="cell-state tone-${p.tone}" aria-hidden="true" title="${esc(capital(statePhrase(cell, '', undefined, sharedReason).text))}">${icon(p.icon)}</span>`;
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
    if (carriesCheckIns(data)) rows.push([term('heartbeat'), data.desks.map(desk => {
      const elapsed = feeds.data.generatedAdvancedAt ? Math.max(0, Date.parse(now) - Date.parse(feeds.data.generatedAdvancedAt)) : 0;
      const ms = gatewayCheckAgeMs({ checkedAt: desk.heartbeatAt }, data.generatedAt, elapsed);
      return `${esc(desk.label)}: ${ms == null ? 'not reported' : `${ageSpan(`pop.hb.${desk.id}`, `${age(ms / 1000)} ago`)}`}`;
    }).join(' · ')]);
    const days = classifyDays(states, data), ownDay = dayChannels(data, 'today');
    const ownDayReasons = [ownDay.moneyReason, ownDay.source?.reason].filter(Boolean);
    // A fault inherited from a desk changes the household caption, while the
    // existing per-desk row still explains its original not-exact total.
    const inheritedDayFault = DESKS.some(id => days[id].kind === 'fault') && ownDayReasons.length > 0 && ownDayReasons.every(reason => NOT_EXACT_REASONS.has(reason));
    rows.push(['Today’s result', esc(days.today.kind === 'notExact' || inheritedDayFault ? dayBreakdown(states, data)
      : dayMethodLabel(data.pnlSources?.day) ?? `Not available · ${cellReason(data.pnlSources?.day?.reason ?? states['today.dayPnl']?.reason ?? 'feed_not_received')}`)]);
    // Before the open Desk's first figure is the last session's, from Results.
    const label = now ? sessionLabel(now) : null;
    if (label?.phase === 'last') {
      const feed = feedMark(resultsView(ctx));
      rows.push(['Last session', esc(`${sessionDayName(label.day)} from Results · Day: closed trades plus still-open movement, after fees${feed ? ` · ${feed.text}` : ''}`)]);
    }
    rows.push(['Open positions', esc(Object.values(classifyCells(states, data, 'openPnl')).every(open => open.kind === 'exact')
      ? openMethodLabel(data.pnlSources?.open) ?? 'Each desk exact' : openBreakdown(states, data))]);
    rows.push(['Source', `${esc(data.source.label)} · paper only`]);
  }
  const notes = { since: startsDiffer(feeds) };
  return `<h3>${icon(TONE_ICON[health.statusTone])}Board status details</h3>
    <p class="status-sentence">${esc(statusPresentation(ctx, health).sentence)}</p>
    ${healthFacts(ctx, health)}
    <p>${problems.length ? esc(problems.join(' ')) : 'No current problems.'}</p>
    ${deskValuesNotExact(states) ? `<p>${st('none', 'Desk values are not exact', 'info')}</p>` : ''}
    ${notes.since ? `<p>${st('warn', esc(notes.since))}</p>` : ''}
    ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
    <p>If a light turns yellow or red: reload once. If it stays, tell Amy what the light says and how old the data is.</p>
    <p><button type="button" class="btn quiet link" data-go="history" data-anchor="j-accounting">${icon('book')}J’s bookkeeping${icon('chev-r')}</button></p>`;
}

export function headerHealth(ctx, health) {
  const status = statusPresentation(ctx, health);
  return { ...status, html: `${icon(health.tone === 'green' ? 'check' : TONE_ICON[health.statusTone], `i tone-${health.statusTone}`)}<span class="lbl"><b data-clamp="1" title="${esc(status.sentence)}"><span class="status-full">${esc(status.sentence)}</span><span class="status-compact">${esc(status.compact)}</span></b></span>${icon('chev-d', 'i status-chevron')}`,
    label: `${health.tone === 'green' ? 'Live. Numbers are up to date' : status.sentence}. Open status details.`, title: status.sentence };
}

// ---------- The New York market block (M3): a linear day bar ----------
// The Vienna day from 00 to 24: the New York day from its midnight (05 or 06),
// the regular session (early closes from the calendar), a "now" marker. Above
// it the market's state and the next session, below it New York's own time
// and how far behind Vienna it is this week. Times are Vienna times.
let gapMemo = null;
const gapOf = now => {
  const hour = Math.floor(Date.parse(now) / 3600000);
  if (gapMemo?.hour !== hour) gapMemo = { hour, gap: zoneGap(now) };
  return gapMemo.gap;
};
export function nyLine(now) {
  const gap = gapOf(now);
  return `New York ${timeHM(now, NY)} · ${gap.hours}${NB}h behind${gap.until ? ` until ${sessionDayName(gap.until)}` : ''}${gap.hours !== USUAL_GAP_HOURS ? ` (usually ${USUAL_GAP_HOURS}${NB}h)` : ''}`;
}
function dayBar(now) {
  const vday = viennaDay(now), start = Date.parse(zonedInstant(vday, '00:00:00', VIENNA)), end = Date.parse(zonedInstant(RM.addDays(vday, 1), '00:00:00', VIENNA));
  const at = ms => Math.max(0, Math.min(100, (ms - start) / (end - start) * 100)), P = ms => `${at(ms).toFixed(3)}%`;
  const t = Date.parse(now), nyStart = Date.parse(zonedInstant(vday, '00:00:00', NY));
  const s = sessionBounds(zonedInstant(vday, '12:00:00', NY));
  const hm = ms => timeHM(new Date(ms).toISOString());
  let block, ticks, session;
  if (s.openAt) {
    const o = Date.parse(s.openAt), c = Date.parse(s.closeAt), phase = t < o ? 'upcoming' : t < c ? 'live' : 'done';
    block = `<span class="db-sess ${phase}" style="left:${P(o)};width:${(at(c) - at(o)).toFixed(3)}%"></span>${phase === 'live' ? `<span class="db-fill" style="left:${P(o)};width:${(at(t) - at(o)).toFixed(3)}%"></span>` : ''}`;
    ticks = `<span style="left:${P(o)}">${hm(o)}</span><span style="left:${P(c)}">${hm(c)}</span>`;
    session = `, regular session ${hm(o)} to ${hm(c)}`;
  } else if (s.reason === 'calendar_unavailable') {
    block = '';
    ticks = '<span class="nyl" style="left:62%">session hours not known</span>';
    session = ', session hours not known';
  } else {
    // A day without a session keeps its usual place, outlined and empty.
    const o = Date.parse(zonedInstant(vday, '09:30:00', NY)), c = Date.parse(zonedInstant(vday, '16:00:00', NY));
    block = `<span class="db-sess none" style="left:${P(o)};width:${(at(c) - at(o)).toFixed(3)}%"></span>`;
    ticks = `<span class="nyl" style="left:${((at(o) + at(c)) / 2).toFixed(3)}%">no session today</span>`;
    session = ', no session today';
  }
  const nowAt = at(t), align = nowAt > 86 ? ' r' : nowAt < 8 ? ' l' : '';
  return `<div class="daybar" role="img" aria-label="${esc(`Vienna day from 00 to 24: the New York day begins at ${hm(nyStart)}${session}; now ${hm(t)}`)}">
      <span class="db-now-l${align}" style="left:${nowAt.toFixed(3)}%">now ${hm(t)}</span>
      <span class="db-track"><span class="db-ny" style="left:${P(nyStart)};right:0"></span>${block}</span><span class="db-now" style="left:${nowAt.toFixed(3)}%"></span>
      <span class="db-ticks"><span class="s" style="left:0">00</span><span style="left:${P(nyStart)}">${hm(nyStart).slice(0, 2)}</span><span class="s nyl" style="left:calc(${P(nyStart)} + 11px)">New York day</span>${ticks}<span class="e" style="left:100%">24</span></span></div>`;
}
const sessionSpan = openAt => {
  const { closeAt } = sessionBounds(openAt);
  return `${timeHM(openAt)}–${timeHM(closeAt)}`;
};
// The market block's words and the phone's one-line summary of them.
export function marketBlock(now) {
  const head = (state, rest = '') => `<div class="mkt-t"><span class="mkt-name">New York market</span>${state ? st(state === 'open' ? 'ok' : 'none', state, state === 'open' ? 'ok' : 'ring') : ''}${rest ? `<span class="rest">${rest}</span>` : ''}</div>`;
  if (!now) return { summary: 'Time not known', html: `${head('')}<div class="mkt-s">Time not known · waiting for the board server’s clock</div>` };
  const b = sessionBounds(now);
  if (b.reason === 'calendar_unavailable') return { summary: 'Market hours not known', html: `${head('')}<div class="mkt-s">Market hours not known · the market calendar does not cover this date</div>${dayBarless(now)}` };
  const t = Date.parse(now), next = nextOpen(now), vday = viennaDay(now);
  const nextDay = next && viennaDay(next) === vday ? 'today' : next ? sessionDayName(viennaDay(next)) : null;
  const nextIn = next ? age((Date.parse(next) - t) / 1000) : null;
  let html, summary;
  if (b.rth) {
    const left = age(Math.max(60, (Date.parse(b.closeAt) - t) / 1000)), early = b.close !== '16:00:00';
    html = `${head('open', `closes ${timeHM(b.closeAt)} · ${left} left`)}<div class="mkt-s">${early ? `Early close today · ${term('session', 'session')}` : term('session', 'Regular session')} <b>${timeHM(b.openAt)}–${timeHM(b.closeAt)}</b> Vienna</div>`;
    summary = `Open · closes ${timeHM(b.closeAt)} · ${left} left`;
  } else {
    const after = b.closeAt && t >= Date.parse(b.closeAt), none = !b.openAt;
    const weekend = none && [0, 6].includes(new Date(`${b.day}T12:00:00.000Z`).getUTCDay());
    const rest = after ? `since ${timeHM(b.closeAt)}` : none ? `for the ${weekend ? 'weekend' : 'holiday'}` : '';
    const sub = !next ? `Next ${term('session', 'session')} not known` : nextDay === 'today'
      ? `Next ${term('session', 'session')} today <b>${sessionSpan(next)}</b> · opens in <b>${nextIn}</b>` : `Next ${term('session', 'session')} <b>${nextDay}, ${sessionSpan(next)}</b> Vienna`;
    html = `${head('closed', rest)}<div class="mkt-s">${sub}</div>`;
    summary = !next ? 'Closed' : nextDay === 'today' ? `Closed · opens ${timeHM(next)} · in ${nextIn}`
      : `${after ? `Closed at ${timeHM(b.closeAt)}` : none ? `Closed for the ${weekend ? 'weekend' : 'holiday'}` : 'Closed'} · next ${nextDay}, ${timeHM(next)}`;
  }
  return { summary, html: `${html}${dayBar(now)}<div class="mkt-ny">${nyLine(now)}</div>` };
}
// Without the calendar there is no session to place; New York's time still is.
const dayBarless = now => `<div class="mkt-ny">${nyLine(now)}</div>`;

const byDesk = (a, b) => DESKS.indexOf(a) - DESKS.indexOf(b);
export const deskNames = ids => ids.length > 1 ? `${ids.slice(0, -1).map(id => LABEL[id]).join(', ')} and ${LABEL[ids.at(-1)]}` : LABEL[ids[0]];
// Each desk's own Today in plain words, grouped by word and reason in desk
// order, from the one classifier the light uses (classifyDays, every channel):
// exact or estimated figures, not-exact dashes, and faults named by their
// cell's state. Nothing is computed from money.
export function deskDays(states, data, field = 'dayPnl') {
  const days = classifyCells(states, data, field), groups = [];
  for (const id of DESKS) {
    const cell = states[`desks.${id}.${field}`], day = days[id];
    const priceWait = field === 'openPnl' && day.kind === 'notExact' && day.reason === 'open_pnl_unavailable';
    const word = priceWait ? cell?.retained ? 'last good' : 'waiting on prices'
      : day.kind === 'exact' ? day.estimated ? 'estimated' : 'exact' : day.kind === 'notExact' ? NOT_EXACT
      : cell?.retained ? 'last good' : cell?.state === 'stale' ? 'stale'
        : cell?.value == null && (cell?.state ?? 'not reported') === 'not reported' ? 'not reported' : 'unavailable';
    const why = word === 'waiting on prices' ? null : day.reason ? cellReason(day.reason) : null;
    const reason = why !== word ? why : null;
    const group = groups.find(g => g.word === word && g.reason === reason);
    if (group) group.ids.push(id); else groups.push({ word, reason, ids: [id] });
  }
  return groups;
}
// Details: every desk's Today, exact ones first, e.g. "Exact for Joel; not
// exact for J and Joe · start-of-day value missing". This one row is also
// how Details explains a green light beside a not-exact Today (Amy's A3).
// A household withheld as not exact while every desk is exact says so itself:
// "Household not exact · <reason>; each desk exact".
const DAY_ORDER = ['exact', 'estimated', NOT_EXACT, 'waiting on prices'];
const dayRank = g => DAY_ORDER.includes(g.word) ? DAY_ORDER.indexOf(g.word) : DAY_ORDER.length;
export function dayBreakdown(states, data) {
  const groups = deskDays(states, data).sort((a, b) => dayRank(a) - dayRank(b) || byDesk(a.ids[0], b.ids[0]));
  const today = classifyDays(states, data).today;
  if (today.kind === 'notExact' && groups.every(g => ['exact', 'estimated'].includes(g.word))) {
    const why = cellReason(today.reason);
    const desks = groups.length === 1 && groups[0].word === 'exact' ? 'each desk exact' : groups.map(g => `${g.word} for ${deskNames(g.ids)}`).join('; ');
    return `Household not exact${why !== NOT_EXACT ? ` · ${why}` : ''}; ${desks}`;
  }
  return capital(groups.map(g => `${g.word} for ${deskNames(g.ids)}${g.reason ? ` · ${g.reason}` : ''}`).join('; '));
}

// Open uses the same classification as the light. A household-only gap must
// explain itself even when each desk is exact. Keep household faults beside
// the desk breakdown too, so a desk gap never drops the household's fault.
function openBreakdown(states, data) {
  const groups = deskDays(states, data, 'openPnl').sort((a, b) => dayRank(a) - dayRank(b) || byDesk(a.ids[0], b.ids[0]));
  const household = classifyCells(states, data, 'openPnl').today;
  const eachExact = groups.every(g => g.word === 'exact');
  if (household.kind === 'fault' || (household.kind === 'notExact' && eachExact)) {
    const word = household.kind === 'notExact' ? household.reason === 'open_pnl_unavailable' ? 'waiting on prices' : NOT_EXACT : 'unavailable';
    const why = word === 'waiting on prices' ? null : household.reason ? cellReason(household.reason) : null;
    const desks = eachExact ? 'each desk exact' : groups.map(g => `${deskNames(g.ids)}: ${g.word}${g.reason ? ` · ${g.reason}` : ''}`).join('; ');
    return `Household ${word}${why && why !== word ? ` · ${why}` : ''}; ${desks}`;
  }
  return groups.map(g => `${deskNames(g.ids)}: ${g.word}${g.reason ? ` · ${g.reason}` : ''}`).join('; ');
}

// Details flags a closed-trade record that starts on another day than a
// desk's effective Since start, naming the days each desk actually counts
// from, and which desks Desk then shows without a date until they agree.
export function startsDiffer(feeds) {
  const starts = sinceStarts(feeds);
  if (!starts.conflict) return null;
  const groups = [];
  for (const id of DESKS) {
    const group = groups.find(g => g.day === starts.effective[id]);
    if (group) group.ids.push(id); else groups.push({ day: starts.effective[id], ids: [id] });
  }
  const counts = groups.map((g, i) => `${deskNames(g.ids)}${i ? '' : g.ids.length > 1 ? ' count' : ' counts'} from ${dayText(g.day)}`).join(', ');
  const undated = DESKS.filter(id => starts.days[id] === null);
  const shown = undated.length ? ` Desk shows no date${undated.length === DESKS.length ? '' : ` for ${deskNames(undated)}`} until they agree.` : '';
  return `Since start dates differ: Results start on ${dayText(starts.trackingStart)}; ${counts}.${shown}`;
}

// Household results need all three desks. Inherited faults name the faulty
// desks first, with their reasons, then any not-exact desks. The household is
// unavailable even if a faulty desk still shows its last good observation;
// its caption names that desk's own word, as do Details and the cards.
// For a not-exact Today, preserve the existing shared-reason presentation.
function householdPnlReason(states, data, field, sharedReason = null) {
  if (absentPnl(states, data, field)) return null;
  const results = classifyCells(states, data, field);
  const faulty = DESKS.filter(id => results[id].kind === 'fault');
  if (results.today.kind === 'fault' && faulty.length) {
    const cell = states[`today.${field}`], reason = results.today.reason;
    // Keep a figure's own fault, shared outage wording and retained ages.
    // Desk attribution explains only a household dash inherited from desks.
    if (cell?.value != null || outageValue(cell) || NOT_EXACT_REASONS.has(cell?.reason)
      || (reason && cellReason(reason) === sharedReason && states.gateway?.reason && cellReason(states.gateway.reason) === sharedReason)
      || (reason !== 'source_unavailable' && !faulty.some(id => results[id].reason === reason))) return null;
    const groups = deskDays(states, data, field).filter(g => !['exact', 'estimated'].includes(g.word));
    const isFault = g => g.ids.some(id => results[id].kind === 'fault');
    groups.sort((a, b) => Number(isFault(b)) - Number(isFault(a)) || byDesk(a.ids[0], b.ids[0]));
    return capital(groups.map(g => `${g.word} for ${deskNames(g.ids)}${isFault(g) && g.reason && g.reason !== sharedReason ? ` · ${g.reason}` : ''}`).join('; '));
  }
  if (results.today.kind !== 'notExact') return null;
  // Keep the producer's own price-wait caption through transport-aged desks.
  // A real desk fault has already replaced that household reason above.
  if (field === 'openPnl' && results.today.reason === 'open_pnl_unavailable') return null;
  const blocking = deskDays(states, data, field).filter(g => !['exact', 'estimated'].includes(g.word));
  if (!blocking.length) return null;
  if (blocking.length === 1) {
    const [{ word, reason, ids }] = blocking, all = ids.length === DESKS.length;
    if (all && (reason ?? word) === sharedReason) return '';
    return capital(`${word}${all ? '' : ` for ${deskNames(ids)}`}${reason && reason !== sharedReason ? ` · ${reason}` : ''}`);
  }
  // Several states: name the desks per state; each card keeps its own reason.
  const words = [];
  for (const g of blocking) {
    const same = words.find(w => w.word === g.word);
    if (same) same.ids.push(...g.ids); else words.push({ word: g.word, ids: [...g.ids] });
  }
  return capital(words.map(w => `${w.word} for ${deskNames(w.ids.sort(byDesk))}`).join('; '));
}
export const householdDayReason = (states, data, sharedReason = null) => householdPnlReason(states, data, 'dayPnl', sharedReason);

// ---------- The session Desk names (M1) and Results' Day figures (A2, M4) ----------
// Desk's links into Results and History (M6). Results reads period, date (a
// Vienna date, which is also the session's New York date) and desk.
export const resultsHref = (period, date, desk = 'all') => `#results?period=${period}${date ? `&date=${date}` : ''}&desk=${desk}`;
export const MONEY_HISTORY_HREF = '#history?range=week&mode=money';

// The regular sessions up to and including a New York day, oldest first: at
// most `count`, none before `from` (Results' tracking start) and none past a
// day the pinned calendar does not cover.
export function sessionDays(day, count, from = null) {
  const days = [];
  for (let d = day, steps = 0; days.length < count && steps < 4 * count + 12; steps++, d = RM.addDays(d, -1)) {
    if (from && d < from) break;
    const s = sessionBounds(zonedInstant(d, '12:00:00', NY));
    if (s.reason === 'calendar_unavailable') break;
    if (s.openAt) days.unshift(d);
  }
  return days;
}

// Results' Partial/Stale marker for one date, in Results' own words and order
// (results.js dayWarning: a missing daily summary first, then partial coverage).
export function sessionWarning(view, k, desks) {
  if (!view.ix || k >= view.today) return null;
  if (view.ix.missingDays?.has(k) && RM.dayResult(view.ix, k, desks).count > 0) return { label: 'Stale', text: `Stale: daily summary missing for ${RM.fmtDay(k)}` };
  if (view.ix.partialDays?.has(k)) {
    const reason = RM.partialReasonLabel(view.ix.partialDetails?.get(k));
    return k <= RM.addDays(view.today, -2)
      ? { label: 'Stale', text: `Stale: still incomplete; ${reason}` }
      : { label: 'Partial', text: `Partial: this day's record is incomplete. ${reason}` };
  }
  return null;
}

// One date's Results · Day figure for a set of desks, computed exactly as
// Results computes it: the desks' money at that date's close against the
// close before, so closed trades plus still-open movement, after fees. Only
// all three desks have a percentage, on Results' base for the day. Without a
// figure there is one plain reason instead, never a number; `kind` says which
// (feed, start, cut, empty or money), so a row can tell a fault from a fact.
export function resultsDay(view, k, desks) {
  const warning = sessionWarning(view, k, desks);
  if (!view.ix) return { units: null, kind: 'feed', reason: `Results unavailable · ${cellReason(view.reason ?? 'feed_not_received')}`, warning };
  if (view.trackingStart && k < view.trackingStart) return { units: null, kind: 'start', reason: `paper results start on ${RM.fmtDay(view.trackingStart)}`, warning };
  const per = RM.periodOf('day', k, view.today, view.trackingStart);
  const day = RM.rollup(view.ix, per, desks, RM.moneyContext(view.ix, view, per, desks));
  if (day.cut) return { units: null, kind: 'cut', reason: `${deskNames(day.cut.desks)}’s bookkeeping basis changed on ${RM.fmtDDM(RM.viennaDate(day.cut.at))}`, warning };
  // No trade and no change in the record is no evidence of a result: Results'
  // Day hero shows a dash for it ("No trades …"), so Desk never shows € 0 or
  // 0 % for it either.
  if (day.empty) return { units: null, kind: 'empty', reason: 'no trades recorded', warning };
  if (day.units.net === null) return { units: null, kind: 'money', reason: `the desks’ money on ${RM.fmtDDM(k)} is not known`, warning };
  const base = desks.length === DESKS.length ? RM.periodBase(view.ix, view, per, desks) : null;
  return { units: day.units.net, closed: day.units.realised, open: day.units.unreal, trades: day.trades, base, percent: percentOf(day.units.net, base), warning };
}

// Each desk's closed trades in the whole record (null without a record).
const tradeCounts = new WeakMap();
function closedTrades(ix) {
  if (!ix) return null;
  if (!tradeCounts.has(ix)) {
    const counts = [0, 0, 0];
    for (let c = 0; c < ix.agg.count.length; c++) counts[c % 3] += ix.agg.count[c];
    tradeCounts.set(ix, Object.fromEntries(DESKS.map((id, i) => [id, counts[i]])));
  }
  return tradeCounts.get(ix);
}

// One render's session facts: the label, Results' view and, from the record,
// the last session's figures (until the open) and every desk's last ten
// sessions. Recomputed only when the record, History, a bookkeeping cut or the
// session changes; Today's own figures are read from the states on every
// render. A cut at "now" lies after every past day, so it never changes them.
// The last few distinct inputs' facts: the page shows one board at a time,
// and a check that alternates two (with and without a record) stays cheap.
const factsMemos = [];
export function deskFacts(ctx) {
  const now = ctx.now ?? null, label = now ? sessionLabel(now) : null;
  const view = resultsView(ctx);
  const cuts = JSON.stringify(view.cuts.filter(c => !c.now).map(c => [c.desk, c.from, c.at]));
  const starts = sinceStarts(ctx.feeds).effective;
  const key = [view.ix, view.cols, view.reason, view.today, view.trackingStart, label?.phase, label?.day, cuts, JSON.stringify(starts)];
  let memo = factsMemos.find(m => m.key.every((v, i) => v === key[i]));
  if (!memo) {
    const ts = view.trackingStart, trades = closedTrades(view.ix);
    const last = label?.phase === 'last'
      ? Object.fromEntries([['all', DESKS], ...DESKS.map(id => [id, [id]])].map(([k, ids]) => [k, resultsDay(view, label.day, ids)])) : null;
    const days = !label ? [] : label.phase === 'last' ? sessionDays(label.day, 10, ts) : [...sessionDays(RM.addDays(label.day, -1), 9, ts), label.day];
    const bars = Object.fromEntries(DESKS.map(id => [id, days.map(k => label.phase !== 'last' && k === label.day
      ? { day: k, today: true } : { day: k, ...resultsDay(view, k, [id]) })]));
    const quiet = Object.fromEntries(DESKS.map(id => [id, recordedQuiet(view, starts[id], id, trades)]));
    memo = { key, value: { last, days, bars, trades, quiet } };
    factsMemos.unshift(memo);
    if (factsMemos.length > 4) factsMemos.pop();
  }
  return { ...memo.value, label, view, now };
}

// The fresh positions panel's open desk positions, all desks and per desk: the
// rows the desks' Open result counts (a row matched to no desk is not one).
// Null when the panel is not fresh: no count is shown then, never an old one.
export function positionCounts(states) {
  const cell = states.positions;
  if (cell?.state !== 'fresh' || outageValue(cell)) return null;
  const rows = (openPositionRows(cell) ?? []).filter(row => DESKS.includes(row.desk));
  return Object.fromEntries([['all', rows.length], ...DESKS.map(id => [id, rows.filter(row => row.desk === id).length])]);
}
// How positions are held from the session Desk names to the next open:
// overnight, over a weekend, or over a weekday holiday. Nothing while live.
export function heldWord(now, label) {
  if (!now || !label || label.phase === 'live') return '';
  const next = nextOpen(now);
  if (!next) return '';
  let weekend = false, holiday = false;
  for (let d = RM.addDays(label.day, 1); d < nyDay(next); d = RM.addDays(d, 1)) { if (RM.isWeekend(d)) weekend = true; else holiday = true; }
  return weekend ? 'over the weekend' : holiday ? 'over the holiday' : 'overnight';
}
export const positionsText = (count, held = '') => count == null ? '' : count === 0 ? 'no positions'
  : `${count}${NB}position${count === 1 ? '' : 's'}${held ? ` held ${held}` : ''}`;

// A signed amount in its sign's colour; the sign never parts from it.
const signedMoney = units => `<span class="num${isZero(units) ? '' : units > 0n ? ' gain' : ' loss'}">${eur(units, true)}</span>`;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = day => WEEKDAY[new Date(`${day}T12:00:00.000Z`).getUTCDay()];

// The hero's sentence (P1-2): each desk's own figure for the session the hero
// names, in sign colours, then what those figures alone do not say. In the
// session and after the close only desks whose Today is exact through the one
// classifier get a number; the others are named by the figure's caption and
// their cards, so the hero states a not-exact reason once (JOED-148). Without
// any exact desk the sentence says so, as before. Before the open the figures
// are Results' Day figures, and a not-exact Today is said once here, with its
// reason and without a timing promise (A5). Null without a snapshot.
export function heroSentence(ctx, facts = deskFacts(ctx)) {
  const { states } = ctx, data = ctx.feeds.data?.value, label = facts.label;
  if (!data) return null;
  const days = classifyDays(states, data), counts = positionCounts(states), held = heldWord(ctx.now, label);
  const amount = (id, units, estimated = false) => `${LABEL[id]} ${isZero(units) ? 'flat' : signedMoney(units)}${estimated ? ' estimated' : ''}`;
  const extra = [];
  if (held && counts?.all) extra.push(positionsText(counts.all, held));
  if (label?.phase === 'last') {
    const shown = DESKS.filter(id => facts.last[id].units !== null);
    // A desk the record shows without a trade or a change is said as the
    // record says it, "no trades recorded" with the day's own coverage marker
    // (a capture gap can hide trades), never as € 0 or "no trades"; a desk
    // without a figure for another reason is not known.
    const quiet = DESKS.filter(id => facts.last[id].kind === 'empty');
    const qualified = f => (f.warning ? ` (${f.warning.label})` : '');
    // Its figures come from the record: an old or kept record says so here
    // too, as beside the figure, so the sentence (and its tip) never stands
    // without it.
    const feed = feedMark(facts.view), source = feed ? [esc(feed.short)] : [];
    if (days.today.kind === 'notExact') extra.push(`Today: ${householdDayReason(states, data)?.replace(/^Not exact/, NOT_EXACT) || NOT_EXACT}`);
    if (shown.length || (quiet.length && quiet.length < DESKS.length)) {
      const missing = DESKS.filter(id => !shown.includes(id) && !quiet.includes(id));
      return `${weekdayOf(label.day)}: ${[...DESKS.flatMap(id => shown.includes(id) ? [amount(id, facts.last[id].units)] : quiet.includes(id) ? [`${LABEL[id]} no trades recorded${qualified(facts.last[id])}`] : []),
        ...(missing.length ? [`${deskNames(missing)} not known`] : []), ...source, ...extra].join(' · ')}`;
    }
    const tail = [...source, ...extra];
    if (quiet.length) return `No trades recorded on ${weekdayOf(label.day)}${qualified(facts.last.all)}${tail.length ? ` · ${tail.join(' · ')}` : '.'}`;
    // No desk has a figure for that day: the figure's caption says why once.
    return extra.length ? capital(tail.join(' · ')) : `No result for ${weekdayOf(label.day)} from the trade record${source.length ? ` · ${source[0]}` : ''}.`;
  }
  const shown = DESKS.flatMap(id => {
    const units = days[id].kind === 'exact' ? exactCell(states[`desks.${id}.dayPnl`]) : null;
    return units === null ? [] : [amount(id, units, days[id].estimated)];
  });
  if (!shown.length) return null;
  const open = days.today.kind === 'exact' ? null : exactCell(states['today.openPnl']);
  return [...shown, ...(open !== null ? [`open result ${signedMoney(open)}`] : []), ...extra].join(' · ');
}

// A percentage's base as its own term: the visible amount, the rule in the tip.
const basisTerm = (key, units) => `<button type="button" class="term basis" data-term="${key}">of ${eur(units)}</button>`;
// Results' marker beside a figure from the record: a short visible label, the
// whole sentence for screen readers and as the pointer title.
const markHtml = mark => mark ? ` <span class="st warn" title="${esc(mark.text)}">${icon('half')}<span>${esc(mark.label)}</span></span><span class="vh">: ${esc(mark.text)}</span>` : '';

// The hero's and a card's figure links (M6): the amount stays the link's text.
const figureLink = (html, href, name) => `<a class="fig-link" href="${esc(href)}" aria-label="${esc(name)}">${html}</a>`;
const plainText = html => html.replace(/<[^>]+>/g, '');
// Results' record state, when it is not fresh, beside a figure taken from it.
export const recordState = view => view.cell && view.ix && view.cell.state !== 'fresh'
  ? capital(plainText(statePhrase(view.cell, 'desk.results', 'last good results').text).replace(/^as of/, 'Results as of')) : null;
// The Results feed's own state beside anything Desk takes from the record
// (Last session, the last sessions' bars, the one-row claim), in every phase:
// "Last good" after a rejected read, "Results stale" for an old record, each
// with its age and reason. Null while the record is fresh, and without a
// record, where Desk says Results is unavailable instead of showing data.
export function feedMark(view) {
  const text = recordState(view);
  if (!text) return null;
  const cell = view.cell, ago = cell.ageSeconds == null ? 'age unknown' : `${age(cell.ageSeconds)} ago`;
  // `short`: the state and its age, for a sentence that already names the day.
  return { label: cell.retained ? 'Last good' : 'Results stale', text, short: cell.retained ? `Results last good, ${ago}` : `Results as of ${ago}` };
}
// A last-session figure's markers: the day's own Partial/Stale (beside an
// amount, and beside an empty day's dash, whose "no trades recorded" a
// capture gap could hide trades in) and the feed's state. Both are said;
// neither hides the other.
const lastMarks = (view, f) => [f.units !== null || f.kind === 'empty' ? f.warning : null, f.kind === 'feed' ? null : feedMark(view)].filter(Boolean);
const marksHtml = marks => marks.map(markHtml).join('');
const marksText = marks => marks.map(m => ` · ${m.text}`).join('');
// A dash's own name: its reason, then its markers' words, so a screen reader
// hears the qualifications too.
const lastDashName = (prefix, f, marks) => `${prefix}: ${f.reason}${marksText(marks)}`;

// The hero's first figure (M1, A2, P0-1): Today's cell in the session and after
// the close, read exactly as before; from New York midnight until the open,
// and on days without a session, the last session's Results · Day figure.
function heroFirst(ctx, facts, shared, board) {
  const { states } = ctx, data = ctx.feeds.data?.value, label = facts.label, today = facts.view.today;
  if (label?.phase === 'last') {
    const f = facts.last.all, marks = lastMarks(facts.view, f);
    const name = f.units === null ? lastDashName(label.text, f, marks) : `${label.text}: ${eur(f.units, true)}${marksText(marks)}`;
    const value = f.units === null ? `<span class="bn muted" role="img" title="${esc(name)}" aria-label="${esc(name)}">—</span>`
      : figureLink(bn(f.units), resultsHref('day', label.day, 'all'), `${name}. Opens Results for that day.`);
    const pct = f.units === null ? '' : `${percentHtml(f.percent)}${f.percent !== null && f.base !== null ? ` ${basisTerm('result', f.base)}` : ''}`;
    const split = `closed ${signedMoney(f.closed)} · still open ${signedMoney(f.open)}`;
    const caption = f.units === null ? `${esc(capital(f.reason))}${marksHtml(marks)}`
      : `<span class="cap-long">${split} · after fees · from the trade record</span><span class="cap-short">${split}</span>${marksHtml(marks)}`;
    return { caption, html: `<div class="primary" data-cell="hero.day" data-phase="last" data-state="${f.units === null ? 'broken' : marks.length ? 'stale' : 'fresh'}"><div class="hero-k">${icon('clock')}${term('lastsession', label.text)}</div>
        <div class="display">${value}</div><div class="pct-slot">${pct}</div><span class="c primary-caption">${caption}</span></div>` };
  }
  const dayCell = states['today.dayPnl'], source = data?.pnlSources?.day;
  const day = cellView(dayCell, 'hero.day', { sharedReason: shared, label: 'Today' });
  const why = dayCell?.reason ? cellReason(dayCell.reason) : null, onBoard = sharesBoardCaption(dayCell, board);
  // A dashed Today states its reason once, here, unless the section says it.
  // A not-exact household Today names the desks that keep it from being exact.
  const household = onBoard ? null : householdDayReason(states, data, shared);
  const estimated = day.units !== null && source?.status === 'available' && source.method === 'session-open-estimate' ? dayMethodLabel(source) : null;
  const designed = estimated ? `${estimated} · after fees` : label?.phase === 'closed'
    ? 'after fees · after-hours prices and the exchange rate still move it' : 'since New York midnight · after fees';
  const caption = day.units !== null ? onBoard ? designed : stateCaption(dayCell, 'hero.day', designed, undefined, shared)
    : household ?? (day.state === 'broken' && !onBoard && (!shared || why !== shared) ? day.caption : '');
  const text = label?.text ?? 'Today', base = todayBase(states, source);
  const value = day.units === null ? day.html : figureLink(day.html, resultsHref('day', label?.day ?? today, 'all'), `${text}: ${eur(day.units, true)}. Opens Results for that day.`);
  const percent = todayPercent(states, source);
  const pct = `${percentHtml(percent)}${percent !== null && base !== null ? ` ${basisTerm('today', base)}` : ''}`;
  const k = label?.phase === 'live' ? '<span class="live-dot" aria-hidden="true"></span>' : icon('clock');
  return { caption, html: `<div class="primary" data-cell="hero.day" data-phase="${label?.phase ?? 'today'}" data-state="${day.state}"><div class="hero-k">${k}${term(label?.phase === 'closed' ? 'closedday' : 'today', text)}${cellIcon(dayCell, shared)}</div>
        <div class="display">${value}</div><div class="pct-slot">${pct}</div>
        <span class="c primary-caption">${caption}</span></div>` };
}

const SINCE_CAPTION = 'after fees, incl. open positions';
export function heroLeft(ctx, facts = deskFacts(ctx)) {
  const { states, feeds } = ctx;
  const data = feeds.data?.value;
  const dayCell = states['today.dayPnl'];
  const board = boardCaptionCell(ctx);
  const shared = data ? sharedSectionReason(['today.dayPnl', 'today.totalPnl', 'today.openPnl', 'today.equity'].map(name => states[name])) : null;
  // JOED-157: a household Open withheld because of desks names them, fault first.
  const openFault = householdPnlReason(states, data, 'openPnl', shared);
  const kpi = (termKey, label, name, key, opts) => {
    const v = cellView(states[name], key, { ...opts, sharedReason: shared, label: label ?? { open: OPEN, desksmoney: 'Desks’ money' }[termKey] });
    const caption = reservedCaption(sharesBoardCaption(states[name], board) ? '' : name === 'today.openPnl' && openFault != null ? esc(openFault) : v.caption, opts.captions ?? [opts.caption]);
    const value = opts.href && v.units !== null ? figureLink(v.html, opts.href, `${label ?? termLabel(termKey)}: ${eur(v.units, opts.signed !== false)}. ${opts.goes}`) : v.html;
    return `<div class="kpi" data-cell="${key}" data-state="${v.state}"><dt>${term(termKey, label ?? undefined)}${cellIcon(states[name], shared, name === 'today.openPnl' ? OPEN : null)}</dt><dd>${value}<span class="c">${caption}</span></dd></div>`;
  };
  const jIncomplete = data && (states['desks.j.equity']?.value == null || states['desks.j.totalPnl']?.value == null);
  // Since start counts from one known day for all desks, or the hero names none.
  const starts = sinceStarts(feeds), sinceText = sinceLabel(starts.common);
  const started = `started with ${eur(STARTING_MONEY, false, 0)}`;
  const moneyCaptions = [starts.common ? `${started} on ${dayText(starts.common)}` : started, 'J’s bookkeeping incomplete · desk total unavailable', started];
  const first = heroFirst(ctx, facts, shared, board);
  const day = cellView(dayCell, 'hero.day', { sharedReason: shared, label: 'Today' }), why = dayCell?.reason ? cellReason(dayCell.reason) : null;
  const onBoard = sharesBoardCaption(dayCell, board), dayAmount = day.units === null ? null : eur(day.units < 0n ? -day.units : day.units);
  // JOED-157: a dashed Today whose reason no caption, board or section line
  // gives keeps its one statement in the sentence instead of the desks' figures.
  const stated = facts.label?.phase === 'last' || day.units !== null || Boolean(first.caption) || onBoard || (shared != null && why === shared);
  let say = stated ? heroSentence(ctx, facts) : null;
  if (say === null) {
    // No snapshot, or no desk with an exact Today: the sentences as before,
    // never repeating the reason the caption or the section line gives.
    say = !data ? day.state === 'not reported' ? 'No numbers yet: no board data has arrived.' : `No numbers: ${esc(why ?? 'not available')}.`
      : day.units === null ? classifyDays(states, data).today.kind === 'notExact' ? 'No desk has an exact result for today.'
        : `Today’s result is not available${why !== shared && !first.caption && !onBoard ? `: ${esc(why ?? 'not reported')}` : ''}.`
        // A shown value that is not current: its state is the figure's caption.
        : `${isZero(day.units) ? 'Flat' : `${day.units > 0n ? 'Up' : 'Down'} ${dayAmount}`} today.`;
  }
  const sinceCell = states['today.totalPnl'], since = cellView(sinceCell, 'hero.since', { caption: SINCE_CAPTION, sharedReason: shared, label: sinceText });
  const sincePct = sincePercent(states);
  const sinceValue = since.units === null ? since.html : figureLink(since.html, resultsHref('all', facts.view.today, 'all'), `${sinceText}: ${eur(since.units, true)}. Opens Results for all time.`);
  const sharedCell = shared ? Object.values(states).find(cell => cell?.reason && cellReason(cell.reason) === shared && cell.state !== 'fresh') : null;
  const boardText = [board ? st(statePhrase(board, '').tone, stateCaption(board, 'board.caption')) : '',
    shared && (!board?.reason || cellReason(board.reason) !== shared) ? st(statePhrase(sharedCell, '').tone, sharedSectionPhrase(sharedCell), statePhrase(sharedCell, '').icon) : ''].filter(Boolean).join(' ');
  const counts = positionCounts(states);
  const openCaption = counts ? `${positionsText(counts.all)} · changes until they close` : 'changes until they close';
  return `<div class="hero-primary"><div class="performance">
      ${first.html}
      <div class="primary since-primary" data-cell="hero.since" data-state="${since.state}"><div class="hero-k">${term('since', sinceText)}${cellIcon(sinceCell, shared)}</div>
        <div class="display">${sinceValue}</div><div class="pct-slot">${percentHtml(sincePct)}${sincePct !== null ? ` <span class="basis">of ${eur(STARTING_MONEY, false, 0)}</span>` : ''}</div>
        <span class="c primary-caption">${reservedCaption(sharesBoardCaption(sinceCell, board) ? '' : since.caption, [SINCE_CAPTION])}</span>
        <button type="button" class="phone-primary-note" data-say="since" aria-label="About Since start" aria-expanded="false"${sharesBoardCaption(sinceCell, board) ? ' disabled' : ''}><span data-clamp="3">${sharesBoardCaption(sinceCell, board) ? '&#160;' : stateCaption(sinceCell, 'hero.phone.since', SINCE_CAPTION, undefined, shared)}</span></button></div>
    </div>
    <button type="button" class="say" data-say="today" aria-expanded="false"><span data-clamp="2">${say}</span></button>
    <p class="board-caption">${boardText}</p></div>
    <div class="account-section" id="accountSection">${disclosureButton('account', 'Desks’ money', 'accountDetail', disclosureProblem([
      [OPEN, states['today.openPnl'], openFault], ['Desks’ money', states['today.equity']],
    ]))}<div class="disclosure-body" id="accountDetail"><p class="pstate account-state"${shared ? '' : ' aria-hidden="true"'}>${shared ? st(statePhrase(sharedCell, '').tone, sharedSectionPhrase(sharedCell), statePhrase(sharedCell, '').icon) : ''}</p><dl class="kpis">
      ${kpi('open', null, 'today.openPnl', 'hero.open', { caption: openCaption, captions: [`${positionsText(999)} · changes until they close`, 'changes until they close'] })}
      ${kpi('desksmoney', null, 'today.equity', 'hero.equity', { signed: false, caption: moneyCaptions[jIncomplete ? 1 : 0], captions: moneyCaptions, href: MONEY_HISTORY_HREF, goes: 'Opens History, the desks’ money this week.' })}
    </dl><p class="desk-scope">Desk figures never include the kept holdings. The whole account, with them, is at the top.</p></div></div>`;
}

// The line above the hero: whose money the figures below are.
export const desksEyebrow = () => `${icon('desk')}<span>Desks J, Joe and Joel · their ${eur(STARTING_MONEY, false, 0)} practice capital · kept holdings left out · EUR</span>`;

// ---------- The desk cards (M5) and their last ten sessions (M4) ----------
// A desk's first figure for the session the hero names: its Today cell in the
// session and after the close (the one classifier and its reasons apply), or
// its Results · Day figure for the last session, from New York midnight to the
// open. Labelled by phase: "Today", or the session's date.
function deskFirst(ctx, facts, id) {
  const label = facts.label;
  if (label?.phase === 'last') return { last: facts.last[id], label: sessionDayName(label.day), short: sessionDayName(label.day).slice(0, 3), termKey: 'lastsession', day: label.day };
  const dated = label?.phase === 'closed';
  return { cell: ctx.states[`desks.${id}.dayPnl`], label: dated ? sessionDayName(label.day) : 'Today', short: dated ? sessionDayName(label.day).slice(0, 3) : 'Today',
    termKey: dated ? 'closedday' : 'today', day: label?.day ?? facts.view.today };
}
// A card figure's caption: its designed words while its value is current;
// otherwise only its state's word, the word its status line uses ("Waiting on
// prices", "Not exact today", "Last good", "Unavailable"). The reason stays
// where JOED-148 put it: on the dash's own name and title and, unless
// Today's not-exact dash is the card's only problem, on the status line.
function cardCaption(cell, designed, board, today = '', label = null) {
  // JOED-157's Open words, as the status line says them: a price wait is
  // waiting, never "Unavailable".
  if (label === OPEN && waitingOnPrices(cell)) return 'Waiting on prices';
  // A current value, or one that is only old (the board says how old): its
  // designed words.
  if (cell?.value != null && (cell.state === 'fresh' || (cell.state === 'stale' && !cell.retained))) return designed;
  if (sharesBoardCaption(cell, board)) return '';
  // A value kept from before a fault is the state's own word, never the
  // designed words of a current one.
  if (cell?.value != null) return cell.retained ? 'Last good' : 'Unavailable';
  return notExactDash(cell) ? `Not exact${today}` : (cell?.state ?? 'not reported') === 'not reported' ? 'Not reported' : 'Unavailable';
}
// M5: a desk is one row only when Results' record proves it has not traded:
// no closed trade for it in a record that covers its whole period (tracking
// started on or before the desk's start), with no partial closed day (capture
// gaps and unattributed activity are partial), no missing daily summary, no
// open day with a real cause, and not a retained (last good) record. Unknown
// is never none, and only the record decides: positions going stale change
// the row's words, never the layout (an old but accepted record still holds).
// Returns the desk's start day, or null for the normal card.
export function noTradesSinceStart(ctx, facts, id) {
  const cell = facts.view.cell;
  if (!cell || cell.retained || cell.state === 'broken') return null;
  return facts.quiet?.[id] ?? null;
}
// The record's own proof for one desk (memoised with the record): no closed
// trade, and coverage of every closed session from the desk's start: a daily
// summary for each, none partial or missing, and no real cause on the open day.
function recordedQuiet(view, start, id, trades) {
  const ix = view.ix;
  if (!ix || !start || !view.trackingStart || view.trackingStart > start || trades?.[id] !== 0) return null;
  for (const k of ix.partialDays) if (k >= start && (k < view.today || ix.partialDetails.get(k)?.partialReasons?.length)) return null;
  for (const k of ix.missingDays) if (k >= start) return null;
  // Every day back to the desk's start: a session needs its summary, and a day
  // the market calendar does not cover proves nothing, so the claim fails.
  const at = new Map(ix.dates.map((d, i) => [d, i])), desk = DESKS.indexOf(id);
  for (let k = RM.addDays(view.today, -1); k >= start; k = RM.addDays(k, -1)) {
    const s = sessionBounds(zonedInstant(k, '12:00:00', NY));
    if (s.reason === 'calendar_unavailable') return null;
    if (!s.openAt) continue;
    const i = at.get(k);
    if (i === undefined || !ix.close.state[i * 3 + desk]) return null;
  }
  return start;
}
// What a desk holds, in words, from the fresh positions panel; otherwise the
// panel's state, so a stale panel is said and never read as no positions.
export function positionsWord(states, id, held = '') {
  const counts = positionCounts(states);
  if (counts) return positionsText(counts[id], held);
  const state = states.positions?.state ?? 'not reported';
  return state === 'not reported' ? 'positions not reported' : state === 'broken' ? 'positions unavailable' : 'positions not current';
}

// Today's bar on a card: the desk's Today through the one classifier; a
// figure only when it is exact (an estimate keeps its mark).
function todayBar(ctx, id) {
  const cell = ctx.states[`desks.${id}.dayPnl`], day = classifyDay(cell, dayChannels(ctx.feeds.data?.value, id));
  const units = day.kind === 'exact' ? exactCell(cell) : null;
  if (units !== null) return { units, estimated: day.estimated };
  const why = day.reason ? cellReason(day.reason) : cell?.reason ? cellReason(cell.reason) : null;
  return { units: null, reason: day.kind === 'notExact' ? `not exact today${why && why !== NOT_EXACT ? ` · ${why}` : ''}` : `unavailable today${why ? ` · ${why}` : ''}` };
}

// A bar's value label: whole euros, two decimals under € 1, k and M above a
// thousand; from exact units, rounded once.
export function barLabel(units) {
  if (isZero(units)) return '0';
  const abs = units < 0n ? -units : units, sign = units < 0n ? MINUS : '+', whole = divRound(abs, UNIT);
  if (whole === 0n) return `${sign}0,${String(divRound(abs * 100n, UNIT)).padStart(2, '0')}`;
  if (whole < 1000n) return `${sign}${whole}`;
  const scaled = (exp, cap) => { const tenths = divRound(abs * 10n, 10n ** BigInt(exp) * UNIT); return tenths < cap ? `${tenths / 10n}${tenths % 10n ? `,${tenths % 10n}` : ''}` : `${divRound(abs, 10n ** BigInt(exp) * UNIT)}`; };
  return whole < 1000000n ? `${sign}${scaled(3, 100n)}k` : `${sign}${scaled(6, 100n)}M`;
}

// M4: the desk's last ten sessions as bars on its own scale, from Results'
// Day figures, today's still-moving bar from its Today. Every bar carries its
// value: inside the bar when the label fits, else at the bar's x on the other
// side of zero. Where labels would collide (data-lc and the container width,
// in CSS), the extremes and today's keep theirs and the others show on hover
// or focus, with the date and the exact amount. Every bar opens Results.
const BAR_BOX = 76, LABEL_ROOM = 13, LABEL_LINE = 11;
function barsHtml(ctx, facts, id) {
  const label = facts.label, why = text => `<div class="bars bars-why" role="note"><span>${esc(text)}</span></div><div class="bars-ax"></div>`;
  if (!label) return { head: 'Last sessions', html: why(ctx.now ? 'Sessions not known: market calendar not available' : 'Time not known: waiting for the board server’s clock') };
  if (!facts.view.ix) return { head: 'Last sessions', html: why(capital(resultsDay(facts.view, label.day, [id]).reason)) };
  const items = facts.bars[id].map(b => (b.today ? { ...b, ...todayBar(ctx, id) } : b));
  if (!items.length) return { head: 'Last sessions', html: why('No session since paper results started') };
  // The record's own state when it is not fresh, on every bar taken from it
  // and in the bars' caption (today's bar is Today, not the record).
  const feed = feedMark(facts.view), feedNote = feed ? ` · ${feed.text}` : '';
  const vals = items.map(b => (b.units === null ? null : Number(b.units) / 1e8)), known = vals.filter(v => v !== null);
  const hi = Math.max(0, ...known), lo = Math.min(0, ...known), span = hi - lo, plot = BAR_BOX - 2 * LABEL_ROOM;
  const z = span > 0 ? LABEL_ROOM + hi / span * plot : BAR_BOX / 2;
  const labels = items.map(b => (b.units === null ? null : barLabel(b.units)));
  const chars = Math.max(1, ...labels.filter(Boolean).map(l => l.length));
  const iMax = known.length ? vals.indexOf(Math.max(...known)) : -1, iMin = known.length ? vals.indexOf(Math.min(...known)) : -1;
  // The label beside zero: below it for a gain, above it for a loss or flat.
  const zly = (v, flat) => (flat || v < 0 ? z - LABEL_LINE - 2 : z + 2);
  const bars = items.map((b, i) => {
    const href = resultsHref('day', b.day, id), when = b.today ? `Today · ${sessionDayName(b.day)}` : sessionDayName(b.day);
    if (b.units === null) {
      const why = `${b.reason}${b.warning ? ` · ${b.warning.text}` : ''}${b.today ? '' : feedNote}`;
      return `<a class="b${b.today ? ' today' : ''}" data-day="${b.day}" href="${href}" aria-label="${esc(`${when}: ${why}`)}"><i class="nx" style="top:${(z - 9).toFixed(1)}px;height:18px"></i><span class="bt" aria-hidden="true"><b>${esc(when)}</b><span>${esc(why)}</span></span></a>`;
    }
    const v = vals[i], flat = isZero(b.units), h = flat ? (b.today ? 3 : 2) : Math.max(3, Math.abs(v) / span * plot);
    // Today's 60 % fill cannot carry a small label at 4.5:1 in the dark theme,
    // so its label always sits on the other side of zero.
    const top = flat ? z - h / 2 : v > 0 ? z - h : z, inside = !flat && !b.today && h >= LABEL_LINE + 4;
    const tone = flat ? 'flat' : v > 0 ? 'gain' : 'loss', amount = eur(b.units, true);
    const note = b.today ? b.estimated ? 'estimated from the session open' : 'so far · after fees' : `after fees · from Results${b.warning ? ` · ${b.warning.text}` : ''}${feedNote}`;
    const keep = i === iMax || i === iMin || b.today ? ' keep' : '', c = labels[i].length;
    const own = inside ? `<span class="bl in" data-c="${c}" style="${v > 0 ? 'top' : 'bottom'}:2px" aria-hidden="true">${labels[i]}</span>` : '';
    return `<a class="b${b.today ? ' today' : ''}${inside ? ' has-in' : ''}" data-c="${c}" data-day="${b.day}" href="${href}" aria-label="${esc(`${when}: ${amount}, ${note}`)}"><i class="${tone}${b.today ? ' live' : ''}${b.estimated ? ' est' : ''}" style="top:${top.toFixed(1)}px;height:${h.toFixed(1)}px">${own}</i><span class="bl out ${tone}${keep}" style="top:${zly(v, flat).toFixed(1)}px" aria-hidden="true">${labels[i]}</span><span class="bt" aria-hidden="true"><b>${esc(when)}</b> · ${amount}<span>${esc(note)}</span></span></a>`;
  }).join('');
  // The width the labels need side by side (at most 5.8 px a character in
  // 9.5 px mono, 4 px between labels; in tenths of a pixel), in 20 px steps:
  // below it only the extremes and today keep theirs (app.css, @container spark).
  const need = Math.min(400, Math.max(100, Math.ceil((items.length * (58 * chars + 40) - 40) / 200) * 20));
  const last = items.at(-1);
  return { head: `Last ${items.length} session${items.length === 1 ? '' : 's'}`, feed,
    html: `<div class="bars" role="group" aria-label="${esc(`${LABEL[id]}: last ${items.length} sessions, each session’s result after fees${feedNote}`)}" data-lc="${chars}" data-need="${need}"><span class="bz" style="top:${z.toFixed(1)}px"></span>${bars}</div>
      <div class="bars-ax"><span>${sessionDayName(items[0].day)}</span><span>${last.today ? 'today' : sessionDayName(last.day)}</span></div>` };
}

// M4 on a touch screen: the first tap on a bar shows its tip (the date, the
// exact amount and "Open in Results"); that link, or a second tap on the same
// bar, opens Results. Escape or a tap anywhere else closes it. A mouse keeps
// hover and the keyboard keeps focus (app.css); neither is changed here.
export function barTapAction(open, { bar = null, touch = false, inTip = false, onTip = false } = {}) {
  if (inTip) return 'follow';
  if (onTip) return null;
  if (bar && touch) return bar === open ? 'follow' : 'open';
  return open ? 'close' : null;
}
// The tapped bar's tip: its own hover tip's words, then the way to Results.
export const barTipHtml = (words, href) => `${words}<a class="bars-go" href="${esc(href)}">Open in Results${icon('chev-r')}</a>`;
const barKey = bar => `${bar.closest('.dcard')?.id ?? ''}|${bar.dataset.day ?? ''}`;
let tapped = null;
function closeBarTip() {
  tapped = null;
  for (const tip of document.querySelectorAll('.desk-sessions .bars-tap')) if (!tip.hidden) { tip.hidden = true; tip.innerHTML = ''; }
  for (const bar of document.querySelectorAll('.desk-sessions .bars a.b.tapped')) bar.classList.remove('tapped');
}
function openBarTip(bar) {
  const box = bar.closest('.desk-sessions'), tip = box?.querySelector('.bars-tap'), bars = bar.closest('.bars');
  if (!tip || !bars) return;
  closeBarTip();
  tapped = barKey(bar);
  bar.classList.add('tapped');
  tip.innerHTML = barTipHtml(bar.querySelector('.bt')?.innerHTML ?? '', bar.getAttribute('href'));
  tip.hidden = false;
  // Above the bars, centred on the tapped one and kept inside the card.
  const b = bar.getBoundingClientRect(), s = box.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(s.width - w, b.left - s.left + b.width / 2 - w / 2))}px`;
  tip.style.top = `${bars.offsetTop}px`;
}
// A rebuilt card keeps the tip open on the same desk and session.
function restoreBarTip() {
  if (!tapped) return;
  const [card, day] = tapped.split('|');
  const bar = document.getElementById(card)?.querySelector(`.desk-sessions .bars a.b[data-day="${day}"]`);
  if (!bar) { tapped = null; return; }
  if (!bar.classList.contains('tapped')) openBarTip(bar);
}
// Only a Desk session chart's bar, never another screen's `.b`.
const sessionBar = el => { const bar = el?.closest?.('a.b'); return bar?.closest('.bars') && bar.closest('.desk-sessions') ? bar : null; };
export function initBarTaps() {
  let pointer = '';
  document.addEventListener('pointerdown', e => { pointer = e.pointerType ?? ''; }, true);
  document.addEventListener('click', e => {
    const bar = sessionBar(e.target);
    const touch = (e.pointerType || pointer) === 'touch' && e.detail !== 0;
    const tip = e.target.closest?.('.bars-tap')?.closest('.desk-sessions') ? e.target.closest('.bars-tap') : null;
    const action = barTapAction(tapped, { bar: bar && barKey(bar), touch, inTip: Boolean(tip && e.target.closest('.bars-go')), onTip: Boolean(tip) });
    if (action === 'open') { e.preventDefault(); openBarTip(bar); }
    // Following a link closes the tip after the link has done its work.
    else if (action === 'follow') setTimeout(closeBarTip);
    else if (action) closeBarTip();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tapped) closeBarTip(); });
}

function deskCard(ctx, id, facts = deskFacts(ctx)) {
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
  const board = boardCaptionCell(ctx), first = deskFirst(ctx, facts, id), today = facts.view.today;
  // The desk's own accounting start wins; else the board's verified start (A4).
  const sinceText = sinceLabel(sinceStarts(feeds).days[id]);
  const openCell = states[`desks.${id}.openPnl`], sinceCell = states[`desks.${id}.totalPnl`];
  const cells = [...(first.cell !== undefined ? [[first.label, first.cell]] : []), [termLabel('open'), openCell], [sinceText, sinceCell]];
  const shared = sharedSectionReason(cells.map(([, cell]) => cell));
  const counts = positionCounts(states), held = heldWord(now, facts.label);
  // A dash's caption repeats its accessible name, so only sighted readers get it.
  const num = (k, html, cell, caption, state, digits, extra = '', quiet = false) => `<div data-state="${state}"><span class="k">${k}${cell ? cellIcon(cell, shared, cell === openCell ? OPEN : null) : ''}${extra}</span><span class="v" style="--digits:${digits}">${html}</span><span class="c"${quiet ? ' aria-hidden="true"' : ''} title="${esc(plainText(caption))}">${caption}</span></div>`;
  const linked = (v, href, name) => (v.units === null ? v.html : figureLink(v.html, href, name));
  // The first figure, by phase.
  let firstNum;
  if (first.last) {
    const f = first.last, marks = lastMarks(facts.view, f);
    const name = f.units === null ? lastDashName(`${LABEL[id]} · ${first.label}`, f, marks) : `${LABEL[id]} · ${first.label}: ${eur(f.units, true)}${marksText(marks)}`;
    const html = f.units === null ? `<span class="bn muted" role="img" title="${esc(name)}" aria-label="${esc(name)}">—</span>` : figureLink(bn(f.units), resultsHref('day', first.day, id), `${name}. Opens Results for that day.`);
    firstNum = num(term(first.termKey, first.label), html, null, f.units === null ? `${esc(capital(f.reason))}${marksHtml(marks)}` : `closed ${signedMoney(f.closed)} · still open ${signedMoney(f.open)}${marksHtml(marks)}`,
      f.units === null ? 'broken' : marks.length ? 'stale' : 'fresh', f.units === null ? 1 : eur(f.units, true).length);
  } else {
    const v = cellView(first.cell, `d.${id}.day`, { label: first.label, sharedReason: shared });
    firstNum = num(term(first.termKey, first.label), linked(v, resultsHref('day', first.day, id), `${LABEL[id]} · ${first.label}: ${v.units === null ? '' : eur(v.units, true)}. Opens Results for that day.`), first.cell,
      cardCaption(first.cell, 'so far · after fees', board, first.label === 'Today' ? ' today' : '', first.label), v.state, v.units === null ? 1 : eur(v.units, true).length, dayEstimateMark(ctx, id), v.units === null);
  }
  const openV = cellView(openCell, `d.${id}.open`, { label: termLabel('open'), sharedReason: shared });
  const sinceV = cellView(sinceCell, `d.${id}.since`, { label: sinceText, sharedReason: shared });
  const sinceNum = num(term('since', sinceText), linked(sinceV, resultsHref('all', today, id), `${LABEL[id]} · ${sinceText}: ${sinceV.units === null ? '' : eur(sinceV.units, true)}. Opens Results for all time.`),
    sinceCell, cardCaption(sinceCell, 'after fees', board, '', sinceText), sinceV.state, sinceV.units === null ? 1 : eur(sinceV.units, true).length, '', sinceV.units === null);
  const go = `<a class="card-go" href="${resultsHref('week', today, id)}" aria-label="${esc(`Results for ${LABEL[id]}`)}">Results${icon('chev-r')}</a>`;
  const name = esc(desk?.label ?? LABEL[id]);
  const quietSince = noTradesSinceStart(ctx, facts, id), feed = feedMark(facts.view);
  // Every number that is not fresh gets its own line, age and reason; numbers
  // that share all three share a line, and a reason the whole snapshot shares
  // is on the hero's line instead. A not-exact Today that is the card's only
  // problem needs no line: its info icon and its dash's name and title give it.
  const loneNotExactDay = first.cell !== undefined && classifyDay(first.cell, dayChannels(data, id)).kind === 'notExact'
    && cells.slice(1).every(([, cell]) => cell?.state === 'fresh' || sharesBoardCaption(cell, board));
  const cellStatus = loneNotExactDay ? '' : cardStatus(id, cells, board, 3);
  if (quietSince) {
    // One row still says every figure's state, age and reason, Open's too
    // (it shows no Open figure), on its own reserved line.
    // The claim comes from the record: an old record says so beside it.
    return `<div class="drow">${deskMark(id)}<div class="who"><h3>${name}</h3><span class="sep" aria-hidden="true"> · </span><span class="state st ${info.tone}">${icon(info.icon)}<span>${info.word.toLowerCase()}${since} · no trades since ${dayText(quietSince)}${marksHtml(feed ? [feed] : [])} · ${positionsWord(states, id, held)}</span></span></div>
      <div class="dnums">${firstNum}${sinceNum}</div><span class="hb warn">${hb}</span>${go}<div class="drow-status"${cellStatus ? '' : ' aria-hidden="true"'}>${cellStatus}</div></div>`;
  }
  const detail = desk?.state === 'stuck' ? STUCK_REASON : desk ? positionsWord(states, id, held) : '';
  // Only a real activity sentence is shown; the pusher's valuation status
  // sentences say nothing about what the desk is doing (JOED-148 P0-5).
  const activity = !desk ? 'Waiting for the first valid snapshot.' : PUSHER_STATUS.has(desk.action) ? '' : esc(desk.action);
  const bars = barsHtml(ctx, facts, id), learning = learningLine(desk?.learning);
  // The status lines cover the bars; when those come from an old record, the
  // record's state is one of the lines, as it is the bars' caption otherwise.
  const status = cellStatus && bars.feed ? `${cellStatus}${st('warn', esc(bars.feed.text), 'half')}` : cellStatus;
  return `<header>${deskMark(id)}<div class="who"><h3>${name}</h3><div class="state st ${info.tone}">${icon(info.icon)}<span title="${esc(`${info.word}${since}${detail ? `${NB}· ${plainText(detail)}` : ''}`)}">${info.word}${since}${detail ? `<span class="detail">${NB}· ${detail}</span>` : ''}</span></div></div><span class="hb warn">${hb}</span>${go}</header>
      ${activity ? `<p class="now">${activity}</p>` : ''}
      <div class="dnums">
        ${firstNum}
        ${num(term('open'), openV.html, openCell, cardCaption(openCell, counts ? positionsText(counts[id]) : '', board, '', OPEN), openV.state, openV.units === null ? 1 : eur(openV.units, true).length, '', openV.units === null)}
        ${sinceNum}
      </div>
      <div class="spark desk-sessions${status ? ' off' : ''}"><div class="spark-h"><span><b>${bars.head}</b> · ${bars.feed ? st('warn', esc(bars.feed.text), 'half') : 'each session’s result in €, after fees'}</span></div>${bars.html}<div class="bars-tap" hidden></div>${status ? `<div class="card-status">${status}</div>` : ''}</div>
      ${learning ? `<footer>${icon('learning')}<span>${term('learning')}: ${esc(learning)}${desk.learning.status === 'blocked' ? ' · blocked' : ''}</span></footer>` : ''}`;
}

// The card's numbers that are not fresh, each with its own state, age and
// reason. Numbers that share all three share a line. The lines sit in the
// bars' fixed header slot, so a fresh card keeps the approved spacing and a
// change of state moves nothing. `total` is how many figures the card has:
// "Numbers" means all of them.
export function cardStatus(id, cells, board = null, total = cells.length) {
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
    const p = figurePhrase(g.cell, `card.${id}.${i}`, g.labels.length === 1 ? g.labels[0] : null, 'last good', seen.has(reason) ? reason : null);
    seen.add(reason);
    const who = g.labels.length === total ? 'Numbers' : g.labels.length === 2 ? `${g.labels[0]} and ${g.labels[1]}` : g.labels[0];
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
  const label = `${POSITION_FIELDS[field]}: ${dashWords(row.reasons?.[field] ?? cell?.reason ?? 'feed_not_received')}`;
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

// Unknown quantity remains unknown; only an exact, confirmed zero is flat.
const openPositionRows = cell => cell?.value?.filter(row => row.quantity == null || decimalUnits(row.quantity) !== 0n);

export function positionsHtml(ctx) {
  const { states } = ctx;
  const cell = states.positions;
  const rows = openPositionRows(cell);
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

// The small session line (M3): the household's Today through the regular
// session, from History's observed points, only in the session and after the
// close (the hero reserves its room in those phases only). Without a line the
// chart is hidden and holds nothing: no empty chart box (P0-6). Returns
// whether the line is shown.
function drawHeroChart(ctx, history, label = ctx.now ? sessionLabel(ctx.now) : null) {
  const el = $('#heroChart'), axis = $('#sessAxis');
  if (!el) return false;
  const on = label && label.phase !== 'last';
  const series = on && history ? intraday(history.columns, 'dayPnl', label.openAt, label.closeAt) : [];
  if (!series.length) {
    el.hidden = true;
    el.querySelector(':scope > svg')?.remove();
    chartKeys.delete(el.id);
    if (axis) patch(axis, '');
    return false;
  }
  el.hidden = false;
  const open = Date.parse(label.openAt), close = Date.parse(label.closeAt), nowMs = Date.parse(ctx.now), last = series.at(-1);
  const live = label.phase === 'live', colour = last.v < 0 ? 'var(--loss)' : 'var(--gain)';
  const end = `${eur(last.v, true)} at ${timeHM(new Date(last.x).toISOString())}`;
  if (axis) patch(axis, `<span>${timeHM(label.openAt)}</span><span class="sl-v ${last.v < 0 ? 'loss' : last.v > 0 ? 'gain' : ''}" style="--at:${Math.max(0, Math.min(1, (last.x - open) / (close - open))).toFixed(4)}">${end}</span><span class="e">${timeHM(label.closeAt)}</span>`);
  const key = JSON.stringify([label.openAt, Math.floor(nowMs / 60000), history?.seq, history?.receivedAt, el.clientWidth, el.clientHeight]);
  if (chartKeys.get(el.id) === key && el.querySelector(':scope > svg')) return true;
  chartOnce(el, key, () => {
    drawChart(el, {
      series: [{ pts: series, color: colour, live, w: 1.75 }], xDomain: [open, close], zero: true, ticks: 1, noY: true, pad: { l: 1, r: 4, t: 3, b: 3 },
      future: live ? [nowMs, close] : null,
      label: `Today’s result through the regular session: ${end}`,
      tipFmt: near => `<b>${timeHM(new Date(near[0].x).toISOString())}</b> · ${eur(near[0].v, true)}`,
    });
  });
  return true;
}

export function renderDesk(ctx) {
  const health = boardHealthPresentation(ctx.states, ctx.feeds, ctx.now);
  const facts = deskFacts(ctx), phase = facts.label?.phase ?? 'none';
  // The slot above the desk hero is the whole-account block's (account.js,
  // JOED-156): the paper account with the kept holdings, and Cash.
  const eyebrow = $('#desksEyebrow');
  if (eyebrow) patch(eyebrow, desksEyebrow());
  const hero = $('#deskHero');
  if (hero && hero.dataset.phase !== phase) hero.dataset.phase = phase;
  patch($('#heroL'), heroLeft(ctx, facts));
  const market = marketBlock(ctx.now);
  patch($('#heroSession'), market.html);
  const data = ctx.feeds.data?.value;
  const working = data ? data.desks.filter(d => d.state === 'working').length : 0;
  $('#desksSub').textContent = data ? `${working} of 3 working · results leave out the kept holdings` : 'Waiting for the first valid snapshot';
  const desksSince = $('#desksSince'), common = sinceStarts(ctx.feeds).common, sinceHeading = common ? sinceLabel(common) : '';
  if (desksSince && desksSince.textContent !== sinceHeading) desksSince.textContent = sinceHeading;
  let redraw = false;
  const rows = new Set();
  for (const id of DESKS) {
    const card = $(`#desk-${id}`);
    if (!card.querySelector('.desk-detail')) card.innerHTML = `<div class="compact-row"></div><div class="desk-detail disclosure-body" id="detail-${id}"></div>`;
    patch(card.querySelector('.compact-row'), compactDesk(ctx, id, facts));
    const layout = noTradesSinceStart(ctx, facts, id) ? 'row' : 'card';
    if (layout === 'row') rows.add(id);
    if (card.dataset.layout !== layout) card.dataset.layout = layout;
    if (patch(card.querySelector('.desk-detail'), deskCard(ctx, id, facts))) redraw = true;
  }
  restoreBarTip();
  const grid = $('.desk-grid');
  if (grid && grid.dataset.rows !== String(rows.size)) grid.dataset.rows = String(rows.size);
  // The phone section's title names the market and says its state in a line.
  patch($('#chartTitle'), `New York market<span class="dis-sub">${esc(market.summary)}</span>`);
  patch($('#chartSummary'), problemHtml(disclosureProblem([
    ['History', ctx.states.history], ...(!ctx.now ? [['Clock', { state: 'not reported', value: null }]]
      : sessionBounds(ctx.now).reason === 'calendar_unavailable' ? [['Market hours', { state: 'broken', value: null, reason: 'calendar_unavailable' }]] : []),
  ])));
  $('#positionsTitle').textContent = `Positions · ${openPositionRows(ctx.states.positions)?.length ?? '—'} open`;
  $('#keptTitle').textContent = `Kept holdings · ${ctx.states.kept?.value?.length ?? '—'}`;
  patch($('#positionsSummary'), problemHtml(disclosureProblem([['Positions', ctx.states.positions], ...rowProblems(ctx.states.positions)])));
  patch($('#keptSummary'), problemHtml(disclosureProblem([['Kept holdings', ctx.states.kept], ...rowProblems(ctx.states.kept)])));
  syncDeskDisclosures();
  const currentOrder = [...grid.children].map(card => card.id.slice(5));
  // Re-ranking must not detach a focused phone row or a term's open tip.
  // Values still refresh; apply the latest ranking once the user leaves.
  // Full cards rank by Since start, best first; one-row cards come after them.
  if (!interactionWithin(grid)) {
    const ranked = rankDesks(ctx.states, currentOrder), order = [...ranked.filter(id => !rows.has(id)), ...ranked.filter(id => rows.has(id))];
    for (const [index, id] of order.entries()) {
      const card = $(`#desk-${id}`);
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index]);
    }
  }
  // The chart measures its box before the long sections below change, so an
  // update never forces a layout of the whole position list mid-render.
  const history = ctx.states.history?.value?.columns ? ctx.states.history.value : null;
  drawHeroChart(ctx, history, facts.label);
  const pos = positionsHtml(ctx);
  $('#posSub').textContent = pos.sub;
  patch($('#positions'), pos.html);
  patch($('#kept'), keptHtml(ctx));
  return { health, redraw };
}
