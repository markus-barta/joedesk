// JOED-145: History's shown window (presets, pan, zoom, resize, follow), the
// overview strip's mapping and targets, the wheel/pinch/scroll rules, the
// no-data bands and the thinned record. Pure functions, no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './fixtures/preview-dom.mjs';

const hm = await import('../public/joe/history-model.js');
const { wheelIntent, createWheelLatch, wheelPixels, wheelZoomFactor, overviewTargets } = await import('../public/joe/chart.js');

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const K0 = Date.parse('2026-10-07T00:00:00.000Z'), K1 = K0 + 7.75 * DAY, RANGE = [K0, K1];
const span = ([a, b]) => b - a;
const inside = ([a, b], [k0, k1] = RANGE) => a >= k0 && b <= k1 && a <= b;

test('JOED-145 view: a window is placed inside the range, exactly on an edge when pushed past it', () => {
  assert.deepEqual(hm.placeWindow(RANGE, DAY, K0 + 3 * DAY, 0.5), [K0 + 2.5 * DAY, K0 + 3.5 * DAY]);
  assert.deepEqual(hm.placeWindow(RANGE, DAY, K0 - 5 * DAY, 0), [K0, K0 + DAY], 'clamped at the start');
  assert.deepEqual(hm.placeWindow(RANGE, DAY, K1 + 5 * DAY, 1), [K1 - DAY, K1], 'clamped at the end, ending exactly at the newest time');
  assert.deepEqual(hm.placeWindow(RANGE, 40 * DAY, K0, 0), RANGE, 'never wider than the range');
  assert.equal(span(hm.placeWindow(RANGE, MIN, K0 + DAY)), hm.MIN_VIEW_MS, 'never narrower than five minutes');
  const tiny = [K0, K0 + 2 * MIN];
  assert.deepEqual(hm.placeWindow(tiny, MIN, K0, 0), tiny, 'a range shorter than five minutes is the smallest window');
});

test('JOED-145 view: panning keeps the width and stops on an edge without jitter', () => {
  const day = hm.presetWindow(RANGE, '1d');
  const earlier = hm.panWindow(RANGE, day, -6 * HOUR);
  assert.deepEqual(earlier, [day[0] - 6 * HOUR, day[1] - 6 * HOUR]);
  let w = hm.panWindow(RANGE, day, -30 * DAY);
  assert.deepEqual(w, [K0, K0 + DAY], 'a long pan rests on the start');
  for (let i = 0; i < 20; i++) { const next = hm.panWindow(RANGE, w, -HOUR); assert.deepEqual(next, w, 'further pans past the edge change nothing'); w = next; }
  w = hm.panWindow(RANGE, w, 30 * DAY);
  assert.deepEqual(w, [K1 - DAY, K1], 'and on the end');
  for (let i = 0; i < 20; i++) assert.deepEqual(hm.panWindow(RANGE, w, 7 * MIN), [K1 - DAY, K1]);
  assert.deepEqual(hm.panWindow(RANGE, earlier, 0), earlier);
});

test('JOED-145 view: zoom keeps the time under the pointer and stops at five minutes and at the whole range', () => {
  const week = hm.presetWindow(RANGE, '1w'), at = week[0] + 0.3 * span(week);
  const z = hm.zoomWindow(RANGE, week, 0.5, at);
  assert.ok(Math.abs((at - z[0]) / span(z) - 0.3) < 1e-9, 'the anchor keeps its place on screen');
  assert.equal(span(z), span(week) / 2);
  let w = z;
  for (let i = 0; i < 60; i++) w = hm.zoomWindow(RANGE, w, 0.5, at);
  assert.equal(span(w), hm.MIN_VIEW_MS, 'zooming in stops at five minutes of data');
  assert.ok(Math.abs((at - w[0]) / span(w) - 0.3) < 1e-6);
  assert.deepEqual(hm.zoomWindow(RANGE, w, 0.5, at), w, 'more zooming in changes nothing');
  for (let i = 0; i < 60; i++) w = hm.zoomWindow(RANGE, w, 2, at);
  assert.deepEqual(w, RANGE, 'zooming out stops at everything kept, exactly');
  const edge = hm.zoomWindow(RANGE, [K0, K0 + DAY], 3, K0 + DAY / 2);
  assert.ok(inside(edge) && edge[0] === K0 && span(edge) === 3 * DAY, 'zooming out at an edge shifts inward, never outside');
  assert.ok(inside(hm.zoomWindow(RANGE, [K1 - HOUR, K1], 0.25, K1)) && hm.zoomWindow(RANGE, [K1 - HOUR, K1], 0.25, K1)[1] === K1, 'zooming at the newest time keeps the end there');
});

