// The hash routes under Node: each screen's own query, the history steps,
// links and route readers. Browser CI walks them in a real page.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, onRoute, applyRoute } = await import('../public/joe/route.js');
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
