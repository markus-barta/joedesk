// JOED-156: Desk's whole-account hero on the real page markup in the Node
// DOM: value, state, Since start, Cash, kept holdings in their own
// currencies, the ranges, the chart and its input, Controls and the hint.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';
import { MIN, DAY, iso, valid, words, point, SNAP, NOW, history, ctxFor } from './fixtures/account-fixtures.mjs';

const M = await import('../public/joe/account-model.js');
const A = await import('../public/joe/account.js');
const { chartHintSeen, dismissChartHint, forgetChartMemory, createAxisMode, CHART_HINT_KEY, CHART_AXES_KEY } = await import('../public/joe/chart.js');

// ---------- The hero on the real page ----------
// The Node DOM has no events: record listeners per element and run them by hand.
function page(t, { phone = false, storage = new Map(), body: answer = history() } = {}) {
  const proto = Object.getPrototypeOf(htmlDocument(''));
  const saved = { document: globalThis.document, matchMedia: globalThis.matchMedia, fetch: globalThis.fetch,
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'), add: Object.getOwnPropertyDescriptor(proto, 'addEventListener') };
  t.after(() => {
    globalThis.document = saved.document; globalThis.matchMedia = saved.matchMedia; globalThis.fetch = saved.fetch;
    if (saved.window) Object.defineProperty(globalThis, 'window', saved.window); else delete globalThis.window;
    if (saved.add) Object.defineProperty(proto, 'addEventListener', saved.add); else delete proto.addEventListener;
    A.forgetAccountHistory(); forgetChartMemory();
    Object.assign(A.AS, { range: '1M', view: null, follow: true, details: false, full: null, shown: null });
  });
  proto.addEventListener = function (type, fn) { (this.listeners ??= {})[type] = fn; };
  const focus = Object.getOwnPropertyDescriptor(proto, 'focus'), contains = Object.getOwnPropertyDescriptor(proto, 'contains');
  proto.focus = function () { globalThis.document.activeElement = this; };
  // patch() keeps focus where it is: it asks whether an element holds it.
  proto.contains = function (node) { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; };
  t.after(() => {
    if (focus) Object.defineProperty(proto, 'focus', focus); else delete proto.focus;
    if (contains) Object.defineProperty(proto, 'contains', contains); else delete proto.contains;
  });
  globalThis.document = htmlDocument(readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8'));
  globalThis.matchMedia = query => ({ matches: /reduce/.test(query) || (phone && /max-width: (480|700)px|coarse/.test(query)) });
  // The charts' memory (the hint, the vertical axis) is the window's storage, as on a page.
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { localStorage: storage instanceof Map
    ? { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) }
    : storage } });
  const reads = [];
  globalThis.fetch = async url => { reads.push(String(url)); const a = typeof answer === 'function' ? answer() : answer; return { type: 'basic', status: a?.status ?? 200, json: async () => a?.status ? {} : a }; };
  A.forgetAccountHistory(); forgetChartMemory(); A.forgetAccountWorker?.();
  Object.assign(A.AS, { range: '1M', view: null, follow: true, details: false, full: null, shown: null });
  A.initAccount();
  // The browser reflects the hidden attribute as a property; this DOM does not.
  for (const id of ['#acctPop', '#acctDetails']) document.querySelector(id).hidden = true;
  const chart = document.querySelector('#acctChart');
  Object.assign(chart, { clientWidth: phone ? 330 : 900, clientHeight: phone ? 120 : 230, getBoundingClientRect: () => ({ left: 0 }) });
  const $ = s => document.querySelector(s);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { $, chart, reads, settle, storage,
    async render(ctx = ctxFor()) { A.renderAccount(ctx); await settle(); await settle(); return ctx; },
    svg: () => chart.querySelector(':scope > svg'),
    text: s => words($(s)?.textContent ?? '') };
}

test('JOED-156 hero: the slot sits above the desk hero and every module is on the release’s import map', () => {
  const html = readFileSync(new URL('../public/joe/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="acctHero"') > 0 && html.indexOf('id="acctHero"') < html.indexOf('id="deskHero"'));
  for (const name of ['account.js', 'account-model.js']) assert.match(html, new RegExp(`"/joe/${name}": "/joe/${name}\\?v=\\d{12}\\.0\\.0"`));
  for (const file of ['../server.mjs', '../scripts/check-package.mjs']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /"desk\.js", "account\.js", "account-model\.js"/, file);
  }
});

