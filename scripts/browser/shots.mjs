// Viewports, themes, waiting and full-page screenshots for the P3 browser run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VIEWPORTS = [
  { name: '1440', width: 1440, height: 1000, mobile: false },
  { name: '1024', width: 1024, height: 768, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];
export const THEMES = ['light', 'dark'];

export async function configure(page, viewport, theme, { scale = 1 } = {}) {
  await page.s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: scale, mobile: viewport.mobile });
  await setPointer(page, viewport.mobile);
  await page.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
}

// The pointer is the test's, not the host's. A phone is a touch screen
// ((hover: none), (pointer: coarse)); any other viewport has the mouse the
// browser was launched with ((hover: hover), (pointer: fine); cdp.mjs).
// Touch emulation makes the touch screen, whatever the host. Turning it off
// hands the live document the host's pointer (a Linux runner has none) until
// Chrome sends the page its preferences again, which applies the launch
// flag once more: a new document does, and so does a screenshot beyond the
// viewport (Chrome swaps the preferences for it and puts them back). So
// touch is turned off only when a desktop case follows a phone, and then a
// 1×1 screenshot gives the same document its mouse again, resized live as
// before. Emulation.setEmulatedMedia cannot do it: it overrides no hover or
// pointer feature (Chrome 151 Linux, 153 macOS).
const touching = new WeakSet();
export async function setPointer(page, mobile) {
  if (mobile) {
    await page.s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    touching.add(page);
    return;
  }
  if (!touching.has(page)) return;
  await page.s('Emulation.setTouchEmulationEnabled', { enabled: false });
  touching.delete(page);
  await page.s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 }, captureBeyondViewport: true });
}

// The pointer the page's media queries see, to assert after a change.
export const MOUSE = 'hover, fine', TOUCH = 'no hover, coarse';
export const pointerMedia = page => page.evaluate(`[matchMedia('(hover: hover)').matches ? 'hover' : matchMedia('(hover: none)').matches ? 'no hover' : 'hover unknown',
  matchMedia('(pointer: fine)').matches ? 'fine' : matchMedia('(pointer: coarse)').matches ? 'coarse' : 'no pointer'].join(', ')`);

export async function waitFor(page, expression, timeout = 15000) {
  const until = Date.now() + timeout;
  for (;;) {
    try { if (await page.evaluate(`Boolean(${expression})`)) return; } catch { /* the document is still navigating */ }
    if (Date.now() > until) throw new Error(`timed out waiting for ${expression}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

export const settle = page => page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))))');

export async function load(page, url, screen = 'desk') {
  await page.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await page.s('Page.navigate', { url: 'about:blank' });
  await waitFor(page, `location.href === 'about:blank'`);
  await page.s('Page.navigate', { url: `${url}#${screen}` });
  await waitFor(page, `document.documentElement.dataset.ready === '1' && document.readyState === 'complete'`);
  await page.evaluate('document.fonts.ready.then(() => true)');
  await settle(page);
}

export async function go(page, screen) {
  await page.evaluate(`document.querySelector('.nav [data-go="${screen}"]')?.click() ?? document.querySelector('.bottom-nav [data-go="${screen}"]').click()`);
  await settle(page);
}

export async function screenshot(page, viewport, file) {
  const height = await page.evaluate('Math.ceil(document.documentElement.scrollHeight)');
  await page.s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: Math.max(viewport.height, height), deviceScaleFactor: 1, mobile: viewport.mobile });
  await settle(page);
  const { data } = await page.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await page.s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await settle(page);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, Buffer.from(data, 'base64'));
}
