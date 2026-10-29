// History's window controls in the real page (JOED-145): the overview strip
// (drag the window, resize its edges, click beside it, keys on its sliders),
// the presets and Follow, the chart's own input (⌘/Ctrl-wheel zoom at the
// pointer, a plain wheel scrolls the page, also right after a sideways pan,
// sideways wheel and drag pan, double-click fits, Shift with the arrows) and,
// on a phone, touch, the narrow Day window on the strip, 320 to 390 px widths
// and 44 px targets. No preset or desk switch moves anything, in Change or
// in Money. Follow with newer history arriving through the server is
// historyFollowGrowthChecks; the approved design (JOED-154: Change | Money,
// the address, Controls with the vertical axis, the first-visit hint, label
// spacing and the phone's one row) is historyDesignChecks.
// The page runs with reduced motion (configure), so every jump lands at once.
import { waitFor, load } from './shots.mjs';

const MOD = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
const CODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Tab: 9, Escape: 27, '+': 187, '-': 189, 0: 48 };
const KEY_CODE = { '+': 'Equal', '-': 'Minus', 0: 'Digit0' };
export async function press(page, key, modifiers = 0) {
  const text = key.length === 1 ? { text: key } : {};
  const base = { key, code: KEY_CODE[key] ?? key, windowsVirtualKeyCode: CODE[key], modifiers };
  await page.s('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...text });
  await page.s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// The drawn window, the kept range, the controls' state and the strip's boxes.
const STATE = `(() => {
  const svg = document.querySelector('#histChart > svg'), mini = document.getElementById('histMini'), win = document.getElementById('histWin');
  const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }; };
  return { x0: Number(svg.dataset.x0), x1: Number(svg.dataset.x1), k0: Number(mini.dataset.k0), k1: Number(mini.dataset.k1),
    label: svg.getAttribute('aria-label'), lines: svg.querySelectorAll('path[stroke^="var(--desk-"]').length,
    estimates: svg.querySelectorAll('[data-estimate]').length, gaps: svg.querySelectorAll('[data-gap]').length,
    follow: document.getElementById('histFollow').getAttribute('aria-pressed'),
    pressed: [...document.querySelectorAll('#histRange [aria-pressed="true"]')].map(b => b.dataset.range),
    chart: box(document.getElementById('histChart')), track: box(document.getElementById('histTrack')), win: box(win),
    from: box(mini.querySelector('[data-edge="from"]')), to: box(mini.querySelector('[data-edge="to"]')),
    slider: { role: win.getAttribute('role'), min: Number(win.getAttribute('aria-valuemin')), max: Number(win.getAttribute('aria-valuemax')),
      now: Number(win.getAttribute('aria-valuenow')), text: win.getAttribute('aria-valuetext') ?? '',
      from: Number(mini.querySelector('[data-edge="from"]').getAttribute('aria-valuenow')), to: Number(mini.querySelector('[data-edge="to"]').getAttribute('aria-valuenow')) },
    focused: document.activeElement?.id || document.activeElement?.dataset?.edge || null, live: document.getElementById('histLive').textContent,
    scrollY, scrollWidth: document.documentElement.scrollWidth, innerWidth };
})()`;
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

async function drag(page, from, to, { steps = 6, modifiers = 0 } = {}) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, modifiers });
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, modifiers });
  for (let i = 1; i <= steps; i++) {
    await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps, button: 'left', buttons: 1, modifiers });
  }
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1, modifiers });
}
async function wheel(page, at, { deltaX = 0, deltaY = 0, modifiers = 0 } = {}) {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX, deltaY, modifiers });
}
async function swipe(page, from, to, steps = 8) {
  await page.s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    await page.s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
  }
  await page.s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function historyControlChecks({ page, viewport, theme, check, settle, configure, rects, moves }) {
  const tag = `${viewport.name} ${theme} history controls`;
  const state = () => page.evaluate(STATE);
  const preset = async range => { await page.evaluate(`document.querySelector('#histRange [data-range="${range}"]').click()`); await settle(page); return state(); };
  const plot = (s, fraction) => ({ x: s.chart.left + 64 + (s.chart.width - 78) * fraction, y: s.chart.top + s.chart.height / 2 });
  const strip = (s, fraction) => ({ x: s.track.left + s.track.width * fraction, y: s.track.top + s.track.height / 2 });
  const away = async () => { await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 }); await page.evaluate('document.activeElement?.blur()'); await settle(page); };

  // Presets: Fit all is everything kept; Day and Week end at the newest time;
  // a Month longer than the kept history shows all of it, Month pressed.
  const all = await preset('all');
  const kept = all.k1 - all.k0;
  check('JOED-145', `${tag}: Fit all shows everything kept, following the newest`, near(all.x0, all.k0, 1000) && near(all.x1, all.k1, 1000) &&
    all.pressed.join() === 'all' && all.follow === 'true' && all.lines >= 3 && kept > 7 * DAY, all);
  const day = await preset('1d');
  check('JOED-145', `${tag}: Day shows the last day, following`, near(day.x1 - day.x0, DAY, 1000) && near(day.x1, day.k1, 1000) && day.pressed.join() === '1d' && day.follow === 'true' && day.lines >= 3, day);
  const month = await preset('1m');
  check('JOED-145', `${tag}: Month longer than the kept history shows all of it, Month pressed`, near(month.x0, month.k0, 1000) && near(month.x1, month.k1, 1000) &&
    month.pressed.join() === '1m' && /all kept history/.test(month.label), month);
  const week = await preset('1w');
  check('JOED-145', `${tag}: Week shows the last 7 days with the outage dashed and hatched once`, near(week.x1 - week.x0, 7 * DAY, 1000) && near(week.x1, week.k1, 1000) &&
    week.pressed.join() === '1w' && week.follow === 'true' && week.estimates >= 3 && week.gaps >= 1, week);
  check('JOED-145', `${tag}: the strip's window is a slider in step with the chart`, week.slider.role === 'slider' && near(week.slider.now, Math.round(week.x0 / MIN), 1) &&
    near(week.slider.min, Math.round(week.k0 / MIN), 1) && near(week.slider.max, Math.round((week.k1 - (week.x1 - week.x0)) / MIN), 1) &&
    near(week.slider.from, Math.round(week.x0 / MIN), 1) && near(week.slider.to, Math.round(week.x1 / MIN), 1) && /Vienna time.*of .* kept/.test(week.slider.text) &&
    near(week.win.left - week.track.left, (week.x0 - week.k0) / kept * week.track.width, 2) && near(week.win.width, (week.x1 - week.x0) / kept * week.track.width, 2), week);

  // No layout shift within a measure (JOED-154: Change and Money each keep
  // their own heights): presets and desk switches move nothing around them.
  const SHIFT = ['.hist-tools', '#histMeasure', '#histRange', '#histFollow', '#histFollowPhone', '.hcard', '#histChart', '#histCompare', '#histMini', '.hist-foot', '#histCtl', '.hist-help', '.hist-cols', 'footer.foot'];
  for (const measure of ['change', 'money']) {
    await page.evaluate(`document.querySelector('#histMeasure [data-measure="${measure}"]').click()`);
    await settle(page);
    const before = await rects(SHIFT), shifts = [];
    for (const step of ['[data-range="1d"]', '[data-range="all"]', '[data-range="1m"]', '[data-hdesk="j"]', '[data-hdesk="joel"]', '[data-hdesk="all"]', '[data-hdesk="all"]', '[data-hdesk="all"]', '[data-range="1w"]']) {
      await page.evaluate(`document.querySelector('.hist-tools ${step}').click()`);
      await settle(page);
      shifts.push(...moves(before, await rects(SHIFT)).map(m => ({ step, ...m })));
    }
    check('no-shift', `${tag}: in ${measure === 'change' ? 'Change' : 'Money'}, switching presets and desks moves nothing`, !shifts.length, shifts.slice(0, 6));
  }
  await page.evaluate(`document.querySelector('#histMeasure [data-measure="change"]').click()`);
  await settle(page);
  // One desk, all, none and all again: the checks below draw every desk.
  check('JOED-145', `${tag}: all three desks are chosen again`, await page.evaluate(`document.querySelector('.hist-tools [data-hdesk="all"]').getAttribute('aria-pressed')`) === 'true');

  if (!viewport.mobile) {
    // The strip: drag the window, drag each edge, click beside it to centre.
    let s = await preset('1w');
    const perPx = kept / s.track.width;
    // The week sits about 80 px from the strip's start at 1024 px, so 60 px stays inside.
    await drag(page, { x: s.win.left + s.win.width / 2, y: s.track.top + s.track.height / 2 }, { x: s.win.left + s.win.width / 2 - 60, y: s.track.top + s.track.height / 2 });
    await settle(page);
    let t = await state();
    check('JOED-145', `${tag}: dragging the strip's window 60 px left pans by 60 px of strip time, same width, Follow off`, near(s.x0 - t.x0, 60 * perPx, 3 * perPx) &&
      near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.follow === 'false' && /zoomed/.test(t.label), { s, t, perPx });
    s = t;
    await drag(page, { x: s.from.left + s.from.width / 2, y: s.track.top + s.track.height / 2 }, { x: s.from.left + s.from.width / 2 + 60, y: s.track.top + s.track.height / 2 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: dragging the start edge 60 px right narrows from the start only`, near(t.x0 - s.x0, 60 * perPx, 3 * perPx) && near(t.x1, s.x1, 1000), { s, t });
    s = t;
    await drag(page, { x: s.to.left + s.to.width / 2, y: s.track.top + s.track.height / 2 }, { x: s.to.left + s.to.width / 2 - 40, y: s.track.top + s.track.height / 2 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: dragging the end edge 40 px left narrows from the end only`, near(s.x1 - t.x1, 40 * perPx, 3 * perPx) && near(t.x0, s.x0, 1000), { s, t });
    s = t;
    const target = strip(s, 0.92);
    await drag(page, target, target, { steps: 1 });
    await settle(page);
    t = await state();
    const centre = s.k0 + (target.x - s.track.left) / s.track.width * kept, width = s.x1 - s.x0;
    const centred = Math.min(s.k1 - width / 2, Math.max(s.k0 + width / 2, centre));
    check('JOED-145', `${tag}: a click beside the window centres it there`, near((t.x0 + t.x1) / 2, centred, 2 * perPx) && near(t.x1 - t.x0, width, 1000), { s, t, centred });

    // Centring near the right edge clamps onto the newest time and already
    // turns Follow on. Park the window first: otherwise a click toggles it off.
    s = t;
    await drag(page, { x: s.win.left + s.win.width / 2, y: s.track.top + s.track.height / 2 }, { x: s.win.left + s.win.width / 2 - 60, y: s.track.top + s.track.height / 2 });
    await settle(page);
    s = await state();
    check('JOED-145', `${tag}: before resuming Follow, the window is parked earlier at the same width`, s.follow === 'false' && s.x1 < s.k1 && near(s.x1 - s.x0, width, 1000), s);
    // Follow: one click returns to the newest time with the same width.
    await page.evaluate(`document.getElementById('histFollow').click()`);
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Follow returns the window to the newest time, same width, pressed`, t.follow === 'true' && near(t.x1, t.k1, 1000) && near(t.x1 - t.x0, width, 1000), { s, t });

    // The chart: ⌘-wheel and Ctrl-wheel zoom around the pointer; a plain
    // vertical wheel scrolls the page; a sideways wheel and a drag pan.
    s = await preset('1w');
    for (const [name, modifiers] of [['⌘', MOD.Meta], ['Ctrl', MOD.Ctrl]]) {
      const at = plot(s, 0.3), anchor = s.x0 + 0.3 * (s.x1 - s.x0);
      await wheel(page, at, { deltaY: -100, modifiers });
      await settle(page);
      t = await state();
      const kept30 = t.x0 + 0.3 * (t.x1 - t.x0);
      check('JOED-145', `${tag}: ${name}-wheel zooms in around the pointer`, t.x1 - t.x0 < (s.x1 - s.x0) * 0.8 && near(kept30, anchor, (s.x1 - s.x0) / (s.chart.width - 78) * 2) &&
        t.follow === 'false' && /zoomed/.test(t.label), { s, t, anchor });
      s = await preset('1w');
    }
    await page.evaluate('window.scrollTo(0, 0)');
    s = await state();
    await wheel(page, plot(s, 0.5), { deltaY: 240 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: a plain vertical wheel over the chart scrolls the page and leaves the window alone`, t.scrollY > s.scrollY && t.x0 === s.x0 && t.x1 === s.x1, { before: s.scrollY, after: t.scrollY });
    await page.evaluate('window.scrollTo(0, 0)');
    await settle(page);
    await page.evaluate(`document.querySelector('#histRange [data-range="1d"]').click()`);
    // A wheel gesture keeps its meaning until the wheel rests for 200 ms.
    await new Promise(resolve => setTimeout(resolve, 260));
    await settle(page);
    s = await state();
    const chartPerPx = (s.x1 - s.x0) / (s.chart.width - 78);
    await wheel(page, plot(s, 0.5), { deltaX: -200 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: a sideways wheel (two-finger swipe) pans earlier by its distance, same width`, near(s.x0 - t.x0, 200 * chartPerPx, 3 * chartPerPx) && near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.follow === 'false', { s, t });
    // A plain vertical wheel straight after a sideways one, well inside the
    // 200 ms a gesture keeps its meaning, still belongs to the page.
    s = t;
    await wheel(page, plot(s, 0.5), { deltaX: -40 });
    await wheel(page, plot(s, 0.5), { deltaY: 240 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: a plain vertical wheel right after a sideways pan scrolls the page; the window moved only by the pan`, t.scrollY > s.scrollY &&
      near(s.x0 - t.x0, 40 * chartPerPx, 3 * chartPerPx) && near(t.x1 - t.x0, s.x1 - s.x0, 1000), { s, t, before: s.scrollY, after: t.scrollY });
    await page.evaluate('window.scrollTo(0, 0)');
    await settle(page);
    s = await state();
    await drag(page, plot(s, 0.5), { x: plot(s, 0.5).x + 120, y: plot(s, 0.5).y });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: dragging the chart 120 px right pans earlier by 120 px of time, no Shift needed`, near(s.x0 - t.x0, 120 * chartPerPx, 3 * chartPerPx) && near(t.x1 - t.x0, s.x1 - s.x0, 1000), { s, t });
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: plot(t, 0.5).x, y: plot(t, 0.5).y, button: 'left', clickCount: 1 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plot(t, 0.5).x, y: plot(t, 0.5).y, button: 'left', clickCount: 1 });
    await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: plot(t, 0.5).x, y: plot(t, 0.5).y, button: 'left', clickCount: 2 });
    await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: plot(t, 0.5).x, y: plot(t, 0.5).y, button: 'left', clickCount: 2 });
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: double-click shows everything kept`, near(t.x0, t.k0, 1000) && near(t.x1, t.k1, 1000) && t.pressed.join() === 'all' && t.follow === 'true', t);
    await drag(page, plot(t, 0.5), { x: plot(t, 0.5).x + 120, y: plot(t, 0.5).y });
    await settle(page);
    s = await state();
    check('JOED-145', `${tag}: with everything kept in view a drag moves nothing and leaves the cursor plain`, near(s.x0, t.x0, 1000) && near(s.x1, t.x1, 1000) && s.follow === 'true' &&
      !(await page.evaluate(`document.getElementById('histChart').matches('.pannable, .panning')`)), s);
    await away();

    // Keys on the strip: the window and both edges are sliders.
    s = await preset('1w');
    await page.evaluate(`document.getElementById('histWin').focus()`);
    await press(page, 'ArrowLeft');
    await settle(page);
    t = await state();
    const w = s.x1 - s.x0;
    check('JOED-145', `${tag}: Left on the strip's window moves it a tenth earlier and turns Follow off`, t.focused === 'histWin' && near(s.x0 - t.x0, w * 0.1, 1000) && near(t.x1 - t.x0, w, 1000) &&
      t.follow === 'false' && near(t.slider.now, Math.round(t.x0 / MIN), 1), { s, t });
    await press(page, 'ArrowLeft', MOD.Shift);
    await settle(page);
    const narrower = await state();
    check('JOED-145', `${tag}: Shift with Left makes the window narrower`, near(narrower.x1 - narrower.x0, w / 1.5, 1000), narrower);
    await press(page, 'End');
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: End on the window goes to the newest time and follows again`, near(t.x1, t.k1, 1000) && t.follow === 'true', t);
    await press(page, 'Home');
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Home on the window goes to the oldest kept time`, near(t.x0, t.k0, 1000) && t.follow === 'false', t);
    await page.evaluate(`document.querySelector('#histMini [data-edge="from"]').focus()`);
    s = await state();
    await press(page, 'ArrowRight');
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Right on the start edge moves only the start a tenth later`, t.focused === 'from' && near(t.x0 - s.x0, (s.x1 - s.x0) * 0.1, 1000) && near(t.x1, s.x1, 1000) &&
      near(t.slider.from, Math.round(t.x0 / MIN), 1), { s, t });

    // Keys on the chart: Left and Right still inspect; Shift moves the
    // window, plus and minus zoom, 0 shows everything.
    s = await preset('1w');
    await page.evaluate(`document.getElementById('histChart').focus()`);
    await press(page, 'ArrowLeft', MOD.Shift);
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Shift with Left on the chart moves the window a tenth earlier and says so`, near(s.x0 - t.x0, (s.x1 - s.x0) * 0.1, 1000) && /^Showing .* Vienna time/.test(t.live), { s, t });
    await press(page, '+');
    await settle(page);
    const zoomedIn = await state();
    await press(page, '-');
    await settle(page);
    const zoomedOut = await state();
    await press(page, '0');
    await settle(page);
    const fitted = await state();
    check('JOED-145', `${tag}: plus and minus zoom the chart, 0 shows everything kept`, near(zoomedIn.x1 - zoomedIn.x0, (t.x1 - t.x0) / 1.5, 1000) &&
      near(zoomedOut.x1 - zoomedOut.x0, t.x1 - t.x0, 1000) && near(fitted.x0, fitted.k0, 1000) && near(fitted.x1, fitted.k1, 1000), { t, zoomedIn, zoomedOut, fitted });
    await press(page, 'ArrowRight');
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Right still inspects history points while the window keys are in use`, /Vienna time/.test(t.live) && /observed|estimated|no value here/.test(t.live) &&
      near(t.x0, fitted.x0, 1000) && near(t.x1, fitted.x1, 1000), t);
    await press(page, 'Escape');
    await away();
    await preset('1w');
    return;
  }

  // Phone: a sideways swipe pans, a vertical one scrolls the page, a pinch
  // zooms; the strip and presets fit 320 to 390 px with 44 px targets.
  let s = await preset('1d');
  await page.evaluate('window.scrollTo(0, 0)');
  const mid = plot(s, 0.5);
  await swipe(page, { x: mid.x - 60, y: mid.y }, { x: mid.x + 60, y: mid.y });
  await settle(page);
  let t = await state();
  check('JOED-145', `${tag}: a sideways swipe on the chart pans earlier, same width`, t.x0 < s.x0 - (s.x1 - s.x0) * 0.05 && near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.follow === 'false', { s, t });
  s = t;
  await swipe(page, { x: mid.x, y: mid.y + 60 }, { x: mid.x + 4, y: mid.y - 120 });
  await settle(page);
  t = await state();
  check('JOED-145', `${tag}: a vertical swipe on the chart scrolls the page and leaves the window alone`, t.scrollY > s.scrollY && t.x0 === s.x0 && t.x1 === s.x1, { before: s.scrollY, after: t.scrollY });
  await page.evaluate('window.scrollTo(0, 0)');
  await settle(page);
  s = await preset('1w');
  await page.s('Input.synthesizePinchGesture', { x: plot(s, 0.5).x, y: plot(s, 0.5).y, scaleFactor: 2, relativeSpeed: 600, gestureSourceType: 'touch' });
  await settle(page);
  t = await state();
  check('JOED-145', `${tag}: a pinch zooms the chart in`, t.x1 - t.x0 < (s.x1 - s.x0) * 0.8 && t.lines >= 3, { s, t });
  // The pinch's fingers lift beyond the chart (they spread past its top and
  // bottom): the chart still ends that gesture, so the next swipe pans.
  s = t;
  const after = plot(s, 0.5);
  await swipe(page, { x: after.x - 60, y: after.y }, { x: after.x + 60, y: after.y });
  await settle(page);
  t = await state();
  check('JOED-145', `${tag}: after a pinch whose fingers lift beyond the chart, a sideways swipe still pans`, t.x0 < s.x0 - (s.x1 - s.x0) * 0.05 &&
    near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.follow === 'false', { s, t });
  // Day on the strip is narrower than a finger: the point at the window's
  // centre is the window itself, not an edge handle, and dragging it pans.
  // The strip comes on screen first, as a reader scrolls to it: at the top
  // of the page it lies under the bottom bar or past the screen's edge.
  await preset('1d');
  await page.evaluate(`document.getElementById('histMini').scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await settle(page);
  s = await state();
  const centre = { x: s.win.left + s.win.width / 2, y: s.track.top + s.track.height / 2 };
  const hit = await page.evaluate(`(() => { const el = document.elementFromPoint(${centre.x}, ${centre.y}); return { id: el?.id ?? null, edge: el?.closest('[data-edge]')?.dataset.edge ?? null }; })()`);
  await swipe(page, centre, { x: centre.x - 40, y: centre.y });
  await settle(page);
  t = await state();
  const stripPerPx = (s.k1 - s.k0) / s.track.width;
  check('JOED-145', `${tag}: on Day the strip's narrow window is the target at its centre, and dragging it 40 px pans by 40 px of strip time`, s.win.width < 44 &&
    hit.id === 'histWin' && hit.edge === null && near(s.x0 - t.x0, 40 * stripPerPx, 4 * stripPerPx) && near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.follow === 'false', { s, t, hit, centre });
  await preset('1w');
  for (const width of [320, 360, 390]) {
    await configure(page, { ...viewport, name: String(width), width }, theme);
    await settle(page);
    const fit = await page.evaluate(`(() => {
      const r = el => el.getBoundingClientRect(), inside = el => r(el).left >= -0.5 && r(el).right <= document.documentElement.clientWidth + 0.5;
      // Follow is the copy this width shows (index.html: one before Change | Money on a phone).
      const targets = [...document.querySelectorAll('#histMeasure button, #histRange button, [data-follow], #histCtl, #histMini [data-edge]')].filter(el => el.getClientRects().length).map(el => ({ id: el.dataset.measure ?? el.dataset.range ?? el.dataset.edge ?? el.id, w: r(el).width, h: r(el).height, inside: inside(el) }));
      const win = document.getElementById('histWin'), after = getComputedStyle(win, '::after'), inset = k => parseFloat(after[k]) || 0;
      return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, targets,
        win: { w: r(win).width - inset('left') - inset('right'), h: r(win).height - inset('top') - inset('bottom') }, strip: inside(document.getElementById('histMini')) };
    })()`);
    check('JOED-145', `${tag} at ${width} px: no horizontal page scroll; Change | Money, presets, Follow, Controls and the strip fit with 44 px targets`, fit.scroll <= fit.client && fit.strip &&
      fit.targets.every(x => x.inside && x.w >= 43.5 && x.h >= 43.5) && fit.win.w >= 43.5 && fit.win.h >= 43.5, fit);
  }
  await configure(page, viewport, theme);
  await settle(page);
}

