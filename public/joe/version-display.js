// Product adapter only: the pinned shared bundle owns geometry and interaction.
import { renderVersion, disposeVersion, parts, utcLabel } from './vendor/calver/version.js';
import { attachVersionInteraction } from './vendor/calver/version-interaction.js';
import config from './vendor/calver/display.json' with { type: 'json' };

const text = { copy: 'Copy version', copied: 'Copied', failed: 'Copy is unavailable. The exact version is selected; copy it with your keyboard.' };
let mode = 'pretty';
const reduced = new WeakMap();
export function paintVersions() {
  for (const element of document.querySelectorAll('[data-product-version]')) {
    const value = element.dataset.productVersion, scheme = element.dataset.versionScheme;
    reduced.get(element)?.dispose(); reduced.delete(element);
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    renderVersion(element, value, scheme, { config, mode, brand, text });
    // The shared reduced renderer preserves the canonical SemVer string;
    // reuse the same shared interaction for copy and UTC accessibility.
    if (mode === 'reduced' && parts(value, scheme)) reduced.set(element, attachVersionInteraction(element, value, {
      label: `${value} · ${utcLabel(parts(value, scheme))}`, text,
    }));
  }
}
export function initVersionDisplay() {
  const button = document.getElementById('versionMode');
  button.addEventListener('click', () => {
    // Dispose before changing display so no interaction listeners accumulate.
    for (const element of document.querySelectorAll('[data-product-version]')) { reduced.get(element)?.dispose(); reduced.delete(element); disposeVersion(element); }
    mode = mode === 'pretty' ? 'reduced' : 'pretty';
    button.textContent = mode === 'pretty' ? 'SemVer' : 'Pretty';
    button.setAttribute('aria-label', mode === 'pretty' ? 'Show full SemVer version' : 'Show Pretty version');
    paintVersions();
  });
  paintVersions();
  // Auto colors follow the product theme without another saved preference.
  new MutationObserver(paintVersions).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintVersions);
}
