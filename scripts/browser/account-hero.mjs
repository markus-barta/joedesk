// The whole account at the top of Desk (JOED-156) in the real page, fed by
// the board server's own account stores (board.mjs accountScenario): first on
// the screen; the value, its change for the range, Since start, Cash and the
// kept holdings each in its own currency; the seven ranges on their own
// stores; an honest note where a range is longer than the record; the
// tooltip and the keyboard reading; History's natural input; Controls; the
// first-visit hint, remembered; on wider screens the overview strip, on a
// phone Account details and no strip. A range change moves nothing.
// The page runs with reduced motion (configure), so every jump lands at once.

const DAY = 864e5;
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const MOD = { Ctrl: 2, Shift: 8 };
const STATE = `(() => {
  const hero = document.getElementById('acctHero'), svg = document.querySelector('#acctChart > svg'), strip = document.getElementById('acctStrip');
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top + scrollY, bottom: r.bottom + scrollY, width: r.width, height: r.height }; };
  const text = el => (el?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  const sub = __audit.visible(document.getElementById('acctSub')) ? document.getElementById('acctSub') : document.getElementById('acctSubN');
  return { history: hero.dataset.history, value: text(document.getElementById('acctValue')), valueSize: parseFloat(getComputedStyle(document.getElementById('acctValue')).fontSize),
    eyebrow: text(hero.querySelector('.acct-eyebrow')), change: text(document.getElementById('acctChange')),
    chip: document.querySelector('#acctChange .acct-rng')?.innerText ?? null, state: document.querySelector('#acctChange [data-clamp]')?.innerText ?? null,
    sub: text(sub), keptActions: sub.querySelectorAll('b.nowrap button, b.nowrap a, b.nowrap [tabindex]').length,
    note: text(document.getElementById('acctNote')), noteKind: document.getElementById('acctNote').dataset.kind,
    pressed: [...document.querySelectorAll('#acctRanges [aria-pressed="true"]')].map(b => b.dataset.acctRange),
    x0: Number(svg?.dataset.x0), x1: Number(svg?.dataset.x1), source: svg?.dataset.source ?? null, range: svg?.dataset.range ?? null, points: Number(svg?.dataset.points ?? 0),
    label: svg?.getAttribute('aria-label') ?? '', now: Boolean(svg?.querySelector('[data-now]')), gaps: svg?.querySelectorAll('[data-gap]').length ?? 0,
    k0: Number(strip.dataset.k0), k1: Number(strip.dataset.k1), stripOn: !strip.hasAttribute('data-off') && __audit.visible(strip),
    hero: box(hero), desk: box(document.querySelector('.hero-primary')), chart: box(document.getElementById('acctChart')),
    track: box(document.getElementById('acctTrack')), win: box(document.getElementById('acctWin')), bottomBar: box(document.querySelector('.bottom-nav')),
    others: [...document.querySelectorAll('#heroL .display, .dcard .dnums .v')].filter(__audit.visible).map(e => parseFloat(getComputedStyle(e).fontSize)),
    scrollY, innerHeight };
})()`;
async function click(page, at) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
}
async function drag(page, from, to, steps = 6) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y, button: 'left', buttons: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
}
const wheel = (page, at, { deltaX = 0, deltaY = 0, modifiers = 0 } = {}) => page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX, deltaY, modifiers });
// Keys with their virtual key codes: Chrome moves focus on Tab only with one.
const CODES = { Tab: 9, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowRight: 39 };
async function press(page, key, modifiers = 0) {
  const base = { key, code: key, windowsVirtualKeyCode: CODES[key], modifiers };
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function accountHeroChecks({ page, viewport, theme, check, settle, rects, moves, snapshot, load, url }) {
  const tag = `${viewport.name} ${theme} whole account`;
  const state = async () => page.evaluate(`(() => { window.scrollTo(0, 0); return ${STATE}; })()`);
  const range = async r => { await page.evaluate(`document.querySelector('#acctRanges [data-acct-range="${r}"]').click()`); await settle(page); return state(); };
  await page.evaluate(`new Promise(r => { const t = Date.now(); (function wait() { if (document.getElementById('acctHero').dataset.history === 'ok' || Date.now() - t > 5000) r(); else setTimeout(wait, 50); })(); })`);
  await settle(page);
  let s = await state();
  const equity = snapshot.brokerAccount.equity.amount, digits = text => text.replace(/[^\d,]/g, '');
  check('JOED-156', `${tag}: first on Desk, the whole account incl. kept holdings in EUR, its value from the feed`,
    s.history === 'ok' && s.hero.top < s.desk.top && /^€/.test(s.value) && digits(s.value) === equity.replace('.', ',') &&
    (viewport.mobile ? /^Whole account incl\. kept holdings EUR · base currency/.test(s.eyebrow) : /^IB paper account · whole account incl\. kept holdings EUR · account base currency$/.test(s.eyebrow)), s);
  if (!viewport.mobile) check('JOED-156', `${tag}: the largest number on Desk`, s.others.every(size => s.valueSize > size), { valueSize: s.valueSize, others: s.others });
  else check('JOED-156', `${tag}: on a phone the account, value to chart, fits above the bottom navigation`, s.hero.bottom <= s.bottomBar.top - 8, s);
  // 1M, recorded a month back: the change from the close standing at its start to now.
  check('JOED-156', `${tag}: 1M shows the daily closes and the change for the month, ending now`,
    s.range === '1M' && s.source === 'daily' && s.pressed.join() === '1M' && s.chip === '1M' && /^[+−]€[\d.]+,\d\d[+−][\d,]+%1M$/.test(s.change.replace(/\s+/g, '')) && !s.state && s.now && s.points >= 25, s);
  // The hint until the first drag, zoom or key press on any chart (one memory
  // for every chart, chart.js), remembered in this browser.
  const hintStored = await page.evaluate(`(() => { try { return localStorage.getItem('joe-board-chart-hint-v1'); } catch { return 'unavailable'; } })()`);
  const pointer = await page.evaluate(`({ coarse: matchMedia('(pointer: coarse)').matches, fine: __audit.visible(document.querySelector('#acctNote .hint-fine')), touch: __audit.visible(document.querySelector('#acctNote .hint-touch')) })`);
  check('JOED-156', `${tag}: the first-visit hint shows until the first move, then stays gone, in this pointer's words only`,
    hintStored === '1' ? s.noteKind !== 'hint' : s.noteKind === 'hint' && pointer.coarse === viewport.mobile && pointer.fine === !viewport.mobile && pointer.touch === viewport.mobile &&
      (viewport.mobile ? s.note === 'Swipe · pinch · double-tap' : /^Drag or scroll sideways to move · (Ctrl|⌘)-scroll or pinch to zoom$/.test(s.note)), { hintStored, noteKind: s.noteKind, note: s.note, pointer });
  check('JOED-156', `${tag}: the account history is read and converted in a worker`, await page.evaluate(`window.__joedesk.accountWorker?.() === true && !window.__joedesk.timings.some(t => t.reason === 'account-accept')`));
  check('JOED-156', `${tag}: Since start asks for the account start in Settings; Cash; kept holdings each in its own currency, never actionable`,
    /Account start not set · set in Settings/.test(s.sub) && /Cash/.test(s.sub) && s.keptActions === 0 &&
    (viewport.mobile || /incl\. kept holdings SXR8 € 12\.248,00 · TSLA \$ 441,20, each in its own currency/.test(s.sub)), s);

  // Each range on its own store; a range longer than the record says since when it records.
  const SHIFT = ['#acctHero', '#acctValue', '#acctChange', '#acctSub', '#acctSubN', '#acctRanges', '#acctChart', '#acctStrip', '#acctNote', '#deskHero', '.hero-primary', '#desks', 'footer.foot'];
  const before = await rects(SHIFT), shifts = [];
  const seen = {};
  for (const r of ['1D', '5D', '1M', '6M', 'YTD', '1Y', 'All', '1M']) {
    seen[r] = await range(r);
    shifts.push(...moves(before, await rects(SHIFT)).map(m => ({ r, ...m })));
  }
  check('no-shift', `${tag}: switching the seven ranges moves nothing`, !shifts.length, shifts.slice(0, 6));
  check('JOED-156', `${tag}: 1D and 5D draw the snapshots, the longer ranges the daily closes`,
    ['1D', '5D'].every(r => seen[r].source === 'short' && seen[r].range === r && seen[r].pressed.join() === r) &&
    ['1M', '6M', 'YTD', '1Y', 'All'].every(r => seen[r].source === 'daily' && seen[r].pressed.join() === r) &&
    near(seen['1D'].x1 - seen['1D'].x0, DAY, 1000) && seen['5D'].gaps >= 1, Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { source: v.source, range: v.range, pressed: v.pressed, span: v.x1 - v.x0, gaps: v.gaps }])));
  check('JOED-156', `${tag}: a range longer than the record says since when it records and what the change covers`,
    /^Recording since \d{1,2}\s\w{3}, \d\d:\d\d · 3\sdays so far$/.test(seen['5D'].note) && /^since /.test(seen['5D'].chip) &&
    /^Recording since \d{1,2}\s\w{3} · \d+\sdays so far$/.test(seen['6M'].note) && /^since /.test(seen['6M'].chip) &&
    seen['1M'].noteKind !== 'note' && seen.All.noteKind !== 'note' && seen.All.chip === 'All', { '5D': [seen['5D'].note, seen['5D'].chip], '6M': [seen['6M'].note, seen['6M'].chip], All: seen.All.chip });

  // The tooltip and the keyboard reading: the same words, time and value.
  await page.s('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.evaluate(`document.querySelector('#acctRanges [data-acct-range="All"]').focus()`);
  await press(page, 'Tab');
  await press(page, 'ArrowLeft');
  await settle(page);
  const reading = await page.evaluate(`(() => { const tip = document.getElementById('acctTip'), live = document.getElementById('acctLive');
    return { focused: document.activeElement?.id, on: tip.classList.contains('on'), tip: tip.innerText.replace(/\\s+/g, ' ').trim(), live: live.textContent.replace(/\\s+/g, ' ').trim(),
      name: document.getElementById('acctChart').getAttribute('aria-label'), help: document.getElementById(document.getElementById('acctChart').getAttribute('aria-describedby'))?.textContent ?? '' }; })()`);
  check('JOED-156', `${tag}: Tab reaches the chart; Left reads a recorded value aloud with the tooltip's own words`,
    reading.focused === 'acctChart' && reading.on && /Vienna time/.test(reading.live) && /€\s[\d.]+,\d\d/.test(reading.live) && reading.tip === reading.live &&
    /kept holdings included/.test(reading.name) && /Left and Right/.test(reading.help), reading);
  await press(page, 'Escape');
  await page.evaluate('document.activeElement?.blur()');

  // Controls: a list of the moves for this device, closed by Escape.
  await page.evaluate(`document.getElementById('acctCtl').click()`);
  await settle(page);
  const pop = await page.evaluate(`({ open: __audit.visible(document.getElementById('acctPop')), expanded: document.getElementById('acctCtl').getAttribute('aria-expanded'),
    text: [...document.querySelectorAll('#acctPop dl')].filter(__audit.visible).map(d => d.innerText).join(' '),
    fine: __audit.visible(document.querySelector('#acctPop .acct-keys.hint-fine')), touch: __audit.visible(document.querySelector('#acctPop .acct-keys.hint-touch')) })`);
  await page.evaluate(`document.getElementById('acctCtl').focus()`);
  await press(page, 'Escape');
  await settle(page);
  const closed = await page.evaluate(`({ open: __audit.visible(document.getElementById('acctPop')), focused: document.activeElement?.id })`);
  // Exactly one list shows: the finger's with touch, the mouse's with a mouse.
  check('JOED-156', `${tag}: Controls shows only this pointer's list (${viewport.mobile ? 'touch' : 'mouse'}) and closes on Escape, keeping focus`,
    pop.open && pop.expanded === 'true' && pop.fine === !viewport.mobile && pop.touch === viewport.mobile &&
    (viewport.mobile ? /Swipe sideways/.test(pop.text) && !/scroll sideways/.test(pop.text) : /scroll sideways/.test(pop.text) && /(Ctrl|⌘) \+ scroll/.test(pop.text) && !/Swipe sideways/.test(pop.text)) &&
    !closed.open && closed.focused === 'acctCtl', { pop, closed });
  await page.evaluate('document.activeElement?.blur()');

  if (!viewport.mobile) {
    // Natural input as on History: a plain wheel scrolls the page, ⌘/Ctrl zooms at the pointer,
    // a sideways wheel pans, double-click fits; the hint goes after the first move, remembered.
    s = await range('5D');
    const at = { x: s.chart.left + 58 + (s.chart.width - 72) * 0.5, y: s.chart.top + s.chart.height / 2 };
    await page.evaluate(`window.scrollTo(0, 0)`);
    await wheel(page, at, { deltaY: 120 });
    await settle(page);
    const paged = await page.evaluate(STATE);
    check('JOED-156', `${tag}: a plain vertical wheel scrolls the page, the window stays`, paged.scrollY > 0 && paged.x0 === s.x0 && paged.x1 === s.x1, { scrollY: paged.scrollY });
    s = await state();
    const centre = s.chart.left + 58 + (s.chart.width - 72) * 0.5;
    await wheel(page, { x: centre, y: s.chart.top + s.chart.height / 2 - s.scrollY }, { deltaY: -100, modifiers: MOD.Ctrl });
    await settle(page);
    const zoomed = await state();
    const anchor = (s.x0 + s.x1) / 2;
    check('JOED-156', `${tag}: Ctrl-wheel zooms in around the pointer; a zoomed window is no range`,
      zoomed.x1 - zoomed.x0 < (s.x1 - s.x0) * 0.9 && near((anchor - zoomed.x0) / (zoomed.x1 - zoomed.x0), 0.5, 0.03) && !zoomed.pressed.length && zoomed.noteKind !== 'hint' &&
      await page.evaluate(`(() => { try { return localStorage.getItem('joe-board-chart-hint-v1') === '1'; } catch { return true; } })()`), { s, zoomed });
    await wheel(page, { x: centre, y: zoomed.chart.top + zoomed.chart.height / 2 }, { deltaX: -60 });
    await settle(page);
    const panned = await state();
    check('JOED-156', `${tag}: a sideways wheel moves back in time, same width`, panned.x1 < zoomed.x1 && near(panned.x1 - panned.x0, zoomed.x1 - zoomed.x0, 1000), { zoomed, panned });
    // The strip: its window drags; End on it returns to the newest value.
    check('JOED-156', `${tag}: the overview strip shows everything loaded and the window`, panned.stripOn && near(panned.k1 - panned.k0, 3 * DAY, 10 * 60e3) &&
      near(panned.win.left - panned.track.left, (panned.x0 - panned.k0) / (panned.k1 - panned.k0) * panned.track.width, 3), panned);
    const mid = { x: panned.win.left + panned.win.width / 2, y: panned.track.top + panned.track.height / 2 - panned.scrollY };
    await drag(page, mid, { x: mid.x - 40, y: mid.y });
    await settle(page);
    const dragged = await state();
    const perPx = (dragged.k1 - dragged.k0) / dragged.track.width;
    check('JOED-156', `${tag}: dragging the strip's window 40 px moves the chart by 40 px of strip time`, near(panned.x0 - dragged.x0, 40 * perPx, 4 * perPx) && near(dragged.x1 - dragged.x0, panned.x1 - panned.x0, 1000), { panned, dragged, perPx });
    await page.evaluate(`document.getElementById('acctWin').focus()`);
    await press(page, 'End');
    await settle(page);
    const end = await state();
    check('JOED-156', `${tag}: End on the strip's window returns to the newest value`, near(end.x1, end.k1, 1000), end);
    await page.evaluate('document.activeElement?.blur()');
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: centre, y: end.chart.top + end.chart.height / 2 });
    await settle(page);
    const tip = await page.evaluate(`(() => { const t = document.getElementById('acctTip'); return { on: t.classList.contains('on'), ...__audit.opaque(t), text: t.innerText }; })()`);
    check('AC-41', `${tag}: the account chart's tip is opaque and names the time and value`, tip.on && tip.bgAlpha === 1 && tip.opacity === 1 && /Vienna time/.test(tip.text) && /€/.test(tip.text), tip);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: centre, y: end.chart.top + end.chart.height / 2 });
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: centre, y: end.chart.top + end.chart.height / 2, button: 'left', clickCount: 2 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: centre, y: end.chart.top + end.chart.height / 2, button: 'left', clickCount: 2 });
    await settle(page);
    const fit = await state();
    check('JOED-156', `${tag}: double-click shows everything loaded`, near(fit.x0, fit.k0, 1000) && near(fit.x1, fit.k1, 1000), fit);
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    // The strip's end edge dragged far left on 1M: the closes keep three days.
    s = await range('1M');
    await drag(page, { x: s.track.left + s.track.width - 2, y: s.track.top + s.track.height / 2 }, { x: s.track.left + 4, y: s.track.top + s.track.height / 2 }, 10);
    await settle(page);
    const narrow = await state();
    check('JOED-156', `${tag}: dragging the strip's end edge keeps the closes' three days`, narrow.source === 'daily' && near(narrow.x1 - narrow.x0, 3 * DAY, 60e3) && !narrow.pressed.length, narrow);
    // Remembered in this browser: a reload shows no hint.
    await load(page, url, 'desk');
    const again = await state();
    check('JOED-156', `${tag}: the first-visit hint stays gone after a reload`, again.noteKind !== 'hint', again.noteKind);
    // The Settings link, a plain link the router follows, opens the account start.
    const link = await page.evaluate(`(() => { const a = document.querySelector('#acctSub a.set-link'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: a.getAttribute('href') }; })()`);
    await click(page, link);
    await settle(page);
    const opened = await page.evaluate(`({ on: document.getElementById('scr-settings').classList.contains('on'), top: document.getElementById('set-account')?.getBoundingClientRect().top, hash: location.hash })`);
    check('JOED-156', `${tag}: "set in Settings" opens Settings at the account start`, link.href === '#settings/set-account' && opened.on && opened.top >= 0 && opened.top < 300 && /^#settings/.test(opened.hash), { link, opened });
    await load(page, url, 'desk');
  } else {
    // A phone: Account details opens the kept holdings and the start; no strip.
    s = await state();
    await page.evaluate(`document.getElementById('acctDetailsBtn').click()`);
    await settle(page);
    const details = await page.evaluate(`({ expanded: document.getElementById('acctDetailsBtn').getAttribute('aria-expanded'), visible: __audit.visible(document.getElementById('acctDetails')), text: document.getElementById('acctDetails').innerText.replace(/\\s+/g, ' ').trim() })`);
    check('JOED-156', `${tag}: Account details shows the kept holdings, each in its own currency, and the start`,
      details.expanded === 'true' && details.visible && /^Kept holdings, each in its own currency: SXR8 € 12\.248,00 · TSLA \$ 441,20\. They count only in this whole-account figure\./.test(details.text) && !s.stripOn, { details, stripOn: s.stripOn });
    await page.evaluate(`document.getElementById('acctDetailsBtn').click()`);
    await settle(page);
  }
}
