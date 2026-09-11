#!/usr/bin/env node
/**
 * Joe household board service (csb0).
 * Serves static /joe/ UI + schemas + latest snapshot + history + Fleet Config.
 * Accepts POST /joe/inbox with Bearer token (machine push; no browser OAuth).
 * Accepts same-origin POST /joe/fleet-config/propagate behind external Zitadel SSO.
 * Paper mutation only — never talks to IB, never places orders.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateHouseholdSnapshot } from "./validate.mjs";
import { validateFleetConfig, withNextFleetRevision } from "./fleet-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public", "joe");
// Fixed container paths (not taken from request or free-form env paths).
const DATA_DIR = "/var/lib/joe-board";
const DATA_FILE = path.join(DATA_DIR, "data.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const FLEET_CONFIG_FILE = path.join(DATA_DIR, "fleet-config.json");
const FLEET_CONFIG_EXAMPLE = path.join(PUBLIC, "fleet-config.example.json");
const HISTORY_SCHEMA = "inspr.joe.household.history.v1";
const HISTORY_MAX_POINTS = 10000;
const HISTORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const HISTORY_BASIS_MAX = 96;
const HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const TOKEN_FILE = "/run/secrets/joe-board-push-token";
const BIND_HOST = "0.0.0.0";
const BIND_PORT = 8080;
const MAX_BODY = 262144;

const STATIC_FILES = Object.freeze({
  "/joe/": "index.html",
  "/joe/index.html": "index.html",
  "/joe/data.schema.json": "data.schema.json",
  "/joe/fleet-config.schema.json": "fleet-config.schema.json",
  "/joe/fleet-config.example.json": "fleet-config.example.json",
  "/joe/joe.css": "joe.css",
  "/joe/joe.js": "joe.js",
  "/joe/joe-version.js": "joe-version.js",
  "/joe/vendor/chart-4.4.8.umd.js": "vendor/chart-4.4.8.umd.js",
  "/joe/vendor/chartjs-plugin-zoom-2.2.0.min.js": "vendor/chartjs-plugin-zoom-2.2.0.min.js",
  "/joe/vendor/gridstack-13.2.0-all.js": "vendor/gridstack-13.2.0-all.js",
  "/joe/vendor/gridstack-13.2.0.min.css": "vendor/gridstack-13.2.0.min.css",
  "/joe/vendor/hammer-2.0.8.min.js": "vendor/hammer-2.0.8.min.js",
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch (err) {
    // Local/dev fallback only when secret file absent.
    const fallback = process.env.JOE_INBOX_TOKEN;
    if (typeof fallback === "string" && fallback.length >= 16) return fallback.trim();
    console.error("token read failed", err && err.code ? err.code : err);
    return "";
  }
}

function safeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) {
    timingSafeEqual(aa, Buffer.alloc(aa.length));
    return false;
  }
  return timingSafeEqual(aa, bb);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteJson(file, obj) {
  ensureDataDir();
  const text = JSON.stringify(obj, null, 2) + "\n";
  const tmp = `${file}.next`;
  fs.writeFileSync(tmp, text, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

function parseFleetConfig(raw, source) {
  const parsed = JSON.parse(raw);
  const result = validateFleetConfig(parsed);
  if (!result.ok) {
    throw new Error(`${source} failed Fleet Config validation: ${result.errors.slice(0, 5).join("; ")}`);
  }
  return parsed;
}

function readFleetConfig() {
  try {
    return parseFleetConfig(fs.readFileSync(FLEET_CONFIG_FILE, "utf8"), FLEET_CONFIG_FILE);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return parseFleetConfig(fs.readFileSync(FLEET_CONFIG_EXAMPLE, "utf8"), FLEET_CONFIG_EXAMPLE);
  }
}

function requestIsSameOrigin(req) {
  if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return false;
  const origin = String(req.headers.origin || "");
  if (!origin) return false;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const requestHosts = [req.headers["x-forwarded-host"], req.headers.host]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return requestHosts.includes(originHost);
}


function emptyHistory() {
  return { schema: HISTORY_SCHEMA, points: [] };
}

function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== HISTORY_SCHEMA || !Array.isArray(parsed.points)) {
      return emptyHistory();
    }
    return { schema: HISTORY_SCHEMA, points: parsed.points };
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyHistory();
    console.error("history read failed", err && err.code ? err.code : err);
    return emptyHistory();
  }
}

function moneyBag(bag) {
  if (!bag || typeof bag !== "object") {
    return { equity: null, dayPnl: null, totalPnl: null };
  }
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    equity: num(bag.equity),
    dayPnl: num(bag.dayPnl),
    totalPnl: num(bag.totalPnl),
  };
}

function accountingBasis(accounting) {
  if (!accounting || typeof accounting !== "object") return null;
  if (
    typeof accounting.periodStart !== "string" ||
    accounting.method !== "execution-fifo-net-current-fx" ||
    typeof accounting.detail !== "string"
  ) {
    return null;
  }
  return {
    periodStart: accounting.periodStart,
    method: accounting.method,
    detail: accounting.detail,
  };
}

function historyBasisId(value) {
  return typeof value === "string" && value.length <= HISTORY_BASIS_MAX && HISTORY_BASIS.test(value)
    ? value
    : null;
}

function historyPointFromSnapshot(snapshot) {
  const desks = {};
  const accounting = {};
  const historyBasis = {};
  const list = Array.isArray(snapshot.desks) ? snapshot.desks : [];
  for (const desk of list) {
    if (!desk || typeof desk.id !== "string" || !desk.id) continue;
    desks[desk.id] = moneyBag(desk.money);
    const basis = accountingBasis(desk.accounting);
    if (basis) accounting[desk.id] = basis;
    const basisId = historyBasisId(desk.historyBasis);
    if (basisId) historyBasis[desk.id] = basisId;
  }
  // Also accept object-shaped desks (defensive; producers may evolve).
  if (!list.length && snapshot.desks && typeof snapshot.desks === "object") {
    for (const [id, desk] of Object.entries(snapshot.desks)) {
      desks[id] = moneyBag(desk && desk.money ? desk.money : desk);
      const basis = accountingBasis(desk && desk.accounting);
      if (basis) accounting[id] = basis;
      const basisId = historyBasisId(desk && desk.historyBasis);
      if (basisId) historyBasis[id] = basisId;
    }
  }
  const point = {
    t: snapshot.generatedAt,
    desks,
    totals: moneyBag(snapshot.totals),
  };
  if (Object.keys(accounting).length) point.accounting = accounting;
  if (Object.keys(historyBasis).length) point.historyBasis = historyBasis;
  return point;
}

function pruneHistoryPoints(points, nowMs = Date.now()) {
  const cutoff = nowMs - HISTORY_MAX_AGE_MS;
  let next = points.filter((p) => {
    if (!p || typeof p.t !== "string") return false;
    const ms = Date.parse(p.t);
    return Number.isFinite(ms) && ms >= cutoff;
  });
  if (next.length > HISTORY_MAX_POINTS) {
    next = next.slice(next.length - HISTORY_MAX_POINTS);
  }
  return next;
}

function appendHistoryPoint(snapshot) {
  const point = historyPointFromSnapshot(snapshot);
  if (!point.t || typeof point.t !== "string") {
    throw new Error("history point missing t");
  }
  const hist = readHistory();
  const last = hist.points.length ? hist.points[hist.points.length - 1] : null;
  // Dedupe identical timestamp (pusher retries / same generatedAt).
  if (last && last.t === point.t) {
    hist.points[hist.points.length - 1] = point;
  } else {
    hist.points.push(point);
  }
  hist.points = pruneHistoryPoints(hist.points);
  atomicWriteJson(HISTORY_FILE, hist);
  return hist.points.length;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, `${JSON.stringify(obj)}\n`, { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const h = String(req.headers.authorization || "");
  const prefix = "Bearer ";
  if (h.length < prefix.length || h.slice(0, prefix.length).toLowerCase() !== "bearer ") {
    return "";
  }
  // Skip "Bearer" + single space without regex (avoids ReDoS findings).
  return h.slice(prefix.length).trim();
}

async function handleInbox(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const expected = readToken();
  if (!expected) {
    sendJson(res, 503, { ok: false, error: "inbox token not configured" });
    return;
  }
  const got = bearerToken(req);
  if (!got || !safeEqualStr(got, expected)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (err) {
    if (err.code === "TOO_LARGE") {
      sendJson(res, 413, { ok: false, error: "body too large" });
      return;
    }
    sendJson(res, 400, { ok: false, error: "bad body" });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid json" });
    return;
  }
  const { ok, errors } = validateHouseholdSnapshot(parsed);
  if (!ok) {
    sendJson(res, 422, { ok: false, error: "schema validation failed", errors: errors.slice(0, 20) });
    return;
  }
  try {
    atomicWriteJson(DATA_FILE, parsed);
  } catch (err) {
    console.error("atomic write failed", err);
    sendJson(res, 500, { ok: false, error: "store failed" });
    return;
  }
  let historyPoints = null;
  try {
    historyPoints = appendHistoryPoint(parsed);
  } catch (err) {
    // Snapshot already stored — do not fail the push if history append breaks.
    console.error("history append failed", err);
  }
  sendJson(res, 200, {
    ok: true,
    storedAt: new Date().toISOString(),
    generatedAt: parsed.generatedAt,
    equity: parsed.totals?.equity ?? null,
    historyPoints,
  });
}

function sendFleetConfig(req, res) {
  let config;
  try {
    config = readFleetConfig();
  } catch (err) {
    console.error("fleet config read failed", err);
    sendJson(res, 503, { ok: false, error: "fleet config unavailable" });
    return;
  }
  const etag = `"${config.rev}"`;
  if (req.headers["if-none-match"] === etag) {
    send(res, 304, "", { ETag: etag, "Cache-Control": "private, no-cache" });
    return;
  }
  sendJson(res, 200, config, { ETag: etag, "Cache-Control": "private, no-cache" });
}

async function handleFleetPropagate(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  // The route inherits JoeDesk's Zitadel reverse-proxy boundary. These browser
  // signals additionally reject cross-site and direct unauthenticated writes.
  if (!requestIsSameOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "same-origin authenticated browser required" });
    return;
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendJson(res, 415, { ok: false, error: "content-type must be application/json" });
    return;
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (err) {
    sendJson(res, err.code === "TOO_LARGE" ? 413 : 400, { ok: false, error: err.code === "TOO_LARGE" ? "body too large" : "bad body" });
    return;
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid json" });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["baseRev", "config"].includes(key)) || !Object.hasOwn(body, "baseRev") || !Object.hasOwn(body, "config")) {
    sendJson(res, 422, { ok: false, error: "propagate envelope is invalid" });
    return;
  }

  let current;
  try {
    current = readFleetConfig();
  } catch (err) {
    console.error("fleet config read failed", err);
    sendJson(res, 503, { ok: false, error: "fleet config unavailable" });
    return;
  }
  if (body.baseRev !== current.rev || body.config?.rev !== body.baseRev) {
    sendJson(res, 409, { ok: false, error: "fleet config revision conflict", currentRev: current.rev });
    return;
  }

  const candidateResult = validateFleetConfig(body.config);
  if (!candidateResult.ok) {
    sendJson(res, 422, { ok: false, error: "schema validation failed", errors: candidateResult.errors.slice(0, 20) });
    return;
  }
  if (!isDeepStrictEqual(body.config.tools, current.tools)) {
    sendJson(res, 422, { ok: false, error: "tools are read-only" });
    return;
  }
  if (!isDeepStrictEqual(body.config.secretSlots, current.secretSlots)) {
    sendJson(res, 422, { ok: false, error: "secret slots are read-only in HOSTD-49" });
    return;
  }
  const comparable = structuredClone(body.config);
  comparable.rev = current.rev;
  comparable.updatedAt = current.updatedAt;
  if (isDeepStrictEqual(comparable, current)) {
    sendJson(res, 422, { ok: false, error: "fleet config has no changes" });
    return;
  }

  let next;
  try {
    next = withNextFleetRevision(body.config, current.rev);
    const nextResult = validateFleetConfig(next);
    if (!nextResult.ok) throw new Error(nextResult.errors.slice(0, 5).join("; "));
    atomicWriteJson(FLEET_CONFIG_FILE, next);
  } catch (err) {
    console.error("fleet config atomic write failed", err);
    sendJson(res, 500, { ok: false, error: "fleet config store failed" });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    rev: next.rev,
    propagatedAt: next.updatedAt,
    config: next,
    adapter: {
      id: "shared-file",
      status: "written",
      path: FLEET_CONFIG_FILE,
      consumers: ["amy", "desks"],
      reload: "read-on-revision",
    },
    hooks: {
      actionLog: "HOSTD-50",
      secretSlots: "HOSTD-51",
      rotation: "HOSTD-52",
    },
  });
}

function handleStatic(req, res, urlPath) {
  if (urlPath === "/joe/fleet-config.json") {
    sendFleetConfig(req, res);
    return;
  }

  if (urlPath === "/joe/data.json") {
    let body;
    try {
      body = fs.readFileSync(DATA_FILE);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        sendJson(res, 404, { ok: false, error: "NO DATA" });
        return;
      }
      throw err;
    }
    send(res, 200, body, { "Content-Type": "application/json; charset=utf-8" });
    return;
  }

  if (urlPath === "/joe/history.json") {
    let body;
    try {
      body = fs.readFileSync(HISTORY_FILE);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        sendJson(res, 404, emptyHistory());
        return;
      }
      throw err;
    }
    send(res, 200, body, { "Content-Type": "application/json; charset=utf-8" });
    return;
  }

  const name = STATIC_FILES[urlPath];
  if (!name) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  const file = path.join(PUBLIC, name);
  const body = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  send(res, 200, body, { "Content-Type": MIME[ext] || "application/octet-stream" });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const u = new URL(req.url || "/", `http://${host}`);
    const urlPath = u.pathname;

    if (urlPath === "/joe") {
      send(res, 308, "", { Location: `/joe/${u.search}` });
      return;
    }

    if (urlPath === "/healthz" || urlPath === "/readyz") {
      let hasData = false;
      try {
        fs.accessSync(DATA_FILE, fs.constants.R_OK);
        hasData = true;
      } catch {
        hasData = false;
      }
      sendJson(res, 200, { ok: true, service: "joe-board", hasData });
      return;
    }

    if (urlPath === "/joe/inbox") {
      await handleInbox(req, res);
      return;
    }

    if (urlPath === "/joe/fleet-config/propagate") {
      await handleFleetPropagate(req, res);
      return;
    }

    if (urlPath.startsWith("/joe/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      handleStatic(req, res, urlPath);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    console.error("request error", err);
    sendJson(res, 500, { ok: false, error: "internal" });
  }
});

ensureDataDir();
try {
  readFleetConfig();
} catch (err) {
  // Keep the household board available; Fleet Config routes fail closed with 503.
  console.error("fleet config unavailable at startup", err);
}
server.listen(BIND_PORT, BIND_HOST, () => {
  console.log(`joe-board listening on ${BIND_HOST}:${BIND_PORT} data=${DATA_DIR}`);
});
