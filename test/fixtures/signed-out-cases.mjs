// Shared black-box inputs and assertions for the preview DOM and real browser.
import './preview-dom.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { CELL_REASON } = await import('../../public/joe/health.js');
export const reasons = Object.keys(CELL_REASON);
export const authShapes = ['302 to SSO', 'opaqueredirect', '401', '403', 'HTML body'];
export const widths = [390, 1440];
export const screens = ['desk', 'history', 'results', 'settings'];
export const blame = 'Broker connection down — tell Amy to check the feed; stale; not exact';
export const valid = JSON.parse(readFileSync(new URL('../../fixtures/valid.json', import.meta.url)));
export function pageFixture() {
  const f = structuredClone(valid);
  f.data.brokerAccount.cash = { amount: '1234.56', currency: 'EUR' };
  for (const desk of f.data.desks) {
    desk.action = blame;
    desk.learning = { status: 'blocked', headline: blame, detail: blame, iteration: 7 };
    desk.issues = [];
  }
  return f;
}
export const dirtyPreview = config => JSON.stringify({ baseRev: config.rev, values: { 'desks.stage0.capEur': '1001' } });
export function authResponse(shape) {
  if (shape === 'opaqueredirect') return { type: 'opaqueredirect', status: 0 };
  if (shape === '302 to SSO') return new Response(null, { status: 302, headers: { Location: 'https://sso.example.invalid/sign_in' } });
  if (shape === 'HTML body') return new Response('<!doctype html><html><body>Sign in</body></html>');
  return new Response('{}', { status: Number(shape) });
}

// Runs unchanged inside Chrome. Collect the document's rendered text and all
// rendered titles/accessibility names; never filter by the expected wording.
// Values are discovered from the rendered DOM before sign-out, not a fixture
// allow-list. Preserve each region separately so another copy cannot mask loss.
export function renderedSnapshot(document, visible) {
  const elements = [...document.querySelectorAll('*')].filter(visible);
  const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();
  const copy = norm([document.body.innerText, ...elements.flatMap(n => [n.getAttribute('aria-label'), n.getAttribute('title')])].filter(Boolean).join(' '));
  const regions = ['acctHero', 'heroL', 'desk-j', 'desk-joe', 'desk-joel', 'positions', 'kept', 'histCompare', 'jAcct', 'rheroL', 'tiles', 'breakdown', 'cal', 'daypanel', 'rtRows', 'setMain', 'accountStartSummary'];
  const values = {};
  // Money, quantities, counts and symbol labels in every currently rendered
  // value container. Captions/ages and dates deliberately aren't value nodes.
  const valueText = n => {
    const text = norm(n.matches('.account-cash') ? n.querySelector('.cash-amount')?.innerText ?? n.innerText.split('·')[0] : n.innerText);
    return n.matches('.account-cash') && !/\d/.test(text) ? '' : text;
  };
  const selector = '.bn, .cash-amount, .account-cash, .acct-cash b, .acct-item b, .num, .tval, .cell .v, .wk .v, .pct, .basis, .position-summary, .position-mobile, [data-value], .f-saved.on, .prow .name b';
  for (const id of regions) {
    const root = document.getElementById(id);
    if (!root || !visible(root)) continue;
    values[id] = id === 'accountStartSummary' && /[0-9]/.test(root.innerText) ? [norm(root.innerText)] : [...new Set([...root.querySelectorAll(selector)].filter(visible).map(valueText).filter(t => t && t !== '—'))];
  }
  return { copy, values, regions: Object.fromEntries(regions.map(id => { const n = document.getElementById(id); return [id, n && visible(n) ? norm(n.innerText) : '']; })),
    headline: document.getElementById('statusAlertText').textContent,
    reload: visible(document.getElementById('signInReload')),
    ages: elements.filter(n => n.hasAttribute('data-age')).map(n => norm(n.innerText)) };
}
export function assertSignedOutPage(after, before, tag) {
  assert.equal(after.headline, 'Signed out — reload to sign in', tag);
  assert.equal(after.reload, true, `${tag}: Reload visible`);
  assert.doesNotMatch(after.copy, /broker connection (?:down|unstable|not confirmed|has not)|not reported by the broker|broker is offline|tell Amy|check the feed|feed (?:stopped|failed|down|unavailable)|last good|not set/i, tag);
  assert.doesNotMatch(after.copy, /\b\d+\s*(?:s|min|h|days?) (?:ago|old)\b/i, `${tag}: ages are unknown`);
  assert.deepEqual(after.ages, [], `${tag}: no ticking age nodes`);
  for (const [id, values] of Object.entries(before.values)) {
    for (const value of values) {
      // A dirty field's caption changes its state word, retaining its amount.
      const retained = value.replace(/^Saved: /, '').replace(/^Last good: /, '');
      assert.ok(after.regions[id].replace(/\s/g, '').includes(retained.replace(/\s/g, '')), `${tag}/${id}: retained ${JSON.stringify(retained)}`);
    }
    if (values.length) assert.match(after.copy, /last known/i, `${tag}/${id}: retained values labelled`);
  }
}
