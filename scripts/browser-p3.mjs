#!/usr/bin/env node
// P3 browser gate: the real board server, P1 fixtures and one headless browser
// at 390/1024/1440 in light and dark (AC-1, 2, 5–9, 18–21, 28–34, 36, 38–47).
// One browser, one page, run sequentially; screenshots go to the QA folder.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';
import * as nodeModule from 'node:module';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, scenario, accountScenario, NOW, at, ACTOR, valid, fixture, ingress, singleMissingDesk, coupledUnavailable, acceptSnapshot, panelStates, advance, measureHistory } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load as loadPage, go as goPage, screenshot, settle, waitFor, pointerMedia, MOUSE, TOUCH, copyText } from './browser/shots.mjs';
import { setDeskDisclosures, phoneDeskSnapshot } from './browser/desk-disclosures.mjs';
import { heroWordingFixtures } from './browser/hero-wording-fixtures.mjs';
import { focusTermTips } from './browser/term-focus.mjs';
import { runBudget, budgetTable, CI_GUARD, REFERENCE_BUDGET } from './browser/budget.mjs';
import { TERMS } from '../public/joe/terms.js';
import { createGate, proportional, shifted, WIDE_FONT } from './browser/gate.mjs';
import { phaseBChecks, deskRankingFocusChecks } from './browser/phase-b.mjs';
import { createGroupTiming, groupTimingTable } from './browser/group-timing.mjs';
import { historyControlChecks, historyFollowGrowthChecks, historyDesignChecks } from './browser/history-controls.mjs';
import { headerNavChecks } from './browser/header-nav.mjs';
import { accountHeroChecks } from './browser/account-hero.mjs';
import { parseBoardSweepArgs, createBoardSweepPlan, boardSweepErrors, boardSweepTable } from './board-sweep-plan.mjs';

// The widest window with the phone's bottom bar (app.css); above it the nav
// is in the header. Plan before any side effects, so invalid CLI options or
// unhandled breakpoints fail immediately.
const COMPACT = 480;
const joeDirectory = new URL('../public/joe/', import.meta.url);
const sweepPlan = createBoardSweepPlan({ mode: parseBoardSweepArgs(process.argv.slice(2)), compact: COMPACT,
  css: readFileSync(new URL('app.css', joeDirectory), 'utf8'),
  javascript: readdirSync(joeDirectory).filter(name => name.endsWith('.js')).map(name => readFileSync(new URL(name, joeDirectory), 'utf8')) });
let sweepRan = false;
const sweepErrors = [];

// The page's own history model, for the values its sparklines must plot. The
// server serves time.mjs and contracts/ from the repo root; mirror that here.
const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}
const hm = await import('../public/joe/history-model.js');
const { boardStates, NOT_EXACT_REASONS, notExactDash } = await import('../public/joe/board-state.js');
const { cellReason, capital, CELL_REASON, REASON_COPY, statusSentence, boardHealthPresentation, statusPresentation } = await import('../public/joe/health.js');
const { statePhrase } = await import('../public/joe/ui.js');
const fmt = await import('../public/joe/format.js');
const { historyChangeText } = await import('./browser/history-compare.mjs');
const { STARTING_MONEY } = await import('../public/joe/performance.js');
const { decimalUnits, divRound, UNIT } = await import('../contracts/decimal.mjs');
const { boardCaptionCell, sharesBoardCaption, sharedSectionReason, disclosureProblem, rowProblems, dashWords } = await import('../public/joe/desk.js');
// JOED-153: Desk beside a Results record, and the pure parts of the Desk
// checks (both read the page's model, so after the hooks).
const { deskSessionChecks } = await import('./browser/desk-sessions.mjs');
const { percentText, keptOnlyInAccount, brokenJourneyTotalsOk, heroProblemCaption } = await import('./browser/desk-checks.mjs');
// JOED-156: the whole-account block fills JOED-153's slot above the hero; its
// value states its own panel state in its change line (account.js stateLine).
const { stateLine } = await import('../public/joe/account.js');
const HEALTH_LINES = Object.keys(REASON_COPY).map(reason => statusSentence({ reason, tone: reason === 'board_ok' ? 'green' : 'red' }, { receipt: 9, gatewayAge: 179 }));

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p3');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const { results, shots, check, shot, auditScreen } = createGate(QA_DIR);
const timing = createGroupTiming({ results, shots });
const SHIFT_SELECTORS = ['header.top', '#statusAlert', '#acctHero', '#deskHero', '.hero-primary', '#accountSection', '.hero-r', '.desk-row', '#heroL .primary', '#heroL .pct-slot', '#heroL .board-caption', '#heroL .kpi', '#heroL .display', '.dcard', '.dcard .dnums > div', '.dcard .spark', '#positions', '.prow', '#kept', 'footer.foot'];

// Original checks read complete cards, charts and rows. Open their actual
// phone controls first; initial/collapsed checks opt out explicitly below.
async function load(page, url, screen = 'desk', { details = true } = {}) {
  await loadPage(page, url, screen);
  if (screen === 'desk' && details) await setDeskDisclosures(page, true);
}
async function go(page, screen) {
  await goPage(page, screen);
  if (screen === 'desk') await setDeskDisclosures(page, true);
}

async function phoneFirstScreenChecks(page, viewport, theme, snapshot) {
  const tag = `${viewport.name} ${theme} phone first screen`;
  const d = await phoneDeskSnapshot(page).then(copyText);
  // JOED-156: the whole account comes first and fills the first screen (value,
  // change, Since start · Cash, ranges and chart, above the bottom navigation);
  // the desk figures, the one-line sentence and the ranked rows follow it.
  check('phone-first', `${tag}: the whole account fits above the bottom navigation first; primary euros/percent, the one-line sentence and all ranked desk rows follow it`,
    d.account && /€/.test(d.account.value) && d.account.top >= d.header.bottom - 0.5 && d.account.bottom <= Math.min(844, d.bottomBar.top) - 8 &&
    d.account.chart.bottom <= d.account.bottom && d.primary.length === 2 && d.primary.every(p => /€/.test(p.euros) && /%/.test(p.pct) && p.top >= d.account.bottom) && d.rows.length === 3 &&
    d.rows.every(r => r.icon && r.state && r.top >= d.account.bottom) &&
    d.sentence.bottom <= d.rows[0].top && await page.evaluate(`document.querySelector('#heroL .say > span').dataset.clamp === '1' && scrollY === 0`), d);
  const ranked = snapshot.desks.slice().sort((a, b) => {
    const x = decimalUnits(a.money.totalPnl.amount), y = decimalUnits(b.money.totalPnl.amount);
    return x === y ? 0 : x > y ? -1 : 1;
  }).map(desk => desk.id);
  const compactMoney = text => text.replace(/\s/g, '');
  check('phone-first', `${tag}: every compact row preserves the ranked card's Today and Since start values`,
    d.rows.map(r => r.key).join() === ranked.join() && d.rows.every(r => r.values.length === 2 && r.values.every((v, i) => compactMoney(v) === compactMoney(r.detailValues[i]))), d.rows);
  check('phone-first', `${tag}: compact rows and their section end within 12 px of the reserved warning line, without a trailing detail gap`,
    d.rows.length === 3 && d.rows.every(r => r.card.bottom - r.warningLineBottom >= 0 && r.card.bottom - r.warningLineBottom <= 12 && r.card.bottom === r.bottom) &&
    d.desks.bottom - d.rows.at(-1).warningLineBottom <= 12 && d.desks.bottom === d.rows.at(-1).bottom, { desks: d.desks, rows: d.rows });
  // JOED-156 fills JOED-153's slot: the whole account is the phone's first
  // block, open (no collapsed Whole account section); the 1600 px budget stays
  // for everything below it, which adds its own block and gap.
  check('phone-first', `${tag}: all seven disclosures start collapsed with 44 px targets, no horizontal scroll and a collapsed page ≤1600 px plus the whole account`,
    d.controls.length === 7 && !d.controls.some(c => c.key === 'whole') && d.controls.every(c => c.expanded === 'false' && c.hidden && !c.visible && c.height >= 44) && d.horizontal.scroll <= d.horizontal.inner &&
    d.account && d.account.height <= 440 && d.pageHeight <= 1600 + d.account.height + d.account.gap, d);
  check('phone-first', `${tag}: missing Cash is visible on the first screen, in the whole account's Since start · Cash line, with its reason and accessible name`,
    d.account?.cash?.text === 'Cash — · not reported · no data received yet' && d.account.cash.name === 'Cash no data received yet' &&
    d.account.cash.top >= d.account.top && d.account.cash.bottom <= Math.min(844, d.bottomBar.top) - 8, d.account);
  await shot(page, viewport, `${viewport.name}-${theme}-desk-first-screen`, 'Phone Desk, default collapsed: status, Today, Since start and three ranked desk rows');
  // Enter and Space use the native button, retain focus, and expose the body.
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const name of ['Enter', ' ']) {
    await page.evaluate(`document.querySelector('[data-desk-disclosure="j"]').focus({ preventScroll: true })`);
    if (name === 'Enter') await key(page, 'Enter');
    else {
      await page.s('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await settle(page);
    }
    check('phone-first', `${tag}: ${name === ' ' ? 'Space' : name} toggles aria-expanded and the matching full card while retaining focus`, await page.evaluate(`(() => {
      const b = document.querySelector('[data-desk-disclosure="j"]'), open = b.getAttribute('aria-expanded') === 'true';
      return open === ${name === 'Enter'} && document.getElementById('detail-j').hidden !== open && document.activeElement === b;
    })()`));
  }
  await setDeskDisclosures(page, true);
  const open = await phoneDeskSnapshot(page);
  check('phone-first', `${tag}: one tap per section exposes every retained detail, including charts`, open.controls.every(c => c.expanded === 'true' && !c.hidden && c.visible) &&
    await page.evaluate(`document.querySelectorAll('.dcard .spark').length === 3 && [...document.querySelectorAll('.dcard .spark')].every(__audit.visible) && document.querySelector('#heroChart > svg')`), open.controls);
}

