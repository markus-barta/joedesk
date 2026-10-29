// P3 browser checks for the header, its nav and the hash routes: the nav and
// the Settings gear push history entries; Back and Forward walk them and
// return to the place left on the page; a typed address or a plain same-page
// link keeps its screen's query; an unknown route is Desk and an anchor only
// scrolls. Up to 480 px the nav is a bottom bar (a solid surface docked to the
// bottom edge with a hairline, three 44 px targets, the page ending above it)
// at 320–390 px; above, the header keeps the nav in one row. Browser
// execution belongs to CI; Node tests cover the route rules (test/header-nav.mjs).
import { scenario, NOW, at } from './board.mjs';
import { THEMES, configure, load, settle, waitFor } from './shots.mjs';
import { WIDE_FONT } from './gate.mjs';

const J = JSON.stringify;
const STATE = `(() => ({ screen: document.body.dataset.screen, hash: location.hash, length: history.length, query: window.__joedesk.route().query, scroll: scrollY,
  current: [...document.querySelectorAll('.top-in [data-go], .bottom-nav [data-go]')].filter(b => b.getAttribute('aria-current') === 'page').map(b => b.dataset.go) }))()`;
// One screen at one width: the bottom bar, its buttons, the page's end and the header row.
const LAYOUT = `(() => {
  const bar = document.querySelector('.bottom-nav'), cs = getComputedStyle(bar), r = bar.getBoundingClientRect();
  const probe = token => { const e = document.createElement('i'); e.style.color = 'var(' + token + ')'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; };
  const buttons = [...bar.querySelectorAll('button')].map(b => {
    const x = b.getBoundingClientRect(), label = [...b.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim()), t = document.createRange();
    t.selectNodeContents(label);
    const text = t.getBoundingClientRect(), icon = b.querySelector('svg').getBoundingClientRect();
    return { go: b.dataset.go, label: label.nodeValue.trim(), current: b.getAttribute('aria-current'), left: x.left, right: x.right, top: x.top, bottom: x.bottom,
      lines: new Set([...t.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top))).size,
      textInside: text.left >= x.left - 0.5 && text.right <= x.right + 0.5 && text.top >= x.top - 0.5 && text.bottom <= x.bottom + 0.5,
      iconDx: (icon.left + icon.right) / 2 - (x.left + x.right) / 2 };
  });
  const top = document.querySelector('.top-in');
  const out = { inner: innerWidth, innerHeight, scroll: document.documentElement.scrollWidth, screen: document.body.dataset.screen, fit: top.dataset.fit,
    bar: { visible: __audit.visible(bar), display: cs.display, position: cs.position, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height,
      background: cs.backgroundColor, surface: probe('--surface'), alpha: __audit.parseColor(cs.backgroundColor)?.a, filter: cs.backdropFilter,
      border: [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor].join(' '), hairline: '1px solid ' + probe('--line'), buttons },
    headerNav: __audit.visible(document.querySelector('.top .nav')), gear: __audit.visible(document.getElementById('settingsBtn')),
    reserve: parseFloat(getComputedStyle(document.getElementById('main')).paddingBottom), layout: __audit.headerLayout(),
    targets: [...document.querySelectorAll('.top-in button, .bottom-nav button')].filter(__audit.visible)
      .map(b => ({ go: b.dataset.go ?? b.id, ...__audit.target(b) })).filter(t => t.width < 43.5 || t.height < 43.5) };
  scrollTo(0, document.documentElement.scrollHeight);
  out.footBottom = document.querySelector('footer.foot').getBoundingClientRect().bottom;
  scrollTo(0, 0);
  return out;
})()`;
const rowOk = l => l.paper === 'PAPER' && l.inRow && !l.overlaps.length && !l.wordmarkClipped && l.status.lines === 1;