test('JOED-145 view: an edge handle moves only its edge and keeps five minutes', () => {
  const w = [K0 + DAY, K0 + 2 * DAY];
  assert.deepEqual(hm.resizeWindow(RANGE, w, 'from', K0 + 1.5 * DAY), [K0 + 1.5 * DAY, K0 + 2 * DAY]);
  assert.deepEqual(hm.resizeWindow(RANGE, w, 'from', K0 + 3 * DAY), [K0 + 2 * DAY - hm.MIN_VIEW_MS, K0 + 2 * DAY], 'the start never passes the end');
  assert.deepEqual(hm.resizeWindow(RANGE, w, 'from', K0 - DAY), [K0, K0 + 2 * DAY]);
  assert.deepEqual(hm.resizeWindow(RANGE, w, 'to', K1 + DAY), [K0 + DAY, K1]);
  assert.deepEqual(hm.resizeWindow(RANGE, w, 'to', K0), [K0 + DAY, K0 + DAY + hm.MIN_VIEW_MS], 'the end never passes the start');
});

test('JOED-145 view: Follow keeps the width and the newest time; only a window at the end follows', () => {
  const past = [K0 + DAY, K0 + 2 * DAY];
  assert.deepEqual(hm.followWindow(RANGE, past), [K1 - DAY, K1]);
  assert.equal(hm.atLiveEdge(RANGE, [K1 - DAY, K1]), true);
  assert.equal(hm.atLiveEdge(RANGE, [K1 - DAY - 60e3, K1 - 60e3]), true, 'within about two pixels of the end');
  assert.equal(hm.atLiveEdge(RANGE, [K1 - DAY - 10 * MIN, K1 - 10 * MIN]), false);
  assert.equal(hm.atLiveEdge(RANGE, past), false);
  // The range grows with new history: a following view moves, a parked one stays.
  const later = [K0, K1 + HOUR];
  assert.deepEqual(hm.resolveView(later, { view: [K1 - DAY, K1], follow: true }), [K1 + HOUR - DAY, K1 + HOUR]);
  assert.deepEqual(hm.resolveView(later, { view: past, follow: false }), past);
});

test('JOED-145 view: presets end at the newest time; Month longer than the kept history shows all of it', () => {
  assert.deepEqual(hm.presetWindow(RANGE, 'all'), RANGE);
  assert.deepEqual(hm.presetWindow(RANGE, '1d'), [K1 - DAY, K1]);
  assert.deepEqual(hm.presetWindow(RANGE, '1w'), [K1 - 7 * DAY, K1]);
  assert.deepEqual(hm.presetWindow(RANGE, '1m'), RANGE);
  assert.equal(hm.presetSpan(RANGE, '1m'), span(RANGE));
  assert.equal(hm.windowPreset(RANGE, [K1 - 7 * DAY, K1]), '1w');
  assert.equal(hm.windowPreset(RANGE, [K0 + DAY, K0 + 8 * DAY - 0.25 * DAY]), null, 'a width between presets presses none');
  assert.equal(hm.windowPreset(RANGE, [K0 + DAY, K0 + 2 * DAY]), '1d', 'the width decides; Follow says where it is');
  assert.equal(hm.windowPreset(RANGE, RANGE), 'all', 'everything kept is Fit all');
  assert.equal(hm.windowPreset(RANGE, RANGE, '1m'), '1m', 'unless Month was chosen and shows the same');
  assert.equal(hm.windowPreset(RANGE, [K0 + 3 * HOUR, K0 + 6 * HOUR], '1w'), null);
  const short = [K1 - 3 * HOUR, K1];
  assert.deepEqual(hm.presetWindow(short, '1d'), short, 'a Day longer than three hours of history shows all three');
});