test('JOED-156 hero: the whole account first, its change for the range, Cash and the kept holdings each in its own currency', async t => {
  const p = page(t);
  await p.render();
  assert.deepEqual(p.reads, ['./account-history.json'], 'one read of the account history');
  assert.equal(p.text('#acctValue'), '€28.000,00');
  assert.match(p.$('#acctValue').innerHTML, /class="bn "/, 'unsigned, the largest figure');
  assert.equal(p.text('#acctTitle .acct-wide'), 'IB paper account · whole account');
  assert.ok(p.$('#acctTitle .term[data-term="paperacct"]'), 'the trade term behind it is explained');
  assert.equal(p.text('.acct-eyebrow .acct-chip.keep'), 'incl. kept holdings');
  // 1M: from the 13 Sep close to the value shown now.
  assert.equal(p.text('#acctChange .acct-rng'), '1M');
  assert.equal(p.text('#acctChange .bn'), '+€1.800,00');
  assert.equal(p.text('#acctChange .acct-pct'), '+6,87 %');
  assert.ok(!p.$('#acctChange [data-clamp]'), 'a current value has no state line');
  const sub = p.text('#acctSub');
  assert.match(sub, /^Account start loading/);
  assert.match(sub, /Cash — · not reported/);
  assert.match(sub, /incl\. kept holdings SXR8 € 600,00 · TSLA \$ 200,00, each in its own currency$/, 'never converted');
  // Kept holdings are text only: nothing there can be acted on.
  const kept = p.$('#acctSub').innerHTML.slice(p.$('#acctSub').innerHTML.indexOf('incl. kept holdings'));
  assert.doesNotMatch(kept, /<button|<a |href=|tabindex|role=|data-term/);
  assert.equal(p.$('#acctRanges [data-acct-range="1M"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelectorAll('#acctRanges [data-acct-range]').length, 7);
  const svg = p.svg();
  assert.deepEqual([svg.dataset.source, svg.dataset.range], ['daily', '1M']);
  assert.match(svg.getAttribute('aria-label'), /kept holdings included, over the last month, in euros/);
  assert.ok(Number(svg.dataset.points) >= 29, 'a month of closes');
  assert.ok(svg.querySelector('[data-now]'), 'the now marker at the live edge');
  assert.ok(Number(svg.dataset.yhi) - Number(svg.dataset.ylo) >= Number(svg.dataset.base) * 0.01 - 1e-6, 'an honest scale: at least ±0,5 % of the first value');
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'hint', 'the first-visit hint');
  assert.equal(document.querySelector('#acctHero').dataset.history, 'ok');
});

test('JOED-156 hero: Since start comes from the Settings start; until it is set there is no figure and a link to Settings', () => {
  const ctx = ctxFor();
  const set = A.subParts(ctx, { amountEur: 1000000, date: '2025-06-02' }, { reason: null });
  assert.match(words(htmlDocument(set.wide).textContent), /^Since start \(€ 1\.000\.000 on 2 Jun 2025\): −€ 972\.000,00 · −97,20 %/);
  assert.match(words(htmlDocument(set.narrow).textContent), /^Since start −€ 972\.000,00 \(−97,20 %\) · Cash — · not reported · no data received yet$/);
  assert.match(set.details, /change in Settings/);
  for (const reason of ['missing', 'unset']) {
    const unset = A.subParts(ctx, null, { reason });
    const doc = htmlDocument(unset.wide);
    assert.match(words(doc.textContent), /^Account start not set · set in Settings/);
    // A plain link: the router (route.js) opens Settings at the account start, one history entry.
    const link = doc.querySelector('a.set-link');
    assert.deepEqual([link.getAttribute('href'), link.getAttribute('data-go'), link.getAttribute('data-anchor')], ['#settings/set-account', null, null]);
    assert.doesNotMatch(unset.wide, /€\s?[\d.]+,\d\d\)?:/, 'no sample amount');
  }
  assert.match(words(htmlDocument(A.subParts(ctx, null, { reason: 'invalid' }).wide).textContent), /^Account start unreadable · set in Settings/);
  assert.match(words(htmlDocument(A.subParts(ctx, null, { reason: 'refresh_failed' }).wide).textContent), /^Account start could not be checked · open Settings/);
  assert.doesNotMatch(A.subParts(ctx, null, { reason: 'loading' }).wide, /<a /, 'nothing to set while loading');
  // A stale account value is no basis for Since start.
  const stale = A.subParts(ctxFor({ now: SNAP + 75000 }), { amountEur: 1000000, date: '2025-06-02' }, { reason: null });
  assert.match(words(htmlDocument(stale.wide).textContent), /^Since start \(€ 1\.000\.000 on 2 Jun 2025\): —/);
  // Every amount and its sign sit in one unbreakable run.
  assert.match(words(set.wide), /<span class="nowrap">−€ 972\.000,00<\/span>/);
  assert.match(words(set.wide), /<span class="nowrap">−97,20 %<\/span>/);
});

test('JOED-156 hero: a value that is not current and exact keeps its state, never shown as current; unavailable is a dash with its reason', async t => {
  const p = page(t);
  await p.render(ctxFor({ now: SNAP + 75000 }));
  assert.equal(p.text('#acctValue'), '€28.000,00', 'the stale value stays, with its age');
  const state = p.$('#acctChange .acct-state');
  assert.equal(words(state.querySelector('[data-clamp]').textContent), 'As of 1 min ago · updates are late');
  assert.equal(words(state.getAttribute('title')), 'As of 1 min ago · updates are late', 'the full words in the title');
  assert.ok(!p.$('#acctChange .acct-rng'), 'no change figure for a value that is not current');
  await p.render(ctxFor({ mutate: d => { d.brokerAccount = { equity: null, reason: 'source_unavailable', scope: d.brokerAccount.scope, observedAt: d.brokerAccount.observedAt }; } }));
  const dash = p.$('#acctValue .bn');
  assert.equal(dash.textContent, '—');
  assert.equal(words(dash.getAttribute('aria-label')), 'Whole account: not reported · not reported by the broker');
  assert.equal(words(p.$('#acctChange [data-clamp]').textContent), 'Unavailable · not reported by the broker');
  await p.render(ctxFor({ mutate: d => { d.brokerAccount = { equity: null, reason: 'not_exact_yet', scope: d.brokerAccount.scope, observedAt: d.brokerAccount.observedAt }; } }));
  assert.equal(words(p.$('#acctChange [data-clamp]').textContent), 'Not exact');
  // A last good value an outage keeps: its age and reason, never as current.
  const ctx = ctxFor();
  ctx.states.paperAccount = { ...ctx.states.paperAccount, state: 'broken', retained: true, reason: 'gateway_down', ageSeconds: 300 };
  await p.render(ctx);
  assert.equal(words(p.$('#acctChange [data-clamp]').textContent), 'Last good value, 5 min ago · broker connection down');
  assert.equal(M.liveObservation(ctx.states.paperAccount, ctx.feeds.data.value), null);
});