// Whether the strip draws an observation at `when` (ms): J's line there
// reaches `when`'s place on the strip, within a pixel and a half.
const arrived = when => `(() => { const mini = document.getElementById('histMini'), svg = document.querySelector('#histMiniPlot svg');
  const d = svg?.querySelector('path[stroke="var(--desk-j)"]')?.getAttribute('d') ?? '', end = d.match(/([\\d.]+) [\\d.-]+$/);
  const k0 = Number(mini.dataset.k0), k1 = Number(mini.dataset.k1), w = Number(svg?.getAttribute('width'));
  return Boolean(end && k1 >= ${when} && Number(end[1]) >= (${when} - k0) / (k1 - k0) * w - 1.5); })()`;

// Follow while newer history arrives (JOED-145 r1). `grow` pushes a later
// observation through the real server and returns its time; the page then
// reads it. Following, the Day window moves to the new newest time; parked,
// it stays exactly where it is while the kept range and the strip grow.
export async function historyFollowGrowthChecks({ page, viewport, theme, check, settle, grow }) {
  const tag = `${viewport.name} ${theme} history follow`;
  const state = () => page.evaluate(STATE);
  const arrive = async () => {
    const when = await grow();
    await page.evaluate('window.__joedesk.refresh()');
    await waitFor(page, arrived(when));
    await settle(page);
    return when;
  };
  await page.evaluate(`document.querySelector('#histRange [data-range="1d"]').click()`);
  await settle(page);
  let s = await state(), when = await arrive(), t = await state();
  check('JOED-145', `${tag}: following, a later observation moves the Day window to the new newest time, same width`, s.follow === 'true' && t.follow === 'true' &&
    t.k1 >= when && t.x1 > s.x1 + HOUR && near(t.x1, t.k1, 1000) && near(t.x1 - t.x0, s.x1 - s.x0, 1000) && t.pressed.join() === '1d', { s, t, when });
  await page.evaluate(`document.getElementById('histFollow').click()`);
  await settle(page);
  s = await state();
  when = await arrive();
  t = await state();
  const scale = (s.k1 - s.k0) / (t.k1 - t.k0);
  check('JOED-145', `${tag}: parked, the window stays where it is while the kept range and the strip grow`, s.follow === 'false' && t.follow === 'false' &&
    t.x0 === s.x0 && t.x1 === s.x1 && t.k1 >= when && t.k1 > s.k1 + HOUR && t.win.left < s.win.left - 1 && near(t.win.width, s.win.width * scale, 1), { s, t, when });
  await page.evaluate(`document.getElementById('histFollow').click()`);
  await settle(page);
  t = await state();
  check('JOED-145', `${tag}: Follow on again takes the window to the new newest time, same width`, t.follow === 'true' && near(t.x1, t.k1, 1000) && near(t.x1 - t.x0, s.x1 - s.x0, 1000), t);
}