test('JOED-145 view: a manual view is kept inside the range with its own width', () => {
  assert.deepEqual(hm.resolveView(RANGE, { preset: '1w', view: null }), [K1 - 7 * DAY, K1]);
  const narrow = [K0 + 30e3, K0 + 114e3];
  assert.deepEqual(hm.resolveView(RANGE, { view: narrow, follow: false }), narrow, 'an explicit narrow view is drawn as asked');
  assert.deepEqual(hm.resolveView(RANGE, { view: [K0 - DAY, K0 + DAY], follow: false }), [K0, K0 + 2 * DAY], 'moved inside, same width');
  assert.deepEqual(hm.resolveView(RANGE, { view: [K0 - 40 * DAY, K1 + DAY], follow: false }), RANGE);
  assert.deepEqual(hm.keepInside(RANGE, [K1, K1 + DAY]), [K1 - DAY, K1]);
});

test('JOED-145 view: a glide eases from one window to the next and lands exactly', () => {
  const from = [K0, K1], to = [K1 - DAY, K1];
  assert.deepEqual(hm.lerpWindow(from, to, 0), from);
  assert.deepEqual(hm.lerpWindow(from, to, 1), to);
  assert.deepEqual(hm.lerpWindow(from, to, 1.2), to);
  assert.equal(hm.easeOut(0), 0);
  assert.equal(hm.easeOut(1), 1);
  let last = -1;
  for (let t = 0; t <= 1; t += 0.05) { const e = hm.easeOut(t); assert.ok(e >= last); last = e; }
  assert.ok(hm.easeOut(0.5) > 0.5, 'fast first, settling at the end');
});

test('JOED-145 overview: the strip maps the whole range onto its width and back', () => {
  const width = 800;
  assert.equal(hm.toStrip(RANGE, width, K0), 0);
  assert.equal(hm.toStrip(RANGE, width, K1), width);
  assert.equal(hm.toStrip(RANGE, width, K0 + span(RANGE) / 4), 200);
  assert.equal(hm.toStrip(RANGE, width, K0 - DAY), 0, 'outside the range sits on its edge');
  assert.equal(hm.toStrip(RANGE, width, K1 + DAY), width);
  for (const px of [0, 1, 123.5, 400, 799, 800]) assert.ok(Math.abs(hm.toStrip(RANGE, width, hm.fromStrip(RANGE, width, px)) - px) < 1e-6);
  assert.equal(hm.fromStrip(RANGE, width, -40), K0);
  assert.equal(hm.fromStrip(RANGE, width, 900), K1);
  assert.equal(hm.toStrip([K0, K0], width, K0), 0, 'an empty range has no positions');
  assert.equal(hm.fromStrip(RANGE, 0, 10), K0);
});

test('JOED-145 overview: edge handles keep their boxes inside the strip and apart', () => {
  const t = overviewTargets({ width: 800, left: 200, right: 600, hit: 16 });
  assert.deepEqual(t.win, { x: 200, w: 400 });
  assert.deepEqual([t.from.x, t.from.w, t.from.gx], [192, 16, 200]);
  assert.deepEqual([t.to.x, t.to.w, t.to.gx], [592, 16, 600]);
  // A window narrower than two 44 px boxes: the boxes sit side by side around its middle.
  const narrow = overviewTargets({ width: 190, left: 100, right: 104, hit: 44 });
  assert.deepEqual([narrow.from.x, narrow.to.x], [58, 102]);
  assert.ok(narrow.from.gx >= narrow.from.x && narrow.from.gx <= narrow.from.x + 44 && narrow.to.gx >= narrow.to.x && narrow.to.gx <= narrow.to.x + 44, 'each grip stays in its own box');
  for (const [left, right] of [[0, 0.4], [0, 190], [189.7, 190], [0, 30], [170, 190]]) {
    const p = overviewTargets({ width: 190, left, right, hit: 44 });
    assert.ok(p.from.x >= 0 && p.to.x + p.to.w <= 190, `boxes inside the strip for ${left}–${right}`);
    assert.ok(p.from.x + p.from.w <= p.to.x + 1e-9, `boxes never overlap for ${left}–${right}`);
    assert.ok(p.from.gx >= p.from.x && p.from.gx <= p.from.x + p.from.w && p.to.gx >= p.to.x && p.to.gx <= p.to.x + p.to.w);
  }
  const wide = overviewTargets({ width: 190, left: 0, right: 190, hit: 44 });
  assert.deepEqual([wide.from.x, wide.to.x], [0, 146], 'a full window keeps its handles at the strip ends');
});

