#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocketClient = globalThis.WebSocket || require("undici").WebSocket;

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const packageVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
const browserPath = process.env.BROWSER_PATH || "/usr/bin/google-chrome";
const site = await mkdtemp(join(tmpdir(), "hostdash-joe-site-"));
const profile = await mkdtemp(join(tmpdir(), "hostdash-joe-browser-"));
const requests = [];

await cp(join(repoRoot, "public"), site, { recursive: true });
const sample = JSON.parse(await readFile(join(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"));

async function writeSnapshot(overrides = {}) {
  const snapshot = structuredClone(sample);
  snapshot.generatedAt = new Date().toISOString();
  if (overrides.generatedAt) snapshot.generatedAt = overrides.generatedAt;
  snapshot.brokerAccount.observedAt = overrides.brokerObservedAt || snapshot.generatedAt;
  if (overrides.halt !== undefined) snapshot.safety.halt = overrides.halt;
  if (overrides.haltReason !== undefined) snapshot.safety.haltReason = overrides.haltReason;
  if (overrides.gatewayStatus) snapshot.safety.gateway.status = overrides.gatewayStatus;
  if (overrides.gatewayDetail !== undefined) snapshot.safety.gateway.detail = overrides.gatewayDetail;
  await writeFile(join(site, "joe", "data.json"), JSON.stringify(snapshot));
  return snapshot;
}

await writeSnapshot();

function extractIsCanonicalJoeHost(source) {
  const start = source.indexOf("function isCanonicalJoeHost");
  const end = source.indexOf("\n  var LAYOUT_KEY", start);
  if (start < 0 || end < 0) throw new Error("isCanonicalJoeHost missing from joe.js");
  return new Function(`${source.slice(start, end)}; return isCanonicalJoeHost;`)();
}

function assertJoeHostGate(isCanonicalJoeHost) {
  const allow = [
    "hsb1.lan", "hsb1", "localhost", "127.0.0.1", "::1",
    "HSB1.LAN", "[::1]",
    "100.64.0.7", "100.64.0.0", "100.127.255.255",
    "hsb1.tail1234.ts.net", "foo.hsb1.ts.net", "hsb1.ts.net",
    "cs0.barta.cm", "cs0", "CS0.BARTA.CM"
  ];
  const deny = [
    "example.com", "8.8.8.8",
    "100.63.255.255", "100.128.0.1", "100.64.0.256", "100.64.0.07",
    "192.168.1.10", "10.0.0.1",
    "example.ts.net", "hsb1.example.com"
  ];
  for (const host of allow) {
    if (!isCanonicalJoeHost(host)) throw new Error(`canonical host rejected: ${host}`);
  }
  for (const host of deny) {
    if (isCanonicalJoeHost(host)) throw new Error(`non-canonical host allowed: ${host}`);
  }
}

const joeSource = await readFile(join(repoRoot, "public/joe/joe.js"), "utf8");
assertJoeHostGate(extractIsCanonicalJoeHost(joeSource));

const historyPoints = Array.from({ length: 8 }, (_, index) => ({
  t: new Date(Date.now() - (7 - index) * 3600_000).toISOString(),
  desks: {
    j: { equity: 10000 + index * 4, dayPnl: index * 4, totalPnl: 100 + index * 4 },
    joe: { equity: 10000 - index, dayPnl: -index, totalPnl: -40 - index },
    joel: { equity: 10000 + index * 2, dayPnl: index * 2, totalPnl: 230 + index * 2 },
  },
  totals: { equity: 30000 + index * 5, dayPnl: index * 5, totalPnl: 290 + index * 5 },
}));
await writeFile(join(site, "joe", "history.json"), JSON.stringify({
  schema: "inspr.joe.household.history.v1",
  generatedAt: new Date().toISOString(),
  currency: "EUR",
  points: historyPoints,
}));

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://local.test");
  requests.push({ host: request.headers.host || "", path: url.pathname });
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (relative.includes("..")) {
    response.writeHead(400);
    response.end("bad request");
    return;
  }
  try {
    const file = await readFile(join(site, relative.endsWith("/") ? relative + "index.html" : relative));
    const type = relative.endsWith(".json") ? "application/json"
      : relative.endsWith(".css") ? "text/css; charset=utf-8"
        : relative.endsWith(".js") ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const sitePort = server.address().port;

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const cdpPort = await freePort();
const browser = spawn(browserPath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-proxy-server",
  "--host-resolver-rules=MAP hsb1.lan 127.0.0.1, MAP cs0.barta.cm 127.0.0.1, MAP example.com 127.0.0.1",
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profile}`,
  "about:blank",
]);
browser.stdout.resume();
browser.stderr.resume();

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function withTimeout(promise, milliseconds) {
  await Promise.race([promise, delay(milliseconds)]);
}

async function waitForJson(path) {
  const url = `http://127.0.0.1:${cdpPort}${path}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser not ready yet.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function cleanup() {
  browser.kill("SIGTERM");
  await delay(150);
  await new Promise(resolve => server.close(resolve));
  await rm(site, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

try {
  const pages = await waitForJson("/json/list");
  const page = pages.find(candidate => candidate.type === "page");
  if (!page) throw new Error("No browser page target found");
  const ws = new WebSocketClient(page.webSocketDebuggerUrl);
  await new Promise(resolve => { ws.onopen = resolve; });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  const javascriptDialogDecisions = [];
  const javascriptDialogs = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text || "runtime exception");
    if (message.method === "Page.javascriptDialogOpening") {
      javascriptDialogs.push({ type: message.params.type, message: message.params.message });
      const accept = javascriptDialogDecisions.length ? javascriptDialogDecisions.shift() : false;
      send("Page.handleJavaScriptDialog", { accept }).catch(error => exceptions.push(`dialog handling failed: ${error.message}`));
    }
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
      else promise.resolve(message.result);
    }
  };

  function send(method, params = {}) {
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  async function value(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluation failed");
    return result.result.value;
  }
  function answerNextJavaScriptDialog(accept) {
    javascriptDialogDecisions.push(Boolean(accept));
  }
  async function navigate(url, readyExpression) {
    await send("Page.navigate", { url });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await value(`Boolean(${readyExpression})`).catch(() => false)) return;
      await delay(100);
    }
    throw new Error(`Page did not become ready: ${url}`);
  }
  async function measureHistoryGeometry(label) {
    let geometry;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      geometry = await value(`(() => {
        const empty = document.getElementById('historyEmpty');
        const chart = window.Chart?.getChart?.('historyChart');
        if (!chart) return { available: false, empty: Boolean(empty && !empty.hidden) };
        const wrapper = chart.canvas.parentElement;
        const canvasRect = chart.canvas.getBoundingClientRect();
        const scale = chart.scales.x;
        const labels = scale.getLabelItems().map((item) => {
          chart.ctx.font = item.font.string;
          const lines = Array.isArray(item.label) ? item.label : [String(item.label)];
          const width = Math.max(...lines.map((line) => chart.ctx.measureText(line).width));
          const [x, y] = item.options.translation;
          const align = item.options.textAlign;
          const centerY = y + (item.textOffset || 0);
          return {
            text: lines.join(' / '),
            left: x - (align === 'right' ? width : align === 'center' ? width / 2 : 0),
            right: x + (align === 'left' ? width : align === 'center' ? width / 2 : 0),
            top: centerY - item.font.lineHeight / 2,
            bottom: centerY + (lines.length - 0.5) * item.font.lineHeight,
          };
        }).sort((left, right) => left.left - right.left);
        return {
          available: true,
          width: chart.width,
          height: chart.height,
          canvasWidth: canvasRect.width,
          canvasHeight: canvasRect.height,
          wrapperWidth: wrapper.clientWidth,
          wrapperHeight: wrapper.clientHeight,
          plotBottom: chart.chartArea.bottom,
          labels,
        };
      })()`);
      if (geometry.available || geometry.empty) break;
      await delay(50);
    }
    if (!geometry?.available) {
      if (!historyPoints.length && geometry?.empty) return geometry;
      throw new Error(`History chart unavailable for ${label}: ${JSON.stringify(geometry)}`);
    }
    const problems = [];
    if (geometry.height > 1000) problems.push(`runaway chart height ${geometry.height}`);
    if (Math.abs(geometry.width - geometry.wrapperWidth) > 1 || Math.abs(geometry.height - geometry.wrapperHeight) > 1 ||
        Math.abs(geometry.canvasWidth - geometry.wrapperWidth) > 1 || Math.abs(geometry.canvasHeight - geometry.wrapperHeight) > 1) {
      problems.push("chart and wrapper dimensions differ");
    }
    if (!geometry.labels.length) problems.push("no visible x-axis labels");
    geometry.labels.forEach((item, index) => {
      if (item.left < 0 || item.right > geometry.width) problems.push(`label outside canvas: ${item.text}`);
      if (item.top < geometry.plotBottom - 1 || item.bottom > geometry.height - 2) problems.push(`label crosses plot/frame: ${item.text}`);
      if (index && item.left < geometry.labels[index - 1].right + 2) problems.push(`overlapping labels: ${geometry.labels[index - 1].text} / ${item.text}`);
    });
    if (problems.length) throw new Error(`History geometry mismatch (${label}): ${JSON.stringify({ ...geometry, problems })}`);
    return geometry;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  const smokeMode = process.env.JOE_SMOKE_VIEWPORT || "desktop";
  const mobileViewport = smokeMode === "mobile";
  await send("Emulation.setDeviceMetricsOverride", mobileViewport
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const hsb1Url = `http://hsb1.lan:${sitePort}/joe/`;
  let healthy;
  let mobile;
  let stale;
  let broken;
  let stub;
  let richSnapshot;
  let backfillSnapshot;
  let historyGeometry;

  if (smokeMode === "privacy") {
    const publicBefore = requests.filter(item => item.host.startsWith("example.com") && item.path === "/joe/data.json").length;
    await navigate(`http://example.com:${sitePort}/joe/`, "document.documentElement.dataset.joeView === 'stub'");
    await delay(250);
    stub = await value(`({ view: document.documentElement.dataset.joeView, gateHidden: document.getElementById('privateGate')?.hidden, dashboardHidden: document.getElementById('dashboard')?.hidden, text: document.body.innerText, title: document.title })`);
    const publicAfter = requests.filter(item => item.host.startsWith("example.com") && item.path === "/joe/data.json").length;
    if (stub.view !== "stub" || stub.gateHidden || !stub.dashboardHidden || !/Joe lives at home/.test(stub.text) || stub.title !== "Joe · Private household board" || publicAfter !== publicBefore) throw new Error(`public privacy stub mismatch: ${JSON.stringify({ stub, publicBefore, publicAfter })}`);
  } else {

    const cs0Before = requests.filter(item => item.host.startsWith("cs0.barta.cm") && item.path === "/joe/data.json").length;
    await navigate(`http://cs0.barta.cm:${sitePort}/joe/`, "document.documentElement.dataset.joeView === 'board'");
    await delay(250);
    const cs0Board = await value(`({ view: document.documentElement.dataset.joeView, title: document.title, gateHidden: document.getElementById('privateGate')?.hidden, dashboardHidden: document.getElementById('dashboard')?.hidden, deskIds: [...document.querySelectorAll('[data-desk]')].map(n => n.getAttribute('data-desk')) })`);
    const cs0After = requests.filter(item => item.host.startsWith("cs0.barta.cm") && item.path === "/joe/data.json").length;
    if (cs0Board.view !== "board" || cs0Board.title !== "JoeDesk" || !cs0Board.gateHidden || cs0Board.dashboardHidden || JSON.stringify(cs0Board.deskIds) !== JSON.stringify(["j", "joe", "joel"]) || cs0After <= cs0Before) {
      throw new Error(`cs0 oauth board mismatch: ${JSON.stringify({ cs0Board, cs0Before, cs0After })}`);
    }

    await navigate(hsb1Url, "document.documentElement.dataset.joeState");
    healthy = await value(`(() => ({
    view: document.documentElement.dataset.joeView,
    state: document.documentElement.dataset.joeState,
    deskIds: [...document.querySelectorAll('.desk-widget')].map(node => node.dataset.desk),
    states: [...document.querySelectorAll('.state')].map(node => node.textContent),
    total: document.getElementById('totalEquity')?.textContent,
    primaryHeroLabel: document.querySelector('.hero-net > .label')?.textContent,
    startingCapital: document.getElementById('virtualStartingCapital')?.textContent,
    brokerEquity: document.getElementById('brokerEquity')?.textContent,
    brokerMeta: document.getElementById('brokerAccountMeta')?.textContent,
    deskTotalsMeta: document.getElementById('deskTotalsMeta')?.textContent,
    gateway: document.getElementById('gatewayValue')?.textContent,
    halt: document.getElementById('haltValue')?.textContent,
    alarmHidden: document.getElementById('alarm')?.hidden,
    gridReady: Boolean(document.getElementById('joeGrid')?.gridstack),
    widgets: document.querySelectorAll('#joeGrid > .grid-stack-item').length,
    selectedSeries: document.querySelectorAll('button[data-series][aria-pressed="true"]').length,
    allBotsPressed: document.getElementById('seriesAll')?.getAttribute('aria-pressed'),
    historyTitle: document.querySelector('[gs-id="history"] .widget-drag span')?.textContent,
    historyHelp: document.getElementById('historyHelp')?.textContent,
    deskLabel: document.getElementById('deskControlsLabel')?.textContent,
    rangeLabel: document.getElementById('rangeControlsLabel')?.textContent,
    totalDay: document.getElementById('totalDay')?.textContent,
    totalDayTitle: document.getElementById('totalDay')?.title,
    attributionDay: document.querySelector('#attribution .widget-note')?.textContent,
    versionSummary: document.querySelector('.version > summary')?.textContent,
    versionEntries: document.querySelectorAll('#versionPanel .version__entry').length,
    layoutSelectOptions: document.getElementById('layoutSelect')?.options?.length,
    layoutMenu: Boolean(document.getElementById('layoutMenu')),
    settingsMenu: Boolean(document.getElementById('settingsMenu')),
    loadLayoutAbsent: !document.getElementById('loadLayout'),
    layoutActions: ['saveLayout', 'saveAsLayout', 'renameLayout', 'deleteLayout', 'resetLayout'].map(id => document.getElementById(id)?.textContent.trim()),
    unsavedDialog: (() => {
      const dialog = document.getElementById('layoutUnsavedDialog');
      return {
        native: dialog instanceof HTMLDialogElement,
        label: dialog?.getAttribute('aria-label'),
        describedBy: dialog?.getAttribute('aria-describedby'),
        controls: ['layoutUnsavedSave', 'layoutUnsavedDiscard', 'layoutUnsavedCancel'].map(id => ({ text: document.getElementById(id)?.textContent.trim(), type: document.getElementById(id)?.type })),
      };
    })(),
    headerTriggers: [...document.querySelectorAll('.header-menu-trigger')].map(node => ({
      classed: node.classList.contains('header-icon-trigger'),
      label: node.getAttribute('aria-label'),
      title: node.getAttribute('title'),
      svgHidden: node.querySelector('svg')?.getAttribute('aria-hidden'),
    })),
    brandLogo: Boolean(document.querySelector('.brand-logo')),
    marketingCopy: /Three bots|quiet answer/i.test(document.body.innerText),
    heroId: document.querySelector('[gs-id="hero"]')?.getAttribute('gs-id'),
    positionFallback: document.getElementById('positionsBody')?.innerText,
    zoomPlugin: Boolean(window.Chart?.registry?.plugins?.get('zoom')),
    externalScripts: [...document.scripts].filter(script => script.src && new URL(script.src).origin !== location.origin).length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    baseHref: document.querySelector('base')?.getAttribute('href'),
    baseUrl: document.baseURI,
  }))()`);
    if (
      healthy.view !== "board" || healthy.state !== "ok" ||
      JSON.stringify(healthy.deskIds) !== JSON.stringify(["j", "joe", "joel"]) ||
      !healthy.states.includes("Working") || !healthy.states.includes("Sitting out") ||
      !/30[\.\s]000/.test(healthy.total || "") || !/^OK · connected/.test(healthy.gateway || "") ||
      !/31[\.\s]482,75/.test(healthy.brokerEquity || "") || !/including KEEP/.test(healthy.brokerMeta || "") ||
      healthy.primaryHeroLabel !== "Virtual desk equity" || !/15[\.\s]000/.test(healthy.startingCapital || "") || !/not virtual desk capital/.test(healthy.brokerMeta || "") ||
      !/virtual books/i.test(healthy.deskTotalsMeta || "") ||
      healthy.totalDay !== "—" || !/not available yet/i.test(healthy.totalDayTitle || "") ||
      !/Day P&L is not available yet/i.test(healthy.attributionDay || "") ||
      !healthy.halt.startsWith("Off") || !healthy.alarmHidden || !healthy.gridReady || healthy.widgets !== 7 ||
      healthy.selectedSeries !== 3 || healthy.allBotsPressed !== "true" ||
      healthy.historyTitle !== "History" || /drag here|compare up to two/i.test(healthy.historyHelp || "") ||
      healthy.deskLabel !== "Desks" || healthy.rangeLabel !== "Range" ||
      healthy.versionSummary?.trim() !== `v${packageVersion}` || healthy.versionEntries < 4 ||
      !healthy.layoutSelectOptions || healthy.layoutSelectOptions < 1 ||
      !healthy.layoutMenu || !healthy.settingsMenu || !healthy.loadLayoutAbsent ||
      JSON.stringify(healthy.layoutActions) !== JSON.stringify(['Save', 'Save as…', 'Rename', 'Delete', 'Reset']) ||
      !healthy.unsavedDialog.native || healthy.unsavedDialog.label !== 'Unsaved layout changes' || healthy.unsavedDialog.describedBy !== 'layoutUnsavedMessage' ||
      JSON.stringify(healthy.unsavedDialog.controls) !== JSON.stringify([{ text: 'Save', type: 'button' }, { text: 'Discard', type: 'button' }, { text: 'Cancel', type: 'button' }]) ||
      JSON.stringify(healthy.headerTriggers) !== JSON.stringify([
        { classed: true, label: 'Layout', title: 'Layout', svgHidden: 'true' },
        { classed: true, label: 'Settings', title: 'Settings', svgHidden: 'true' },
      ]) ||
      !healthy.brandLogo || healthy.marketingCopy ||
      healthy.heroId !== "hero" ||
      healthy.baseHref !== "/joe/" || healthy.baseUrl !== hsb1Url ||
      !/not present/i.test(healthy.positionFallback || "") || !healthy.zoomPlugin || healthy.externalScripts || healthy.overflow
    ) throw new Error(`Healthy board mismatch: ${JSON.stringify(healthy)}`);

    const initial = await measureHistoryGeometry("initial render");
    const resizeSamples = [];
    for (const viewport of [
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      { width: 768, height: 900, deviceScaleFactor: 1, mobile: false },
    ]) {
      await send("Emulation.setDeviceMetricsOverride", viewport);
      await delay(500);
      const after500ms = await measureHistoryGeometry(`${viewport.width}px after 500ms`);
      await delay(500);
      const after1s = await measureHistoryGeometry(`${viewport.width}px after 1s`);
      if (after500ms.available && after1s.available && Math.abs(after500ms.height - after1s.height) > 4) {
        throw new Error(`History height did not settle at ${viewport.width}px: ${JSON.stringify({ after500ms: after500ms.height, after1s: after1s.height })}`);
      }
      resizeSamples.push({ width: viewport.width, after500ms, after1s });
    }
    await send("Emulation.setDeviceMetricsOverride", mobileViewport
      ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
      : { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    historyGeometry = { initial, resizeSamples };

    if (process.env.JOE_SCREENSHOT_DIR) {
      const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(process.env.JOE_SCREENSHOT_DIR, mobileViewport ? "joe-dash-mobile.png" : "joe-dash-desktop.png"), Buffer.from(shot.data, "base64"));
    }

    if (mobileViewport) {
      mobile = await value(`(() => {
      const updatedAt = document.getElementById('updatedAt');
      const priorUpdatedAt = updatedAt.textContent;
      updatedAt.textContent = 'data.json unavailable';
      const details = document.querySelector('details.version');
      details.open = true;
      const panel = document.getElementById('versionPanel');
      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const versionPanel = {
        x: panelRect.x,
        right: panelRect.right,
        width: panelRect.width,
        overflow: panelRect.x < -1 || panelRect.right > viewportWidth + 1,
      };
      details.open = false;
      updatedAt.textContent = priorUpdatedAt;
      const panelBounds = (selector) => {
        const panel = document.querySelector(selector);
        if (!panel) return { missing: true };
        const rect = panel.getBoundingClientRect();
        return {
          x: rect.x,
          right: rect.right,
          overflow: rect.x < -1 || rect.right > viewportWidth + 1,
        };
      };
      document.getElementById('layoutMenu').setAttribute('open', '');
      if (window.JoeBoard.positionHeaderMenus) window.JoeBoard.positionHeaderMenus();
      const layoutPanel = panelBounds('#layoutMenu .header-menu-panel');
      document.getElementById('layoutMenu').removeAttribute('open');
      document.getElementById('settingsMenu').setAttribute('open', '');
      if (window.JoeBoard.positionHeaderMenus) window.JoeBoard.positionHeaderMenus();
      const settingsPanel = panelBounds('#settingsMenu .header-menu-panel');
      document.getElementById('settingsMenu').removeAttribute('open');
      const defaultHero = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === 'default')?.items.find((item) => item.id === 'hero');
      const liveHeroElement = document.querySelector('[gs-id="hero"]');
      const liveHero = liveHeroElement?.gridstackNode;
      const liveCellHeight = document.getElementById('joeGrid')?.gridstack?.getCellHeight();
      const heroRenderedHeight = liveHeroElement?.getBoundingClientRect().height;
      const heroModelHeight = Number.isFinite(liveHero?.h) && Number.isFinite(liveCellHeight) ? liveHero.h * liveCellHeight : null;
      return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      gridColumns: document.getElementById('joeGrid')?.gridstack?.getColumn(),
      desktopColumns: window.JoeBoard.desktopColumnCount(),
      storedColumns: JSON.parse(localStorage.getItem('joe-board-grid-settings-v1') || 'null')?.columns,
      layoutPanel,
      settingsPanel,
      defaultHeroY: defaultHero?.y,
      defaultHeroH: defaultHero?.h,
      liveHeroY: liveHero?.y,
      liveHeroH: liveHero?.h,
      heroRenderedHeight,
      heroModelHeight,
      heroFitSettled: Number.isFinite(heroRenderedHeight) && Number.isFinite(heroModelHeight) && Math.abs(heroRenderedHeight - heroModelHeight) <= 1,
      headerStatusVisible: Boolean(document.querySelector('.header-status')),
      viewport: document.documentElement.dataset.joeViewport,
      narrowBreakpoint: window.JoeBoard.narrowBreakpoint,
      gateHidden: document.getElementById('privateGate').hidden,
      heroClipped: (() => { const hero = document.querySelector('[gs-id="hero"] .grid-stack-item-content'); return hero.scrollHeight > hero.clientHeight + 1; })(),
      heroOpen: document.getElementById('totalOpen')?.textContent,
      heroFreshness: document.getElementById('freshValue')?.textContent,
      versionPanel,
      offenders: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map(node => ({ tag: node.tagName, id: node.id, className: String(node.className), right: Math.round(node.getBoundingClientRect().right), width: Math.round(node.getBoundingClientRect().width) })),
      };
      })()`);
      if (
        mobile.overflow || mobile.gridColumns !== 1 || mobile.desktopColumns !== 12 || (mobile.storedColumns !== undefined && mobile.storedColumns !== 12) ||
        mobile.layoutPanel?.overflow || mobile.settingsPanel?.overflow ||
        mobile.defaultHeroY !== 0 || mobile.defaultHeroH !== 3 || mobile.liveHeroY !== 0 ||
        !Number.isInteger(mobile.liveHeroH) || mobile.liveHeroH < mobile.defaultHeroH ||
        !mobile.heroFitSettled ||
        mobile.viewport !== "narrow" || mobile.narrowBreakpoint !== 700 ||
        !mobile.headerStatusVisible || !mobile.gateHidden || mobile.heroClipped || !mobile.heroOpen || !mobile.heroFreshness || mobile.versionPanel?.overflow
      ) throw new Error(`Mobile layout mismatch: ${JSON.stringify(mobile)}`);

      const mobileSave = await value(`(async () => {
        document.getElementById('settingsMenu').setAttribute('open', '');
        document.getElementById('settingsColumns').value = '6';
        document.getElementById('settingsCellHeight').value = '88';
        document.getElementById('settingsTilePadding').value = '18';
        document.getElementById('settingsTileGap').value = '20';
        document.getElementById('settingsApply').click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        document.getElementById('layoutMenu').setAttribute('open', '');
        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Custom grid';
        document.getElementById('layoutFormConfirm').click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const afterSave = {
          status: document.getElementById('layoutStatus').textContent,
          isError: document.getElementById('layoutStatus').classList.contains('is-error'),
          catalogCount: window.JoeBoard.readLayoutsCatalog().layouts.length,
          selected: document.getElementById('layoutSelect').value,
          renameDisabled: document.getElementById('renameLayout').disabled,
          gridColumns: window.JoeBoard.gridColumnCount(),
          heroW: document.querySelector('[gs-id="hero"]')?.gridstackNode?.w,
          savedHeroW: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Custom grid')?.items.find((item) => item.id === 'hero')?.w,
        };
        document.getElementById('renameLayout').click();
        document.getElementById('layoutNameInput').value = 'Renamed grid';
        document.getElementById('layoutFormConfirm').click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {
          afterSave,
          afterRename: document.getElementById('layoutSelect').selectedOptions[0]?.textContent,
          renamedId: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Renamed grid')?.id,
        };
      })()`);
      if (
        mobileSave.afterSave.isError || mobileSave.afterSave.catalogCount < 2 ||
        mobileSave.afterSave.selected === 'default' || mobileSave.afterSave.renameDisabled ||
        mobileSave.afterSave.gridColumns !== 1 || mobileSave.afterSave.savedHeroW !== 6 ||
        mobileSave.afterRename !== 'Renamed grid' || !mobileSave.renamedId
      ) throw new Error(`Mobile save layout mismatch: ${JSON.stringify(mobileSave)}`);

      await send("Page.reload", { ignoreCache: true });
      await delay(600);
      await navigate(hsb1Url, "document.getElementById('joeGrid')?.gridstack");
      const mobileReloaded = await value(`(() => {
        const renamed = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Renamed grid');
        return {
          catalogCount: window.JoeBoard.readLayoutsCatalog().layouts.length,
          selected: document.getElementById('layoutSelect').value,
          expectedSelected: renamed?.id,
          settings: window.JoeBoard.readActiveGridSettings(),
          gridColumns: window.JoeBoard.gridColumnCount(),
          desktopColumns: window.JoeBoard.desktopColumnCount(),
          heroW: document.querySelector('[gs-id="hero"]')?.gridstackNode?.w,
        };
      })()`);
      await delay(60);
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await delay(300);
      const mobileWidened = await value(`(() => ({
        gridColumns: window.JoeBoard.gridColumnCount(),
        desktopColumns: window.JoeBoard.desktopColumnCount(),
        heroW: document.querySelector('[gs-id="hero"]')?.gridstackNode?.w,
      }))()`);
      if (
        mobileReloaded.catalogCount < 2 || mobileReloaded.settings.columns !== 6 ||
        !mobileReloaded.expectedSelected || mobileReloaded.selected !== mobileReloaded.expectedSelected ||
        mobileReloaded.gridColumns !== 1 || mobileReloaded.desktopColumns !== 6 || mobileReloaded.heroW !== 1 ||
        mobileWidened.gridColumns !== 6 || mobileWidened.desktopColumns !== 6 || mobileWidened.heroW !== 6
      ) throw new Error(`Mobile save reload mismatch: ${JSON.stringify({ mobileReloaded, mobileWidened })}`);
    } else {
      const staleSnapshot = structuredClone(sample);
      staleSnapshot.generatedAt = new Date(Date.now() - 3600_000).toISOString();
      stale = await value(`(() => {
        const equityBefore = document.getElementById('totalEquity')?.textContent;
        const dayBefore = document.getElementById('totalDay')?.textContent;
        window.JoeBoard.ingest(${JSON.stringify(staleSnapshot)});
        return {
          state: document.documentElement.dataset.joeState,
          freshness: document.getElementById('freshValue')?.textContent,
          alarm: document.getElementById('alarmText')?.textContent,
          equityRetained: document.getElementById('totalEquity')?.textContent === equityBefore,
          dayUnavailable: document.getElementById('totalDay')?.textContent === '—',
          dayBefore,
        };
      })()`);
      if (stale.state !== "attention" || !stale.freshness.startsWith("STALE") || !/stale/i.test(stale.alarm || "") || !stale.equityRetained || !stale.dayUnavailable || stale.dayBefore !== "—") throw new Error(`Stale state mismatch: ${JSON.stringify(stale)}`);

      const brokenSnapshot = structuredClone(sample);
      brokenSnapshot.generatedAt = new Date().toISOString();
      brokenSnapshot.safety.halt = true;
      brokenSnapshot.safety.haltReason = "Operator check";
      brokenSnapshot.safety.gateway.status = "down";
      brokenSnapshot.safety.gateway.detail = "No heartbeat";
      broken = await value(`(() => { window.JoeBoard.ingest(${JSON.stringify(brokenSnapshot)}); return { state: document.documentElement.dataset.joeState, alarm: document.getElementById('alarmText')?.textContent }; })()`);
      if (broken.state !== "attention" || !/HALT is on/.test(broken.alarm || "") || !/Gateway is down/.test(broken.alarm || "")) throw new Error(`Broken state mismatch: ${JSON.stringify(broken)}`);

      const positionsSnapshot = structuredClone(sample);
      positionsSnapshot.generatedAt = new Date().toISOString();
      positionsSnapshot.totals.openPnl = 17.25;
      positionsSnapshot.desks[0].money.openPnl = 12.5;
      positionsSnapshot.desks[0].tradeCount = 4;
      positionsSnapshot.positions = [
        { desk: "j", symbol: "DEMO1", side: "Long", quantity: 2, mark: 101, marketValue: 202, dayPnl: 4.5, openPnl: 12.5, updatedAt: new Date().toISOString() },
        { desk: "joel", symbol: "DEMO2", side: "Short", quantity: -1, mark: 88, marketValue: -88, dayPnl: -1, openPnl: 4.75, updatedAt: new Date().toISOString() },
      ];
      richSnapshot = await value(`(() => { window.JoeBoard.ingest(${JSON.stringify(positionsSnapshot)}); return { rows: document.querySelectorAll('#positionsBody tr').length, symbols: document.getElementById('positionsBody')?.innerText, open: document.getElementById('totalOpen')?.textContent, totalDay: document.getElementById('totalDay')?.textContent, positionDayCells: [...document.querySelectorAll('#positionsBody td.number.neutral')].map((node) => node.textContent), tradeCount: document.querySelector('[data-desk-slot="j"] .desk-money-row')?.innerText }; })()`);
      if (richSnapshot.rows !== 2 || !/DEMO1/.test(richSnapshot.symbols || "") || !/17,25/.test(richSnapshot.open || "") || richSnapshot.totalDay !== "—" || !richSnapshot.positionDayCells?.every((value) => value === "—") || !/4/.test(richSnapshot.tradeCount || "")) throw new Error(`Rich snapshot mismatch: ${JSON.stringify(richSnapshot)}`);

      const partialBackfill = structuredClone(sample);
      partialBackfill.generatedAt = new Date().toISOString();
      partialBackfill.brokerAccount.observedAt = partialBackfill.generatedAt;
      partialBackfill.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
      partialBackfill.totals = { equity: null, dayPnl: null, totalPnl: null };
      const capturedStart = Date.now() - 6 * 3600_000;
      const capturedAt = offset => new Date(capturedStart + offset).toISOString();
      partialBackfill.desks[0].backfill = {
        status: "BEST_AVAILABLE",
        fullTotalAvailable: false,
        capturedSubtotal: {
          realizedPnl: -37.125,
          currency: "USD",
          method: "captured-fifo-matched-roundtrips",
          executionCount: 43,
          commissionCount: 42,
          fromInclusive: capturedAt(0),
          throughInclusive: capturedAt(5 * 60_000),
          points: [
            { at: capturedAt(20_000), realizedPnl: -4.5 },
            { at: capturedAt(80_000), realizedPnl: 8.25 },
            { at: capturedAt(260_000), realizedPnl: 8.25 },
            { at: capturedAt(5 * 60_000), realizedPnl: -37.125 },
          ],
          pointsTruncated: true,
        },
        coverage: { target: { fromInclusive: capturedAt(0), toExclusive: capturedAt(20 * 60_000) }, completeIntervalCount: 0, knownIntervalCount: 1, gapCount: 1, firstGap: { fromInclusive: capturedAt(5 * 60_000), toExclusive: capturedAt(20 * 60_000) } },
        missingOpeningLotCount: 1,
        orphanCommissionCount: 1,
      };
      backfillSnapshot = await value(`(() => {
        window.JoeBoard.ingest(${JSON.stringify(partialBackfill)});
        const card = document.querySelector('[data-desk-slot="j"] .desk-backfill');
        const details = card?.querySelector('.desk-backfill-history');
        details?.querySelector('summary')?.click();
        document.querySelector('button[data-range="1d"]')?.click();
        const svg = details?.querySelector('svg');
        return {
          text: card?.innerText,
          total: document.getElementById('totalEquity')?.textContent,
          title: details?.querySelector('summary')?.textContent,
          open: details?.open,
          svgRole: svg?.getAttribute('role'),
          svgLabel: svg?.getAttribute('aria-label'),
          path: svg?.querySelector('path')?.getAttribute('d'),
          pointCount: window.JoeBoard.capturedHistorySeries(${JSON.stringify(partialBackfill.desks[0].backfill)}).points.length,
          bounded: !card || card.scrollWidth <= card.clientWidth + 1,
          mainHistoryVisible: !document.getElementById('historyCaptured')?.hidden,
          mainHistoryTitle: document.getElementById('historyCapturedTitle')?.textContent,
          mainHistoryMeta: document.getElementById('historyCapturedMeta')?.textContent,
          mainHistoryPath: document.querySelector('#historyCapturedPlot path')?.getAttribute('d'),
          mainHistoryBounded: document.getElementById('historyCaptured')?.scrollWidth <= document.getElementById('historyCaptured')?.clientWidth + 1,
          rangePressed: document.querySelector('button[data-range="1d"]')?.getAttribute('aria-pressed'),
        };
      })()`);
      if (!/Captured results \(partial\)/i.test(backfillSnapshot.text || "") || !/USD/.test(backfillSnapshot.text || "") || !/43 fills/.test(backfillSnapshot.text || "") || !/Coverage gap/.test(backfillSnapshot.text || "") || !/Historical EUR FX is not evidenced/.test(backfillSnapshot.text || "") || backfillSnapshot.total !== "—") {
        throw new Error(`Backfill snapshot mismatch: ${JSON.stringify(backfillSnapshot)}`);
      }
      if (backfillSnapshot.title !== "Captured J history · USD · partial" || !backfillSnapshot.open ||
          backfillSnapshot.svgRole !== "img" || backfillSnapshot.svgLabel !== backfillSnapshot.title ||
          !backfillSnapshot.path || backfillSnapshot.pointCount !== 4 || !backfillSnapshot.bounded ||
          !backfillSnapshot.mainHistoryVisible || backfillSnapshot.mainHistoryTitle !== "Captured J results · USD · partial" ||
          !/1D window/.test(backfillSnapshot.mainHistoryMeta || "") || !/Historical EUR FX is not evidenced/.test(backfillSnapshot.mainHistoryMeta || "") ||
          !backfillSnapshot.mainHistoryPath || !backfillSnapshot.mainHistoryBounded || backfillSnapshot.rangePressed !== "true" ||
          !/J-family FIFO, net of fees/.test(backfillSnapshot.text || "") ||
          !/latest captured points/.test(backfillSnapshot.text || "")) {
        throw new Error(`Captured history interaction mismatch: ${JSON.stringify(backfillSnapshot)}`);
      }

      answerNextJavaScriptDialog(true);
      answerNextJavaScriptDialog(false);
      answerNextJavaScriptDialog(false);
      answerNextJavaScriptDialog(true);
      answerNextJavaScriptDialog(true);
      const layout = await value(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 60));
        const selectLayout = async (id) => {
          const select = document.getElementById('layoutSelect');
          select.value = id;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await pause();
        };
        document.getElementById('layoutMenu').setAttribute('open', '');
        const board = document.getElementById('joeGrid');
        const grid = board.gridstack;
        const hero = document.querySelector('[gs-id="hero"]');
        grid.update(hero, { h: 4 });
        await pause();
        const saved = JSON.parse(localStorage.getItem('joe-board-layout-v1'));
        const savedHero = saved && saved.find(item => item.id === 'hero');
        document.getElementById('resetLayout').click();
        await pause();
        const resetResult = {
          savedHeight: savedHero?.h,
          resetHeight: hero.gridstackNode.h,
          defaultHeight: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === 'default')?.items.find((item) => item.id === 'hero')?.h,
          selected: document.getElementById('layoutSelect').value,
        };

        grid.update(hero, { h: 4 });
        await pause();
        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Night layout';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const night = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Night layout');
        const afterSave = {
          renameDisabled: document.getElementById('renameLayout').disabled,
          saveDisabled: document.getElementById('saveLayout').disabled,
          selectedName: document.getElementById('layoutSelect').selectedOptions[0]?.textContent,
          count: window.JoeBoard.readLayoutsCatalog().layouts.length,
        };

        grid.update(hero, { h: 2 });
        await pause();
        const dirtySaveEnabled = !document.getElementById('saveLayout').disabled;
        document.getElementById('saveLayout').click();
        await pause();
        const afterOverwrite = {
          count: window.JoeBoard.readLayoutsCatalog().layouts.length,
          savedHeight: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === night?.id)?.items.find((item) => item.id === 'hero')?.h,
          saveDisabled: document.getElementById('saveLayout').disabled,
        };

        const beforeCollision = JSON.stringify(window.JoeBoard.readLayoutsCatalog());
        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Night layout';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const saveAsCollisionCancelled = JSON.stringify(window.JoeBoard.readLayoutsCatalog()) === beforeCollision;
        document.getElementById('layoutFormCancel').click();

        grid.update(hero, { h: 4 });
        await pause();
        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Morning layout';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const morning = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Morning layout');

        document.getElementById('renameLayout').click();
        document.getElementById('layoutNameInput').value = 'Night layout';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const renameCollisionCancelled = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === morning?.id)?.name === 'Morning layout';
        document.getElementById('layoutFormCancel').click();

        grid.update(hero, { h: 6 });
        await pause();
        await selectLayout(night.id);
        const savePromptOpen = document.getElementById('layoutUnsavedDialog').open;
        document.getElementById('layoutUnsavedSave').click();
        await pause();
        const dirtySaveSelect = {
          promptOpened: savePromptOpen,
          selected: document.getElementById('layoutSelect').value,
          loadedHeight: hero.gridstackNode.h,
          savedMorningHeight: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === morning.id)?.items.find((item) => item.id === 'hero')?.h,
        };

        grid.update(hero, { h: 5 });
        await pause();
        await selectLayout(morning.id);
        const cancelPromptOpen = document.getElementById('layoutUnsavedDialog').open;
        document.getElementById('layoutUnsavedCancel').click();
        await pause();
        const dirtyCancel = {
          promptOpened: cancelPromptOpen,
          selected: document.getElementById('layoutSelect').value,
          height: hero.gridstackNode.h,
        };

        await selectLayout(morning.id);
        return {
          resetResult,
          afterSave,
          dirtySaveEnabled,
          afterOverwrite,
          saveAsCollisionCancelled,
          renameCollisionCancelled,
          dirtySaveSelect,
          dirtyCancel,
          escapePromptOpen: document.getElementById('layoutUnsavedDialog').open,
          nightId: night.id,
          morningId: morning.id,
        };
      })()`);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await delay(60);
      const afterEscape = await value(`(() => ({
        open: document.getElementById('layoutUnsavedDialog').open,
        selected: document.getElementById('layoutSelect').value,
        height: document.querySelector('[gs-id="hero"]')?.gridstackNode?.h,
      }))()`);

      const destructiveLayout = await value(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 60));
        const select = document.getElementById('layoutSelect');
        const hero = document.querySelector('[gs-id="hero"]');
        select.value = ${JSON.stringify(layout.morningId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        const discardPromptOpen = document.getElementById('layoutUnsavedDialog').open;
        document.getElementById('layoutUnsavedDiscard').click();
        await pause();
        const afterDiscard = { selected: select.value, height: hero.gridstackNode.h };

        document.getElementById('deleteLayout').click();
        await pause();
        const afterDelete = {
          selectedName: select.selectedOptions[0]?.textContent,
          renameDisabled: document.getElementById('renameLayout').disabled,
          deleteDisabled: document.getElementById('deleteLayout').disabled,
          removed: !window.JoeBoard.readLayoutsCatalog().layouts.some(entry => entry.id === ${JSON.stringify(layout.morningId)}),
        };

        document.getElementById('joeGrid').gridstack.update(hero, { h: 4 });
        await pause();
        document.getElementById('resetLayout').click();
        await pause();
        const afterReset = { selected: select.value, height: hero.gridstackNode.h };

        select.value = ${JSON.stringify(layout.nightId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        const catalog = window.JoeBoard.readLayoutsCatalog();
        const names = catalog.layouts.map(entry => entry.name);
        const lastUsed = { selected: select.value, height: hero.gridstackNode.h };

        document.getElementById('seriesAll').click();
        await pause();
        const cleared = {
          selected: document.querySelectorAll('button[data-series][aria-pressed="true"]').length,
          empty: document.getElementById('historyEmpty')?.hidden === false,
          capturedHidden: document.getElementById('historyCaptured')?.hidden === true,
        };
        document.getElementById('seriesAll').click();
        await pause();
        const restored = document.querySelectorAll('button[data-series][aria-pressed="true"]').length;
        const restoredCapturedVisible = document.getElementById('historyCaptured')?.hidden === false;
        return { discardPromptOpen, afterDiscard, afterDelete, afterReset, noDuplicateNames: new Set(names).size === names.length, lastUsed, cleared, restored, restoredCapturedVisible };
      })()`);
      if (layout.resetResult.savedHeight !== 4 || layout.resetResult.resetHeight !== 3 || layout.resetResult.defaultHeight !== 3 || layout.resetResult.selected !== 'default') {
        throw new Error(`Layout persistence mismatch: ${JSON.stringify(layout.resetResult)}`);
      }
      if (layout.afterSave.renameDisabled || !layout.afterSave.saveDisabled || layout.afterSave.selectedName !== 'Night layout') {
        throw new Error(`Save layout control state mismatch: ${JSON.stringify(layout.afterSave)}`);
      }
      if (!layout.dirtySaveEnabled || layout.afterOverwrite.count !== layout.afterSave.count || layout.afterOverwrite.savedHeight !== 2 || !layout.afterOverwrite.saveDisabled) {
        throw new Error(`Named layout overwrite mismatch: ${JSON.stringify(layout.afterOverwrite)}`);
      }
      if (!layout.saveAsCollisionCancelled || !layout.renameCollisionCancelled) {
        throw new Error(`Layout collision cancellation mismatch: ${JSON.stringify(layout)}`);
      }
      if (!layout.dirtySaveSelect.promptOpened || layout.dirtySaveSelect.selected !== layout.nightId || layout.dirtySaveSelect.loadedHeight !== 2 || layout.dirtySaveSelect.savedMorningHeight !== 6) {
        throw new Error(`Dirty save/select mismatch: ${JSON.stringify(layout.dirtySaveSelect)}`);
      }
      if (!layout.dirtyCancel.promptOpened || layout.dirtyCancel.selected !== layout.nightId || layout.dirtyCancel.height !== 5 || !layout.escapePromptOpen || afterEscape.open || afterEscape.selected !== layout.nightId || afterEscape.height !== 5) {
        throw new Error(`Dirty cancel mismatch: ${JSON.stringify({ button: layout.dirtyCancel, escapePromptOpen: layout.escapePromptOpen, afterEscape })}`);
      }
      if (!destructiveLayout.discardPromptOpen || destructiveLayout.afterDiscard.selected !== layout.morningId || destructiveLayout.afterDiscard.height !== 6 ||
          destructiveLayout.afterDelete.selectedName !== 'Default' || !destructiveLayout.afterDelete.renameDisabled || !destructiveLayout.afterDelete.deleteDisabled || !destructiveLayout.afterDelete.removed ||
          destructiveLayout.afterReset.selected !== 'default' || destructiveLayout.afterReset.height !== 3 || !destructiveLayout.noDuplicateNames ||
          destructiveLayout.lastUsed.selected !== layout.nightId || destructiveLayout.lastUsed.height !== 2) {
        throw new Error(`Discard/delete/reset layout mismatch: ${JSON.stringify(destructiveLayout)}`);
      }
      if (destructiveLayout.cleared.selected !== 0 || !destructiveLayout.cleared.empty || !destructiveLayout.cleared.capturedHidden || destructiveLayout.restored !== 3 || !destructiveLayout.restoredCapturedVisible) {
        throw new Error(`History UX mismatch: ${JSON.stringify({ cleared: destructiveLayout.cleared, restored: destructiveLayout.restored })}`);
      }

      const cancelledDefaultSaveAs = await value(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 60));
        const select = document.getElementById('layoutSelect');
        const hero = document.querySelector('[gs-id="hero"]');
        select.value = 'default';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        const defaultLoadedClean = select.value === 'default' && hero.gridstackNode.h === 3;

        document.getElementById('joeGrid').gridstack.update(hero, { h: 4 });
        await pause();
        select.value = ${JSON.stringify(layout.nightId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        const dirtyPromptOpen = document.getElementById('layoutUnsavedDialog').open;
        document.getElementById('layoutUnsavedSave').click();
        await pause();
        const layoutMenu = document.getElementById('layoutMenu');
        const layoutForm = document.getElementById('layoutInlineForm');
        const nameInput = document.getElementById('layoutNameInput');
        const nameInputStyle = getComputedStyle(nameInput);
        const nameInputRect = nameInput.getBoundingClientRect();
        const defaultSaveAsPrompt = {
          formOpen: !layoutForm.hidden,
          menuOpen: layoutMenu.open,
          nameFieldVisible: nameInput.getClientRects().length > 0 && nameInputRect.width > 0 && nameInputRect.height > 0 && nameInputStyle.display !== 'none' && nameInputStyle.visibility !== 'hidden',
          nameFieldFocused: document.activeElement === nameInput,
        };
        document.getElementById('layoutFormCancel').click();
        await pause();

        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Fresh after cancel';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const fresh = window.JoeBoard.readLayoutsCatalog().layouts.find(entry => entry.name === 'Fresh after cancel');
        const afterFreshSave = {
          selectedId: select.value,
          selectedName: select.selectedOptions[0]?.textContent,
          freshId: fresh?.id,
          savedHeight: fresh?.items.find(item => item.id === 'hero')?.h,
        };

        select.value = ${JSON.stringify(layout.nightId)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        return {
          defaultLoadedClean,
          dirtyPromptOpen,
          defaultSaveAsPrompt,
          afterFreshSave,
          pendingTargetId: ${JSON.stringify(layout.nightId)},
          restored: { selectedId: select.value, heroHeight: hero.gridstackNode.h },
        };
      })()`);
      if (!cancelledDefaultSaveAs.defaultLoadedClean || !cancelledDefaultSaveAs.dirtyPromptOpen || !cancelledDefaultSaveAs.defaultSaveAsPrompt.formOpen ||
          !cancelledDefaultSaveAs.defaultSaveAsPrompt.menuOpen || !cancelledDefaultSaveAs.defaultSaveAsPrompt.nameFieldVisible || !cancelledDefaultSaveAs.defaultSaveAsPrompt.nameFieldFocused ||
          !cancelledDefaultSaveAs.afterFreshSave.freshId || cancelledDefaultSaveAs.afterFreshSave.selectedId !== cancelledDefaultSaveAs.afterFreshSave.freshId ||
          cancelledDefaultSaveAs.afterFreshSave.selectedId === cancelledDefaultSaveAs.pendingTargetId || cancelledDefaultSaveAs.afterFreshSave.selectedName !== 'Fresh after cancel' ||
          cancelledDefaultSaveAs.afterFreshSave.savedHeight !== 4 || cancelledDefaultSaveAs.restored.selectedId !== layout.nightId || cancelledDefaultSaveAs.restored.heroHeight !== 2) {
        throw new Error(`Cancelled Default Save As resumed pending navigation: ${JSON.stringify(cancelledDefaultSaveAs)}`);
      }

      await send("Page.reload", { ignoreCache: true });
      await delay(600);
      await navigate(hsb1Url, "document.getElementById('joeGrid')?.gridstack");
      const lastUsedReload = await value(`(() => ({
        selected: document.getElementById('layoutSelect').value,
        expected: ${JSON.stringify(layout.nightId)},
        heroHeight: document.querySelector('[gs-id="hero"]')?.gridstackNode?.h,
      }))()`);
      if (lastUsedReload.selected !== lastUsedReload.expected || lastUsedReload.heroHeight !== 2) {
        throw new Error(`Last-used layout reload mismatch: ${JSON.stringify(lastUsedReload)}`);
      }

      const preferences = await value(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 60));
        const layoutItems = JSON.parse(localStorage.getItem('joe-board-layout-v1'));
        const alternateItems = layoutItems.map(item => item.id === 'hero' ? { ...item, h: item.h + 1 } : item);
        const legacyWrite = window.JoeBoard.writeLayoutsCatalog({
          schema: 'inspr.joe.layouts.v1',
          layouts: [
            { id: 'legacy-layout', name: 'Legacy layout', items: layoutItems },
            { id: 'legacy-layout-2', name: 'Legacy layout', items: alternateItems },
          ]
        });
        const legacyEntries = window.JoeBoard.readLayoutsCatalog().layouts.filter((entry) => entry.id.startsWith('legacy-layout'));
        const legacyEntry = legacyEntries.find((entry) => entry.id === 'legacy-layout');
        document.getElementById('settingsMenu').setAttribute('open', '');
        document.getElementById('settingsColumns').value = '6';
        document.getElementById('settingsCellHeight').value = '96';
        document.getElementById('settingsTilePadding').value = '8';
        document.getElementById('settingsTileGap').value = '12';
        document.getElementById('settingsCancel').click();
        const cancelled = window.JoeBoard.readActiveGridSettings();
        document.getElementById('settingsMenu').setAttribute('open', '');
        document.getElementById('settingsColumns').value = '6';
        document.getElementById('settingsCellHeight').value = '96';
        document.getElementById('settingsTilePadding').value = '8';
        document.getElementById('settingsTileGap').value = '12';
        document.getElementById('settingsApply').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const applied = window.JoeBoard.readActiveGridSettings();
        const appliedGridColumns = window.JoeBoard.gridColumnCount();
        document.getElementById('layoutMenu').setAttribute('open', '');
        document.getElementById('saveAsLayout').click();
        document.getElementById('layoutNameInput').value = 'Wide six';
        document.getElementById('layoutFormConfirm').click();
        await pause();
        const savedEntry = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Wide six');
        window.JoeBoard.applyGridSettings({ columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 });
        await pause();
        const select = document.getElementById('layoutSelect');
        select.value = 'legacy-layout';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        document.getElementById('layoutUnsavedDiscard').click();
        await pause();
        select.value = savedEntry.id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await pause();
        const loadedSettings = window.JoeBoard.readActiveGridSettings();
        const loadedGridColumns = window.JoeBoard.gridColumnCount();
        document.getElementById('renameLayout').click();
        document.getElementById('layoutNameInput').value = 'Wide six renamed';
        document.getElementById('layoutFormConfirm').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const renamed = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === savedEntry.id);
        return {
          legacyWrite,
          legacySettings: legacyEntry?.settings,
          legacyNames: legacyEntries.map(entry => entry.name),
          legacyHeroHeights: legacyEntries.map(entry => entry.items.find(item => item.id === 'hero')?.h),
          cancelledColumns: cancelled.columns,
          applied,
          appliedGridColumns,
          savedSettings: savedEntry?.settings,
          loadedSettings,
          loadedGridColumns,
          renamedSettings: renamed?.settings,
          historyPointCount: ${historyPoints.length}
        };
      })()`);
      if (!preferences.legacyWrite || preferences.legacySettings?.columns !== 12 || preferences.legacyNames.length !== 2 ||
          new Set(preferences.legacyNames).size !== 2 || new Set(preferences.legacyHeroHeights).size !== 2) {
        throw new Error(`Legacy layout migration mismatch: ${JSON.stringify(preferences)}`);
      }
      if (preferences.cancelledColumns === 6 || preferences.applied.columns !== 6 || preferences.applied.cellHeight !== 96 || preferences.appliedGridColumns !== 6) {
        throw new Error(`Settings apply/cancel mismatch: ${JSON.stringify(preferences)}`);
      }
      if (preferences.savedSettings?.columns !== 6 || preferences.loadedSettings.columns !== 6 || preferences.loadedGridColumns !== 6 || preferences.renamedSettings?.columns !== 6) {
        throw new Error(`Layout settings persistence mismatch: ${JSON.stringify(preferences)}`);
      }
      if (preferences.historyPointCount !== historyPoints.length) {
        throw new Error(`History point count changed: ${JSON.stringify(preferences)}`);
      }
      if (javascriptDialogDecisions.length || javascriptDialogs.length < 5 || javascriptDialogs.some(dialog => dialog.type !== 'confirm')) {
        throw new Error(`Native confirmation coverage mismatch: ${JSON.stringify({ pending: javascriptDialogDecisions, dialogs: javascriptDialogs })}`);
      }

      await send("Page.reload", { ignoreCache: true });
      await delay(600);
      await navigate(hsb1Url, "document.documentElement.dataset.joeState");
      const reloaded = await value(`(() => ({
        settings: window.JoeBoard.readActiveGridSettings(),
        desktopColumns: window.JoeBoard.desktopColumnCount(),
        gridColumns: window.JoeBoard.gridColumnCount(),
        historyPointCount: document.querySelectorAll('#historyChart').length ? 1 : 0
      }))()`);
      if (reloaded.settings.columns !== 6 || reloaded.desktopColumns !== 6 || reloaded.gridColumns !== 6) {
        throw new Error(`Reloaded settings mismatch: ${JSON.stringify(reloaded)}`);
      }

      const geometryBeforeMobile = await value(`(() => document.getElementById('joeGrid').gridstack.engine.nodes.map((node) => ({ id: node.id, x: node.x, w: node.w })).sort((a, b) => a.id.localeCompare(b.id)))()`);
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await delay(300);
      const mobileColumns = await value(`(() => ({
        gridColumns: window.JoeBoard.gridColumnCount(),
        desktopColumns: window.JoeBoard.desktopColumnCount(),
        storedColumns: JSON.parse(localStorage.getItem('joe-board-grid-settings-v1') || 'null')?.columns,
        viewport: document.documentElement.dataset.joeViewport,
        narrowBreakpoint: window.JoeBoard.narrowBreakpoint,
      }))()`);
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await delay(300);
      const afterMobile = await value(`(() => ({
        gridColumns: window.JoeBoard.gridColumnCount(),
        desktopColumns: window.JoeBoard.desktopColumnCount(),
        geometry: document.getElementById('joeGrid').gridstack.engine.nodes.map((node) => ({ id: node.id, x: node.x, w: node.w })).sort((a, b) => a.id.localeCompare(b.id))
      }))()`);
      if (mobileColumns.gridColumns !== 1 || mobileColumns.desktopColumns !== 6 || mobileColumns.storedColumns !== 6 || mobileColumns.viewport !== "narrow" || mobileColumns.narrowBreakpoint !== 700) {
        throw new Error(`Mobile column roundtrip mismatch (narrow): ${JSON.stringify(mobileColumns)}`);
      }
      if (afterMobile.gridColumns !== 6 || afterMobile.desktopColumns !== 6 || JSON.stringify(afterMobile.geometry) !== JSON.stringify(geometryBeforeMobile)) {
        throw new Error(`Mobile column roundtrip mismatch (desktop restore): ${JSON.stringify({ afterMobile, geometryBeforeMobile })}`);
      }

      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
      const theme = await value(`(() => {
        window.JoeBoard.applyTheme('light');
        const light = document.documentElement.dataset.theme;
        window.JoeBoard.applyTheme('dark');
        const dark = document.documentElement.dataset.theme;
        window.JoeBoard.applyTheme('system');
        const systemResolved = document.documentElement.dataset.theme;
        window.JoeBoard.applyTheme('dark');
        const explicitDark = document.documentElement.dataset.theme;
        return { light, dark, systemResolved, explicitDark };
      })()`);
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
      const systemDark = await value(`(() => {
        window.JoeBoard.applyTheme('system');
        return document.documentElement.dataset.theme;
      })()`);
      if (theme.light !== "light" || theme.dark !== "dark" || theme.systemResolved !== "light" || theme.explicitDark !== "dark" || systemDark !== "dark") {
        throw new Error(`Theme preference mismatch: ${JSON.stringify({ theme, systemDark })}`);
      }
    }
  }

  const source = await readFile(join(repoRoot, "public", "joe", "index.html"), "utf8");
  if (/DUR\d+|1,001,403|SXR8|TSLA/.test(source)) throw new Error("Static /joe/ source still contains Paper-Drill account or position data");
  if (exceptions.length) throw new Error(`Runtime exceptions: ${exceptions.join("; ")}`);
  console.log(JSON.stringify({ healthy, historyGeometry, mobile, stale, broken, richSnapshot, backfillSnapshot, stub: stub && { ...stub, text: "private stub" }, dataRequests: requests.filter(item => item.path === "/joe/data.json") }, null, 2));
  await withTimeout(send("Browser.close").catch(() => {}), 1000);
  ws.close();
} finally {
  await cleanup();
}
