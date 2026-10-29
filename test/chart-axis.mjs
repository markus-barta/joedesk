// JOED-154: the vertical axis every time chart shares (chart.js): Auto, Max
// and Custom with their checks and per-viewer memory, labels that keep 56 px
// apart, the eased re-fit, and the first-visit hint. Pure functions and the
// real SVG renderer on the Node test DOM, no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlDocument } from './fixtures/preview-dom.mjs';

const chart = await import('../public/joe/chart.js');
const { axis, fixedAxis, eurAxis, changeAxis, axisChoice, axisBound, customAxis, createAxisMode, chartHintSeen, dismissChartHint, forgetChartMemory,
  drawChart, AXIS_MODES, AXIS_LIMIT, CHART_AXES_KEY, CHART_HINT_KEY } = chart;
const NB = ' ', MINUS = '−';

// A browser's storage for one test: a Map, or one that throws like a blocked
// or full storage. Charts read it through window, as a page does.
function withStorage(t, store = new Map(), { throws = false } = {}) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = {
    getItem: key => { if (throws) throw new Error('blocked'); return store.has(key) ? store.get(key) : null; },
    setItem: (key, value) => { if (throws) throw new Error('full'); store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', { value: { localStorage }, configurable: true, writable: true });
  forgetChartMemory();
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'window', saved); else delete globalThis.window; forgetChartMemory(); });
  return store;
}
// Labels stay at least `gap` px apart on `px` of axis.
const spacing = (a, px) => px * a.step / (a.hi - a.lo);

test('JOED-154 axis choice: Auto, Max and Custom, checked; anything else is Auto', () => {
  assert.deepEqual(AXIS_MODES, ['auto', 'max', 'custom']);
  assert.deepEqual(axisChoice(undefined), { mode: 'auto' });
  assert.deepEqual(axisChoice({ mode: 'max', min: 1, max: 2 }), { mode: 'max' }, 'Max has no bounds of its own');
  assert.deepEqual(axisChoice({ mode: 'custom', min: -25, max: 40.5 }), { mode: 'custom', min: -25, max: 40.5 });
  for (const bad of [{ mode: 'custom', min: 5, max: 5 }, { mode: 'custom', min: 6, max: 5 }, { mode: 'custom', min: NaN, max: 5 }, { mode: 'custom', min: 0, max: AXIS_LIMIT * 2 },
    { mode: 'custom' }, { mode: 'live' }, { mode: 'max ' }, 'max', null, []]) assert.deepEqual(axisChoice(bad), { mode: 'auto' }, JSON.stringify(bad));
});

test('JOED-154 axis bounds: typed euros with a point or a comma, without grouping; both, in order, within the limit', () => {
  for (const [raw, n] of [['4950', 4950], ['4950,5', 4950.5], ['4950.50', 4950.5], ['-25', -25], [`${MINUS}25`, -25], ['–25', -25], ['+40', 40], [' 7 ', 7], ['0', 0], [12.345, 12.345]]) {
    assert.equal(axisBound(raw), n, JSON.stringify(raw));
  }
  for (const raw of ['', '4.950,00', '4,950.00', '1e3', '12,345', '€ 20', '20 €', '--5', '5-', 'NaN', 'Infinity', String(AXIS_LIMIT * 10), Infinity, NaN, null, undefined]) {
    assert.equal(axisBound(raw), null, JSON.stringify(raw));
  }
  assert.deepEqual(customAxis('-25', '40,5'), { ok: true, min: -25, max: 40.5 });
  assert.deepEqual(customAxis(4900, 5100), { ok: true, min: 4900, max: 5100 }, 'Numbers from a chart pass as they are');
  assert.deepEqual(customAxis('', '10'), { ok: false, field: 'min', error: 'Enter both a bottom and a top.' });
  assert.deepEqual(customAxis('10', ' '), { ok: false, field: 'max', error: 'Enter both a bottom and a top.' });
  const grouped = customAxis('4.950,00', '5100');
  assert.deepEqual([grouped.ok, grouped.field], [false, 'min']);
  assert.match(grouped.error, /^Enter euros as a number, for example −25 or 4950,50, without grouping and within 10\.000\.000\.$/);
  assert.deepEqual(customAxis('20', '20'), { ok: false, field: 'max', error: 'The top must be above the bottom.' });
  assert.deepEqual(customAxis('30', '-30'), { ok: false, field: 'max', error: 'The top must be above the bottom.' });
});

