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

// A screen with detail parameters registers one reader. go() calls it before
// the screen renders, on every arrival (the nav, a link, Back, Forward or a
// typed address), with the route's parameters, possibly none: a parameter
// that is absent keeps that screen's current choice.
const readers = new Map();
export const onRoute = (screen, read) => { readers.set(screen, read); };
export const applyRoute = route => readers.get(route.screen)?.(new URLSearchParams(route.query ?? ''), route);