test('JOED-156 hero: each range draws its own store; a range longer than the record says since when it records', async t => {
  const p = page(t);
  await p.render();
  A.chooseRange('1D');
  await p.render();
  let svg = p.svg();
  assert.deepEqual([svg.dataset.source, svg.dataset.range], ['short', '1D']);
  assert.equal(Number(svg.dataset.x1) - Number(svg.dataset.x0), DAY);
  assert.ok(svg.querySelectorAll('[data-gap]').length >= 1, 'the unavailable value is hatched');
  assert.equal(p.$('#acctRanges [data-acct-range="1D"]').getAttribute('aria-pressed'), 'true');
  assert.equal(p.$('#acctRanges [data-acct-range="1M"]').getAttribute('aria-pressed'), 'false');
  assert.equal(p.text('#acctChange .acct-rng'), '1D');
  A.chooseRange('5D');
  await p.render();
  svg = p.svg();
  assert.equal(svg.dataset.range, '5D');
  assert.equal(p.text('#acctNote'), 'Recording since 11 Oct, 19:42 · 3 days so far');
  assert.equal(p.text('#acctChange .acct-rng'), 'since Sun 19:42', 'the change says what it covers, to the minute');
  assert.equal(words(p.$('#acctChange .acct-rng').getAttribute('title')), 'Change from 11 Oct, 19:42 to now');
  A.chooseRange('6M');
  await p.render();
  assert.equal(p.svg().dataset.source, 'daily');
  assert.equal(p.text('#acctNote'), 'Recording since 5 Sep · 39 days so far');
  assert.equal(p.text('#acctChange .acct-rng'), 'since 5 Sep', 'six months asked, five weeks recorded: the change says so');
  A.chooseRange('All');
  await p.render();
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'hint', 'everything recorded needs no note');
  assert.equal(p.text('#acctChange .acct-rng'), 'All');
});

test('JOED-156 hero: a failed read keeps the last good history and says so; without one the chart says it is unavailable', async t => {
  let answer = { status: 401 };
  const p = page(t, { body: () => answer });
  await p.render();
  assert.equal(p.text('#acctNote'), 'History unavailable · sign-in expired — reload');
  assert.equal(p.svg().getAttribute('aria-label'), 'Account history unavailable', 'no history: the chart says so, the live value alone draws nothing');
  assert.equal(document.querySelector('#acctHero').dataset.history, 'auth_required');
  answer = history();
  await A.refreshAccountHistory();
  await p.settle();
  assert.equal(p.svg().dataset.source, 'daily');
  answer = { status: 503 };
  await A.refreshAccountHistory();
  await p.settle();
  assert.match(p.text('#acctNote'), /^Update failed · showing what loaded \d+ s ago$/);
  assert.equal(p.svg().dataset.source, 'daily', 'the last good series stays');
  // A body off the documented shape is refused the same way.
  answer = { ...history(), schema: 'something-else' };
  await A.refreshAccountHistory();
  await p.settle();
  assert.match(p.text('#acctNote'), /^Update failed/);
});

test('JOED-156 hero: the first-visit hint is every chart’s: it goes after the first move on any chart and stays gone; storage may refuse it', async t => {
  const storage = new Map();
  const p = page(t, { storage });
  await p.render();
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'hint');
  assert.match(p.text('#acctNote .hint-fine'), /^Drag or scroll sideways to move · (Ctrl|⌘)-scroll or pinch to zoom$/);
  assert.equal(p.text('#acctNote .hint-touch'), 'Swipe · pinch · double-tap');
  // A move on this chart retires it, for History's chart too (one memory, chart.js).
  p.chart.listeners.wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, clientX: 300, timeStamp: 1, ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {} });
  A.chooseRange('1M');
  await p.render();
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'none');
  assert.equal(storage.get(CHART_HINT_KEY), '1');
  assert.equal(storage.has('joedesk-chart-hint-v1'), false, 'no key of its own');
  forgetChartMemory();
  assert.equal(chartHintSeen(), true, 'remembered in this browser');
  // A move on another chart (History's) retires it here as well.
  storage.clear(); forgetChartMemory();
  await p.render();
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'hint');
  assert.equal(dismissChartHint(), true);
  A.chooseRange('1M');
  await p.render();
  assert.equal(p.$('#acctNote').getAttribute('data-kind'), 'none');
  // Storage that refuses: hidden for this visit after the first move.
  const refusing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  globalThis.window = { localStorage: refusing };
  forgetChartMemory();
  assert.equal(chartHintSeen(), false);
  assert.doesNotThrow(() => dismissChartHint());
  assert.equal(chartHintSeen(), true, 'hidden for this visit');
});

