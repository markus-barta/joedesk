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
let fleetConfig = JSON.parse(await readFile(join(repoRoot, "public/joe/fleet-config.example.json"), "utf8"));
const fleetActions = [];

function refreshSnapshotObservationTimes(snapshot, generatedAt = new Date().toISOString()) {
  snapshot.generatedAt = generatedAt;
  snapshot.safety.gateway.lastSeenAt = generatedAt;
  if (snapshot.brokerAccount) snapshot.brokerAccount.observedAt = generatedAt;
  for (const source of Object.values(snapshot.pnlSources || {})) {
    if (source?.status === "available") source.observedAt = generatedAt;
  }
  for (const desk of snapshot.desks || []) {
    if (desk.moneyEvidence) desk.moneyEvidence.observedAt = generatedAt;
  }
  return snapshot;
}

function smokeFleetAction({ revBefore, revAfter, changedKeys, outcome, reason }) {
  return {
    id: `fa-${Date.now()}-00000000`,
    at: new Date().toISOString(),
    actor: "amy-smoke",
    revBefore,
    revAfter,
    changedKeys,
    outcome,
    reason,
  };
}

async function writeSnapshot(overrides = {}) {
  const snapshot = refreshSnapshotObservationTimes(structuredClone(sample), overrides.generatedAt || new Date().toISOString());
  snapshot.brokerAccount.observedAt = overrides.brokerObservedAt || snapshot.generatedAt;
  if (overrides.halt !== undefined) snapshot.safety.halt = overrides.halt;
  if (overrides.haltReason !== undefined) snapshot.safety.haltReason = overrides.haltReason;
  if (overrides.gatewayStatus) snapshot.safety.gateway.status = overrides.gatewayStatus;
  if (overrides.gatewayDetail !== undefined) snapshot.safety.gateway.detail = overrides.gatewayDetail;
  await writeFile(join(site, "joe", "data.json"), JSON.stringify(snapshot));
  return snapshot;
}

const initialSnapshot = await writeSnapshot();
const honestPnlSnapshot = structuredClone(initialSnapshot);
honestPnlSnapshot.desks.forEach((desk) => {
  desk.money.dayPnl = null;
  desk.money.openPnl = null;
});
honestPnlSnapshot.totals.dayPnl = null;
honestPnlSnapshot.totals.openPnl = null;
honestPnlSnapshot.pnlSources = {
  day: {
    status: "unavailable",
    method: null,
    currency: "EUR",
    scope: "virtual-desks",
    observedAt: null,
    periodStart: null,
    detail: "SOD baseline pending - HOSTD-33",
  },
  open: {
    status: "unavailable",
    method: null,
    currency: "EUR",
    scope: "virtual-desks",
    observedAt: null,
    detail: "IB unrealized feed not wired yet - HOSTD-33",
  },
};

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

const historyReferenceMs = Date.now();
const historyOffsetsMs = [40 * 86400_000, 32 * 86400_000, 25 * 86400_000, 8 * 86400_000, 23 * 3600_000, 16 * 3600_000, 8 * 3600_000, 1000];
const historyPoints = historyOffsetsMs.map((offset, index) => ({
  t: new Date(historyReferenceMs - offset).toISOString(),
  desks: {
    j: { equity: 10000 + index * 4, dayPnl: index * 4, totalPnl: 100 + index * 4 },
    joe: { equity: 10000 - index, dayPnl: -index, totalPnl: -40 - index },
    joel: { equity: 10000 + index * 2, dayPnl: index * 2, totalPnl: 230 + index * 2 },
  },
  totals: { equity: 30000 + index * 5, dayPnl: index * 5, totalPnl: 290 + index * 5 },
}));
delete historyPoints[4].desks.j;
delete historyPoints[4].desks.joe;
delete historyPoints[4].desks.joel;
historyPoints[5].desks.j.equity = null;
historyPoints[5].desks.joe.equity = null;
historyPoints[5].desks.joel.equity = null;
await writeFile(join(site, "joe", "history.json"), JSON.stringify({
  schema: "inspr.joe.household.history.v1",
  generatedAt: new Date().toISOString(),
  currency: "EUR",
  points: historyPoints,
}));

