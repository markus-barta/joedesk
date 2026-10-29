// History's window controls in the real page (JOED-145): the overview strip
// (drag the window, resize its edges, click beside it, keys on its sliders),
// the presets and Follow, the chart's own input (⌘/Ctrl-wheel zoom at the
// pointer, a plain wheel scrolls the page, sideways wheel and drag pan,
// double-click fits, Shift with the arrows) and, on a phone, touch, 320 to
// 390 px widths and 44 px targets. No preset or desk switch moves anything.
// The page runs with reduced motion (configure), so every jump lands at once.

const MOD = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
const CODE = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, '+': 187, '-': 189, 0: 48 };
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
const MIN = 60e3, DAY = 864e5;
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

  // No layout shift: presets and desk switches move nothing around them.
  const SHIFT = ['.hist-tools', '#histRange', '#histFollow', '.hcard', '#histChart', '#histCompare', '#histMini', '.hist-help', '.hist-cols', 'footer.foot'];
  const before = await rects(SHIFT), shifts = [];
  for (const step of ['[data-range="1d"]', '[data-range="all"]', '[data-range="1m"]', '[data-hdesk="j"]', '[data-hdesk="joel"]', '[data-hdesk="all"]', '[data-hdesk="all"]', '[data-hdesk="all"]', '[data-range="1w"]']) {
    await page.evaluate(`document.querySelector('.hist-tools ${step}').click()`);
    await settle(page);
    shifts.push(...moves(before, await rects(SHIFT)).map(m => ({ step, ...m })));
  }
  check('no-shift', `${tag}: switching presets and desks moves nothing`, !shifts.length, shifts.slice(0, 6));
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

    // Follow: one click returns to the newest time with the same width.
    await page.evaluate(`document.getElementById('histFollow').click()`);
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Follow returns the window to the newest time, same width, pressed`, t.follow === 'true' && near(t.x1, t.k1, 1000) && near(t.x1 - t.x0, width, 1000), t);
    await page.evaluate(`document.getElementById('histFollow').click()`);
    await settle(page);
    const frozen = await state();
    await page.evaluate('window.__joedesk.refresh()');
    await new Promise(resolve => setTimeout(resolve, 400));
    await settle(page);
    t = await state();
    check('JOED-145', `${tag}: Follow off keeps the window where it is while newer history arrives`, frozen.follow === 'false' && t.follow === 'false' && t.x0 === frozen.x0 && t.x1 === frozen.x1, { frozen, t });

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
    s = t;
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
  await preset('1w');
  for (const width of [320, 360, 390]) {
    await configure(page, { ...viewport, name: String(width), width }, theme);
    await settle(page);
    const fit = await page.evaluate(`(() => {
      const r = el => el.getBoundingClientRect(), inside = el => r(el).left >= -0.5 && r(el).right <= document.documentElement.clientWidth + 0.5;
      const targets = [...document.querySelectorAll('#histRange button, #histFollow, #histMini [data-edge]')].map(el => ({ id: el.dataset.range ?? el.dataset.edge ?? el.id, w: r(el).width, h: r(el).height, inside: inside(el) }));
      const win = document.getElementById('histWin'), after = getComputedStyle(win, '::after'), inset = k => parseFloat(after[k]) || 0;
      return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, targets,
        win: { w: r(win).width - inset('left') - inset('right'), h: r(win).height - inset('top') - inset('bottom') }, strip: inside(document.getElementById('histMini')) };
    })()`);
    check('JOED-145', `${tag} at ${width} px: no horizontal page scroll; presets, Follow and the strip fit with 44 px targets`, fit.scroll <= fit.client && fit.strip &&
      fit.targets.every(x => x.inside && x.w >= 43.5 && x.h >= 43.5) && fit.win.w >= 43.5 && fit.win.h >= 43.5, fit);
  }
  await configure(page, viewport, theme);
  await settle(page);
}