test('JOED-156 hero: on a phone the short eyebrow, one Since start · Cash line, Account details and no overview strip', async t => {
  const p = page(t, { phone: true });
  await p.render();
  assert.equal(p.text('#acctTitle .acct-narrow'), 'Whole account');
  assert.match(p.text('#acctSubN'), /^Account start loading · Cash — · not reported · no data received yet$/);
  const details = p.$('#acctDetailsBtn');
  assert.deepEqual([details.getAttribute('aria-expanded'), details.getAttribute('aria-controls'), p.$('#acctDetails').getAttribute('hidden')], ['false', 'acctDetails', '']);
  details.listeners.click();
  assert.equal(details.getAttribute('aria-expanded'), 'true');
  assert.equal(p.$('#acctDetails').hidden, false);
  assert.match(p.text('#acctDetails'), /^Kept holdings, each in its own currency: SXR8 € 600,00 · TSLA \$ 200,00\. They count only in this whole-account figure\.$/);
  assert.equal(p.$('#acctStrip').getAttribute('data-off'), '', 'no strip on a phone');
  assert.equal(p.$('#acctWin').getAttribute('tabindex'), '-1');
  const svg = p.svg();
  assert.ok(svg && Number(svg.dataset.points) > 0, 'the chart draws at phone size');
});

