import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { focusTermTips } from '../scripts/browser/term-focus.mjs';
import { afterStableLayout } from '../scripts/browser/settled-layout.mjs';

// Run the exact serialized page helper with scripted frames; no browser or
// real sleeps. Focus itself leaves the previous tip visible until a frame.
function termPage({ count = 1, onFrame, pageFocused = true } = {}) {
  let frame = 0, head = 'Emergency stop', open = true;
  const focused = [];
  const tip = { id: 'tip', classList: { contains: () => open }, querySelector: () => ({ textContent: head }) };
  const document = { activeElement: null, hasFocus: () => pageFocused, getElementById: id => id === tip.id ? tip : null,
    querySelectorAll: () => terms };
  const makeTerm = () => ({ dataset: { term: 'datafrom' }, isConnected: true, attrs: {},
    getAttribute(key) { return this.attrs[key] ?? null; },
    focus() { document.activeElement = this; focused.push(this); },
    blur() { if (document.activeElement === this) document.activeElement = null; },
  });
  const terms = Array.from({ length: count }, makeTerm);
  const ready = () => {
    head = 'Data from'; open = true;
    Object.assign(document.activeElement.attrs, { 'aria-expanded': 'true', 'aria-describedby': 'other-help tip' });
  };
  const context = { document, __audit: { visible: t => t.isConnected }, Date: { now: () => frame * 500 },
    requestAnimationFrame: done => { frame++; onFrame?.({ frame, document, terms, ready, makeTerm, setHead: value => { head = value; } }); done(); } };
  return { terms, focused, get frame() { return frame; },
    run: () => runInNewContext(`(${focusTermTips.toString()})('', { datafrom: 'Data from' })`, context).then(structuredClone) };
}

test('term focus waits past the previous tip, expansion and accessible tip ownership before reading', async () => {
  const page = termPage({ onFrame: ({ frame, document, ready, setHead }) => {
    if (frame === 1) ready();
    if (frame === 1) { setHead('Emergency stop'); delete document.activeElement.attrs['aria-expanded']; }
    if (frame === 2) { ready(); document.activeElement.attrs['aria-describedby'] = 'other-help'; }
    if (frame === 3) ready();
  } });
  const [seen] = await page.run();
  assert.deepEqual(seen.failed, []);
  assert.equal(seen.head, 'Data from');
  assert.equal(seen.expanded, 'true');
  assert.equal(seen.describedBy, 'other-help tip');
  assert.equal(page.frame, 3);
  assert.equal(page.focused.length, 1, 'observing state never replays focus on the same node');
});

test('term focus retains duplicate identities and reacquires a term replaced before its tip settles', async () => {
  const page = termPage({ count: 2, onFrame: ({ frame, terms, ready, makeTerm }) => {
    if (frame === 1) { terms[0].isConnected = false; terms[0] = makeTerm(); }
    else ready();
  } });
  const seen = await page.run();
  assert.deepEqual(seen.map(t => t.index), [0, 1]);
  assert.ok(seen.every(t => !t.failed.length));
  assert.equal(page.focused.length, 3);
  assert.equal(page.focused[1], page.terms[0]);
  assert.equal(page.focused[2], page.terms[1]);
});

test('term focus reports an unsettled tip at the existing deadline instead of passing on elapsed time', async () => {
  for (const missing of ['ownHead', 'ownTip', 'expanded', 'pageFocused']) {
    const page = termPage({ pageFocused: missing !== 'pageFocused', onFrame: ({ document, ready, setHead }) => {
      ready();
      if (missing === 'ownHead') setHead('Emergency stop');
      if (missing === 'ownTip') document.activeElement.attrs['aria-describedby'] = 'tip-other';
      if (missing === 'expanded') delete document.activeElement.attrs['aria-expanded'];
    } });
    const [seen] = await page.run();
    assert.deepEqual(seen.failed, [missing]);
    assert.equal(page.frame, 4);
    assert.equal(page.focused.length, 1);
  }
});

function layoutPage(samples, fonts = Promise.resolve()) {
  let frame = 0;
  const context = { document: { fonts: { ready: fonts }, get documentElement() { return samples[frame - 1]; } },
    __audit: { rects: selectors => {
      assert.deepEqual(Array.from(selectors), ['header.top']);
      return [{ key: 'header.top#0', left: samples[frame - 1].left ?? 0 }];
    } }, Date: { now: () => frame * 500 }, requestAnimationFrame: done => {
      assert.ok(frame < samples.length, 'unexpected extra layout read');
      frame++; done();
    } };
  return { get frame() { return frame; },
    run: () => runInNewContext(`(${afterStableLayout.toString()})(['header.top'], layout => ({ ...layout, measuredAt: Date.now() }))`, context).then(structuredClone) };
}