async function deskChecks(page, viewport, theme, snapshot) {
  const tag = `${viewport.name} ${theme} desk`;
  const d = await page.evaluate(`(() => {
    const t = s => document.querySelector(s)?.innerText.trim() ?? '';
    const header = document.querySelector('header.top').innerText;
    const rest = [...document.querySelectorAll('main, .bottom-nav')].map(e => e.innerText).join(' ');
    const kpi = k => ({ cell: k.dataset.cell, state: k.dataset.state, dt: k.querySelector('dt').innerText, value: k.querySelector('dd .bn, .cash-amount')?.innerText, cap: k.querySelector('.cash-caption .cash-description')?.innerText ?? k.querySelector('.c').innerText,
      cashReason: k.querySelector('.cash-caption .cash-reason')?.innerText.trim(), muted: Boolean(k.querySelector('.cash-amount.muted')) });
    const say = document.querySelector('#heroL .say > span');
    return {
      header, boardOkElsewhere: /Board OK/.test(rest), strip: t('#healthPop .health-facts'), freshCheckins: [...document.querySelectorAll('.dcard .hb')].some(e => e.textContent.trim()),
      display: t('#heroL .display'), kpis: [...document.querySelectorAll('#heroL .kpi')].map(kpi),
      account: (() => { const cash = [...document.querySelectorAll('#acctHero [data-cash]')].find(__audit.visible);
        return { title: t('#acctTitle'), keep: t('#acctHero .acct-chip.keep'), value: t('#acctValue'), state: document.getElementById('acctValue').dataset.state,
          cash: cash ? { text: cash.innerText.replace(/\\s+/g, ' ').trim(), name: cash.getAttribute('aria-label'), state: cash.dataset.state, muted: Boolean(cash.querySelector('b.muted')) } : null }; })(),
      eyebrow: t('#desksEyebrow'), scope: t('#heroL .desk-scope'),
      say: { text: say.innerText, lines: Math.round(say.scrollHeight / parseFloat(getComputedStyle(say).lineHeight)) },
      market: { title: t('#heroSession .mkt-t'), sub: t('#heroSession .mkt-s'), ny: t('#heroSession .mkt-ny'), bar: document.querySelector('#heroSession .daybar')?.getAttribute('aria-label'),
        slot: document.getElementById('sessSlot').getBoundingClientRect().height, line: Boolean(document.querySelector('#heroChart > svg')) },
      heroLayout: (() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        return { hero: rect(document.getElementById('deskHero')), primary: rect(document.querySelector('.hero-primary')), right: rect(document.querySelector('.hero-r')), row: rect(document.querySelector('#heroL .kpis')),
          scope: rect(document.querySelector('#heroL .desk-scope')), slot: rect(document.getElementById('acctHero')), eyebrow: rect(document.getElementById('desksEyebrow')),
          figures: [...document.querySelectorAll('#heroL .kpi')].map(rect) };
      })(),
      primary: [...document.querySelectorAll('#heroL .primary')].map(k => ({ cell: k.dataset.cell, phase: k.dataset.phase, label: k.querySelector('.term').textContent, value: k.querySelector('.bn').innerText, pct: k.querySelector('.performance-pct')?.textContent,
        basis: k.querySelector('.pct-slot .basis')?.textContent, dot: Boolean(k.querySelector('.live-dot')), link: k.querySelector('.fig-link')?.getAttribute('href') ?? null,
        top: k.getBoundingClientRect().top, left: k.getBoundingClientRect().left, width: k.getBoundingClientRect().width, size: parseFloat(getComputedStyle(k.querySelector('.display')).fontSize) })),
      order: [...document.querySelectorAll('.dcard')].map(c => c.id.slice(5)),
      states: [...document.querySelectorAll('.dcard .state')].map(s => ({ icon: Boolean(s.querySelector('svg use')), text: s.innerText.trim() })),
      cards: [...document.querySelectorAll('.dcard')].map(c => ({ id: c.id.slice(5), layout: c.dataset.layout, go: c.querySelector('.card-go')?.getAttribute('href'), head: c.querySelector('.spark-h')?.innerText.trim(),
        why: c.querySelector('.bars-why')?.innerText.trim(), bars: c.querySelectorAll('.bars .b').length, box: c.querySelector('.bars')?.getBoundingClientRect().height })),
      plum: getComputedStyle(document.documentElement).getPropertyValue('--desk-j').trim(),
      positions: [...document.querySelectorAll('#positions .prow:not(.hd) .name b')].map(b => b.textContent),
      kept: [...document.querySelectorAll('#kept [data-keep]')].map(r => ({ sym: r.dataset.keep, label: /Kept\\s· not traded by any desk/.test(r.innerText), interactive: r.querySelectorAll('a, button, input, select, textarea, summary, details, label, [tabindex], [onclick], [role=button], [role=link], [title], [href]:not(use)').length,
        pointer: [r, ...r.querySelectorAll('*')].some(n => getComputedStyle(n).cursor === 'pointer'), hover: r.matches(':hover') })),
      keptCap: t('#kept .keep-cap'), keptState: t('#kept .pstate'), notJoe: document.body.innerText.includes('not traded by Joe'),
    }; })()`).then(copyText);
  check('AC-18', `${tag}: one live header control and no fresh card check-ins or visible status strip`, /Live/.test(d.header) && !d.boardOkElsewhere && !d.freshCheckins && !await page.evaluate(`Boolean(document.querySelector('#health, .hstrip, #footData'))`), d);
  // JOED-153: the desks' summary row is Open result and Desks' money; the
  // whole account (incl. kept holdings) and Cash are the whole-account block's,
  // which fills the slot above the hero (JOED-156).
  const held = snapshot.positions.rows.filter(r => r.scope === 'stage0' && r.desk && decimalUnits(r.quantity) !== 0n).length;
  const sinceCaption = copyText(await page.evaluate(`__audit.deskCaption(document.querySelector('[data-cell="hero.since"]'))`));
  check('AC-19', `${tag}: Today and Since start remain primary and name their session; the summary row and the whole-account block keep their captions`, Boolean(d.display) && d.primary.length === 2 &&
    d.primary.map(p => p.label).join() === 'Today · Wed 14 Oct · live,Since 10 Sep' && d.primary[0].phase === 'live' && d.primary[0].dot && !d.primary[1].dot &&
    d.kpis.map(k => k.dt).join() === 'Open result,Desks’ money' && d.kpis[0].cap === `${held} position${held === 1 ? '' : 's'} · changes until they close` && /^started with €\s15\.000 on 10\sSep$/.test(d.kpis[1].cap) &&
    d.account.title === (viewport.mobile ? 'Whole account' : 'IB paper account · whole account') && d.account.keep === 'incl. kept holdings' && Boolean(d.account.cash) &&
    sinceCaption === 'after fees, incl. open positions' && d.primary[1].basis === `of ${fmt.eur(STARTING_MONEY, false, 0)}` &&
    d.scope === 'Desk figures never include the kept holdings. The whole account, with them, is at the top.' && /^Desks J, Joe and Joel · their €\s15\.000 practice capital|^Desks · €\s15\.000 practice capital/.test(d.eyebrow), { primary: d.primary, kpis: d.kpis, account: d.account, sinceCaption, scope: d.scope, eyebrow: d.eyebrow });
  check('AC-19', `${tag}: unreported Cash is a muted dash with its reason beside it, in the whole account`, d.account.cash?.muted && d.account.cash.state === 'not reported' &&
    d.account.cash.text === 'Cash — · not reported · no data received yet' && d.account.cash.name === 'Cash no data received yet', d.account);
  const day = decimalUnits(snapshot.totals.dayPnl.amount), equity = decimalUnits(snapshot.totals.equity.amount), since = decimalUnits(snapshot.totals.totalPnl.amount);
  const percent = percentText;
  check('AC-19', `${tag}: primary euros and percentages use the exact start-of-day and since-start bases, and Today names its base`, d.primary[0].value.replace(/\s/g, '') === fmt.eur(day, true).replace(/\s/g, '') && d.primary[1].value.replace(/\s/g, '') === fmt.eur(since, true).replace(/\s/g, '') &&
    d.primary[0].pct === percent(day, equity - day) && d.primary[1].pct === percent(since, decimalUnits('15000')) && copyText(d.primary[0].basis) === copyText(`of ${fmt.eur(equity - day)}`), d.primary);
  check('M6', `${tag}: the primary figures open Results for their day and for all time`, d.primary[0].link === '#results?period=day&date=2026-10-14&desk=all' && d.primary[1].link === '#results?period=all&date=2026-10-14&desk=all' &&
    await page.evaluate(`document.querySelector('[data-cell="hero.equity"] .fig-link')?.getAttribute('href') === '#history?range=week&mode=money'`), d.primary);
  const layout = d.heroLayout, close = (a, b) => Math.abs(a - b) <= 0.5;
  const desksTop = await page.evaluate(`document.getElementById('desks').getBoundingClientRect().bottom`);
  const supportingLayout = viewport.mobile
    ? layout.primary.bottom <= layout.row.top && layout.row.bottom <= layout.right.top && layout.figures[1].top > layout.figures[0].top && layout.row.top > desksTop
    : layout.slot.bottom <= layout.eyebrow.top && layout.eyebrow.bottom <= layout.hero.top && close(layout.row.left, layout.primary.left) && layout.scope.top >= layout.row.bottom - 0.5 && close(layout.hero.bottom, layout.scope.bottom) &&
      close(layout.figures[0].top, layout.figures[1].top) && (viewport.name === '1440'
        ? close(layout.primary.top, layout.right.top) && layout.primary.right < layout.right.left && layout.row.top >= Math.max(layout.primary.bottom, layout.right.bottom) - 0.5 && close(layout.row.right, layout.right.right)
        : layout.right.top >= layout.primary.bottom - 0.5 && layout.row.top >= layout.right.bottom - 0.5 && close(layout.row.right, layout.primary.right));
  check('AC-19', `${tag}: the whole account (the slot), the eyebrow, then the hero; Today larger beside Since; the market block beside the figures at 1440 and under them at 1024; Open result and Desks’ money in one row across the hero, then the kept-holdings line (stacked on phones, below Desks)`,
    d.primary[0].top === d.primary[1].top && d.primary[0].left + d.primary[0].width <= d.primary[1].left && d.primary[0].size > d.primary[1].size && supportingLayout, { primary: d.primary, layout });
  check('P1-2', `${tag}: the sentence is the per-desk breakdown in sign colours, one line${viewport.mobile ? ' with its ellipsis on phones' : ' at ≥ 820 px'}`,
    /^J ([+−]€\s[\d.]+,\d\d|flat) · Joe ([+−]€\s[\d.]+,\d\d|flat) · Joel ([+−]€\s[\d.]+,\d\d|flat)$/.test(copyText(d.say.text)) && d.say.lines === 1 &&
    await page.evaluate(`[...document.querySelectorAll('#heroL .say .num')].every(n => /\\b(gain|loss)\\b/.test(n.className))`), d.say);
  check('M3', `${tag}: the market block is the linear New York day with now, the session and New York's own time; the session line keeps its room while live`,
    /^New York market\s*open\s*closes 22:00 · 2\sh\s17\smin left$/.test(d.market.title) && /^Regular session 15:30–22:00 Vienna$/.test(d.market.sub) && /^New York 13:42 · 6\sh behind$/.test(d.market.ny) &&
    /New York day begins at 06:00, regular session 15:30 to 22:00; now 19:42$/.test(d.market.bar ?? '') && close(d.market.slot, 46) && d.market.line, d.market);
  const ranked = snapshot.desks.map((desk, i) => ({ id: desk.id, i, result: decimalUnits(desk.money.totalPnl.amount) })).sort((a, b) => a.result === b.result ? a.i - b.i : a.result > b.result ? -1 : 1).map(desk => desk.id);
  check('AC-20', `${tag}: desks rank by exact since-start result, with no unsupported per-desk percentages`, d.order.join() === ranked.join() && await page.evaluate(`!document.querySelector('.dcard .performance-pct')`), { actual: d.order, expected: ranked });
  check('AC-20', `${tag}: desk state is icon + word, then what the desk holds`, d.states.length === 3 && d.states.every(s => s.icon && /^(Working|Sitting out|Stuck)/.test(s.text)), d.states);
  // No closed-trade record in this scenario: the last sessions say why once, in
  // their own fixed box, and no desk is shown as one row (unknown is never none).
  check('M4', `${tag}: without Results each card's last sessions say why once, in the bars' own box; one Results link per card`, d.cards.length === 3 && d.cards.every(c => c.layout === 'card' && !c.bars &&
    c.why === 'Results unavailable · no data received yet' && c.head === 'Last sessions · each session’s result in €, after fees' && close(c.box, 76) && c.go === `#results?period=week&date=2026-10-14&desk=${c.id}`), d.cards);
  check('M4', `${tag}: J's identity colour is plum`, d.plum === (theme === 'dark' ? '#c0a2e8' : '#7b51a8'), d.plum);
  const worth = await page.evaluate(`__audit.bars('.vbar i[data-v]')`);
  check('AC-42', `${tag}: worth bars proportional within each currency`, viewport.mobile || (worth.length >= 2 && !proportional(worth, 'worth')), worth);
  check('AC-7', `${tag}: kept symbols only under Kept holdings`, !d.positions.some(s => ['SXR8', 'TSLA'].includes(s)) && d.kept.map(k => k.sym).join() === 'SXR8,TSLA' && d.kept.every(k => k.label) && !d.notJoe, { positions: d.positions, kept: d.kept });
  check('AC-8', `${tag}: kept rows are inert`, d.kept.every(k => k.interactive === 0 && !k.pointer), d.kept);
  // JOED-153: the paper account (with the kept holdings) is the whole-account block's value (JOED-156).
  check('AC-9', `${tag}: kept values counted only in the paper account`, keptOnlyInAccount(d), { cap: d.keptCap, state: d.keptState, equity: d.kpis[1]?.value, account: d.account?.value });

  // Details popover: opaque, anchored, closes on Escape, moves nothing.
  const before = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  await page.evaluate(`document.getElementById('hdrHealth').click()`);
  await settle(page);
  const pop = await page.evaluate(`({ ...__audit.opaque(document.getElementById('healthPop')), text: document.getElementById('healthPop').innerText })`);
  check('AC-41', `${tag}: health details are opaque`, pop.bgAlpha === 1 && pop.opacity === 1 && pop.visible === 'visible', pop);
  check('AC-18', `${tag}: details use today's copy`, /Numbers up to date/.test(pop.text) && /If a light turns yellow or red: reload once/.test(pop.text), pop.text.slice(0, 200));
  if (viewport.name !== '390' || theme === 'light') await shot(page, viewport, `${viewport.name}-${theme}-desk-details`, 'Desk with the health details open');
  const during = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  check('AC-18', `${tag}: opening the details moves nothing`, !shifted(before, during).length, shifted(before, during).slice(0, 4));
  await everyTerm(page, viewport, `${tag} Details`, '#healthPop');
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await settle(page);
  check('AC-33', `${tag}: Escape closes the details and keeps focus`, await page.evaluate(`!document.getElementById('healthPop').classList.contains('on') && document.activeElement?.id === 'hdrHealth'`));
  // The details dialog by keyboard: Enter moves focus in, Tab stays inside,
  // Escape closes and focus returns to Details.
  await page.evaluate(`document.getElementById('hdrHealth').focus()`);
  await key(page, 'Enter');
  await settle(page);
  const opened = await page.evaluate(`({ on: document.getElementById('healthPop').classList.contains('on'), active: document.activeElement?.id, modal: document.getElementById('healthPop').getAttribute('aria-modal'), expanded: document.getElementById('hdrHealth').getAttribute('aria-expanded') })`);
  const inside = [];
  for (const shift of [false, false, false, true, true]) {
    await key(page, 'Tab', shift ? 8 : 0);
    inside.push(await page.evaluate(`document.getElementById('healthPop').contains(document.activeElement) ? (document.activeElement.id || document.activeElement.textContent.trim().slice(0, 20)) : 'OUT:' + (document.activeElement?.id || document.activeElement?.tagName)`));
  }
  await key(page, 'Escape');
  await settle(page);
  // A focused term tip consumes Escape before the dialog does.
  if (await page.evaluate(`document.getElementById('healthPop').classList.contains('on')`)) await key(page, 'Escape');
  const closed = await page.evaluate(`({ on: document.getElementById('healthPop').classList.contains('on'), active: document.activeElement?.id, expanded: document.getElementById('hdrHealth').getAttribute('aria-expanded') })`);
  check('AC-33', `${tag}: the details dialog takes focus, keeps Tab inside, and Escape returns focus`, opened.on && opened.active === 'healthPop' && opened.modal === 'true' && opened.expanded === 'true' &&
    inside.every(x => !x.startsWith('OUT:')) && !closed.on && closed.active === 'hdrHealth' && closed.expanded === 'false', { opened, inside, closed });

  // Terms: hover or focus shows the tip, a click pins it, Escape closes it.
  const anchor = await page.evaluate(`(() => { const t = [...document.querySelectorAll('#heroL .term')].find(__audit.visible); t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: t.textContent }; })()`);
  await settle(page);
  if (!viewport.mobile) {
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: anchor.x, y: anchor.y });
    await settle(page);
    const hover = await page.evaluate(`({ on: document.getElementById('tip').classList.contains('on'), text: document.getElementById('tip').innerText, ...__audit.opaque(document.getElementById('tip')) })`);
    check('AC-39', `${tag}: hover shows the explanation`, hover.on && /Also called: /.test(hover.text), hover);
    check('AC-41', `${tag}: the tip is opaque`, hover.bgAlpha === 1 && hover.opacity === 1, hover);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await settle(page);
  }
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: anchor.x, y: anchor.y, button: 'left', clickCount: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: anchor.x, y: anchor.y, button: 'left', clickCount: 1 });
  await settle(page);
  const pinned = await page.evaluate(`({ pinned: document.getElementById('tip').classList.contains('pinned'), on: document.getElementById('tip').classList.contains('on') })`);
  check('AC-39', `${tag}: a click or tap pins the tip`, pinned.on && pinned.pinned, pinned);
  if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-desk-term`, 'Desk with a term explanation pinned');
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await settle(page);
  check('AC-39', `${tag}: Escape closes the tip and keeps focus on the term`, await page.evaluate(`!document.getElementById('tip').classList.contains('on') && document.activeElement?.classList.contains('term')`));
  await page.evaluate(`(() => { const t = [...document.querySelectorAll('#desks .term')].find(__audit.visible); t.focus(); })()`);
  await settle(page);
  check('AC-39', `${tag}: keyboard focus shows the explanation`, await page.evaluate(`document.getElementById('tip').classList.contains('on') && document.activeElement.getAttribute('aria-expanded') === 'true'`));
  await page.evaluate('document.activeElement.blur(); window.scrollTo(0, 0)');
  await settle(page);
  await everyTerm(page, viewport, tag);

  // Today's sentence: a click or tap shows it whole in the explanation tip;
  // Escape closes it and keeps focus on the sentence.
  const said = await clickSay(page);
  check('clamp', `${tag}: a click or tap on Today's sentence shows it whole in the tip`, sayWhole(said), said);
  await key(page, 'Escape');
  await settle(page);
  check('clamp', `${tag}: Escape closes the sentence's tip and keeps focus`, await page.evaluate(`!document.getElementById('tip').classList.contains('on') && document.activeElement?.dataset.say === 'today' && document.activeElement.getAttribute('aria-expanded') === 'false'`));
  await leaveSay(page);

  // The taller, stacked hero can put the chart below a tablet's viewport.
  // Hover the chart itself after scrolling it into view, as a user would.
  if (!viewport.mobile) {
    await page.evaluate(`document.querySelector('#heroChart > svg').scrollIntoView({ block: 'center' })`);
    await settle(page);
    const box = await page.evaluate(`(() => { const r = document.querySelector('#heroChart > svg').getBoundingClientRect(); return { x: r.left + r.width * 0.35, y: r.top + r.height / 2 }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await settle(page);
    const ctip = await page.evaluate(`(() => { const t = document.querySelector('#heroChart .ctip'); return { on: t.classList.contains('on'), ...__audit.opaque(t), text: t.innerText }; })()`);
    check('AC-41', `${tag}: the chart tip is opaque`, ctip.on && ctip.bgAlpha === 1 && ctip.opacity === 1 && ctip.visible === 'visible' && Boolean(ctip.text.trim()), ctip);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await page.evaluate('window.scrollTo(0, 0)');
    await settle(page);
  }

  // Theme switch: the button sets data-theme, saves it, and moves nothing.
  const pre = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  await page.evaluate(`document.getElementById('themeBtn').click()`);
  await settle(page);
  const after = await page.evaluate(`({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('joe-board-theme-v1'), label: document.getElementById('themeBtn').getAttribute('aria-label') })`);
  const flipped = theme === 'light' ? 'dark' : 'light';
  check('AC-31', `${tag}: the theme button sets data-theme and remembers it`, after.theme === flipped && after.stored === flipped && after.label === `Switch to ${theme} theme`, after);
  const post = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  check('AC-31', `${tag}: switching theme moves nothing`, !shifted(pre, post).length, shifted(pre, post).slice(0, 4));
  await page.evaluate(`localStorage.removeItem('joe-board-theme-v1'); delete document.documentElement.dataset.theme; window.__joedesk.setTheme('system')`);
  await settle(page);
}

// Today's sentence clicked (a tap on phones), and what the tip then shows.
const SAY_TIP = `(() => { const tip = document.getElementById('tip'), say = document.querySelector('#heroL .say'), n = t => t.replace(/\\s+/g, ' ').trim();
  return { on: tip.classList.contains('on'), pinned: tip.classList.contains('pinned'), head: tip.querySelector('b')?.textContent, tip: n(tip.innerText), say: n(say.innerText), expanded: say.getAttribute('aria-expanded'),
    clamped: say.firstElementChild.scrollHeight > say.firstElementChild.clientHeight + 0.5 }; })()`;
async function clickSay(page) {
  const p = await page.evaluate(`(() => { const s = document.querySelector('#heroL .say'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }; })()`);
  await settle(page);
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await settle(page);
  return page.evaluate(SAY_TIP);
}
// Focus and the pointer leave the sentence, so no later check sees a hover.
async function leaveSay(page) {
  await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await settle(page);
}
const sayWhole = t => t.on && t.pinned && t.head === 'Today' && t.expanded === 'true' && t.say.length > 10 && t.tip === `Today ${t.say}`;

async function key(page, name, modifiers = 0) {
  const code = { Enter: 13, Tab: 9, Escape: 27, ArrowRight: 39 }[name];
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}

// AC-39 on every visible term, not a sample: keyboard focus shows its own
// explanation; on desktop, hovering does too.
async function everyTerm(page, viewport, tag, scope = '') {
  // Programmatic activeElement changes in an unfocused headless page need
  // not dispatch native focus events. Give this keyboard test page focus.
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  const focused = await page.evaluate(`(${focusTermTips.toString()})(${JSON.stringify(scope)},
    ${JSON.stringify(Object.fromEntries(Object.entries(TERMS).map(([key, entry]) => [key, entry[0]])))})`);
  const badFocus = focused.filter(f => f.failed.length);
  check('AC-39', `${tag}: all ${focused.length} terms explain themselves on keyboard focus`, focused.length > 0 && !badFocus.length,
    { failed: focused.length ? badFocus.slice(0, 4) : ['no visible terms'], count: focused.length });
  if (viewport.mobile) return;
  const count = await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${scope} [data-term]`)})].filter(__audit.visible).length`);
  const badHover = [];
  for (let i = 0; i < count; i++) {
    const box = await page.evaluate(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(`${scope} [data-term]`)})].filter(__audit.visible)[${i}]; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, term: t.dataset.term }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    const tip = await page.evaluate(`({ on: document.getElementById('tip').classList.contains('on'), head: document.getElementById('tip').querySelector('b')?.textContent })`);
    const failed = [!tip.on && 'tipOpen', tip.head !== TERMS[box.term][0] && 'ownHead'].filter(Boolean);
    if (failed.length) badHover.push({ failed, ...box, ...tip, expectedHead: TERMS[box.term][0] });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  }
  await page.evaluate('window.scrollTo(0, 0)');
  await settle(page);
  check('AC-39', `${tag}: all ${count} terms explain themselves on hover`, count > 0 && !badHover.length, { failed: count ? badHover.slice(0, 4) : ['no visible terms'], count });
}

async function focusChecks(page, tag) {
  await page.evaluate('window.scrollTo(0, 0); document.activeElement?.blur()');
  const misses = [];
  for (let i = 0; i < 36; i++) {
    await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const f = await page.evaluate(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { el: e.className || e.tagName, ring: e.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; })()`);
    if (f && !f.ring) misses.push(f.el);
  }
  check('AC-33', `${tag}: focus is visible on every control`, !misses.length, misses.slice(0, 5));
  await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
}