// ---------- JOED-154: the approved History design ----------
const AXES_KEY = 'joe-board-chart-axes-v1', HINT_KEY = 'joe-board-chart-hint-v1';
const DESIGN = `(() => {
  const svg = document.querySelector('#histChart > svg'), pressed = sel => [...document.querySelectorAll(sel)].filter(b => b.getAttribute('aria-pressed') === 'true');
  const pop = document.getElementById('histControls'), hint = document.getElementById('histHint');
  return { measure: svg?.dataset.measure ?? null, axis: svg?.dataset.axis ?? null, zero: Boolean(svg?.hasAttribute('data-zero')), ylo: Number(svg?.dataset.ylo), yhi: Number(svg?.dataset.yhi),
    x0: Number(svg?.dataset.x0), x1: Number(svg?.dataset.x1), hash: location.hash, compare: document.getElementById('histCompare').textContent.trim(),
    arrows: document.querySelectorAll('#histCompare use[href="#i-arrow"]').length, sub: document.getElementById('histSub').textContent,
    pressedMeasure: pressed('#histMeasure [data-measure]').map(b => b.dataset.measure), pressedRange: pressed('#histRange [data-range]').map(b => b.dataset.range),
    pressedDesks: pressed('#histDesks [data-hdesk]').map(b => b.dataset.hdesk), pressedAxis: pressed('#histAxis [data-axis]').map(b => b.dataset.axis),
    open: !pop.hidden, expanded: document.getElementById('histCtl').getAttribute('aria-expanded'), focused: document.activeElement?.id ?? null,
    form: !document.getElementById('histAxisForm').hidden, min: document.getElementById('histAxisMin').value, max: document.getElementById('histAxisMax').value,
    error: document.getElementById('histAxisError').textContent, invalid: document.getElementById('histAxisMin').getAttribute('aria-invalid'),
    hint: { seen: hint.hasAttribute('data-seen'), visibility: getComputedStyle(hint).visibility, text: hint.innerText.trim() },
    saved: (() => { try { return localStorage.getItem('${AXES_KEY}'); } catch { return 'unavailable'; } })(), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
})()`;
// Each desk's solid line where it crosses the plot's left edge (x = 64), and
// the zero line's height: in Change every line starts on it.
const STARTS = `(() => {
  const svg = document.querySelector('#histChart > svg'), zero = svg.querySelector('line[stroke-width="1.2"]');
  const at = (d, x) => { const p = (d.match(/[ML]-?[\\d.]+ -?[\\d.]+/g) ?? []).map(s => s.slice(1).split(' ').map(Number));
    for (let i = 1; i < p.length; i++) if (p[i - 1][0] <= x && p[i][0] >= x) return p[i][0] === p[i - 1][0] ? p[i][1] : p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
    return null; };
  return { zeroY: zero ? Number(zero.getAttribute('y1')) : null, starts: [...svg.querySelectorAll('path[stroke^="var(--desk-"]')].map(p => ({ desk: p.getAttribute('stroke'), y: at(p.getAttribute('d'), 64) })) };
})()`;
// Distances between neighbouring labels: money on the left, time along the
// bottom, days on the strip.
const LABELS = `(() => {
  const svg = document.querySelector('#histChart > svg'), H = svg.viewBox.baseVal.height;
  const y = [...svg.querySelectorAll('text[text-anchor="end"]')].filter(t => Number(t.getAttribute('x')) < 64).map(t => Number(t.getAttribute('y')));
  const x = [...svg.querySelectorAll('text[text-anchor="start"]')].filter(t => Math.abs(Number(t.getAttribute('y')) - (H - 6)) < 0.5).map(t => Number(t.getAttribute('x')));
  const strip = [...document.querySelectorAll('#histMiniPlot text')].map(t => Number(t.getAttribute('x')));
  const sorted = list => list.slice().sort((a, b) => a - b), apart = list => sorted(list).slice(1).map((v, i) => v - sorted(list)[i]);
  return { y: apart(y), x: apart(x), strip: apart(strip), counts: [y.length, x.length, strip.length] };
})()`;
const ROWS = `(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { desks: r('histDesks').top, follow: r('histFollowPhone').top, wideFollow: r('histFollow').width, measure: r('histMeasure').top, range: r('histRange').top, chart: r('histChart').top }; })()`;
// The History tools as the eye reads them (row by row, then left to right)
// and the one Tab is on; the key names a control by what it does.
const TOOL_KEY = `el => !el ? null : el.dataset.hdesk ? 'desk:' + el.dataset.hdesk : el.dataset.measure ? 'show:' + el.dataset.measure : el.dataset.range ? 'range:' + el.dataset.range : el.id`;
const TOOLS = `(() => {
  const key = ${TOOL_KEY}, list = [...document.querySelectorAll('.hist-tools button')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const boxes = list.map(el => ({ key: key(el), top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left })).sort((a, b) => a.top - b.top);
  let row = 0, rowTop = boxes[0]?.top ?? 0;
  for (const b of boxes) { if (b.top - rowTop > 12) { row++; rowTop = b.top; } b.row = row; }
  return { visual: boxes.sort((a, b) => a.row - b.row || a.left - b.left).map(b => b.key), rows: row + 1, first: key(list[0]) };
})()`;
const FOCUSED_TOOL = `(${TOOL_KEY})(document.activeElement?.closest('.hist-tools') ? document.activeElement : null)`;

