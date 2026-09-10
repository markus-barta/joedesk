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
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text || "runtime exception");
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
  async function navigate(url, readyExpression) {
    await send("Page.navigate", { url });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await value(`Boolean(${readyExpression})`).catch(() => false)) return;
      await delay(100);
    }
    throw new Error(`Page did not become ready: ${url}`);
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
    brandLogo: Boolean(document.querySelector('.brand-logo')),
    marketingCopy: /Three bots|quiet answer/i.test(document.body.innerText),
    heroId: document.querySelector('[gs-id="hero"]')?.getAttribute('gs-id'),
    positionFallback: document.getElementById('positionsBody')?.innerText,
    zoomPlugin: Boolean(window.Chart?.registry?.plugins?.get('zoom')),
    externalScripts: [...document.scripts].filter(script => script.src && new URL(script.src).origin !== location.origin).length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))()`);
    if (
      healthy.view !== "board" || healthy.state !== "ok" ||
      JSON.stringify(healthy.deskIds) !== JSON.stringify(["j", "joe", "joel"]) ||
      !healthy.states.includes("Working") || !healthy.states.includes("Sitting out") ||
      !/30[\.\s]000/.test(healthy.total || "") || !/^OK · connected/.test(healthy.gateway || "") ||
      healthy.totalDay !== "—" || !/not available yet/i.test(healthy.totalDayTitle || "") ||
      !/Day P&L is not available yet/i.test(healthy.attributionDay || "") ||
      !healthy.halt.startsWith("Off") || !healthy.alarmHidden || !healthy.gridReady || healthy.widgets !== 7 ||
      healthy.selectedSeries !== 3 || healthy.allBotsPressed !== "true" ||
      healthy.historyTitle !== "History" || /drag here|compare up to two/i.test(healthy.historyHelp || "") ||
      healthy.deskLabel !== "Desks" || healthy.rangeLabel !== "Range" ||
      !/v0\.4\.1/.test(healthy.versionSummary || "") || healthy.versionEntries < 4 ||
      !healthy.layoutSelectOptions || healthy.layoutSelectOptions < 1 ||
      !healthy.layoutMenu || !healthy.settingsMenu || !healthy.brandLogo || healthy.marketingCopy ||
      healthy.heroId !== "hero" ||
      !/not present/i.test(healthy.positionFallback || "") || !healthy.zoomPlugin || healthy.externalScripts || healthy.overflow
    ) throw new Error(`Healthy board mismatch: ${JSON.stringify(healthy)}`);

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
      const liveHero = document.querySelector('[gs-id="hero"]')?.gridstackNode;
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
        mobile.defaultHeroY !== 0 || mobile.defaultHeroH !== 3 || mobile.liveHeroY !== 0 || mobile.liveHeroH !== 3 ||
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
        document.getElementById('saveLayout').click();
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
        document.getElementById('layoutMenu').setAttribute('open', '');
        if (renamed) document.getElementById('layoutSelect').value = renamed.id;
        document.getElementById('loadLayout').click();
        return {
          catalogCount: window.JoeBoard.readLayoutsCatalog().layouts.length,
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

      const layout = await value(`(async () => {
        document.getElementById('layoutMenu').setAttribute('open', '');
        const board = document.getElementById('joeGrid');
        const grid = board.gridstack;
        const hero = document.querySelector('[gs-id="hero"]');
        grid.update(hero, { h: 4 });
        await new Promise(resolve => setTimeout(resolve, 50));
        const saved = JSON.parse(localStorage.getItem('joe-board-layout-v1'));
        const savedHero = saved && saved.find(item => item.id === 'hero');
        document.getElementById('resetLayout').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const resetResult = {
          savedHeight: savedHero?.h,
          resetHeight: hero.gridstackNode.h,
          defaultHeight: window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === 'default')?.items.find((item) => item.id === 'hero')?.h,
          storageRepersisted: localStorage.getItem('joe-board-layout-v1') !== null
        };
        grid.update(hero, { h: 4 });
        await new Promise(resolve => setTimeout(resolve, 50));
        document.getElementById('saveLayout').click();
        document.getElementById('layoutNameInput').value = 'Night layout';
        document.getElementById('layoutFormConfirm').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterSave = {
          renameDisabled: document.getElementById('renameLayout').disabled,
          selectedName: document.getElementById('layoutSelect').selectedOptions[0]?.textContent
        };
        document.getElementById('renameLayout').click();
        document.getElementById('layoutNameInput').value = 'Morning layout';
        document.getElementById('layoutFormConfirm').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterRename = document.getElementById('layoutSelect').selectedOptions[0]?.textContent;
        grid.update(hero, { h: 2 });
        await new Promise(resolve => setTimeout(resolve, 50));
        const heightBeforeLoad = hero.gridstackNode.h;
        document.getElementById('loadLayout').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const loadedHeight = hero.gridstackNode.h;
        document.getElementById('deleteLayout').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterDelete = {
          selectedName: document.getElementById('layoutSelect').selectedOptions[0]?.textContent,
          renameDisabled: document.getElementById('renameLayout').disabled,
          deleteDisabled: document.getElementById('deleteLayout').disabled
        };
        document.getElementById('seriesAll').click();
        await new Promise(resolve => setTimeout(resolve, 25));
        const cleared = {
          selected: document.querySelectorAll('button[data-series][aria-pressed="true"]').length,
          empty: document.getElementById('historyEmpty')?.hidden === false
        };
        document.getElementById('seriesAll').click();
        await new Promise(resolve => setTimeout(resolve, 25));
        const restored = document.querySelectorAll('button[data-series][aria-pressed="true"]').length;
        return { resetResult, afterSave, afterRename, heightBeforeLoad, loadedHeight, afterDelete, cleared, restored };
      })()`);
      if (layout.resetResult.savedHeight !== 4 || layout.resetResult.resetHeight !== 3 || layout.resetResult.defaultHeight !== 3 || !layout.resetResult.storageRepersisted) {
        throw new Error(`Layout persistence mismatch: ${JSON.stringify(layout.resetResult)}`);
      }
      if (layout.afterSave.renameDisabled || layout.afterSave.selectedName !== 'Night layout') {
        throw new Error(`Save layout control state mismatch: ${JSON.stringify(layout.afterSave)}`);
      }
      if (layout.afterRename !== 'Morning layout' || layout.heightBeforeLoad !== 2 || layout.loadedHeight !== 4) {
        throw new Error(`Rename/load layout mismatch: ${JSON.stringify({ afterRename: layout.afterRename, heightBeforeLoad: layout.heightBeforeLoad, loadedHeight: layout.loadedHeight })}`);
      }
      if (layout.afterDelete.selectedName !== 'Default' || !layout.afterDelete.renameDisabled || !layout.afterDelete.deleteDisabled) {
        throw new Error(`Delete layout control state mismatch: ${JSON.stringify(layout.afterDelete)}`);
      }
      if (layout.cleared.selected !== 0 || !layout.cleared.empty || layout.restored !== 3) {
        throw new Error(`History UX mismatch: ${JSON.stringify({ cleared: layout.cleared, restored: layout.restored })}`);
      }

      const preferences = await value(`(async () => {
        const layoutItems = JSON.parse(localStorage.getItem('joe-board-layout-v1'));
        const legacyWrite = window.JoeBoard.writeLayoutsCatalog({
          schema: 'inspr.joe.layouts.v1',
          layouts: [{ id: 'legacy-layout', name: 'Legacy layout', items: layoutItems }]
        });
        const legacyEntry = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.id === 'legacy-layout');
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
        document.getElementById('saveLayout').click();
        document.getElementById('layoutNameInput').value = 'Wide six';
        document.getElementById('layoutFormConfirm').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const savedEntry = window.JoeBoard.readLayoutsCatalog().layouts.find((entry) => entry.name === 'Wide six');
        window.JoeBoard.applyGridSettings({ columns: 12, cellHeight: 82, tilePadding: 10, tileGap: 10 });
        await new Promise((resolve) => setTimeout(resolve, 50));
        document.getElementById('loadLayout').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
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
      if (!preferences.legacyWrite || preferences.legacySettings?.columns !== 12) {
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
  console.log(JSON.stringify({ healthy, mobile, stale, broken, richSnapshot, stub: stub && { ...stub, text: "private stub" }, dataRequests: requests.filter(item => item.path === "/joe/data.json") }, null, 2));
  await withTimeout(send("Browser.close").catch(() => {}), 1000);
  ws.close();
} finally {
  await cleanup();
}
