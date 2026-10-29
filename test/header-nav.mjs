// The header and its routes under Node: hash routes with each screen's own
// query, the history steps, links, route readers, a shown screen writing its
// own query (Results' deep links, results.js), the place each history
// entry keeps (app.js's own navigation code in a simulated browser), the
// header and bottom-bar markup, the CSS that keeps the bar on phones clear of
// the safe area, and the money no-wrap helper. Browser CI
// (scripts/browser/header-nav.mjs, the P3/P5 sweeps) owns pixels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import * as nodeModule from 'node:module';
import { htmlDocument } from './fixtures/preview-dom.mjs';

// results.js as the board serves it: time.mjs and contracts/ come from the
// repo root (test/results-model.mjs maps them the same way).
const mapped = (specifier, parentURL) => (parentURL?.includes('/public/joe/') && !parentURL.includes('/public/joe/contracts/') &&
  (specifier === './time.mjs' || specifier === './market-calendar.json' || specifier.startsWith('./contracts/'))
  ? new URL(`../../${specifier.slice(2)}`, parentURL).href : specifier);
if (nodeModule.registerHooks) {
  nodeModule.registerHooks({ resolve: (specifier, context, next) => next(mapped(specifier, context.parentURL), context) });
} else {
  nodeModule.register(`data:text/javascript,${encodeURIComponent(`const mapped = ${mapped.toString()};
export async function resolve(specifier, context, next) { return next(mapped(specifier, context.parentURL), context); }`)}`, import.meta.url);
}
const { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, onRoute, applyRoute, onAddress, writeRoute, createPlaces } = await import('../public/joe/route.js');
const results = await import('../public/joe/results.js');
const { moneyNoWrap } = await import('../public/joe/ui.js');
const { MINUS, NB } = await import('../public/joe/format.js');
const html = readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(new URL('../public/joe/app.js', import.meta.url), 'utf8');
const doc = htmlDocument(html);
const elements = node => node.children.filter(child => typeof child !== 'string');
const DESK = { screen: 'desk', anchor: null, query: '', known: false };

test('routes: a screen, an anchor to scroll to and the screen’s own query; anything else is Desk', () => {
  assert.deepEqual(SCREENS, ['desk', 'results', 'history', 'settings']);
  assert.deepEqual(parseRoute('#desk'), { screen: 'desk', anchor: null, query: '', known: true });
  assert.deepEqual(parseRoute('#results?period=day&date=2026-10-28&desk=j'), { screen: 'results', anchor: null, query: 'period=day&date=2026-10-28&desk=j', known: true });
  assert.deepEqual(parseRoute('#history?range=week&mode=money'), { screen: 'history', anchor: null, query: 'range=week&mode=money', known: true });
  assert.deepEqual(parseRoute('#settings'), { screen: 'settings', anchor: null, query: '', known: true });
  assert.deepEqual(parseRoute('#settings/mode'), { screen: 'settings', anchor: 'mode', query: '', known: true });
  assert.deepEqual(parseRoute('#history/j-accounting?range=week'), { screen: 'history', anchor: 'j-accounting', query: 'range=week', known: true });
  assert.deepEqual(parseRoute('#results/'), { screen: 'results', anchor: null, query: '', known: true });
  assert.deepEqual(parseRoute('results?desk=joe'), { screen: 'results', anchor: null, query: 'desk=joe', known: true });
  for (const hash of ['', '#', '#nowhere', '#nowhere?period=day', '#Results', '#desk2', '#?period=day', null, undefined]) {
    assert.deepEqual(parseRoute(hash), DESK, String(hash));
  }
});

test('routes: the address keeps the screen and its query; an anchor only scrolls', () => {
  for (const hash of ['#desk', '#results?period=day&date=2026-10-28&desk=all', '#history?range=week&mode=money', '#settings']) {
    assert.equal(routeHash(parseRoute(hash)), hash);
  }
  assert.equal(routeHash({ screen: 'settings' }), '#settings');
  assert.equal(routeHash(parseRoute('#settings/mode')), '#settings');
  assert.ok(sameRoute(parseRoute('#settings/mode'), { screen: 'settings', query: '' }));
  assert.ok(sameRoute(parseRoute('#results?desk=j'), { screen: 'results', query: 'desk=j' }));
  assert.ok(!sameRoute(parseRoute('#results?desk=j'), { screen: 'results', query: '' }), 'another query is another place');
  assert.ok(!sameRoute(parseRoute('#desk'), { screen: 'results', query: '' }));
});

test('history steps: the reader’s own navigation pushes; every other arrival only corrects the address', () => {
  const results = { screen: 'results', query: '' };
  assert.equal(historyStep('#desk', results, true), 'push');
  assert.equal(historyStep('#desk', { screen: 'history', query: 'range=week&mode=money' }, true), 'push');
  assert.equal(historyStep('#results?period=day', results, true), 'push');
  assert.equal(historyStep('#results', results, true), null, 'the shown screen adds no entry');
  assert.equal(historyStep('#results?period=day', { screen: 'results', query: 'period=day' }, true), null);
  assert.equal(historyStep('#results/', results, true), 'replace', 'the same place in another spelling is corrected');
  // The first load, Back, Forward and a typed address: never a new entry.
  assert.equal(historyStep('#results', results, false), null);
  assert.equal(historyStep('#results?period=day', { screen: 'results', query: 'period=day' }, false), null);
  assert.equal(historyStep('', { screen: 'desk', query: '' }, false), 'replace');
  assert.equal(historyStep('#settings/mode', { screen: 'settings', query: '' }, false), 'replace');
  assert.equal(historyStep('#nowhere', { screen: 'desk', query: '' }, false), 'replace');
  assert.equal(historyStep('#nowhere', { screen: 'desk', query: '' }, true), 'replace', 'an unknown address already shows Desk');
});

