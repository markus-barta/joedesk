// Viewports, themes, waiting and full-page screenshots for the P3 browser run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VIEWPORTS = [
  { name: '1440', width: 1440, height: 1000, mobile: false },
  { name: '1024', width: 1024, height: 768, mobile: false },
  { name: '390', width: 390, height: 844, mobile: true },
];
export const THEMES = ['light', 'dark'];

// A phone is a touch screen ((hover: none), (pointer: coarse)); any other
// viewport has the mouse the browser was launched with ((hover: hover),
// (pointer: fine)). Turning touch off hands the host's own pointer back until
// the next document, so a desktop case has its mouse from load() on.
export async function configure(page, viewport, theme, { scale = 1 } = {}) {
  await page.s('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: scale, mobile: viewport.mobile });
  await page.s('Emulation.setTouchEmulationEnabled', viewport.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await page.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
}

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