test('JOED-156 hero: Controls lists the moves for this device and offers the vertical axis', async t => {
  const p = page(t);
  await p.render();
  const button = p.$('#acctCtl'), pop = p.$('#acctPop');
  assert.deepEqual([button.getAttribute('aria-expanded'), button.getAttribute('aria-controls'), pop.getAttribute('hidden')], ['false', 'acctPop', '']);
  button.listeners.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(pop.hidden, false);
  assert.match(words(pop.querySelector('.acct-keys.hint-fine').textContent), /Drag, or scroll sideways\s*move in time/);
  assert.match(words(pop.querySelector('.acct-keys.hint-touch').textContent), /Double-tap\s*show everything loaded/);
  assert.doesNotMatch(pop.innerHTML, /[←→↑↓]/, 'keys are words, never arrow glyphs');
  // The vertical axis, as on History: three choices, Auto by default, Custom's form hidden.
  const group = pop.querySelector('#acctAxis');
  assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-labelledby'), group.getAttribute('aria-describedby')], ['group', 'acctAxisName', 'acctAxisNote']);
  assert.equal(p.text('#acctAxisName'), 'Vertical axis');
  assert.deepEqual(group.querySelectorAll('[data-axis]').map(b => [b.dataset.axis, b.textContent, b.getAttribute('aria-pressed')]),
    [['auto', 'Auto', 'true'], ['max', 'Max', 'false'], ['custom', 'Custom', 'false']]);
  assert.equal(p.text('#acctAxisNote'), 'Fits the shown window and glides with every move.');
  assert.equal(pop.querySelector('#acctAxisForm').hidden, true);
  p.$('#acctHero .acct-foot').listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(pop.hidden, true);
  const source = readFileSync(new URL('../public/joe/account.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /TODO\(JOED-154\)|chartOptions/, 'the hook is gone: the chart uses JOED-154’s axis modes');
  assert.match(source, /createAxisMode\('account'\)/, 'one choice for this chart');
});

test('JOED-147 merge: the account chart’s vertical axis is JOED-154’s: Auto, Max and Custom in Controls, one choice for this chart, remembered', async t => {
  const storage = new Map();
  const p = page(t, { storage });
  await p.render();
  let svg = p.svg();
  assert.equal(svg.dataset.axis, 'auto', 'Auto by default: the month shown, with the honest minimum span');
  p.$('#acctCtl').listeners.click();
  const pop = p.$('#acctPop');
  const choose = async mode => { pop.listeners.click({ target: pop.querySelector(`[data-axis="${mode}"]`) }); await p.render(); svg = p.svg(); };
  const pressed = () => pop.querySelectorAll('#acctAxis [data-axis]').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.axis);
  const saved = () => JSON.parse(storage.get(CHART_AXES_KEY) ?? '{}');
  // Max: every value loaded (forty days of closes and the value now), not only the month shown.
  await choose('max');
  const loaded = [...history().dailyCloses.days.map(d => Number(d.equity.amount)), 28000];
  assert.deepEqual([svg.dataset.axis, pressed(), p.text('#acctAxisNote')], ['max', ['max'], 'Holds everything loaded, so moving never rescales.']);
  assert.ok(Number(svg.dataset.ylo) <= Math.min(...loaded) && Number(svg.dataset.yhi) >= Math.max(...loaded), `${svg.dataset.ylo} – ${svg.dataset.yhi}`);
  assert.match(p.chart.getAttribute('aria-label'), /vertical axis fixed to everything loaded$/);
  const held = [svg.dataset.ylo, svg.dataset.yhi];
  A.chooseRange('6M');
  await p.render();
  assert.deepEqual([p.svg().dataset.ylo, p.svg().dataset.yhi], held, 'another window, the same axis');
  A.chooseRange('1M');
  await p.render();
  assert.deepEqual(saved(), { account: { mode: 'max' } });
  // Custom starts from the axis on screen, in whole euros.
  await choose('custom');
  const form = pop.querySelector('#acctAxisForm'), min = pop.querySelector('#acctAxisMin'), max = pop.querySelector('#acctAxisMax');
  assert.deepEqual([form.hidden, pressed(), document.activeElement], [false, ['custom'], min]);
  assert.deepEqual([svg.dataset.axis, svg.dataset.ylo, svg.dataset.yhi], ['custom', min.value, max.value], 'the fields hold the bounds drawn');
  // A bound that cannot be read is refused with its reason; nothing changes.
  const submit = async (lo, hi) => { min.value = lo; max.value = hi; pop.listeners.submit({ preventDefault() {} }); await p.render(); svg = p.svg(); };
  const before = [svg.dataset.ylo, svg.dataset.yhi];
  await submit('25.000', '30000');
  assert.deepEqual([min.getAttribute('aria-invalid'), min.getAttribute('aria-describedby')], ['true', 'acctAxisUnit acctAxisError']);
  assert.match(p.text('#acctAxisError'), /without grouping/);
  assert.deepEqual([svg.dataset.ylo, svg.dataset.yhi], before);
  await submit('30000', '25000');
  assert.equal(p.text('#acctAxisError'), 'The top must be above the bottom.');
  assert.equal(max.getAttribute('aria-invalid'), 'true');
  // Exactly the viewer's bottom and top, said on the chart and in its name.
  await submit('25000', '30000,50');
  assert.deepEqual([svg.dataset.axis, Number(svg.dataset.ylo), Number(svg.dataset.yhi), p.text('#acctAxisError')], ['custom', 25000, 30000.5, '']);
  assert.deepEqual([min.value, max.value, min.getAttribute('aria-invalid')], ['25000', '30000,5', 'false']);
  assert.ok(svg.querySelector('[data-axis-note]'), 'a custom axis says so on the chart');
  assert.match(words(p.chart.getAttribute('aria-label')), /custom vertical axis from € 25\.000,00 to € 30\.000,50$/);
  // One choice for this chart: History's stays its own.
  assert.deepEqual(saved(), { account: { mode: 'custom', min: 25000, max: 30000.5 } });
  assert.deepEqual(createAxisMode('history.change').get(), { mode: 'auto' });
  // Remembered in this browser: a reload (the memory read again) keeps it.
  forgetChartMemory();
  assert.deepEqual(A.accountAxis().get(), { mode: 'custom', min: 25000, max: 30000.5 });
  await p.render(ctxFor({ now: NOW + 60000 }));
  assert.deepEqual([p.svg().dataset.axis, Number(p.svg().dataset.ylo)], ['custom', 25000]);
  // Auto again re-fits and forgets the stored choice.
  await choose('auto');
  assert.deepEqual([svg.dataset.axis, form.hidden, saved()], ['auto', true, {}]);
});

test('JOED-156 hero: the chart’s input follows History: zoom at the pointer, sideways pans, a plain wheel is the page’s', async t => {
  const p = page(t);
  await p.render();
  A.chooseRange('5D');
  await p.render();
  const before = [Number(p.svg().dataset.x0), Number(p.svg().dataset.x1)];
  const event = extra => ({ deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 58 + 828 * 0.5, timeStamp: 1, ctrlKey: false, metaKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra });
  const page$ = event({ deltaY: 120 });
  p.chart.listeners.wheel(page$);
  assert.equal(page$.prevented, false, 'a plain vertical wheel scrolls the page');
  const zoom = event({ deltaY: -100, ctrlKey: true, timeStamp: 500 });
  p.chart.listeners.wheel(zoom);
  assert.ok(zoom.prevented);
  await p.render();
  const zoomed = [Number(p.svg().dataset.x0), Number(p.svg().dataset.x1)];
  assert.ok(zoomed[1] - zoomed[0] < before[1] - before[0], 'zoomed in');
  const middle = (before[0] + before[1]) / 2;
  assert.ok(Math.abs((middle - zoomed[0]) / (zoomed[1] - zoomed[0]) - 0.5) < 0.01, 'around the pointer');
  assert.equal(p.$('#acctRanges [data-acct-range="5D"]').getAttribute('aria-pressed'), 'false', 'a zoomed window is no range');
  assert.equal(p.$('#acctNote').getAttribute('data-kind') !== 'hint', true, 'the hint goes after the first zoom');
  const pan = event({ deltaX: -40, timeStamp: 1000 });
  p.chart.listeners.wheel(pan);
  await p.render();
  const panned = [Number(p.svg().dataset.x0), Number(p.svg().dataset.x1)];
  assert.ok(panned[1] < zoomed[1] && Math.abs((panned[1] - panned[0]) - (zoomed[1] - zoomed[0])) < 1000, 'sideways pans into the past, same width');
  assert.equal(A.AS.follow, false);
  p.chart.listeners.dblclick({});
  await p.render();
  assert.equal(A.AS.follow, true, 'double-click shows everything loaded, following');
  assert.equal(Number(p.svg().dataset.x1), A.AS.full[1]);
  // Keys: Shift with an arrow moves, minus zooms out, 0 fits.
  const key = k => ({ key: k.key, shiftKey: Boolean(k.shiftKey), altKey: false, ctrlKey: false, metaKey: false, target: p.chart, preventDefault() {} });
  A.chooseRange('1D'); await p.render();
  p.chart.listeners.keydown(key({ key: 'ArrowLeft', shiftKey: true }));
  await p.render();
  assert.ok(Number(p.svg().dataset.x1) < A.AS.full[1], 'Shift with Left moves back');
  // Daily closes zoom no narrower than three days.
  A.chooseRange('1M'); await p.render();
  for (let i = 0; i < 30; i++) p.chart.listeners.keydown(key({ key: '+' }));
  await p.render();
  assert.ok(Number(p.svg().dataset.x1) - Number(p.svg().dataset.x0) >= 3 * DAY - 1000);
});

test('JOED-156 hero: the tooltip and the keyboard reading say the same words', () => {
  const h = M.acceptAccountHistory(history());
  const short = A.pointDetails({ x: h.short.t[10], v: h.short.v[10], u: h.short.u[10], i: 10, gap: false }, h.short.t[10], h.short);
  assert.match(words(short.text), /^\w{3} \d{1,2} \w{3}, \d\d:\d\d Vienna time\n€ 27\.005,00$/);
  assert.equal(words(short.html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim()), words(short.text));
  const gap = A.pointDetails({ x: 0, v: 1, gap: true, why: 'gateway_down' }, Date.parse('2026-10-13T11:00:00.000Z'), h.short);
  assert.equal(words(gap.text), 'Tue 13 Oct, 13:00 Vienna time\nNo value recorded here · broker connection down');
  const live = M.withLive(h.daily, { t: SNAP, observedAt: valid.data.brokerAccount.observedAt, amount: '28000' });
  const today = A.pointDetails({ x: live.t.at(-1), v: 28000, u: live.u.at(-1), i: live.t.length - 1, gap: false }, live.t.at(-1), live);
  assert.equal(words(today.text), 'Wed 14 Oct · so far today\n€ 28.000,00 at 19:42 Vienna time');
  const seenAs = d => words(d.html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, ''));
  assert.equal(seenAs(today), words(today.text), 'the tooltip shows exactly the words read aloud');
  assert.equal(seenAs(short), words(short.text));
  assert.equal(seenAs(gap), words(gap.text));
  const yesterday = A.pointDetails({ x: live.t.at(-2), v: 1, u: live.u.at(-2), i: live.t.length - 2, gap: false }, live.t.at(-2), live);
  assert.match(words(yesterday.text), /^Tue 13 Oct · last value of the day\n€ [\d.]+,\d\d at 21:30 Vienna time$/);
});