test('links: a plain click on a same-page link to a screen navigates; new tabs, other links and handled clicks stay the browser’s', () => {
  const link = (href, target = null) => ({ getAttribute: key => (key === 'href' ? href : key === 'target' ? target : null) });
  const click = (extra = {}) => ({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra });
  assert.deepEqual(linkRoute(click(), link('#results?period=day&date=2026-10-28&desk=all')),
    { screen: 'results', anchor: null, query: 'period=day&date=2026-10-28&desk=all', known: true });
  assert.deepEqual(linkRoute(click(), link('#history?range=week&mode=money')), parseRoute('#history?range=week&mode=money'));
  assert.deepEqual(linkRoute(click(), link('#settings/mode', '_self')), parseRoute('#settings/mode'));
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    assert.equal(linkRoute(click(extra), link('#results')), null, JSON.stringify(extra));
  }
  for (const [href, target] of [['#nowhere', null], ['#', null], ['', null], ['http://hsb1.lan/joe/', null], ['/joe/#results', null], ['#results', '_blank']]) {
    assert.equal(linkRoute(click(), link(href, target)), null, `${href} ${target}`);
  }
  assert.equal(linkRoute(click(), null), null);
});

test('route readers: each screen gets its own parameters before it renders, possibly none, one reader per screen', () => {
  const seen = [];
  try {
    onRoute('results', (params, r) => seen.push(['results', params.get('period'), params.get('date'), params.get('desk'), r.screen]));
    onRoute('history', params => seen.push(['history', [...params].map(([k, v]) => `${k}=${v}`).join('&')]));
    applyRoute({ screen: 'results', query: 'period=day&date=2026-10-28&desk=j' });
    applyRoute({ screen: 'results', query: '' });
    applyRoute({ screen: 'history', query: 'range=week&mode=money' });
    applyRoute({ screen: 'desk', query: 'ignored=1' });
    applyRoute({ screen: 'settings' });
    assert.deepEqual(seen, [['results', 'day', '2026-10-28', 'j', 'results'], ['results', null, null, null, 'results'], ['history', 'range=week&mode=money']]);
    onRoute('results', () => seen.push('replaced'));
    applyRoute({ screen: 'results', query: 'period=week' });
    assert.equal(seen.at(-1), 'replaced');
    assert.equal(seen.length, 4);
  } finally {
    onRoute('results', undefined); onRoute('history', undefined);
  }
});