async function historyChecks(page, viewport, theme) {
  const tag = `${viewport.name} ${theme} history`;
  for (const range of ['1d', '1w', '1m', 'all']) {
    await page.evaluate(`document.querySelector('#histRange [data-range="${range}"]').click()`);
    await settle(page);
    const c = await page.evaluate(`(() => { const s = document.querySelector('#histChart > svg'); return { base: Number(s.dataset.base), lo: Number(s.dataset.ylo), hi: Number(s.dataset.yhi), est: s.querySelectorAll('[data-estimate]').length, gaps: s.querySelectorAll('[data-gap]').length, lines: s.querySelectorAll('path[stroke^="var(--desk-"]').length }; })()`);
    check('AC-21', `${tag} ${range}: y span ≥ 1 % of the first visible money`, c.hi - c.lo >= c.base * 0.01 - 1e-6 && c.base > 14000 / 3 && c.lines >= 3, c);
    if (range === '1w') check('AC-21', `${tag}: the outage is drawn as a dashed estimate over one hatched no-data band`, c.est >= 3 && c.gaps >= 1, c);
  }
  await page.evaluate(`document.querySelector('#histRange [data-range="1w"]').click()`);
  await settle(page);
  const parts = await page.evaluate(`({ compare: document.getElementById('histCompare').innerText, j: document.getElementById('jAcct').innerText, capt: Boolean(document.querySelector('#jAcct svg.capt')), events: document.querySelectorAll('#events li').length, legend: document.getElementById('histLegend').innerText })`);
  // History opens in Change (JOED-154): the comparison is each desk's change in euros.
  check('AC-21', `${tag}: compare, J's bookkeeping, captured results and desk changes`, /^Change (from|in the last) .*: J [+−]?€\s?\d/.test(parts.compare) && /Counted from/.test(parts.j) && parts.capt && parts.events >= 1 && /Estimated gap/.test(parts.legend), parts);
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  // The legend's last term is the final tab stop before the chart.
  await page.evaluate(`Array.from(document.querySelectorAll('#histLegend [data-term]')).at(-1).focus()`);
  await key(page, 'Tab');
  const firstAnnouncement = await page.evaluate(`document.getElementById('histLive').textContent`);
  await key(page, 'ArrowRight');
  await settle(page);
  const inspection = await page.evaluate(`(() => {
    const chart = document.getElementById('histChart'), tip = document.getElementById('histTip'), live = document.getElementById('histLive');
    return { focused: document.activeElement === chart, stops: chart.querySelectorAll('[tabindex="0"]').length,
      name: chart.getAttribute('aria-label'), description: chart.getAttribute('aria-describedby').split(/\\s+/).map(id => document.getElementById(id)?.textContent).join(' '),
      polite: live.getAttribute('aria-live'), atomic: live.getAttribute('aria-atomic'), on: tip.classList.contains('on'),
      visible: tip.innerText, announced: live.textContent };
  })()`);
  const normalizeInspection = text => text.replace(/\s+/g, ' ').trim();
  check('JOED-121', `${tag}: Tab reaches the chart and Right exposes identical visible and politely announced history values`,
    inspection.focused && inspection.stops === 0 && /^Each desk’s change since the start of the window/.test(inspection.name) && /Left and Right/.test(inspection.description) &&
    inspection.polite === 'polite' && inspection.atomic === 'true' && inspection.on && inspection.announced !== firstAnnouncement && /Vienna time/.test(inspection.announced) &&
    ['J', 'Joe', 'Joel'].every(desk => new RegExp(desk + ' .*?(observed|estimated|no value here)').test(inspection.announced)) &&
    normalizeInspection(inspection.visible) === normalizeInspection(inspection.announced), inspection);
  await key(page, 'Escape');
  await page.evaluate('document.activeElement?.blur()');
  await historyControlChecks({ page, viewport, theme, check, settle, configure, rects, moves });
  await historyDesignChecks({ page, viewport, theme, check, settle, rects, moves });
  if (!viewport.mobile) {
    const box = await page.evaluate(`(() => { const r = document.querySelector('#histChart').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height / 2 }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -240, modifiers: 2 });
    await settle(page);
    const zoomed = await page.evaluate(`({ label: document.querySelector('#histChart > svg').getAttribute('aria-label'), span: Number(document.querySelector('#histChart > svg').dataset.yhi) - Number(document.querySelector('#histChart > svg').dataset.ylo), base: Number(document.querySelector('#histChart > svg').dataset.base) })`);
    check('AC-21', `${tag}: Ctrl-wheel zoom on desktop keeps the scale honest`, /zoomed/.test(zoomed.label) && zoomed.span >= zoomed.base * 0.01 - 1e-6, zoomed);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await settle(page);
    const tip = await page.evaluate(`(() => { const t = document.getElementById('histTip'); return { on: t.classList.contains('on'), ...__audit.opaque(t), text: t.innerText }; })()`);
    check('AC-41', `${tag}: the history tip is opaque`, tip.on && tip.bgAlpha === 1 && tip.opacity === 1, tip);
    if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-history-zoomed`, 'History zoomed with the crosshair tip');
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
    await settle(page);
    check('AC-21', `${tag}: Fit all returns to everything kept`, await page.evaluate(`document.querySelector('#histRange [data-range="all"]').getAttribute('aria-pressed') === 'true' && !/zoomed/.test(document.querySelector('#histChart > svg').getAttribute('aria-label'))`));
    await page.evaluate(`document.querySelector('#histRange [data-range="1w"]').click()`);
    await settle(page);
  }
}

async function resultsChecks(page, viewport, theme) {
  const tag = `${viewport.name} ${theme} results`;
  const sel = ['#rhero', '.tile', '.brow', '.calcard', '.cell', '#daypanel', '.res-tools'];
  const before = await page.evaluate(`__audit.rects(${JSON.stringify(sel)})`);
  const r = await page.evaluate(`({ hero: document.getElementById('rheroL').innerText, tiles: [...document.querySelectorAll('.tile .tval')].map(t => t.innerText.trim()), label: document.getElementById('perLabel').innerText, rows: document.querySelectorAll('#cal .cell').length + document.querySelectorAll('#cal .cell.out').length })`);
  check('P4-notreceived', `${tag}: before the first push Results shows its unavailable state with dashes, no zeros`, /Results are unavailable: no data received yet\./.test(r.hero) && r.tiles.length === 8 && r.tiles.every(t => t === '—') && !/€ 0,00/.test(r.hero), r);
  await page.evaluate(`document.querySelector('#periodSeg [data-period="month"]').click()`);
  await settle(page);
  await page.evaluate(`document.querySelector('#deskSeg [data-desk="joe"]').click()`);
  await settle(page);
  const after = await page.evaluate(`__audit.rects(${JSON.stringify(sel)})`);
  const label = await page.evaluate(`document.getElementById('perLabel').innerText`);
  check('P4-notreceived', `${tag}: period and desk switches work and move nothing`, label.startsWith('This month') && !shifted(before, after).length, { label, moved: shifted(before, after).slice(0, 4) });
  await page.evaluate(`document.querySelector('#periodSeg [data-period="week"]').click(); document.querySelector('#deskSeg [data-desk="all"]').click()`);
  await settle(page);
}

// JOED_P3_ONLY=journey,cold runs only those sections (local iteration); the
// gate itself always runs everything.
const ONLY = (process.env.JOED_P3_ONLY ?? '').split(',').filter(Boolean);
const run = name => {
  const selected = !ONLY.length || ONLY.includes(name);
  if (selected) timing.enter(name);
  return selected;
};

const browser = await launch({ hostRules: 'MAP joedesk.example.test 127.0.0.1' });
// The performance reference: this browser build on this machine, recorded with every trace.
const engine = await browser.send('Browser.getVersion');
const reference = `${engine.product} (headless, ${process.platform} ${process.arch}), ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, Node ${process.version}`;
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: AUDIT });
let board = null, current = null, budgetTrace = null;
const deferredLight = [];
const boards = [];
async function newBoard(options) { const b = await startBoard(options); boards.push(b); return b; }
const rects = selectors => page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
// Answer chosen reads of the page and of its worker without the server: a
// fixed status and body with no clock header, a failed connection, a redirect;
// or let them reach the server late, as on a slower machine.
async function route(rules) {
  const handler = m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    const rule = rules.find(r => m.params.request.url.includes(r.path));
    const id = { requestId: m.params.requestId };
    if (!rule) { browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}); return; }
    if (rule.delay) { setTimeout(() => browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}), rule.delay); return; }
    if (rule.fail) { browser.send('Fetch.failRequest', { ...id, errorReason: rule.fail }, m.sessionId).catch(() => {}); return; }
    browser.send('Fetch.fulfillRequest', { ...id, responseCode: rule.status, responseHeaders: rule.headers ?? [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(rule.body ?? '').toString('base64') }, m.sessionId).catch(() => {});
  };
  browser.on(handler);
  await page.setFetch(rules.map(r => ({ urlPattern: `*${r.path}*` })));
  return async () => { await page.setFetch(null); browser.off(handler); };
}
// The two state lines that clamp, and the wide font that stands in for Linux's.
const STATE_BOXES = ['#statusAlert', '#hdrHealth', '#heroL .say'];
const DESK_SHIFT = [...SHIFT_SELECTORS, '#hdrHealth', '#heroL .say', '#heroL .kpi .c', '#positions .pstate', '#kept .keep-cap', '#kept .pstate', '#kept .prow'];
const HIST_SHIFT = ['.hist-tools', '.hcard', '#histChart', '#histCompare', '#histMini', '.hist-help', '.hist-cols', '#jAcct', '#jAcct .facts-dl', '#events', 'footer.foot'];
// Copy assertions treat phone NBSP-dot and desktop space-dot as the same
// words. P6 separately asserts the actual nonbreaking DOM characters.
const copyExpression = expression => `(${copyText.toString()})(${expression})`;
const DESK_TEXT = copyExpression(`(() => ({
  label: document.querySelector('#hdrHealth .status-full').textContent, market: document.querySelector('#heroSession .mkt-t')?.innerText, marketSub: document.querySelector('#heroSession .mkt-s')?.innerText ?? '',
  cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(c => [c.dataset.cell, { state: c.dataset.state, cap: __audit.deskCaption(c) }])),
  account: { state: document.getElementById('acctValue')?.dataset.state ?? null, value: document.getElementById('acctValue')?.innerText.trim() ?? '', line: document.querySelector('#acctChange [data-clamp]')?.innerText ?? null },
  cards: [...document.querySelectorAll('.dcard')].map(c => ({ id: c.id.slice(5), lines: [...c.querySelectorAll('.card-status .st')].map(n => n.innerText), label: c.querySelector('.spark-h')?.innerText ?? '', status: c.querySelector('.card-status')?.innerText ?? '', nums: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), icons: c.querySelectorAll('.cell-state').length })),
  boardCaption: document.querySelector('#heroL .board-caption').innerText,
  positions: document.querySelector('#positions .pstate')?.innerText, posState: document.querySelector('#positions .pstate')?.dataset.state,
  kept: document.querySelector('#kept .pstate')?.innerText, keptState: document.querySelector('#kept .pstate')?.dataset.state,
  strip: document.querySelector('#healthPop .health-facts').textContent, alert: document.getElementById('statusAlertText').textContent, foot: document.querySelector('footer.foot').innerText, say: document.querySelector('#heroL .say').innerText,
}))()`);
const HIST_TEXT = copyExpression(`(() => ({ status: document.querySelector('#histStatus .st')?.innerText.trim() ?? '', state: document.querySelector('#histStatus .hist-state')?.dataset.state ?? 'fresh',
  retry: Boolean(document.getElementById('histRetry')), j: document.querySelector('#jAcct .facts-dl')?.innerText ?? '', lines: document.querySelectorAll('#histChart > svg path[stroke^="var(--desk-"]').length,
  estimates: document.querySelectorAll('#histChart > svg [data-estimate]').length, chart: document.querySelector('#histChart > svg')?.getAttribute('aria-label') }))()`);
const RES_TEXT = copyExpression(`(() => ({ on: document.getElementById('scr-results').classList.contains('on'), hero: document.getElementById('rheroL').innerText,
  tiles: [...document.querySelectorAll('#tiles .tile .tval')].map(t => t.innerText.trim()), label: document.getElementById('perLabel').innerText, days: document.querySelectorAll('#cal [data-day]').length,
  rows: document.querySelectorAll('#breakdown .brow').length, curve: document.querySelector('#curve > svg')?.getAttribute('aria-label') ?? null, day: document.getElementById('daypanel').innerText }))()`);
// Results without a record because its own read failed: the reason, dashes, no zeros.
const unavailable = (r, words) => r.on && r.hero.includes(`Results are unavailable: ${words}.`) && !/€\s0,00/.test(r.hero) && r.tiles.length === 8 && r.tiles.every(t => t === '—') &&
  /^This week · /.test(r.label) && r.days >= 28 && r.rows === 4 && r.curve === 'Results are unavailable' && r.day.trim().endsWith(`${words}.`);