// ---------- Fix round 1 (the Codex gate's findings) ----------
test('JOED-156 fix 1: a day starting on an unavailable snapshot is no whole 1D: the chip names the time the change starts', async t => {
  const answer = history();
  const start = answer.points.findIndex(q => q.t === iso(SNAP - DAY));
  answer.points[start] = point(SNAP - DAY, null);
  const p = page(t, { body: answer });
  await p.render();
  A.chooseRange('1D');
  await p.render();
  assert.equal(p.$('#acctRanges [data-acct-range="1D"]').getAttribute('aria-pressed'), 'true', 'still the 1D window');
  assert.equal(p.text('#acctChange .acct-rng'), 'since Tue 19:47', 'from the first value after the unavailable one, never the value before it');
  assert.equal(words(p.$('#acctChange .acct-rng').getAttribute('title')), 'Change from 13 Oct, 19:47 to now');
});

test('JOED-156 fix 3: the strip’s edges keep the daily closes’ three days, dragged or keyed', async t => {
  const p = page(t);
  await p.render();
  const strip = p.$('#acctStrip'), track = p.$('#acctTrack');
  strip.removeAttribute = key => { delete strip.attributes[key]; };
  Object.assign(track, { clientWidth: 800, clientHeight: 40, getBoundingClientRect: () => ({ left: 0 }), setPointerCapture() {} });
  for (const edge of document.querySelectorAll('#acctStrip [data-edge]')) edge.firstElementChild = edge.querySelector('.grip');
  const span = () => Number(p.svg().dataset.x1) - Number(p.svg().dataset.x0);
  const on = selector => ({ closest: s => (s === selector ? { dataset: { edge: 'to' } } : null) });
  // Pointer: the end edge dragged almost to the strip's start.
  track.listeners.pointerdown({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 790, target: on('[data-edge]') });
  track.listeners.pointermove({ pointerId: 1, clientX: 10 });
  track.listeners.pointerup({ pointerId: 1, type: 'pointerup', clientX: 10 });
  await p.render();
  assert.ok(span() >= 3 * DAY - 1000, `dragged: ${(span() / DAY).toFixed(2)} days`);
  assert.ok(span() <= 3 * DAY + 1000, 'and no wider than the drag allows');
  // Keys: Shift with Left on the end edge, again and again.
  A.chooseRange('1M');
  await p.render();
  const to = document.querySelector('#acctStrip [data-edge="to"]');
  for (let i = 0; i < 40; i++) track.listeners.keydown({ key: 'ArrowLeft', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, target: { closest: () => to }, preventDefault() {} });
  await p.render();
  assert.ok(span() >= 3 * DAY - 1000, `keyed: ${(span() / DAY).toFixed(2)} days`);
  // Snapshots keep their five minutes the same way.
  A.chooseRange('1D');
  await p.render();
  for (let i = 0; i < 80; i++) track.listeners.keydown({ key: 'ArrowLeft', shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, target: { closest: () => to }, preventDefault() {} });
  await p.render();
  assert.ok(span() >= 5 * MIN - 1000 && span() < 10 * MIN, `snapshots: ${(span() / MIN).toFixed(1)} min`);
});

