// Shared by the browser gates (P3 shell, Desk and History; P4 Results): the
// check log, screenshots, and the craft audit of one rendered screen (AC-1, 2,
// 5, 28–30, 32, 33, 36, 38, 40, 42–44, 47). One browser, used sequentially.
import { join } from 'node:path';
import { screenshot, settle } from './shots.mjs';

export const TERM_PATTERN = /\b(P&L|IB|HALT|FIFO|FX|KEEP|Stage 0|NAV|Gateway|Snapshot|Expectancy|Profit factor|drawdown|Realised|Unrealised|Heartbeat|agenix|Janus|Quota|OPS-\d+|Propagate|Fleet Config|SOD|YTD|Wk \d+)\b/;
export const GLYPHS = /[▲▼►◄✓✔✕✖★☆⚠ⓘ◷⏸⛔→←↑↓↗↘•›‹»«÷]/;
export const SPLIT_UNIT = /\d (s|min|h|%|desks?|trades?|days?|sessions?)(?![\w])|[€$] [−+\-]?\d/;
export const IMPLEMENTER = /\b(TODO|FIXME|HOSTD-\d+|JOED-\d+|NIX-\d+|undefined|NaN|lorem|\[object)\b/i;
export const GERMAN = /\b(und|nicht|oder|Konto|Ergebnis|Gewinn|Verlust|heute|gestern)\b/;
export const ACTION = /\b(place|cancel|flatten|pause|restart|buy|sell|liquidate|close position|halt|switch to live)\b/i;
// The wide font that stands in for Linux's in the layout checks.
export const WIDE_FONT = 'Verdana, "DejaVu Sans", sans-serif';

export function createGate(QA_DIR) {
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
    // The LIVE label renders only inside Settings › Mode's locked option, never in the header.
    const live = await page.evaluate(`({ live: [...document.querySelectorAll('.mode-label.live')].filter(e => !e.closest('#set-mode .mode-opt.locked')).length, header: document.querySelector('header.top').innerText })`);
    check('AC-2', `${tag}: no LIVE treatment outside Mode's locked option`, live.live === 0 && !/LIVE/.test(live.header), live);
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
    check('AC-36', `${tag}: nothing clips or ellipsises (the two clamped state lines aside)`, !clipping.length, clipping.slice(0, 6));
    // The health reason (one line) and Today's sentence (two lines) are the only
    // clamps: whole lines, an ellipsis when longer, the full text given.
    const clamps = await page.evaluate('__audit.clamps()');
    if (screen.startsWith('desk')) check('clamp', `${tag}: the health reason and Today's sentence show whole lines, end in an ellipsis and give their full text`, clamps.length === 2 && clamps.every(c => c.ok), clamps);
    else check('clamp', `${tag}: no clamp outside Desk`, !clamps.length, clamps);
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
    // The locked "Switch to LIVE…" opener is exempt: it only opens the gate,
    // which the P5 gate proves sends nothing at any step (network layer).
    const actions = await page.evaluate(`[...document.querySelectorAll('button, a[href], input, select')].filter(b => __audit.visible(b) && !b.closest('.term, .learn, dialog') && !b.matches('.term, .learn, #liveOpen')).map(b => (b.textContent + ' ' + (b.getAttribute('aria-label') ?? '')).trim())`);
    const acting = actions.filter(t => ACTION.test(t));
    check('AC-5', `${tag}: no control acts on money, orders or the desks`, !acting.length, acting);
  }

  return { results, shots, check, shot, auditScreen };
}

export const proportional = (bars, label) => {
  const groups = new Map();
  for (const b of bars) if (b.v) { const key = b.cur; groups.set(key, [...(groups.get(key) ?? []), b.w / Math.abs(b.v)]); }
  for (const [cur, ratios] of groups) {
    if (ratios.length < 2) continue;
    const spread = (Math.max(...ratios) - Math.min(...ratios)) / Math.max(...ratios);
    if (spread > 0.03) return { label, cur, spread };
  }
  return null;
};
export const shifted = (a, b, keys = ['top', 'left', 'height', 'width']) => {
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