let historyUnavailable = false;
let fleetUnavailable = false;
let fleetActionsUnavailable = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://local.test");
  requests.push({ host: request.headers.host || "", path: url.pathname });
  if (request.method === "GET" && ((fleetUnavailable && url.pathname === "/joe/fleet-config.json") || (fleetActionsUnavailable && url.pathname === "/joe/fleet-config/actions.json"))) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "synthetic unavailable fixture" }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/joe/fleet-config.json") {
    response.writeHead(200, {
      "content-type": "application/json", "cache-control": "no-store",
      "X-Joe-Fleet-Source-Path": fleetConfig.rev === "fc-000000" ? "/app/public/joe/fleet-config.example.json" : "/var/lib/joe-board/fleet-config.json",
      "X-Joe-Fleet-Source-Kind": fleetConfig.rev === "fc-000000" ? "example" : "stored",
    });
    response.end(JSON.stringify(fleetConfig));
    return;
  }
  if (request.method === "GET" && url.pathname === "/joe/fleet-config/actions.json") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ schema: "inspr.joe.fleet-config.actions.v1", entries: fleetActions }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/joe/fleet-config/propagate") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.baseRev !== fleetConfig.rev || body.config?.rev !== fleetConfig.rev) {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "fleet config revision conflict", currentRev: fleetConfig.rev }));
      return;
    }
    if (body.config.desks.maxBusyDesks === 3) {
      const action = smokeFleetAction({
        revBefore: fleetConfig.rev,
        revAfter: fleetConfig.rev,
        changedKeys: ["desks.maxBusyDesks"],
        outcome: "failure",
        reason: "schema_rejected",
      });
      fleetActions.push(action);
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "smoke policy rejected", action }));
      return;
    }
    const revBefore = fleetConfig.rev;
    const sequence = Number(fleetConfig.rev.slice(3)) + 1;
    const changedKeys = [
      ["desks.maxBusyDesks", fleetConfig.desks.maxBusyDesks, body.config.desks.maxBusyDesks],
      ["quota.behavior.amber", fleetConfig.quota.behavior.amber, body.config.quota.behavior.amber],
      ["cadence.wakeWindows", fleetConfig.cadence.wakeWindows, body.config.cadence.wakeWindows],
    ].filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after)).map(([key]) => key);
    fleetConfig = structuredClone(body.config);
    fleetConfig.rev = `fc-${String(sequence).padStart(6, "0")}`;
    fleetConfig.updatedAt = new Date().toISOString();
    const action = smokeFleetAction({
      revBefore,
      revAfter: fleetConfig.rev,
      changedKeys,
      outcome: "success",
      reason: "propagated",
    });
    fleetActions.push(action);
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({
      ok: true,
      rev: fleetConfig.rev,
      propagatedAt: fleetConfig.updatedAt,
      config: fleetConfig,
      adapter: { id: "shared-file", status: "written", path: "/var/lib/joe-board/fleet-config.json", consumers: ["amy", "desks"], reload: "read-on-revision" },
      action,
    }));
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  if (relative.includes("..")) {
    response.writeHead(400);
    response.end("bad request");
    return;
  }
  if (historyUnavailable && url.pathname === "/joe/history.json") {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("history temporarily unavailable");
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

async function waitForPageTarget() {
  const url = `http://127.0.0.1:${cdpPort}/json/list`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find(candidate => candidate.type === "page" && candidate.webSocketDebuggerUrl);
        if (page) return page;
      }
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
  const page = await waitForPageTarget();
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
  async function readPhoneOrderState() {
    return value(`(() => {
      const board = document.getElementById('joeGrid');
      const grid = board?.gridstack;
      const sortItems = (items) => (items || []).map((item) => ({
        id: item.id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      })).sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
      let storedDraft = null;
      let storedPhoneOrder = null;
      try {
        storedDraft = JSON.parse(localStorage.getItem(window.JoeBoard.layoutStorageKey) || 'null');
      } catch (_) {
        storedDraft = 'invalid JSON';
      }
      try {
        storedPhoneOrder = JSON.parse(localStorage.getItem('joe-board-phone-order-v1') || 'null');
      } catch (_) {
        storedPhoneOrder = 'invalid JSON';
      }
      const liveItems = sortItems(grid?.engine?.nodes);
      const storedDraftItems = Array.isArray(storedDraft) ? storedDraft : storedDraft?.items;
      const catalog = window.JoeBoard.readLayoutsCatalog();
      return {
        viewport: document.documentElement.dataset.joeViewport,
        viewportWidth: document.documentElement.clientWidth,
        gridColumns: grid?.getColumn(),
        order: liveItems.map((item) => item.id),
        liveItems,
        desktopGeometry: sortItems(window.JoeBoard.desktopLayoutSnapshot()),
        storedDraft: {
          items: Array.isArray(storedDraftItems) ? sortItems(storedDraftItems) : null,
          phoneOrder: Array.isArray(storedPhoneOrder) ? storedPhoneOrder.slice() : storedPhoneOrder,
        },
        selectedId: document.getElementById('layoutSelect')?.value,
        selectedName: document.getElementById('layoutSelect')?.selectedOptions[0]?.textContent,
        layouts: catalog.layouts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          builtin: Boolean(entry.builtin),
          phoneOrder: Array.isArray(entry.phoneOrder) ? entry.phoneOrder.slice() : null,
          items: sortItems(entry.items),
        })),
        dirty: document.getElementById('layoutToolbar')?.dataset.dirty === 'true',
        saveDisabled: document.getElementById('saveLayout')?.disabled,
      };
    })()`);
  }
  async function readPhoneOrderInstrumentation() {
    return value(`(() => {
      const proof = window.__joePhoneOrderProof || {};
      const gridEvents = proof.gridEvents || [];
      const summarize = (entries, keyFor) => entries.reduce((summary, entry) => {
        const key = keyFor(entry);
        summary[key] = (summary[key] || 0) + 1;
        return summary;
      }, {});
      return {
        capability: {
          maxTouchPoints: navigator.maxTouchPoints,
          documentTouchStart: 'ontouchstart' in document,
          windowTouchStart: 'ontouchstart' in window,
          anyPointerCoarse: window.matchMedia('(any-pointer: coarse)').matches,
        },
        registrations: summarize(proof.registrations || [], (entry) => entry.type + ':' + entry.target),
        inputEvents: summarize(proof.inputEvents || [], (entry) => entry.type + ':' + entry.trusted + ':' + (entry.pointerType || '')),
        firstInputEvents: (proof.inputEvents || []).slice(0, 4),
        lastInputEvents: (proof.inputEvents || []).slice(-4),
        gridEventCounts: summarize(gridEvents, (entry) => entry.type),
        sourceTrace: gridEvents.map((entry) => ({ type: entry.type, clientX: entry.clientX, clientY: entry.clientY, source: entry.source, dirty: entry.dirty })),
        orderEvents: gridEvents.filter((entry, index) => !index || JSON.stringify(entry.order) !== JSON.stringify(gridEvents[index - 1].order)),
      };
    })()`);
  }
  async function armPhoneOrderInstrumentation(label, sourceId) {
    await value(`(() => {
      const proof = window.__joePhoneOrderProof;
      if (!proof) return false;
      proof.label = ${JSON.stringify(label)};
      proof.sourceId = ${JSON.stringify(sourceId)};
      proof.inputEvents = [];
      proof.gridEvents = [];
      proof.armed = true;
      const grid = document.getElementById('joeGrid')?.gridstack;
      if (!grid) return false;
      const record = (event, type) => {
        if (proof.gridEvents.length >= 120) return;
        const items = grid.engine.nodes.slice().sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
        const source = grid.engine.nodes.find((item) => item.id === proof.sourceId);
        proof.gridEvents.push({
          type: type || event.type,
          trusted: event.isTrusted,
          clientX: event.clientX,
          clientY: event.clientY,
          order: items.map((item) => item.id),
          source: source && { id: source.id, x: source.x, y: source.y, w: source.w, h: source.h },
          dirty: document.getElementById('layoutToolbar')?.dataset.dirty === 'true',
        });
      };
      if (!proof.gridHooked) {
        proof.gridHooked = true;
        ['dragstart', 'drag', 'dragstop'].forEach((type) => {
          const original = grid._gsEventHandler?.[type];
          grid.on(type, function(...args) {
            if (original) original.apply(this, args);
            record(args[0], type);
          });
        });
        grid.el.addEventListener('change', (event) => record(event, 'change'));
      }
      return true;
    })()`);
  }
  async function preparePhoneOrderDrag(sourceId = "desk-joe", targetId = "desk-j") {
    const pair = await value(`(() => {
      const grid = document.getElementById('joeGrid')?.gridstack;
      const ordered = (grid?.engine?.nodes || []).slice().sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
      const targetNode = ordered.find((item) => item.id === ${JSON.stringify(targetId)});
      const sourceNode = ordered.find((item) => item.id === ${JSON.stringify(sourceId)});
      if (!sourceNode || !targetNode) return { error: 'requested source and target GridStack tiles are required' };
      if (sourceNode.w !== targetNode.w || sourceNode.h !== targetNode.h || sourceNode.y !== targetNode.y + targetNode.h) {
        return { error: 'requested source and target are not equal-sized adjacent tiles', source: { id: sourceNode.id, x: sourceNode.x, y: sourceNode.y, w: sourceNode.w, h: sourceNode.h }, target: { id: targetNode.id, x: targetNode.x, y: targetNode.y, w: targetNode.w, h: targetNode.h } };
      }
      const target = targetNode.el?.querySelector('.widget-drag');
      const source = sourceNode.el?.querySelector('.widget-drag');
      if (!source || !target) return { error: 'requested source and target do not both have .widget-drag handles' };
      const sourceDocumentY = source.getBoundingClientRect().top + window.scrollY;
      const targetDocumentY = target.getBoundingClientRect().top + window.scrollY;
      const midpoint = (sourceDocumentY + targetDocumentY) / 2;
      window.scrollTo(0, Math.max(0, midpoint - window.innerHeight / 2));
      return { sourceId: sourceNode.id, targetId: targetNode.id };
    })()`);
    if (pair.error) throw new Error(`phone-order gesture unavailable: ${pair.error}`);
    await delay(150);
    const plan = await value(`(() => {
      const source = document.querySelector('[gs-id="${pair.sourceId}"] .widget-drag');
      const target = document.querySelector('[gs-id="${pair.targetId}"] .widget-drag');
      if (!source || !target) return { error: 'a selected .widget-drag handle disappeared', sourceId: ${JSON.stringify(pair.sourceId)}, targetId: ${JSON.stringify(pair.targetId)} };
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const point = (rect) => ({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
      const sourcePoint = point(sourceRect);
      const targetPoint = point(targetRect);
      const endPoint = { x: targetPoint.x, y: Math.max(8, targetPoint.y - 32) };
      const visible = (rect) => rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
      return {
        sourceId: ${JSON.stringify(pair.sourceId)},
        targetId: ${JSON.stringify(pair.targetId)},
        source: sourcePoint,
        target: targetPoint,
        end: endPoint,
        manhattanDistance: Math.abs(sourcePoint.x - endPoint.x) + Math.abs(sourcePoint.y - endPoint.y),
        gridStackDragThreshold: 3,
        sourceRect: { top: sourceRect.top, bottom: sourceRect.bottom, left: sourceRect.left, right: sourceRect.right },
        targetRect: { top: targetRect.top, bottom: targetRect.bottom, left: targetRect.left, right: targetRect.right },
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
        bothVisible: visible(sourceRect) && visible(targetRect),
      };
    })()`);
    if (plan.error) throw new Error(`phone-order gesture unavailable: ${JSON.stringify(plan)}`);
    if (!plan.bothVisible) {
      throw new Error(`phone-order gesture unavailable: adjacent .widget-drag handles are not simultaneously visible at 390px: ${JSON.stringify(plan)}`);
    }
    return plan;
  }
  async function dispatchPhoneOrderTouchDrag(plan) {
    const touchPoint = (x, y) => ({ x, y, radiusX: 1, radiusY: 1, force: 1, id: 0 });
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(plan.source.x, plan.source.y)] });
    await delay(120);
    const activation = { x: plan.source.x, y: plan.source.y - 6 };
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(activation.x, activation.y)] });
    await delay(180);
    const steps = 24;
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = Math.round(activation.x + (plan.end.x - activation.x) * ratio);
      const y = Math.round(activation.y + (plan.end.y - activation.y) * ratio);
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(x, y)] });
      await delay(45);
    }
    await delay(200);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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

  async function inspectHistoryContinuity(label) {
    const result = await value(`(() => {
      const chart = window.Chart?.getChart?.('historyChart');
      if (!chart) return { available: false };
      const rootStyle = getComputedStyle(document.documentElement);
      const colorContext = document.createElement('canvas').getContext('2d');
      const normalizeColor = (color) => {
        colorContext.fillStyle = '#000000';
        colorContext.fillStyle = color;
        return colorContext.fillStyle;
      };
      const datasets = chart.data.datasets.map((dataset) => ({
        deskId: dataset.joeDeskId,
        evidence: dataset.joeEvidence,
        points: dataset.data.length,
        finitePoints: dataset.data.filter((point) => Number.isFinite(point?.y)).length,
        borderColor: normalizeColor(dataset.borderColor),
        borderDash: dataset.borderDash || [],
      }));
      const selected = [...document.querySelectorAll('button[data-series][aria-pressed="true"]')].map((button) => button.dataset.series);
      const expectedColors = Object.fromEntries(selected.map((deskId) => [deskId, normalizeColor(rootStyle.getPropertyValue('--desk-' + deskId).trim())]));
      const legend = document.getElementById('historyEvidenceLegend');
      const legendRect = legend?.getBoundingClientRect();
      return {
        available: true,
        selected,
        datasets,
        expectedColors,
        gapColor: normalizeColor(rootStyle.getPropertyValue('--chart-gap-fill').trim()),
        chartLegend: (chart.legend?.legendItems || []).map((item) => ({ deskId: item.datasetIndex == null ? null : chart.data.datasets[item.datasetIndex]?.joeDeskId, evidence: item.datasetIndex == null ? null : chart.data.datasets[item.datasetIndex]?.joeEvidence })),
        staticLegend: {
          exists: Boolean(legend),
          role: legend?.getAttribute('role'),
          label: legend?.getAttribute('aria-label'),
          text: legend?.textContent.replace(/\\s+/g, ' ').trim(),
          swatches: legend?.querySelectorAll('svg').length,
          hiddenSwatches: [...(legend?.querySelectorAll('svg') || [])].every((svg) => svg.getAttribute('aria-hidden') === 'true'),
          overflow: Boolean(legendRect && (legendRect.left < -1 || legendRect.right > document.documentElement.clientWidth + 1)),
        },
        describedBy: document.getElementById('historyChart')?.getAttribute('aria-describedby') || '',
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`);
    if (!result.available) throw new Error(`History continuity chart unavailable (${label})`);
    const problems = [];
    for (const deskId of result.selected) {
      const pair = result.datasets.filter((dataset) => dataset.deskId === deskId);
      if (pair.length !== 2) problems.push(`${deskId} has ${pair.length} datasets`);
      const observed = pair.find((dataset) => dataset.evidence === 'observed');
      const gapFill = pair.find((dataset) => dataset.evidence === 'gap-fill');
      if (!observed) problems.push(`${deskId} observed dataset missing`);
      else if (observed.borderColor !== result.expectedColors[deskId]) problems.push(`${deskId} observed color mismatch`);
      if (!gapFill) problems.push(`${deskId} gap-fill dataset missing`);
      else {
        if (JSON.stringify(gapFill.borderDash) !== JSON.stringify([2, 4])) problems.push(`${deskId} gap dash mismatch`);
        if (gapFill.borderColor !== result.gapColor) problems.push(`${deskId} gap color mismatch`);
        if (gapFill.finitePoints < 2) problems.push(`${deskId} gap path is not drawable`);
      }
    }
    if (result.datasets.length !== result.selected.length * 2) problems.push('unexpected history dataset count');
    if (result.chartLegend.length !== result.selected.length || result.chartLegend.some((item) => item.evidence !== 'observed')) problems.push('ordinary chart legend exposes gap-fill datasets');
    if (!result.staticLegend.exists || result.staticLegend.role !== 'group' || result.staticLegend.label !== 'History line meaning' ||
        result.staticLegend.swatches !== 2 || !result.staticLegend.hiddenSwatches || result.staticLegend.overflow ||
        !/Observed/.test(result.staticLegend.text || '') || !/Gap fill \/ carried estimate/.test(result.staticLegend.text || '') ||
        !/assumed €5,000 start/.test(result.staticLegend.text || '') || !result.describedBy.split(/\s+/).includes('historyEvidenceLegend')) {
      problems.push('accessible static history legend mismatch');
    }
    if (result.pageOverflow) problems.push('history continuity caused horizontal overflow');
    if (problems.length) throw new Error(`History continuity mismatch (${label}): ${JSON.stringify({ ...result, problems })}`);
    return result;
  }

  await send("Page.enable");
  await send("Runtime.enable");
  const smokeMode = process.env.JOE_SMOKE_VIEWPORT || "desktop";
  const mobileViewport = smokeMode === "mobile";
  const phoneOrderViewport = smokeMode === "phone-order";
  if (phoneOrderViewport) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1, configuration: "mobile" });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const proof = window.__joePhoneOrderProof = { armed: false, registrations: [], inputEvents: [], gridEvents: [] };
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (this instanceof Element && this.matches('.widget-drag') && ['mousedown', 'pointerdown', 'touchstart', 'touchmove', 'touchend'].includes(type)) {
          proof.registrations.push({ type, target: this.closest('[gs-id]')?.getAttribute('gs-id') || this.className });
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
      const point = (event) => {
        const touch = event.changedTouches?.[0] || event.touches?.[0];
        return { x: touch?.clientX ?? event.clientX, y: touch?.clientY ?? event.clientY };
      };
      ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'].forEach((type) => {
        originalAddEventListener.call(document, type, (event) => {
          if (!proof.armed || proof.inputEvents.length >= 120) return;
          const coordinates = point(event);
          proof.inputEvents.push({ type, trusted: event.isTrusted, pointerType: event.pointerType, x: coordinates.x, y: coordinates.y });
        }, true);
      });
    })();` });
  }
  await send("Emulation.setDeviceMetricsOverride", mobileViewport || phoneOrderViewport
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
  let historyContinuity;
  let phoneOrder;
  let fleet;

  if (smokeMode === "privacy") {
    const publicBefore = requests.filter(item => item.host.startsWith("example.com") && item.path === "/joe/data.json").length;
    await navigate(`http://example.com:${sitePort}/joe/`, "document.documentElement.dataset.joeView === 'stub'");
    await delay(250);
    stub = await value(`({ view: document.documentElement.dataset.joeView, gateHidden: document.getElementById('privateGate')?.hidden, dashboardHidden: document.getElementById('dashboard')?.hidden, text: document.body.innerText, title: document.title })`);
    const publicAfter = requests.filter(item => item.host.startsWith("example.com") && item.path === "/joe/data.json").length;
    if (stub.view !== "stub" || stub.gateHidden || !stub.dashboardHidden || !/Joe lives at home/.test(stub.text) || stub.title !== "Joe · Private household board" || publicAfter !== publicBefore) throw new Error(`public privacy stub mismatch: ${JSON.stringify({ stub, publicBefore, publicAfter })}`);
  } else if (phoneOrderViewport) {
    await navigate(hsb1Url, "document.getElementById('joeGrid')?.gridstack?.getColumn() === 1 && document.documentElement.dataset.joeViewport === 'narrow'");
    await delay(700);
    const before = await readPhoneOrderState();
    if (before.viewportWidth !== 390 || before.gridColumns !== 1 || before.order.length < 2) {
      throw new Error(`phone-order setup mismatch: ${JSON.stringify(before)}`);
    }
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const baselineDesktop = before.desktopGeometry;
    const compactState = (state) => ({
      order: state.order,
      dirty: state.dirty,
      selectedId: state.selectedId,
      selectedName: state.selectedName,
      desktopGeometry: state.desktopGeometry,
      storedDraft: state.storedDraft,
    });
    const assertDesktopPreserved = (label, state, requireStored = true) => {
      if (!same(state.desktopGeometry, baselineDesktop) || (requireStored && !same(state.storedDraft.items, baselineDesktop))) {
        throw new Error(`phone-order changed stored desktop geometry (${label}): ${JSON.stringify({ baselineDesktop, state: compactState(state) })}`);
      }
    };
    const assertPhoneState = (label, state, expectedOrder, expectedDirty) => {
      if (!same(state.order, expectedOrder) || state.dirty !== expectedDirty || !same(state.storedDraft.phoneOrder, expectedOrder)) {
        throw new Error(`phone-order state mismatch (${label}): ${JSON.stringify({ expectedOrder, expectedDirty, state: compactState(state) })}`);
      }
      assertDesktopPreserved(label, state);
    };
    const reloadPhoneBoard = async () => {
      await send("Page.reload", { ignoreCache: true });
      await delay(150);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await value("document.getElementById('joeGrid')?.gridstack?.getColumn() === 1 && document.documentElement.dataset.joeViewport === 'narrow'").catch(() => false)) {
          await delay(700);
          return readPhoneOrderState();
        }
        await delay(100);
      }
      throw new Error("phone-order board did not become ready after reload");
    };
    const runGesture = async ({ sourceId, targetId, label }) => {
      const gestureBefore = await readPhoneOrderState();
      const attempts = [];
      const runAttempt = async (kind) => {
        const gesture = await preparePhoneOrderDrag(sourceId, targetId);
        await armPhoneOrderInstrumentation(kind, gesture.sourceId);
        await dispatchPhoneOrderTouchDrag(gesture);
        const immediate = await readPhoneOrderState();
        if (process.env.JOE_SCREENSHOT_DIR && !same(immediate.order, gestureBefore.order)) {
          const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "joe-dash-phone-order.png"), Buffer.from(shot.data, "base64"));
        }
        await delay(700);
        const settled = await readPhoneOrderState();
        const instrumentation = await readPhoneOrderInstrumentation();
        const evidence = {
          kind,
          gesture,
          immediateOrder: immediate.order,
          settledOrder: settled.order,
          instrumentation,
        };
        attempts.push(evidence);
        const eventMove = instrumentation.orderEvents.find((event) => !same(event.order, gestureBefore.order));
        return { gesture, immediate, settled, eventMove, evidence };
      };
      const result = await runAttempt("touch");
      const movedOrder = !same(result.immediate.order, gestureBefore.order)
        ? result.immediate.order
        : !same(result.settled.order, gestureBefore.order)
          ? result.settled.order
          : result.eventMove?.order;
      if (!movedOrder) {
        throw new Error(`phone-order CDP touch gesture did not move a GridStack tile (${label}): ${JSON.stringify({ beforeOrder: gestureBefore.order, attempts })}`);
      }
      if (movedOrder.indexOf(sourceId) >= movedOrder.indexOf(targetId)) {
        throw new Error(`phone-order gesture did not place source before target (${label}): ${JSON.stringify({ sourceId, targetId, movedOrder, attempts })}`);
      }
      if (!same(result.settled.order, movedOrder)) {
        throw new Error(`phone-order responsive settle reverted the physical move (${label}): ${JSON.stringify({ movedOrder, settledOrder: result.settled.order, attempts })}`);
      }
      return {
        label,
        effectiveInput: "touch",
        sourceId,
        targetId,
        beforeOrder: gestureBefore.order,
        after: result.immediate,
        settled: result.settled,
        attempts,
      };
    };
    const click = async (expression) => {
      await value(expression);
      await delay(150);
    };
    const selectLayout = async (id) => {
      await click(`(() => { const select = document.getElementById('layoutSelect'); select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    };

    const initialGesture = await runGesture({ sourceId: "desk-joe", targetId: "desk-j", label: "initial phone reorder" });
    const firstOrder = initialGesture.settled.order;
    assertPhoneState("after initial gesture", initialGesture.settled, firstOrder, true);
    const reloaded = await reloadPhoneBoard();
    assertPhoneState("initial reload", reloaded, firstOrder, true);

    await click(`(() => {
      document.getElementById('layoutMenu').setAttribute('open', '');
      document.getElementById('saveAsLayout').click();
      const input = document.getElementById('layoutNameInput');
      input.value = 'Phone order proof';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('layoutFormConfirm').click();
    })()`);
    const savedAs = await readPhoneOrderState();
    const namedEntry = savedAs.layouts.find((entry) => entry.name === "Phone order proof");
    if (!namedEntry || savedAs.selectedId !== namedEntry.id || savedAs.dirty || !same(namedEntry.phoneOrder, firstOrder) || !same(namedEntry.items, baselineDesktop)) {
      throw new Error(`phone-order Save As mismatch: ${JSON.stringify({ firstOrder, state: compactState(savedAs), namedEntry })}`);
    }
    assertPhoneState("Save As", savedAs, firstOrder, false);

    const saveGesture = await runGesture({ sourceId: "desk-joel", targetId: "desk-j", label: "named layout edit" });
    const savedOrder = saveGesture.settled.order;
    assertPhoneState("before Save", saveGesture.settled, savedOrder, true);
    await click("document.getElementById('saveLayout').click()");
    const saved = await readPhoneOrderState();
    const savedEntry = saved.layouts.find((entry) => entry.id === namedEntry.id);
    if (!savedEntry || saved.dirty || !same(savedEntry.phoneOrder, savedOrder) || !same(savedEntry.items, baselineDesktop)) {
      throw new Error(`phone-order Save mismatch: ${JSON.stringify({ savedOrder, state: compactState(saved), savedEntry })}`);
    }
    assertPhoneState("Save", saved, savedOrder, false);

    await click("document.getElementById('resetLayout').click()");
    const reset = await readPhoneOrderState();
    if (reset.selectedId !== "default" || reset.dirty || !same(reset.order, before.order)) {
      throw new Error(`phone-order Reset mismatch: ${JSON.stringify({ defaultOrder: before.order, state: compactState(reset) })}`);
    }
    assertDesktopPreserved("Reset", reset);

    await selectLayout(namedEntry.id);
    const loaded = await readPhoneOrderState();
    assertPhoneState("named Load", loaded, savedOrder, false);

    const discardGesture = await runGesture({ sourceId: "desk-j", targetId: "desk-joel", label: "discard candidate" });
    assertPhoneState("before Discard", discardGesture.settled, discardGesture.settled.order, true);
    await selectLayout("default");
    const discardPromptOpen = await value("document.getElementById('layoutUnsavedDialog').open");
    if (!discardPromptOpen) throw new Error("phone-order Discard did not open the unsaved-changes dialog");
    await click("document.getElementById('layoutUnsavedDiscard').click()");
    const discarded = await readPhoneOrderState();
    if (discarded.selectedId !== "default" || discarded.dirty || !same(discarded.order, before.order)) {
      throw new Error(`phone-order Discard mismatch: ${JSON.stringify({ defaultOrder: before.order, state: compactState(discarded) })}`);
    }
    assertDesktopPreserved("Discard", discarded);

    await selectLayout(namedEntry.id);
    const loadedAgain = await readPhoneOrderState();
    assertPhoneState("named reload after Discard", loadedAgain, savedOrder, false);

    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(700);
    const desktopRoundtrip = await readPhoneOrderState();
    if (desktopRoundtrip.viewport !== "desktop" || desktopRoundtrip.gridColumns !== 12 || desktopRoundtrip.dirty || !same(desktopRoundtrip.liveItems, baselineDesktop)) {
      throw new Error(`phone-order desktop roundtrip mismatch: ${JSON.stringify({ baselineDesktop, state: compactState(desktopRoundtrip), liveItems: desktopRoundtrip.liveItems })}`);
    }
    assertDesktopPreserved("desktop roundtrip", desktopRoundtrip);

    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await delay(700);
    const phoneRoundtrip = await readPhoneOrderState();
    assertPhoneState("phone roundtrip", phoneRoundtrip, savedOrder, false);
    const finalReload = await reloadPhoneBoard();
    assertPhoneState("final reload", finalReload, savedOrder, false);

    phoneOrder = {
      physicalGesture: {
        effectiveInput: initialGesture.effectiveInput,
        touchProved: true,
        sourceId: initialGesture.sourceId,
        targetId: initialGesture.targetId,
        beforeOrder: initialGesture.beforeOrder,
        afterOrder: initialGesture.after.order,
        settledOrder: initialGesture.settled.order,
        attempts: initialGesture.attempts,
      },
      reloadOrder: reloaded.order,
      lifecycle: {
        saveAs: { id: namedEntry.id, order: firstOrder },
        save: { order: savedOrder },
        reset: reset.order,
        load: loaded.order,
        discard: discarded.order,
        loadAfterDiscard: loadedAgain.order,
      },
      responsiveRoundtrip: {
        desktopColumns: desktopRoundtrip.gridColumns,
        desktopGeometryUnchanged: same(desktopRoundtrip.liveItems, baselineDesktop) && same(desktopRoundtrip.storedDraft.items, baselineDesktop),
        desktopDirty: desktopRoundtrip.dirty,
        phoneOrder: phoneRoundtrip.order,
        phoneDirty: phoneRoundtrip.dirty,
        finalReloadOrder: finalReload.order,
        finalDirty: finalReload.dirty,
      },
    };
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
    healthSummary: {
      visible: !document.getElementById('alarm')?.hidden,
      tone: document.getElementById('alarm')?.dataset.tone,
      label: document.getElementById('alarmLabel')?.textContent,
      detailOpen: document.getElementById('boardHealthInfo')?.open,
    },
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
    totalDayNote: document.getElementById('totalDayNote')?.textContent,
    totalOpen: document.getElementById('totalOpen')?.textContent,
    totalOpenTitle: document.getElementById('totalOpen')?.title,
    totalOpenNote: document.getElementById('totalOpenNote')?.textContent,
    deskMoney: [...document.querySelectorAll('.desk-widget')].map(node => ({
      id: node.dataset.desk,
      day: node.querySelector('.desk-money-cell:nth-child(2) strong')?.textContent,
      open: node.querySelector('.desk-money-cell:nth-child(4) strong')?.textContent,
    })),
    attributionRows: [...document.querySelectorAll('#attribution .attribution-row')].map(node => node.textContent),
    attributionGeometry: [...document.querySelectorAll('#attribution .attribution-row')].map(node => {
      const track = node.querySelector('.attribution-track').getBoundingClientRect();
      const fill = node.querySelector('.attribution-fill').getBoundingClientRect();
      const value = node.querySelector('.attribution-value');
      const valueRect = value.getBoundingClientRect();
      return {
        ratio: fill.width / track.width,
        fillHeight: fill.height,
        valueHeight: valueRect.height,
        valueLineHeight: parseFloat(getComputedStyle(value).lineHeight),
        whiteSpace: getComputedStyle(value).whiteSpace,
      };
    }),
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
      !/15,75/.test(healthy.totalDay || "") || healthy.totalDayNote !== "SOD · virtual desks" || !/Synthetic SOD/.test(healthy.totalDayTitle || "") ||
      !/17,25/.test(healthy.totalOpen || "") || healthy.totalOpenNote !== "IB unrealized · virtual desks" || !/Synthetic IB unrealized/.test(healthy.totalOpenTitle || "") ||
      JSON.stringify(healthy.deskMoney) !== JSON.stringify([
        { id: "j", day: "+€ 24,50", open: "+€ 12,50" },
        { id: "joe", day: "€ 0,00", open: "€ 0,00" },
        { id: "joel", day: "−€ 8,75", open: "+€ 4,75" },
      ]) || healthy.attributionRows.length !== 3 || healthy.attributionDay !== undefined ||
      healthy.attributionGeometry.length !== 3 ||
      !(healthy.attributionGeometry[0].ratio > 0.95) || !(healthy.attributionGeometry[1].ratio > 0 && healthy.attributionGeometry[1].ratio < 0.05) ||
      !(healthy.attributionGeometry[2].ratio > 0.3 && healthy.attributionGeometry[2].ratio < 0.4) ||
      healthy.attributionGeometry.some(item => item.fillHeight < 7 || item.whiteSpace !== 'nowrap' || item.valueHeight > item.valueLineHeight * 1.2) ||
      !healthy.halt.startsWith("Off") || !healthy.healthSummary.visible || healthy.healthSummary.tone !== "green" ||
      healthy.healthSummary.label !== "Board OK" || healthy.healthSummary.detailOpen || !healthy.gridReady || healthy.widgets !== 7 ||
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

    if (process.env.JOE_SCREENSHOT_DIR && !mobileViewport) {
      const sourcedPnlShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-33-day-open-sourced.png"), Buffer.from(sourcedPnlShot.data, "base64"));
      const honestPnl = await value(`(() => {
        window.JoeBoard.ingest(${JSON.stringify(honestPnlSnapshot)});
        return {
          state: document.documentElement.dataset.joeState,
          gateway: document.getElementById('gatewayValue')?.textContent,
          day: document.getElementById('totalDay')?.textContent,
          dayNote: document.getElementById('totalDayNote')?.textContent,
          open: document.getElementById('totalOpen')?.textContent,
          openNote: document.getElementById('totalOpenNote')?.textContent,
          attribution: document.querySelector('#attribution .widget-note')?.textContent,
        };
      })()`);
      if (
        !['ok', 'attention'].includes(honestPnl.state) || !/^OK · connected/.test(honestPnl.gateway || '') ||
        honestPnl.day !== '—' || honestPnl.dayNote !== 'SOD baseline pending - HOSTD-33' ||
        honestPnl.open !== '—' || honestPnl.openNote !== 'IB unrealized feed not wired yet - HOSTD-33' ||
        !/SOD baseline pending - HOSTD-33/.test(honestPnl.attribution || '')
      ) throw new Error(`Honest P&L state mismatch: ${JSON.stringify(honestPnl)}`);
      await delay(100);
      const honestPnlShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-33-day-open-honest.png"), Buffer.from(honestPnlShot.data, "base64"));
      await value(`window.JoeBoard.ingest(${JSON.stringify(initialSnapshot)})`);
      await delay(100);
    }

    await value(`document.getElementById('fleetConfigOpen').click()`);
    await delay(850);
    const fleetOpen = await value(`(() => ({
      plane: document.documentElement.dataset.joePlane,
      flipped: document.getElementById('boardFlipper').classList.contains('is-flipped'),
      transform: getComputedStyle(document.getElementById('boardFlipper')).transform,
      frontHidden: document.getElementById('tradingBoard').getAttribute('aria-hidden'),
      frontInert: document.getElementById('tradingBoard').inert,
      backHidden: document.getElementById('fleetConfigBoard').getAttribute('aria-hidden'),
      backInert: document.getElementById('fleetConfigBoard').inert,
      title: document.getElementById('fleetConfigTitle').textContent.trim(),
      revision: document.getElementById('fleetRevision').textContent,
      selected: document.getElementById('fleetSelectedLabel').textContent,
      headline: document.getElementById('fleetEliHeadline').textContent,
      source: document.getElementById('fleetSourcePath').textContent,
      sourceKind: document.getElementById('fleetSourceKind').textContent,
      lastPropagate: document.getElementById('fleetLastPropagate').textContent,
      technicalOpen: document.getElementById('fleetTechnical').open,
      humanFields: [...document.querySelectorAll('#fleetEditFields label')].map(node => ({ label: node.querySelector('span').textContent, help: node.querySelector('.fleet-field-help').textContent, scope: node.querySelector('.fleet-field-scope').textContent })),
      sections: document.querySelectorAll('[data-fleet-section]').length,
      limitsTitle: document.getElementById('fleetLimitsTitle').textContent,
      limitsTop: document.getElementById('fleetLimitsTitle').getBoundingClientRect().top,
      limitJumps: [...document.querySelectorAll('[data-fleet-jump]')].map(node => node.dataset.fleetJump),
      actions: [...document.querySelectorAll('[data-fleet-action]')].map(node => node.dataset.fleetAction),
      fields: [...document.querySelectorAll('#fleetEditFields input, #fleetEditFields select')].map(node => node.dataset.fleetField),
      actionLogText: document.getElementById('fleetActionLog').innerText,
      configText: document.getElementById('fleetConfigBoard').innerText,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }))()`);
    if (
      fleetOpen.plane !== 'fleet-config' || !fleetOpen.flipped || fleetOpen.transform === 'none' ||
      fleetOpen.frontHidden !== 'true' || !fleetOpen.frontInert || fleetOpen.backHidden !== 'false' || fleetOpen.backInert ||
      !/Fleet Config/.test(fleetOpen.title) || fleetOpen.revision !== 'fc-000000' ||
      fleetOpen.selected !== 'Selected: Desk limits' || fleetOpen.headline !== 'Set the paper desks’ boundaries.' ||
      fleetOpen.sections !== 8 || JSON.stringify(fleetOpen.fields) !== JSON.stringify(['maxBusyDesks', 'stage0CapEur', 'keepSymbols']) ||
      !fleetOpen.actions.includes('diff') || !fleetOpen.actions.includes('confirm') || !fleetOpen.actions.includes('propagate') || !fleetOpen.actions.includes('save') ||
      !/No propagation attempts recorded yet/.test(fleetOpen.actionLogText) ||
      fleetOpen.source !== '/app/public/joe/fleet-config.example.json' || !/Starter example/.test(fleetOpen.sourceKind) || fleetOpen.lastPropagate !== 'None recorded' ||
      fleetOpen.technicalOpen || fleetOpen.humanFields[0]?.label !== 'Maximum busy desks' || !fleetOpen.humanFields.every(field => field.help && field.scope.startsWith('Applies to:')) ||
      fleetOpen.limitsTitle !== 'Limits home' || JSON.stringify(fleetOpen.limitJumps) !== JSON.stringify(['quota', 'desks', 'cadence']) ||
      /Day P&L|Open P&L|Virtual desk equity/.test(fleetOpen.configText) || fleetOpen.overflow
    ) throw new Error(`Fleet Config open mismatch: ${JSON.stringify(fleetOpen)}`);

    const fleetClarity = await value(`(() => {
      document.querySelector('[data-fleet-section="limits"]').click();
      const sourceRows = [...document.querySelectorAll('#fleetSourcesList .fleet-source-path')].map(node => node.textContent);
      const sourcesCollapsed = !document.getElementById('fleetSources').open;
      const sourceStatus = document.getElementById('fleetSourcesStatus').textContent;
      document.querySelector('[data-fleet-source-edit="grok.reservePct"]').click();
      const sourceJumpFocused = document.activeElement.dataset.fleetField === 'grok.reservePct';
      const reserve = document.querySelector('[data-fleet-field="grok.reservePct"]');
      const original = reserve.value;
      reserve.value = '20';
      reserve.dispatchEvent(new Event('input', { bubbles: true }));
      const reserveExample = document.getElementById('fleetQuotaExample').textContent;
      reserve.value = original;
      reserve.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-section="desks"]').click();
      const humanFields = [...document.querySelectorAll('#fleetEditFields label')].map(node => ({ label: node.querySelector('span').textContent, help: node.querySelector('.fleet-field-help').textContent, scope: node.querySelector('.fleet-field-scope').textContent }));
      return { sourceRows, sourcesCollapsed, sourceStatus, sourceJumpFocused, reserveExample, humanFields, homeHidden: document.getElementById('fleetLimitsHome').hidden };
    })()`);
    if (!fleetClarity.sourceJumpFocused || !fleetClarity.sourcesCollapsed || !/Starter example/.test(fleetClarity.sourceStatus) ||
        fleetClarity.sourceRows.length !== 13 || !fleetClarity.sourceRows.every(path => path.startsWith('/app/public/joe/fleet-config.example.json#')) ||
        !fleetClarity.reserveExample.includes('Grok: 20% means keep 20 of every 100 units for essential work.') ||
        fleetClarity.humanFields.length !== 3 || fleetClarity.humanFields[0].label !== 'Maximum busy desks' ||
        !fleetClarity.humanFields.every(field => field.help && field.scope.startsWith('Applies to:')) || !fleetClarity.homeHidden) {
      throw new Error(`Fleet clarity mismatch: ${JSON.stringify(fleetClarity)}`);
    }

    await value(`(() => {
      document.querySelector('[data-fleet-jump="desks"]').click();
      let inputs = [...document.querySelectorAll('#fleetEditFields input')];
      inputs[1].value = '';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      const emptyNumberToast = document.getElementById('fleetToast').textContent;
      inputs[1].value = '0x10';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      const coercedNumberToast = document.getElementById('fleetToast').textContent;
      inputs[1].value = '250.0';
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      const normalizedNumberToast = document.getElementById('fleetToast').textContent;
      inputs = [...document.querySelectorAll('#fleetEditFields input')];
      const first = inputs[0];
      first.value = '4';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      window.__fleetSmokeFlow = {
        emptyNumberToast,
        coercedNumberToast,
        normalizedNumberToast,
        diffToast: document.getElementById('fleetToast').textContent,
        diffOpen: document.getElementById('fleetDiffDialog').open,
        diffText: document.getElementById('fleetDiffList').innerText,
      };
      document.getElementById('fleetDiffReviewed').click();
      document.querySelector('[data-fleet-action="confirm"]').click();
      window.__fleetSmokeFlow.confirmToast = document.getElementById('fleetToast').textContent;
      document.querySelector('[data-fleet-action="propagate"]').click();
    })()`);
    await delay(200);
    const fleetBound = await value(`(() => {
      const toastRect = document.getElementById('fleetToast').getBoundingClientRect();
      const result = {
        selected: document.getElementById('fleetSelectedLabel').textContent,
        headline: document.getElementById('fleetEliHeadline').textContent,
        fields: [...document.querySelectorAll('#fleetEditFields input')].map(node => node.dataset.fleetField),
        changed: window.JoeBoard.fleetChangedEntries(),
        summaryValue: document.querySelector('[data-fleet-readout="maxBusyDesks"]').textContent,
        diffToast: window.__fleetSmokeFlow.diffToast,
        diffOpen: window.__fleetSmokeFlow.diffOpen,
        diffText: window.__fleetSmokeFlow.diffText,
        confirmToast: window.__fleetSmokeFlow.confirmToast,
        propagateToast: document.getElementById('fleetToast').textContent,
        toastPosition: getComputedStyle(document.getElementById('fleetToast')).position,
        toastInViewport: toastRect.top >= 0 && toastRect.bottom <= innerHeight,
        note: document.getElementById('fleetPreviewNote').textContent,
        revision: document.getElementById('fleetRevision').textContent,
        actionItems: document.querySelectorAll('#fleetActionLog .fleet-action-item').length,
        actionText: document.getElementById('fleetActionLog').innerText,
        emptyNumberToast: window.__fleetSmokeFlow.emptyNumberToast,
        coercedNumberToast: window.__fleetSmokeFlow.coercedNumberToast,
        normalizedNumberToast: window.__fleetSmokeFlow.normalizedNumberToast,
      };
      document.querySelector('[data-fleet-section="quota"]').click();
      return result;
    })()`);
    if (
      fleetBound.selected !== 'Selected: Desk limits' || fleetBound.headline !== 'Set the paper desks’ boundaries.' ||
      JSON.stringify(fleetBound.fields) !== JSON.stringify(['maxBusyDesks', 'stage0CapEur', 'keepSymbols']) ||
      JSON.stringify(fleetBound.changed) !== JSON.stringify([]) ||
      fleetBound.summaryValue !== '4' || fleetBound.toastPosition !== 'fixed' || !fleetBound.toastInViewport ||
      !/must be a decimal number/.test(fleetBound.emptyNumberToast) || !/must be a decimal number/.test(fleetBound.coercedNumberToast) ||
      !/matches the current Fleet Config revision/.test(fleetBound.normalizedNumberToast) ||
      !fleetBound.diffOpen || !/Maximum busy J desks at once/.test(fleetBound.diffText) ||
      !/Before: 5 busy J desks/.test(fleetBound.diffText) || !/After: 4 busy J desks/.test(fleetBound.diffText) ||
      !/1 preview change: maxBusyDesks/.test(fleetBound.diffToast) || !/Preview confirmed for fc-000000/.test(fleetBound.confirmToast) ||
      !/Propagated fc-000001: desks\.maxBusyDesks/.test(fleetBound.propagateToast) || fleetBound.revision !== 'fc-000001' || !/Success · fc-000001 saved to the shared file/.test(fleetBound.note) ||
      fleetBound.actionItems !== 1 || !/success/i.test(fleetBound.actionText) || !/amy-smoke/.test(fleetBound.actionText) || !/fc-000000 → fc-000001/.test(fleetBound.actionText) || !/desks\.maxBusyDesks/.test(fleetBound.actionText)
    ) throw new Error(`Fleet Config binding mismatch: ${JSON.stringify(fleetBound)}`);

    await value(`document.querySelector('[data-fleet-section="secrets"]').click(); document.querySelector('.fleet-explanation').open = true`);
    const fleetSecrets = await value(`(() => ({
      selected: document.getElementById('fleetSelectedLabel').textContent,
      headline: document.getElementById('fleetEliHeadline').textContent,
      intro: document.getElementById('fleetEliIntro').textContent,
      explanation: document.getElementById('fleetEliSections').innerText,
      fields: [...document.querySelectorAll('#fleetEditFields input')].map((node) => ({
        field: node.dataset.fleetField,
        value: node.value,
        readOnly: node.readOnly,
        type: node.type,
      })),
      slots: [...document.querySelectorAll('#fleetSecretSlots .fleet-secret-slot')].map((node) => ({
        capability: node.querySelector('.fleet-secret-capability')?.textContent,
        ref: node.querySelector('.fleet-secret-ref')?.textContent || null,
        marker: node.querySelector('.fleet-redacted')?.textContent || null,
        empty: node.querySelector('.fleet-secret-empty')?.textContent || null,
      })),
      slotsHidden: document.getElementById('fleetSecretSlots').getAttribute('aria-hidden'),
      ops: document.getElementById('fleetSecretOps').textContent,
      passwordInputs: document.querySelectorAll('#fleetConfigBoard input[type="password"]').length,
      rotationControls: [...document.querySelectorAll('#fleetConfigBoard button, #fleetConfigBoard input')]
        .filter((node) => /rotate|rotation/i.test((node.textContent || '') + ' ' + (node.value || '') + ' ' + (node.name || ''))).length,
    }))()`);
    if (
      fleetSecrets.selected !== 'Selected: Secret slots' || fleetSecrets.headline !== 'Names on the board. Values stay in AGE.' ||
      !/readable paper file/i.test(fleetSecrets.intro) || !/encrypted secret material/i.test(fleetSecrets.intro) || !/capability and path refs/i.test(fleetSecrets.intro) ||
      !/Plaintext policy vs AGE secrets/.test(fleetSecrets.explanation) || !/Always REDACTED/.test(fleetSecrets.explanation) ||
      !/Janus\/agenix ops/.test(fleetSecrets.explanation) || fleetSecrets.slotsHidden !== 'true' ||
      JSON.stringify(fleetSecrets.fields) !== JSON.stringify([
        { field: 'agenixRefs', value: 'joe-board-push-token', readOnly: true, type: 'text' },
        { field: 'janusRefs', value: 'none', readOnly: true, type: 'text' },
        { field: 'displayMode', value: 'REDACTED', readOnly: true, type: 'text' },
      ]) ||
      JSON.stringify(fleetSecrets.slots) !== JSON.stringify([
        { capability: 'agenix', ref: 'joe-board-push-token', marker: 'REDACTED', empty: null },
        { capability: 'janus', ref: null, marker: null, empty: 'No slots declared' },
      ]) ||
      !/Rotate and inject AGE secrets/.test(fleetSecrets.ops) || !/docs\/joe-fleet-config-secrets\.md/.test(fleetSecrets.ops) ||
      fleetSecrets.passwordInputs !== 0 || fleetSecrets.rotationControls !== 0
    ) throw new Error(`Fleet Config secret-slot mismatch: ${JSON.stringify(fleetSecrets)}`);

    await value(`(() => {
      document.querySelector('[data-fleet-section="desks"]').click();
      const first = document.querySelector('#fleetEditFields input');
      first.value = '3';
      first.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      document.getElementById('fleetDiffReviewed').click();
      document.querySelector('[data-fleet-action="confirm"]').click();
      document.querySelector('[data-fleet-action="propagate"]').click();
    })()`);
    await delay(200);
    const fleetFailure = await value(`(() => ({
      toast: document.getElementById('fleetToast').textContent,
      revision: document.getElementById('fleetRevision').textContent,
      lastPropagate: document.getElementById('fleetLastPropagate').textContent,
      source: document.getElementById('fleetSourcePath').textContent,
      outcomes: [...document.querySelectorAll('#fleetActionLog .fleet-action-outcome')].map(node => node.textContent),
      logText: document.getElementById('fleetActionLog').innerText,
    }))()`);
    if (
      !/Propagation failed for fc-000001 \(maxBusyDesks\): smoke policy rejected/.test(fleetFailure.toast) ||
      !/^failure/.test(fleetFailure.lastPropagate) || fleetFailure.source !== '/var/lib/joe-board/fleet-config.json' ||
      fleetFailure.revision !== 'fc-000001' || JSON.stringify(fleetFailure.outcomes) !== JSON.stringify(['failure', 'success']) ||
      !/desks\.maxBusyDesks/.test(fleetFailure.logText)
    ) throw new Error(`Fleet Config failure evidence mismatch: ${JSON.stringify(fleetFailure)}`);

    const fleetEditors = await value(`(() => {
      document.querySelector('[data-fleet-section="quota"]').click();
      const amber = document.querySelector('[data-fleet-field="onAmber"]');
      amber.value = 'park_nonessential';
      amber.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      const amberDiff = document.getElementById('fleetDiffList').innerText;
      const confirmBlocked = document.querySelector('[data-fleet-action="confirm"]').disabled;
      document.getElementById('fleetDiffCancel').click();
      amber.value = 'slow_nonessential';
      amber.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-section="cadence"]').click();
      document.querySelector('.fleet-window-editor > button').click();
      const windowInputs = [...document.querySelectorAll('.fleet-window-row input')];
      windowInputs[0].value = 'us-open';
      windowInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      const windowDiff = document.getElementById('fleetDiffList').innerText;
      const windowCount = document.querySelector('[data-fleet-readout="wakeWindows"]').textContent;
      document.getElementById('fleetDiffCancel').click();
      return { amberDiff, confirmBlocked, windowDiff, windowCount };
    })()`);
    if (!fleetEditors.confirmBlocked || !/When capacity is getting low/.test(fleetEditors.amberDiff) ||
        !/Before: Slow nonessential work/.test(fleetEditors.amberDiff) || !/After: Park nonessential work/.test(fleetEditors.amberDiff) ||
        !/Desk wake windows/.test(fleetEditors.windowDiff) || !/us-open: mon 09:00–17:00 → desk-a/.test(fleetEditors.windowDiff) ||
        /\{"id"/.test(fleetEditors.windowDiff) || fleetEditors.windowCount !== '1 wake window') {
      throw new Error(`Fleet Config editor mismatch: ${JSON.stringify(fleetEditors)}`);
    }
    await value(`(() => {
      document.querySelector('[data-fleet-section="desks"]').click();
      const busy = document.querySelector('[data-fleet-field="maxBusyDesks"]');
      busy.value = '4';
      busy.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-section="quota"]').click();
      const amber = document.querySelector('[data-fleet-field="onAmber"]');
      amber.value = 'park_nonessential';
      amber.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-fleet-action="diff"]').click();
      document.getElementById('fleetDiffReviewed').click();
      document.querySelector('[data-fleet-action="confirm"]').click();
      document.querySelector('[data-fleet-action="propagate"]').click();
    })()`);
    await delay(200);
    const fleetEdited = await value(`(async () => {
      const config = await (await fetch('./fleet-config.json', { cache: 'no-store' })).json();
      return { rev: config.rev, amber: config.quota.behavior.amber, windows: config.cadence.wakeWindows, note: document.getElementById('fleetPreviewNote').textContent };
    })()`);
    if (fleetEdited.rev !== 'fc-000002' || fleetEdited.amber !== 'park_nonessential' ||
        fleetEdited.windows.length !== 1 || fleetEdited.windows[0].id !== 'us-open' ||
        !/Success · fc-000002 saved to the shared file/.test(fleetEdited.note)) {
      throw new Error(`Fleet Config edited revision mismatch: ${JSON.stringify(fleetEdited)}`);
    }
    await value(`document.querySelector('[data-fleet-section="quota"]').click()`);

    await value(`window.JoeBoard.showTradingBoard()`);
    await delay(850);
    const fleetClosed = await value(`({
      plane: document.documentElement.dataset.joePlane,
      flipped: document.getElementById('boardFlipper').classList.contains('is-flipped'),
      frontHidden: document.getElementById('tradingBoard').getAttribute('aria-hidden'),
      frontInert: document.getElementById('tradingBoard').inert,
      backHidden: document.getElementById('fleetConfigBoard').getAttribute('aria-hidden'),
      backInert: document.getElementById('fleetConfigBoard').inert,
      focused: document.activeElement?.id,
      gridReady: Boolean(document.getElementById('joeGrid')?.gridstack),
      stagePerspective: getComputedStyle(document.getElementById('dashboard')).perspective,
      flipperTransform: getComputedStyle(document.getElementById('boardFlipper')).transform,
      mobileMenuViewport: (() => {
        if (innerWidth > 700) return { ok: true, skipped: true };
        window.scrollTo(0, 120);
        const menu = document.getElementById('layoutMenu');
        menu.setAttribute('open', '');
        window.JoeBoard.positionHeaderMenus();
        const panel = menu.querySelector('.header-menu-panel');
        const expectedTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--joe-header-bottom'));
        const actualTop = panel.getBoundingClientRect().top;
        const position = getComputedStyle(panel).position;
        const offsetParent = panel.offsetParent?.id || panel.offsetParent?.className || null;
        menu.removeAttribute('open');
        window.scrollTo(0, 0);
        return { ok: position === 'fixed' && Math.abs(actualTop - expectedTop) <= 1, position, expectedTop, actualTop, offsetParent };
      })(),
    })`);
    if (
      fleetClosed.plane !== 'trading' || fleetClosed.flipped || fleetClosed.frontHidden !== 'false' || fleetClosed.frontInert ||
      fleetClosed.backHidden !== 'true' || !fleetClosed.backInert || fleetClosed.focused !== 'fleetConfigOpen' || !fleetClosed.gridReady ||
      fleetClosed.stagePerspective !== 'none' || fleetClosed.flipperTransform !== 'none' || !fleetClosed.mobileMenuViewport.ok
    ) throw new Error(`Fleet Config close mismatch: ${JSON.stringify(fleetClosed)}`);
    fleet = { open: fleetOpen, bound: fleetBound, secrets: fleetSecrets, failure: fleetFailure, closed: fleetClosed };

    const initial = await measureHistoryGeometry("initial render");
    const rangeContinuity = {};
    for (const range of ['1d', '1w', '1m', 'all']) {
      await value(`document.querySelector('button[data-range="${range}"]').click()`);
      await delay(75);
      rangeContinuity[range] = await inspectHistoryContinuity(`${range.toUpperCase()} range`);
      await measureHistoryGeometry(`${range.toUpperCase()} continuity`);
    }
    await value(`window.JoeBoard.applyTheme('light')`);
    const lightTheme = await inspectHistoryContinuity('light theme');
    await value(`window.JoeBoard.applyTheme('dark')`);
    const darkTheme = await inspectHistoryContinuity('dark theme');
    historyUnavailable = true;
    await value(`document.getElementById('historyRetry').click()`);
    await delay(150);
    const retainedRefresh = await inspectHistoryContinuity('failed refresh retained history');
    const retainedStatus = await value(`({ hidden: document.getElementById('historyStatus').hidden, text: document.getElementById('historyStatusText').textContent })`);
    if (retainedStatus.hidden || !/Showing the last good series/.test(retainedStatus.text || '')) {
      throw new Error(`History retained-refresh status mismatch: ${JSON.stringify(retainedStatus)}`);
    }
    historyUnavailable = false;
    await value(`document.getElementById('historyRetry').click()`);
    await delay(150);
    historyContinuity = { ranges: rangeContinuity, lightTheme, darkTheme, retainedRefresh, retainedStatus };
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
      if (mobileViewport) {
        await value(`window.JoeBoard.showFleetConfig()`);
        await delay(850);
        await value(`window.scrollTo(0, 0)`);
        const settingsNavShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "settings-mobile-navigation.png"), Buffer.from(settingsNavShot.data, "base64"));
        await value(`document.querySelector('[data-fleet-section="desks"]').click()`);
        await delay(150);
        const settingsEditorShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "settings-mobile-limits.png"), Buffer.from(settingsEditorShot.data, "base64"));
        await value(`window.JoeBoard.showTradingBoard()`);
        await delay(850);
      }
      if (!mobileViewport) {
        await value(`window.JoeBoard.showFleetConfig()`);
        await delay(850);
        for (const section of ["limits", "desks", "quota", "cadence"]) {
          await value(`document.querySelector('[data-fleet-section="${section}"]').click(); document.querySelector('.fleet-explanation').open = false; window.scrollTo(0, 0)`);
          await delay(150);
          const settingsClip = await value(`(() => { const box = document.querySelector('.fleet-frame').getBoundingClientRect(); return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 }; })()`);
          const settingsShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: settingsClip });
          await writeFile(join(process.env.JOE_SCREENSHOT_DIR, `settings-${section}.png`), Buffer.from(settingsShot.data, "base64"));
        }
        const fleetBackShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-48-fleet-config-back.png"), Buffer.from(fleetBackShot.data, "base64"));
        await value(`document.getElementById('fleetActionLog').scrollIntoView({ block: 'center' })`);
        await delay(250);
        const fleetActionShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-50-action-log.png"), Buffer.from(fleetActionShot.data, "base64"));
        await value(`(() => {
          document.querySelector('[data-fleet-section="secrets"]').click();
          document.querySelector('[data-fleet-section="secrets"]').scrollIntoView({ block: 'center' });
        })()`);
        await delay(250);
        const fleetSecretsShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-51-secret-slots.png"), Buffer.from(fleetSecretsShot.data, "base64"));
        await value(`window.scrollTo(0, 0)`);
        await value(`window.JoeBoard.showTradingBoard()`);
        await delay(850);
        await value(`window.JoeBoard.showFleetConfig()`);
        await delay(300);
        const fleetMidShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(process.env.JOE_SCREENSHOT_DIR, "hostd-48-fleet-config-mid.png"), Buffer.from(fleetMidShot.data, "base64"));
        await delay(550);
        await value(`window.JoeBoard.showTradingBoard()`);
        await delay(850);
      }
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
      const staleSnapshot = refreshSnapshotObservationTimes(structuredClone(sample), new Date(Date.now() - 3600_000).toISOString());
      stale = await value(`(() => {
        const equityBefore = document.getElementById('totalEquity')?.textContent;
        const dayBefore = document.getElementById('totalDay')?.textContent;
        window.JoeBoard.ingest(${JSON.stringify(staleSnapshot)});
        return {
          state: document.documentElement.dataset.joeState,
          freshness: document.getElementById('freshValue')?.textContent,
          healthTone: document.getElementById('alarm')?.dataset.tone,
          healthLabel: document.getElementById('alarmLabel')?.textContent,
          detailOpen: document.getElementById('boardHealthInfo')?.open,
          alarm: document.getElementById('alarmText')?.textContent,
          equityRetained: document.getElementById('totalEquity')?.textContent === equityBefore,
          dayRetained: document.getElementById('totalDay')?.textContent === dayBefore,
          dayBefore,
        };
      })()`);
      if (stale.state !== "attention" || stale.healthTone !== "yellow" || !/^Stale /.test(stale.healthLabel || "") || stale.detailOpen || !stale.freshness.startsWith("STALE") || !/stale/i.test(stale.alarm || "") || !stale.equityRetained || !stale.dayRetained || !/15,75/.test(stale.dayBefore || "")) throw new Error(`Stale state mismatch: ${JSON.stringify(stale)}`);

      const brokenSnapshot = refreshSnapshotObservationTimes(structuredClone(sample));
      brokenSnapshot.safety.halt = true;
      brokenSnapshot.safety.haltReason = "Operator check";
      brokenSnapshot.safety.gateway.status = "down";
      brokenSnapshot.safety.gateway.detail = "No heartbeat";
      broken = await value(`(() => { window.JoeBoard.ingest(${JSON.stringify(brokenSnapshot)}); return { state: document.documentElement.dataset.joeState, tone: document.getElementById('alarm')?.dataset.tone, label: document.getElementById('alarmLabel')?.textContent, detailOpen: document.getElementById('boardHealthInfo')?.open, alarm: document.getElementById('alarmText')?.textContent }; })()`);
      if (broken.state !== "broken" || broken.tone !== "red" || broken.label !== "Needs fix" || broken.detailOpen || !/HALT is on/.test(broken.alarm || "") || !/Gateway is down/.test(broken.alarm || "")) throw new Error(`Broken state mismatch: ${JSON.stringify(broken)}`);

      const positionsSnapshot = refreshSnapshotObservationTimes(structuredClone(sample));
      positionsSnapshot.totals.openPnl = 17.25;
      positionsSnapshot.desks[0].money.openPnl = 12.5;
      positionsSnapshot.desks[0].tradeCount = 4;
      positionsSnapshot.positions = [
        { desk: "j", symbol: "DEMO1", side: "Long", quantity: 2, mark: 101, marketValue: 202, dayPnl: 4.5, openPnl: 12.5, updatedAt: new Date().toISOString(), currency: "EUR" },
        { desk: "joel", symbol: "DEMO2", side: "Short", quantity: -1, mark: 88, marketValue: -88, dayPnl: -1, openPnl: 4.75, updatedAt: new Date().toISOString(), currency: "EUR" },
      ];
      richSnapshot = await value(`(() => { window.JoeBoard.ingest(${JSON.stringify(positionsSnapshot)}); return { rows: document.querySelectorAll('#positionsBody tr').length, symbols: document.getElementById('positionsBody')?.innerText, open: document.getElementById('totalOpen')?.textContent, totalDay: document.getElementById('totalDay')?.textContent, positionDayCells: [...document.querySelectorAll('#positionsBody tr')].map((row) => row.children[6]?.textContent), tradeCount: document.querySelector('[data-desk-slot="j"] .desk-money-row')?.innerText }; })()`);
      if (richSnapshot.rows !== 2 || !/DEMO1/.test(richSnapshot.symbols || "") || !/17,25/.test(richSnapshot.open || "") || !/15,75/.test(richSnapshot.totalDay || "") || JSON.stringify(richSnapshot.positionDayCells) !== JSON.stringify(["+€ 4,50", "−€ 1,00"]) || !/4/.test(richSnapshot.tradeCount || "")) throw new Error(`Rich snapshot mismatch: ${JSON.stringify(richSnapshot)}`);

      const partialBackfill = structuredClone(sample);
      delete partialBackfill.pnlSources;
      refreshSnapshotObservationTimes(partialBackfill);
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

  if (fleet && !mobileViewport) {
    fleetUnavailable = true;
    fleetActionsUnavailable = true;
    await send("Page.navigate", { url: hsb1Url });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await value(`document.getElementById('fleetRevision')?.textContent === 'unavailable'`).catch(() => false)) break;
      await delay(100);
    }
    await value(`document.getElementById('settingsMenu').open = true; document.getElementById('settingsFleetConfig').click(); document.querySelector('[data-fleet-section="desks"]').click()`);
    await delay(850);
    const unavailable = await value(`({
      plane: document.documentElement.dataset.joePlane,
      source: document.getElementById('fleetSourcePath').textContent,
      last: document.getElementById('fleetLastPropagate').textContent,
      fields: [...document.querySelectorAll('#fleetEditFields input')].map(node => ({ value: node.value, disabled: node.disabled })),
      readouts: [...document.querySelectorAll('[data-fleet-readout]')].map(node => node.textContent),
      explanation: document.getElementById('fleetLoadStatus').textContent,
      disabled: document.querySelector('[data-fleet-action="propagate"]').disabled,
    })`);
    if (unavailable.plane !== 'fleet-config' || unavailable.source !== 'Unavailable' || unavailable.last !== 'Unknown · log unavailable' ||
        !unavailable.fields.length || !unavailable.fields.every(field => field.disabled && field.value === '') ||
        !unavailable.readouts.every(value => value === '—') || !unavailable.disabled || !/unavailable/.test(unavailable.explanation)) {
      throw new Error(`Fleet unavailable state mismatch: ${JSON.stringify(unavailable)}`);
    }
    fleetUnavailable = false;
    fleetActionsUnavailable = false;
    // v1 permits one declared tool. Missing slots must not become example tools.
    fleetConfig.tools.entries = fleetConfig.tools.entries.slice(0, 1);
    await value(`window.JoeBoard.showTradingBoard()`);
    await delay(850);
    await value(`window.JoeBoard.showFleetConfig()`);
    await delay(850);
    const recovered = await value(`document.getElementById('fleetSourceRevision').textContent`);
    if (recovered !== fleetConfig.rev) throw new Error(`Fleet retry did not recover: ${recovered}`);
    const sparseTools = await value(`(() => {
      document.querySelector('[data-fleet-section="tools"]').click();
      return [...document.querySelectorAll('#fleetEditFields input')].map(node => node.value);
    })()`);
    if (sparseTools[1] !== 'Not declared' || sparseTools[2] !== 'Not declared') {
      throw new Error(`Missing tool slots displayed example values: ${JSON.stringify(sparseTools)}`);
    }
    fleet.unavailable = unavailable;
    fleet.recovered = recovered;
  }

  const source = await readFile(join(repoRoot, "public", "joe", "index.html"), "utf8");
  const fleetSourceStart = source.indexOf('id="fleetConfigBoard"');
  const fleetSourceEnd = source.indexOf("\n</section>\n</div>\n</main>", fleetSourceStart);
  const fleetSource = source.slice(fleetSourceStart, fleetSourceEnd);
  const nonFleetSource = source.slice(0, fleetSourceStart) + source.slice(fleetSourceEnd);
  if (/DUR\d+|1,001,403|SXR8|TSLA/.test(nonFleetSource)) throw new Error("Static trading-plane source still contains Paper-Drill account or position data");
  if (!/data-fleet-readout="keepSymbols"/.test(fleetSource)) throw new Error("Fleet Config must read KEEP symbols from the loaded config");
  if (exceptions.length) throw new Error(`Runtime exceptions: ${exceptions.join("; ")}`);
  console.log(JSON.stringify({ healthy, fleet, historyGeometry, historyContinuity, mobile, phoneOrder, stale, broken, richSnapshot, backfillSnapshot, stub: stub && { ...stub, text: "private stub" }, dataRequests: requests.filter(item => item.path === "/joe/data.json") }, null, 2));
  await withTimeout(send("Browser.close").catch(() => {}), 1000);
  ws.close();
} finally {
  await cleanup();
}