test('JOED-145 input: a wheel zooms with ⌘ or Ctrl (pinch), pans sideways, and a plain vertical wheel is the page’s', () => {
  assert.equal(wheelIntent({ deltaY: -3, ctrlKey: true }), 'zoom', 'Chrome and Firefox send a pinch as a Ctrl wheel');
  assert.equal(wheelIntent({ deltaY: 100, metaKey: true }), 'zoom', '⌘ with a mouse wheel');
  assert.equal(wheelIntent({ deltaX: 40, deltaY: 6 }), 'pan', 'a two-finger sideways swipe');
  assert.equal(wheelIntent({ deltaX: -40, deltaY: -39 }), 'pan');
  assert.equal(wheelIntent({ deltaY: 100, shiftKey: true }), 'pan', 'Shift with a vertical wheel');
  assert.equal(wheelIntent({ deltaY: 100 }), 'page', 'a plain vertical wheel scrolls the page');
  assert.equal(wheelIntent({ deltaX: 2, deltaY: 30 }), 'page', 'a vertical scroll with some drift');
  assert.equal(wheelIntent({}), 'page');
});

test('JOED-145 input: one gesture keeps its meaning until the wheel rests; a held modifier zooms at once', () => {
  let latch = createWheelLatch(200);
  assert.equal(latch({ deltaX: 30, deltaY: 2 }, 0), 'pan');
  assert.equal(latch({ deltaX: 1, deltaY: 12 }, 16), 'pan', 'a sideways swipe drifting vertical still pans, never scrolls the page half-way');
  assert.equal(latch({ deltaY: 4, ctrlKey: true }, 32), 'zoom', 'a pinch takes over at once');
  assert.equal(latch({ deltaY: 8 }, 48), 'page', 'and stops the moment the modifier is gone');
  assert.equal(latch({ deltaX: 50, deltaY: 1 }, 64), 'page', 'a page scroll drifting sideways never starts panning');
  assert.equal(latch({ deltaX: 50, deltaY: 1 }, 300), 'pan', 'after a rest a new gesture decides again');
  latch = createWheelLatch(200);
  assert.equal(latch({ deltaY: 100 }, 1000), 'page');
  assert.equal(latch({ deltaY: 100 }, 1100), 'page');
  assert.equal(latch({ deltaY: -100, metaKey: true }, 1150), 'zoom');
});

test('JOED-145 input: wheel distances in pixels; zoom factors follow the fingers and are symmetric', () => {
  assert.equal(wheelPixels(3, 0), 3);
  assert.equal(wheelPixels(3, 1), 48, 'lines');
  assert.equal(wheelPixels(1, 2), 600, 'pages');
  assert.ok(wheelZoomFactor(-10) < 1 && wheelZoomFactor(10) > 1, 'spreading the fingers (negative delta) narrows the window');
  assert.ok(Math.abs(wheelZoomFactor(-10) * wheelZoomFactor(10) - 1) < 1e-12, 'in and out by the same delta return');
  assert.ok(Math.abs(wheelZoomFactor(-5) - Math.exp(-0.05)) < 1e-12, 'Chrome pinch deltas map to the finger scale');
  assert.equal(wheelZoomFactor(100), wheelZoomFactor(35), 'one mouse notch is capped at about 40 %');
  assert.ok(Math.abs(wheelZoomFactor(100) - Math.exp(0.35)) < 1e-12);
  assert.equal(wheelZoomFactor(0), 1);
});