export async function headerNavChecks({ page, newBoard, check, shot }) {
  const { snapshot, history } = scenario(NOW);
  const b = await newBoard({ history });
  b.setNow(NOW);
  check('routes', 'design snapshot accepted', (await b.push(snapshot)).status === 200);
  b.setNow(at(NOW, 9));
  const state = () => page.evaluate(STATE);
  const click = async selector => { await page.evaluate(`document.querySelector(${J(selector)}).click()`); await settle(page); };
  const until = async expression => { await waitFor(page, expression, 5000); await settle(page); };
  const step = async (code, expression) => { await page.evaluate(code); await until(expression); return state(); };

  // 1 · One straight walk through the screens at 1024 px, then Back and Forward.
  await configure(page, { name: '1024', width: 1024, height: 768, mobile: false }, 'light');
  await load(page, b.url, 'desk');
  const start = await state();
  check('routes', 'the first load shows #desk, with Desk current in both navs', start.screen === 'desk' && start.hash === '#desk' && J(start.current) === J(['desk', 'desk']), start);
  await click('.top-in [data-go="results"]');
  const results = await state();
  check('routes', 'the nav pushes #results: one new entry, Results current in both navs', results.screen === 'results' && results.hash === '#results' &&
    results.length === start.length + 1 && J(results.current) === J(['results', 'results']), { start, results });
  await click('#settingsBtn');
  const settings = await state();
  check('routes', 'the gear opens Settings as #settings, one more entry, the gear alone current', settings.screen === 'settings' && settings.hash === '#settings' &&
    settings.length === start.length + 2 && J(settings.current) === J(['settings']), settings);
  await click('#settingsBtn');
  check('routes', 'the shown screen adds no entry', (await state()).length === start.length + 2);
  await page.evaluate(`(() => { const a = document.createElement('a'); a.id = 'routeProbe'; a.setAttribute('href', '#history?range=week&mode=money'); a.textContent = 'History this week'; document.body.append(a); })()`);
  await click('#routeProbe');
  const linked = await state();
  await page.evaluate(`document.getElementById('routeProbe').remove()`);
  check('routes', 'a plain same-page link shows History, keeps its query and pushes one entry', linked.screen === 'history' && linked.hash === '#history?range=week&mode=money' &&
    linked.query === 'range=week&mode=money' && linked.length === start.length + 3 && J(linked.current) === J(['history', 'history']), linked);
  const deep = await step(`location.hash = '#results?period=day&date=2026-10-28&desk=j'`, `window.__joedesk.route().query === 'period=day&date=2026-10-28&desk=j'`);
  check('routes', 'a typed #results?… shows Results and keeps its query in the address', deep.screen === 'results' && deep.hash === '#results?period=day&date=2026-10-28&desk=j' && deep.length === start.length + 4, deep);
  const walk = [];
  walk.push(await step('history.back()', `window.__joedesk.route().query === 'range=week&mode=money'`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'settings'`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'results' && window.__joedesk.route().query === ''`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'desk'`));
  walk.push(await step('history.forward()', `document.body.dataset.screen === 'results'`));
  check('routes', 'Back walks History (with its query), Settings, Results and Desk; Forward returns to Results; the current marks follow',
    J(walk.map(w => [w.screen, w.hash, w.current.join()])) === J([['history', '#history?range=week&mode=money', 'history,history'], ['settings', '#settings', 'settings'],
      ['results', '#results', 'results,results'], ['desk', '#desk', 'desk,desk'], ['results', '#results', 'results,results']]), walk);

  // 2 · Back returns to the place left on the page; a new screen opens at its top.
  await load(page, b.url, 'desk');
  await page.evaluate('scrollTo(0, Math.min(600, document.documentElement.scrollHeight - innerHeight))'); await settle(page);
  const left = await state();
  await click('.top-in [data-go="results"]');
  const opened = await state();
  const returned = await step('history.back()', `document.body.dataset.screen === 'desk'`);
  check('routes', 'Back to Desk restores the scroll position it was left at; Results opened at its top', left.scroll > 100 && opened.scroll === 0 && Math.abs(returned.scroll - left.scroll) <= 1, { left, opened, returned });
  // The place is read before the screen changes: a Desk taller than any other
  // screen, left 5000 px down, comes back there, not clamped to Results' height.
  await load(page, b.url, 'desk');
  await page.evaluate(`(() => { const s = document.createElement('div'); s.id = 'placeProbe'; s.style.height = '6000px'; document.getElementById('scr-desk').append(s); scrollTo(0, 5000); })()`); await settle(page);
  const deepLeft = await state();
  await click('.top-in [data-go="results"]');
  const deepBack = await step('history.back()', `document.body.dataset.screen === 'desk'`);
  await page.evaluate(`document.getElementById('placeProbe').remove()`);
  check('routes', 'the place is read before the screen changes: Desk left 5000 px down comes back there, not clamped to the shorter Results', deepLeft.scroll === 5000 && Math.abs(deepBack.scroll - 5000) <= 1, { deepLeft, deepBack });
  // Leaving by the browser keeps the place too: Desk, Results, scroll Results, Back, Forward.
  await load(page, b.url, 'desk');
  await click('.top-in [data-go="results"]');
  await page.evaluate('scrollTo(0, Math.min(700, document.documentElement.scrollHeight - innerHeight))'); await settle(page);
  const onResults = await state();
  const backToDesk = await step('history.back()', `document.body.dataset.screen === 'desk'`);
  const forwardAgain = await step('history.forward()', `document.body.dataset.screen === 'results'`);
  check('routes', 'Desk, Results, scroll Results, Back, Forward: Results comes back where Back left it, and Desk at its top', onResults.scroll > 100 && backToDesk.scroll === 0 && Math.abs(forwardAgain.scroll - onResults.scroll) <= 1, { onResults, backToDesk, forwardAgain });

  // 3 · An unknown route is Desk; an anchor scrolls and leaves the address.
  const unknown = await step(`location.hash = '#nowhere?period=day'`, `location.hash === '#desk'`);
  check('routes', 'an unknown route shows Desk and the address is corrected to #desk', unknown.screen === 'desk' && unknown.query === '', unknown);
  const anchored = await step(`location.hash = '#history/j-accounting'`, `document.body.dataset.screen === 'history' && location.hash === '#history'`);
  const inView = await page.evaluate(`(() => { const r = document.getElementById('j-accounting').getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; })()`);
  check('routes', '#history/j-accounting shows History with J’s bookkeeping in view; the address keeps #history', anchored.query === '' && inView, anchored);

  // 4 · Phones, 320–390 px: the bottom bar and the header, on every screen.
  for (const width of [320, 360, 390]) for (const theme of THEMES) {
    const viewport = { name: String(width), width, height: 844, mobile: true }, tag = `${width} ${theme}`;
    await configure(page, viewport, theme);
    await load(page, b.url, 'desk');
    const seen = [];
    for (const screen of ['desk', 'results', 'history', 'settings']) {
      if (screen !== 'desk') await click(screen === 'settings' ? '#settingsBtn' : `.bottom-nav [data-go="${screen}"]`);
      seen.push(await page.evaluate(LAYOUT));
      if (width === 320 && theme === 'light' && screen === 'desk') await shot(page, viewport, '320-light-desk-bottom-bar', 'Desk at 320 px: the header keeps brand, PAPER, the light, the gear and the theme button; Desk · Results · History in the solid bottom bar');
      if (width === 390 && theme === 'dark' && screen === 'settings') await shot(page, viewport, '390-dark-settings-bottom-bar', 'Settings at 390 px: the gear marked current in the header; the bottom bar keeps the three reading screens, none current');
    }
    check('bar', `${tag}: the bottom bar is a solid surface docked to the bottom edge with a 1 px hairline; the header has the gear and no nav`, seen.every(s => s.bar.visible &&
      s.bar.display === 'flex' && s.bar.position === 'fixed' && Math.abs(s.bar.bottom - s.innerHeight) <= 0.5 && Math.abs(s.bar.left) <= 0.5 && Math.abs(s.bar.right - s.inner) <= 0.5 &&
      s.bar.alpha === 1 && s.bar.background === s.bar.surface && s.bar.filter === 'none' && s.bar.border === s.bar.hairline && !s.headerNav && s.gear), seen.map(s => ({ screen: s.screen, bar: { ...s.bar, buttons: undefined } })));
    check('bar', `${tag}: Desk · Results · History, side by side inside the bar, each a 44 px target with its label on one line and its icon centred; the shown screen current, none on Settings`,
      seen.every(s => J(s.bar.buttons.map(x => [x.go, x.label])) === J([['desk', 'Desk'], ['results', 'Results'], ['history', 'History']]) &&
        s.bar.buttons.every((x, i, all) => x.right - x.left >= 43.5 && x.bottom - x.top >= 43.5 && x.left >= s.bar.left - 0.5 && x.right <= s.bar.right + 0.5 &&
          x.top >= s.bar.top - 0.5 && x.bottom <= s.bar.bottom + 0.5 && (!i || x.left >= all[i - 1].right - 0.5) && x.lines === 1 && x.textInside && Math.abs(x.iconDx) <= 0.5) &&
        J(s.bar.buttons.filter(x => x.current === 'page').map(x => x.go)) === J(s.screen === 'settings' ? [] : [s.screen])), seen.map(s => ({ screen: s.screen, buttons: s.bar.buttons })));
    check('bar', `${tag}: the page ends above the bar on every screen: its reserve is the bar's height and the footer ends at or above the bar`, seen.every(s =>
      Math.abs(s.reserve - s.bar.height) <= 0.5 && s.footBottom <= s.bar.top + 0.5), seen.map(s => ({ screen: s.screen, reserve: s.reserve, bar: s.bar.height, foot: s.footBottom, top: s.bar.top })));
    // The page's own width at 320 px belongs to each screen; the header and the bar are checked here.
    check('header', `${tag}: the header keeps brand, PAPER, the light, the gear and the theme button in one row without overlap; every control a 44 px target`,
      seen.every(s => rowOk(s.layout) && !s.targets.length), seen.map(s => ({ screen: s.screen, fit: s.fit, layout: s.layout, targets: s.targets })));
  }

  // 5 · Tablets and narrow windows, 481–820 px: the nav stays in the header.
  for (const [width, theme, font] of [[481, 'light', null], [481, 'light', WIDE_FONT], [600, 'dark', null], [820, 'light', null], [820, 'dark', WIDE_FONT]]) {
    const viewport = { name: String(width), width, height: 900, mobile: width <= 700 }, tag = `${width} ${theme}${font ? ' wide font' : ''}`;
    await configure(page, viewport, theme);
    await load(page, b.url, 'desk');
    if (font) { await page.evaluate(`document.documentElement.style.setProperty('--font', ${J(font)})`); await settle(page); }
    const seen = [];
    for (const screen of ['desk', 'settings']) {
      if (screen === 'settings') await click('#settingsBtn');
      seen.push(await page.evaluate(LAYOUT));
    }
    check('header', `${tag}: no bottom bar; the header row holds brand, PAPER, Desk · Results · History, the light, the gear and the theme button without overlap, every control a 44 px target, and the page keeps no bar reserve`,
      seen.every(s => !s.bar.visible && s.headerNav && s.gear && rowOk(s.layout) && s.layout.items.some(i => i.selector === '.nav' && i.visible) && !s.targets.length && s.reserve === 0 && s.scroll <= s.inner),
      seen.map(s => ({ screen: s.screen, fit: s.fit, layout: s.layout, targets: s.targets, reserve: s.reserve })));
    if (width === 481 && font) await shot(page, viewport, '481-light-settings-header-wide', 'Settings at 481 px in the wide font: the narrowest header with the nav in it, after its fitted steps; the gear marked current');
  }
}
