#!/usr/bin/env node
// P3 browser gate: the real board server, P1 fixtures and one headless browser
// at 390/1024/1440 in light and dark (AC-1, 2, 5–9, 18–21, 28–34, 36, 38–47).
// One browser, one page, run sequentially; screenshots go to the QA folder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launch, openPage } from './browser/cdp.mjs';
import { startBoard, scenario, largeScenario, NOW, at, ACTOR, valid, fixture, ingress, singleMissingDesk, coupledUnavailable, acceptSnapshot, panelStates } from './browser/board.mjs';
import { VIEWPORTS, THEMES, configure, load, go, screenshot, settle, waitFor } from './browser/shots.mjs';

const QA_DIR = process.env.JOED_QA_DIR ?? join(homedir(), '.local/share/joedesk-qa/p3');
mkdirSync(QA_DIR, { recursive: true });
const AUDIT = readFileSync(new URL('./browser/audit.js', import.meta.url), 'utf8');
const results = [];
const shots = [];
function check(ac, name, ok, detail) {
  results.push({ ac, name, ok: Boolean(ok), detail });
  if (!ok) console.error(`FAIL ${ac} ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail).slice(0, 600)}`}`);
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

async function deskChecks(page, viewport, theme) {
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
      keptCap: t('#kept .keep-cap'), notJoe: document.body.innerText.includes('not traded by Joe'),
      mini: [...document.querySelectorAll('.chart.mini svg')].map(s => s.querySelectorAll('[data-estimate]').length),
      dbars: [...document.querySelectorAll('.dbar i[data-v]')].map(i => i.getAttribute('style')),
    }; })()`);
  check('AC-18', `${tag}: Board OK only in the header; the Desk line starts with the reason`, /Board OK/.test(d.header) && !d.boardOkElsewhere && d.strip.startsWith('Numbers up to date'), { header: d.header, strip: d.strip.slice(0, 60) });
  const kpiNames = d.kpis.map(k => k.dt);
  check('AC-19', `${tag}: Today shows five figures with their captions`, Boolean(d.display) && d.kpis.length === 4 && kpiNames[0] === 'Open positions' && /^Since 10 Sep$/.test(kpiNames[1]) && kpiNames[2] === 'Desks’ money' && kpiNames[3] === 'Paper account' &&
    d.kpis[0].cap === 'still moving until closed' && d.kpis[1].cap === 'after fees' && /started with € 15\.000/.test(d.kpis[2].cap) && d.kpis[3].cap === 'includes the kept holdings', d.kpis);
  check('AC-20', `${tag}: desk state is icon + word`, d.states.length === 3 && d.states.every(s => s.icon && /^(Working|Sitting out|Stuck)/.test(s.text)), d.states);
  check('AC-20', `${tag}: the Today bars are zero-centred on one scale`, d.dbars.length >= 2 && d.dbars.every(s => /(left|right):50%/.test(s)) && !proportional(await page.evaluate(`__audit.bars('.dbar i[data-v]')`), 'today'), d.dbars);
  check('AC-20', `${tag}: desk sparklines use observed values only`, d.mini.length === 3 && d.mini.every(n => n === 0), d.mini);
  const worth = await page.evaluate(`__audit.bars('.vbar i[data-v]')`);
  check('AC-42', `${tag}: worth bars proportional within each currency`, viewport.mobile || (worth.length >= 2 && !proportional(worth, 'worth')), worth);
  check('AC-7', `${tag}: kept symbols only under Kept holdings`, !d.positions.some(s => ['SXR8', 'TSLA'].includes(s)) && d.kept.map(k => k.sym).join() === 'SXR8,TSLA' && d.kept.every(k => k.label) && !d.notJoe, { positions: d.positions, kept: d.kept });
  check('AC-8', `${tag}: kept rows are inert`, d.kept.every(k => k.interactive === 0 && !k.pointer), d.kept);
  check('AC-9', `${tag}: kept values counted only in the paper account`, /Left out of every desk result and of Results; counted in the paper account \(€ 31\.482,75\)/.test(d.keptCap) && /€ 12\.248,00 and \$ 441,20/.test(d.keptCap) &&
    d.kpis[2].value.replace(/\s/g, '') === '€14.997,18' && d.kpis[3].value.replace(/\s/g, '') === '€31.482,75', { cap: d.keptCap, equity: d.kpis[2].value });

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

  // Hero chart crosshair tip is opaque.
  if (!viewport.mobile) {
    const box = await page.evaluate(`(() => { const r = document.querySelector('#heroChart svg').getBoundingClientRect(); return { x: r.left + r.width * 0.35, y: r.top + r.height / 2 }; })()`);
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
    const c = await page.evaluate(`(() => { const s = document.querySelector('#histChart svg'); return { base: Number(s.dataset.base), lo: Number(s.dataset.ylo), hi: Number(s.dataset.yhi), est: s.querySelectorAll('[data-estimate]').length, lines: s.querySelectorAll('path[stroke^="var(--desk-"]').length }; })()`);
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
    const zoomed = await page.evaluate(`({ reset: !document.getElementById('resetZoom').disabled, label: document.querySelector('#histChart svg').getAttribute('aria-label'), span: Number(document.querySelector('#histChart svg').dataset.yhi) - Number(document.querySelector('#histChart svg').dataset.ylo), base: Number(document.querySelector('#histChart svg').dataset.base) })`);
    check('AC-21', `${tag}: wheel zoom on desktop, Reset zoom enabled, scale still honest`, zoomed.reset && /zoomed/.test(zoomed.label) && zoomed.span >= zoomed.base * 0.01 - 1e-6, zoomed);
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', modifiers: 8, clickCount: 1 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 120, y: box.y, button: 'left', modifiers: 8 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x - 120, y: box.y, button: 'left', modifiers: 8, clickCount: 1 });
    await settle(page);
    check('AC-21', `${tag}: shift-drag pans`, await page.evaluate(`/zoomed/.test(document.querySelector('#histChart svg').getAttribute('aria-label'))`));
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

const browser = await launch({ hostRules: 'MAP joedesk.example.test 127.0.0.1' });
const page = await openPage(browser, { headers: { 'x-auth-request-user': ACTOR } });
await page.s('Page.addScriptToEvaluateOnNewDocument', { source: AUDIT });
let board = null;
const boards = [];
async function newBoard(options) { const b = await startBoard(options); boards.push(b); return b; }
try {
  // 1 · The full design scenario at every viewport and theme.
  const { snapshot, history } = scenario(NOW);
  board = await newBoard({ history });
  board.setNow(NOW);
  const pushed = await board.push(snapshot);
  if (pushed.status !== 200) throw new Error(`scenario push failed: ${JSON.stringify(pushed.body)}`);
  board.setNow(at(NOW, 9));
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
      if (screen === 'desk') await deskChecks(page, viewport, theme);
    }
    if (viewport.name === '1440') { await go(page, 'desk'); await focusChecks(page, `${viewport.name} ${theme} desk`); }
    if (viewport.mobile) {
      await page.evaluate(`document.querySelector('.bottom-nav [data-go="history"]').click()`);
      await settle(page);
      check('AC-21', `${viewport.name} ${theme}: History is reachable on a phone`, await page.evaluate(`document.getElementById('scr-history').classList.contains('on') && __audit.visible(document.getElementById('histChart'))`));
    }
  }

  // 2 · A data update moves nothing, and the browser records the desk change.
  let seq = snapshot.seq, step = 0, current = snapshot;
  for (const [viewport, theme] of [[VIEWPORTS[0], 'light'], [VIEWPORTS[1], 'dark'], [VIEWPORTS[2], 'dark']]) {
    await configure(page, viewport, theme);
    await load(page, board.url, 'desk');
    const before = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
    const next = structuredClone(current);
    const when = at(NOW, 40 + 30 * step++);
    next.seq = ++seq; next.generatedAt = when; next.safety.gateway.checkedAt = at(when, -3); next.safety.executor.checkedAt = at(when, -3);
    for (const d of next.desks) { d.heartbeatAt = at(when, -3); d.moneyEvidence.observedAt = at(when, -3); }
    next.desks[0].action = `Sold 5 Bank of America (BAC) at the exit rule; waiting for the next setup (check ${step}).`;
    const bump = (m, cents) => ({ ...m, amount: (Math.round(Number(m.amount) * 100 + cents) / 100).toFixed(2) });
    for (const [i, c] of [[0, 37], [1, -12], [2, 5]]) { const money = next.desks[i].money; money.equity = bump(money.equity, c); money.dayPnl = bump(money.dayPnl, c); money.totalPnl = bump(money.totalPnl, c); }
    for (const f of ['equity', 'dayPnl', 'totalPnl']) next.totals[f] = bump(next.totals[f], 30);
    next.positions.rows[0] = { ...next.positions.rows[0], mark: { amount: '47.1', currency: 'USD' }, marketValue: { amount: '235.5', currency: 'USD' }, updatedAt: at(when, -3) };
    for (const s of Object.values(next.pnlSources)) s.observedAt = at(when, -3);
    next.brokerAccount.observedAt = at(when, -3);
    board.setNow(when);
    const r = await board.push(next);
    check('AC-18', `${viewport.name} ${theme}: updated snapshot accepted`, r.status === 200, r.body);
    await page.evaluate('window.__joedesk.refresh()');
    try { await waitFor(page, `document.querySelector('#desk-j .now').innerText.includes('(check ${step})')`); }
    catch (error) {
      const st = await (await fetch(`http://127.0.0.1:${board.port}/joe/state.json`, { headers: { 'x-auth-request-user': ACTOR } })).json();
      console.error('browser view', await page.evaluate(`fetch('./state.json').then(r => r.json()).then(async j => { const m = await import('./contracts/index.mjs'); return { seq: j.feeds.data.value.seq, check: m.validateContract('data', j.feeds.data.value) }; })`));
      console.error('server', st.serverNow, st.feeds.data.value?.seq, st.feeds.data.reason, st.feeds.data.value?.desks[0].action, r.body);
      console.error(await page.evaluate(`({ now: document.querySelector('#desk-j .now').innerText, renders: window.__joedesk.renders, ready: document.documentElement.dataset.ready, timings: window.__joedesk.timings.slice(-4) })`), page.errors); throw error; }
    await settle(page);
    const after = await page.evaluate(`__audit.rects(${JSON.stringify(SHIFT_SELECTORS)})`);
    const moved = shifted(before, after, ['top', 'left', 'height']);
    check('no-shift', `${viewport.name} ${theme}: a data update moves nothing (±0.5 px)`, !moved.length, moved.slice(0, 5));
    await go(page, 'history');
    const events = await page.evaluate(`[...document.querySelectorAll('#events li')].map(li => li.innerText)`);
    check('AC-21', `${viewport.name} ${theme}: Desk changes records the new action`, events.some(e => e.startsWith('Sold 5 Bank of America')), events.slice(0, 2));
    current = next;
  }

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
      let storageScript = null, intercept = false;
      if (id === 'e-layout-storage-unavailable') storageScript = (await page.s('Page.addScriptToEvaluateOnNewDocument', { source: STORAGE_OFF })).identifier;
      b.setNow(f.transportReason ? valid.data.receivedAt : f.now);
      await load(page, b.url, 'desk');
      if (f.transportReason) {
        b.setNow(f.now);
        if (f.transportReason === 'auth_required') await page.setHeaders({});
        if (f.transportReason === 'route_not_found') {
          intercept = m => { if (m.method === 'Fetch.requestPaused') page.s('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, body: Buffer.from('{"ok":false,"error":"not found"}').toString('base64') }).catch(() => {}); };
          browser.on(intercept);
          await page.s('Fetch.enable', { patterns: [{ urlPattern: '*state.json*' }] });
        }
        await page.evaluate('window.__joedesk.refresh()');
        await settle(page);
      }
      const ui = await page.evaluate(`(() => ({
        label: document.querySelector('#hdrHealth b').innerText,
        cells: Object.fromEntries([...document.querySelectorAll('#heroL [data-cell]')].map(k => [k.dataset.cell, { state: k.dataset.state, cap: k.querySelector('.c')?.innerText ?? '' }])),
        desks: [...document.querySelectorAll('.dcard')].map(c => ({ name: c.querySelector('h3')?.innerText, nums: c.querySelectorAll('.dnums > div').length, states: [...c.querySelectorAll('.dnums > div')].map(d => d.dataset.state), status: c.querySelector('.mini-label').innerText })),
        positions: document.getElementById('positions').innerText.trim(), kept: document.getElementById('kept').innerText.trim(), strip: document.getElementById('health').innerText,
        say: document.querySelector('#heroL .say').innerText,
      }))()`);
      const tag = `${id} @${viewport.name}`;
      check('fixtures', `${tag}: header light reads ${label}`, ui.label === label, ui.label);
      check('fixtures', `${tag}: no panel or page blanks`, Object.keys(ui.cells).length === 5 && ui.desks.length === 3 && ui.desks.every(d => d.name && d.nums === 3) && ui.positions && ui.kept && ui.strip && !page.errors.length, { ui, errors: page.errors.slice(0, 3) });
      const expected = f.expected;
      const mismatch = Object.entries(CELL).filter(([key, panel]) => ui.cells[key].state !== expected[panel].state).map(([key, panel]) => ({ key, ui: ui.cells[key].state, want: expected[panel].state }));
      const deskMismatch = ui.desks.flatMap((d, i) => ['dayPnl', 'openPnl', 'totalPnl'].map((f2, k) => [['j', 'joe', 'joel'][i], f2, d.states[k]]))
        .filter(([desk, field, state]) => state !== expected[`desks.${desk}.${field}`].state);
      check('fixtures', `${tag}: every money cell shows its own panel state`, !mismatch.length && !deskMismatch.length, { mismatch, deskMismatch });
      const caps = [ui.say, ...Object.values(ui.cells).map(c => c.cap)].join(' | ');
      if (kind === 'stale') check('fixtures', `${tag}: stale shows its age`, /as of \d+ (s|min) ago/.test(caps), caps);
      if (kind === 'not reported') check('fixtures', `${tag}: not reported reads plainly`, ui.cells['hero.account'].cap === 'Not reported', caps);
      if (kind === 'broken') check('fixtures', `${tag}: broken shows its reason`, /Last good value, .* · |Unavailable · /.test(caps), caps);
      if (['e-layout-storage-unavailable', 'stale-receive-age', 'a-gateway-up-but-dead', 'b-incomplete-family', 'missing-runtime-and-results', 'c-old-producer-image', 'g-expired-sso', 'p3-single-missing-desk'].includes(id) && (viewport.name !== '390' || id === 'e-layout-storage-unavailable')) {
        await shot(page, viewport, `${viewport.name}-${theme}-desk-state-${id}`, `Desk, P1 fixture ${id} (${kind})`);
      }
      if (storageScript) await page.s('Page.removeScriptToEvaluateOnNewDocument', { identifier: storageScript });
      if (intercept) { await page.s('Fetch.disable'); browser.off(intercept); }
      if (f.transportReason === 'auth_required') await page.setHeaders({ 'x-auth-request-user': ACTOR });
      page.errors.length = 0;
    }
  }

  // NO DATA, and a LIVE snapshot is rejected so the board stays on NO DATA.
  for (const live of [false, true]) {
    const b = await newBoard();
    b.setNow(NOW);
    if (live) { const payload = ingress(valid.data); payload.mode = 'LIVE'; const r = await b.push(payload); check('AC-6', 'a LIVE snapshot is rejected', r.status === 422, r.body); }
    await configure(page, VIEWPORTS[0], 'light');
    await load(page, b.url, 'desk');
    const ui = await page.evaluate(`({ label: document.querySelector('#hdrHealth b').innerText, display: document.querySelector('#heroL .display').innerText, caps: [...document.querySelectorAll('#heroL .kpi .c')].map(c => c.innerText), desks: document.getElementById('desksSub').innerText, now: [...document.querySelectorAll('.dcard .now')].map(n => n.innerText), positions: document.getElementById('positions').innerText, pop: document.getElementById('healthPop').textContent })`);
    check(live ? 'AC-6' : 'nodata', `${live ? 'LIVE rejected' : 'no snapshot'}: NO DATA everywhere`, ui.label === 'Needs fix' && ui.display === '—' && ui.caps.every(c => c === 'Unavailable · no snapshot') &&
      ui.now.every(n => n === 'Waiting for the first valid snapshot.') && /Position detail is not present in this snapshot\./.test(ui.positions) && /no board data — reload; if still empty, tell Amy/.test(ui.pop), ui);
    if (!live) { await shot(page, VIEWPORTS[0], '1440-light-desk-state-no-data', 'Desk, NO DATA (no snapshot yet)'); }
  }

  // History refresh failure keeps the last good series with a Retry.
  {
    await configure(page, VIEWPORTS[0], 'light');
    board.setNow(at(NOW, 9));
    await load(page, board.url, 'history');
    await page.s('Fetch.enable', { patterns: [{ urlPattern: '*history.json*' }] });
    const fulfil = m => { if (m.method === 'Fetch.requestPaused') page.s('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"ok":false,"reason":"history_size_limit"}').toString('base64') }).catch(() => {}); };
    browser.on(fulfil);
    await page.evaluate('window.__joedesk.refresh()');
    await settle(page);
    const status = await page.evaluate(`({ text: document.getElementById('histStatus').innerText, chart: Boolean(document.querySelector('#histChart svg path')), retry: Boolean(document.getElementById('histRetry')) })`);
    check('AC-21', 'history failure keeps the last good series, says why and offers Retry', /History refresh failed: history is full\. Showing the last good history/.test(status.text) && status.chart && status.retry, status);
    await shot(page, VIEWPORTS[0], '1440-light-history-state-refresh-failed', 'History, refresh failed (last good series kept)');
    browser.off(fulfil);
    await page.s('Fetch.disable');
  }

  // 4 · Privacy stub on a non-canonical host: no data request at all.
  {
    page.requests.length = 0;
    await configure(page, VIEWPORTS[2], 'light');
    await page.s('Page.navigate', { url: `http://joedesk.example.test:${board.port}/joe/` });
    await waitFor(page, `document.documentElement.dataset.ready === 'private'`);
    const p = await page.evaluate(`({ gate: !document.getElementById('privateGate').hidden, app: document.getElementById('app').hidden, text: document.getElementById('privateGate').innerText })`);
    const reads = page.requests.filter(r => /(state|data|history|fleet-config)\.json/.test(r.url));
    check('privacy', 'non-canonical host shows the privacy stub and reads no data', p.gate && p.app && !reads.length && /Joe lives at home\./.test(p.text), { p, reads });
    await shot(page, VIEWPORTS[2], '390-light-privacy', 'Privacy stub on a non-canonical host');
  }

  // 5 · Render budget: 256 positions are bounded by the contract; trace a
  // 10,000-point history through the History and Desk screens.
  {
    const big = largeScenario(NOW);
    const b = await newBoard({ history: big.history });
    b.setNow(at(NOW, 9));
    await configure(page, VIEWPORTS[0], 'light');
    await load(page, b.url, 'history');
    await page.evaluate(`document.querySelector('#histRange [data-range="all"]').click()`);
    await settle(page);
    await page.evaluate('window.__joedesk.timings.length = 0');
    for (let i = 0; i < 3; i++) { await page.evaluate('window.__joedesk.refresh()'); await settle(page); }
    await go(page, 'desk');
    for (let i = 0; i < 3; i++) { await page.evaluate('window.__joedesk.refresh()'); await settle(page); }
    const timings = await page.evaluate('window.__joedesk.timings');
    const worst = reason => Math.max(0, ...timings.filter(t => t.reason === reason).map(t => t.ms));
    const trace = { points: big.history.points.length, render: Math.max(worst('data'), worst('history')), historyAccept: worst('history-accept'), dataAccept: worst('data-accept') };
    console.log('render trace', JSON.stringify(trace));
    check('budget', `a poll-triggered render stays under 50 ms with ${trace.points} history points (the 8 MiB contract maximum)`, trace.render < 50, trace);
    check('budget', 'state acceptance stays under 50 ms', trace.dataAccept < 50, trace);
    results.push({ ac: 'budget', name: `history read and validation off the main thread (worker), ${trace.points} points: ${trace.historyAccept.toFixed(1)} ms`, ok: true, detail: trace });
  }

  // AC-5 and AC-34: read-only traffic, no sample data served.
  const writes = page.requests.filter(r => r.method !== 'GET');
  check('AC-5', 'the board sent no request that could change anything', !writes.length, writes);
  for (const path of ['/joe/joe-data.sample.json', '/joe/docs/examples/joe-data.sample.json', '/joe/vendor/gridstack-13.2.0-all.js']) {
    const r = await fetch(`http://127.0.0.1:${board.port}${path}`, { headers: { 'x-auth-request-user': ACTOR } });
    check('AC-34', `${path} is not served`, r.status === 404, r.status);
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
## Screenshots (\`<viewport>-<theme>-<surface>.png\`)

${shots.map(s => `- \`${s.file}\` — ${s.what}`).join('\n')}
`);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; screenshots and index.md in ${QA_DIR}`);
process.exit(failed.length ? 1 : 0);
