// JOED-145: History's shown window (presets, pan, zoom, resize, follow), the
// overview strip's mapping and targets, the wheel/pinch/scroll rules, the
// time axis, the comparison line, the no-data bands, and the server's
// gap-preserving compaction with what the page reads from it.
// Pure functions, no browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builders } from './fixtures/preview-dom.mjs';

const hm = await import('../public/joe/history-model.js');
const { wheelIntent, createWheelLatch, wheelPixels, wheelZoomFactor, overviewTargets } = await import('../public/joe/chart.js');
const { wallTicks, historyPointDetails } = await import('../public/joe/history.js');
const { axisLabels, compareLine } = await builders('history.js', ['axisLabels', 'compareLine']);
const { compactPoints, boundHistory, measureHistory, HISTORY_WARNING } = await import('../server/history.mjs');
const { CONTRACTS, validateContract } = await import('../contracts/index.mjs');
const { timeHM } = await import('../public/joe/format.js');

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, GAP = 20 * MIN;
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

test('JOED-145 view: a move keeps Follow only if it ends exactly at the newest time; a pixel back leaves it, small moves add up', () => {
  const day = hm.presetWindow(RANGE, '1d'), perPx = DAY / 800;
  assert.equal(hm.endsAtNewest(RANGE, day), true);
  const back = hm.panWindow(RANGE, day, -perPx);
  assert.equal(hm.endsAtNewest(RANGE, back), false, 'one pixel into the past leaves Follow');
  assert.equal(hm.atLiveEdge(RANGE, back), true, 'though it is within the two pixels the drawing treats as the end');
  let w = day;
  for (let i = 0; i < 10; i++) w = hm.panWindow(RANGE, w, -0.25 * perPx);
  assert.ok(Math.abs(w[1] - (K1 - 2.5 * perPx)) < 1e-3 && span(w) === DAY, 'ten quarter-pixel moves add up to two and a half pixels');
  assert.equal(hm.endsAtNewest(RANGE, hm.panWindow(RANGE, w, 10 * perPx)), true, 'a move past the end rests exactly on it and follows again');
  assert.equal(hm.endsAtNewest(RANGE, hm.zoomWindow(RANGE, day, 0.5, K1)), true, 'zooming at the newest time keeps following');
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
  assert.deepEqual(hm.resolveView(RANGE, { view: narrow, follow: false }), [K0, K0 + hm.MIN_VIEW_MS], 'a view under five minutes widens to five, inside the range');
  assert.deepEqual(hm.resolveView(RANGE, { view: [K0 - DAY, K0 + DAY], follow: false }), [K0, K0 + 2 * DAY], 'moved inside, same width');
  assert.deepEqual(hm.resolveView(RANGE, { view: [K0 - 40 * DAY, K1 + DAY], follow: false }), RANGE);
  assert.deepEqual(hm.keepInside(RANGE, [K1, K1 + DAY]), [K1 - DAY, K1]);
});

