// Shared black-box inputs and assertions for the preview DOM and real browser.
import './preview-dom.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { CELL_REASON } = await import('../../public/joe/health.js');
export const reasons = Object.keys(CELL_REASON);
export const authShapes = ['302 to SSO', '303 to SSO', 'opaqueredirect', '401', '403', 'HTML content type', 'HTML body', 'HTML fragment', 'followed cross-origin redirect'];
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
  if (shape === 'followed cross-origin redirect') return { status: 200, redirected: true, url: 'https://sso.example.invalid/sign_in', headers: new Headers(), json: async () => ({}) };
  if (shape === 'HTML content type') return new Response('<h1>Sign in</h1>', { headers: { 'Content-Type': 'text/html' } });
  if (shape === 'HTML fragment') return new Response('<form>Sign in</form>');
  if (shape === '303 to SSO') return new Response(null, { status: 303, headers: { Location: 'https://sso.example.invalid/sign_in' } });
  if (shape === '302 to SSO') return new Response(null, { status: 302, headers: { Location: 'https://sso.example.invalid/sign_in' } });
  if (shape === 'HTML body') return new Response('<!doctype html><html><body>Sign in</body></html>');
  return new Response('{}', { status: Number(shape) });
}

// Historical non-auth snapshot schema. Keep its shape unchanged so the old
// hashes remain independently comparable; authentication uses retainedDocument
// below and never uses these selected-value collections as an oracle.
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
// Serialize the entire retained body, including hidden markup and every live
// form value. Only the two documented board-level marking attributes normalize.
// This has no wording or value allow-list and runs unchanged in the browser.
export function retainedDocument(document) {
  const serialize = node => {
    if (typeof node === 'string') return node;
    if (node.nodeType === 3 || node.nodeType === 8) return [node.nodeType, node.nodeValue];
    if (node.id === 'signedOutBanner') return null;
    const attrs = node.attributes?.[Symbol.iterator] ? Array.from(node.attributes, a => [a.name, a.value]) : Object.entries(node.attributes ?? {});
    const attributes = attrs.filter(([key]) => !(node.id === 'app' && key === 'data-last-known')).map(([key, value]) =>
      [key, node.id === 'main' && key === 'aria-describedby' ? value.split(/\s+/).filter(v => v !== 'lastKnownLabel').join(' ') : value])
      .filter(([key, value]) => !(node.id === 'main' && key === 'aria-describedby' && !value));
    const children = Array.from(node.childNodes ?? node.children ?? []).map(serialize).filter(v => v !== null);
    return [node.tagName, attributes, node.value, node.checked, node.selected, children];
  };
  const app = document.getElementById('app'), banner = document.getElementById('signedOutBanner');
  return { dom: JSON.stringify(serialize(document.body)),
    headline: banner.querySelector('strong').textContent,
    reload: !banner.hidden && Boolean(banner.querySelector('[data-sign-in-reload]')),
    marked: app.hasAttribute('data-last-known') && document.getElementById('main').getAttribute('aria-describedby')?.split(/\s+/).includes('lastKnownLabel'),
    label: document.getElementById('lastKnownLabel').textContent };
}
export function assertSignedOutPage(after, before, tag) {
  assert.equal(after.headline, 'Signed out — reload to sign in', tag);
  assert.equal(after.reload, true, `${tag}: Reload visible`);
  assert.equal(after.marked, true, `${tag}: main describes the entire board as last known`);
  assert.equal(after.label, 'Last known — signed out', tag);
  if (after.dom !== before.dom) {
    let at = 0; while (at < before.dom.length && before.dom[at] === after.dom[at]) at++;
    assert.fail(`${tag}: retained DOM differs at byte ${at}; before ${JSON.stringify(before.dom.slice(Math.max(0, at - 100), at + 180))}; after ${JSON.stringify(after.dom.slice(Math.max(0, at - 100), at + 180))}`);
  }
}