test('layout waits for fonts and matching frame boxes, clientWidth and scrollWidth before measuring', async () => {
  let loaded;
  const fonts = new Promise(resolve => { loaded = resolve; });
  const initial = { clientWidth: 1440, scrollWidth: 1440 };
  const scrollbar = { clientWidth: 1425, scrollWidth: 1425 };
  const fitted = { ...scrollbar, left: 8 };
  const page = layoutPage([initial, scrollbar, fitted, fitted], fonts);
  const pending = page.run();
  await Promise.resolve();
  assert.equal(page.frame, 0, 'no geometry read before fonts are ready');
  loaded();
  const seen = await pending;
  assert.equal(page.frame, 4);
  assert.equal(seen.clientWidth, 1425);
  assert.equal(seen.scrollWidth, 1425);
  assert.equal(seen.boxes[0].left, 8);
  assert.equal(seen.measuredAt, 2000, 'the measurement runs in the matching read, before another frame');
});

test('layout preserves real overflow inside the scrollbar and never settles on a changing scroll width', async () => {
  const fits = { clientWidth: 1009, scrollWidth: 1009 };
  const overflow = { clientWidth: 1009, scrollWidth: 1024 };
  const page = layoutPage([fits, overflow, overflow]);
  const seen = await page.run();
  assert.equal(page.frame, 3);
  assert.ok(seen.scrollWidth > seen.clientWidth, 'a stable overflow must still fail the caller assertion');
});

test('layout fails with both last reads when geometry never settles', async () => {
  const page = layoutPage([0, 1, 2, 3].map(left => ({ left, clientWidth: 1425, scrollWidth: 1425 })));
  await assert.rejects(page.run(), /layout did not settle: .*"previous".*"left":2.*"current".*"left":3/);
  assert.equal(page.frame, 4);
});

test('executor header payload settles the live page then measures both synthetic labels before another tick', async () => {
  const source = readFileSync(new URL('../scripts/browser-p5.mjs', import.meta.url), 'utf8');
  const template = source.match(/const measured = await ev\(`([\s\S]*?)`\);/)[1];
  const view = { html: 'candidate', title: 'Data delayed', label: 'Data delayed. Open status details.' };
  // Interpolate and execute the actual P5 payload, including its stable-layout
  // helper. A live render on every frame must never overwrite either sample.
  const payload = runInNewContext('`' + template + '`', { afterStableLayout, J: JSON.stringify,
    geometrySelectors: ['header.top'], reference: { html: 'reference' }, view, headerLayout: () => ({}) });
  let frame = 0;
  const reads = [], attrs = {};
  const box = { top: 0, bottom: 58, left: 16, right: 100, width: 84, height: 58 };
  const button = { innerHTML: 'live', title: 'Live', getBoundingClientRect: () => box,
    setAttribute: (key, value) => { attrs[key] = value; }, getAttribute: key => attrs[key],
    querySelector: selector => selector === 'b' ? { get innerText() { return button.innerHTML; } } : { getAttribute: () => '#i-half' } };
  const row = { getBoundingClientRect: () => box, querySelector: () => button };
  const measured = await runInNewContext(payload, {
    document: { fonts: { ready: Promise.resolve() }, documentElement: { clientWidth: 1009, scrollWidth: 1009 },
      getElementById: () => button, querySelector: () => row },
    requestAnimationFrame: done => {
      frame++; button.innerHTML = 'live'; button.title = 'Live'; attrs['aria-label'] = 'Live'; done();
    }, Date: { now: () => frame * 500 }, getComputedStyle: () => ({ paddingLeft: '16px', paddingRight: '16px' }),
    __audit: { rects: () => { reads.push({ frame, html: button.innerHTML }); return [box]; },
      clamps: () => [{ text: button.innerHTML, ok: true }], horizontal: () => ({ scroll: 1009, client: 1009 }), clipping: () => [] },
  });
  assert.equal(frame, 2);
  assert.deepEqual(reads.slice(-2), [{ frame: 2, html: 'reference' }, { frame: 2, html: 'candidate' }]);
  assert.equal(measured.clamps[0].text, view.html);
  assert.equal(measured.title, view.title);
  assert.equal(measured.name, view.label);
});