test('JOED-145 view: every resolve holds the five-minute floor, also after newer history arrives; a view of no width is repaired', () => {
  const young = [K0, K0 + 2 * MIN];
  assert.deepEqual(hm.resolveView(young, { view: young, follow: false }), young, 'with two minutes kept, those two minutes are the smallest window');
  const later = [K0, K0 + DAY];
  assert.deepEqual(hm.resolveView(later, { view: young, follow: false }), [K0, K0 + 5 * MIN], 'once more is kept, the parked view widens to five minutes');
  assert.deepEqual(hm.resolveView(later, { view: young, follow: true }), [K0 + DAY - 5 * MIN, K0 + DAY], 'a following one too, at the newest time');
  const mid = K0 + 6 * HOUR;
  for (const view of [[mid, mid], [mid + 30e3, mid - 30e3], [mid - 30e3, mid + 30e3]]) {
    assert.deepEqual(hm.resolveView(later, { view, follow: false }), [mid - 2.5 * MIN, mid + 2.5 * MIN], `${view.map(x => (x - mid) / 1000)} s around its time widens to five minutes there`);
  }
  assert.deepEqual(hm.resolveView(later, { view: [K0 + DAY - MIN, K0 + DAY - MIN], follow: false }), [K0 + DAY - 5 * MIN, K0 + DAY], 'near the end it widens inside the range');
  for (let i = 0; i < 5; i++) assert.ok(span(hm.resolveView([K0, K0 + DAY + i * MIN], { view: [mid, mid], follow: false })) === 5 * MIN, 'and stays repaired as the range grows');
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

test('JOED-145 overview: the window stays a 44 px drag target and the edge handles keep their boxes beside it', () => {
  const t = overviewTargets({ width: 800, left: 200, right: 600, hit: 16 });
  assert.deepEqual(t.win, { x: 200, w: 400, hit: { x: 200, w: 400 } });
  assert.deepEqual([t.from.x, t.from.w, t.from.gx], [192, 16, 200]);
  assert.deepEqual([t.to.x, t.to.w, t.to.gx], [592, 16, 600]);
  // A window narrower than a finger (Day on a phone): its target is 44 px
  // around its middle and the handles sit outside that target.
  const narrow = overviewTargets({ width: 190, left: 100, right: 104, hit: 44 });
  assert.deepEqual(narrow.win.hit, { x: 80, w: 44 });
  assert.deepEqual([narrow.from.x, narrow.from.w, narrow.to.x, narrow.to.w], [36, 44, 124, 44]);
  // At the newest time the end handle uses the room beside the track.
  const live = overviewTargets({ width: 260, left: 241.4, right: 260, hit: 44, lo: -64, hi: 284 });
  assert.deepEqual(live.win.hit, { x: 216, w: 44 });
  assert.deepEqual([live.from.x, live.from.w, live.to.x, live.to.w], [172, 44, 260, 24]);
  for (const [left, right] of [[0, 0.4], [0, 190], [189.7, 190], [0, 30], [170, 190], [100, 104], [60, 130], [95, 95]]) {
    for (const room of [{}, { lo: -64, hi: 214 }]) {
      const p = overviewTargets({ width: 190, left, right, hit: 44, ...room }), lo = room.lo ?? 0, hi = room.hi ?? 190;
      const { x, w } = p.win.hit, c = x + w / 2, mid = (left + right) / 2, at = `${left}–${right} in ${lo}…${hi}`;
      assert.ok(w >= 44 && x >= 0 && x + w <= 190 && x <= Math.max(left, mid - 22) + 1e-9 && x + w >= Math.min(right, mid + 22) - 1e-9, `a 44 px target over the window for ${at}`);
      assert.ok(p.from.x + p.from.w <= c - 22 + 1e-9 && p.to.x >= c + 22 - 1e-9, `no handle covers the target's middle 44 px for ${at}`);
      assert.ok(p.from.x >= lo && p.to.x + p.to.w <= hi + 1e-9 && p.from.w <= 44 && p.to.w <= 44, `handles inside the room for ${at}`);
      assert.ok(p.from.gx >= p.from.x && p.from.gx <= p.from.x + p.from.w && p.to.gx >= p.to.x && p.to.gx <= p.to.x + p.to.w, `each grip in its own box for ${at}`);
      if (room.lo !== undefined) assert.ok(p.from.w >= 24 && p.to.w >= 24, `with room beside the track both handles stay reachable for ${at}`);
    }
  }
  const wide = overviewTargets({ width: 190, left: 0, right: 190, hit: 44 });
  assert.deepEqual([wide.from.x, wide.to.x], [0, 146], 'a full window keeps its handles at the strip ends');
  assert.deepEqual(overviewTargets({ width: 30, left: 10, right: 12, hit: 16 }).win.hit, { x: 0, w: 30 }, 'a strip narrower than a finger is all target');
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

test('JOED-145 input: diagonal noise keeps a gesture’s meaning until the wheel rests; a plain wheel more vertical than sideways is always the page’s', () => {
  let latch = createWheelLatch(200);
  assert.equal(latch({ deltaX: 30, deltaY: 2 }, 0), 'pan');
  assert.equal(latch({ deltaX: 6, deltaY: 6 }, 8), 'pan', 'a sideways swipe wobbling diagonally keeps panning');
  assert.equal(latch({ deltaX: 1, deltaY: 12 }, 16), 'page', 'a wheel more vertical than sideways is the page’s at once, even mid-pan');
  assert.equal(latch({ deltaY: 100 }, 24), 'page', 'a plain vertical wheel right after a sideways pan scrolls the page');
  assert.equal(latch({ deltaX: 5, deltaY: 4 }, 30), 'page', 'and diagonal noise after it stays with the page');
  assert.equal(latch({ deltaY: 4, ctrlKey: true }, 32), 'zoom', 'a pinch takes over at once');
  assert.equal(latch({ deltaY: 8 }, 48), 'page', 'and stops the moment the modifier is gone');
  assert.equal(latch({ deltaX: 50, deltaY: 1 }, 64), 'page', 'a page scroll drifting sideways never starts panning');
  assert.equal(latch({ deltaX: 50, deltaY: 1 }, 300), 'pan', 'after a rest a new gesture decides again');
  for (const before of [{ deltaX: 40 }, { deltaX: -40, deltaY: -40 }, { deltaY: 10, shiftKey: true }, { deltaY: -3, ctrlKey: true }]) {
    latch = createWheelLatch(200);
    latch(before, 0);
    for (const e of [{ deltaY: 1 }, { deltaX: 3, deltaY: 4 }, { deltaX: -9, deltaY: -40 }]) assert.equal(latch(e, 10), 'page', `${JSON.stringify(e)} 10 ms after ${JSON.stringify(before)}`);
  }
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

test('JOED-145 axis: on the Vienna spring-forward day every tick is its own instant, in order, one step of real time apart', () => {
  // Sun 28 Mar 2027: at 02:00 the clocks jump to 03:00.
  const from = Date.parse('2027-03-27T22:00:00.000Z'), to = Date.parse('2027-03-28T03:00:00.000Z');
  for (const step of [5, 10, 15, 30]) {
    const ticks = wallTicks(from, to, step), at = ticks.map(t => t.at), labels = ticks.map(t => timeHM(new Date(t.at).toISOString()));
    assert.equal(at.length, 5 * 60 / step + 1, `${step} min: every step from 23:00 to 05:00`);
    assert.ok(at.every((x, i) => !i || x - at[i - 1] === step * MIN), `${step} min: each tick one step after the one before`);
    assert.equal(new Set(labels).size, labels.length, `${step} min: no label twice`);
    assert.ok(!labels.some(l => l.startsWith('02:')), `${step} min: no tick in the hour that does not exist`);
    assert.deepEqual(ticks.filter(t => t.midnight).map(t => t.at), [Date.parse('2027-03-27T23:00:00.000Z')], 'one midnight');
  }
  assert.deepEqual(wallTicks(from, to, 60).map(t => timeHM(new Date(t.at).toISOString())), ['23:00', '00:00', '01:00', '03:00', '04:00', '05:00'], 'hour steps stay on the clock');
  // Sun 25 Oct 2026: 02:00 to 03:00 comes twice; both are real time.
  const fall = wallTicks(Date.parse('2026-10-24T23:00:00.000Z'), Date.parse('2026-10-25T02:00:00.000Z'), 15).map(t => t.at);
  assert.ok(fall.length === 13 && fall.every((x, i) => !i || x - fall[i - 1] === 15 * MIN), 'autumn: both 02:00 hours, in order');
  const week = wallTicks(Date.parse('2027-03-24T00:00:00.000Z'), Date.parse('2027-03-31T00:00:00.000Z'), 180).map(t => t.at);
  assert.ok(week.every((x, i) => !i || x > week[i - 1]), 'a week across the change stays in order, nothing repeated');
});

test('JOED-145 axis: a Day view names both dates, the day it starts in at its left edge and the next at the midnight line', () => {
  // Wed 28 Oct 08:54 to Thu 29 Oct 08:54, Vienna time.
  const x0 = Date.parse('2026-10-28T07:54:00.000Z'), x1 = x0 + DAY, midnight = Date.parse('2026-10-28T23:00:00.000Z');
  for (const pw of [280, 520, 800, 1300]) {
    const labels = axisLabels(x0, x1, pw), px = l => (l.x - x0) / DAY * pw;
    assert.deepEqual([labels[0].text, labels[0].x], ['Wed 28', x0], `${pw} px: the first label is the day the window starts in`);
    assert.ok(labels.some(l => l.text === 'Thu 29' && l.x === midnight), `${pw} px: the midnight line carries its date`);
    assert.ok(labels.every((l, i) => !i || px(l) - px(labels[i - 1]) >= 56 - 1e-9), `${pw} px: labels stay 56 px apart`);
  }
  const atMidnight = axisLabels(midnight, midnight + 6 * HOUR, 800);
  assert.deepEqual([atMidnight[0].text, atMidnight[0].x], ['Thu 29', midnight], 'a window starting at midnight has that date once');
  assert.equal(atMidnight.filter(l => l.text === 'Thu 29').length, 1);
});

test('JOED-145 compare: over part of the window the line names the stretch it uses; over all of it, both ends', () => {
  const at = (ms, j, joe, joel, basis = 'j.v2') => ({ t: new Date(ms).toISOString(), totals: {}, desks: {
    j: { money: { equity: j === null ? null : { amount: String(j), currency: 'EUR' } }, historyBasis: basis },
    joe: { money: { equity: { amount: String(joe), currency: 'EUR' } }, historyBasis: 'joe.v2' },
    joel: { money: { equity: { amount: String(joel), currency: 'EUR' } }, historyBasis: 'joel.v2' } } });
  const window = [K0, K0 + DAY], end = K0 + DAY, cut = K0 + 20 * HOUR + 38 * MIN;
  const rows = [];
  for (let m = 0; m < 20 * 60; m += 30) rows.push(at(K0 + m * MIN, 4900, 5100, 5000));
  rows.push(at(K0 + 20.5 * HOUR, null, 5100, 5000));
  for (let ms = cut; ms <= end; ms += 2 * MIN) rows.push(at(ms, ms === end ? 5010 : 5000, ms === end ? 4995 : 5000, 5000));
  const gap = compareLine(hm.toColumns(rows), window, end);
  assert.match(gap, /^Last 3.h.22.min with continuous data, from Wed 7.Oct, 22:38: J \+0,20.% · Joe −0,10.% · Joel 0,00.%$/, gap);
  const basis = compareLine(hm.toColumns(rows.map(r => (Date.parse(r.t) < cut ? { ...r, desks: { ...r.desks, j: { ...r.desks.j, historyBasis: 'j.v1' } } } : r)).filter(r => r.desks.j.money.equity)), window, end);
  assert.match(basis, /^Last 3.h.22.min on the current bookkeeping, from Wed 7.Oct, 22:38: J \+0,20.%/, basis);
  const whole = compareLine(hm.toColumns(rows.filter(r => Date.parse(r.t) >= cut)), window, end);
  assert.match(whole, /^From Wed 7.Oct, 22:38 to Thu 8.Oct, 02:00: J \+0,20.%/, whole);
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

// The producer's stream: rows every 30 s, every 900 s overnight (22:00 to
// 06:00 UTC, the scheduler's slowest regime) unless `night` is off, none
// inside an outage. Through the server's own compaction (server/history.mjs)
// a pass runs whenever the store holds more than `cap` rows, as boundHistory
// does at its size warning, and marks the newest row it thinned. Money moves
// a few cents every row, as on a trading day.
function stream({ days = 2, cap = Infinity, outages = [], night = true } = {}) {
  let seed = 7, points = [], thinnedThrough = null, passes = 0;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cents = { j: 500000, joe: 500000, joel: 500000 };
  for (let t = K0; t < K0 + days * DAY;) {
    if (!outages.some(([a, b]) => t >= a && t < b)) {
      for (const id of hm.DESK_IDS) cents[id] += Math.round((rand() - 0.5) * 40);
      points.push(row(t, Object.fromEntries(hm.DESK_IDS.map(id => [id, cents[id] / 100]))));
      if (points.length > cap) { points = compactPoints(points); thinnedThrough = Date.parse(points.at(-1).t); passes++; }
    }
    const hour = new Date(t).getUTCHours();
    t += night && (hour >= 22 || hour < 6) ? 900e3 : 30e3;
  }
  return { points, cols: hm.toColumns(points), thinnedThrough, passes, end: Date.parse(points.at(-1).t) };
}
const bandsOf = (cols, end) => hm.missingBands(hm.DESK_IDS.map(id => hm.continuitySeries(cols, id, 'all', end).gaps));
// Every interval longer than GAP_MS, as [from, to] times.
const gapsIn = points => points.flatMap((p, i) => (i && Date.parse(p.t) - Date.parse(points[i - 1].t) > GAP ? [[points[i - 1].t, p.t]] : []));
const steps = points => points.slice(1).map((p, i) => Date.parse(p.t) - Date.parse(points[i].t));

test('JOED-145 thinning: the server and the page share one GAP_MS, longer than the slowest normal cadence', () => {
  assert.equal(hm.GAP_MS, GAP);
  assert.ok(hm.GAP_MS > 900e3, 'the overnight 900-second regime is continuous reporting');
});

test('JOED-145 thinning: two nearby outages keep both bands through one compaction and every later one (the Codex gate’s case)', () => {
  // Flat 30-second rows on Wed 7 Oct; none from 06:00 to 09:00 and from 10:00 to 13:00 UTC.
  const outages = [[K0 + 6 * HOUR, K0 + 9 * HOUR], [K0 + 10 * HOUR, K0 + 13 * HOUR]];
  const raw = [];
  for (let t = K0; t < K0 + DAY; t += 30e3) if (!outages.some(([a, b]) => t >= a && t < b)) raw.push(row(t, { j: 5000, joe: 5000, joel: 5000 }));
  let points = raw;
  for (const pass of [1, 2, 3]) {
    points = compactPoints(points);
    assert.ok(points.length < raw.length / 10, `pass ${pass}: thinned to ${points.length} rows`);
    assert.deepEqual(bandsOf(hm.toColumns(points), Date.parse(points.at(-1).t)), outages.map(([a, b]) => [a - 30e3, b]),
      `pass ${pass}: each outage keeps its band, from the last row before it to the first after it`);
  }
});

test('JOED-145 thinning: a normally thinned 14-day store draws no band and no estimate, its 900-second nights included', () => {
  const store = stream({ days: 14, cap: 10000 });
  const thinned = steps(store.points).filter((_, i) => Date.parse(store.points[i + 1].t) <= store.thinnedThrough);
  assert.ok(store.passes >= 2 && Math.max(...thinned) > 10 * MIN, `thinned by ${store.passes} passes, up to ${Math.max(...thinned) / MIN} min between kept rows`);
  assert.ok(Math.max(...steps(store.points)) <= GAP, 'no kept interval is longer than GAP_MS');
  assert.deepEqual(bandsOf(store.cols, store.end), [], 'thinning and the night cadence draw no band');
  for (const id of hm.DESK_IDS) assert.deepEqual(hm.continuitySeries(store.cols, id, 'all', store.end).gaps, [], `${id}: no estimate either`);
  const all = hm.keptRange(store.cols, store.end), result = hm.sharedWindowCompare(store.cols, hm.DESK_IDS, all, store.end);
  assert.deepEqual([result.ok, result.after, result.startAt], [true, null, store.points[0].t], 'the comparison runs over all 14 days');
});

test('JOED-145 thinning: rows an older version thinned further apart than GAP_MS are no data, and their coverage is unknown', () => {
  // As versions before this rule left a store: rows 40 minutes apart up to the
  // mark at 06:00 UTC, raw 30-second rows after it with a 30-minute outage.
  const points = [];
  for (let m = 0; m <= 360; m += 40) points.push(row(K0 + m * MIN, { j: 5000 + m, joe: 5000, joel: 5000 }));
  for (let s = 361 * 60; s <= 420 * 60; s += 30) points.push(row(K0 + s * 1000, { j: 6000, joe: 5000, joel: 5000 }));
  for (let s = 450 * 60; s <= 460 * 60; s += 30) points.push(row(K0 + s * 1000, { j: 6001, joe: 5000, joel: 5000 }));
  const cols = hm.toColumns(points), end = K0 + 460 * MIN, thin = K0 + 360 * MIN;
  const legacy = Array.from({ length: 9 }, (_, k) => [K0 + 40 * k * MIN, K0 + 40 * (k + 1) * MIN]);
  assert.deepEqual(bandsOf(cols, end), [...legacy, [K0 + 420 * MIN, K0 + 450 * MIN]], 'every interval longer than GAP_MS is a no-data band, thinned or not');
  for (const [a, b] of legacy) assert.equal(hm.coverageUnknownAt(cols, (a + b) / 2, thin), true, `${new Date(a).toISOString()}: thinned or not reported`);
  for (const x of [K0, K0 + 40 * MIN, K0 + 360 * MIN, K0 + 390 * MIN, K0 + 435 * MIN]) {
    assert.equal(hm.coverageUnknownAt(cols, x, thin), false, `${new Date(x).toISOString()}: a kept row, raw rows or an outage after the mark`);
  }
  assert.equal(hm.coverageUnknownAt(cols, K0 + 20 * MIN, null), false, 'without the mark nothing was thinned');
  const near = hm.DESK_IDS.map(() => ({ v: 5010, estimated: true }));
  assert.match(historyPointDetails(near, K0 + 20 * MIN, hm.DESK_IDS, true).text, /estimated\nThinned or not reported: coverage unknown$/);
  assert.doesNotMatch(historyPointDetails(near, K0 + 435 * MIN, hm.DESK_IDS, false).text, /coverage/);
});

test('JOED-145 compare: never claims continuous data across a stretch without rows (the Codex gate’s case)', () => {
  const at = (ms, j) => ({ t: new Date(ms).toISOString(), totals: {}, desks: {
    j: { money: { equity: j === null ? null : { amount: String(j), currency: 'EUR' } } },
    joe: { money: { equity: { amount: '5000', currency: 'EUR' } } }, joel: { money: { equity: { amount: '5000', currency: 'EUR' } } } } });
  // An explicit null at 00:01, complete rows at 00:02 and 00:03, then none until 04:00 and 04:01 UTC.
  const rows = [at(K0 + MIN, null), at(K0 + 2 * MIN, 5000), at(K0 + 3 * MIN, 5010), at(K0 + 4 * HOUR, 5020), at(K0 + 4 * HOUR + MIN, 5030)];
  const cols = hm.toColumns(rows), end = K0 + 4 * HOUR + MIN, window = [K0, end];
  const result = hm.sharedWindowCompare(cols, hm.DESK_IDS, window, end);
  assert.deepEqual([result.startAt, result.endAt, result.after], [rows[3].t, rows[4].t, 'gap'], 'the stretch after the gap');
  const line = compareLine(cols, window, end);
  assert.match(line, /^Last 1.min with continuous data, from Wed 7.Oct, 06:00: J \+0,20.% · Joe 0,00.% · Joel 0,00.%$/, line);
  assert.deepEqual(bandsOf(cols, end), [[K0 + 3 * MIN, K0 + 4 * HOUR]], 'the chart hatches the same stretch');
  // The comparison is always the last stretch: one row after a gap is not one yet.
  const short = hm.toColumns(rows.slice(1, 4)), until = [K0, K0 + 4 * HOUR];
  assert.deepEqual(hm.sharedWindowCompare(short, hm.DESK_IDS, until, until[1]), { ok: false, reason: 'gap' });
  assert.equal(compareLine(short, until, until[1]), 'Comparing needs two moments with continuous data in this window.');
});

test('JOED-145 compaction: never across a gap, both ends of every run kept, every kept interval says what it is, pass after pass', () => {
  // A stretch of exactly GAP_MS between rows is continuous; 30 s more is a gap.
  const outages = [[2 * HOUR, 2 * HOUR + 19.5 * MIN], [3 * HOUR, 3 * HOUR + 20 * MIN], [9 * HOUR, 10 * HOUR], [DAY + 12 * HOUR, DAY + 17 * HOUR],
    [DAY + 21.5 * HOUR, DAY + 22.5 * HOUR]].map(([a, b]) => [K0 + a, K0 + b]);
  const raw = stream({ days: 3, outages, night: false }).points, gaps = gapsIn(raw);
  assert.deepEqual(gaps.map(([a, b]) => Date.parse(b) - Date.parse(a)), [20.5 * MIN, 60.5 * MIN, 300.5 * MIN, 60.5 * MIN], 'four gaps; the 20-minute stretch is not one');
  const ends = [raw[0], ...raw.filter((p, i) => gaps.some(([a, b]) => p.t === a || p.t === b)), raw.at(-1)];
  let points = raw;
  for (const pass of [1, 2, 3]) {
    const before = points;
    points = compactPoints(points);
    assert.ok(points.length < raw.length / 4 && points.every(p => before.includes(p)), `pass ${pass}: ${points.length} of the rows before it, unchanged`);
    assert.deepEqual(gapsIn(points), gaps, `pass ${pass}: exactly the gaps the stream had, none merged across, none made by thinning`);
    for (const p of ends) assert.ok(points.includes(p), `pass ${pass}: ${p.t} ends a run and is kept`);
    assert.ok(Math.max(...steps(points).filter(s => s <= GAP)) > 10 * MIN, `pass ${pass}: thinned rows are up to GAP_MS apart`);
    assert.deepEqual(bandsOf(hm.toColumns(points), Date.parse(points.at(-1).t)), gaps.map(([a, b]) => [Date.parse(a), Date.parse(b)]), `pass ${pass}: the page hatches exactly the gaps`);
  }
});

test('JOED-145 compaction: the size cap still holds, every gap kept', () => {
  // Rows with the longest bookkeeping note each desk may carry, 30 s apart
  // with two outages, until the store passes its size warning.
  const accounting = { periodStart: '2026-10-01T04:00:00.000Z', method: 'execution-fifo-net-current-fx', detail: 'é'.repeat(240) };
  const outages = [[K0 + 5 * HOUR, K0 + 6 * HOUR], [K0 + 20 * HOUR, K0 + 20 * HOUR + 25 * MIN]];
  const points = stream({ days: 2, outages, night: false }).points.slice(0, 4000);
  for (const p of points) for (const id of hm.DESK_IDS) p.desks[id] = { ...p.desks[id], accounting, historyBasis: `${id}.paper.v2` };
  const value = { schema: CONTRACTS.contracts.history, seq: 1, generatedAt: points.at(-1).t, receivedAt: points.at(-1).t, points, sizeBytes: 0 };
  const original = points.slice(), gaps = gapsIn(original);
  assert.ok(measureHistory(value) >= HISTORY_WARNING && gaps.length === 2, 'the store starts over its size warning, with both outages');
  boundHistory(value);
  assert.ok(value.sizeBytes < HISTORY_WARNING && value.points.length < original.length, `compacted to ${value.sizeBytes} bytes`);
  assert.equal(value.compactedThrough, original.at(-1).t);
  assert.equal(validateContract('history', value).ok, true, 'the contract is unchanged and still holds');
  assert.deepEqual(gapsIn(value.points), gaps, 'both gaps kept');
  assert.ok(value.points.every(p => original.includes(p)), 'kept rows are unchanged');
});