const norm = text => text?.replace(/\s+/g, ' ').trim();
const moves = (a, b) => shifted(a, b, ['top', 'left', 'height']);
try {
  if (run('phase-b')) {
    await phaseBChecks({ page, newBoard, check, shot, auditScreen });
    await deskRankingFocusChecks({ page, newBoard, check });
  }
  if (run('design')) {
  // 1 · The full design scenario at every viewport and theme.
  const { snapshot, history } = scenario(NOW);
  board = await newBoard({ history, accountHistory: accountScenario(NOW) });
  board.setNow(NOW);
  const pushed = await board.push(snapshot);
  if (pushed.status !== 200) throw new Error(`scenario push failed: ${JSON.stringify(pushed.body)}`);
  board.setNow(at(NOW, 9));
  for (const viewport of [VIEWPORTS[2], { ...VIEWPORTS[2], name: '360', width: 360 }]) for (const theme of THEMES) {
    await configure(page, viewport, theme);
    await load(page, board.url, 'desk', { details: false });
    await phoneFirstScreenChecks(page, viewport, theme, snapshot);
    await setDeskDisclosures(page, false);
    const selectors = ['header.top', '#statusAlert', '#acctHero', '.hero-primary', '.desk-row', '#accountSection', '.hero-r', '.desk-section', 'footer.foot'];
    const before = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
    await page.evaluate('window.__joedesk.refresh()'); await settle(page);
    const after = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
    check('phone-first', `${viewport.name} ${theme}: collapsed boxes have exactly 0 px shift on a refresh/tick`, JSON.stringify(before) === JSON.stringify(after), { before, after });
  }
  for (const viewport of VIEWPORTS) for (const theme of THEMES) {
    await configure(page, viewport, theme);
    await load(page, board.url, 'desk');
    // A second, changed snapshot gives the browser a desk change to record.
    for (const screen of ['desk', 'history', 'results', 'settings']) {
      await go(page, screen);
      if (screen === 'history') await historyChecks(page, viewport, theme);
      if (screen === 'results') await resultsChecks(page, viewport, theme);
      await auditScreen(page, viewport, theme, screen);
      await shot(page, viewport, `${viewport.name}-${theme}-${screen}`, `${screen[0].toUpperCase()}${screen.slice(1)}, design scenario`);
      if (screen === 'desk') await deskChecks(page, viewport, theme, snapshot);
      if (screen === 'desk') await accountHeroChecks({ page, viewport, theme, check, settle, rects, moves, snapshot, load, url: board.url });
    }
    if (viewport.name === '1440') { await go(page, 'desk'); await focusChecks(page, `${viewport.name} ${theme} desk`); }
    if (viewport.mobile) {
      await page.evaluate(`document.querySelector('.bottom-nav [data-go="history"]').click()`);
      await settle(page);
      check('AC-21', `${viewport.name} ${theme}: History is reachable on a phone`, await page.evaluate(`document.getElementById('scr-history').classList.contains('on') && __audit.visible(document.getElementById('histChart'))`));
    }
  }

  // 2 · A data update moves nothing, keeps keyboard focus and a pinned
  // explanation on their controls, and the browser records the desk change.
  let seq = snapshot.seq, step = 0;
  current = snapshot;
  const pushNext = async (viewport, theme) => {
    const when = at(NOW, 40 + 30 * step++);
    const next = advance(current, when, ++seq);
    next.desks[0].action = `Sold 5 Bank of America (BAC) at the exit rule; waiting for the next setup (check ${step}).`;
    next.positions.rows[0] = { ...next.positions.rows[0], mark: { amount: '47.1', currency: 'USD' }, marketValue: { amount: '235.5', currency: 'USD' }, updatedAt: at(when, -3) };
    board.setNow(when);
    const r = await board.push(next);
    check('AC-18', `${viewport.name} ${theme}: updated snapshot accepted`, r.status === 200, r.body);
    await page.evaluate('window.__joedesk.refresh()');
    await waitFor(page, `document.querySelector('#desk-j .now').innerText.includes('(check ${step})')`);
    await settle(page);
    current = next;
  };
  const tipState = `(() => { const tip = document.getElementById('tip'), a = document.querySelector('[data-term][aria-expanded="true"]'); const r = a?.getBoundingClientRect(), t = tip.getBoundingClientRect();
    return { on: tip.classList.contains('on'), pinned: tip.classList.contains('pinned'), term: a?.dataset.term, connected: Boolean(a?.isConnected), inHero: Boolean(a?.closest('#heroL')), near: r ? Math.abs(t.left - r.left) < 2 || Math.abs(t.right - r.right) < 2 : false, active: document.activeElement?.dataset?.term ?? document.activeElement?.id }; })()`;
  for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [VIEWPORTS[1], 'dark'], [VIEWPORTS[2], 'dark']]) {
    await configure(page, viewport, theme);
    await load(page, board.url, 'desk');
    const tag = `${viewport.name} ${theme}`;
    // load() opens Account's phone disclosure. Scroll before the baseline so
    // the pin click reaches its visible term below the expanded desk cards.
    await page.evaluate(`document.querySelector('#heroL .kpi .term').scrollIntoView({ block: 'center' })`);
    await settle(page);
    const before = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
    // A pinned explanation in the open Account survives the rebuild of Today.
    const term = await page.evaluate(`(() => { const t = document.querySelector('#heroL .kpi .term'); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, term: t.dataset.term }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: term.x, y: term.y, button: 'left', clickCount: 1 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: term.x, y: term.y, button: 'left', clickCount: 1 });
    await settle(page);
    const pinnedBefore = await page.evaluate(tipState);
    await pushNext(viewport, theme);
    const after = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
    const moved = shifted(before, after, ['top', 'left', 'height']);
    check('no-shift', `${tag}: a data update moves nothing (±0.5 px)`, !moved.length, moved.slice(0, 5));
    const pinnedAfter = await page.evaluate(tipState);
    check('AC-39', `${tag}: a pinned explanation stays pinned on its rebuilt term through a data update`, pinnedBefore.pinned && pinnedAfter.on && pinnedAfter.pinned &&
      pinnedAfter.term === term.term && pinnedAfter.connected && pinnedAfter.inHero && pinnedAfter.near, { pinnedBefore, pinnedAfter });
    await key(page, 'Escape');
    // The pointer leaves Today, so only keyboard focus decides the next tip.
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    // Keyboard focus on a desk card's term survives the rebuild of that card.
    await page.evaluate(`document.querySelector('#desk-j .dnums .term').focus()`);
    const focusedTerm = await page.evaluate(`document.activeElement.dataset.term`);
    await pushNext(viewport, theme);
    const focus = await page.evaluate(`({ term: document.activeElement?.dataset?.term, connected: document.activeElement?.isConnected, inCard: Boolean(document.activeElement?.closest('#desk-j')), tip: document.getElementById('tip').classList.contains('on') })`);
    check('AC-33', `${tag}: keyboard focus stays on its term when the card is rebuilt`, focus.term === focusedTerm && focus.connected && focus.inCard && focus.tip, focus);
    await page.evaluate('document.activeElement.blur()');
    // Focus inside the open details dialog survives a rebuild of the dialog.
    await page.evaluate(`document.getElementById('hdrHealth').focus()`);
    await key(page, 'Enter');
    await key(page, 'Tab');
    const inPop = await page.evaluate(`document.activeElement?.textContent.trim()`);
    await pushNext(viewport, theme);
    const still = await page.evaluate(`({ inside: document.getElementById('healthPop').contains(document.activeElement), text: document.activeElement?.textContent.trim(), open: document.getElementById('healthPop').classList.contains('on') })`);
    check('AC-33', `${tag}: focus inside the open details dialog survives a data update`, still.open && still.inside && still.text === inPop, { inPop, still });
    await key(page, 'Escape');
    await go(page, 'history');
    const events = await page.evaluate(`[...document.querySelectorAll('#events li')].map(li => li.innerText)`);
    check('AC-21', `${tag}: Desk changes records the new action`, events.some(e => e.startsWith('Sold 5 Bank of America')), events.slice(0, 2));
  }
  }

  // JOED-153 M4/A2: the design scenario with its Results record, live and
  // before the open: the bars against Results' Day figures, their labels,
  // tips and links, the dated hero and cards, and the craft audit with bars.
  if (run('sessions')) await deskSessionChecks({ page, newBoard, check, shot, auditScreen });

  if (run('fixtures')) {
  // 3 · P1 fixtures through the real server: fresh, stale with age, not
  // reported and broken with a reason, each panel on its own; no blank page.
  // The desk hero's money cells. The paper account is the whole-account block's
  // (JOED-156): its own state and change line are checked apart, below.
  const CELL = { 'hero.day': 'today.dayPnl', 'hero.open': 'today.openPnl', 'hero.since': 'today.totalPnl', 'hero.equity': 'today.equity' };
  const CASES = [
    ['e-layout-storage-unavailable', 'fresh', 'Board OK'], ['b-session-open-estimate', 'fresh', 'Board OK'], ['stale-receive-age', 'stale', 'Stale 1 min'],
    ['c-frozen-producer', 'stale', 'Stale 2 min'], ['missing-runtime-and-results', 'not reported', 'Board OK'], ['a-gateway-up-but-dead', 'broken', 'Needs fix'],
    ['a-missing-gateway', 'broken', 'Needs fix'], ['a-frozen-ready-gateway', 'broken', 'Needs fix'], ['b-incomplete-family', 'broken', 'Data delayed'],
    // Amy's A3: a Today the feed explains as not exact is not late in regular hours.
    ['b-equity-null-gateway-ready', 'broken', 'Data delayed'], ['b-weekend-no-sod', 'broken', 'Board OK'], ['j-ny-midnight-gap', 'broken', 'Board OK'],
    ['h-keep-policy-mismatch', 'broken', 'Needs fix'], ['c-old-producer-image', 'broken', 'Needs fix'], ['unknown-schema', 'broken', 'Needs fix'],
    ['a-dead-session-current-money', 'broken', 'Needs fix'], ['h-secondary-position-source', 'broken', 'Needs fix'], ['i-oversize-data', 'broken', 'Needs fix'],
    ['g-expired-sso', 'broken', 'Data delayed'], ['d-routing-stub', 'broken', 'Data delayed'],
    ['p3-single-missing-desk', 'broken', 'Data delayed'], ['p3-coupled-unavailable', 'broken', 'Data delayed'],
    ['p3-not-exact-yet', 'broken', 'Board OK'], ['p3-shared-not-exact', 'broken', 'Data delayed'],
    ['p3-mixed-not-exact-fault', 'broken', 'Data delayed'],
  ];
  // ADR deferred P3 rows, derived from valid.json; expected states come from
  // the shared selector followed by the board display policy.
  const DERIVED = { 'p3-single-missing-desk': singleMissingDesk, 'p3-coupled-unavailable': coupledUnavailable, ...heroWordingFixtures(valid.data) };
  const RETAINED_GRACE_CASES = new Set(['b-incomplete-family', 'b-equity-null-gateway-ready', 'p3-single-missing-desk', 'p3-coupled-unavailable']);
  const derive = id => {
    const f = DERIVED[id]();
    const feeds = { 'fleet-config': { value: valid['fleet-config'], receivedAt: valid.data.receivedAt }, data: acceptSnapshot('data', ingress(valid.data), null, valid.data.receivedAt) };
    const previous = panelStates(feeds, valid.data.receivedAt);
    feeds.data = acceptSnapshot('data', f.payload, feeds.data, f.receivedAt);
    return { ...f, id, expectedStatus: 200, expected: boardStates(feeds, f.now, previous) };
  };
  const STORAGE_OFF = `Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage unavailable'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage unavailable'); } });
    Object.defineProperty(window, 'GridStack', { get() { throw new Error('no layout manager'); } });`;
  for (const [id, kind, label] of CASES) {
    const f = DERIVED[id] ? derive(id) : fixture(id);
    const expectedFeeds = { 'fleet-config': { value: f.fleetConfig ?? valid['fleet-config'], receivedAt: valid.data.receivedAt },
      data: acceptSnapshot('data', ingress(valid.data), null, valid.data.receivedAt) };
    const previousStates = panelStates(expectedFeeds, valid.data.receivedAt);
    if (f.transportReason) expectedFeeds.data = { ...expectedFeeds.data, reason: f.transportReason };
    else if (f.feed === 'data') expectedFeeds.data = acceptSnapshot('data', f.payload, expectedFeeds.data, f.receivedAt);
    // Stored fixture expectations omit values. Health needs the selector's
    // real money and halt values, including retention from the prior snapshot.
    // A failed read has no new state response: the browser keeps its last
    // state clock. Advancing the fixture server does not age that browser by
    // ten minutes when the transport failure cannot deliver its new clock.
    const expectedNow = f.transportReason ? valid.data.receivedAt : f.now;
    const expectedCells = boardStates(expectedFeeds, expectedNow, previousStates);
    const expectedContext = { states: expectedCells, feeds: expectedFeeds, now: expectedNow };
    const expectedStatus = statusPresentation(expectedContext);
    if (RETAINED_GRACE_CASES.has(id)) check('fixtures', `${id}: withheld totals preserve the yellow retained-value grace`,
      expectedStatus.tone === 'yellow' && expectedStatus.reason === 'retained_values' && expectedStatus.label === label, expectedStatus);
    const boardCaption = boardCaptionCell(expectedContext);
    const b = await newBoard({ fleetConfig: f.fleetConfig ?? null });
    b.setNow(valid.data.receivedAt);
    await b.push(ingress(valid.data));
    if (!f.transportReason && f.feed === 'data') { b.setNow(f.receivedAt); const r = await b.push(f.payload, 'data', { status: f.expectedStatus, reason: f.expectedStatus === 200 ? null : f.expected['today.equity'].reason }); check('fixtures', `${id}: server status ${f.expectedStatus}`, r.status === f.expectedStatus, r.body); }
    const viewports = ['e-layout-storage-unavailable', 'a-gateway-up-but-dead'].includes(id) ? VIEWPORTS : [VIEWPORTS[1]];
    for (const viewport of viewports) {
      const theme = viewport.mobile ? 'dark' : 'light';
      await configure(page, viewport, theme);
      let storageScript = null, unroute = null;
      if (id === 'e-layout-storage-unavailable') storageScript = (await page.s('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_OFF })).identifier;
      b.setNow(f.transportReason ? valid.data.receivedAt : f.now);
      await load(page, b.url, 'desk');
      if (f.transportReason) {
        b.setNow(f.now);
        if (f.transportReason === 'auth_required') await page.setHeaders({});
        if (f.transportReason === 'route_not_found') unroute = await route([{ path: 'state.json', status: 404, body: '{"ok":false,"error":"not found"}' }]);
        await page.evaluate('window.__joedesk.refresh()');
        await settle(page);
      }
      if (viewport.width <= 480) {
        await setDeskDisclosures(page, false);
        const collapsed = await phoneDeskSnapshot(page).then(copyText);
        const summaryCells = {
          account: [['Open result', expectedCells['today.openPnl']], ['Desks’ money', expectedCells['today.equity']]],
          positions: [['Positions', expectedCells.positions], ...rowProblems(expectedCells.positions)],
          kept: [['Kept holdings', expectedCells.kept], ...rowProblems(expectedCells.kept)],
        };
        for (const [key, cells] of Object.entries(summaryCells)) {
          const expected = disclosureProblem(cells), actual = collapsed.controls.find(c => c.key === key);
          check('phone-first', `${viewport.name} ${theme} ${id}: collapsed ${key} shows the worst panel state and short reason`, actual.hidden && actual.expanded === 'false' &&
            (expected ? actual.warning === expected.text && actual.icon === `#i-${expected.icon}` : !actual.warning && !actual.icon), { actual, expected });
        }
        if (id === 'a-gateway-up-but-dead') {
          const warnings = collapsed.controls.filter(c => ['account', 'positions', 'kept', 'j', 'joe', 'joel'].includes(c.key));
          check('fixtures', `${viewport.name} ${theme}: every collapsed outage section retains its icon and one broker-down reason in both short and accessible copy`, warnings.length === 6 &&
            warnings.every(c => c.icon && (c.warning.match(/broker connection down/g) ?? []).length === 1 && (c.detail.match(/broker connection down/g) ?? []).length === 1), warnings);
          // The whole account above stays open on a phone and says the outage once, in its change line; Cash only "not reported".
          check('fixtures', `${viewport.name} ${theme}: the open whole account states the broker-down reason once, Cash without repeating it`,
            (collapsed.account?.line?.match(/broker connection down/g) ?? []).length === 1 && collapsed.account.cash?.text === 'Cash — · not reported' &&
            collapsed.account.cash.name === 'Cash broker connection down', collapsed.account);
        }
        check('phone-first', `${viewport.name} ${theme} ${id}: collapsed panels do not scroll horizontally`, collapsed.horizontal.scroll <= collapsed.horizontal.inner, collapsed.horizontal);
        await setDeskDisclosures(page, true);
      }
      const ui = await page.evaluate(`(() => ({
        label: document.querySelector('#hdrHealth').dataset.reason, sentence: document.querySelector('#hdrHealth').title,
        compact: (() => { const e = document.querySelector('#hdrHealth .status-compact'); return __audit.visible(e) ? e.textContent : null; })(),
        visibleSentence: (() => { const full = document.querySelector('#hdrHealth .status-full'), line = document.getElementById('statusAlertText');
          return [full, line].filter(__audit.visible).map(e => e.textContent); })(),
        cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(k => [k.dataset.cell, { state: k.dataset.state, cap: __audit.deskCaption(k) }])),
        account: { state: document.getElementById('acctValue')?.dataset.state ?? null, value: document.getElementById('acctValue')?.innerText.trim() ?? '', line: document.querySelector('#acctChange [data-clamp]')?.innerText ?? null },
        desks: [...document.querySelectorAll('.dcard')].map(c => ({ id: c.id.slice(5), name: c.querySelector('h3')?.innerText, nums: c.querySelectorAll('.dnums > div').length, states: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), status: c.querySelector('.card-status')?.innerText ?? '', icons: c.querySelectorAll('.cell-state').length,
          dayName: c.querySelector('.dnums .bn')?.getAttribute('aria-label') ?? null, dayTitle: c.querySelector('.dnums .bn')?.getAttribute('title') ?? null })),
        boardCaption: document.querySelector('#heroL .board-caption').innerText,
        alertGeometry: (() => { const line = document.getElementById('statusAlert'), button = document.getElementById('statusAlertControl'), text = document.getElementById('statusAlertText');
          const r = text.getBoundingClientRect(), hero = document.querySelector('.hero-primary').getBoundingClientRect();
          return { visible: line.hasAttribute('data-visible'), size: getComputedStyle(text).fontSize, bodySize: getComputedStyle(document.body).fontSize,
            icon: button.querySelector('use').getAttribute('href'), target: button.getBoundingClientRect().height, gap: hero.top - r.bottom }; })(),
        positions: document.getElementById('positions').innerText.trim(), kept: document.getElementById('kept').innerText.trim(), strip: document.querySelector('#healthPop .health-facts').textContent,
        say: document.querySelector('#heroL .say').innerText,
        sections: { positions: document.querySelector('#positions .pstate')?.dataset.state, kept: document.querySelector('#kept .pstate')?.dataset.state },
      }))()`);
      const tag = `${id} @${viewport.name}`;
      if (RETAINED_GRACE_CASES.has(id)) check('fixtures', `${tag}: the page keeps the retained-value warning inside the grace`, ui.label === 'retained_values', ui.label);
      const sentence = copyText(ui.sentence);
      const sameSentence = expectedStatus.reason === 'board_ok' ? /^Live · updated .+ ago$/.test(sentence)
        : expectedStatus.reason === 'gateway_unconfirmed' ? sentence.startsWith(expectedStatus.sentence.split(':')[0] + ':')
          : sentence === expectedStatus.sentence;
      const visibleSentence = (expectedStatus.tone === 'green' && /^Live ·/.test(copyText(ui.compact))) ||
        (ui.visibleSentence.length === 1 && ui.visibleSentence[0].startsWith(ui.sentence) && ui.compact !== ui.sentence);
      check('fixtures', `${tag}: original health rank ${label} keeps its status sentence (compact green allowed)`, ui.label === expectedStatus.reason && sameSentence && visibleSentence,
        { ui, expected: expectedStatus });
      if (ui.alertGeometry.visible) check('fixtures', `${tag}: the one-line problem has body-size text, a status icon, a 44 px target and clear space above the hero`,
        ui.alertGeometry.size === ui.alertGeometry.bodySize && ui.alertGeometry.icon === (expectedStatus.statusTone === 'warn' ? '#i-half' : '#i-stop') && ui.alertGeometry.target >= 44 && ui.alertGeometry.gap >= 12, ui.alertGeometry);
      check('fixtures', `${tag}: no panel or page blanks`, Object.keys(ui.cells).length === 4 && Boolean(ui.account.value) && ui.desks.length === 3 && ui.desks.every(d => d.name && d.nums === 3) && ui.positions && ui.kept && ui.strip && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
      const expected = expectedCells;
      const mismatch = Object.entries(CELL).filter(([key, panel]) => ui.cells[key].state !== expected[panel].state).map(([key, panel]) => ({ key, ui: ui.cells[key].state, want: expected[panel].state }));
      const deskMismatch = ui.desks.flatMap(d => ['dayPnl', 'openPnl', 'totalPnl'].map((f2, k) => [d.id, f2, d.states[k]]))
        .filter(([desk, field, state]) => state !== expected[`desks.${desk}.${field}`].state);
      check('fixtures', `${tag}: every money cell shows its own panel state`, !mismatch.length && !deskMismatch.length, { mismatch, deskMismatch });
      // JOED-156: the whole account's value keeps its own panel state and says it
      // in its change line, in the words of its state (none while current).
      const accountLine = stateLine(expected.paperAccount);
      check('fixtures', `${tag}: the whole account's value shows its own panel state and states it in its change line`,
        ui.account.state === (expected.paperAccount?.state ?? 'not reported') && norm(ui.account.line ?? '') === norm(accountLine?.text ?? ''), { account: ui.account, want: accountLine?.text ?? null });
      check('fixtures', `${tag}: positions and kept holdings show their own panel states`, ui.sections.positions === expected.positions.state && ui.sections.kept === expected.kept.state, { ui: ui.sections, want: [expected.positions.state, expected.kept.state] });
      if (expectedStatus.tone !== 'green') {
        const openers = ['#hdrHealth', ...await page.evaluate(`document.getElementById('statusAlert').hasAttribute('data-visible') ? ['#statusAlertControl'] : []`)];
        for (const selector of openers) {
          const point = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
          if (viewport.mobile) {
            await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
            await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
            await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
          }
          await settle(page);
          const details = await page.evaluate(`(() => {
            const pop = document.getElementById('healthPop'), sentence = pop.querySelector('.status-sentence'), r = sentence.getBoundingClientRect(), box = pop.getBoundingClientRect();
            return { open: pop.classList.contains('on'), focused: document.activeElement === pop, sentence: sentence.textContent,
              expected: document.getElementById('hdrHealth').title, visible: __audit.visible(sentence) && r.top >= box.top && r.bottom <= box.bottom && sentence.scrollWidth <= sentence.clientWidth,
              expanded: document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded') };
          })()`);
          check('fixtures', `${tag}: ${selector} opens Details with the entire sentence in view`, details.open && details.focused && details.visible &&
            details.sentence === details.expected && details.expanded === 'true', details);
          await key(page, 'Escape');
          check('AC-33', `${tag}: Escape from Details returns to ${selector}`, await page.evaluate(`!document.getElementById('healthPop').classList.contains('on') && document.activeElement === document.querySelector(${JSON.stringify(selector)})`));
        }
      }
      // Shared snapshot captions move to the board once. Different reasons,
      // ages and retained values still belong to the affected number/card.
      // JOED-148: a not-exact Today that is the card's only problem has no card
      // line; its reason is on its own dash (name and title), never repeated.
      const quiet = (d, field) => expectedCells[`desks.${d.id}.${field}`].state === 'fresh' || sharesBoardCaption(expectedCells[`desks.${d.id}.${field}`], boardCaption);
      const missingReasons = ui.desks.flatMap(d => ['dayPnl', 'openPnl', 'totalPnl'].map(field => [field, expectedCells[`desks.${d.id}.${field}`]])
        .filter(([, cell]) => cell.state !== 'fresh' && !sharesBoardCaption(cell, boardCaption)).flatMap(([field, cell]) => {
          const words = cell.reason ? cellReason(cell.reason) : 'not reported';
          const loneDay = field === 'dayPnl' && notExactDash(cell) && quiet(d, 'openPnl') && quiet(d, 'totalPnl');
          const ok = loneDay ? d.dayName === `Today: ${dashWords(cell.reason)}` && d.dayTitle === d.dayName && !d.status.includes(words) : d.status.includes(words);
          return ok ? [] : [{ desk: d.name, field, loneDay, words, status: d.status, dayName: d.dayName }];
        }));
      check('fixtures', `${tag}: every differing desk number keeps its own reason (a lone not-exact Today on its dash) and every affected number keeps a state icon`, !missingReasons.length && ui.desks.every(d => d.icons === d.states.filter(state => state !== 'fresh').length), missingReasons.slice(0, 3));
      const repeated = Object.entries(CELL).filter(([key, panel]) => key !== 'hero.day' && sharesBoardCaption(expectedCells[panel], boardCaption) && ui.cells[key].cap);
      check('fixtures', `${tag}: matching money captions appear once on the board`, !repeated.length && (!boardCaption || ui.boardCaption.includes(cellReason(boardCaption.reason))), { repeated, caption: ui.boardCaption });
      const caps = norm([ui.boardCaption, ui.say, ...Object.values(ui.cells).map(c => c.cap)].join(' | '));
      if (kind === 'stale') check('fixtures', `${tag}: stale shows its age and reason`, /[Aa]s of \d+\s(s|min) ago · updates are (late|stuck)/.test(caps), caps);
      if (kind === 'not reported') check('fixtures', `${tag}: not reported reads plainly`, ui.account.line === 'Not reported', { caps, account: ui.account });
      if (kind === 'broken') {
        // Check every affected cell, including retained values after rejection.
        // A not-exact cell must never hide a different cell's real fault.
        const plain = html => norm(html.replace(/<[^>]*>/g, ''));
        for (const [key, panel] of Object.entries(CELL)) {
          const cell = expectedCells[panel];
          if (cell.state === 'fresh') continue;
          const { section, text: want } = heroProblemCaption(expectedContext, key);
          // JOED-153: a shown household Today states its own state in its caption.
          const actual = section ? ui.boardCaption : ui.cells[key].cap;
          check('fixtures', `${tag}: ${key} ${NOT_EXACT_REASONS.has(cell.reason) ? 'not-exact' : 'fault'} keeps its own reason locally or in the shared section line`,
            (section ? norm(actual).includes(plain(want)) : norm(actual) === plain(want)), { key, actual, want: plain(want) });
        }
      }
      if (['e-layout-storage-unavailable', 'stale-receive-age', 'a-gateway-up-but-dead', 'b-incomplete-family', 'missing-runtime-and-results', 'c-old-producer-image', 'g-expired-sso', 'p3-single-missing-desk'].includes(id) && (viewport.name !== '390' || ['e-layout-storage-unavailable', 'a-gateway-up-but-dead'].includes(id))) {
        await shot(page, viewport, `${viewport.name}-${theme}-desk-state-${id}`, `Desk, P1 fixture ${id} (${kind})`);
      }
      if (storageScript) await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier: storageScript });
      if (unroute) await unroute();
      if (f.transportReason === 'auth_required') await page.setHeaders({ 'x-auth-request-user': ACTOR });
      page.errors.length = 0;
    }
  }
  // JOED-95: change only the method, keeping every figure and box identical.
  // CI owns execution; the local night worker only prepares these assertions.
  {
    const estimateViewports = [...VIEWPORTS, { ...VIEWPORTS[2], name: '360', width: 360 }];
    const estimateMarks = `(() => {
      const visible = [...document.querySelectorAll('.estimate-mark')].filter(e => __audit.visible(e));
      return visible.map(e => {
        const r = e.getBoundingClientRect(), label = e.parentElement, box = label.getBoundingClientRect();
        // Measure every other label child, including the state icon. Text
        // nodes need a Range; the absolutely positioned mark is excluded.
        const content = [...label.childNodes].filter(n => n !== e &&
          (n.nodeType === 3 ? n.textContent.trim() : n.nodeType === 1 && __audit.visible(n))).map(n => {
          if (n.nodeType === 1) return n.getBoundingClientRect();
          const range = document.createRange(); range.selectNode(n); return range.getBoundingClientRect();
        });
        return { text:e.textContent, label:e.getAttribute('aria-label'), role:e.getAttribute('role'), size:parseFloat(getComputedStyle(e).fontSize), title:e.getAttribute('title'),
          contained:[r, ...content].every(c => c.left >= box.left && c.right <= box.right && c.top >= box.top && c.bottom <= box.bottom),
          separate:content.length > 0 && content.every(c => r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) };
      });
    })()`;
    for (const viewport of estimateViewports) for (const theme of THEMES) for (const font of [null, WIDE_FONT]) {
      const b = await newBoard(), estimate = ingress(valid.data), recovery = ingress(valid.data);
      let seq = valid.data.seq;
      estimate.pnlSources.day = structuredClone(fixture('b-session-open-estimate').payload.pnlSources.day);
      b.setNow(valid.data.receivedAt); await b.push(ingress(valid.data));
      b.setNow(at(valid.data.receivedAt, 9));
      await configure(page, viewport, theme); await load(page, b.url, 'desk');
      if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
      const selectors = [...DESK_SHIFT, '.dnums .k', '.dnums .v', '.compact-label', '.compact-figure .bn'];
      const before = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
      // A changed method is a new observation. Frozen generations deliberately
      // preserve the earlier last-good source through a later outage (JOED-120).
      estimate.seq = ++seq; estimate.generatedAt = at(valid.data.receivedAt, 1); b.setNow(estimate.generatedAt);
      check('fixtures', 'JOED-95 estimate accepted', (await b.push(estimate)).status === 200);
      b.setNow(at(valid.data.receivedAt, 9)); await page.evaluate('window.__joedesk.refresh()'); await settle(page);
      const after = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
      const tag = `${viewport.name} ${theme}${font ? ' wide font' : ''}`;
      const checkMarks = async state => {
        const marks = await page.evaluate(estimateMarks);
        check('fixtures', `${tag}: ${state} estimated Today cells say Estimated visibly, accessibly, without overlapping the complete label and state icon`,
          marks.length === (viewport.mobile ? 6 : 3) && marks.every(m => m.text === 'Estimated' && m.role === 'img' && m.label.startsWith('Estimated from the session open') && m.size >= 10 && !m.title && m.contained && m.separate), marks);
        // M6: a value is its figure's link, a dash is bare; both are the amount.
        const money = await page.evaluate(`Array.from(document.querySelectorAll('.dnums .v > .bn, .dnums .v > .fig-link > .bn'), el => {
          const range = document.createRange(); range.selectNodeContents(el);
          const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
          return { text: el.textContent, left: text.left - box.left, right: box.right - text.right, height: box.height };
        })`);
        check('AC-36', `${tag}: ${state} detail amounts fit their fixed lines`, money.length === 9 &&
          money.every(m => m.left >= 0 && m.right >= 0 && m.height === 26), money);
      };
      await checkMarks('fresh');
      check('no-shift', `${tag}: exact → estimate has exactly 0 px layout shift`, JSON.stringify(before) === JSON.stringify(after), shifted(before, after));
      recovery.seq = ++seq; recovery.generatedAt = at(valid.data.receivedAt, 2); b.setNow(recovery.generatedAt); await b.push(recovery);
      b.setNow(at(valid.data.receivedAt, 9)); await page.evaluate('window.__joedesk.refresh()'); await settle(page);
      check('no-shift', `${tag}: estimate → exact has exactly 0 px layout shift and removes all estimate marks`,
        JSON.stringify(before) === JSON.stringify(await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`)) &&
        await page.evaluate(`document.querySelectorAll('.estimate-mark').length === 0`));
      if (viewport.mobile) {
        estimate.seq = ++seq; estimate.generatedAt = at(valid.data.receivedAt, 3); b.setNow(estimate.generatedAt); await b.push(estimate);
        b.setNow(at(valid.data.receivedAt, 70)); await page.evaluate('window.__joedesk.refresh()'); await settle(page);
        check('fixtures', `${tag}: stale estimate really has a stale Today icon`,
          await page.evaluate(`document.querySelector('#desk-j .dnums > div').dataset.state === 'stale' && document.querySelector('#desk-j .compact-state[aria-label^="Stale"]') !== null`));
        await checkMarks('stale');
        const stale = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
        const outage = structuredClone(estimate); outage.seq = ++seq;
        outage.generatedAt = outage.safety.gateway.checkedAt = at(valid.data.receivedAt, 80);
        for (const bag of [outage.totals, ...outage.desks.map(d => d.money)]) {
          bag.dayPnl = null; (bag.reasons ??= {}).dayPnl = 'source_unavailable';
        }
        for (const sources of [outage.pnlSources, ...outage.desks.map(d => d.pnlSources)].filter(Boolean)) Object.assign(sources.day, {
          status: 'unavailable', observedAt: null, reason: 'source_unavailable',
        });
        b.setNow(at(valid.data.receivedAt, 80));
        check('fixtures', `${tag}: estimate outage accepted`, (await b.push(outage)).status === 200);
        b.setNow(at(valid.data.receivedAt, 85)); await page.evaluate('window.__joedesk.refresh()'); await settle(page);
        check('fixtures', `${tag}: outage really keeps the estimate with a broken Today icon`,
          await page.evaluate(`document.querySelector('#desk-j .dnums > div').dataset.state === 'broken' && document.querySelector('#desk-j .compact-state[aria-label^="Broken"]') !== null && document.querySelector('#desk-j .compact-figure .bn').textContent !== '—'`));
        await checkMarks('kept during outage');
        const kept = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
        check('no-shift', `${tag}: stale → kept estimate has exactly 0 px layout shift`, JSON.stringify(stale) === JSON.stringify(kept), shifted(stale, kept));
        const restoredEstimate = structuredClone(estimate); restoredEstimate.seq = ++seq;
        restoredEstimate.generatedAt = restoredEstimate.safety.gateway.checkedAt = at(valid.data.receivedAt, 90);
        b.setNow(at(valid.data.receivedAt, 90));
        check('fixtures', `${tag}: estimate recovery accepted`, (await b.push(restoredEstimate)).status === 200);
        b.setNow(at(valid.data.receivedAt, 160)); await page.evaluate('window.__joedesk.refresh()'); await settle(page);
        const restored = await page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
        check('no-shift', `${tag}: kept → stale estimate has exactly 0 px layout shift`, JSON.stringify(kept) === JSON.stringify(restored), shifted(kept, restored));
      }
      if (viewport.mobile) check('fixtures', `${tag}: estimate marks preserve the 44 px phone disclosure targets`,
        await page.evaluate(`[...document.querySelectorAll('.desk-row')].every(e => e.getBoundingClientRect().height >= 44)`));
    }
  }
  // JOED-81: reuse the accepted broker-down fixture for a live transition.
  // Fresh and outage boxes must match at 1440/1024/phone in both themes.
  for (const viewport of VIEWPORTS) for (const theme of THEMES) {
    const f = fixture('a-gateway-up-but-dead'), b = await newBoard();
    b.setNow(valid.data.receivedAt);
    await b.push(ingress(valid.data));
    b.setNow(at(valid.data.receivedAt, 9));
    await configure(page, viewport, theme);
    await load(page, b.url, 'desk');
    const before = await rects(DESK_SHIFT);
    const phone = viewport.width <= 480;
    if (phone) await setDeskDisclosures(page, false);
    const collapsedBefore = phone ? await rects(DESK_SHIFT) : null;
    b.setNow(f.receivedAt);
    check('fixtures', 'broker-down transition fixture accepted', (await b.push(f.payload)).status === 200);
    b.setNow(f.now);
    await page.evaluate('window.__joedesk.refresh()');
    await waitFor(page, `document.querySelector('#hdrHealth').dataset.reason === 'gateway_down'`);
    await settle(page);
    const tag = `broker down @${viewport.name} ${theme}`;
    if (phone) {
      const collapsed = await page.evaluate(`(() => {
        const count = text => (text.match(/broker connection down/g) ?? []).length;
        return { controls: [...document.querySelectorAll('[data-desk-disclosure]')]
          .filter(b => ['account', 'j', 'joe', 'joel', 'positions', 'kept'].includes(b.dataset.deskDisclosure)).map(b => {
            const body = document.getElementById(b.getAttribute('aria-controls')), summary = b.querySelector('.collapsed-summary .summary-text');
            return { key: b.dataset.deskDisclosure, expanded: b.getAttribute('aria-expanded'), hidden: body.hidden,
              visible: __audit.visible(b) && __audit.visible(summary), bodyVisible: __audit.visible(body),
              icon: __audit.visible(b.querySelector('.collapsed-summary .i')), reason: count(summary?.innerText ?? ''), detail: count(summary?.title ?? '') };
          }), horizontal: __audit.horizontal() };
      })()`);
      check('fixtures', `${tag}: each collapsed Desks’ money, desk, Positions and Kept summary visibly retains its icon and one shared reason`,
        collapsed.controls.length === 6 && collapsed.controls.every(c => c.expanded === 'false' && c.hidden && !c.bodyVisible && c.visible && c.icon && c.reason === 1 && c.detail === 1), collapsed);
      const changed = moves(collapsedBefore, await rects(DESK_SHIFT));
      check('no-shift', `${tag}: collapsed fresh → broker down shifts 0 px and does not scroll horizontally`,
        !changed.length && collapsed.horizontal.scroll <= collapsed.horizontal.inner, { changed, horizontal: collapsed.horizontal });
      await setDeskDisclosures(page, true);
    }
    const d = await page.evaluate(`(() => {
      const count = text => (text.match(/broker connection down/g) ?? []).length;
      const text = selector => { const e = document.querySelector(selector); return __audit.visible(e) ? e.innerText : ''; };
      return {
        hero: count(text('#heroL .board-caption')),
        cells: [...document.querySelectorAll('#heroL [data-cell]')].map(c => count(__audit.deskCaption(c))),
        cash: count([...document.querySelectorAll('#acctHero [data-cash]')].filter(__audit.visible).map(e => e.innerText).join(' ')), whole: count(text('#acctHero')), say: count(text('#heroL .say')),
        account: count(text('#accountDetail .account-state')),
        cards: [...document.querySelectorAll('.dcard .card-status')].map(c => __audit.visible(c) ? count(c.innerText) : 0),
        opened: [...document.querySelectorAll('[data-desk-disclosure]')]
          .filter(b => ['account', 'j', 'joe', 'joel', 'positions', 'kept'].includes(b.dataset.deskDisclosure)).map(b => {
            const body = document.getElementById(b.getAttribute('aria-controls'));
            return { key: b.dataset.deskDisclosure, expanded: b.getAttribute('aria-expanded'), visible: __audit.visible(body),
              reason: count(body.innerText), summary: [...b.querySelectorAll('.summary-text')].filter(__audit.visible).reduce((n, s) => n + count(s.innerText), 0) };
          }),
        sections: ['positions', 'kept'].map(id => ({ id, reason: count(text('#' + id + ' .pstate')),
          rows: [...document.querySelectorAll('#' + id + ' .prow:not(.hd)')].map(row => ({ reason: count(row.innerText),
            dashes: [...row.querySelectorAll('.position-value')].filter(__audit.visible).map(dash => ({ label: dash.getAttribute('aria-label'), title: dash.title, text: dash.innerText })) })) })),
        horizontal: __audit.horizontal(),
      };
    })()`);
    check('fixtures', `${tag}: the whole account, the hero, each card, Positions and Kept have one shared reason with no per-cell or per-row repetition`,
      d.hero === 1 && d.cells.every(n => n === 0) && d.cash === 0 && d.whole === 1 && d.say === 0 && d.cards.length === 3 && d.cards.every(n => n === 1) &&
      d.sections.every(s => s.reason === 1 && s.rows.length > 0 && s.rows.every(row => row.reason === 0 && row.dashes.length > 0 && row.dashes.every(dash =>
        /^(Last price|Worth|Today’s result|Open result): broker connection down$/.test(dash.label) && dash.title === dash.label))), d);
    if (phone) check('fixtures', `${tag}: opened Desks’ money, each desk, Positions and Kept visibly state the shared reason once in the body without repeating it in their summaries`,
      d.account === 1 && d.opened.length === 6 && d.opened.every(c => c.expanded === 'true' && c.visible && c.reason === 1 && c.summary === 0), d.opened);
    const changed = moves(before, await rects(DESK_SHIFT));
    check('no-shift', `${tag}: fresh → broker down shifts 0 px and does not scroll horizontally`, !changed.length && d.horizontal.scroll <= d.horizontal.inner, { changed, horizontal: d.horizontal });
  }
  }

  if (run('nodata')) {
  // 4 · NO DATA in the selector’s own state at every viewport and theme: nothing
  // received is "not reported" on every panel, History included; a rejected
  // LIVE push is broken with its reason (AC-6).
  for (const live of [false, true]) {
    const b = await newBoard();
    b.setNow(NOW);
    if (live) { const payload = ingress(valid.data); payload.mode = 'LIVE'; const r = await b.push(payload, 'data', { status: 422, reason: 'contract_invalid' }); check('AC-6', 'a LIVE snapshot is rejected', r.status === 422, r.body); }
    for (const viewport of live ? [VIEWPORTS[0]] : VIEWPORTS) for (const theme of live ? ['light'] : THEMES) {
      await configure(page, viewport, theme);
      await load(page, b.url, 'desk');
      const tag = `${live ? 'LIVE rejected' : 'no snapshot'} @${viewport.name} ${theme}`;
      const ui = await page.evaluate(`({ label: document.querySelector('#hdrHealth .status-full').textContent, display: document.querySelector('#heroL .display').innerText, caps: [...document.querySelectorAll('#heroL .kpi[data-cell] .c')].map(c => c.innerText), states: [...document.querySelectorAll('#heroL [data-cell]')].map(c => c.dataset.state), now: [...document.querySelectorAll('.dcard .now')].map(n => n.innerText), cards: [...document.querySelectorAll('.dcard .card-status')].map(n => n.innerText), nums: [...document.querySelectorAll('.dcard .dnums > div')].map(d => d.dataset.state), positions: document.getElementById('positions').innerText, kept: document.querySelector('#kept .pstate').innerText, pop: document.getElementById('healthPop').textContent })`);
      const [state, caption, cardLine, posLine, keptLine] = live
        ? ['broken', 'Unavailable · last update was rejected', 'Numbers: unavailable · last update was rejected', 'Position detail is unavailable: last update was rejected.', 'Kept holdings are unavailable: last update was rejected.']
        : ['not reported', 'Not reported · no data received yet', 'Numbers: not reported · no data received yet', 'Position detail is not present in this snapshot.', 'Kept holdings are not present in this snapshot.'];
      check(live ? 'AC-6' : 'nodata', `${tag}: NO DATA everywhere, in the selector's own state`, ui.label === 'No board data' && ui.display === '—' && ui.states.every(x => x === state) && ui.nums.every(x => x === state) &&
        ui.caps.every(c => norm(c) === caption) && ui.cards.length === 3 && ui.cards.every(c => norm(c) === cardLine) && ui.now.length === 3 && ui.now.every(n => n === 'Waiting for the first valid snapshot.') && ui.positions.includes(posLine) && ui.kept === keptLine &&
        /No board data — reload; if still empty, tell Amy/i.test(ui.pop), ui);
      if (!live && (viewport.name === '1440' || viewport.mobile)) await shot(page, viewport, `${viewport.name}-${theme}-desk-state-no-data`, 'Desk, NO DATA (no snapshot yet)');
      if (live) continue;
      await auditScreen(page, viewport, theme, 'desk (no data)');
      await go(page, 'history');
      const h = await page.evaluate(HIST_TEXT);
      check('nodata', `${tag}: History not reported says so and offers Retry`, h.state === 'not reported' && h.status === 'History has not arrived yet.' && h.retry, h);
      await auditScreen(page, viewport, theme, 'history (not reported)');
    }
  }
  }

  if (run('cold')) {
  // 5 · HIGH regression: a cold start without the server's clock. Every read
  // fails before state.json has ever answered and no response carries a clock;
  // each panel still renders its own state and reason, never a blank page.
  {
    const cold = await newBoard();
    cold.setNow(NOW);
    const jsonRule = (path, status, body) => ({ path, status, body: JSON.stringify(body) });
    const READS = ['state.json', 'history.json', 'results.json', 'fleet-config.json'];
    const CASES = [
      // P4: the closed-trade record is read too (results.json), so it fails with the rest.
      ['auth', 'auth_required', READS.map(p => jsonRule(p, 401, { ok: false, reason: 'auth_required' }))],
      ['redirect', 'auth_required', READS.map(p => ({ path: p, status: 302, headers: [{ name: 'Location', value: '/oauth2/start' }] }))],
      ['routing', 'route_not_found', READS.map(p => jsonRule(p, 404, { ok: false, error: 'not found' }))],
      ['proxy', 'refresh_failed', READS.map(p => ({ path: p, status: 503, headers: [{ name: 'Content-Type', value: 'text/html' }], body: '<h1>Bad gateway</h1>' }))],
      ['offline', 'refresh_failed', READS.map(p => ({ path: p, fail: 'ConnectionRefused' }))],
    ];
    for (const [name, reason, rules] of CASES) {
      const combos = name === 'auth' ? VIEWPORTS.flatMap(v => THEMES.map(t => [v, t])) : [[VIEWPORTS[1], 'light'], [VIEWPORTS[2], 'dark']];
      for (const [viewport, theme] of combos) {
        const tag = `cold ${name} @${viewport.name} ${theme}`;
        await configure(page, viewport, theme);
        const unroute = await route(rules);
        await load(page, cold.url, 'desk');
        await settle(page);
        const words = cellReason(reason);
        const ui = await page.evaluate(DESK_TEXT);
        const cellsOk = Object.values(ui.cells).every(c => c.state === 'broken') && Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').every(([, c]) => c.cap === `Unavailable · ${words}`) &&
          ui.account.state === 'broken' && ui.account.line === `Unavailable · ${words}`;
        check('cold', `${tag}: no clock, yet every panel shows broken with its reason`, ui.label === 'No board data' && /^Time not known/.test(ui.marketSub) && cellsOk && ui.say === `No numbers: ${words}.` &&
          ui.cards.every(c => c.status === `Numbers: unavailable · ${words}` && c.nums.every(x => x === 'broken')) && ui.positions === `Position detail is unavailable: ${words}.` &&
          ui.kept === `Kept holdings are unavailable: ${words}.` && ui.strip.includes(`No data · ${words}`) && !/Data from|refreshes every/.test(ui.foot) && ui.alert.startsWith('No board data') && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
        if (name === 'auth') {
          await auditScreen(page, viewport, theme, 'desk (cold, no clock)');
          if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-desk-state-cold-no-clock`, 'Desk, cold start: sign-in expired before any data or clock');
        }
        await go(page, 'history');
        const h = await page.evaluate(HIST_TEXT);
        check('cold', `${tag}: History shows its own failure, no blank chart`, h.state === 'broken' && h.status === `History refresh failed: ${words}. Nothing to show yet.` && h.retry && h.chart === 'Waiting for the board server’s clock', h);
        if (name === 'auth') {
          await auditScreen(page, viewport, theme, 'history (cold, no clock)');
          if (viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-history-state-cold-no-clock`, 'History, cold start without a clock');
        }
        // r2: Results is never blank without a clock, reached from the nav or opened directly.
        // P4: it reads the closed-trade record itself, so it says why that read failed.
        await go(page, 'results');
        const r = await page.evaluate(RES_TEXT);
        check('cold', `${tag}: Results, reached from the nav, shows its own failure, dashes and no zeros`, unavailable(r, words) && !page.errors.length, { r, errors: page.errors.slice(0, 3) });
        page.errors.length = 0;
        await load(page, cold.url, 'results');
        const direct = await page.evaluate(RES_TEXT);
        check('cold', `${tag}: Results, opened directly at #results, shows its own failure, dashes and no zeros`, unavailable(direct, words) && !page.errors.length, { direct, errors: page.errors.slice(0, 3) });
        if (name === 'auth') {
          await auditScreen(page, viewport, theme, 'results (cold, no clock)');
          if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-state-cold-no-clock`, 'Results, cold start without a clock: its own failure (sign-in expired)');
        }
        await unroute();
        page.errors.length = 0;
      }
    }
    // state.json fails while History answers: History keeps its own value and
    // age at the server's stamp from its own read; Desk still says why.
    const answering = scenario(NOW);
    const own = await newBoard({ history: answering.history });
    own.setNow(NOW);
    check('cold', 'design snapshot accepted for the History-answers case', (await own.push(answering.snapshot)).status === 200);
    own.setNow(at(NOW, 9));
    for (const [viewport, theme] of [[VIEWPORTS[0], 'dark'], [VIEWPORTS[1], 'light'], [VIEWPORTS[2], 'light']]) {
      const tag = `cold routing, History answers @${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      const unroute = await route([{ path: 'state.json', status: 404, body: '{"ok":false,"error":"not found"}' }]);
      await load(page, own.url, 'history');
      await waitFor(page, `document.querySelectorAll('#histChart > svg path[stroke^="var(--desk-"]').length >= 3`);
      const h = await page.evaluate(HIST_TEXT);
      const worker = await page.evaluate('window.__joedesk.worker()');
      check('cold', `${tag}: History draws its own observed lines and stays fresh`, h.state === 'fresh' && !h.status && h.lines >= 3 && worker, { h, worker });
      await go(page, 'desk');
      const ui = await page.evaluate(DESK_TEXT);
      check('cold', `${tag}: Desk shows not found per panel, with the market clock from History's read`, !/^Time not known/.test(ui.marketSub) && Object.values(ui.cells).every(c => c.state === 'broken') && ui.account.state === 'broken' &&
        ui.cards.every(c => c.status === 'Numbers: unavailable · not found on the board server'), ui);
      await unroute();
      page.errors.length = 0;
    }
  }
  }

  if (run('passthrough')) {
  // 6 · A replay retains individual observations as stale with their age;
  // totals and since-start stay unavailable under the board display policy.
  {
    const b = await newBoard();
    b.setNow(NOW);
    const { snapshot: base } = scenario(NOW);
    check('passthrough', 'design snapshot accepted', (await b.push(base)).status === 200);
    const replay = structuredClone(base);
    replay.desks[0].action = 'The same sequence number with a different body';
    b.setNow(at(NOW, 20));
    const r = await b.push(replay, 'data', { status: 422, reason: 'sequence_replayed' });
    check('passthrough', 'a non-identical replay is rejected as sequence_replayed', r.status === 422 && r.body.reason === 'sequence_replayed', r.body);
    b.setNow(at(NOW, 30));
    const server = await (await fetch(`${b.url}state.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `replayed push @${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      await load(page, b.url, 'desk');
      const ui = await page.evaluate(DESK_TEXT);
      const CELL = { 'hero.day': 'today.dayPnl', 'hero.open': 'today.openPnl', 'hero.since': 'today.totalPnl', 'hero.equity': 'today.equity' };
      const wrong = Object.entries(CELL).filter(([k, panel]) => ui.cells[k].state !== server.panels[panel].state || server.panels[panel].state !== 'stale').map(([k, panel]) => ({ k, ui: ui.cells[k].state, p1: server.panels[panel].state }));
      if (ui.account.state !== server.panels.paperAccount.state || server.panels.paperAccount.state !== 'stale') wrong.push({ k: 'whole account', ui: ui.account.state, p1: server.panels.paperAccount.state });
      check('passthrough', `${tag}: every cell keeps the selector's stale state`, !wrong.length && ui.cards.every(c => c.nums.every(x => x === 'stale')) && ui.posState === 'stale' && ui.keptState === 'stale', { wrong, cards: ui.cards });
      const caps = Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').map(([, c]) => c.cap);
      check('passthrough', `${tag}: retained observations keep their age; totals, since-start and the kept sum show dashes`, /^Last good value, 3\d\ss ago · last update repeated an old one$/.test(ui.boardCaption) &&
        caps.length === 3 && caps.every(c => c === 'Unavailable') && /^Last good value, 3\d\ss ago · last update repeated an old one$/.test(norm(ui.account.line ?? '')) &&
        ui.cards.every(c => /^Since .+: unavailable · last update repeated an old one$/.test(c.status) && c.icons === 3) &&
        /^Last good positions, 3\d\ss ago · last update repeated an old one$/.test(ui.positions) &&
        /^Last good values, 3\d\ss ago · last update repeated an old one · worth —$/.test(ui.kept), { caps, account: ui.account, cards: ui.cards.map(c => c.status), positions: ui.positions, kept: ui.kept });
      if (viewport.name === '1024') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-replayed`, 'Desk, replayed push: last good values stay stale with their age');
    }
  }
  }

  if (run('journey')) {
  // 7 · HIGH regression and no-shift: one board walks not reported → fresh →
  // stale → broken with different reasons and ages per number → recovered, at
  // every viewport and theme. Each affected number names its own age and
  // reason; nothing on Desk or History moves (±0.5 px) at any transition, and
  // the health line and Today's sentence keep one box in every state. Linux
  // lays text out in wider fonts than macOS, so it runs once more in a wide
  // font at 390 and 1024: a box that fits only this machine's font fails
  // here, not first on CI.
  const journeys = [...VIEWPORTS.flatMap(v => THEMES.map(t => [v, t, null])), [VIEWPORTS[2], 'light', WIDE_FONT], [VIEWPORTS[1], 'dark', WIDE_FONT]];
  for (const [viewport, theme, font] of journeys) {
    const tag = `${viewport.name} ${theme}${font ? ' wide font' : ''}`;
    const { snapshot: base, history } = scenario(NOW);
    const b = await newBoard({ history });
    b.setNow(NOW);
    await configure(page, viewport, theme);
    const refresh = async until => { await page.evaluate('window.__joedesk.refresh()'); await waitFor(page, until); await settle(page); };
    // Not reported: no snapshot has arrived yet.
    await load(page, b.url, 'desk');
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
    let ui = await page.evaluate(DESK_TEXT);
    check('journey', `${tag} not reported: the health line and Today say that no data has arrived`, ui.label === 'No board data' && ui.cells['hero.day'].state === 'not reported' &&
      ui.strip.includes('No board data — reload; if still empty, tell Amy') && ui.strip.includes('Broker connection not reported') && ui.strip.includes('Emergency stop not reported') && ui.alert.startsWith('No board data') && ui.say === 'No numbers yet: no board data has arrived.', ui);
    const boxes = [['not reported', await rects(STATE_BOXES)]];
    check('journey', `${tag}: fresh snapshot accepted`, (await b.push(base)).status === 200);
    b.setNow(at(NOW, 9));
    await refresh(`document.querySelector('#hdrHealth').dataset.reason === 'board_ok' && [...document.querySelectorAll('#heroL [data-cell]')].every(c => c.dataset.state === 'fresh')`);
    boxes.push(['fresh', await rects(STATE_BOXES)]);
    const desk0 = await rects(DESK_SHIFT);
    await go(page, 'history');
    const hist0 = await rects(HIST_SHIFT);
    await go(page, 'desk');

    // Stale: no update for 75 s. One board caption owns the matching age/reason;
    // all money cells retain their state/icon, sections retain their own lines.
    b.setNow(at(NOW, 75));
    await refresh(`document.querySelector('#hdrHealth').dataset.reason === 'snapshot_stale'`);
    ui = await page.evaluate(DESK_TEXT);
    const late = /^As of 1\smin ago · updates are late\.?$/;
    // The whole account, its own block above the hero, says its value's state in its own change line.
    check('journey', `${tag} stale: one board caption gives the matching age/reason; every number retains its state and icon`, Object.values(ui.cells).every(c => c.state === 'stale') && Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').every(([, c]) => c.cap === '') && late.test(ui.boardCaption) &&
      ui.account.state === 'stale' && late.test(norm(ui.account.line ?? '')) &&
      ui.say === 'Today’s result is not available.' && ui.cards.every(c => c.label === 'Last sessions · each session’s result in €, after fees' && !c.status && c.icons === 3) && /^As of 1\smin ago · updates are late$/.test(ui.positions) &&
      /^As of 1\smin ago · updates are late · worth —$/.test(ui.kept), ui);
    const staleDerived = await page.evaluate(`(() => ({
      totals: ['day', 'since', 'open', 'equity'].map(k => document.querySelector('[data-cell="hero.' + k + '"] .bn').textContent),
      since: [...document.querySelectorAll('.dcard .dnums > div:last-child .bn')].map(e => e.textContent),
      percentages: document.querySelectorAll('#heroL .performance-pct').length,
      bars: document.querySelectorAll('.dcard .bars .b.today i.live, #positions .vbar i').length
    }))()`);
    check('no-shift', `${tag}: fresh → stale hides derived amounts and moves nothing on Desk`,
      staleDerived.totals.length === 4 && staleDerived.totals.every(v => v === '—') && staleDerived.since.length === 3 && staleDerived.since.every(v => v === '—') && staleDerived.percentages === 0 && staleDerived.bars === 0 &&
      !moves(desk0, await rects(DESK_SHIFT)).length, { derived: staleDerived, moves: moves(desk0, await rects(DESK_SHIFT)).slice(0, 5) });
    boxes.push(['stale', await rects(STATE_BOXES)]);
    if (!font && viewport.name !== '1024') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-stale`, 'Desk, stale: every panel with its age and reason');
    await go(page, 'history');
    let h = await page.evaluate(HIST_TEXT);
    check('journey', `${tag} stale: History keeps its age; J's since-start result is a dash with why`, h.state === 'stale' && /^History as of 1\smin ago · updates are late\.$/.test(h.status) && !h.retry && /J since 10\sSep\s+—\s·\sUnavailable · updates are late/.test(h.j), h);
    check('no-shift', `${tag}: fresh → stale moves nothing on History`, !moves(hist0, await rects(HIST_SHIFT)).length, moves(hist0, await rects(HIST_SHIFT)).slice(0, 5));
    await go(page, 'desk');
    // Today's sentence pinned whole in the tip stays pinned through the
    // rebuild and then shows the new sentence.
    const pinnedSay = await clickSay(page);
    check('clamp', `${tag} stale: a click or tap shows Today's sentence whole`, sayWhole(pinnedSay), pinnedSay);

    // Broken, field by field: Joe's Today stops at +80 s, Joe's open result
    // and J's total at +110 s. Today is unavailable; open keeps its age.
    // (The contract makes Today's and the open result's evidence all or
    // nothing across the desks; equity and the total may stop desk by desk.)
    const B = advance(base, at(NOW, 80), base.seq + 1);
    B.pnlSources.day.status = 'unavailable';
    for (const bag of [B.totals, ...B.desks.map(d => d.money)]) { bag.dayPnl = null; bag.reasons = { dayPnl: 'baseline_pending' }; }
    b.setNow(at(NOW, 80));
    const rb = await b.push(B);
    check('journey', `${tag}: Joe's Today withheld (accepted)`, rb.status === 200, rb.body);
    const C = advance(B, at(NOW, 110), base.seq + 2);
    C.pnlSources.open.status = 'unavailable';
    for (const bag of [C.totals, ...C.desks.map(d => d.money)]) { bag.openPnl = null; bag.reasons = { dayPnl: 'baseline_pending', openPnl: 'open_pnl_unavailable' }; }
    C.desks[0].money.totalPnl = null; C.desks[0].money.reasons.totalPnl = 'retained_values';
    C.totals.totalPnl = null; C.totals.reasons.totalPnl = 'family_projection_unavailable';
    b.setNow(at(NOW, 110));
    const rc = await b.push(C);
    check('journey', `${tag}: Joe's open result and J's total withheld (accepted)`, rc.status === 200, rc.body);
    b.setNow(at(NOW, 115));
    await refresh(`document.getElementById('desk-joe').innerText.includes('open result not available')`);
    ui = await page.evaluate(DESK_TEXT);
    const [j, joe, joel] = ['j', 'joe', 'joel'].map(id => ui.cards.find(c => c.id === id));
    const today = /^Today: not exact · waiting on the start-of-day value$/, open = /^Open result: last good, 3\d\ss ago · open result not available$/;
    check('journey', `${tag} broken: each affected desk number has its own line, age and reason`, j.lines.length === 3 && today.test(j.lines[0]) && open.test(j.lines[1]) &&
      /^Since 10\sSep: unavailable · carrying the last good value$/.test(j.lines[2]) && [joe, joel].every(c => c.lines.length === 2 && today.test(c.lines[0]) && open.test(c.lines[1])) &&
      JSON.stringify(j.nums) === '["broken","broken","broken"]' && [joe, joel].every(c => JSON.stringify(c.nums) === '["broken","broken","fresh"]'), ui.cards);
    check('journey', `${tag} broken: unavailable totals keep their own reasons; Today states its reason once`, brokenJourneyTotalsOk(ui), { cells: ui.cells, account: ui.account, say: ui.say });
    const rebuiltSay = await page.evaluate(SAY_TIP);
    check('clamp', `${tag} broken: the pinned tip follows Today's rebuilt sentence`, sayWhole(rebuiltSay) && rebuiltSay.say === 'No desk has an exact result for today.' && pinnedSay.say !== rebuiltSay.say, { pinnedSay, rebuiltSay });
    if (!font && viewport.name === '390' && theme === 'light') await shot(page, viewport, '390-light-desk-say-tip', `Desk, broken: Today's one-line phone sentence${rebuiltSay.clamped ? ' with its ellipsis' : ''}, a tap shows it whole in the explanation tip`);
    await key(page, 'Escape');
    await leaveSay(page);
    // Measured as fresh and stale were, at the top of the page: clickSay
    // scrolled the sentence (below the whole account since JOED-153's slot)
    // to the window's middle, and the sticky header's page position is that
    // scroll, not a shift.
    check('no-shift', `${tag}: stale → broken moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    boxes.push(['broken', await rects(STATE_BOXES)]);
    await auditScreen(page, viewport, theme, 'desk (broken numbers)');
    if (!font && (viewport.name !== '1024' || theme === 'light')) await shot(page, viewport, `${viewport.name}-${theme}-desk-state-per-field`, 'Desk, numbers broken field by field: each with its own age and reason');
    await go(page, 'history');
    h = await page.evaluate(HIST_TEXT);
    check('journey', `${tag} broken: J's unavailable since-start result in History keeps its reason`, /—.*Unavailable · carrying the last good value/.test(h.j) && h.state === 'fresh', h);
    // History's own read fails: the last good series stays, with why and Retry.
    const unroute = await route([{ path: 'history.json', status: 503, body: '{"ok":false,"reason":"history_size_limit"}' }]);
    await page.evaluate('window.__joedesk.refresh()');
    await waitFor(page, `document.getElementById('histRetry')`);
    await settle(page);
    h = await page.evaluate(HIST_TEXT);
    check('AC-21', `${tag}: History refresh failure keeps the last good series, says why and offers Retry`, h.state === 'broken' && /^History refresh failed: history is full\. Showing the last good history from \d+\ss ago\.$/.test(h.status) && h.retry && h.lines >= 3, h);
    check('no-shift', `${tag}: History fresh → broken moves nothing`, !moves(hist0, await rects(HIST_SHIFT)).length, moves(hist0, await rects(HIST_SHIFT)).slice(0, 5));
    await auditScreen(page, viewport, theme, 'history (refresh failed)');
    if (!font && (viewport.name !== '1024' || theme === 'light')) await shot(page, viewport, `${viewport.name}-${theme}-history-state-refresh-failed`, 'History, refresh failed: last good series kept, Retry');
    await unroute();
    await go(page, 'desk');

    // Recovered: a complete snapshot; everything is fresh where it was.
    b.setNow(at(NOW, 120));
    check('journey', `${tag}: recovery snapshot accepted`, (await b.push(advance(base, at(NOW, 120), base.seq + 3))).status === 200);
    b.setNow(at(NOW, 125));
    await refresh(`[...document.querySelectorAll('#heroL [data-cell]')].every(c => c.dataset.state === 'fresh')`);
    ui = await page.evaluate(DESK_TEXT);
    check('journey', `${tag} recovered: every panel is fresh again`, /^Live · updated/.test(ui.label) && ui.cards.every(c => !c.lines.length && c.nums.every(x => x === 'fresh')) && ui.posState === 'fresh' &&
      /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(ui.kept), ui);
    check('no-shift', `${tag}: broken → recovered moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    boxes.push(['recovered', await rects(STATE_BOXES)]);
    // The same boxes, compared directly: position and size, never a pixel value.
    const changed = boxes.slice(1).flatMap(([state, r]) => shifted(boxes[0][1], r).map(m => ({ state, ...m })));
    check('no-shift', `${tag}: the health line and Today's sentence keep one box through not reported, fresh, stale, broken and recovered`, boxes[0][1].length === STATE_BOXES.length && !changed.length, changed.slice(0, 6));
    await go(page, 'history');
    await waitFor(page, `!document.getElementById('histRetry')`);
    await settle(page);
    h = await page.evaluate(HIST_TEXT);
    check('no-shift', `${tag}: History broken → recovered moves nothing`, h.state === 'fresh' && !moves(hist0, await rects(HIST_SHIFT)).length, { h, moved: moves(hist0, await rects(HIST_SHIFT)).slice(0, 5) });
    page.errors.length = 0;
  }
  }

  if (run('lines')) {
  // Every status sentence and age keeps fixed header/alert boxes; Today keeps two lines.
  const { snapshot, history } = scenario(NOW);
  const b = await newBoard({ history });
  b.setNow(NOW);
  check('lines', 'design snapshot accepted', (await b.push(snapshot)).status === 200);
  b.setNow(at(NOW, 9));
  const longest = fmt.age(86399);
  const sentences = [...new Set(Object.values(CELL_REASON))].map(why => `Down ${fmt.eur(88888.88)} today. Last good value, ${longest} ago · ${why}.`)
    .concat([`Down ${fmt.eur(88888.88)} today across J, Joe and Joel. Estimated from the session open at 15:30.`, 'Flat today for J, Joe and Joel.']);
  for (const width of [1440, 1181, 1180, 1024, 901, 900, 701, 700, 390]) for (const font of [null, WIDE_FONT]) {
    const viewport = { name: String(width), width, height: 900, mobile: width <= 700 };
    const tag = `${width}${font ? ' wide font' : ''}`;
    await configure(page, viewport, 'light');
    await load(page, b.url, 'desk');
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
    const r = await page.evaluate(`(() => {
      const strip = document.getElementById('statusAlert'), why = document.querySelector('#hdrHealth b'), say = document.querySelector('#heroL .say [data-clamp]');
      const boxes = () => __audit.rects(${JSON.stringify(STATE_BOXES)});
      const base = boxes();
      const out = [];
      const probe = what => {
        say.closest('[data-say]').title = say.textContent;
        const edge = strip.getBoundingClientRect().right + 0.5;
        out.push({ what: what.slice(0, 50), rects: boxes(), clamps: __audit.clamps(), over: [...strip.children].some(c => c.getBoundingClientRect().right > edge) || strip.scrollWidth > strip.clientWidth + 0.5 });
      };
      for (const line of ${JSON.stringify(HEALTH_LINES)}) { why.querySelectorAll('span').forEach(e => e.textContent = line); why.title = line; probe(line); }
      for (const text of ${JSON.stringify(sentences)}) { say.textContent = text; probe(text); }
      return { base, out };
    })()`);
    const moved = r.out.flatMap(o => shifted(r.base, o.rects).map(m => ({ what: o.what, ...m })));
    const bad = r.out.flatMap(o => o.clamps.filter(c => !c.ok).map(c => ({ what: o.what, ...c })));
    const cut = r.out.map(o => o.clamps.filter(c => c.truncated).length).reduce((a, n) => a + n, 0);
    check('lines', `${tag}: ${HEALTH_LINES.length} health reasons and ${sentences.length} sentences keep the design boxes of the health line and Today's sentence`, r.base.length === STATE_BOXES.length && r.out.length === HEALTH_LINES.length + sentences.length && !moved.length, moved.slice(0, 6));
    check('lines', `${tag}: each shows whole lines with an ellipsis and gives its full text (${cut} clamped)`, r.out.every(o => o.clamps.length === (width <= 480 ? 3 : 2)) && !bad.length, bad.slice(0, 4));
    check('lines', `${tag}: nothing overflows the health line`, !r.out.some(o => o.over), r.out.filter(o => o.over).map(o => o.what).slice(0, 4));
  }
  // For the visual check: the longest health reason and Today's longest
  // sentence put into the design state on a phone. Each ends in its ellipsis,
  // and a tap shows the sentence whole.
  const longReason = HEALTH_LINES.reduce((a, b) => (b.length > a.length ? b : a));
  const longSay = sentences.reduce((a, b) => (b.length > a.length ? b : a));
  await configure(page, VIEWPORTS[2], 'light');
  await load(page, b.url, 'desk');
  await page.evaluate(`(() => { const why = document.querySelector('#hdrHealth b'); why.querySelectorAll('span').forEach(e => e.textContent = ${JSON.stringify(longReason)}); why.title = ${JSON.stringify(longReason)};
    document.querySelector('#heroL .say [data-clamp]').textContent = ${JSON.stringify(longSay)};
    document.querySelector('#heroL .say').title = ${JSON.stringify(longSay)}; })()`);
  const clamped = await page.evaluate('__audit.clamps()');
  const longTip = await clickSay(page);
  check('lines', '390: the longest reason and sentence end in an ellipsis, and a tap shows the sentence whole', clamped.length === 3 && clamped.every(c => c.ok) && clamped.filter(c => c.lines === 1).every(c => c.truncated) && sayWhole(longTip) && longTip.say === norm(longSay), { clamped, longTip });
  await shot(page, VIEWPORTS[2], '390-light-desk-clamps', 'Desk on a phone with the longest health reason and Today’s longest sentence put in: one line each, with ellipsis and the complete sentence on tap; Since start retains its own three-line caption and explanation');
  await leaveSay(page);
  }

  if (run('nav')) {
    await headerNavChecks({ page, newBoard, check, shot });
  }

  if (run('sweep')) {
  sweepRan = true;
  const beforeSweep = { checks: results.length, screenshots: shots.length };
  const rounds = [];
  // 7c · AC-28: the 360–1440 px grid ∪ boundaries in full; PRs keep the light grid
  // and dark boundaries, per sweepPlan. Both fonts, every screen, resizing the
  // live page. The page never scrolls sideways, nothing reaches past its
  // right edge and no text overlaps other text. Up to COMPACT px the nav is the
  // phone's bottom bar; above, it is in the header, which keeps one row with
  // its fitted steps. Settings is the header's gear at every width, and every
  // header control is a 44 px target (the phone light's icon on its first
  // line). On Desk every light label,
  // with every broker word, keeps the header in its row: nothing leaves it or overlaps,
  // nothing else moves, and the label stays inside its button. Each desk
  // card's header keeps one box with its longest state and heartbeat texts.
  const { snapshot, history } = scenario(NOW);
  const b = await newBoard({ history });
  b.setNow(NOW);
  check('sweep', 'design snapshot accepted', (await b.push(snapshot)).status === 200);
  b.setNow(at(NOW, 9));
  // The header light's labels (health.js) and broker words (desk.js), and the
  // desk cards' longest state and heartbeat texts (desk.js).
  const light = { labels: HEALTH_LINES.concat(['Live · 59 s', 'Live · 9 s']), brokers: [''],
    cards: [['Sitting out since 16:02', `${fmt.age(86399)} ago`], ['Not reported', `${fmt.age(86399)} old`], ['Working', `${fmt.age(5)} ago`]] };
  for (const theme of THEMES) for (const font of [null, WIDE_FONT]) {
    await configure(page, VIEWPORTS[0], theme);
    await load(page, b.url, 'desk');
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
    for (const screen of ['desk', 'results', 'history', 'settings']) {
      const widths = sweepPlan.variants.find(v => v.theme === theme && v.wide === Boolean(font) && v.screen === screen).widths;
      await go(page, screen);
      const tag = `${theme}${font ? ' wide font' : ''} ${screen}`;
      const fail = { scroll: [], past: [], header: [], nav: [], targets: [], icons: [], overlaps: [], labels: [], cards: [], pointer: [] };
      for (const width of widths) {
        await configure(page, { name: String(width), width, height: 900, mobile: width <= 700 }, theme);
        // The pointer right after the resize, the phone↔desktop changes included.
        const media = await pointerMedia(page);
        if (media !== (width <= 700 ? TOUCH : MOUSE)) fail.pointer.push({ width, media });
        await settle(page);
        if (screen === 'desk') await setDeskDisclosures(page, true);
        const r = await page.evaluate(`__audit.sweep(${COMPACT}, ${screen === 'desk' ? JSON.stringify(light) : 'null'})`);
        rounds.push(`${theme}/${Boolean(font)}/${screen}/${width}`);
        if (r.scroll > r.inner) fail.scroll.push({ width, scroll: r.scroll });
        if (r.past.length) fail.past.push({ width, past: r.past.slice(0, 3) });
        if (r.header.length) fail.header.push({ width, header: r.header });
        if (!r.nav) fail.nav.push(width);
        if (r.targets.length) fail.targets.push({ width, targets: r.targets });
        if (r.icons.length) fail.icons.push({ width, icons: r.icons });
        if (r.overlaps.length) fail.overlaps.push({ width, overlaps: r.overlaps.slice(0, 3) });
        if (r.cards.length) fail.cards.push({ width, cards: r.cards.slice(0, 3) });
        const labels = r.labels;
        if (labels.length) fail.labels.push({ width, labels: labels.slice(0, 3) });
      }
      // Stable check identities describe the original 10 px grid. The QA plan
      // table records actual width coverage, including the dark PR subset.
      const n = `${sweepPlan.gridWidths.length} widths from 360 to 1440 px`;
      check('AC-28', `sweep ${tag}: no horizontal page scroll at any of ${n}`, !fail.scroll.length, fail.scroll.slice(0, 8));
      check('AC-28', `sweep ${tag}: nothing reaches past the page's right edge at any of ${n}`, !fail.past.length, fail.past.slice(0, 4));
      check('header', `sweep ${tag}: the status is exactly one line box; header items stay in the row without overlap or a partial wordmark at any of ${n}`, !fail.header.length, fail.header.slice(0, 4));
      check('header', `sweep ${tag}: one nav with Desk, Results and History at every width, the bottom bar up to ${COMPACT} px and the header's above, all in view; Settings is the header's gear; the shown screen is current`, !fail.nav.length, fail.nav.slice(0, 8));
      check('AC-30', `sweep ${tag}: every header control's real hit region (elementFromPoint) is whole, 44 px each way and shared with no neighbour at every width, and so is each bottom-bar button's up to ${COMPACT} px`, !fail.targets.length, fail.targets.slice(0, 4));
      check('header', `sweep ${tag}: icons are centred (the gear's too), with the phone light's icon aligned to its first line, at every width`, !fail.icons.length, fail.icons.slice(0, 4));
      check('AC-36', `sweep ${tag}: no text overlaps other text at any of ${n}`, !fail.overlaps.length, fail.overlaps.slice(0, 4));
      if (screen === 'desk') check('no-shift', `sweep ${tag}: each desk card's header keeps one box with its longest state and heartbeat texts, with one-line check-ins and a full status title; below 340 px the check-in shares the name row`, !fail.cards.length, fail.cards.slice(0, 4));
      if (screen === 'desk') check('no-shift', `sweep ${tag}: ${light.labels.length} status sentences at every width: the fixed control gives its full sentence accessibly, nothing else in the header or the page moves`, !fail.labels.length, fail.labels.slice(0, 4));
      check('touch', `sweep ${tag}: read right after each resize, the pointer is touch up to 700 px (no hover, coarse) and a mouse above (hover, fine) at every one of ${n}`, !fail.pointer.length, fail.pointer.slice(0, 8));
    }
  }
  // For the visual check: the header with the nav in it from just above the
  // bottom bar (490, 600) to the design's tablet (820, 880), Settings with its
  // gear current; then, just above the bar, the longest light label in the
  // wide font; the three-column desk cards with check-ins on the name row (1120).
  for (const [width, theme, screen] of [[490, 'light', 'desk'], [600, 'dark', 'settings'], [820, 'light', 'desk'], [880, 'dark', 'history']]) {
    const viewport = { name: String(width), width, height: 900, mobile: width <= 700 };
    await configure(page, viewport, theme);
    await load(page, b.url, screen);
    await shot(page, viewport, `${width}-${theme}-${screen}-header`, `${screen[0].toUpperCase()}${screen.slice(1)} at ${width} px: the header (brand, PAPER, Desk · Results · History, the light, the Settings gear${screen === 'settings' ? ' marked current' : ''}, the theme button), fitted to one row; no bottom bar${screen === 'desk' && width > 700 && width < 840 ? '; the two-column desk cards put the check-in on the name row' : ''}`);
  }
  const cards = { name: '1120', width: 1120, height: 900, mobile: false };
  await configure(page, cards, 'light');
  await load(page, b.url, 'desk');
  await shot(page, cards, '1120-light-desk-cards', 'Desk at 1120 px: the desktop header, and the three desk cards (under 340 px wide) with the check-in on the name row');
  const edge = { name: String(COMPACT + 10), width: COMPACT + 10, height: 900, mobile: COMPACT + 10 <= 700 };
  await configure(page, edge, 'light');
  await load(page, b.url, 'desk');
  await page.evaluate(`(() => { document.documentElement.style.setProperty('--font', ${JSON.stringify(WIDE_FONT)}); const h = document.getElementById('hdrHealth');
    h.querySelectorAll('b > span').forEach(e => e.textContent = ${JSON.stringify(light.labels[3])}); h.querySelector('b').title = ${JSON.stringify(light.labels[3])};
    h.querySelector('svg').setAttribute('class', 'i tone-warn'); h.querySelector('svg use').setAttribute('href', '#i-half');
    // Staged for the picture: the resize and clock renders keep these words.
    const html = h.innerHTML; Object.defineProperty(h, 'innerHTML', { configurable: true, get: () => html, set: () => {} }); })()`);
  await settle(page);
  await shot(page, edge, `${edge.name}-light-desk-header-longest-wide`, `Desk at ${edge.name} px in the wide font, the longest light label put in: the header's fitted steps keep one row with the nav in it; the status and broker word stay on one line inside the button`);
  sweepErrors.push(...boardSweepErrors(sweepPlan, { checks: results.length - beforeSweep.checks,
    screenshots: shots.length - beforeSweep.screenshots, rounds }));
  }

  if (run('history')) {
  // 8 · History in each P1 history fixture through the real server's store.
  for (const id of ['f-history-gap', 'i-history-size-alarm', 'f-history-partial-projection']) {
    const f = fixture(id);
    const seeded = { ...structuredClone(f.payload), receivedAt: f.receivedAt };
    measureHistory(seeded);
    const b = await newBoard({ history: seeded });
    b.setNow(f.now);
    const server = await (await fetch(`${b.url}state.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    for (const [viewport, theme] of [[VIEWPORTS[1], 'light'], [VIEWPORTS[2], 'dark']]) {
      await configure(page, viewport, theme);
      await load(page, b.url, 'history');
      await settle(page);
      const h = await page.evaluate(HIST_TEXT);
      const want = server.panels.history;
      const words = want.reason ? cellReason(want.reason) : null;
      check('history-states', `${id} @${viewport.name} ${theme}: History shows the selector's ${want.state}${words ? ` (${words})` : ''}`, h.state === want.state &&
        (want.state === 'fresh' ? !h.status && h.lines >= 1 : h.status.includes(words ?? 'History')), { h, want });
      if (viewport.name === '1024') await shot(page, viewport, `${viewport.name}-${theme}-history-state-${id}`, `History, P1 fixture ${id} (${want.state})`);
    }
  }
  // 8a · Follow while newer history arrives (JOED-145 r1), on its own board so
  // the design scenario keeps its history: every later observation is a
  // snapshot pushed through the real server, two hours after the one before.
  {
    const { snapshot, history } = scenario(NOW);
    const b = await newBoard({ history });
    b.setNow(NOW);
    check('JOED-145', 'Follow board: design snapshot accepted', (await b.push(snapshot)).status === 200);
    let last = snapshot;
    const grow = async () => {
      const when = at(last.generatedAt, 2 * 3600);
      last = advance(last, when, last.seq + 1);
      b.setNow(when);
      const r = await b.push(last);
      check('JOED-145', `Follow board: the later snapshot at ${when} is accepted`, r.status === 200, r.body);
      return Date.parse(when);
    };
    for (const [viewport, theme] of [[VIEWPORTS[1], 'light'], [VIEWPORTS[2], 'dark']]) {
      await configure(page, viewport, theme);
      await load(page, b.url, 'history');
      await settle(page);
      await historyFollowGrowthChecks({ page, viewport, theme, check, settle, grow });
    }
  }
  }

  if (run('basis')) {
  // 8b · MEDIUM regression (r2): J changes its bookkeeping basis at 13:00 UTC
  // on 14 Oct. The comparison reads exactly the rows the chart draws: zoomed
  // before the change the chart has no J observation, so no J number is
  // compared and the notice names J; otherwise its numbers are the chart's points.
  {
    const CHANGE = Date.parse('2026-10-14T13:00:00.000Z');
    const { snapshot, history } = scenario(NOW);
    for (const p of history.points) if (Date.parse(p.t) < CHANGE) p.desks.j.historyBasis = 'j.paper.v1';
    measureHistory(history);
    const b = await newBoard({ history });
    b.setNow(NOW);
    check('basis', 'design snapshot accepted on a history with a J basis change', (await b.push(snapshot)).status === 200);
    b.setNow(at(NOW, 9));
    const served = await (await fetch(`${b.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    const cols = hm.toColumns(served.points), endAt = Date.parse(at(NOW, 9)), ids = ['j', 'joe', 'joel'];
    const drawn = Object.fromEntries(ids.map(id => [id, hm.continuitySeries(cols, id, '1w', endAt).observed.filter(p => p.y !== null)]));
    // The comparison line the chart's own points give for a window, and whether its numbers are those points.
    const expected = ([x0, x1]) => {
      const r = hm.sharedWindowCompare(cols, ids, [x0, x1], endAt);
      if (!r.ok) return { r, text: null, onChart: false };
      const point = (id, iso) => drawn[id].find(p => p.x === Date.parse(iso))?.y;
      return { r, onChart: r.desks.every(d => d.start === point(d.id, r.startAt) && d.end === point(d.id, r.endAt)), text: historyChangeText(r) };
    };
    const view = `(() => { const s = document.querySelector('#histChart > svg'); return { x0: Number(s.dataset.x0), x1: Number(s.dataset.x1), label: s.getAttribute('aria-label'),
      compare: document.getElementById('histCompare').innerText, basis: document.getElementById('histBasis').innerText }; })()`;
    const zoomAt = async (fraction, notches) => {
      const box = await page.evaluate(`(() => { const r = document.getElementById('histChart').getBoundingClientRect(); return { x: r.left + 64 + (r.width - 78) * ${fraction}, y: r.top + r.height / 2 }; })()`);
      // ⌘ or Ctrl zooms; a plain vertical wheel would scroll the page.
      for (let i = 0; i < notches; i++) { await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -240, modifiers: 2 }); await settle(page); }
      await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await settle(page);
      return page.evaluate(view);
    };
    const NOTICE = /^This chart shows comparable records for J\. Older records on another bookkeeping basis stay in the history file\.$/;
    for (const viewport of VIEWPORTS) for (const theme of THEMES) {
      const tag = `basis change @${viewport.name} ${theme}`;
      await configure(page, viewport, theme);
      await load(page, b.url, 'history');
      const week = await page.evaluate(view);
      const w = expected([week.x0, week.x1]);
      check('basis', `${tag}: the week compares the chart's own points and names J's older records`, w.r.ok && Date.parse(w.r.startAt) >= CHANGE && w.onChart && norm(week.compare) === norm(w.text) &&
        NOTICE.test(week.basis.trim()), { week, expected: w });
      if (viewport.mobile) { page.errors.length = 0; continue; }
      const early = await zoomAt(0.15, 2);
      const e = expected([early.x0, early.x1]);
      const jDrawn = drawn.j.filter(p => p.x >= early.x0 && p.x <= early.x1).length;
      check('basis', `${tag}: zoomed before J's change, the chart draws no J point, so none is compared and the notice names J`, /zoomed/.test(early.label) && early.x1 < CHANGE && jDrawn === 0 &&
        !e.r.ok && e.r.reason === 'incompatible-basis' && early.compare === 'Comparing needs two moments on every chosen desk’s current bookkeeping basis.' && NOTICE.test(early.basis.trim()) && !page.errors.length, { early, expected: e, jDrawn });
      if (viewport.name === '1440') {
        await auditScreen(page, viewport, theme, 'history (zoomed before a basis change)');
        await shot(page, viewport, `${viewport.name}-${theme}-history-basis-zoomed-before`, 'History zoomed before J’s bookkeeping change: no J comparison, the notice names J');
      }
      await page.evaluate(`document.querySelector('#histRange [data-range="1w"]').click()`);
      await settle(page);
      const across = await zoomAt(0.97, 3);
      const x = expected([across.x0, across.x1]);
      check('basis', `${tag}: zoomed across J's change, the comparison's numbers are the chart's own points`, /zoomed/.test(across.label) && across.x0 < CHANGE && across.x1 > CHANGE &&
        x.r.ok && Date.parse(x.r.startAt) >= CHANGE && x.onChart && norm(across.compare) === norm(x.text) && NOTICE.test(across.basis.trim()) && !page.errors.length, { across, expected: x });
      page.errors.length = 0;
    }
    // r3 (first Linux CI run): History's read arrives well after the others,
    // as on a slower runner. Until it has, the page is not ready and does not
    // ask for desks that are already chosen; once ready, it compares the chart.
    await configure(page, VIEWPORTS[1], 'light');
    const unroute = await route([{ path: 'history.json', delay: 1500 }]);
    await page.s('Page.navigate', { url: 'about:blank' });
    await waitFor(page, `location.href === 'about:blank'`);
    await page.s('Page.navigate', { url: `${b.url}#history` });
    await waitFor(page, `window.__joedesk?.renders > 0 && !/clock/.test(document.getElementById('histCompare').innerText)`);
    const waiting = await page.evaluate(`({ ready: document.documentElement.dataset.ready ?? null, history: window.__joedesk.timings.some(t => t.reason === 'history-worker'), compare: document.getElementById('histCompare').innerText })`);
    check('basis', 'slow history read: the page is not ready before History answers and never asks for desks already chosen', waiting.ready !== '1' && !waiting.history &&
      waiting.compare === 'Not enough history in this window to compare.', waiting);
    await waitFor(page, `document.documentElement.dataset.ready === '1'`);
    await settle(page);
    const late = await page.evaluate(view), l = expected([late.x0, late.x1]);
    check('basis', 'slow history read: once ready, the week compares the chart’s own points and names J’s older records', l.r.ok && l.onChart && norm(late.compare) === norm(l.text) && NOTICE.test(late.basis.trim()) && !page.errors.length, { late, expected: l });
    await unroute();
    page.errors.length = 0;
  }
  }

  if (run('design')) {
  // 9 · Privacy stub on a non-canonical host: no data request at all.
  {
    const from = page.requests.length;
    await configure(page, VIEWPORTS[2], 'light');
    await page.s('Page.navigate', { url: `http://joedesk.example.test:${board.port}/joe/` });
    await waitFor(page, `document.documentElement.dataset.ready === 'private'`);
    const p = await page.evaluate(`({ gate: !document.getElementById('privateGate').hidden, app: document.getElementById('app').hidden, text: document.getElementById('privateGate').innerText })`);
    const reads = page.requests.slice(from).filter(r => /(state|data|history|fleet-config)\.json/.test(r.url));
    check('privacy', 'non-canonical host shows the privacy stub and reads no data', p.gate && p.app && !reads.length && /Joe lives at home\./.test(p.text), { p, reads });
    await shot(page, VIEWPORTS[2], '390-light-privacy', 'Privacy stub on a non-canonical host');
  }
  }

  if (run('budget')) {
  // 10 · Render budget (ADR §9) on the required workload at every width. CI
  // runners are slower than the reference device and vary from run to run,
  // so this gate holds the 2.5 × regression guard; the budget itself (16 ms
  // patch, no task reaching 50 ms) is measured on a reference device by
  // scripts/budget-reference.mjs.
  budgetTrace = await runBudget({ page, newBoard, check, limits: CI_GUARD });
  console.log('render trace', JSON.stringify(budgetTrace));
  }


  if (run('design')) {
  // AC-5 and AC-34: the whole run sent nothing but reads, from the page and
  // its worker alike, and no sample data is served.
  const writes = page.requests.filter(r => r.method !== 'GET');
  check('AC-5', `the board sent no request that could change anything (${page.requests.length} requests over the whole run)`, page.requests.length > 100 && !writes.length, writes);
  for (const path of ['/joe/joe-data.sample.json', '/joe/docs/examples/joe-data.sample.json', '/joe/vendor/gridstack-13.2.0-all.js']) {
    const r = await fetch(`http://127.0.0.1:${board.port}${path}`, { headers: { 'x-auth-request-user': ACTOR } });
    check('AC-34', `${path} is not served`, r.status === 404, r.status);
  }
  }
} finally {
  timing.enter('cleanup');
  await browser.close();
  for (const b of boards) await b.close();
}
const timePerGroup = groupTimingTable(timing.finish());
const sweepCoverage = boardSweepTable(sweepPlan, sweepRan);
for (const error of sweepErrors) console.error(`P3 sweep inventory: ${error}`);

const failed = results.filter(r => !r.ok);
const byAc = new Map();
for (const r of results) { const e = byAc.get(r.ac) ?? { pass: 0, fail: 0 }; e[r.ok ? 'pass' : 'fail']++; byAc.set(r.ac, e); }
const lines = [...byAc].sort().map(([ac, e]) => `| ${ac} | ${e.pass} | ${e.fail} |`);
writeFileSync(join(QA_DIR, 'index.md'), `# JoeDesk P3 · browser gate screenshots (JOED-23)

Generated by \`node scripts/browser-p3.mjs\` against the real board server with
an injected clock (Wed 14 Oct 2026, 19:42:31 Vienna), a synthetic test-only
scenario for the design views and the P1 failure fixtures for the panel
states. One headless browser, run sequentially; reduced motion for stable
geometry. Compare with \`joed-19-joedesk-approved.html\`.

${sweepCoverage}
${sweepErrors.length ? `Sweep inventory errors:\n${sweepErrors.map(error => `- ${error}`).join('\n')}\n` : ''}

## State lines: clamps, no blank lines

The health line's reason is one line at every width. A longer one ends in an
ellipsis; its title and Details give it whole. Today's sentence uses one line
inside a 44 px target up to 480 px, and two lines above it. A longer one ends in an ellipsis,
and a click, tap or keyboard focus shows it whole in the explanation tip. No
blank lines are kept for longer states. Both boxes stay the same through not
reported, fresh, stale, broken and recovered, in this machine's font and a wide
one (\`no-shift\`, \`lines\`, \`clamp\`). See \`390-light-desk-clamps.png\`,
\`390-light-desk-say-tip.png\` and \`390-dark-desk-state-a-gateway-up-but-dead.png\`.

Default phone captures at 360/390 use the \`*-desk-first-screen.png\` suffix.
All seven sections start collapsed; each compact row opens its original card.
Detailed P3 checks open the relevant disclosures before reading or measuring
them. P5 does the same for cash, nullable positions and kept holdings, and
separately checks the collapsed summaries for every non-green state.

## Header at every width (AC-28)

The header is one row at every width: brand, PAPER, Desk · Results · History,
the light, Settings as a gear and the theme button; every control is a 44 px
target. Up to ${COMPACT} px the nav is a bottom bar (a solid surface with a
hairline, padded clear of the safe area; the page ends above it). When the
measured row does not fit, fitted steps apply in order: the wordmark goes, the
nav drops its icons, gaps tighten, the nav keeps its icons alone (each keeps
its name), and last the light narrows without its chevron. The status and
broker columns reserve their widest words in the rendered font and remain on
one line. The \`routes\`, \`bar\` and \`header\` checks walk the nav, the gear,
links and Back/Forward, and measure the bar at 320–390 px and the header at
481–820 px. Up to 900 px a kept holding has two
lines. The sweep (\`sweep\`) uses the width plan above in this machine's font
and the wide one, on every screen: no horizontal page scroll, nothing past the page's right
edge, no text over other text, the header in one row with one nav, 44 px
targets and centred icons; on Desk every light label with every broker word
moves nothing. Read right after each resize, the pointer is touch up to
700 px and a mouse above, whatever pointer the host has (\`touch\`). A desk
card's state never runs under its heartbeat line: the state can end in an
ellipsis with a complete title, while the check-in stays on one line. Under
340 px it shares the name row, with the state below, as on phones. See
\`490-light-desk-header.png\`, \`600-dark-settings-header.png\`,
\`820-light-desk-header.png\`, \`880-dark-history-header.png\`,
\`320-light-desk-bottom-bar.png\`, \`390-dark-settings-bottom-bar.png\`,
\`481-light-settings-header-wide.png\`,
\`${COMPACT + 10}-light-desk-header-longest-wide.png\` and
\`1120-light-desk-cards.png\`.
${deferredLight.length ? `
Deferred, a copy decision: on phones the longest stale label ("Stale ${fmt.age(86399)}")
is wider than the light's room and leaves its button (it still moves nothing
and the page does not scroll): ${[...deferredLight.reduce((m, t) => { const [k, w] = [t.slice(0, t.lastIndexOf(' ')), t.slice(t.lastIndexOf(' ') + 1)]; m.set(k, [...(m.get(k) ?? []), w]); return m; }, new Map())].map(([k, ws]) => `${k} at ${ws.join(', ')} px`).join('; ')}.
A shorter header form, for example "Stale 23${fmt.NB}h" once the age is an hour or
more (the Desk line keeps the exact age), would fit.
` : ''}
## Checks

| Criterion | Passed | Failed |
| --- | --- | --- |
${lines.join('\n')}

${failed.length ? `### Failures\n\n${failed.map(f => `- ${f.ac} ${f.name}: \`${JSON.stringify(f.detail)?.slice(0, 300)}\``).join('\n')}\n` : 'All checks passed.\n'}
## Render budget (ADR §9)

This run: ${reference}. Fonts: the system UI stack of this machine; the
Linux CI run uses its own fonts and is the merge gate for layout.

Held here: the ${CI_GUARD.name} (a normal patch at most ${CI_GUARD.patchMs} ms,
a History draw at most ${CI_GUARD.historyMs} ms, no task reaching ${CI_GUARD.taskMs} ms). The
${REFERENCE_BUDGET.name} itself (patch under ${REFERENCE_BUDGET.patchMs} ms, no task reaching
${REFERENCE_BUDGET.taskMs} ms) is measured on a reference device by
\`node scripts/budget-reference.mjs\`.

${budgetTrace ? budgetTable(budgetTrace, CI_GUARD) : 'Not run.\n'}
## Screenshots (\`<viewport>-<theme>-<surface>.png\`)

${shots.map(s => `- \`${s.file}\` — ${s.what}`).join('\n')}

${timePerGroup}
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
console.log(timePerGroup);
console.log(sweepCoverage);
process.exit(failed.length || sweepErrors.length ? 1 : 0);
