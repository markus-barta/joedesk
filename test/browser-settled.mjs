import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { focusTermTips } from '../scripts/browser/term-focus.mjs';

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
