// Hash routes: #desk, #results, #history and #settings. A route may name an
// anchor to scroll to (#settings/mode, #history/j-accounting) and carry a
// query that belongs to its screen (#results?period=day&date=2026-10-28&desk=j,
// #history?range=week&mode=money). The address keeps the screen and its query;
// an anchor only scrolls. app.js keeps the board's own view switching; this
// module reads and writes routes, decides each history step and hands every
// screen its own detail parameters. No storage and no network.
export const SCREENS = Object.freeze(['desk', 'results', 'history', 'settings']);

// "#results?period=day" gives { screen: 'results', anchor: null, query: 'period=day', known: true }.
// An unknown or empty route is Desk, without the query it brought.
export function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const mark = raw.indexOf('?');
  const [name, ...rest] = (mark < 0 ? raw : raw.slice(0, mark)).split('/');
  if (!SCREENS.includes(name)) return { screen: 'desk', anchor: null, query: '', known: false };
  return { screen: name, anchor: rest.join('/') || null, query: mark < 0 ? '' : raw.slice(mark + 1), known: true };
}
export const routeHash = ({ screen, query = '' }) => `#${screen}${query ? `?${query}` : ''}`;
// The same screen with the same query is the same place; anchors only scroll.
export const sameRoute = (a, b) => a.screen === b.screen && (a.query ?? '') === (b.query ?? '');

// The reader's own navigation (the nav, the gear, a link) adds a history
// entry, so Back returns to where they were. Every other arrival (the first
// load, Back, Forward, a typed address) only puts the address in its canonical
// form. Null: the address is already right.
export function historyStep(hash, target, push) {
  if (push && !sameRoute(parseRoute(hash), target)) return 'push';
  return hash === routeHash(target) ? null : 'replace';
}

// A plain click on a same-page link to a screen is a navigation. A new tab or
// window (a modifier, another button or a target) and a link that a control
// already handled itself (Settings' section list) stay the browser's.
export function linkRoute(event, link) {
  if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const href = link.getAttribute('href') ?? '', target = link.getAttribute('target');
  if (!href.startsWith('#') || (target && target !== '_self')) return null;
  const route = parseRoute(href);
  return route.known ? route : null;
}

// Where the reader was, per history entry, and every history call the board
// makes. Each entry the board shows gets an id in its state.
// - The place is read before anything on the page changes and kept for the
//   entry being left, by the board's own navigation (push) or by Back,
//   Forward or a typed address (step), so Back and Forward return to it.
// - One saver also writes the place into the entry's state, for a reload:
//   a scroll or the end of one asks for a save, which lands at most once per
//   `every` ms; hiding the page (pagehide) or leaving by the nav flushes it.
//   Saves stop at `budget` calls in any 30 s, the board's navigation counted
//   too, so WebKit's limit of about 100 history calls per 30 s always keeps
//   room for navigation (push, replace), which is never held back.
// - A save never writes into an entry the board has not taken up yet (one
//   the browser just made).
// - Arriving (arrive) goes to the entry's place. While the page is too short
//   for it (its data still coming in, as after a reload), the place waits for
//   the page to grow, until the reader scrolls (abandon), the next arrival or
//   `wait` ms.
export function createPlaces(win, { every = 500, budget = 60, wait = 15000 } = {}) {
  // Ids are unique per page, so entries from before a reload never collide.
  const kept = new Map(), doc = Math.random().toString(36).slice(2, 10), calls = [];
  let entry = null, count = 0, timer = 0, last = -Infinity, pending = null, watch = null, expiry = 0;
  const now = () => win.performance.now();
  const recent = () => { while (calls.length && now() - calls[0] >= 30000) calls.shift(); return calls.length; };
  const call = (method, ...args) => { recent(); calls.push(now()); try { win.history[method](...args); return true; } catch { return false; } };
  const current = () => win.history.state?.joeEntry ?? null;
  const place = () => pending ?? win.scrollY;
  const cancel = () => { win.clearTimeout(timer); timer = 0; };
  const request = (delay = Math.max(0, every - (now() - last))) => { if (!timer) timer = win.setTimeout(() => { timer = 0; save(false); }, delay); };
  // The one saver; `flush` skips the spacing, never the budget.
  function save(flush) {
    cancel();
    if (entry === null || current() !== entry) return;
    const y = place();
    kept.set(entry, y);
    if (win.history.state?.joeScrollY === y) return;
    if (recent() >= budget) { if (!flush) request(30000 - (now() - calls[0])); return; }
    if (!flush && now() - last < every) { request(); return; }
    last = now();
    call('replaceState', { ...win.history.state, joeScrollY: y }, '');
  }
  const finish = () => { pending = null; watch?.disconnect(); watch = null; win.clearTimeout(expiry); expiry = 0; };
  const settle = () => { if (pending === null) return; win.scrollTo(0, pending); if (win.scrollY >= pending - 1) finish(); };
  return {
    scrolled: () => request(),
    flush: () => save(true),
    // The entry is new (Back, Forward, a typed address, the first load): the
    // entry left keeps the place the page still shows; take this one up.
    // False when it is the entry already taken up (the step's second event).
    step() {
      const id = current();
      if (entry !== null && id === entry) return false;
      cancel();
      if (entry !== null) kept.set(entry, place());
      finish();
      entry = id ?? `${doc}.${++count}`;
      if (id === null) call('replaceState', { ...win.history.state, joeEntry: entry }, '');
      return true;
    },
    // The board's own navigation: flush the place being left, then the new entry.
    push(address) {
      save(true);
      finish();
      const left = entry;
      entry = `${doc}.${++count}`;
      if (call('pushState', { joeEntry: entry }, '', address)) return true;
      entry = left;
      return false;
    },
    replace: address => call('replaceState', win.history.state, '', address),
    arrive(y) {
      finish();
      win.scrollTo(0, y);
      if (y <= 0 || win.scrollY >= y - 1 || !win.ResizeObserver) return;
      pending = y;
      watch = new win.ResizeObserver(settle);
      watch.observe(win.document.documentElement);
      expiry = win.setTimeout(finish, wait);
    },
    abandon: finish,
    saved: () => kept.get(entry) ?? win.history.state?.joeScrollY ?? 0,
  };
}

// A screen with detail parameters registers one reader. go() calls it before
// the screen renders, on every arrival (the nav, a link, Back, Forward or a
// typed address), with the route's parameters, possibly none: a parameter
// that is absent keeps that screen's current choice.
const readers = new Map();
export const onRoute = (screen, read) => { readers.set(screen, read); };
export const applyRoute = route => readers.get(route.screen)?.(new URLSearchParams(route.query ?? ''), route);

// A shown screen writes its own query into the address, through the same
// history steps as go() and so within the one budget (createPlaces): the
// reader's own change of what the screen shows (Results' period, day or desk)
// pushes an entry, so Back returns to the view before; a correction of the
// same view replaces the address, and never one that changed outside the page
// and still waits for follow(). app.js installs the one writer. True when the
// screen is shown and its address is written (or already right).
let writer = null;
export const onAddress = write => { writer = write; };
export const writeRoute = (screen, query = '', { push = false } = {}) => Boolean(writer?.({ screen, query }, push));
