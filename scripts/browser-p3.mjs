#!/usr/bin/env node
// P3 browser gate: the real board server, P1 fixtures and one headless browser
// at 390/1024/1440 in light and dark (AC-1, 2, 5–9, 18–21, 28–34, 36, 38–47).
// One browser, one page, run sequentially; screenshots go to the QA folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';
import * as nodeModule from 'node:module';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, scenario, NOW, at, ACTOR, valid, fixture, ingress, singleMissingDesk, coupledUnavailable, acceptSnapshot, panelStates, advance, measureHistory } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load, go, screenshot, settle, waitFor, pointerMedia, MOUSE, TOUCH, copyText } from './browser/shots.mjs';
import { runBudget, budgetTable, CI_GUARD, REFERENCE_BUDGET } from './browser/budget.mjs';
import { TERMS } from '../public/joe/terms.js';
import { createGate, proportional, shifted, WIDE_FONT } from './browser/gate.mjs';

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
const { cellReason, CELL_REASON, REASON_COPY, statusSentence, boardHealthPresentation, statusPresentation } = await import('../public/joe/health.js');
const fmt = await import('../public/joe/format.js');
const { decimalUnits, divRound, UNIT } = await import('../contracts/decimal.mjs');
const { boardCaptionCell, sharesBoardCaption } = await import('../public/joe/desk.js');
const HEALTH_LINES = Object.keys(REASON_COPY).map(reason => statusSentence({ reason, tone: reason === 'board_ok' ? 'green' : 'red' }, { receipt: 9, gatewayAge: 179 }));

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p3');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const { results, shots, check, shot, auditScreen } = createGate(QA_DIR);
const SHIFT_SELECTORS = ['header.top', '#statusAlert', '#deskHero', '#heroL .primary', '#heroL .pct-slot', '#heroL .board-caption', '#heroL .kpi', '#heroL .display', '.dcard', '.dcard .dnums > div', '.dcard .chart', '#positions', '.prow', '#kept', 'footer.foot'];