test('JOED-154 axis memory: one choice per chart and viewer, saved in this browser, read again after a reload', t => {
  const store = withStorage(t);
  const history = createAxisMode('history.change'), account = createAxisMode('account');
  assert.deepEqual(history.get(), { mode: 'auto' }, 'Auto until a viewer chooses');
  assert.deepEqual(history.setAxisMode({ mode: 'max' }), { ok: true, choice: { mode: 'max' } });
  assert.deepEqual(account.get(), { mode: 'auto' }, 'each chart its own');
  assert.deepEqual(account.setAxisMode({ mode: 'custom', min: '4.900', max: '5100' }).ok, false, 'a refused custom axis changes nothing');
  assert.deepEqual(account.get(), { mode: 'auto' });
  assert.deepEqual(account.setAxisMode({ mode: 'custom', min: '4900', max: '5100,50' }), { ok: true, choice: { mode: 'custom', min: 4900, max: 5100.5 } });
  assert.deepEqual(JSON.parse(store.get(CHART_AXES_KEY)), { 'history.change': { mode: 'max' }, account: { mode: 'custom', min: 4900, max: 5100.5 } });
  forgetChartMemory();
  assert.deepEqual([createAxisMode('history.change').get(), createAxisMode('account').get()], [{ mode: 'max' }, { mode: 'custom', min: 4900, max: 5100.5 }], 'a reload reads both back');
  createAxisMode('history.change').setAxisMode({ mode: 'auto' });
  assert.deepEqual(JSON.parse(store.get(CHART_AXES_KEY)), { account: { mode: 'custom', min: 4900, max: 5100.5 } }, 'Auto is the default and is not kept');
  // Saved values are checked again on reading: a damaged entry is Auto, the rest stays.
  store.set(CHART_AXES_KEY, JSON.stringify({ a: { mode: 'custom', min: 9, max: 1 }, b: { mode: 'max' }, c: 'max' }));
  forgetChartMemory();
  assert.deepEqual(['a', 'b', 'c'].map(id => createAxisMode(id).get().mode), ['auto', 'max', 'auto']);
  store.set(CHART_AXES_KEY, '{not json');
  forgetChartMemory();
  assert.deepEqual(createAxisMode('b').get(), { mode: 'auto' }, 'unreadable storage is Auto everywhere');
});

test('JOED-154 axis memory: without storage, or with storage that throws, a choice holds for this page', t => {
  withStorage(t, new Map(), { throws: true });
  const yAxis = createAxisMode('history.money');
  assert.deepEqual(yAxis.get(), { mode: 'auto' });
  assert.deepEqual(yAxis.setAxisMode({ mode: 'max' }), { ok: true, choice: { mode: 'max' } });
  assert.deepEqual(createAxisMode('history.money').get(), { mode: 'max' }, 'kept for this page');
  delete globalThis.window;
  forgetChartMemory();
  assert.deepEqual(createAxisMode('history.money').get(), { mode: 'auto' }, 'no window: nothing saved, nothing thrown');
  assert.deepEqual(createAxisMode('x').setAxisMode({ mode: 'custom', min: 1, max: 2 }).ok, true);
});

test('JOED-154 first-visit hint: shown until the first gesture, then never again in this browser', t => {
  const store = withStorage(t);
  assert.equal(chartHintSeen(), false);
  assert.equal(dismissChartHint(), true, 'the first gesture retires it');
  assert.equal(dismissChartHint(), false, 'later ones change nothing');
  assert.equal(store.get(CHART_HINT_KEY), '1');
  forgetChartMemory();
  assert.equal(chartHintSeen(), true, 'remembered after a reload');
  withStorage(t, new Map(), { throws: true });
  assert.equal(chartHintSeen(), false);
  assert.equal(dismissChartHint(), true);
  assert.equal(chartHintSeen(), true, 'blocked storage: gone for this page');
});

test('JOED-154 ticks: with the axis length in pixels labels keep at least 56 px apart, at every height and range', () => {
  for (const px of [120, 180, 224, 260, 300, 340, 600]) {
    for (const [lo, hi, base, zero] of [[4998, 5003, 5000, false], [-37.2, 23.4, 5000, true], [0, 1, 0, true], [-0.4, 0.3, 0, true], [4870, 5130, 0, false], [-1234, 98765, 0, false], [14990, 15004, 15000, false]]) {
      const a = axis(lo, hi, 5, base, zero, { px, gap: 56 });
      assert.ok(spacing(a, px) >= 56 - 1e-9, `${lo}…${hi} on ${px} px: ${spacing(a, px).toFixed(1)} px between labels`);
      assert.ok(a.lo <= lo && a.hi >= hi && (!zero || (a.lo <= 0 && a.hi >= 0)), 'the data and zero stay inside');
      if (base) assert.ok(a.hi - a.lo >= Math.abs(base) * 0.01 - 1e-9, 'the ±0,5 % floor holds');
      assert.equal(a.ticks.length, Math.round((a.hi - a.lo) / a.step) + 1);
    }
  }
});

