// P3 browser checks for the header, its nav and the hash routes: the nav and
// the Settings gear push history entries; Back and Forward walk them and
// return to the place left on the page, read before the screen changes and
// kept also when the browser left it; a typed address or a plain same-page
// link keeps its screen's query, and Results completes a bare #results with
// the view it shows (README: Results deep links); an unknown route is Desk
// and an anchor only scrolls. Up to 480 px the nav is a bottom bar (a solid surface docked to the
// bottom edge with a hairline, three 44 px targets, the page ending above it)
// at 320–390 px; above, the header keeps the nav in one row. A simulated
// bottom inset (the --safe-bottom property) lifts the bar and the tablet edit
// bar, with Details and the footer clear of them. Real hit regions
// (elementFromPoint) stay whole across every fitted step. Browser execution
// belongs to CI; Node tests cover the route and place rules (test/header-nav.mjs).
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
    targets: __audit.hits([...document.querySelectorAll('.top-in button, .bottom-nav button')].filter(__audit.visible)) };
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
  // Results names the view it shows in its address: this week, the board's
  // today and all desks on a fresh page (JOED-151 through route.js writeRoute).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(at(NOW, 9)));
  const home = `#results?period=week&date=${today}&desk=all`;
  const click = async selector => { await page.evaluate(`document.querySelector(${J(selector)}).click()`); await settle(page); };
  const until = async expression => { await waitFor(page, expression, 5000); await settle(page); };
  const step = async (code, expression) => { await page.evaluate(code); await until(expression); return state(); };

  // 1 · One straight walk through the screens at 1024 px, then Back and Forward.
  await configure(page, { name: '1024', width: 1024, height: 768, mobile: false }, 'light');
  await load(page, b.url, 'desk');
  // P3 reuses one target: earlier cases can fill Chromium's 50-entry history.
  // Start this walk at one entry so exact counts still detect extra pushes,
  // including a screen completing its own address by replacement.
  await page.s('Page.resetNavigationHistory');
  const start = await state();
  check('routes', 'the first load shows #desk in one history entry, with Desk current in both navs', start.screen === 'desk' && start.hash === '#desk' && start.length === 1 && J(start.current) === J(['desk', 'desk']), start);
  await click('.top-in [data-go="results"]');
  const results = await state();
  check('routes', 'the nav pushes Results: one new entry, whose address Results completes with its view; Results current in both navs', results.screen === 'results' && results.hash === home &&
    results.query === home.slice('#results?'.length) && results.length === start.length + 1 && J(results.current) === J(['results', 'results']), { start, results, home });
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
  // History names its whole view in its address (JOED-154): the link's range and
  // measure, and the desks it keeps (all), corrected in place.
  const historyLink = 'range=week&desk=all&mode=money';
  check('routes', 'a plain same-page link shows History, keeps its query in History’s own form and pushes one entry', linked.screen === 'history' && linked.hash === `#history?${historyLink}` &&
    linked.query === historyLink && linked.length === start.length + 3 && J(linked.current) === J(['history', 'history']), linked);
  const deep = await step(`location.hash = '#results?period=day&date=2026-10-28&desk=j'`, `window.__joedesk.route().query === 'period=day&date=2026-10-28&desk=j'`);
  check('routes', 'a typed #results?… shows Results and keeps its query in the address', deep.screen === 'results' && deep.hash === '#results?period=day&date=2026-10-28&desk=j' && deep.length === start.length + 4, deep);
  const walk = [];
  walk.push(await step('history.back()', `window.__joedesk.route().query === ${J(historyLink)}`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'settings'`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'results' && window.__joedesk.route().query === ${J(home.slice('#results?'.length))}`));
  walk.push(await step('history.back()', `document.body.dataset.screen === 'desk'`));
  walk.push(await step('history.forward()', `document.body.dataset.screen === 'results'`));
  check('routes', 'Back walks History (with its query), Settings, Results and Desk; Forward returns to Results; the current marks follow',
    J(walk.map(w => [w.screen, w.hash, w.current.join()])) === J([['history', `#history?${historyLink}`, 'history,history'], ['settings', '#settings', 'settings'],
      ['results', home, 'results,results'], ['desk', '#desk', 'desk,desk'], ['results', home, 'results,results']]), walk);

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
  // A reload returns to the place once the page has grown to it (its data comes in after the load).
  await page.evaluate('new Promise(r => setTimeout(r, 700))');
  const reloading = await state();
  await page.s('Page.reload', {});
  await waitFor(page, `document.documentElement.dataset.ready === '1' && document.readyState === 'complete'`);
  await waitFor(page, `Math.abs(scrollY - ${J(reloading.scroll)}) <= 1`, 5000).catch(() => {});
  const reloaded = await state();
  check('routes', 'a reload of Results returns to the place it was left at, once the page has grown to it', reloading.scroll > 100 && reloaded.screen === 'results' &&
    reloaded.hash === home && Math.abs(reloaded.scroll - reloading.scroll) <= 1, { reloading, reloaded, home });

  // 3 · An unknown route is Desk; an anchor scrolls and leaves the address.
  const unknown = await step(`location.hash = '#nowhere?period=day'`, `location.hash === '#desk'`);
  check('routes', 'an unknown route shows Desk and the address is corrected to #desk', unknown.screen === 'desk' && unknown.query === '', unknown);
  // The anchor only scrolls; the address then names History's own view (its defaults after the reload above).
  const historyView = 'range=week&desk=all&mode=change';
  const anchored = await step(`location.hash = '#history/j-accounting'`, `document.body.dataset.screen === 'history' && location.hash === ${J(`#history?${historyView}`)}`);
  const inView = await page.evaluate(`(() => { const r = document.getElementById('j-accounting').getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; })()`);
  check('routes', '#history/j-accounting shows History with J’s bookkeeping in view; the address keeps History’s view, not the anchor', anchored.query === historyView && inView, anchored);

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

  // 4a · A simulated 34 px home-indicator inset at 390 px: the bar pads by
  // it, the page reserve follows, and Details still ends 8 px above the bar.
  await configure(page, { name: '390', width: 390, height: 844, mobile: true }, 'light');
  await load(page, b.url, 'desk');
  await page.evaluate(`document.documentElement.style.setProperty('--safe-bottom', '34px')`); await settle(page);
  await click('#hdrHealth');
  const inset = await page.evaluate(`(() => {
    const nav = document.querySelector('.bottom-nav'), bar = nav.getBoundingClientRect(), pop = document.getElementById('healthPop'), r = pop.getBoundingClientRect();
    return { open: pop.classList.contains('on'), barTop: bar.top, barHeight: bar.height, padding: parseFloat(getComputedStyle(nav).paddingBottom),
      reserve: parseFloat(getComputedStyle(document.getElementById('main')).paddingBottom), popTop: r.top, popBottom: r.bottom,
      tallest: r.top + parseFloat(getComputedStyle(pop).maxHeight), inner: innerHeight };
  })()`);
  await click('#hdrHealth');
  await page.evaluate(`document.documentElement.style.removeProperty('--safe-bottom')`); await settle(page);
  check('bar', '390 light, a simulated 34 px bottom inset: the bar pads by it (40 px, 103 px tall, still docked), the page reserve follows, and Details ends at least 8 px above the bar at its tallest',
    inset.open && inset.padding === 40 && Math.abs(inset.barHeight - 103) <= 0.5 && Math.abs(inset.barTop + inset.barHeight - inset.inner) <= 0.5 &&
    Math.abs(inset.reserve - inset.barHeight) <= 0.5 && inset.tallest <= inset.barTop - 8 + 0.5 && inset.popBottom <= inset.barTop - 8 + 0.5, inset);

  // 4b · At 820 px on Settings a simulated 21 px inset lifts the floating edit
  // bar by it, and the footer's reserve grows with it.
  await configure(page, { name: '820', width: 820, height: 900, mobile: false }, 'light');
  await load(page, b.url, 'settings');
  await page.evaluate(`document.documentElement.style.setProperty('--safe-bottom', '21px')`); await settle(page);
  const lifted = await page.evaluate(`(() => {
    scrollTo(0, document.documentElement.scrollHeight);
    const bar = document.getElementById('editbar').getBoundingClientRect(), foot = document.querySelector('footer.foot').getBoundingClientRect();
    const out = { visible: __audit.visible(document.getElementById('editbar')), barTop: bar.top, barBottom: bar.bottom, footBottom: foot.bottom, inner: innerHeight };
    scrollTo(0, 0); return out;
  })()`);
  await page.evaluate(`document.documentElement.style.removeProperty('--safe-bottom')`); await settle(page);
  check('bar', '820 light Settings, a simulated 21 px bottom inset: the floating edit bar rises by it (8 + 21 px) and, at the end of the page, the footer still ends 12 px above it',
    lifted.visible && Math.abs(lifted.inner - lifted.barBottom - 29) <= 0.5 && lifted.footBottom <= lifted.barTop - 12 + 0.5, lifted);

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

  // 6 · Real hit regions across the fitting thresholds: PAPER grows until the
  // header has taken every step; at each step each control's target, as
  // elementFromPoint finds it, is whole, 44 px each way and shared with no
  // neighbour (36 px desktop buttons, 44 px tablet and phone buttons).
  for (const [width, mobile] of [[1024, false], [820, false], [390, true]]) {
    await configure(page, { name: String(width), width, height: 900, mobile }, 'light');
    await load(page, b.url, 'desk');
    const steps = await page.evaluate(`(async () => {
      const style = document.createElement('style'), seen = new Map();
      const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
      document.head.append(style);
      for (let grow = 0; grow <= 1600; grow += 8) {
        style.textContent = '#modeLabel { padding-right: ' + (10 + grow) + 'px; }';
        await frames();
        const fit = document.querySelector('.top-in').dataset.fit;
        if (!seen.has(fit)) seen.set(fit, __audit.hits([...document.querySelectorAll('.top-in button')].filter(__audit.visible)));
        if (fit.split(' ').includes('squeeze')) break;
      }
      style.remove(); await frames();
      return [...seen].map(([fit, faults]) => ({ fit, faults }));
    })()`);
    check('header', `${width}: growing PAPER walks the header through its fitted steps (${steps.map(s => s.fit || 'none').join(' · ')}); at every step each control's real hit region is whole, 44 px each way and shared with no neighbour`,
      ['word', 'labels', 'tight', 'icons', 'squeeze'].every(step => steps.some(s => s.fit.split(' ').includes(step))) && steps.every(s => !s.faults.length), steps);
  }
}