async function deskChecks(page, viewport, theme, expectedMini, snapshot) {
  const tag = `${viewport.name} ${theme} desk`;
  const d = await page.evaluate(`(() => {
    const t = s => document.querySelector(s)?.innerText.trim() ?? '';
    const header = document.querySelector('header.top').innerText;
    const rest = [...document.querySelectorAll('main, .bottom-nav')].map(e => e.innerText).join(' ');
    return {
      header, boardOkElsewhere: /Board OK/.test(rest), strip: t('#healthPop .health-facts'), freshCheckins: [...document.querySelectorAll('.dcard .hb')].some(e => e.textContent.trim()),
      display: t('#heroL .display'), kpis: [...document.querySelectorAll('#heroL .kpi')].map(k => ({ cell: k.dataset.cell, state: k.dataset.state, dt: k.querySelector('dt').innerText, value: k.querySelector('dd .bn, .cash-amount')?.innerText, cap: k.querySelector('.cash-caption')?.innerText ?? k.querySelector('.c').innerText })),
      heroLayout: (() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
        return { hero: rect(document.getElementById('deskHero')), primary: rect(document.querySelector('.hero-primary')), right: rect(document.querySelector('.hero-r')), chart: rect(document.getElementById('heroChart')), row: rect(document.querySelector('#heroL .kpis')), figures: [...document.querySelectorAll('#heroL .kpi')].map(rect) };
      })(),
      primary: [...document.querySelectorAll('#heroL .primary')].map(k => ({ cell: k.dataset.cell, label: k.querySelector('.term').textContent, value: k.querySelector('.bn').innerText, pct: k.querySelector('.performance-pct')?.textContent,
        top: k.getBoundingClientRect().top, left: k.getBoundingClientRect().left, width: k.getBoundingClientRect().width, size: parseFloat(getComputedStyle(k.querySelector('.display')).fontSize) })),
      order: [...document.querySelectorAll('.dcard')].map(c => c.id.slice(5)),
      states: [...document.querySelectorAll('.dcard .state')].map(s => ({ icon: Boolean(s.querySelector('svg use')), text: s.innerText.trim() })),
      positions: [...document.querySelectorAll('#positions .prow:not(.hd) .name b')].map(b => b.textContent),
      kept: [...document.querySelectorAll('#kept [data-keep]')].map(r => ({ sym: r.dataset.keep, label: /Kept\\s· not traded by any desk/.test(r.innerText), interactive: r.querySelectorAll('a, button, input, select, textarea, summary, details, label, [tabindex], [onclick], [role=button], [role=link], [title], [href]:not(use)').length,
        pointer: [r, ...r.querySelectorAll('*')].some(n => getComputedStyle(n).cursor === 'pointer'), hover: r.matches(':hover') })),
      keptCap: t('#kept .keep-cap'), keptState: t('#kept .pstate'), notJoe: document.body.innerText.includes('not traded by Joe'),
      mini: [...document.querySelectorAll('.chart.mini > svg')].map(s => ({ id: s.closest('.dcard').id.slice(5), estimates: s.querySelectorAll('[data-estimate]').length, values: (s.dataset.values ?? '').split(' ').filter(Boolean).map(Number) })),
      dbars: [...document.querySelectorAll('.dbar i[data-v]')].map(i => i.getAttribute('style')),
    }; })()`);
  check('AC-18', `${tag}: one live header control and no fresh card check-ins or visible status strip`, /Live/.test(d.header) && !d.boardOkElsewhere && !d.freshCheckins && !await page.evaluate(`Boolean(document.querySelector('#health, .hstrip, #footData'))`), d);
  const kpiNames = d.kpis.map(k => k.dt);
  check('AC-19', `${tag}: Today and Since start remain primary, with four supporting figures and their captions intact`, Boolean(d.display) && d.primary.length === 2 && d.primary.map(p => p.label).join() === 'Today,Since start' && d.kpis.length === 4 && kpiNames.join() === 'Open positions,Desks’ money,Paper account,Cash' &&
    d.kpis[0].cap === 'still moving until closed' && /started with € 15\.000/.test(d.kpis[1].cap) && d.kpis[2].cap === 'includes the kept holdings' && d.kpis[3].cap === 'cash · as the broker reports it' &&
    await page.evaluate(`document.querySelector('[data-cell="hero.since"] .c').innerText === 'after fees'`), { primary: d.primary, kpis: d.kpis });
  const day = decimalUnits(snapshot.totals.dayPnl.amount), equity = decimalUnits(snapshot.totals.equity.amount), since = decimalUnits(snapshot.totals.totalPnl.amount);
  const percent = (result, base) => { const n = divRound(result * 10000n, base); return `${n < 0n ? '−' : n > 0n ? '+' : ''}${fmt.digits(n * UNIT / 100n)} %`; };
  check('AC-19', `${tag}: primary euros and percentages use the exact start-of-day and since-start bases`, d.primary[0].value.replace(/\s/g, '') === fmt.eur(day, true).replace(/\s/g, '') && d.primary[1].value.replace(/\s/g, '') === fmt.eur(since, true).replace(/\s/g, '') &&
    d.primary[0].pct === percent(day, equity - day) && d.primary[1].pct === percent(since, decimalUnits('15000')), d.primary);
  const layout = d.heroLayout, close = (a, b) => Math.abs(a - b) <= 0.5;
  const supportingLayout = viewport.mobile
    ? layout.primary.bottom <= layout.row.top && layout.row.bottom <= layout.right.top && layout.figures[0].top === layout.figures[1].top && layout.figures[2].top > layout.figures[0].top && layout.figures[3].top > layout.figures[2].top
    : close(layout.primary.top, layout.right.top) && layout.primary.right < layout.right.left && close(layout.primary.bottom, layout.chart.bottom) && layout.row.top >= Math.max(layout.primary.bottom, layout.right.bottom) && close(layout.row.left, layout.primary.left) && close(layout.row.right, layout.right.right) &&
      (viewport.name === '1440' ? layout.hero.height <= 590 && layout.figures.every(f => close(f.top, layout.figures[0].top)) : close(layout.figures[0].top, layout.figures[1].top) && close(layout.figures[2].top, layout.figures[3].top) && layout.figures[2].top > layout.figures[0].top);
  check('AC-19', `${tag}: primary figures share one level with Today larger; the secondary row spans both balanced columns (1440 hero ≤590 px), wraps 2×2 at 1024 and precedes the chart on phones`, d.primary[0].top === d.primary[1].top && d.primary[0].left + d.primary[0].width <= d.primary[1].left && d.primary[0].size > d.primary[1].size && supportingLayout, { primary: d.primary, layout });
  const ranked = snapshot.desks.map((desk, i) => ({ id: desk.id, i, result: decimalUnits(desk.money.totalPnl.amount) })).sort((a, b) => a.result === b.result ? a.i - b.i : a.result > b.result ? -1 : 1).map(desk => desk.id);
  check('AC-20', `${tag}: desks rank by exact since-start result, with no unsupported per-desk percentages`, d.order.join() === ranked.join() && await page.evaluate(`!document.querySelector('.dcard .performance-pct')`), { actual: d.order, expected: ranked });
  check('AC-20', `${tag}: desk state is icon + word`, d.states.length === 3 && d.states.every(s => s.icon && /^(Working|Sitting out|Stuck)/.test(s.text)), d.states);
  check('AC-20', `${tag}: the Today bars are zero-centred on one scale`, d.dbars.length >= 2 && d.dbars.every(s => /(left|right):50%/.test(s)) && !proportional(await page.evaluate(`__audit.bars('.dbar i[data-v]')`), 'today'), d.dbars);
  const plotted = d.mini.map(m => ({ id: m.id, got: m.values, want: expectedMini[m.id] }));
  check('AC-20', `${tag}: desk sparklines plot exactly the observed session closes and the current value`, d.mini.length === 3 && d.mini.every(m => m.estimates === 0) &&
    plotted.every(p => p.got.length === p.want.length && p.got.every((v, k) => Math.abs(v - p.want[k]) < 0.005)), plotted);
  const worth = await page.evaluate(`__audit.bars('.vbar i[data-v]')`);
  check('AC-42', `${tag}: worth bars proportional within each currency`, viewport.mobile || (worth.length >= 2 && !proportional(worth, 'worth')), worth);
  check('AC-7', `${tag}: kept symbols only under Kept holdings`, !d.positions.some(s => ['SXR8', 'TSLA'].includes(s)) && d.kept.map(k => k.sym).join() === 'SXR8,TSLA' && d.kept.every(k => k.label) && !d.notJoe, { positions: d.positions, kept: d.kept });
  check('AC-8', `${tag}: kept rows are inert`, d.kept.every(k => k.interactive === 0 && !k.pointer), d.kept);
  check('AC-9', `${tag}: kept values counted only in the paper account`, /Left out of every desk result and of Results; counted in the paper account \(€\s31\.482,75\)/.test(d.keptCap) &&
    /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(d.keptState) &&
    d.kpis[1].value.replace(/\s/g, '') === '€14.997,18' && d.kpis[2].value.replace(/\s/g, '') === '€31.482,75', { cap: d.keptCap, state: d.keptState, equity: d.kpis[1].value });

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
  const code = { Enter: 13, Tab: 9, Escape: 27 }[name];
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}