// A browser for the navigation code: session history with states (Back and
// Forward fire popstate, then hashchange when the fragment differs; a typed
// address adds a browser-made entry) that, like WebKit, refuses a history call
// beyond 100 in 30 s; a page as tall as the shown screen (one not yet rendered,
// or rendered before its data is in, is short, so the scroll position clamps
// as in a real layout); a reload (the same entry, a new page at its top, its
// data still coming); ResizeObserver, timers and events.
function browser() {
  const entries = [{ hash: '#desk', state: null }], timers = new Map(), rendered = new Set(), observers = new Set(), calls = [];
  const tall = { desk: 3000, results: 2400, history: 2400, settings: 2400 };
  let listeners = new Map(), index = 0, clock = 0, timerId = 0, visible = 'desk', y = 0, data = true;
  const max = () => Math.max(0, 110 + (rendered.has(visible) ? tall[visible] : 600) - 800);
  const hashOf = url => new URL(url, 'http://board.test/joe/').hash;
  const fire = type => { for (const fn of listeners.get(type) ?? []) fn({ type }); };
  const spend = () => {
    calls.push(clock);
    if (calls.filter(t => clock - t < 30000).length > 100) throw Object.assign(new Error('history used more than 100 times in 30 seconds'), { name: 'SecurityError' });
  };
  class ResizeObserver { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } }
  const win = {
    history: {
      get state() { return structuredClone(entries[index].state); },
      replaceState(state, _title, url) { spend(); entries[index] = { hash: url === undefined ? entries[index].hash : hashOf(url), state: structuredClone(state) }; },
      pushState(state, _title, url) { spend(); entries.splice(index + 1, Infinity, { hash: hashOf(url), state: structuredClone(state) }); index++; },
    },
    location: { get hash() { return entries[index].hash; }, pathname: '/joe/', search: '' },
    get scrollY() { y = Math.min(y, max()); return y; },
    scrollTo(_x, to) { y = Math.max(0, Math.min(to, max())); },
    setTimeout(fn, ms) { timers.set(++timerId, { at: clock + ms, fn }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    performance: { now: () => clock },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    ResizeObserver,
  };
  return { win, entries, calls, get index() { return index; },
    // The most history calls the page made in any 30 s.
    peak: () => Math.max(0, ...calls.map(t => calls.filter(u => u >= t && u - t < 30000).length)),
    show: screen => { visible = screen; }, render: () => { if (data) rendered.add(visible); },
    // The shown screen's data arrives: it renders at its full height.
    load() { data = true; rendered.add(visible); for (const o of [...observers]) o.callback([]); },
    scroll(to) { y = Math.max(0, Math.min(to, max())); fire('scroll'); },
    fire,
    tick(ms) {
      const end = clock + ms;
      for (let next; (next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]);) {
        timers.delete(next[0]); clock = Math.max(clock, next[1].at); next[1].fn();
      }
      clock = end;
    },
    traverse(delta) { const from = entries[index].hash; index += delta; fire('popstate'); if (entries[index].hash !== from) fire('hashchange'); },
    typed(hash, before = () => {}) { entries.splice(index + 1, Infinity, { hash, state: null }); index++; before(); fire('popstate'); fire('hashchange'); },
    reload() { listeners = new Map(); timers.clear(); observers.clear(); rendered.clear(); y = 0; data = false; },
  };
}
// app.js's own navigation (go, the one address path with its screen writer,
// follow and the first load), run against that browser. Everything else go()
// touches is a quiet stand-in; a test may put its own in (`extra`).
const REGIONS = [/^  let shown = [\s\S]*?^  function go\(next[\s\S]*?^  \}$/m, /^  const follow = [\s\S]*?addEventListener\('hashchange', follow\);$/m,
  /^  try \{ history\.scrollRestoration[\s\S]*?^  go\(first\.screen[^\n]*$/m];
function boot(source, b, extra = {}) {
  const code = REGIONS.map(re => { const m = re.exec(source); assert.ok(m, `app.js region ${re}`); return m[0]; }).join('\n');
  const ctx = { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, applyRoute, onAddress, createPlaces,
    screen: 'desk', dirtyHistory: false, __joedesk: {}, tips: { hide() {} }, closePop() {}, forgetCharts() {}, forgetResults() {},
    feed: { refreshActions() {} }, guard: (_name, fn) => fn(), render: () => b.render(), SETTINGS_SECTIONS: [], showSection() {},
    $: selector => ({ classList: { toggle: (_name, on) => { if (on) b.show(selector.slice('#scr-'.length)); } } }), $$: () => [],
    document: { body: { dataset: {} }, getElementById: () => null, documentElement: {} }, ...extra };
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(b.win));
  ctx.window = ctx;
  createContext(ctx);
  runInContext(code, ctx);
  return runInContext('go', ctx);
}

test('places: the place is read before the page changes, so a screen taller than the next one comes back where it was left', () => {
  const b = browser(), go = boot(app, b);
  b.scroll(2000);
  go('results', { push: true });
  assert.equal(b.win.scrollY, 0, 'Results opens at its top');
  b.traverse(-1);
  assert.equal(b.win.location.hash, '#desk');
  assert.equal(b.win.scrollY, 2000, 'Back returns to Desk 2000 px down, not clamped to the shorter, unrendered Results');
});

test('places: Back and Forward return to the place the browser left (Desk, Results, scroll, Back, Forward)', () => {
  for (const wait of [0, 1000]) {
    const b = browser(), go = boot(app, b);
    go('results', { push: true });
    b.scroll(1500);
    b.tick(wait);
    b.traverse(-1);
    assert.equal(b.win.scrollY, 0, 'Desk was left at its top');
    b.traverse(1);
    assert.equal(b.win.location.hash, '#results');
    assert.equal(b.win.scrollY, 1500, `Forward returns to Results 1500 px down (${wait} ms after the scroll)`);
    b.traverse(-1);
    assert.equal(b.win.scrollY, 0);
  }
});

test('places: a browser-made entry gets no save from the screen before it, opens at its top, and Back returns', () => {
  const b = browser(), go = boot(app, b);
  go('results', { push: true });
  b.scroll(1500);
  // The pending save runs after the browser made the entry, before the board takes it up.
  b.typed('#history?range=week&mode=money', () => b.tick(1000));
  assert.equal(b.win.location.hash, '#history?range=week&mode=money');
  assert.equal(b.entries[b.index].state?.joeScrollY, undefined, 'no place written into the new entry');
  assert.equal(b.win.scrollY, 0, 'History opens at its top');
  b.traverse(-1);
  assert.equal(b.win.scrollY, 1500, 'Back returns to Results where it was left');
});

test('places: one saver writes at most every 500 ms; a flush skips the spacing, never the 60-call budget; navigation always goes through', () => {
  const b = browser(), places = createPlaces(b.win);
  b.render();
  assert.equal(places.step(), true, 'the first entry is taken up');
  assert.equal(places.step(), false, 'the same entry again is no step');
  const id = b.entries[0].state.joeEntry;
  assert.ok(id);
  let start = b.calls.length;
  for (let t = 0; t < 2000; t += 16) { b.scroll(t); places.scrolled(); b.tick(16); }
  b.tick(600);
  assert.ok(b.calls.length - start <= 5, `${b.calls.length - start} writes for 2 s of scrolling`);
  assert.equal(b.entries[0].state.joeScrollY, b.win.scrollY, 'the last place is saved');
  b.scroll(1200); places.flush();
  assert.equal(b.entries[0].state.joeScrollY, 1200, 'a flush writes at once');
  // Flushes as fast as they come: the saves stop at 60 calls in 30 s.
  start = b.calls.length;
  for (let i = 0; i < 100; i++) { b.scroll(100 + i * 10); places.flush(); b.tick(10); }
  assert.ok(b.peak() <= 60, `${b.peak()} history calls in 30 s`);
  assert.notEqual(b.entries[0].state.joeScrollY, b.win.scrollY, 'the budget held the last save back');
  // The board's navigation still goes through, with WebKit's room to spare.
  assert.equal(places.push('/joe/#results'), true);
  assert.equal(b.win.location.hash, '#results');
  assert.equal(b.entries[1].state.joeEntry === id, false, 'the new entry has its own id');
  // A reload of the first entry: a new page restores from its state.
  b.traverse(-1);
  const again = createPlaces(b.win);
  again.step();
  assert.equal(b.entries[0].state.joeEntry, id);
  assert.equal(again.saved(), b.entries[0].state.joeScrollY);
});

test('places: a reload returns to the entry’s place once the page has grown to it (through app.js’s own start)', () => {
  const b = browser(), go = boot(app, b);
  go('results', { push: true });
  b.scroll(1500);
  b.tick(1000);
  assert.equal(b.entries[b.index].state.joeScrollY, 1500, 'the place is in the entry for a reload');
  b.reload();
  boot(app, b);
  assert.equal(b.win.location.hash, '#results');
  assert.ok(b.win.scrollY < 1500, 'the page is still short: its data is not in yet');
  b.load();
  assert.equal(b.win.scrollY, 1500, 'the reload returns to Results 1500 px down');
  // The reader's own scroll ends the wait; so does the 15 s limit.
  b.scroll(1200); b.tick(1000);
  b.reload(); boot(app, b);
  b.fire('wheel'); b.scroll(0);
  b.load();
  assert.equal(b.win.scrollY, 0, 'the reader scrolled before the data came: the page stays where they are');
  b.reload(); boot(app, b);
  b.tick(16000);
  b.load();
  assert.equal(b.win.scrollY, 0, 'after 15 s the page no longer jumps');
});

test('places: many short scrolls stay within the history budget, navigation goes through in the middle of them, and the last place is saved (through app.js)', () => {
  const b = browser(), go = boot(app, b);
  go('results', { push: true });
  let y = 0;
  // Four short scrolls a second, each ending in scrollend.
  const scrolls = seconds => {
    for (let i = 0; i < seconds * 4; i++) {
      for (let k = 0; k < 3; k++) { y = 40 + (y + 20) % 1600; b.scroll(y); b.tick(16); }
      b.fire('scrollend');
      b.tick(250 - 48);
    }
  };
  scrolls(60);
  assert.ok(b.peak() <= 60, `${b.peak()} history calls in some 30 s: WebKit allows about 100, and navigation needs room`);
  // Straight from a minute of scrolling: the nav, then Back.
  const left = y;
  go('history', { push: true });
  assert.equal(b.win.location.hash, '#history', 'navigation goes through');
  b.traverse(-1);
  assert.equal(b.win.location.hash, '#results');
  assert.equal(b.win.scrollY, left, 'Back returns to the place left on Results');
  // Another burst, then quiet: the saver catches up within its budget.
  scrolls(10);
  b.tick(31000);
  assert.equal(b.entries[b.index].state.joeScrollY, y, 'the last place is in the entry, for a reload');
  assert.ok(b.peak() <= 62, `${b.peak()} history calls in some 30 s, the two navigations included`);
});

test('screen writer: the reader’s own change of a shown screen pushes one entry, a correction replaces, Back and Forward return to each view and place', () => {
  const b = browser(), go = boot(app, b), reads = [];
  onRoute('results', (_params, route) => reads.push(route.query));
  try {
    go('results', { push: true });
    const opened = b.entries.length, week = 'period=week&date=2026-10-14&desk=all', day = 'period=day&date=2026-10-12&desk=j';
    // A correction: the same entry now names the view.
    assert.equal(writeRoute('results', week), true);
    assert.deepEqual([b.win.location.hash, b.entries.length], [`#results?${week}`, opened]);
    // The reader's own change: one new entry, the page left where it is; the same view again adds none.
    b.scroll(800);
    assert.equal(writeRoute('results', day, { push: true }), true);
    assert.equal(writeRoute('results', day, { push: true }), true);
    assert.deepEqual([b.win.location.hash, b.entries.length, b.win.scrollY], [`#results?${day}`, opened + 1, 800]);
    // Only the shown screen writes its query.
    assert.equal(writeRoute('history', 'range=week'), false);
    assert.equal(writeRoute('history', 'range=week', { push: true }), false);
    assert.equal(b.win.location.hash, `#results?${day}`);
    // Back and Forward: each entry's view, read before it renders, at its place.
    b.scroll(300);
    b.traverse(-1);
    assert.deepEqual([b.win.location.hash, reads.at(-1), b.win.scrollY], [`#results?${week}`, week, 800]);
    b.traverse(1);
    assert.deepEqual([b.win.location.hash, reads.at(-1), b.win.scrollY], [`#results?${day}`, day, 300]);
    // A correction never overwrites an address that changed outside the page and still waits for follow().
    b.typed('#results?desk=joe', () => assert.equal(writeRoute('results', day), false));
    assert.deepEqual([b.win.location.hash, reads.at(-1)], ['#results?desk=joe', 'desk=joe']);
    // app.js writes Results' address only through it: a change pushes, the render corrects.
    assert.match(app, /const commit = \(\) => writeRoute\('results', parseRoute\(resultsUrl\(view\(\)\)\)\.query, \{ push: true \}\);/);
    assert.match(app, /if \(url\) writeRoute\('results', parseRoute\(url\)\.query\);/);
    assert.doesNotMatch(app.replace(/^\s*\/\/.*$/gm, ''), /history\.(?:push|replace)State/, 'no other history call in app.js');
  } finally {
    onRoute('results', undefined);
  }
});

test('screen writer: fifty changes of the view in 30 s between scrolls stay within WebKit’s limit, each keeps its entry, and the last place is saved', () => {
  const b = browser(), go = boot(app, b);
  go('results', { push: true });
  const opened = b.entries.length;
  let y = 0;
  for (let i = 0; i < 50; i++) {
    for (let k = 0; k < 3; k++) { y = 40 + (y + 37) % 1500; b.scroll(y); b.tick(100); }
    b.fire('scrollend');
    b.tick(300);
    writeRoute('results', `period=day&date=2026-10-${String(1 + (i % 14)).padStart(2, '0')}&desk=${['all', 'j', 'joe', 'joel'][i % 4]}`, { push: true });
  }
  assert.ok(b.peak() <= 100, `${b.peak()} history calls in some 30 s: the saves yield to the pushes`);
  assert.equal(b.entries.length, opened + 50, 'every change has its own entry');
  b.scroll(1234);
  b.tick(31000);
  assert.equal(b.entries[b.index].state.joeScrollY, 1234, 'the last place is in the entry, for a reload');
});

test('active nav: the screen already shown adds no entry, whatever query it gave its address, and Back leaves it (Results, History, Settings)', () => {
  // History's own query stands in for JOED-154's (#history?range=…&desk=…&mode=…).
  for (const [name, own] of [['results', 'period=week&date=2026-10-14&desk=all'], ['history', 'range=fit&desk=all&mode=change'], ['settings', null]]) {
    const b = browser(), go = boot(app, b), reads = [];
    onRoute(name, (_params, route) => reads.push(route.query));
    try {
      go(name, { push: true });
      // The screen names its view in its address, a correction of that entry
      // (Results' render; History's own query once JOED-154 is in).
      if (own) assert.equal(writeRoute(name, own), true);
      const hash = own ? `#${name}?${own}` : `#${name}`, entries = b.entries.length;
      assert.deepEqual([b.win.location.hash, entries], [hash, 2], `${name}: Desk, then one entry for ${name}`);
      reads.length = 0;
      // Its nav button (or the gear) again, and a bare anchor on it: the screen as it is.
      go(name, { push: true });
      go(name, { anchor: 'nowhere', push: true });
      assert.deepEqual([b.win.location.hash, b.entries.length], [hash, entries], `${name}: the shown screen adds no entry`);
      assert.deepEqual(reads, [], `${name}: the screen as it is: its reader does not run again`);
      b.traverse(-1);
      assert.equal(b.win.location.hash, '#desk', `${name}: Back leaves it for Desk`);
      // Another query for the shown screen is another place: one entry, and Back returns.
      if (own) {
        b.traverse(1);
        go(name, { query: 'other=1', push: true });
        assert.deepEqual([b.win.location.hash, b.entries.length], [`#${name}?other=1`, entries + 1]);
        b.traverse(-1);
        assert.equal(b.win.location.hash, hash);
      }
    } finally {
      onRoute(name, undefined);
    }
  }
});

test('active nav: the screen already shown keeps its state; its reader does not run again for its own nav, the gear or an anchor (Results’ browsed month, History’s view)', () => {
  // Results, through app.js's own reader and the real results.js.
  {
    const b = browser(), go = boot(app, b), reads = [];
    const warm = { today: '2026-10-14', clock: true, ix: {}, trackingStart: '2026-09-10' };
    // What renderResults does with a waiting link, and the address app.js then corrects to.
    const shownQuery = () => { results.settleResultsRoute(warm); return parseRoute(results.resultsUrl(warm)).query; };
    const saved = { ...results.RS };
    onRoute('results', (_params, route) => { reads.push(route.query); return results.requestResultsRoute(route.query); });
    try {
      Object.assign(results.RS, { period: 'week', anchor: '2026-10-14', sel: '2026-10-14', desk: 'all', cal: [2026, 9], moved: false });
      go('results', { push: true });
      assert.equal(writeRoute('results', shownQuery()), true);
      // The gate's case: select 14 Oct, then browse to September without selecting a day.
      assert.equal(results.selectDay('2026-10-14', warm), true);
      results.showMonth(-1);
      assert.deepEqual(results.RS.cal, [2026, 8]);
      const hash = b.win.location.hash, entries = b.entries.length;
      reads.length = 0;
      // Results' nav button again, and a plain link to #results/cal.
      for (const request of [{ push: true }, { anchor: 'cal', push: true }]) {
        go('results', request);
        assert.equal(writeRoute('results', shownQuery()), true);
        assert.deepEqual(results.RS.cal, [2026, 8], `${JSON.stringify(request)}: September stays on show`);
      }
      assert.deepEqual(reads, [], 'the reader does not run for the screen as it is');
      assert.deepEqual([b.win.location.hash, b.entries.length, results.RS.sel], [hash, entries, '2026-10-14']);
      // A typed #results/cal is an arrival: it reaches the reader empty, and September stays too.
      b.typed('#results/cal');
      assert.equal(writeRoute('results', shownQuery()), true);
      assert.deepEqual([reads, results.RS.cal, b.win.location.hash], [[''], [2026, 8], hash]);
    } finally {
      onRoute('results', undefined);
      results.requestResultsRoute('');
      Object.assign(results.RS, saved);
    }
  }
  // History: a reader that resets its view, as one taking JOED-154's query would.
  {
    const b = browser(), go = boot(app, b);
    let view = 'zoomed', reads = 0;
    onRoute('history', () => { reads++; view = 'reset'; });
    try {
      go('history', { push: true });
      assert.equal(writeRoute('history', 'range=fit&desk=all&mode=change'), true);
      view = 'zoomed'; reads = 0;
      go('history', { push: true });
      go('history', { anchor: 'j-accounting', push: true });
      assert.deepEqual([view, reads, b.win.location.hash], ['zoomed', 0, '#history?range=fit&desk=all&mode=change']);
    } finally {
      onRoute('history', undefined);
    }
  }
});

test('Results links through follow(): a link that arrives while Results is shown closes what is open, reaches Results before it renders, keeps its address while it waits, then applies once', () => {
  const b = browser(), seen = [], spies = { tips: 0, pop: 0, dialogs: 0 };
  const go = boot(app, b, {
    tips: { hide: () => { spies.tips++; } }, closePop: () => { spies.pop++; },
    $$: selector => (selector === 'dialog[open]' ? [{ close: () => { spies.dialogs++; } }] : []),
    render: () => { seen.push(['render', results.resultsRoutePending()]); b.render(); },
  });
  // app.js's own Results reader, here with a note of each call.
  assert.match(app, /onRoute\('results', \(_params, route\) => requestResultsRoute\(route\.query\)\);/);
  onRoute('results', (_params, route) => { seen.push(['read', route.query]); return results.requestResultsRoute(route.query); });
  // The record and the server's date once they are in: what renderResults does
  // with a waiting link, and the address app.js then corrects to.
  const warm = { today: '2026-10-14', clock: true, ix: {}, trackingStart: '2026-09-10' };
  const shownQuery = () => { results.settleResultsRoute(warm); return parseRoute(results.resultsUrl(warm)).query; };
  const saved = { ...results.RS };
  try {
    Object.assign(results.RS, { period: 'week', anchor: '2026-10-14', sel: '2026-10-14', desk: 'all', cal: [2026, 9], moved: false });
    go('results', { push: true });
    const week = 'period=week&date=2026-10-14&desk=all';
    assert.equal(writeRoute('results', shownQuery()), true);
    assert.equal(b.win.location.hash, `#results?${week}`);
    b.scroll(700);
    const entries = b.entries.length;
    Object.assign(spies, { tips: 0, pop: 0, dialogs: 0 });
    seen.length = 0;
    const link = 'period=day&date=2026-10-12&desk=j';
    b.typed(`#results?${link}`);
    assert.deepEqual(seen, [['read', link], ['render', true]], 'Results reads the link before it renders; the link waits; the second event is the same entry');
    assert.deepEqual(spies, { tips: 1, pop: 1, dialogs: 1 }, 'tips hidden, Details and the day sheet closed');
    assert.deepEqual([b.win.location.hash, b.entries.length, b.win.scrollY], [`#results?${link}`, entries + 1, 0],
      'the address keeps the link; only the browser’s entry; a new entry opens at its top');
    // While it waits, the render path writes nothing (renderResults gives no address).
    assert.equal(results.resultsRoutePending(), true);
    // The record and the date are in: the link applies once; its address already names the view.
    const calls = b.calls.length;
    assert.equal(writeRoute('results', shownQuery()), true);
    assert.equal(b.calls.length, calls, 'no history call for an address that is already right');
    assert.deepEqual([results.RS.period, results.RS.sel, results.RS.desk], ['day', '2026-10-12', 'j']);
    assert.equal(results.settleResultsRoute(warm), false, 'applied once');
    // A link that names only the desk: Results completes its address in place.
    b.typed('#results?desk=joe');
    const partial = b.entries.length;
    assert.equal(writeRoute('results', shownQuery()), true);
    assert.deepEqual([b.win.location.hash, b.entries.length], ['#results?period=day&date=2026-10-12&desk=joe', partial]);
    // Back past both links: the view before them, read before it renders, at its place.
    seen.length = 0;
    b.traverse(-2);
    assert.deepEqual(seen, [['read', week], ['render', true]]);
    assert.equal(writeRoute('results', shownQuery()), true);
    assert.deepEqual([b.win.location.hash, b.win.scrollY, results.RS.period, results.RS.sel, results.RS.desk], [`#results?${week}`, 700, 'week', '2026-10-14', 'all']);
  } finally {
    onRoute('results', undefined);
    results.requestResultsRoute('');
    Object.assign(results.RS, saved);
  }
});

test('header markup: brand, PAPER, Desk · Results · History, the light, the Settings gear and the theme button, in that order', () => {
  const header = doc.querySelector('header.top');
  assert.ok(header && doc.querySelector('main#main'), 'banner and main landmarks');
  const row = elements(doc.querySelector('.top-in'));
  assert.deepEqual(row.map(n => n.id || n.getAttribute('class')), ['brand', 'modeLabel', 'nav seg', 'hdrHealth', 'settingsBtn', 'themeBtn']);
  assert.equal(doc.querySelector('.brand').getAttribute('aria-label'), 'JoeDesk');
  assert.equal(doc.querySelector('#modeLabel').textContent.trim(), 'PAPER');
  const nav = doc.querySelector('.top-in nav');
  assert.equal(nav.getAttribute('aria-label'), 'Screens');
  const buttons = elements(nav);
  assert.deepEqual(buttons.map(b => b.dataset.go), ['desk', 'results', 'history']);
  for (const [i, label] of ['Desk', 'Results', 'History'].entries()) {
    const b = buttons[i], [svg, span] = elements(b);
    assert.equal(b.tagName, 'button'); assert.equal(b.getAttribute('type'), 'button');
    // The visible label can give way to the icon alone; the name stays the label.
    assert.equal(b.getAttribute('aria-label'), label);
    assert.equal(svg.tagName, 'svg'); assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(elements(svg)[0].getAttribute('href'), `#i-${label.toLowerCase()}`);
    assert.equal(span.tagName, 'span'); assert.equal(span.textContent, label);
  }
  const gear = doc.querySelector('#settingsBtn');
  assert.equal(gear.tagName, 'button'); assert.equal(gear.getAttribute('type'), 'button');
  assert.equal(gear.getAttribute('class'), 'icon-btn gear');
  assert.equal(gear.dataset.go, 'settings');
  assert.equal(gear.getAttribute('aria-label'), 'Settings');
  assert.equal(gear.textContent.trim(), '', 'an icon button, named by its label');
  assert.equal(elements(elements(gear)[0])[0].getAttribute('href'), '#i-gear');
  assert.ok(doc.querySelector('symbol#i-gear'));
  assert.ok(!html.includes('i-settings'), 'the old sliders symbol is gone with its last use');
  assert.match(doc.querySelector('meta[name="viewport"]').getAttribute('content'), /\bviewport-fit=cover\b/);
});

test('bottom bar markup: the same three reading screens; Settings leaves the reading nav everywhere', () => {
  const bar = doc.querySelector('nav.bottom-nav');
  assert.equal(bar.getAttribute('aria-label'), 'Screens');
  const buttons = elements(bar);
  assert.deepEqual(buttons.map(b => [b.dataset.go, b.textContent.trim(), elements(elements(b)[0])[0].getAttribute('href')]),
    [['desk', 'Desk', '#i-desk'], ['results', 'Results', '#i-results'], ['history', 'History', '#i-history']]);
  assert.ok(buttons.every(b => b.getAttribute('type') === 'button'));
  assert.equal(doc.querySelectorAll('nav [data-go="settings"]').length, 0);
  assert.equal(doc.querySelectorAll('[data-go="settings"]').length, 1, 'only the gear');
});

// Top-level @media blocks of the comment-free stylesheet, with their bodies,
// and the rules outside them. Every @media here is top-level (none nest).
function media(source) {
  const blocks = [];
  for (const match of source.matchAll(/@media\s*([^{]+)\{/g)) {
    let depth = 1, i = match.index + match[0].length;
    for (; depth && i < source.length; i++) depth += source[i] === '{' ? 1 : source[i] === '}' ? -1 : 0;
    blocks.push({ query: match[1].trim(), body: source.slice(match.index + match[0].length, i - 1), start: match.index, end: i });
  }
  return blocks;
}
const outside = source => media(source).reverse().reduce((rest, b) => rest.slice(0, b.start) + rest.slice(b.end), source);
const rule = (body, selector) => body.match(new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? null;

test('bar CSS: hidden by default, shown only up to 480 px with a solid surface, a hairline and the safe area; the page ends above it', () => {
  const top = outside(css);
  assert.ok(!top.includes('@media'));
  assert.match(rule(top, '.bottom-nav') ?? '', /^\s*display:\s*none;\s*$/);
  const shows = media(css).filter(b => /\.bottom-nav\s*\{[^}]*display:\s*flex/.test(b.body));
  assert.deepEqual(shows.map(b => b.query), ['(max-width: 480px)']);
  const phone = shows[0].body, bar = rule(phone, '.bottom-nav');
  for (const part of [/position:\s*fixed/, /left:\s*0;/, /right:\s*0;/, /bottom:\s*0;/, /background:\s*var\(--surface\)/, /border-top:\s*1px solid var\(--line\)/,
    /padding:\s*6px max\(8px, var\(--safe-right\)\) calc\(6px \+ var\(--safe-bottom\)\) max\(8px, var\(--safe-left\)\)/]) {
    assert.match(bar, part);
  }
  assert.doesNotMatch(bar, /backdrop-filter|color-mix|border-radius|box-shadow/, 'a solid, docked surface');
  assert.match(rule(phone, '.top .nav'), /display:\s*none/);
  assert.match(rule(phone, '#main'), /padding-bottom:\s*calc\(var\(--nav-h\) \+ var\(--safe-bottom\)\)/);
  // Every inset reads one property, so a test can stand in for a phone's.
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\);\s*--safe-left:\s*env\(safe-area-inset-left, 0px\);\s*--safe-right:\s*env\(safe-area-inset-right, 0px\);/);
  assert.equal((css.match(/env\(safe-area-inset-/g) ?? []).length, 3, 'env() only where the properties are set');
  // The reserve is the bar itself: its padding, a 56 px button and the hairline.
  const height = Number(/height:\s*(\d+)px/.exec(rule(phone, '.bottom-nav button'))[1]);
  assert.equal(height, 56);
  assert.equal(Number(/--nav-h:\s*(\d+)px/.exec(css)[1]), 6 + height + 6 + 1);
  // Above 480 px the nav stays in the header: nothing else hides it.
  for (const block of media(css)) {
    if (block.query !== '(max-width: 480px)') assert.doesNotMatch(block.body, /(?:^|[}\s])(?:\.top )?\.nav\s*\{[^}]*display:\s*none/, block.query);
  }
});

test('header CSS: every header control is a 44 px target, and each fitted step in app.js has its rule', () => {
  assert.match(css, /\.top \.nav button::after, \.top \.hdr-health::after, \.top \.icon-btn::after \{ content: ""; position: absolute; inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\); \}/);
  // A nav button is never narrower than its target, even as a short label or an icon alone.
  assert.match(rule(css, '.top .nav button'), /position:\s*relative;\s*height:\s*30px;\s*min-width:\s*44px;/);
  assert.match(css, /\.top \.hdr-health, \.top \.icon-btn \{ position: relative; \}/);
  const steps = JSON.parse(/const FIT = (\[[^\]]+\]);/.exec(app)[1].replace(/'/g, '"'));
  assert.deepEqual(steps, ['word', 'labels', 'tight', 'icons', 'squeeze']);
  for (const step of steps) assert.ok(css.includes(`.top-in[data-fit~="${step}"]`), step);
  assert.match(rule(css, '.top-in[data-fit~="word"] .brand .word'), /display:\s*none/);
  assert.match(rule(css, '.top-in[data-fit~="icons"] .nav button > span'), /display:\s*none/);
  assert.match(rule(css, '.top-in[data-fit~="squeeze"] .hdr-health > .status-chevron'), /display:\s*none/);
  assert.match(rule(css, '.gear[aria-current="page"]'), /background:\s*var\(--accent-tint\)/);
  // The light's width never follows its words: a fixed width or the row's free room.
  assert.match(rule(css, '.hdr-health'), /width:\s*clamp\(220px, 25vw, 350px\)/);
  const tablet = media(css).find(b => b.query === '(max-width: 960px)' && /\.hdr-health\s*\{/.test(b.body));
  assert.match(rule(tablet.body, '.hdr-health'), /flex:\s*1 1 0;\s*width:\s*auto;\s*min-width:\s*128px;\s*max-width:\s*280px;\s*height:\s*44px;/);
  // viewport-fit=cover: content keeps clear of a landscape notch.
  assert.match(rule(css, '.page'), /padding:\s*0 max\(var\(--gutter\), var\(--safe-right\)\) 0 max\(var\(--gutter\), var\(--safe-left\)\);/);
});

// The value a property takes at one viewport width: the last declaration in
// source order among the top-level rules and the simple width queries that
// apply. A calc() is worked out for a given bottom inset.
function declared(source, selector, property, width) {
  let value = null;
  const scan = body => { const r = rule(body, selector); const m = r && new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(r); if (m) value = m[1].trim(); };
  const applies = q => { const max = /^\(max-width: (\d+)px\)$/.exec(q), min = /^\(min-width: (\d+)px\)$/.exec(q); return max ? width <= Number(max[1]) : min ? width >= Number(min[1]) : false; };
  let at = 0;
  for (const block of media(source)) { scan(source.slice(at, block.start)); if (applies(block.query)) scan(block.body); at = block.end; }
  scan(source.slice(at));
  return value;
}
const px = (value, { inset = 0, height = 844 } = {}) => Function(`return (${value.replace(/env\(safe-area-inset-bottom, 0px\)|var\(--safe-bottom\)/g, `${inset}px`)
  .replace(/var\(--nav-h\)/g, /--nav-h:\s*(\d+)px/.exec(css)[1] + 'px').replace(/(\d+(?:\.\d+)?)dvh/g, (_m, n) => `${n * height / 100}px`)
  .replace(/calc\(/g, '(').replace(/(\d+(?:\.\d+)?)px/g, '$1')});`)();

test('safe area: Details ends 8 px above the phone bar, whatever the bottom inset adds to it', () => {
  // The bar: 6 px above a 56 px button, its bottom padding (6 px and the inset), a 1 px hairline.
  const button = parseFloat(declared(css, '.bottom-nav button', 'height', 390));
  const below = /\s(calc\(6px \+ (?:var\(--safe-bottom\)|env\(safe-area-inset-bottom, 0px\))\))\s/.exec(` ${declared(css, '.bottom-nav', 'padding', 390)} `)[1];
  for (const inset of [0, 21, 34]) {
    const bar = 6 + button + px(below, { inset }) + 1;
    // Details opens 4 px below the 54 px header.
    const top = 54 + 4, tallest = top + px(declared(css, '.pop', 'max-height', 390), { inset });
    assert.ok(tallest <= 844 - bar - 8, `inset ${inset}: Details may end at ${tallest} px, the bar starts at ${844 - bar} px`);
    assert.equal(px(declared(css, '#main', 'padding-bottom', 390), { inset }), bar, `inset ${inset}: the page's reserve is the bar`);
  }
});

test('safe area: at tablet widths the Settings footer keeps 12 px above the floating edit bar, whatever the inset lifts it by', () => {
  const height = Number(/(\d+)px/.exec(declared(css, '.editbar-in', 'height', 820))[1]);
  assert.equal(height, 100);
  for (const inset of [0, 21]) {
    const bar = px(declared(css, '.editbar', 'bottom', 820), { inset }) + height;
    const reserve = px(declared(css, 'body[data-screen="settings"] .foot', 'margin-bottom', 820), { inset });
    assert.ok(reserve - bar >= 12, `inset ${inset}: the footer's reserve ${reserve} px, the edit bar's top ${bar} px up`);
  }
});

test('hit regions: tight 36 px icon buttons keep their reach clear of each other, and the gear never shrinks', () => {
  // Above 960 px the icon buttons draw 36 px and reach 4 px past each side.
  const reach = (44 - Number(/width:\s*(\d+)px/.exec(rule(outside(css), '.icon-btn'))[1])) / 2;
  assert.equal(reach, 4);
  const gap = Number(/gap:\s*(\d+)px/.exec(rule(css, '.top-in[data-fit~="tight"]'))[1]);
  const margin = parseFloat(declared(css, '.top-in[data-fit~="tight"] .icon-btn', 'margin-left', 1024) ?? '0');
  assert.ok(gap + margin > 2 * reach, `tight: ${gap + margin} px between icon buttons that reach ${reach} px each`);
  // At 960 px and below they draw 44 px and reach nowhere; the space goes back.
  assert.equal(declared(css, '.top .icon-btn', 'width', 820), '44px');
  assert.equal(declared(css, '.top-in[data-fit~="tight"] .icon-btn', 'margin-left', 820), '0');
  // Neither header icon button takes part in shrinking the row: the fitted steps do.
  assert.match(rule(css, '.gear'), /flex:\s*none/);
  assert.match(rule(css, '.theme-btn'), /flex:\s*none/);
});

test('money no-wrap: a signed amount stays one unit with its sign, exactly the formatter’s text', () => {
  assert.match(css, /\.nowrap, \.num \{ white-space: nowrap; \}/);
  assert.equal(moneyNoWrap(-4.05, 'EUR', true), `<span class="nowrap">${MINUS}€${NB}4,05</span>`);
  assert.equal(moneyNoWrap(28.4, 'EUR', true), `<span class="nowrap">+€${NB}28,40</span>`);
  assert.equal(moneyNoWrap(15000, 'EUR', false, 0), `<span class="nowrap">€${NB}15.000</span>`);
  assert.equal(moneyNoWrap(-0.004, 'EUR', true), `<span class="nowrap">€${NB}0,00</span>`, 'zero at the shown precision has no sign');
  assert.equal(moneyNoWrap(-123456789n, 'USD', true), `<span class="nowrap">${MINUS}$${NB}1,23</span>`, 'exact units');
  assert.equal(moneyNoWrap(null), '<span class="nowrap">—</span>');
});