test('JOED-145 bands: hatched only where every chosen desk lacks numbers for more than five minutes', () => {
  const g = (from, to) => [{ x: from, y: 1 }, { x: (from + to) / 2, y: 1 }, { x: to, y: 1 }];
  const j = [g(K0, K0 + HOUR), g(K0 + 3 * HOUR, K0 + 5 * HOUR)];
  const joe = [g(K0 + 30 * MIN, K0 + 4 * HOUR)];
  assert.deepEqual(hm.missingBands([j, joe]), [[K0 + 30 * MIN, K0 + HOUR], [K0 + 3 * HOUR, K0 + 4 * HOUR]]);
  assert.deepEqual(hm.missingBands([j, [g(K0 + 50 * MIN, K0 + 58 * MIN)]]), [[K0 + 50 * MIN, K0 + 58 * MIN]]);
  assert.deepEqual(hm.missingBands([j, [g(K0 + 57 * MIN, K0 + 62 * MIN)]]), [], 'three minutes in common is within the observation interval');
  assert.deepEqual(hm.missingBands([j, []]), [], 'a desk with numbers there keeps the board observed');
  assert.deepEqual(hm.missingBands([j]), [[K0, K0 + HOUR], [K0 + 3 * HOUR, K0 + 5 * HOUR]]);
  assert.deepEqual(hm.missingBands([]), []);
});

const row = (ms, values) => ({ t: new Date(ms).toISOString(), totals: {},
  desks: Object.fromEntries(hm.DESK_IDS.map(id => [id, { money: values[id] === undefined ? {} : { equity: values[id] === null ? null : { amount: String(values[id]), currency: 'EUR' } } }])) });

test('JOED-145 thinning: rows the server thinned stay connected; explicit nulls and later gaps stay estimates', () => {
  // Thinned: rows 40 minutes apart until 06:00, one explicit null; raw rows every
  // 30 s after it, then a real 20-minute outage.
  const points = [];
  for (let m = 0; m <= 360; m += 40) points.push(row(K0 + m * MIN, { j: m === 160 ? null : 5000 + m }));
  for (let s = 361 * 60; s <= 420 * 60; s += 30) points.push(row(K0 + s * 1000, { j: 6000 }));
  for (let s = 440 * 60; s <= 450 * 60; s += 30) points.push(row(K0 + s * 1000, { j: 6001 }));
  const cols = hm.toColumns(points), end = K0 + 450 * MIN, thin = K0 + 360 * MIN;
  const raw = hm.continuitySeries(cols, 'j', 'all', end);
  const kept = hm.continuitySeries(cols, 'j', 'all', end, { thinnedThrough: thin });
  assert.ok(raw.gaps.length > kept.gaps.length, 'without the mark, thinning reads as outages');
  const inThinned = g => g[g.length - 1].x <= thin;
  assert.deepEqual(kept.gaps.filter(inThinned).map(g => [g[0].x, g[g.length - 1].x]), [[K0 + 120 * MIN, K0 + 200 * MIN]], 'only the explicit null is estimated in the thinned part');
  assert.equal(kept.observed.filter(p => p.y === null && p.x < K0 + 120 * MIN).length, 0, 'no breaks between thinned rows');
  assert.ok(kept.gaps.some(g => g[0].x === K0 + 420 * MIN && g[g.length - 1].x === K0 + 440 * MIN), 'a real outage after the mark is still an estimate');
  assert.ok(kept.gaps.some(g => g[0].x === K0 + 360 * MIN && g[g.length - 1].x === K0 + 361 * MIN) === false, 'the step from thinned to raw rows within five minutes is observed');
  assert.deepEqual(hm.continuitySeries(cols, 'j', 'all', end, { thinnedThrough: null }), raw, 'no mark, no change');
});