// AC-39 on every visible term, not a sample: keyboard focus shows its own
// explanation; on desktop, hovering does too.
async function everyTerm(page, viewport, tag, scope = '') {
  // Programmatic activeElement changes in an unfocused headless page need
  // not dispatch native focus events. Give this keyboard test page focus.
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  const focused = await page.evaluate(`(async () => {
    const out = [], heads = ${JSON.stringify(Object.fromEntries(Object.entries(TERMS).map(([key, entry]) => [key, entry[0]])))};
    const visible = () => [...document.querySelectorAll(${JSON.stringify(`${scope} [data-term]`)})].filter(__audit.visible);
    // A tick can rebuild a section between terms. Keep identities (including
    // repeated terms), not nodes which may be detached by the next frame.
    const counts = new Map();
    const terms = visible().map(t => { const term = t.dataset.term, index = counts.get(term) ?? 0; counts.set(term, index + 1); return { term, index }; });
    for (const { term, index } of terms) {
      const until = Date.now() + 2000;
      let seen, t;
      do {
        t = visible().filter(e => e.dataset.term === term)[index];
        if (t && document.activeElement !== t) t.focus({ preventScroll: true });
        const tip = document.getElementById('tip');
        const conditions = { pageFocused: document.hasFocus(), connected: Boolean(t?.isConnected), focused: Boolean(t && document.activeElement === t),
          tipOpen: tip.classList.contains('on'), ownHead: tip.querySelector('b')?.textContent === heads[term],
          expanded: t?.getAttribute('aria-expanded') === 'true' };
        seen = { term, index, head: tip.querySelector('b')?.textContent ?? null, expectedHead: heads[term],
          expanded: t?.getAttribute('aria-expanded') ?? null, conditions, failed: Object.keys(conditions).filter(k => !conditions[k]) };
        if (!seen.failed.length || Date.now() >= until) break;
        await new Promise(r => setTimeout(r, 25));
      } while (true);
      out.push(seen);
      t?.blur();
    }
    return out;
  })()`);
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
    const c = await page.evaluate(`(() => { const s = document.querySelector('#histChart > svg'); return { base: Number(s.dataset.base), lo: Number(s.dataset.ylo), hi: Number(s.dataset.yhi), est: s.querySelectorAll('[data-estimate]').length, lines: s.querySelectorAll('path[stroke^="var(--desk-"]').length }; })()`);
    check('AC-21', `${tag} ${range}: y span ≥ 1 % of the first visible money`, c.hi - c.lo >= c.base * 0.01 - 1e-6 && c.base > 14000 / 3 && c.lines >= 3, c);
    if (range === '1w') check('AC-21', `${tag}: the outage is drawn as a dotted estimate`, c.est >= 3, c);
    if (range === '1m') check('AC-21', `${tag}: the month range leads in from the assumed € 5.000, dotted`, c.est >= 3, c);
  }
  await page.evaluate(`document.querySelector('#histRange [data-range="1w"]').click()`);
  await settle(page);
  const parts = await page.evaluate(`({ compare: document.getElementById('histCompare').innerText, j: document.getElementById('jAcct').innerText, capt: Boolean(document.querySelector('#jAcct svg.capt')), events: document.querySelectorAll('#events li').length, legend: document.getElementById('histLegend').innerText })`);
  check('AC-21', `${tag}: compare, J's bookkeeping, captured results and desk changes`, /^From .* J [+−]?\d/.test(parts.compare) && /Counted from/.test(parts.j) && parts.capt && parts.events >= 1 && /Estimated gap/.test(parts.legend), parts);
  if (!viewport.mobile) {
    const box = await page.evaluate(`(() => { const r = document.querySelector('#histChart').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height / 2 }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -240 });
    await settle(page);
    const zoomed = await page.evaluate(`({ reset: !document.getElementById('resetZoom').disabled, label: document.querySelector('#histChart > svg').getAttribute('aria-label'), span: Number(document.querySelector('#histChart > svg').dataset.yhi) - Number(document.querySelector('#histChart > svg').dataset.ylo), base: Number(document.querySelector('#histChart > svg').dataset.base) })`);
    check('AC-21', `${tag}: wheel zoom on desktop, Reset zoom enabled, scale still honest`, zoomed.reset && /zoomed/.test(zoomed.label) && zoomed.span >= zoomed.base * 0.01 - 1e-6, zoomed);
    const windowOf = `(() => { const s = document.querySelector('#histChart > svg'); return { x0: Number(s.dataset.x0), x1: Number(s.dataset.x1), w: document.getElementById('histChart').getBoundingClientRect().width, label: s.getAttribute('aria-label') }; })()`;
    const before = await page.evaluate(windowOf);
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', modifiers: 8, clickCount: 1 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 120, y: box.y, button: 'left', modifiers: 8 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 120, y: box.y, button: 'left', modifiers: 8, clickCount: 1 });
    await settle(page);
    const panned = await page.evaluate(windowOf);
    // Dragging 120 px right moves the window earlier by 120 px of time, same width.
    const expectShift = 120 / (before.w - 78) * (before.x1 - before.x0);
    check('AC-21', `${tag}: shift-drag pans the window by the dragged distance, keeping its width`, /zoomed/.test(panned.label) &&
      Math.abs((before.x0 - panned.x0) - expectShift) < expectShift * 0.05 + 1000 && Math.abs((panned.x1 - panned.x0) - (before.x1 - before.x0)) < 1000, { before, panned, expectShift });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await settle(page);
    const tip = await page.evaluate(`(() => { const t = document.getElementById('histTip'); return { on: t.classList.contains('on'), ...__audit.opaque(t), text: t.innerText }; })()`);
    check('AC-41', `${tag}: the history tip is opaque`, tip.on && tip.bgAlpha === 1 && tip.opacity === 1, tip);
    if (viewport.name === '1440') await shot(page, viewport, `${viewport.name}-${theme}-history-zoomed`, 'History zoomed with the crosshair tip');
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await page.evaluate(`document.getElementById('resetZoom').click()`);
    await settle(page);
    check('AC-21', `${tag}: Reset zoom returns to the range`, await page.evaluate(`document.getElementById('resetZoom').disabled`));
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
const run = name => !ONLY.length || ONLY.includes(name);

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
// The widest window with the compact header (app.css).
const COMPACT = 960;
const DESK_SHIFT = [...SHIFT_SELECTORS, '#hdrHealth', '#heroL .say', '#heroL .kpi .c', '#positions .pstate', '#kept .keep-cap', '#kept .pstate', '#kept .prow'];
const HIST_SHIFT = ['.hist-tools', '.hcard', '#histChart', '#histCompare', '.hist-help', '.hist-cols', '#jAcct', '#jAcct .facts-dl', '#events', 'footer.foot'];
// Copy assertions treat phone NBSP-dot and desktop space-dot as the same
// words. P6 separately asserts the actual nonbreaking DOM characters.
const copyExpression = expression => `(${copyText.toString()})(${expression})`;
const DESK_TEXT = copyExpression(`(() => ({
  label: document.querySelector('#hdrHealth .status-full').textContent, ring: document.querySelector('#heroSession b')?.innerText,
  cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(c => [c.dataset.cell, { state: c.dataset.state, cap: c.querySelector('.c')?.innerText ?? null }])),
  cards: [...document.querySelectorAll('.dcard')].map(c => ({ id: c.id.slice(5), lines: [...c.querySelectorAll('.mini-label .st')].map(n => n.innerText), label: c.querySelector('.mini-label').innerText, nums: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), icons: c.querySelectorAll('.cell-state').length })),
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
  if (run('design')) {
  // 1 · The full design scenario at every viewport and theme.
  const { snapshot, history } = scenario(NOW);
  board = await newBoard({ history });
  board.setNow(NOW);
  const pushed = await board.push(snapshot);
  if (pushed.status !== 200) throw new Error(`scenario push failed: ${JSON.stringify(pushed.body)}`);
  board.setNow(at(NOW, 9));
  const served = await (await fetch(`${board.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
  const servedCols = hm.toColumns(served.points);
  const expectedMini = Object.fromEntries(['j', 'joe', 'joel'].map(id => [id, [...hm.sessionCloses(servedCols, id, 'totalPnl', 9).map(c => c.v), Number(snapshot.desks.find(d => d.id === id).money.totalPnl.amount)]]));
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
      if (screen === 'desk') await deskChecks(page, viewport, theme, expectedMini, snapshot);
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
    const before = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
    // A pinned explanation in Today survives the rebuild of Today.
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

  if (run('fixtures')) {
  // 3 · P1 fixtures through the real server: fresh, stale with age, not
  // reported and broken with a reason, each panel on its own; no blank page.
  const CELL = { 'hero.day': 'today.dayPnl', 'hero.open': 'today.openPnl', 'hero.since': 'today.totalPnl', 'hero.equity': 'today.equity', 'hero.account': 'paperAccount' };
  const CASES = [
    ['e-layout-storage-unavailable', 'fresh', 'Board OK'], ['b-session-open-estimate', 'fresh', 'Board OK'], ['stale-receive-age', 'stale', 'Stale 1 min'],
    ['c-frozen-producer', 'stale', 'Stale 2 min'], ['missing-runtime-and-results', 'not reported', 'Board OK'], ['a-gateway-up-but-dead', 'broken', 'Needs fix'],
    ['a-missing-gateway', 'broken', 'Needs fix'], ['a-frozen-ready-gateway', 'broken', 'Needs fix'], ['b-incomplete-family', 'broken', 'Data delayed'],
    ['b-equity-null-gateway-ready', 'broken', 'Data delayed'], ['b-weekend-no-sod', 'broken', 'Data delayed'], ['j-ny-midnight-gap', 'broken', 'Data delayed'],
    ['h-keep-policy-mismatch', 'broken', 'Needs fix'], ['c-old-producer-image', 'broken', 'Needs fix'], ['unknown-schema', 'broken', 'Needs fix'],
    ['a-dead-session-current-money', 'broken', 'Needs fix'], ['h-secondary-position-source', 'broken', 'Needs fix'], ['i-oversize-data', 'broken', 'Needs fix'],
    ['g-expired-sso', 'broken', 'Data delayed'], ['d-routing-stub', 'broken', 'Data delayed'],
    ['p3-single-missing-desk', 'broken', 'Data delayed'], ['p3-coupled-unavailable', 'broken', 'Data delayed'],
  ];
  // ADR deferred P3 rows, derived from valid.json; expected states come from
  // the shared selector exactly as the P1 fixture runner computes them.
  const DERIVED = { 'p3-single-missing-desk': singleMissingDesk, 'p3-coupled-unavailable': coupledUnavailable };
  const derive = id => {
    const f = DERIVED[id]();
    const feeds = { 'fleet-config': { value: valid['fleet-config'], receivedAt: valid.data.receivedAt }, data: acceptSnapshot('data', ingress(valid.data), null, valid.data.receivedAt) };
    const previous = panelStates(feeds, valid.data.receivedAt);
    feeds.data = acceptSnapshot('data', f.payload, feeds.data, f.receivedAt);
    return { ...f, id, expectedStatus: 200, expected: panelStates(feeds, f.now, previous) };
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
    const expectedCells = panelStates(expectedFeeds, expectedNow, previousStates);
    const expectedContext = { states: expectedCells, feeds: expectedFeeds, now: expectedNow };
    const expectedStatus = statusPresentation(expectedContext);
    const boardCaption = boardCaptionCell(expectedContext);
    const b = await newBoard({ fleetConfig: f.fleetConfig ?? null });
    b.setNow(valid.data.receivedAt);
    await b.push(ingress(valid.data));
    if (!f.transportReason && f.feed === 'data') { b.setNow(f.receivedAt); const r = await b.push(f.payload, 'data', { status: f.expectedStatus, reason: f.expectedStatus === 200 ? null : f.expected['today.equity'].reason }); check('fixtures', `${id}: server status ${f.expectedStatus}`, r.status === f.expectedStatus, r.body); }
    const viewports = id === 'e-layout-storage-unavailable' ? VIEWPORTS : id === 'a-gateway-up-but-dead' ? [VIEWPORTS[1], VIEWPORTS[2]] : [VIEWPORTS[1]];
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
      const ui = await page.evaluate(`(() => ({
        label: document.querySelector('#hdrHealth').dataset.reason, sentence: document.querySelector('#hdrHealth').title,
        compact: (() => { const e = document.querySelector('#hdrHealth .status-compact'); return __audit.visible(e) ? e.textContent : null; })(),
        visibleSentence: (() => { const full = document.querySelector('#hdrHealth .status-full'), line = document.getElementById('statusAlertText');
          return [full, line].filter(__audit.visible).map(e => e.textContent); })(),
        cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(k => [k.dataset.cell, { state: k.dataset.state, cap: k.querySelector('.c')?.innerText ?? '' }])),
        desks: [...document.querySelectorAll('.dcard')].map(c => ({ id: c.id.slice(5), name: c.querySelector('h3')?.innerText, nums: c.querySelectorAll('.dnums > div').length, states: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), status: c.querySelector('.mini-label').innerText, icons: c.querySelectorAll('.cell-state').length })),
        boardCaption: document.querySelector('#heroL .board-caption').innerText,
        alertGeometry: (() => { const line = document.getElementById('statusAlert'), button = document.getElementById('statusAlertControl'), text = document.getElementById('statusAlertText');
          const r = text.getBoundingClientRect(), hero = document.getElementById('deskHero').getBoundingClientRect();
          return { visible: line.hasAttribute('data-visible'), size: getComputedStyle(text).fontSize, bodySize: getComputedStyle(document.body).fontSize,
            icon: button.querySelector('use').getAttribute('href'), target: button.getBoundingClientRect().height, gap: hero.top - r.bottom }; })(),
        positions: document.getElementById('positions').innerText.trim(), kept: document.getElementById('kept').innerText.trim(), strip: document.querySelector('#healthPop .health-facts').textContent,
        say: document.querySelector('#heroL .say').innerText,
        sections: { positions: document.querySelector('#positions .pstate')?.dataset.state, kept: document.querySelector('#kept .pstate')?.dataset.state },
      }))()`);
      const tag = `${id} @${viewport.name}`;
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
      check('fixtures', `${tag}: no panel or page blanks`, Object.keys(ui.cells).length === 5 && ui.desks.length === 3 && ui.desks.every(d => d.name && d.nums === 3) && ui.positions && ui.kept && ui.strip && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
      const expected = f.expected;
      const mismatch = Object.entries(CELL).filter(([key, panel]) => ui.cells[key].state !== expected[panel].state).map(([key, panel]) => ({ key, ui: ui.cells[key].state, want: expected[panel].state }));
      const deskMismatch = ui.desks.flatMap(d => ['dayPnl', 'openPnl', 'totalPnl'].map((f2, k) => [d.id, f2, d.states[k]]))
        .filter(([desk, field, state]) => state !== expected[`desks.${desk}.${field}`].state);
      check('fixtures', `${tag}: every money cell shows its own panel state`, !mismatch.length && !deskMismatch.length, { mismatch, deskMismatch });
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
      const missingReasons = ui.desks.flatMap(d => ['dayPnl', 'openPnl', 'totalPnl'].map(field => expectedCells[`desks.${d.id}.${field}`])
        .filter(cell => cell.state !== 'fresh' && !sharesBoardCaption(cell, boardCaption)).map(cell => (cell.reason ? cellReason(cell.reason) : 'not reported')).filter(words => !d.status.includes(words)).map(words => ({ desk: d.name, words, status: d.status })));
      check('fixtures', `${tag}: every differing desk number keeps its own reason and every affected number keeps a state icon`, !missingReasons.length && ui.desks.every(d => d.icons === d.states.filter(state => state !== 'fresh').length), missingReasons.slice(0, 3));
      const repeated = Object.entries(CELL).filter(([key, panel]) => key !== 'hero.day' && sharesBoardCaption(expectedCells[panel], boardCaption) && ui.cells[key].cap);
      check('fixtures', `${tag}: matching money captions appear once on the board`, !repeated.length && (!boardCaption || ui.boardCaption.includes(cellReason(boardCaption.reason))), { repeated, caption: ui.boardCaption });
      const caps = norm([ui.boardCaption, ui.say, ...Object.values(ui.cells).map(c => c.cap)].join(' | '));
      if (kind === 'stale') check('fixtures', `${tag}: stale shows its age and reason`, /[Aa]s of \d+\s(s|min) ago · updates are (late|stuck)/.test(caps), caps);
      if (kind === 'not reported') check('fixtures', `${tag}: not reported reads plainly`, ui.cells['hero.account'].cap === 'Not reported', caps);
      if (kind === 'broken') check('fixtures', `${tag}: broken shows its reason`, /Last good value, .* · |Unavailable · /.test(caps), caps);
      if (['e-layout-storage-unavailable', 'stale-receive-age', 'a-gateway-up-but-dead', 'b-incomplete-family', 'missing-runtime-and-results', 'c-old-producer-image', 'g-expired-sso', 'p3-single-missing-desk'].includes(id) && (viewport.name !== '390' || ['e-layout-storage-unavailable', 'a-gateway-up-but-dead'].includes(id))) {
        await shot(page, viewport, `${viewport.name}-${theme}-desk-state-${id}`, `Desk, P1 fixture ${id} (${kind})`);
      }
      if (storageScript) await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier: storageScript });
      if (unroute) await unroute();
      if (f.transportReason === 'auth_required') await page.setHeaders({ 'x-auth-request-user': ACTOR });
      page.errors.length = 0;
    }
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
      const ui = await page.evaluate(`({ label: document.querySelector('#hdrHealth .status-full').textContent, display: document.querySelector('#heroL .display').innerText, caps: [...document.querySelectorAll('#heroL .kpi[data-cell] .c')].map(c => c.innerText), states: [...document.querySelectorAll('#heroL [data-cell]')].map(c => c.dataset.state), now: [...document.querySelectorAll('.dcard .now')].map(n => n.innerText), cards: [...document.querySelectorAll('.dcard .mini-label')].map(n => n.innerText), nums: [...document.querySelectorAll('.dcard .dnums > div')].map(d => d.dataset.state), positions: document.getElementById('positions').innerText, kept: document.querySelector('#kept .pstate').innerText, pop: document.getElementById('healthPop').textContent })`);
      const [state, caption, cardLine, posLine, keptLine] = live
        ? ['broken', 'Unavailable · last update was rejected', 'Numbers: unavailable · last update was rejected', 'Position detail is unavailable: last update was rejected.', 'Kept holdings are unavailable: last update was rejected.']
        : ['not reported', 'Not reported · no data received yet', 'Numbers: not reported · no data received yet', 'Position detail is not present in this snapshot.', 'Kept holdings are not present in this snapshot.'];
      check(live ? 'AC-6' : 'nodata', `${tag}: NO DATA everywhere, in the selector's own state`, ui.label === 'No board data' && ui.display === '—' && ui.states.every(x => x === state) && ui.nums.every(x => x === state) &&
        ui.caps.every(c => norm(c) === caption) && ui.cards.every(c => norm(c) === cardLine) && ui.now.every(n => n === 'Waiting for the first valid snapshot.') && ui.positions.includes(posLine) && ui.kept === keptLine &&
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
        const cellsOk = Object.values(ui.cells).every(c => c.state === 'broken') && Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').every(([, c]) => c.cap === `Unavailable · ${words}`);
        check('cold', `${tag}: no clock, yet every panel shows broken with its reason`, ui.label === 'No board data' && ui.ring === 'Time not known' && cellsOk && ui.say === `No numbers: ${words}.` &&
          ui.cards.every(c => c.label === `Numbers: unavailable · ${words}` && c.nums.every(x => x === 'broken')) && ui.positions === `Position detail is unavailable: ${words}.` &&
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
      check('cold', `${tag}: Desk shows not found per panel, with the market clock from History's read`, ui.ring !== 'Time not known' && Object.values(ui.cells).every(c => c.state === 'broken') &&
        ui.cards.every(c => c.label === 'Numbers: unavailable · not found on the board server'), ui);
      await unroute();
      page.errors.length = 0;
    }
  }
  }

  if (run('passthrough')) {
  // 6 · HIGH regression: P1 states pass through unchanged. A replayed push
  // keeps its last good values as stale (never broken), with their own age.
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
      const CELL = { 'hero.day': 'today.dayPnl', 'hero.open': 'today.openPnl', 'hero.since': 'today.totalPnl', 'hero.equity': 'today.equity', 'hero.account': 'paperAccount' };
      const wrong = Object.entries(CELL).filter(([k, panel]) => ui.cells[k].state !== server.panels[panel].state || server.panels[panel].state !== 'stale').map(([k, panel]) => ({ k, ui: ui.cells[k].state, p1: server.panels[panel].state }));
      check('passthrough', `${tag}: every cell keeps the selector's stale state`, !wrong.length && ui.cards.every(c => c.nums.every(x => x === 'stale')) && ui.posState === 'stale' && ui.keptState === 'stale', { wrong, cards: ui.cards });
      const caps = Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').map(([, c]) => c.cap);
      check('passthrough', `${tag}: the shared replay caption says last good and its age once; sections retain their own captions`, /^Last good value, 3\d\ss ago · last update repeated an old one$/.test(ui.boardCaption) && caps.every(c => c === '') &&
        ui.cards.every(c => c.label === 'since start · last sessions' && c.icons === 3) && /^Last good positions, 3\d\ss ago · last update repeated an old one$/.test(ui.positions) &&
        /^Last good values, 3\d\ss ago · last update repeated an old one · worth €\s12\.248,00 and \$\s441,20, each in its own currency$/.test(ui.kept), { caps, cards: ui.cards.map(c => c.label), positions: ui.positions, kept: ui.kept });
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
    check('journey', `${tag} stale: one board caption gives the matching age/reason; every number retains its state and icon`, Object.values(ui.cells).every(c => c.state === 'stale') && Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').every(([, c]) => c.cap === '') && late.test(ui.boardCaption) &&
      / today\.$/.test(ui.say) && ui.cards.every(c => c.label === 'since start · last sessions' && c.icons === 3) && /^As of 1\smin ago · updates are late$/.test(ui.positions) &&
      /^As of 1\smin ago · updates are late · worth €\s12\.248,00 and \$\s441,20, each in its own currency$/.test(ui.kept), ui);
    check('no-shift', `${tag}: fresh → stale moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    boxes.push(['stale', await rects(STATE_BOXES)]);
    if (!font && viewport.name !== '1024') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-stale`, 'Desk, stale: every panel with its age and reason');
    await go(page, 'history');
    let h = await page.evaluate(HIST_TEXT);
    check('journey', `${tag} stale: History and J's result say as of 1 min and why`, h.state === 'stale' && /^History as of 1\smin ago · updates are late\.$/.test(h.status) && !h.retry && /J since 10\sSep\s+[+−]?€\s[\d.,]+\s·\sAs of 1\smin ago · updates are late/.test(h.j), h);
    check('no-shift', `${tag}: fresh → stale moves nothing on History`, !moves(hist0, await rects(HIST_SHIFT)).length, moves(hist0, await rects(HIST_SHIFT)).slice(0, 5));
    await go(page, 'desk');
    // Today's sentence pinned whole in the tip stays pinned through the
    // rebuild and then shows the new sentence.
    const pinnedSay = await clickSay(page);
    check('clamp', `${tag} stale: a click or tap shows Today's sentence whole`, sayWhole(pinnedSay), pinnedSay);

    // Broken, field by field: Joe's Today stops at +80 s, Joe's open result
    // and J's total at +110 s, so each keeps a different age and reason.
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
    const today = /^Today: last good, 1\smin ago · waiting on the start-of-day value$/, open = /^Open positions: last good, 3\d\ss ago · open result not available$/;
    check('journey', `${tag} broken: each affected desk number has its own line, age and reason`, j.lines.length === 3 && today.test(j.lines[0]) && open.test(j.lines[1]) &&
      /^Since 10\sSep: last good, 3\d\ss ago · carrying the last good value$/.test(j.lines[2]) && [joe, joel].every(c => c.lines.length === 2 && today.test(c.lines[0]) && open.test(c.lines[1])) &&
      JSON.stringify(j.nums) === '["broken","broken","broken"]' && [joe, joel].every(c => JSON.stringify(c.nums) === '["broken","broken","fresh"]'), ui.cards);
    check('journey', `${tag} broken: Today's numbers keep their own ages and reasons`, ui.cells['hero.day'].state === 'broken' && /Last good value, 1\smin ago · waiting on the start-of-day value/.test(ui.say) &&
      /^Last good value, 3\d\ss ago · open result not available$/.test(ui.cells['hero.open'].cap) && /^Last good value, 3\d\ss ago · desk total incomplete$/.test(ui.cells['hero.since'].cap) &&
      ui.cells['hero.equity'].state === 'fresh' && ui.cells['hero.account'].state === 'fresh', { cells: ui.cells, say: ui.say });
    check('no-shift', `${tag}: stale → broken moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    boxes.push(['broken', await rects(STATE_BOXES)]);
    const rebuiltSay = await page.evaluate(SAY_TIP);
    check('clamp', `${tag} broken: the pinned tip follows Today's rebuilt sentence`, sayWhole(rebuiltSay) && /waiting on the start-of-day value\.$/.test(rebuiltSay.say), { pinnedSay, rebuiltSay });
    if (!font && viewport.name === '390' && theme === 'light') await shot(page, viewport, '390-light-desk-say-tip', `Desk, broken: Today's sentence at two lines${rebuiltSay.clamped ? ' with its ellipsis' : ''}, a tap shows it whole in the explanation tip`);
    await key(page, 'Escape');
    await leaveSay(page);
    await auditScreen(page, viewport, theme, 'desk (broken numbers)');
    if (!font && (viewport.name !== '1024' || theme === 'light')) await shot(page, viewport, `${viewport.name}-${theme}-desk-state-per-field`, 'Desk, numbers broken field by field: each with its own age and reason');
    await go(page, 'history');
    h = await page.evaluate(HIST_TEXT);
    check('journey', `${tag} broken: J's result in History keeps its own age and reason`, /Last good value, 3\d\ss ago · carrying the last good value/.test(h.j) && h.state === 'fresh', h);
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
    check('lines', `${tag}: each shows whole lines with an ellipsis and gives its full text (${cut} clamped)`, r.out.every(o => o.clamps.length === 2) && !bad.length, bad.slice(0, 4));
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
    document.querySelector('#heroL .say [data-clamp]').textContent = ${JSON.stringify(longSay)}; })()`);
  const clamped = await page.evaluate('__audit.clamps()');
  const longTip = await clickSay(page);
  check('lines', '390: the longest reason and sentence end in an ellipsis, and a tap shows the sentence whole', clamped.length === 2 && clamped.every(c => c.ok && c.truncated) && sayWhole(longTip) && longTip.say === norm(longSay), { clamped, longTip });
  await shot(page, VIEWPORTS[2], '390-light-desk-clamps', 'Desk on a phone with the longest health reason and Today’s longest sentence put in: one line and two lines, each with its ellipsis; the tap shows the sentence whole (the reason is whole in its title and Details)');
  await leaveSay(page);
  }

  if (run('sweep')) {
  // 7c · AC-28 at every width: from 360 to 1440 px in 10 px steps, light and
  // dark, in this machine's font and the wide one, every screen, resizing the
  // live page. The page never scrolls sideways, nothing reaches past its
  // right edge and no text overlaps other text. Up to COMPACT px the header
  // is the phone's (the nav in the bottom bar, 44 px buttons, the light's
  // icon on its first line); above, the desktop one. On Desk every light label,
  // with every broker word, keeps the header in its row: nothing leaves it or overlaps,
  // nothing else moves, and the label stays inside its button. Each desk
  // card's header keeps one box with its longest state and heartbeat texts.
  const { snapshot, history } = scenario(NOW);
  const b = await newBoard({ history });
  b.setNow(NOW);
  check('sweep', 'design snapshot accepted', (await b.push(snapshot)).status === 200);
  b.setNow(at(NOW, 9));
  const widths = Array.from({ length: (1440 - 360) / 10 + 1 }, (_, i) => 360 + i * 10);
  // The header light's labels (health.js) and broker words (desk.js), and the
  // desk cards' longest state and heartbeat texts (desk.js).
  const light = { labels: HEALTH_LINES.concat(['Live · 59 s', 'Live · 9 s']), brokers: [''],
    cards: [['Sitting out since 16:02', `${fmt.age(86399)} ago`], ['Not reported', `${fmt.age(86399)} old`], ['Working', `${fmt.age(5)} ago`]] };
  for (const theme of THEMES) for (const font of [null, WIDE_FONT]) {
    await configure(page, VIEWPORTS[0], theme);
    await load(page, b.url, 'desk');
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${JSON.stringify(font)})`); await settle(page); }
    for (const screen of ['desk', 'results', 'history', 'settings']) {
      await go(page, screen);
      const tag = `${theme}${font ? ' wide font' : ''} ${screen}`;
      const fail = { scroll: [], past: [], header: [], nav: [], targets: [], icons: [], overlaps: [], labels: [], cards: [], pointer: [] };
      for (const width of widths) {
        await configure(page, { name: String(width), width, height: 900, mobile: width <= 700 }, theme);
        // The pointer right after the resize, the phone↔desktop changes included.
        const media = await pointerMedia(page);
        if (media !== (width <= 700 ? TOUCH : MOUSE)) fail.pointer.push({ width, media });
        await settle(page);
        const r = await page.evaluate(`__audit.sweep(${COMPACT}, ${screen === 'desk' ? JSON.stringify(light) : 'null'})`);
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
      const n = `${widths.length} widths from 360 to 1440 px`;
      check('AC-28', `sweep ${tag}: no horizontal page scroll at any of ${n}`, !fail.scroll.length, fail.scroll.slice(0, 8));
      check('AC-28', `sweep ${tag}: nothing reaches past the page's right edge at any of ${n}`, !fail.past.length, fail.past.slice(0, 4));
      check('header', `sweep ${tag}: the status is exactly one line box; header items stay in the row without overlap or a partial wordmark at any of ${n}`, !fail.header.length, fail.header.slice(0, 4));
      check('header', `sweep ${tag}: one nav at every width, the bottom bar up to ${COMPACT} px and the header's above, all four screens in view`, !fail.nav.length, fail.nav.slice(0, 8));
      check('AC-30', `sweep ${tag}: the compact header's buttons and the bottom bar are 44 px targets up to ${COMPACT} px`, !fail.targets.length, fail.targets.slice(0, 4));
      check('header', `sweep ${tag}: icons are centred, with the phone light's icon aligned to its first line, at every width`, !fail.icons.length, fail.icons.slice(0, 4));
      check('AC-36', `sweep ${tag}: no text overlaps other text at any of ${n}`, !fail.overlaps.length, fail.overlaps.slice(0, 4));
      if (screen === 'desk') check('no-shift', `sweep ${tag}: each desk card's header keeps one box with its longest state and heartbeat texts, with one-line check-ins and a full status title; below 340 px the check-in shares the name row`, !fail.cards.length, fail.cards.slice(0, 4));
      if (screen === 'desk') check('no-shift', `sweep ${tag}: ${light.labels.length} status sentences at every width: the fixed control gives its full sentence accessibly, nothing else in the header or the page moves`, !fail.labels.length, fail.labels.slice(0, 4));
      check('touch', `sweep ${tag}: read right after each resize, the pointer is touch up to 700 px (no hover, coarse) and a mouse above (hover, fine) at every one of ${n}`, !fail.pointer.length, fail.pointer.slice(0, 8));
    }
  }
  // For the visual check: the compact header (720, 800, 880) and, just above
  // it, the desktop header with the longest light label in the wide font;
  // the three-column desk cards with check-ins on the name row (1120).
  for (const [width, theme, screen] of [[720, 'light', 'desk'], [800, 'dark', 'desk'], [880, 'light', 'desk'], [880, 'dark', 'history']]) {
    const viewport = { name: String(width), width, height: 900, mobile: false };
    await configure(page, viewport, theme);
    await load(page, b.url, screen);
    await shot(page, viewport, `${width}-${theme}-${screen}-header`, `${screen[0].toUpperCase()}${screen.slice(1)} at ${width} px: the compact header (brand, PAPER, the light with its broker word, 44 px theme button) and the nav in the bottom bar${screen === 'desk' && width < 840 ? '; the two-column desk cards put the check-in on the name row' : ''}`);
  }
  const cards = { name: '1120', width: 1120, height: 900, mobile: false };
  await configure(page, cards, 'light');
  await load(page, b.url, 'desk');
  await shot(page, cards, '1120-light-desk-cards', 'Desk at 1120 px: the desktop header, and the three desk cards (under 340 px wide) with the check-in on the name row');
  const edge = { name: String(COMPACT + 10), width: COMPACT + 10, height: 900, mobile: false };
  await configure(page, edge, 'light');
  await load(page, b.url, 'desk');
  await page.evaluate(`(() => { document.documentElement.style.setProperty('--font', ${JSON.stringify(WIDE_FONT)}); const h = document.getElementById('hdrHealth');
    h.querySelectorAll('b > span').forEach(e => e.textContent = ${JSON.stringify(light.labels[3])}); h.querySelector('b').title = ${JSON.stringify(light.labels[3])};
    h.querySelector('svg').setAttribute('class', 'i tone-warn'); h.querySelector('svg use').setAttribute('href', '#i-half');
    // Staged for the picture: the resize and clock renders keep these words.
    const html = h.innerHTML; Object.defineProperty(h, 'innerHTML', { configurable: true, get: () => html, set: () => {} }); })()`);
  await settle(page);
  await shot(page, edge, `${edge.name}-light-desk-header-longest-wide`, `Desk at ${edge.name} px in the wide font, the longest light label put in: the brand yields and gaps tighten as needed; the status and broker word stay on one line inside the button`);
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
    const LABEL = { j: 'J', joe: 'Joe', joel: 'Joel' };
    const drawn = Object.fromEntries(ids.map(id => [id, hm.continuitySeries(cols, id, '1w', endAt).observed.filter(p => p.y !== null)]));
    // The comparison line the chart's own points give for a window, and whether its numbers are those points.
    const expected = ([x0, x1]) => {
      const r = hm.sharedWindowCompare(cols, ids, [x0, x1], endAt);
      if (!r.ok) return { r, text: null, onChart: false };
      const point = (id, iso) => drawn[id].find(p => p.x === Date.parse(iso))?.y;
      return { r, onChart: r.desks.every(d => d.start === point(d.id, r.startAt) && d.end === point(d.id, r.endAt)),
        text: `From ${fmt.dayDDM(r.startAt)}, ${fmt.timeHM(r.startAt)} to ${fmt.dayDDM(r.endAt)}, ${fmt.timeHM(r.endAt)}: ${r.desks.map(d => `${LABEL[d.id]} ${fmt.pct(d.pct, 2, true)}`).join(' · ')}` };
    };
    const view = `(() => { const s = document.querySelector('#histChart > svg'); return { x0: Number(s.dataset.x0), x1: Number(s.dataset.x1), label: s.getAttribute('aria-label'),
      compare: document.getElementById('histCompare').innerText, basis: document.getElementById('histBasis').innerText }; })()`;
    const zoomAt = async (fraction, notches) => {
      const box = await page.evaluate(`(() => { const r = document.getElementById('histChart').getBoundingClientRect(); return { x: r.left + 64 + (r.width - 78) * ${fraction}, y: r.top + r.height / 2 }; })()`);
      for (let i = 0; i < notches; i++) { await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -240 }); await settle(page); }
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
      await page.evaluate(`document.getElementById('resetZoom').click()`);
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
  await browser.close();
  for (const b of boards) await b.close();
}

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