test('JOED-156 fix 4: a worker reads and converts the account history; the page takes its columns and falls back when it fails', async t => {
  const saved = { Worker: globalThis.Worker, JoeVersion: globalThis.JoeVersion, hooks: globalThis.__joedesk };
  t.after(() => { for (const [k, v] of Object.entries({ Worker: saved.Worker, JoeVersion: saved.JoeVersion, __joedesk: saved.hooks })) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const made = [], sent = [];
  let reply = () => ({ kind: 'account', status: 200, reason: null, value: M.acceptAccountHistory(history()), key: 'k1', ms: 4 });
  globalThis.Worker = class {
    constructor(url, options) { made.push({ url: String(url), options, worker: this }); }
    // A failing worker reports two errors at once: it still fails only once.
    postMessage(data) { sent.push(data); const out = reply(data); queueMicrotask(() => (out === 'fail' ? (this.onerror(new Error('worker failed')), this.onerror(new Error('and again'))) : this.onmessage({ data: out }))); }
    terminate() { this.terminated = true; }
  };
  globalThis.JoeVersion = { APP_VERSION: '261029075623.0.0' };
  globalThis.__joedesk = { timings: [] };
  const p = page(t);
  await p.render();
  assert.deepEqual(p.reads, [], 'nothing is read or parsed on the page');
  assert.equal(made.length, 1);
  assert.match(made[0].url, /\/joe\/v\/261029075623\.0\.0\/account-worker\.js$/, 'under this release’s own path');
  assert.deepEqual(made[0].options, { type: 'module' });
  assert.deepEqual(sent[0], { read: 'account', have: null });
  assert.equal(p.svg().dataset.source, 'daily');
  assert.equal(globalThis.__joedesk.accountWorker(), true);
  assert.deepEqual(globalThis.__joedesk.timings.map(x => x.reason), ['account-worker'], 'the worker’s time, no page-side accept');
  // The next read names what the page holds; an unchanged reply keeps its columns.
  reply = data => ({ kind: 'unchanged', feed: 'account', key: data.have, ms: 1 });
  await A.refreshAccountHistory();
  assert.deepEqual(sent[1], { read: 'account', have: 'k1' });
  assert.equal(p.svg().dataset.source, 'daily');
  assert.equal(document.querySelector('#acctHero').dataset.history, 'ok');
  // A worker's failed read keeps the last good history and says why.
  reply = () => ({ kind: 'account', status: 401, reason: 'auth_required', value: null, key: null, ms: 1 });
  await A.refreshAccountHistory();
  assert.match(p.text('#acctNote'), /^Update failed · showing what loaded \d+ s ago$/);
  // A failed worker is terminated and hands its read to the page at once.
  reply = () => 'fail';
  await A.refreshAccountHistory();
  assert.deepEqual(p.reads, ['./account-history.json'], 'the page reads instead');
  assert.equal(made[0].worker.terminated, true);
  assert.equal(globalThis.__joedesk.accountWorker(), false);
  assert.equal(globalThis.__joedesk.timings.at(-1).reason, 'account-accept');
  // The next read tries one new worker; a second failure leaves the page reading for good.
  await A.refreshAccountHistory();
  assert.equal(made.length, 2, 'one new worker on the next read');
  assert.deepEqual([made[1].worker.terminated, p.reads.length], [true, 2]);
  const posts = sent.length;
  await A.refreshAccountHistory();
  assert.deepEqual([made.length, sent.length, p.reads.length], [2, posts, 3], 'no third worker and no post to a dead one');
});

// Mocked timers never fire on their own: a test that waits on one stops at its timeout.
test('JOED-156 fix round 2: a worker that never answers is terminated after the timeout and the page reads at once; one new worker next time, then the page for good', { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saved = { Worker: globalThis.Worker, JoeVersion: globalThis.JoeVersion, hooks: globalThis.__joedesk };
  t.after(() => { for (const [k, v] of Object.entries({ Worker: saved.Worker, JoeVersion: saved.JoeVersion, __joedesk: saved.hooks })) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const workers = [];
  globalThis.Worker = class {
    constructor() { this.posts = 0; this.terminated = false; workers.push(this); }
    postMessage() { this.posts++; if (this.terminated) throw new Error('posted to a terminated worker'); }
    terminate() { this.terminated = true; }
  };
  globalThis.JoeVersion = { APP_VERSION: '261029075623.0.0' };
  globalThis.__joedesk = { timings: [] };
  const p = page(t);
  await p.render();
  assert.deepEqual([workers.length, workers[0].posts, p.reads.length], [1, 1, 0], 'the worker has the read');
  assert.equal(p.svg().getAttribute('aria-label'), 'Loading the account history', 'nothing shown yet');
  // 15 s for the worker's own read, 5 s more: it never answered.
  t.mock.timers.tick(19999);
  await p.settle();
  assert.equal(workers[0].terminated, false, 'not before the timeout');
  t.mock.timers.tick(1);
  await p.settle(); await p.settle(); await p.settle();
  assert.equal(workers[0].terminated, true, 'terminated after it');
  assert.deepEqual(p.reads, ['./account-history.json'], 'that same read on the page, at once');
  assert.equal(p.svg().dataset.source, 'daily', 'and its data shown');
  assert.equal(globalThis.__joedesk.accountWorker(), false);
  // The next read: one new worker, which times out too.
  const next = A.refreshAccountHistory();
  await p.settle();
  assert.deepEqual([workers.length, workers[1].posts], [2, 1]);
  t.mock.timers.tick(20000);
  await next;
  assert.deepEqual([workers[1].terminated, p.reads.length], [true, 2]);
  // From now on the page reads, and nothing is posted to either dead worker.
  await A.refreshAccountHistory();
  await A.refreshAccountHistory();
  assert.deepEqual([workers.length, workers[0].posts, workers[1].posts, p.reads.length], [2, 1, 1, 4]);
  assert.equal(p.svg().dataset.source, 'daily');
});

test('JOED-156 fix round 2: two reads asked at once are one read, so a healthy worker’s reply ends it and the worker stays', { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saved = { Worker: globalThis.Worker, JoeVersion: globalThis.JoeVersion, hooks: globalThis.__joedesk };
  t.after(() => { for (const [k, v] of Object.entries({ Worker: saved.Worker, JoeVersion: saved.JoeVersion, __joedesk: saved.hooks })) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const workers = [];
  globalThis.Worker = class {
    constructor() { this.posts = 0; this.terminated = false; workers.push(this); }
    postMessage() { const n = ++this.posts; queueMicrotask(() => this.onmessage({ data: { kind: 'account', status: 200, reason: null, value: M.acceptAccountHistory(history()), key: `k${n}`, ms: 2 } })); }
    terminate() { this.terminated = true; }
  };
  globalThis.JoeVersion = { APP_VERSION: '261029075623.0.0' };
  globalThis.__joedesk = { timings: [] };
  const p = page(t);
  await p.render();
  assert.deepEqual([workers.length, workers[0].posts], [1, 1]);
  // A forced read while the scheduled one runs (the budget run does this).
  const both = Promise.all([A.refreshAccountHistory(), A.refreshAccountHistory()]);
  await p.settle();
  assert.equal(workers[0].posts, 2, 'one post for both');
  t.mock.timers.tick(20000);
  await both;
  await p.settle();
  assert.deepEqual([workers.length, workers[0].terminated, globalThis.__joedesk.accountWorker()], [1, false, true], 'no timeout, and the worker stays');
  assert.equal(document.querySelector('#acctHero').dataset.history, 'ok');
  assert.deepEqual(p.reads, [], 'nothing read on the page');
});

test('JOED-156 fix round 2: a worker that refuses the post fails like one that never answers: terminated, and the page reads at once', { timeout: 10_000 }, async t => {
  const saved = { Worker: globalThis.Worker, JoeVersion: globalThis.JoeVersion, hooks: globalThis.__joedesk };
  t.after(() => { for (const [k, v] of Object.entries({ Worker: saved.Worker, JoeVersion: saved.JoeVersion, __joedesk: saved.hooks })) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });
  const workers = [];
  globalThis.Worker = class {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage() { throw new Error('the post was refused'); }
    terminate() { this.terminated = true; }
  };
  globalThis.JoeVersion = { APP_VERSION: '261029075623.0.0' };
  globalThis.__joedesk = { timings: [] };
  const p = page(t);
  await p.render();
  assert.deepEqual([workers.length, workers[0].terminated, p.reads], [1, true, ['./account-history.json']]);
  assert.equal(p.svg().dataset.source, 'daily', 'the page’s read is shown');
  assert.equal(document.querySelector('#acctHero').dataset.history, 'ok');
});

test('JOED-156 fix 5: each pointer sees its own Controls list; only the pointer rules set the lists’ display', () => {
  const css = readFileSync(new URL('../public/joe/app.css', import.meta.url), 'utf8');
  const shared = css.match(/(?:^|\n)\.acct-keys\s*\{([^}]*)\}/)?.[1];
  assert.ok(shared !== undefined, 'the lists’ shared rule');
  assert.doesNotMatch(shared, /display\s*:/, 'the shared rule leaves display to the pointer rules');
  assert.match(css, /\n\.acct-keys\.hint-fine \{ display: grid; \}/);
  assert.match(css, /\n\.acct-keys\.hint-touch \{ display: none; \}/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.acct-keys\.hint-fine \{ display: none; \} \.acct-keys\.hint-touch \{ display: grid; \} \}/);
  assert.equal([...css.matchAll(/\.acct-keys[^{]*\{[^}]*display:/g)].length, 4, 'no other rule sets their display');
});
