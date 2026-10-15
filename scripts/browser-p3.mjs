#!/usr/bin/env node
// P3 browser gate: the real board server, P1 fixtures and one headless browser
// at 390/1024/1440 in light and dark (AC-1, 2, 5–9, 18–21, 28–34, 36, 38–47).
// One browser, one page, run sequentially; screenshots go to the QA folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, cpus } from 'node:os';
import { join } from 'node:path';
import * as nodeModule from 'node:module';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, scenario, largeScenario, NOW, at, ACTOR, valid, fixture, ingress, singleMissingDesk, coupledUnavailable, acceptSnapshot, panelStates, advance, wideSnapshot, measureHistory } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load, go, screenshot, settle, waitFor } from './browser/shots.mjs';
import { TERMS } from '../public/joe/terms.js';

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
const { cellReason } = await import('../public/joe/health.js');
const fmt = await import('../public/joe/format.js');

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p3');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const results = [];
const shots = [];
function check(ac, name, ok, detail) {
  results.push({ ac, name, ok: Boolean(ok), detail });
  if (!ok) console.error(`FAIL ${ac} ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail).slice(0, 2400)}`}`);
}
const shot = async (page, viewport, name, what) => {
  const file = join(QA_DIR, `${name}.png`);
  await screenshot(page, viewport, file);
  shots.push({ file: `${name}.png`, what });
};

const TERM_PATTERN = /\b(P&L|IB|HALT|FIFO|FX|KEEP|Stage 0|NAV|Gateway|Snapshot|Expectancy|Profit factor|drawdown|Realised|Unrealised|Heartbeat|agenix|Janus|Quota|OPS-\d+|Propagate|Fleet Config|SOD|YTD|Wk \d+)\b/;
const GLYPHS = /[▲▼►◄✓✔✕✖★☆⚠ⓘ◷⏸⛔→←↑↓↗↘•›‹»«÷]/;
const SPLIT_UNIT = /\d (s|min|h|%|desks?|trades?|days?|sessions?)(?![\w])|[€$] [−+\-]?\d/;
const IMPLEMENTER = /\b(TODO|FIXME|HOSTD-\d+|JOED-\d+|NIX-\d+|undefined|NaN|lorem|\[object)\b/i;
const GERMAN = /\b(und|nicht|oder|Konto|Ergebnis|Gewinn|Verlust|heute|gestern)\b/;
const ACTION = /\b(place|cancel|flatten|pause|restart|buy|sell|liquidate|close position|halt|switch to live)\b/i;
const SHIFT_SELECTORS = ['header.top', '#health', '#deskHero', '#heroL .kpi', '#heroL .display', '.dcard', '.dcard .dnums > div', '.dcard .chart', '#positions', '.prow', '#kept', 'footer.foot'];

async function auditScreen(page, viewport, theme, screen) {
  const tag = `${viewport.name} ${theme} ${screen}`;
  const label = await page.evaluate(`(() => { const m = document.getElementById('modeLabel'), r = m.getBoundingClientRect(), cs = getComputedStyle(m);
    const probe = document.createElement('i'); probe.style.color = 'var(--paper-bg)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove();
    return { text: m.textContent.trim(), icon: Boolean(m.querySelector('use[href="#i-paper"]')), bg: cs.backgroundColor, want, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }; })()`);
  check('AC-1', `${tag}: PAPER label at the top`, label.text === 'PAPER' && label.icon && label.bg === label.want && label.inView, label);
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
  await settle(page);
  const bottom = await page.evaluate(`(() => { const r = document.getElementById('modeLabel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`);
  check('AC-1', `${tag}: PAPER label after scrolling to the end`, bottom);
  await page.evaluate('window.scrollTo(0, 0)');
  await settle(page);
  const live = await page.evaluate(`({ live: document.querySelectorAll('.mode-label.live').length, header: document.querySelector('header.top').innerText })`);
  check('AC-2', `${tag}: no LIVE treatment`, live.live === 0 && !/LIVE/.test(live.header), live);
  const h = await page.evaluate('__audit.horizontal()');
  check('AC-28', `${tag}: no horizontal scroll`, h.scroll <= h.inner && (!viewport.mobile || (h.inner === 390 && h.gutter === 16)), h);
  const contrast = await page.evaluate('__audit.contrast()');
  check('AC-29', `${tag}: text contrast ≥ 4.5:1`, !contrast.length, contrast.slice(0, 6));
  if (viewport.mobile) {
    const targets = await page.evaluate('__audit.targets()');
    check('AC-30', `${tag}: 44 px targets`, !targets.length, targets.slice(0, 6));
    const termCount = await page.evaluate(`[...document.querySelectorAll('.term, .learn')].filter(__audit.visible).length`);
    check('AC-43', `${tag}: ${termCount} term and Learn hit areas are 44 px or more`, !targets.some(t => /term|learn/.test(t.el)), targets.filter(t => /term|learn/.test(t.el)));
  }
  const gui = await page.evaluate('__audit.gui27()');
  check('AC-32', `${tag}: no italics, one-sided borders, pills or uppercase eyebrows`, !gui.italics.length && !gui.borders.length && !gui.pills.length && !gui.uppercase.length, { italics: gui.italics, borders: gui.borders, pills: gui.pills.slice(0, 4), upper: gui.uppercase });
  check('AC-44', `${tag}: cards only for primary objects, at most two other boxes`, gui.cards.every(c => !c.startsWith('OTHER')) && gui.boxes.length <= 2, { cards: [...new Set(gui.cards)], boxes: gui.boxes });
  const clipping = await page.evaluate('__audit.clipping()');
  check('AC-36', `${tag}: nothing clips or ellipsises`, !clipping.length, clipping.slice(0, 6));
  const text = await page.evaluate('__audit.text()');
  const plain = text.filter(t => !t.term).map(t => t.text).join(' ');
  const all = text.map(t => t.text).join(' ');
  const termHit = plain.match(TERM_PATTERN);
  check('AC-38', `${tag}: trade terms only inside Term or Learn`, !termHit, termHit?.[0]);
  check('AC-40', `${tag}: no text glyph used as an icon`, !GLYPHS.test(all), all.match(GLYPHS)?.[0]);
  const rendered = text.map(t => t.text).join('');
  check('AC-47', `${tag}: numbers never part from their units`, !SPLIT_UNIT.test(rendered), rendered.match(SPLIT_UNIT)?.[0]);
  check('AC-32', `${tag}: English only, no implementer strings`, !IMPLEMENTER.test(all) && !GERMAN.test(all), all.match(IMPLEMENTER)?.[0] ?? all.match(GERMAN)?.[0]);
  const terms = await page.evaluate('__audit.terms()');
  const badTerm = terms.find(t => t.style !== 'dotted' || t.thickness !== '1px' || t.offset !== '3px' || !(t.alpha >= 0.3 && t.alpha <= 0.6));
  check('AC-47', `${tag}: term underlines are faint, dotted, 1 px, offset 3 px`, (terms.length > 0 || screen === 'settings') && !badTerm, badTerm);
  const charts = await page.evaluate('__audit.charts()');
  const badChart = charts.find(c => (c.zero ? !(c.lo <= 0 && c.hi >= 0) : c.base !== null && !((c.hi - c.lo) >= Math.abs(c.base) * 0.01 - 1e-6)));
  check('AC-42', `${tag}: charts are to scale`, !badChart, badChart ?? charts.length);
  const icons = await page.evaluate(`[...document.querySelectorAll('button')].filter(b => __audit.visible(b) && !b.textContent.trim() && !b.getAttribute('aria-label')).map(b => b.outerHTML.slice(0, 80))`);
  check('AC-33', `${tag}: every icon-only button has a label`, !icons.length, icons);
  const actions = await page.evaluate(`[...document.querySelectorAll('button, a[href], input, select')].filter(b => __audit.visible(b) && !b.closest('.term, .learn') && !b.matches('.term, .learn')).map(b => (b.textContent + ' ' + (b.getAttribute('aria-label') ?? '')).trim())`);
  const acting = actions.filter(t => ACTION.test(t));
  check('AC-5', `${tag}: no control acts on money, orders or the desks`, !acting.length, acting);
}

const proportional = (bars, label) => {
  const groups = new Map();
  for (const b of bars) if (b.v) { const key = b.cur; groups.set(key, [...(groups.get(key) ?? []), b.w / Math.abs(b.v)]); }
  for (const [cur, ratios] of groups) {
    if (ratios.length < 2) continue;
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / Math.max(...ratios);
    if (spread > 0.03) return { label, cur, spread };
  }
  return null;
};
const shifted = (a, b, keys = ['top', 'left', 'height', 'width']) => {
  const byKey = new Map(b.map(r => [r.key, r]));
  const moved = [];
  for (const r of a) {
    const o = byKey.get(r.key);
    if (!o) { moved.push({ key: r.key, gone: true }); continue; }
    for (const k of keys) if (Math.abs(r[k] - o[k]) > 0.5) moved.push({ key: r.key, k, from: r[k], to: o[k] });
  }
  if (a.length !== b.length) moved.push({ count: [a.length, b.length] });
  return moved;
};

async function deskChecks(page, viewport, theme, expectedMini) {
  const tag = `${viewport.name} ${theme} desk`;
  const d = await page.evaluate(`(() => {
    const t = s => document.querySelector(s)?.innerText.trim() ?? '';
    const header = document.querySelector('header.top').innerText;
    const rest = [...document.querySelectorAll('main, .bottom-nav')].map(e => e.innerText).join(' ');
    return {
      header, boardOkElsewhere: /Board OK/.test(rest), strip: t('#health'),
      display: t('#heroL .display'), kpis: [...document.querySelectorAll('#heroL .kpi')].map(k => ({ cell: k.dataset.cell, state: k.dataset.state, dt: k.querySelector('dt').innerText, value: k.querySelector('dd .bn')?.innerText, cap: k.querySelector('.c').innerText })),
      states: [...document.querySelectorAll('.dcard .state')].map(s => ({ icon: Boolean(s.querySelector('svg use')), text: s.innerText.trim() })),
      positions: [...document.querySelectorAll('#positions .prow:not(.hd) .name b')].map(b => b.textContent),
      kept: [...document.querySelectorAll('#kept [data-keep]')].map(r => ({ sym: r.dataset.keep, label: r.innerText.includes('Kept · not traded by any desk'), interactive: r.querySelectorAll('a, button, input, select, textarea, summary, details, label, [tabindex], [onclick], [role=button], [role=link], [title], [href]:not(use)').length,
        pointer: [r, ...r.querySelectorAll('*')].some(n => getComputedStyle(n).cursor === 'pointer'), hover: r.matches(':hover') })),
      keptCap: t('#kept .keep-cap'), keptState: t('#kept .pstate'), notJoe: document.body.innerText.includes('not traded by Joe'),
      mini: [...document.querySelectorAll('.chart.mini > svg')].map(s => ({ estimates: s.querySelectorAll('[data-estimate]').length, values: (s.dataset.values ?? '').split(' ').filter(Boolean).map(Number) })),
      dbars: [...document.querySelectorAll('.dbar i[data-v]')].map(i => i.getAttribute('style')),
    }; })()`);
  check('AC-18', `${tag}: Board OK only in the header; the Desk line starts with the reason`, /Board OK/.test(d.header) && !d.boardOkElsewhere && d.strip.startsWith('Numbers up to date'), { header: d.header, strip: d.strip.slice(0, 60) });
  const kpiNames = d.kpis.map(k => k.dt);
  check('AC-19', `${tag}: Today shows five figures with their captions`, Boolean(d.display) && d.kpis.length === 4 && kpiNames[0] === 'Open positions' && /^Since 10 Sep$/.test(kpiNames[1]) && kpiNames[2] === 'Desks’ money' && kpiNames[3] === 'Paper account' &&
    d.kpis[0].cap === 'still moving until closed' && d.kpis[1].cap === 'after fees' && /started with € 15\.000/.test(d.kpis[2].cap) && d.kpis[3].cap === 'includes the kept holdings', d.kpis);
  check('AC-20', `${tag}: desk state is icon + word`, d.states.length === 3 && d.states.every(s => s.icon && /^(Working|Sitting out|Stuck)/.test(s.text)), d.states);
  check('AC-20', `${tag}: the Today bars are zero-centred on one scale`, d.dbars.length >= 2 && d.dbars.every(s => /(left|right):50%/.test(s)) && !proportional(await page.evaluate(`__audit.bars('.dbar i[data-v]')`), 'today'), d.dbars);
  const plotted = d.mini.map((m, i) => ({ id: ['j', 'joe', 'joel'][i], got: m.values, want: expectedMini[['j', 'joe', 'joel'][i]] }));
  check('AC-20', `${tag}: desk sparklines plot exactly the observed session closes and the current value`, d.mini.length === 3 && d.mini.every(m => m.estimates === 0) &&
    plotted.every(p => p.got.length === p.want.length && p.got.every((v, k) => Math.abs(v - p.want[k]) < 0.005)), plotted);
  const worth = await page.evaluate(`__audit.bars('.vbar i[data-v]')`);
  check('AC-42', `${tag}: worth bars proportional within each currency`, viewport.mobile || (worth.length >= 2 && !proportional(worth, 'worth')), worth);
  check('AC-7', `${tag}: kept symbols only under Kept holdings`, !d.positions.some(s => ['SXR8', 'TSLA'].includes(s)) && d.kept.map(k => k.sym).join() === 'SXR8,TSLA' && d.kept.every(k => k.label) && !d.notJoe, { positions: d.positions, kept: d.kept });
  check('AC-8', `${tag}: kept rows are inert`, d.kept.every(k => k.interactive === 0 && !k.pointer), d.kept);
  check('AC-9', `${tag}: kept values counted only in the paper account`, /Left out of every desk result and of Results; counted in the paper account \(€\s31\.482,75\)/.test(d.keptCap) &&
    /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(d.keptState) &&
    d.kpis[2].value.replace(/\s/g, '') === '€14.997,18' && d.kpis[3].value.replace(/\s/g, '') === '€31.482,75', { cap: d.keptCap, state: d.keptState, equity: d.kpis[2].value });

  // Details popover: opaque, anchored, closes on Escape, moves nothing.
  const before = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  await page.evaluate(`document.getElementById('healthMore').click()`);
  await settle(page);
  const pop = await page.evaluate(`({ ...__audit.opaque(document.getElementById('healthPop')), text: document.getElementById('healthPop').innerText })`);
  check('AC-41', `${tag}: health details are opaque`, pop.bgAlpha === 1 && pop.opacity === 1 && pop.visible === 'visible', pop);
  check('AC-18', `${tag}: details use today's copy`, /Board OK · numbers are up to date/.test(pop.text) && /If a light turns yellow or red: reload once/.test(pop.text), pop.text.slice(0, 200));
  if (viewport.name !== '390' || theme === 'light') await shot(page, viewport, `${viewport.name}-${theme}-desk-details`, 'Desk with the health details open');
  const during = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
  check('AC-18', `${tag}: opening the details moves nothing`, !shifted(before, during).length, shifted(before, during).slice(0, 4));
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await settle(page);
  check('AC-33', `${tag}: Escape closes the details and keeps focus`, await page.evaluate(`!document.getElementById('healthPop').classList.contains('on') && document.activeElement?.id === 'healthMore'`));
  // The details dialog by keyboard: Enter moves focus in, Tab stays inside,
  // Escape closes and focus returns to Details.
  await page.evaluate(`document.getElementById('healthMore').focus()`);
  await key(page, 'Enter');
  await settle(page);
  const opened = await page.evaluate(`({ on: document.getElementById('healthPop').classList.contains('on'), active: document.activeElement?.id, modal: document.getElementById('healthPop').getAttribute('aria-modal'), expanded: document.getElementById('healthMore').getAttribute('aria-expanded') })`);
  const inside = [];
  for (const shift of [false, false, false, true, true]) {
    await key(page, 'Tab', shift ? 8 : 0);
    inside.push(await page.evaluate(`document.getElementById('healthPop').contains(document.activeElement) ? (document.activeElement.id || document.activeElement.textContent.trim().slice(0, 20)) : 'OUT:' + (document.activeElement?.id || document.activeElement?.tagName)`));
  }
  await key(page, 'Escape');
  await settle(page);
  const closed = await page.evaluate(`({ on: document.getElementById('healthPop').classList.contains('on'), active: document.activeElement?.id, expanded: document.getElementById('healthMore').getAttribute('aria-expanded') })`);
  check('AC-33', `${tag}: the details dialog takes focus, keeps Tab inside, and Escape returns focus`, opened.on && opened.active === 'healthPop' && opened.modal === 'true' && opened.expanded === 'true' &&
    inside.every(x => !x.startsWith('OUT:')) && !closed.on && closed.active === 'healthMore' && closed.expanded === 'false', { opened, inside, closed });

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

  // Hero chart crosshair tip is opaque.
  if (!viewport.mobile) {
    const box = await page.evaluate(`(() => { const r = document.querySelector('#heroChart > svg').getBoundingClientRect(); return { x: r.left + r.width * 0.35, y: r.top + r.height / 2 }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await settle(page);
    const ctip = await page.evaluate(`(() => { const t = document.querySelector('#heroChart .ctip'); return { on: t.classList.contains('on'), ...__audit.opaque(t), text: t.innerText }; })()`);
    check('AC-41', `${tag}: the chart tip is opaque`, ctip.on && ctip.bgAlpha === 1 && ctip.opacity === 1, ctip);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
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

async function key(page, name, modifiers = 0) {
  const code = { Enter: 13, Tab: 9, Escape: 27 }[name];
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, modifiers });
}

// AC-39 on every visible term, not a sample: keyboard focus shows its own
// explanation; on desktop, hovering does too.
async function everyTerm(page, viewport, tag) {
  const focused = await page.evaluate(`(async () => {
    const out = [];
    for (const t of [...document.querySelectorAll('[data-term]')].filter(__audit.visible)) {
      t.focus({ preventScroll: true });
      await new Promise(r => requestAnimationFrame(r));
      const tip = document.getElementById('tip');
      out.push({ term: t.dataset.term, on: tip.classList.contains('on'), head: tip.querySelector('b')?.textContent, expanded: t.getAttribute('aria-expanded') });
      t.blur();
    }
    return out;
  })()`);
  const badFocus = focused.filter(f => !f.on || f.head !== TERMS[f.term]?.[0] || f.expanded !== 'true');
  check('AC-39', `${tag}: all ${focused.length} terms explain themselves on keyboard focus`, focused.length > 0 && !badFocus.length, badFocus.slice(0, 4));
  if (viewport.mobile) return;
  const count = await page.evaluate(`[...document.querySelectorAll('[data-term]')].filter(__audit.visible).length`);
  const badHover = [];
  for (let i = 0; i < count; i++) {
    const box = await page.evaluate(`(() => { const t = [...document.querySelectorAll('[data-term]')].filter(__audit.visible)[${i}]; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, term: t.dataset.term }; })()`);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    const tip = await page.evaluate(`({ on: document.getElementById('tip').classList.contains('on'), head: document.getElementById('tip').querySelector('b')?.textContent })`);
    if (!tip.on || tip.head !== TERMS[box.term][0]) badHover.push({ ...box, ...tip });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  }
  await page.evaluate('window.scrollTo(0, 0)');
  await settle(page);
  check('AC-39', `${tag}: all ${count} terms explain themselves on hover`, count > 0 && !badHover.length, badHover.slice(0, 4));
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
  check('P4-notwired', `${tag}: Results shows its not-wired state with dashes, no zeros`, /Results are not wired yet\. The board has no closed-trade record for this period\./.test(r.hero) && r.tiles.length === 8 && r.tiles.every(t => t === '—') && !/€ 0,00/.test(r.hero), r);
  await page.evaluate(`document.querySelector('#periodSeg [data-period="month"]').click()`);
  await settle(page);
  await page.evaluate(`document.querySelector('#deskSeg [data-desk="joe"]').click()`);
  await settle(page);
  const after = await page.evaluate(`__audit.rects(${JSON.stringify(sel)})`);
  const label = await page.evaluate(`document.getElementById('perLabel').innerText`);
  check('P4-notwired', `${tag}: period and desk switches work and move nothing`, label.startsWith('This month') && !shifted(before, after).length, { label, moved: shifted(before, after).slice(0, 4) });
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
const boards = [];
async function newBoard(options) { const b = await startBoard(options); boards.push(b); return b; }
const rects = selectors => page.evaluate(`__audit.rects(${JSON.stringify(selectors)})`);
// Answer chosen reads of the page and of its worker without the server: a
// fixed status and body with no clock header, a failed connection, a redirect.
async function route(rules) {
  const handler = m => {
    if (m.method !== 'Fetch.requestPaused' || !page.owns(m.sessionId)) return;
    const rule = rules.find(r => m.params.request.url.includes(r.path));
    const id = { requestId: m.params.requestId };
    if (!rule) { browser.send('Fetch.continueRequest', id, m.sessionId).catch(() => {}); return; }
    if (rule.fail) { browser.send('Fetch.failRequest', { ...id, errorReason: rule.fail }, m.sessionId).catch(() => {}); return; }
    browser.send('Fetch.fulfillRequest', { ...id, responseCode: rule.status, responseHeaders: rule.headers ?? [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(rule.body ?? '').toString('base64') }, m.sessionId).catch(() => {});
  };
  browser.on(handler);
  await page.setFetch(rules.map(r => ({ urlPattern: `*${r.path}*` })));
  return async () => { await page.setFetch(null); browser.off(handler); };
}
const DESK_SHIFT = [...SHIFT_SELECTORS, '.hstrip', '#heroL .say', '#heroL .kpi .c', '#positions .pstate', '#kept .keep-cap', '#kept .pstate', '#kept .prow'];
const HIST_SHIFT = ['.hist-tools', '.hcard', '#histChart', '#histCompare', '.hist-help', '.hist-cols', '#jAcct', '#jAcct .facts-dl', '#events', 'footer.foot'];
const DESK_TEXT = `(() => ({
  label: document.querySelector('#hdrHealth b').innerText, ring: document.querySelector('#heroSession b')?.innerText,
  cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(c => [c.dataset.cell, { state: c.dataset.state, cap: c.querySelector('.c')?.innerText ?? null }])),
  cards: [...document.querySelectorAll('.dcard')].map(c => ({ lines: [...c.querySelectorAll('.mini-label .st')].map(n => n.innerText), label: c.querySelector('.mini-label').innerText, nums: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state) })),
  positions: document.querySelector('#positions .pstate')?.innerText, posState: document.querySelector('#positions .pstate')?.dataset.state,
  kept: document.querySelector('#kept .pstate')?.innerText, keptState: document.querySelector('#kept .pstate')?.dataset.state,
  strip: document.getElementById('health').innerText, foot: document.getElementById('footData').innerText, say: document.querySelector('#heroL .say').innerText,
}))()`;
const HIST_TEXT = `(() => ({ status: document.querySelector('#histStatus .st')?.innerText.trim() ?? '', state: document.querySelector('#histStatus .hist-state')?.dataset.state ?? 'fresh',
  retry: Boolean(document.getElementById('histRetry')), j: document.querySelector('#jAcct .facts-dl')?.innerText ?? '', lines: document.querySelectorAll('#histChart > svg path[stroke^="var(--desk-"]').length,
  estimates: document.querySelectorAll('#histChart > svg [data-estimate]').length, chart: document.querySelector('#histChart > svg')?.getAttribute('aria-label') }))()`;
const RES_TEXT = `(() => ({ on: document.getElementById('scr-results').classList.contains('on'), hero: document.getElementById('rheroL').innerText,
  tiles: [...document.querySelectorAll('#tiles .tile .tval')].map(t => t.innerText.trim()), label: document.getElementById('perLabel').innerText, days: document.querySelectorAll('#cal [data-day]').length,
  rows: document.querySelectorAll('#breakdown .brow').length, curve: document.querySelector('#curve > svg')?.getAttribute('aria-label') ?? null, day: document.getElementById('daypanel').innerText }))()`;
// Results' designed not-wired state: dashes, never zeros, with its switches, calendar and day sheet.
const notWired = r => r.on && /Results are not wired yet\. The board has no closed-trade record for this period\./.test(r.hero) && !/€\s0,00/.test(r.hero) && r.tiles.length === 8 && r.tiles.every(t => t === '—') &&
  /^This week · /.test(r.label) && r.days >= 28 && r.rows === 4 && r.curve === 'Results are not wired yet' && /results are not wired\.$/.test(r.day.trim());
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
      if (screen === 'desk') await deskChecks(page, viewport, theme, expectedMini);
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
    await page.evaluate(`document.getElementById('healthMore').focus()`);
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
    const b = await newBoard({ fleetConfig: f.fleetConfig ?? null });
    b.setNow(valid.data.receivedAt);
    await b.push(ingress(valid.data));
    if (!f.transportReason && f.feed === 'data') { b.setNow(f.receivedAt); const r = await b.push(f.payload); check('fixtures', `${id}: server status ${f.expectedStatus}`, r.status === f.expectedStatus, r.body); }
    const viewports = id === 'e-layout-storage-unavailable' ? VIEWPORTS : [VIEWPORTS[1]];
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
        label: document.querySelector('#hdrHealth b').innerText,
        cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(k => [k.dataset.cell, { state: k.dataset.state, cap: k.querySelector('.c')?.innerText ?? '' }])),
        desks: [...document.querySelectorAll('.dcard')].map(c => ({ name: c.querySelector('h3')?.innerText, nums: c.querySelectorAll('.dnums > div').length, states: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), status: c.querySelector('.mini-label').innerText })),
        positions: document.getElementById('positions').innerText.trim(), kept: document.getElementById('kept').innerText.trim(), strip: document.getElementById('health').innerText,
        say: document.querySelector('#heroL .say').innerText,
        sections: { positions: document.querySelector('#positions .pstate')?.dataset.state, kept: document.querySelector('#kept .pstate')?.dataset.state },
      }))()`);
      const tag = `${id} @${viewport.name}`;
      check('fixtures', `${tag}: header light reads ${label}`, ui.label === label, ui.label);
      check('fixtures', `${tag}: no panel or page blanks`, Object.keys(ui.cells).length === 5 && ui.desks.length === 3 && ui.desks.every(d => d.name && d.nums === 3) && ui.positions && ui.kept && ui.strip && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
      const expected = f.expected;
      const mismatch = Object.entries(CELL).filter(([key, panel]) => ui.cells[key].state !== expected[panel].state).map(([key, panel]) => ({ key, ui: ui.cells[key].state, want: expected[panel].state }));
      const deskMismatch = ui.desks.flatMap((d, i) => ['dayPnl', 'openPnl', 'totalPnl'].map((f2, k) => [['j', 'joe', 'joel'][i], f2, d.states[k]]))
        .filter(([desk, field, state]) => state !== expected[`desks.${desk}.${field}`].state);
      check('fixtures', `${tag}: every money cell shows its own panel state`, !mismatch.length && !deskMismatch.length, { mismatch, deskMismatch });
      check('fixtures', `${tag}: positions and kept holdings show their own panel states`, ui.sections.positions === expected.positions.state && ui.sections.kept === expected.kept.state, { ui: ui.sections, want: [expected.positions.state, expected.kept.state] });
      // Every desk number that is not fresh names its own reason on its card.
      const missingReasons = ui.desks.flatMap((d, i) => ['dayPnl', 'openPnl', 'totalPnl'].map(field => expected[`desks.${['j', 'joe', 'joel'][i]}.${field}`])
        .filter(cell => cell.state !== 'fresh').map(cell => (cell.reason ? cellReason(cell.reason) : 'not reported')).filter(words => !d.status.includes(words)).map(words => ({ desk: d.name, words, status: d.status })));
      check('fixtures', `${tag}: each desk card names every affected number's reason`, !missingReasons.length, missingReasons.slice(0, 3));
      const caps = [ui.say, ...Object.values(ui.cells).map(c => c.cap)].join(' | ');
      if (kind === 'stale') check('fixtures', `${tag}: stale shows its age and reason`, /[Aa]s of \d+\s(s|min) ago · updates are (late|stuck)/.test(caps), caps);
      if (kind === 'not reported') check('fixtures', `${tag}: not reported reads plainly`, ui.cells['hero.account'].cap === 'Not reported', caps);
      if (kind === 'broken') check('fixtures', `${tag}: broken shows its reason`, /Last good value, .* · |Unavailable · /.test(caps), caps);
      if (['e-layout-storage-unavailable', 'stale-receive-age', 'a-gateway-up-but-dead', 'b-incomplete-family', 'missing-runtime-and-results', 'c-old-producer-image', 'g-expired-sso', 'p3-single-missing-desk'].includes(id) && (viewport.name !== '390' || id === 'e-layout-storage-unavailable')) {
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
    if (live) { const payload = ingress(valid.data); payload.mode = 'LIVE'; const r = await b.push(payload); check('AC-6', 'a LIVE snapshot is rejected', r.status === 422, r.body); }
    for (const viewport of live ? [VIEWPORTS[0]] : VIEWPORTS) for (const theme of live ? ['light'] : THEMES) {
      await configure(page, viewport, theme);
      await load(page, b.url, 'desk');
      const tag = `${live ? 'LIVE rejected' : 'no snapshot'} @${viewport.name} ${theme}`;
      const ui = await page.evaluate(`({ label: document.querySelector('#hdrHealth b').innerText, display: document.querySelector('#heroL .display').innerText, caps: [...document.querySelectorAll('#heroL .kpi .c')].map(c => c.innerText), states: [...document.querySelectorAll('#heroL [data-cell]')].map(c => c.dataset.state), now: [...document.querySelectorAll('.dcard .now')].map(n => n.innerText), cards: [...document.querySelectorAll('.dcard .mini-label')].map(n => n.innerText), nums: [...document.querySelectorAll('.dcard .dnums > div')].map(d => d.dataset.state), positions: document.getElementById('positions').innerText, kept: document.querySelector('#kept .pstate').innerText, pop: document.getElementById('healthPop').textContent })`);
      const [state, caption, cardLine, posLine, keptLine] = live
        ? ['broken', 'Unavailable · last update was rejected', 'Numbers: unavailable · last update was rejected', 'Position detail is unavailable: last update was rejected.', 'Kept holdings are unavailable: last update was rejected.']
        : ['not reported', 'Not reported · no data received yet', 'Numbers: not reported · no data received yet', 'Position detail is not present in this snapshot.', 'Kept holdings are not present in this snapshot.'];
      check(live ? 'AC-6' : 'nodata', `${tag}: NO DATA everywhere, in the selector's own state`, ui.label === 'Needs fix' && ui.display === '—' && ui.states.every(x => x === state) && ui.nums.every(x => x === state) &&
        ui.caps.every(c => c === caption) && ui.cards.every(c => c === cardLine) && ui.now.every(n => n === 'Waiting for the first valid snapshot.') && ui.positions.includes(posLine) && ui.kept === keptLine &&
        /no board data — reload; if still empty, tell Amy/.test(ui.pop), ui);
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
    const CASES = [
      ['auth', 'auth_required', ['state.json', 'history.json', 'fleet-config.json'].map(p => jsonRule(p, 401, { ok: false, reason: 'auth_required' }))],
      ['redirect', 'auth_required', ['state.json', 'history.json', 'fleet-config.json'].map(p => ({ path: p, status: 302, headers: [{ name: 'Location', value: '/oauth2/start' }] }))],
      ['routing', 'route_not_found', ['state.json', 'history.json', 'fleet-config.json'].map(p => jsonRule(p, 404, { ok: false, error: 'not found' }))],
      ['proxy', 'refresh_failed', ['state.json', 'history.json', 'fleet-config.json'].map(p => ({ path: p, status: 503, headers: [{ name: 'Content-Type', value: 'text/html' }], body: '<h1>Bad gateway</h1>' }))],
      ['offline', 'refresh_failed', ['state.json', 'history.json', 'fleet-config.json'].map(p => ({ path: p, fail: 'ConnectionRefused' }))],
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
        check('cold', `${tag}: no clock, yet every panel shows broken with its reason`, ui.label === 'Needs fix' && ui.ring === 'Time not known' && cellsOk && ui.say === `No numbers: ${words}.` &&
          ui.cards.every(c => c.label === `Numbers: unavailable · ${words}` && c.nums.every(x => x === 'broken')) && ui.positions === `Position detail is unavailable: ${words}.` &&
          ui.kept === `Kept holdings are unavailable: ${words}.` && ui.strip.includes(`No data · ${words}`) && ui.foot === `No data · ${words}` && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
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
        await go(page, 'results');
        const r = await page.evaluate(RES_TEXT);
        check('cold', `${tag}: Results, reached from the nav, shows its not-wired state`, notWired(r) && !page.errors.length, { r, errors: page.errors.slice(0, 3) });
        page.errors.length = 0;
        await load(page, cold.url, 'results');
        const direct = await page.evaluate(RES_TEXT);
        check('cold', `${tag}: Results, opened directly at #results, shows its not-wired state`, notWired(direct) && !page.errors.length, { direct, errors: page.errors.slice(0, 3) });
        if (name === 'auth') {
          await auditScreen(page, viewport, theme, 'results (cold, no clock)');
          if (viewport.name === '1440' || viewport.mobile) await shot(page, viewport, `${viewport.name}-${theme}-results-state-cold-no-clock`, 'Results, cold start without a clock: the not-wired state');
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
    const r = await b.push(replay);
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
      check('passthrough', `${tag}: each says last good, its own age and the replay`, caps.every(c => /^Last good value, 3\d\ss ago · last update repeated an old one$/.test(c)) &&
        ui.cards.every(c => /^Numbers: last good, 3\d\ss ago · last update repeated an old one$/.test(c.label)) && /^Last good positions, 3\d\ss ago · last update repeated an old one$/.test(ui.positions) &&
        /^Last good values, 3\d\ss ago · last update repeated an old one · worth €\s12\.248,00 and \$\s441,20, each in its own currency$/.test(ui.kept), { caps, cards: ui.cards.map(c => c.label), positions: ui.positions, kept: ui.kept });
      if (viewport.name === '1024') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-replayed`, 'Desk, replayed push: last good values stay stale with their age');
    }
  }
  }

  if (run('journey')) {
  // 7 · HIGH regression and no-shift: one board walks fresh → stale → broken
  // with different reasons and ages per number → recovered, at every viewport
  // and theme. Each affected number names its own age and reason; nothing on
  // Desk or History moves (±0.5 px) at any transition.
  for (const viewport of VIEWPORTS) for (const theme of THEMES) {
    const tag = `${viewport.name} ${theme}`;
    const { snapshot: base, history } = scenario(NOW);
    const b = await newBoard({ history });
    b.setNow(NOW);
    check('journey', `${tag}: fresh snapshot accepted`, (await b.push(base)).status === 200);
    b.setNow(at(NOW, 9));
    await configure(page, viewport, theme);
    await load(page, b.url, 'desk');
    const desk0 = await rects(DESK_SHIFT);
    await go(page, 'history');
    const hist0 = await rects(HIST_SHIFT);
    await go(page, 'desk');
    const refresh = async until => { await page.evaluate('window.__joedesk.refresh()'); await waitFor(page, until); await settle(page); };

    // Stale: no update for 75 s. Every panel says "as of" with its age and why.
    b.setNow(at(NOW, 75));
    await refresh(`/^Stale/.test(document.querySelector('#hdrHealth b').innerText)`);
    let ui = await page.evaluate(DESK_TEXT);
    const late = /^As of 1\smin ago · updates are late\.?$/;
    check('journey', `${tag} stale: every number, card and section says as of 1 min and why`, Object.values(ui.cells).every(c => c.state === 'stale') && Object.entries(ui.cells).filter(([k]) => k !== 'hero.day').every(([, c]) => late.test(c.cap)) &&
      / today\. As of 1\smin ago · updates are late\.$/.test(ui.say) && ui.cards.every(c => /^Numbers: as of 1\smin ago · updates are late$/.test(c.label)) && /^As of 1\smin ago · updates are late$/.test(ui.positions) &&
      /^As of 1\smin ago · updates are late · worth €\s12\.248,00 and \$\s441,20, each in its own currency$/.test(ui.kept), ui);
    check('no-shift', `${tag}: fresh → stale moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    if (viewport.name !== '1024') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-stale`, 'Desk, stale: every panel with its age and reason');
    await go(page, 'history');
    let h = await page.evaluate(HIST_TEXT);
    check('journey', `${tag} stale: History and J's result say as of 1 min and why`, h.state === 'stale' && /^History as of 1\smin ago · updates are late\.$/.test(h.status) && !h.retry && /J since 10\sSep\s+[+−]?€\s[\d.,]+\s·\sAs of 1\smin ago · updates are late/.test(h.j), h);
    check('no-shift', `${tag}: fresh → stale moves nothing on History`, !moves(hist0, await rects(HIST_SHIFT)).length, moves(hist0, await rects(HIST_SHIFT)).slice(0, 5));
    await go(page, 'desk');

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
    const [j, joe, joel] = ui.cards;
    const today = /^Today: last good, 1\smin ago · waiting on the start-of-day value$/, open = /^Open positions: last good, 3\d\ss ago · open result not available$/;
    check('journey', `${tag} broken: each affected desk number has its own line, age and reason`, j.lines.length === 3 && today.test(j.lines[0]) && open.test(j.lines[1]) &&
      /^Since 10\sSep: last good, 3\d\ss ago · carrying the last good value$/.test(j.lines[2]) && [joe, joel].every(c => c.lines.length === 2 && today.test(c.lines[0]) && open.test(c.lines[1])) &&
      JSON.stringify(j.nums) === '["broken","broken","broken"]' && [joe, joel].every(c => JSON.stringify(c.nums) === '["broken","broken","fresh"]'), ui.cards);
    check('journey', `${tag} broken: Today's numbers keep their own ages and reasons`, ui.cells['hero.day'].state === 'broken' && /Last good value, 1\smin ago · waiting on the start-of-day value/.test(ui.say) &&
      /^Last good value, 3\d\ss ago · open result not available$/.test(ui.cells['hero.open'].cap) && /^Last good value, 3\d\ss ago · desk total incomplete$/.test(ui.cells['hero.since'].cap) &&
      ui.cells['hero.equity'].state === 'fresh' && ui.cells['hero.account'].state === 'fresh', { cells: ui.cells, say: ui.say });
    check('no-shift', `${tag}: stale → broken moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    await auditScreen(page, viewport, theme, 'desk (broken numbers)');
    if (viewport.name !== '1024' || theme === 'light') await shot(page, viewport, `${viewport.name}-${theme}-desk-state-per-field`, 'Desk, numbers broken field by field: each with its own age and reason');
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
    if (viewport.name !== '1024' || theme === 'light') await shot(page, viewport, `${viewport.name}-${theme}-history-state-refresh-failed`, 'History, refresh failed: last good series kept, Retry');
    await unroute();
    await go(page, 'desk');

    // Recovered: a complete snapshot; everything is fresh where it was.
    b.setNow(at(NOW, 120));
    check('journey', `${tag}: recovery snapshot accepted`, (await b.push(advance(base, at(NOW, 120), base.seq + 3))).status === 200);
    b.setNow(at(NOW, 125));
    await refresh(`[...document.querySelectorAll('#heroL [data-cell]')].every(c => c.dataset.state === 'fresh')`);
    ui = await page.evaluate(DESK_TEXT);
    check('journey', `${tag} recovered: every panel is fresh again`, ui.label === 'Board OK' && ui.cards.every(c => !c.lines.length && c.nums.every(x => x === 'fresh')) && ui.posState === 'fresh' &&
      /^Worth €\s12\.248,00 and \$\s441,20 now, each in its own currency\.$/.test(ui.kept), ui);
    check('no-shift', `${tag}: broken → recovered moves nothing on Desk`, !moves(desk0, await rects(DESK_SHIFT)).length, moves(desk0, await rects(DESK_SHIFT)).slice(0, 5));
    await go(page, 'history');
    await waitFor(page, `!document.getElementById('histRetry')`);
    await settle(page);
    h = await page.evaluate(HIST_TEXT);
    check('no-shift', `${tag}: History broken → recovered moves nothing`, h.state === 'fresh' && !moves(hist0, await rects(HIST_SHIFT)).length, { h, moved: moves(hist0, await rects(HIST_SHIFT)).slice(0, 5) });
    page.errors.length = 0;
  }
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
  // 10 · Render budget on the required workload, at every width. First the
  // largest history the contract allows (9,000 points, 8 MiB) read cold; then
  // live pushes of the largest position list (256 rows) over the largest
  // history the server keeps while pushes arrive (it compacts at 6.4 MiB).
  // Every update must be rendered and measured; a normal patch stays under
  // 16 ms, no task reaches 50 ms, and history is read and validated in the
  // worker, never on the page.
  {
    const longTasks = `window.__long = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); window.__joedesk.timings.length = 0`;
    const max = list => (list.length ? Math.max(...list) : NaN);
    const full = largeScenario(NOW);
    const cold = await newBoard({ history: full.history });
    cold.setNow(at(full.history.receivedAt, 9));
    const traces = [];
    for (const viewport of VIEWPORTS) {
      await configure(page, viewport, 'light');
      const { identifier } = await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__long = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__long.push([e.startTime, Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });` });
      await load(page, cold.url, 'history');
      await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
      await waitFor(page, `window.__joedesk.timings.some(t => t.reason === 'history-worker')`, 30000);
      await settle(page);
      await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier });
      const trace = await page.evaluate(`({ timings: window.__joedesk.timings.slice(), long: (window.__long ?? []).slice(), worker: window.__joedesk.worker(), lines: document.querySelectorAll('#histChart > svg path[stroke^="var(--desk-"]').length })`);
      const work = trace.timings.filter(x => x.reason === 'history-worker');
      const renders = trace.timings.filter(x => ['history', 'history-range'].includes(x.reason)).map(x => x.ms);
      // Page start-up is not a poll; the tasks that count begin with History's arrival.
      const arrived = work[0]?.at ?? Infinity;
      const row = { viewport: viewport.name, phase: `cold ${full.history.points.length} points`, workerRead: max(work.map(x => x.ms)), renders: renders.length, renderWorst: max(renders),
        mainThreadHistory: trace.timings.filter(x => x.reason === 'history-accept').length, longTasks: trace.long.filter(([start, ms]) => start + ms >= arrived).map(([, ms]) => ms), startup: trace.long.filter(([start, ms]) => start + ms < arrived).map(([, ms]) => ms) };
      traces.push(row);
      check('budget', `${viewport.name}: the ${full.history.points.length}-point (8 MiB) history is read and validated in the worker and drawn`, trace.worker && work.length >= 1 && !row.mainThreadHistory && trace.lines >= 3, row);
      check('budget', `${viewport.name}: drawing the full 8 MiB history stays under 50 ms with no long task on the page`, renders.length && row.renderWorst < 50 && !row.longTasks.length, row);
    }

    const live = largeScenario(NOW, 7200);
    const b = await newBoard({ history: live.history });
    let seq = live.snapshot.seq, t = 0;
    const pushWide = async () => {
      t += 30; const when = at(NOW, t);
      b.setNow(when);
      const r = await b.push(wideSnapshot(live.snapshot, when, ++seq, t));
      if (r.status !== 200) throw new Error(`wide push failed: ${JSON.stringify(r.body)}`);
      b.setNow(at(when, 1));
      // Row P000 (desk J) carries this push's price, so its render is visible.
      return `$${(20 + (t % 480)).toFixed(2).replace('.', ',')}`;
    };
    const firstMark = `document.querySelector('#positions .prow[data-desk="j"] .c-px')?.textContent.replace(/\\s/g, '')`;
    await pushWide();
    for (const viewport of VIEWPORTS) {
      await configure(page, viewport, 'light');
      await load(page, b.url, 'desk');
      await waitFor(page, `document.querySelectorAll('#positions .prow:not(.hd)').length === 254`);
      await page.evaluate(longTasks);
      const pushes = 5;
      for (let i = 0; i < pushes; i++) {
        const mark = await pushWide();
        await page.evaluate('window.__joedesk.refresh()');
        await waitFor(page, `${firstMark} === ${JSON.stringify(mark)}`);
        await settle(page);
      }
      const deskPhase = await page.evaluate('window.__joedesk.timings.splice(0)');
      await go(page, 'history');
      await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
      await settle(page);
      await page.evaluate('window.__joedesk.timings.length = 0');
      for (let i = 0; i < 3; i++) {
        await pushWide();
        const redraws = await page.evaluate(`window.__joedesk.timings.filter(t => t.reason === 'history').length`);
        await page.evaluate('window.__joedesk.refresh()');
        await waitFor(page, `window.__joedesk.timings.filter(t => t.reason === 'history').length > ${redraws}`, 30000);
        await settle(page);
      }
      const histPhase = await page.evaluate('window.__joedesk.timings.splice(0)');
      const trace = await page.evaluate(`({ long: window.__long.slice(), worker: window.__joedesk.worker() })`);
      const renders = list => list.filter(x => !['data-accept', 'history-accept', 'history-worker'].includes(x.reason)).map(x => x.ms);
      const deskRenders = renders(deskPhase), histRenders = renders(histPhase);
      const work = [...deskPhase, ...histPhase].filter(x => x.reason === 'history-worker').map(x => x.ms);
      const mainAccept = [...deskPhase, ...histPhase].filter(x => x.reason === 'history-accept').length;
      const historyRedraws = histPhase.filter(x => x.reason === 'history').length;
      const row = { viewport: viewport.name, phase: 'live', deskRenders: deskRenders.length, deskWorst: max(deskRenders), historyRenders: histRenders.length, historyRedraws, historyWorst: max(histRenders),
        workerReads: work.length, workerWorst: max(work), mainThreadHistory: mainAccept, longTasks: trace.long };
      traces.push(row);
      check('budget', `${viewport.name}: ${pushes} live pushes of 256 positions were each rendered and measured`, deskRenders.length >= pushes && histRenders.length >= 3 && [...deskRenders, ...histRenders].every(Number.isFinite), row);
      check('budget', `${viewport.name}: a normal patch (Desk data update) stays under 16 ms`, deskRenders.length && row.deskWorst < 16, row);
      check('budget', `${viewport.name}: a History update with the near-maximum series renders under 50 ms`, historyRedraws >= 3 && row.historyWorst < 50, row);
      check('budget', `${viewport.name}: no task on the page reaches 50 ms during these updates`, !trace.long.length, row);
      check('budget', `${viewport.name}: history is read and validated in the worker, never on the page`, trace.worker && work.length >= 3 && !mainAccept, row);
    }
    const kept = await (await fetch(`${b.url}history.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
    check('budget', `the live trace kept a near-maximum history (${kept.points.length} points, ${(kept.sizeBytes / 1048576).toFixed(2)} MiB, not compacted)`, kept.points.length > 7200 && !kept.compactedThrough, { points: kept.points.length, sizeBytes: kept.sizeBytes });
    console.log('render trace', JSON.stringify(traces));
    budgetTrace = traces;
  }
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

## Checks

| Criterion | Passed | Failed |
| --- | --- | --- |
${lines.join('\n')}

${failed.length ? `### Failures\n\n${failed.map(f => `- ${f.ac} ${f.name}: \`${JSON.stringify(f.detail)?.slice(0, 300)}\``).join('\n')}\n` : 'All checks passed.\n'}
## Render budget (ADR §9)

Reference: ${reference}. Fonts: the system UI stack of this machine; the
Linux CI run uses its own fonts and is the merge gate.

${budgetTrace ? `| Width | Phase | Desk patch worst (ms) | History draw worst (ms) | Worker read worst (ms) | Long tasks (≥ 50 ms) |
| --- | --- | --- | --- | --- | --- |
${budgetTrace.map(r => `| ${r.viewport} | ${r.phase} | ${r.deskWorst?.toFixed?.(1) ?? '—'} | ${(r.historyWorst ?? r.renderWorst)?.toFixed(1)} | ${(r.workerWorst ?? r.workerRead)?.toFixed(1)} | ${r.longTasks.length} |`).join('\n')}
` : 'Not run.\n'}
## Screenshots (\`<viewport>-<theme>-<surface>.png\`)

${shots.map(s => `- \`${s.file}\` — ${s.what}`).join('\n')}
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
process.exit(failed.length ? 1 : 0);