## State lines: clamps, no blank lines

The health line's reason is one line at every width. A longer one ends in an
ellipsis; its title and Details give it whole. Today's sentence is two lines at
every width (one box, twice its line height). A longer one ends in an ellipsis,
and a click, tap or keyboard focus shows it whole in the explanation tip. No
blank lines are kept for longer states. Both boxes stay the same through not
reported, fresh, stale, broken and recovered, in this machine's font and a wide
one (\`no-shift\`, \`lines\`, \`clamp\`). See \`390-light-desk-clamps.png\`,
\`390-light-desk-say-tip.png\` and \`390-dark-desk-state-a-gateway-up-but-dead.png\`.

## Header at every width (AC-28)

Up to ${COMPACT} px the header is the phone's: brand, PAPER, the light (with its
broker word above 700 px) and a 44 px theme button; the nav is the bottom bar.
Above ${COMPACT} px it is the desktop header. The wordmark yields to its icon
when its flex slot is too small; if needed, measured overflow tightens gaps
and padding. The status and broker columns reserve their widest words in the
rendered font and remain on one line. Up to 900 px a kept holding has two
lines. The sweep (\`sweep\`) walks every width from 360 to
1440 px in 10 px steps, light and dark, in this machine's font and the wide
one, on every screen: no horizontal page scroll, nothing past the page's right
edge, no text over other text, the header in one row with one nav, 44 px
targets and centred icons; on Desk every light label with every broker word
moves nothing. Read right after each resize, the pointer is touch up to
700 px and a mouse above, whatever pointer the host has (\`touch\`). A desk
card's state never runs under its heartbeat line: the state can end in an
ellipsis with a complete title, while the check-in stays on one line. Under
340 px it shares the name row, with the state below, as on phones. See
\`720-light-desk-header.png\`, \`800-dark-desk-header.png\`,
\`880-light-desk-header.png\`, \`880-dark-history-header.png\`,
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
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
process.exit(failed.length ? 1 : 0);