// axis() as it was before JOED-154, for the charts that pass no pixels.
function legacyAxis(lo, hi, n = 4, base = 0, zero = false) {
  const niceStep = raw => { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (base) { const c = (lo + hi) / 2, h = Math.max(Math.abs(base) * 0.005, (hi - lo) / 2); lo = c - h; hi = c + h; }
  if (hi - lo < 1) { if (zero) hi = Math.max(hi, lo + 1); else { lo -= 0.5; hi += 0.5; } }
  const step = niceStep((hi - lo) / n), a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: a, hi: b, ticks, step };
}
test('JOED-154 ticks: without pixels the step count is exactly the old one, for the charts that did not ask', () => {
  let seed = 154;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 500; i++) {
    const lo = (rand() - 0.5) * 10 ** Math.floor(rand() * 6), hi = lo + rand() * 10 ** Math.floor(rand() * 6), n = 2 + Math.floor(rand() * 4);
    const base = rand() < 0.5 ? 0 : 5000, zero = rand() < 0.5;
    assert.deepEqual(axis(lo, hi, n, base, zero), legacyAxis(lo, hi, n, base, zero), `${lo}…${hi}, ${n}, ${base}, ${zero}`);
    assert.deepEqual(axis(lo, hi, n, base, zero, null), legacyAxis(lo, hi, n, base, zero));
  }
});

test('JOED-154 ticks: a fixed range keeps its exact bounds and labels at least 56 px apart inside it', () => {
  for (const px of [150, 224, 300]) {
    for (const [lo, hi] of [[-25, 40.5], [4900, 5100], [4937, 5061], [0.1, 0.7], [-1e6, 1e6]]) {
      const a = fixedAxis(lo, hi, { px, gap: 56 });
      assert.deepEqual([a.lo, a.hi], [lo, hi]);
      assert.ok(a.ticks.length >= 1 && a.ticks.every(v => v >= lo - 1e-9 && v <= hi + 1e-9), `${lo}…${hi}: ${a.ticks}`);
      assert.ok(spacing(a, px) >= 56 - 1e-9 || a.ticks.length <= 1, `${lo}…${hi} on ${px} px`);
    }
  }
});

test('JOED-154 axis labels: Money and Change euros; a 2,5 step keeps its decimal', () => {
  assert.deepEqual([20, 0, -20].map(v => eurAxis(v, 10)), [`€${NB}20`, `€${NB}0`, `${MINUS}€${NB}20`]);
  assert.deepEqual([20, 0, -20].map(v => changeAxis(v, 10)), [`+€${NB}20`, `€${NB}0`, `${MINUS}€${NB}20`]);
  assert.deepEqual([2.5, 7.5].map(v => changeAxis(v, 2.5)), [`+€${NB}2,5`, `+€${NB}7,5`]);
  assert.equal(eurAxis(0.25, 0.25), `€${NB}0,25`);
});

// drawChart on the Node test DOM. matchMedia answers reduced motion unless a
// test says otherwise.
function canvas(t, { reduce = true } = {}) {
  const saved = { document: globalThis.document, matchMedia: globalThis.matchMedia };
  t.after(() => { globalThis.document = saved.document; globalThis.matchMedia = saved.matchMedia; });
  globalThis.document = htmlDocument(`<div id="axisChart${Math.random().toString(36).slice(2)}"></div>`);
  const motion = { reduce };
  globalThis.matchMedia = query => ({ matches: /reduce/.test(query) ? motion.reduce : false });
  const el = document.querySelector('div');
  Object.assign(el, { clientWidth: 600, clientHeight: 300 });
  const svg = () => el.querySelector(':scope > svg');
  return { el, motion, svg, range: () => [Number(svg().getAttribute('data-ylo')), Number(svg().getAttribute('data-yhi'))] };
}
const line = (values, x0 = 0) => [{ pts: values.map((v, i) => ({ x: x0 + i, v })), color: 'var(--desk-j)', area: false }];