export async function historyDesignChecks({ page, viewport, theme, check, settle, rects, moves }) {
  const tag = `${viewport.name} ${theme} history design`;
  const state = () => page.evaluate(DESIGN), view = () => page.evaluate(STATE);
  const click = async selector => { await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(page); return state(); };
  const plot = (s, fraction) => ({ x: s.chart.left + 64 + (s.chart.width - 78) * fraction, y: s.chart.top + s.chart.height / 2 });
  const base = await page.evaluate('location.origin + location.pathname');
  const pan = async () => {
    const s = await view(), at = plot(s, 0.5);
    if (viewport.mobile) await swipe(page, { x: at.x - 50, y: at.y }, { x: at.x + 50, y: at.y });
    else await wheel(page, at, { deltaX: -160 });
    await settle(page);
  };
  await page.evaluate('window.scrollTo(0, 0)');

  // Change is the default: every desk starts at 0 on the zero line at the
  // left edge, the comparison is in euros of change, the address says so.
  let s = await click('#histRange [data-range="1d"]');
  const starts = await page.evaluate(STARTS);
  check('JOED-154', `${tag}: History opens in Change; every desk's line starts at 0 on the zero line at the left edge`, s.measure === 'change' && s.pressedMeasure.join() === 'change' && s.zero &&
    s.ylo <= 0 && s.yhi >= 0 && starts.zeroY !== null && starts.starts.length >= 3 && starts.starts.every(p => p.y !== null && Math.abs(p.y - starts.zeroY) <= 1) &&
    /^Each desk’s change in € since the start of the view/.test(s.sub), { s, starts });
  check('JOED-154', `${tag}: Change compares in signed euros and the address names the view`, /^Change (from|in the last) .*: J [+−]?€\s?\d/.test(s.compare) && !s.arrows &&
    s.hash === '#history?range=day&desk=all&mode=change', s);
  // Money: the money as observed, no zero line, the comparison from one amount to the next.
  s = await click('#histMeasure [data-measure="money"]');
  check('JOED-154', `${tag}: Money draws the money, compares start and end with an arrow, and the address follows`, s.measure === 'money' && s.pressedMeasure.join() === 'money' && !s.zero &&
    s.ylo > 1000 && /^(From|Last) .*: J €\s?[\d.]+,\d\d to €\s?[\d.]+,\d\d/.test(s.compare) && s.arrows >= 3 && s.hash === '#history?range=day&desk=all&mode=money' &&
    /^Each desk’s money as observed/.test(s.sub), s);
  s = await click('#histMeasure [data-measure="change"]');

  // Labels keep at least 56 px apart on every axis, at this width, for every preset.
  const spacing = [];
  for (const range of ['1d', '1w', 'all']) {
    await click(`#histRange [data-range="${range}"]`);
    const l = await page.evaluate(LABELS);
    spacing.push({ range, ...l });
  }
  check('JOED-154', `${tag}: money, time and strip labels stay at least 56 px apart (Day, Week, Fit all)`, spacing.every(l => l.counts[0] >= 2 && l.counts[1] >= 1 &&
    [...l.y, ...l.x, ...l.strip].every(d => d >= 55.8)), spacing);

  // The phone: Change | Money and the presets share one row under the desks.
  if (viewport.mobile) {
    const rows = await page.evaluate(ROWS);
    check('JOED-154', `${tag}: on a phone Change | Money and the presets share one row, under the desks and Follow`, Math.abs(rows.measure - rows.range) <= 0.5 &&
      rows.measure > rows.desks + 20 && Math.abs(rows.follow - rows.desks) <= 8 && rows.wideFollow === 0 && rows.chart > rows.range, rows);
  }
  // Tab walks the tools in the order the eye reads them, row by row.
  const tools = await page.evaluate(TOOLS), walked = [];
  await page.evaluate(`document.querySelector('.hist-tools button').focus()`);
  walked.push(await page.evaluate(FOCUSED_TOOL));
  for (let i = 1; i < tools.visual.length; i++) { await press(page, 'Tab'); walked.push(await page.evaluate(FOCUSED_TOOL)); }
  check('JOED-154', `${tag}: Tab walks Desks, Follow, Change | Money and the presets in the order they are seen`, walked.join() === tools.visual.join() &&
    tools.visual.includes('show:change') && tools.visual.filter(k => /^histFollow/.test(k)).length === 1 && (!viewport.mobile || tools.visual.indexOf('histFollowPhone') < tools.visual.indexOf('show:change')), { walked, visual: tools.visual, rows: tools.rows });
  await page.evaluate('document.activeElement?.blur()');

  // Controls: the button opens the keys and the axis; Escape closes and
  // gives focus back, so does a click outside; nothing widens the page.
  await click('#histRange [data-range="1d"]');
  await page.evaluate(`document.getElementById('histCtl').focus()`);
  s = await click('#histCtl');
  check('JOED-154', `${tag}: Controls opens its list and the vertical axis, inside the page`, s.open && s.expanded === 'true' && s.pressedAxis.join() === 'auto' && !s.form && s.scrollWidth <= s.clientWidth, s);
  await press(page, 'Escape');
  await settle(page);
  s = await state();
  check('JOED-154', `${tag}: Escape closes Controls and returns focus to its button`, !s.open && s.expanded === 'false' && s.focused === 'histCtl', s);
  await click('#histCtl');
  await page.s('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 });
  await page.s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 });
  await settle(page);
  s = await state();
  check('JOED-154', `${tag}: a click outside closes Controls`, !s.open && s.expanded === 'false', s);

  // The vertical axis. Max holds all kept history, so moving never rescales
  // (Controls closed first: on a phone it covers the chart).
  await click('#histCtl');
  s = await click('#histAxis [data-axis="max"]');
  await press(page, 'Escape');
  await settle(page);
  const held = await view();
  await pan();
  const moved = await state();
  check('JOED-154', `${tag}: Max holds the axis while the window moves`, s.axis === 'max' && s.pressedAxis.join() === 'max' && moved.axis === 'max' && moved.x0 < held.x0 &&
    moved.ylo === s.ylo && moved.yhi === s.yhi, { s, moved });
  // Custom starts from the axis on screen and takes the reader's bounds; a
  // bound that cannot be read is refused with a reason and changes nothing.
  await click('#histCtl');
  s = await click('#histAxis [data-axis="custom"]');
  check('JOED-154', `${tag}: Custom starts from the axis on screen`, s.axis === 'custom' && s.form && s.min !== '' && s.max !== '' && s.ylo === Number(s.min.replace('−', '-').replace(',', '.')) &&
    s.yhi === Number(s.max.replace('−', '-').replace(',', '.')), s);
  const submit = async (min, max) => { await page.evaluate(`(() => { document.getElementById('histAxisMin').value = ${JSON.stringify(min)}; document.getElementById('histAxisMax').value = ${JSON.stringify(max)}; document.getElementById('histAxisForm').requestSubmit(); })()`); await settle(page); return state(); };
  s = await submit('−12', '30,5');
  check('JOED-154', `${tag}: Custom draws exactly the reader's bottom and top, in euros of change`, s.axis === 'custom' && s.ylo === -12 && s.yhi === 30.5 && !s.error &&
    JSON.parse(s.saved ?? '{}')['history.change']?.max === 30.5, s);
  s = await submit('4.950', '30');
  check('JOED-154', `${tag}: an unreadable bound is refused with a reason, the axis unchanged`, s.ylo === -12 && s.yhi === 30.5 && s.invalid === 'true' && /without grouping/.test(s.error), s);
  await press(page, 'Escape');
  await settle(page);

  if (theme === 'light') {
    // A reload keeps the viewer's axis (per chart and measure) but not the window.
    await load(page, base, 'history');
    s = await state();
    check('JOED-154', `${tag}: the vertical axis is remembered in this browser`, s.measure === 'change' && s.axis === 'custom' && s.ylo === -12 && s.yhi === 30.5, s);
    // An address opens its view, also while History is shown.
    await load(page, base, 'history?range=day&desk=j,joel&mode=money');
    s = await state();
    check('JOED-154', `${tag}: #history?range=day&desk=j,joel&mode=money opens that view`, s.pressedRange.join() === '1d' && s.pressedDesks.join() === 'j,joel' && s.measure === 'money' &&
      s.axis === 'auto' && s.hash === '#history?range=day&desk=j,joel&mode=money', s);
    await page.evaluate(`location.hash = '#history?range=week&desk=all&mode=change'`);
    await waitFor(page, `document.querySelector('#histChart > svg')?.dataset.measure === 'change'`);
    await settle(page);
    s = await state();
    check('JOED-154', `${tag}: a new address on History applies at once`, s.pressedRange.join() === '1w' && s.pressedDesks.join() === 'j,joe,joel,all' && s.measure === 'change' && s.axis === 'custom', s);
    // The first-visit hint: shown until the first drag or swipe, then never again; its room stays.
    await page.evaluate(`localStorage.removeItem('${HINT_KEY}')`);
    await load(page, base, 'history');
    s = await state();
    const words = viewport.mobile ? /^Swipe · pinch · double-tap$/ : /^Drag or swipe to move · ⌘\/Ctrl-scroll or pinch to zoom$/;
    check('JOED-154', `${tag}: the first visit shows the hint`, !s.hint.seen && s.hint.visibility === 'visible' && words.test(s.hint.text.replace(/\u00a0/g, ' ')), s.hint);
    const FOOT = ['.hist-foot', '#histCtl', '.hist-help', '.hist-cols'];
    await click('#histRange [data-range="1d"]');
    const before = await rects(FOOT);
    await pan();
    s = await state();
    check('JOED-154', `${tag}: the first drag or swipe retires the hint, and nothing moves`, s.hint.seen && s.hint.visibility === 'hidden' && !moves(before, await rects(FOOT)).length, { hint: s.hint, moved: moves(before, await rects(FOOT)) });
    await load(page, base, 'history');
    s = await state();
    check('JOED-154', `${tag}: once retired the hint stays away after a reload`, s.hint.seen && s.hint.visibility === 'hidden', s.hint);
  }
  // Back to Auto: the default is not stored.
  await click('#histCtl');
  s = await click('#histAxis [data-axis="auto"]');
  check('JOED-154', `${tag}: Auto again re-fits and forgets the stored choice`, s.axis === 'auto' && !JSON.parse(s.saved ?? '{}')['history.change'], s);
  await press(page, 'Escape');
  await click('#histRange [data-range="1w"]');
  await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  await settle(page);
}
