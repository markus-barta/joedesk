// Product adapter only: the pinned shared bundle owns geometry and interaction.
import { boardSession } from './transport.js';
import { renderVersion, disposeVersion, parts, utcLabel } from './vendor/calver/version.js';
import { attachVersionInteraction } from './vendor/calver/version-interaction.js';
import config from './vendor/calver/display.json' with { type: 'json' };

const text = { copy: 'Copy version', copied: 'Copied', failed: 'Copy is unavailable. The exact version is selected; copy it with your keyboard.' };
let mode = 'pretty';
const interactions = new WeakMap();
function cancelVersionInteractions(frozen = false) {
  for (const element of document.querySelectorAll('[data-product-version]')) {
    const controller = interactions.get(element);
    if (frozen) controller?.freeze(); else controller?.dispose();
    interactions.delete(element); disposeVersion(element);
  }
}
// Keep the immutable vendor bundle intact. Settlements from clipboard work
// abandoned by expiry never reach its fallback UI or confirmation timer.
function interaction(element, value, label) {
  let active = true;
  const view = { matchMedia: (...args) => globalThis.matchMedia(...args),
    setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: timer => globalThis.clearTimeout(timer),
    navigator: { clipboard: { writeText: canonical => new Promise((resolve, reject) => {
      Promise.resolve().then(() => active ? navigator.clipboard.writeText(canonical) : undefined).then(
        result => { if (active) resolve(result); }, error => { if (active) reject(error); });
    }) } } };
  const controller = attachVersionInteraction(element, value, { view, label, text });
  return {
    dispose() { active = false; controller.dispose(); },
    freeze() {
      active = false;
      // Disposal cancels timers, listeners and clipboard continuations. Retain
      // the rendered coordinate/attributes, including the last reveal widths.
      const attributes = [...element.attributes].map(a => [a.name, a.value]);
      const styles = [...element.children].map(node => [node, node.getAttribute('style')]);
      const feedback = element.querySelector('[role="status"]');
      controller.dispose();
      for (const a of [...element.attributes]) element.removeAttribute(a.name);
      for (const [key, value] of attributes) if (key !== 'data-copy-state') element.setAttribute(key, value);
      for (const [node, style] of styles) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
      }
      if (feedback) { feedback.hidden = true; feedback.textContent = ''; element.append(feedback); }
    },
  };
}
export function paintVersions() {
  if (boardSession.signedOut()) return;
  for (const element of document.querySelectorAll('[data-product-version]')) {
    const value = element.dataset.productVersion, scheme = element.dataset.versionScheme;
    interactions.get(element)?.dispose(); interactions.delete(element);
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    renderVersion(element, value, scheme, { config, mode, brand, text, interactive: false });
    // The shared reduced renderer preserves the canonical SemVer string;
    // reuse the same shared interaction for copy and UTC accessibility.
    if (parts(value, scheme)) interactions.set(element, interaction(element, value, `${value} · ${utcLabel(parts(value, scheme))}`));
  }
}
export function initVersionDisplay() {
  const stop = boardSession.subscribe(() => { if (boardSession.signedOut()) cancelVersionInteractions(true); else paintVersions(); });
  const button = document.getElementById('versionMode');
  button.addEventListener('click', () => {
    // Dispose before changing display so no interaction listeners accumulate.
    cancelVersionInteractions();
    mode = mode === 'pretty' ? 'reduced' : 'pretty';
    button.textContent = mode === 'pretty' ? 'SemVer' : 'Pretty';
    button.setAttribute('aria-label', mode === 'pretty' ? 'Show full SemVer version' : 'Show Pretty version');
    paintVersions();
  });
  paintVersions();
  // Auto colors follow the product theme without another saved preference.
  new MutationObserver(paintVersions).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintVersions);
  return stop;
}