test('JOED-154 drawChart: without an axis choice it draws as before; Auto fits the shown values, Max every loaded value', t => {
  const c = canvas(t);
  const shown = [5000, 5010, 4995, 5020];
  drawChart(c.el, { series: line(shown), xDomain: [0, 3], base: 5000, margin: 0.08, yFmt: eurAxis, ticks: 5 });
  const before = c.range();
  assert.equal(c.svg().getAttribute('data-axis'), null, 'no choice, no data-axis');
  assert.equal(c.svg().getAttribute('data-base'), '5000');
  drawChart(c.el, { series: line(shown), xDomain: [0, 3], base: 5000, margin: 0.08, yFmt: eurAxis, ticks: 5, axis: { mode: 'auto' } });
  assert.deepEqual(c.range(), before, 'Auto is the same fit');
  assert.equal(c.svg().getAttribute('data-axis'), 'auto');
  drawChart(c.el, { series: line(shown), xDomain: [0, 3], base: 5000, margin: 0.08, yFmt: eurAxis, ticks: 5, axis: { mode: 'max' }, maxValues: [4800, 5300] });
  const [lo, hi] = c.range();
  assert.ok(lo <= 4800 && hi >= 5300 && hi - lo > before[1] - before[0], `Max fits all loaded values: ${lo}…${hi}`);
  assert.equal(c.svg().getAttribute('data-axis'), 'max');
  drawChart(c.el, { series: line([5100, 5101]), xDomain: [0, 1], base: 5000, margin: 0.08, yFmt: eurAxis, ticks: 5, axis: { mode: 'max' }, maxValues: [4800, 5300] });
  assert.deepEqual(c.range(), [lo, hi], 'other shown values, the same Max axis');
  drawChart(c.el, { series: line(shown), xDomain: [0, 3], base: 5000, margin: 0.08, yFmt: eurAxis, ticks: 5, axis: { mode: 'max' } });
  assert.deepEqual(c.range(), before, 'Max without loaded values falls back to the shown ones');
});

test('JOED-154 drawChart: Custom is exactly its bounds, says so on the chart and where values lie beyond it', t => {
  const c = canvas(t);
  const draw = (values, min, max) => drawChart(c.el, { series: line(values), xDomain: [0, values.length - 1], base: 5000, zero: true, yFmt: changeAxis, tickGap: 56, axis: { mode: 'custom', min, max } });
  const scale = draw([0, 5, -3, 12], -10, 20);
  assert.deepEqual(c.range(), [-10, 20]);
  assert.deepEqual([c.svg().getAttribute('data-zero'), c.svg().getAttribute('data-base'), c.svg().getAttribute('data-axis')], [null, null, 'custom'],
    'a custom axis is the reader’s: it makes neither automatic promise (zero inside, the ±0,5 % floor)');
  const notes = () => c.el.querySelectorAll('[data-axis-note]').map(n => n.textContent);
  assert.deepEqual(notes(), ['Custom axis']);
  assert.ok(scale.ax.ticks.every(v => v >= -10 && v <= 20) && spacing(scale.ax, scale.ph) >= 56);
  draw([0, 25, -3, 12], -10, 20);
  assert.deepEqual(notes(), ['Custom axis · some values lie above it']);
  draw([0, 25, -30, 12], -10, 20);
  assert.deepEqual(notes(), ['Custom axis · some values lie above it', 'Some values lie below it']);
  drawChart(c.el, { series: line([1, 2]), xDomain: [0, 1], yFmt: eurAxis, axis: { mode: 'custom', min: 9, max: 1 } });
  assert.equal(c.svg().getAttribute('data-axis'), 'auto', 'a broken custom choice draws as Auto');
  assert.deepEqual(notes(), []);
});

test('JOED-154 drawChart: a new range glides over the ease time, landing exactly; reduced motion, the first drawing and a new key land at once', t => {
  const c = canvas(t, { reduce: true });
  const clock = { now: 1000 }, realNow = performance.now;
  performance.now = () => clock.now;
  t.after(() => { performance.now = realNow; });
  let again = 0;
  const draw = (values, key = 'change') => drawChart(c.el, { series: line(values), xDomain: [0, values.length - 1], zero: true, yFmt: changeAxis, tickGap: 56, ease: 180, easeKey: key, again: () => { again++; } });
  const first = draw([0, 10]).target;
  assert.deepEqual(c.range(), [first.lo, first.hi], 'the first drawing lands at once');
  c.motion.reduce = false;
  const wide = draw([0, 100, -100]).target;
  assert.deepEqual(c.range(), [first.lo, first.hi], 'a new target starts from the range on screen');
  assert.equal(again, 1, 'and asks for the next frame');
  clock.now += 90;
  const mid = draw([0, 100, -100]);
  assert.ok(mid.ax.lo < first.lo && mid.ax.lo > wide.lo && mid.ax.hi > first.hi && mid.ax.hi < wide.hi, `half-way: ${mid.ax.lo}…${mid.ax.hi}`);
  assert.ok(spacing(mid.ax, mid.ph) >= 56 - 1e-9, 'labels keep 56 px apart while it glides');
  assert.equal(again, 2);
  clock.now += 90;
  draw([0, 100, -100]);
  assert.deepEqual(c.range(), [wide.lo, wide.hi], 'after the ease time it lands exactly');
  assert.equal(again, 2, 'and stops asking');
  draw([0, 4000], 'money');
  const money = c.range();
  assert.ok(money[1] >= 4000 && again === 2, 'another key (Change to Money) lands at once');
  c.motion.reduce = true;
  draw([0, 10], 'money');
  assert.deepEqual(c.range(), [first.lo, first.hi], 'with reduced motion every change lands at once');
  assert.equal(again, 2);
});
