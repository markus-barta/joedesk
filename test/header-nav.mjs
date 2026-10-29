// The header and its routes under Node: hash routes with each screen's own
// query, the history steps, links, route readers, the header and bottom-bar
// markup, the CSS that keeps the bar on phones, and the money no-wrap helper.
// Browser CI (scripts/browser/header-nav.mjs, the P3/P5 sweeps) owns pixels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';

const { SCREENS, parseRoute, routeHash, sameRoute, historyStep, linkRoute, onRoute, applyRoute } = await import('../public/joe/route.js');
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
    /padding:\s*6px max\(8px, env\(safe-area-inset-right, 0px\)\) calc\(6px \+ env\(safe-area-inset-bottom, 0px\)\) max\(8px, env\(safe-area-inset-left, 0px\)\)/]) {
    assert.match(bar, part);
  }
  assert.doesNotMatch(bar, /backdrop-filter|color-mix|border-radius|box-shadow/, 'a solid, docked surface');
  assert.match(rule(phone, '.top .nav'), /display:\s*none/);
  assert.match(rule(phone, '#main'), /padding-bottom:\s*calc\(var\(--nav-h\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
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
  assert.match(rule(css, '.page'), /padding:\s*0 max\(var\(--gutter\), env\(safe-area-inset-right, 0px\)\) 0 max\(var\(--gutter\), env\(safe-area-inset-left, 0px\)\);/);
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
