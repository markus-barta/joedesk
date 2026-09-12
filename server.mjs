#!/usr/bin/env node
/**
 * Joe household board service (csb0).
 * Serves static /joe/ UI + schemas + latest snapshot + history + Fleet Config.
 * Accepts POST /joe/inbox with Bearer token (machine push; no browser OAuth).
 * Accepts same-origin POST /joe/fleet-config/propagate with proxy-supplied Zitadel identity.
 * Paper mutation only — never talks to IB, never places orders.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
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
const FLEET_ACTION_LOG_FILE = path.join(DATA_DIR, "fleet-config-actions.json");
const FLEET_CONFIG_EXAMPLE = path.join(PUBLIC, "fleet-config.example.json");
const FLEET_ACTION_LOG_SCHEMA = "inspr.joe.fleet-config.actions.v1";
const FLEET_ACTION_LOG_MAX = 200;
const FLEET_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,159}$/;
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
  "/joe/fleet-config-actions.schema.json": "fleet-config-actions.schema.json",
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

function atomicWriteJson(file, obj, mode = 0o644) {
  ensureDataDir();
  const text = JSON.stringify(obj, null, 2) + "\n";
  const tmp = `${file}.next`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
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

function emptyFleetActionLog() {
  return { schema: FLEET_ACTION_LOG_SCHEMA, entries: [] };
}

function readFleetActionLog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLEET_ACTION_LOG_FILE, "utf8"));
    if (!parsed || parsed.schema !== FLEET_ACTION_LOG_SCHEMA || !Array.isArray(parsed.entries)) {
      throw new Error("invalid Fleet Config action log");
    }
    return parsed;
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyFleetActionLog();
    throw err;
  }
}

function writeFleetActionLog(log) {
  atomicWriteJson(FLEET_ACTION_LOG_FILE, {
    schema: FLEET_ACTION_LOG_SCHEMA,
    entries: log.entries.slice(-FLEET_ACTION_LOG_MAX),
  }, 0o600);
}

function fleetActor(req) {
  const actor = String(req.headers["x-auth-request-user"] || "").trim();
  return FLEET_ACTOR.test(actor) ? actor : "";
}

const FLEET_AUDIT_PATHS = Object.freeze([
  ["mode", "mode"],
  ["quota.grok.reservePct", "quota.grok.reservePct"],
  ["quota.codex.reservePct", "quota.codex.reservePct"],
  ["quota.behavior.green", "quota.behavior.green"],
  ["quota.behavior.amber", "quota.behavior.amber"],
  ["quota.behavior.red", "quota.behavior.red"],
  ["desks.maxBusyDesks", "desks.maxBusyDesks"],
  ["desks.stage0.capEur", "desks.stage0.capEur"],
  ["desks.keep", "desks.keep"],
  ["cadence.timeZone", "cadence.timeZone"],
  ["cadence.usOpenArm", "cadence.usOpenArm"],
  ["cadence.deskWatch", "cadence.deskWatch"],
  ["cadence.darwin", "cadence.darwin"],
  ["cadence.quotaGovernor", "cadence.quotaGovernor"],
  ["cadence.wakeWindows", "cadence.wakeWindows"],
  ["amy.routines.morning", "amy.routines.morning"],
  ["amy.routines.review", "amy.routines.review"],
  ["amy.routines.close", "amy.routines.close"],
  ["mac.shared.configPath", "mac.shared.configPath"],
  ["mac.shared.docsPath", "mac.shared.docsPath"],
  ["mac.knobs.syncMode", "mac.knobs.syncMode"],
  ["tools", "tools.[read-only]"],
  ["secretSlots", "secretSlots.[redacted]"],
]);

function fleetPathValue(source, dottedPath) {
  return dottedPath.split(".").reduce(
    (value, key) => (value !== null && typeof value === "object" ? value[key] : undefined),
    source,
  );
}

function fleetChangedKeys(before, after) {
  if (!after || typeof after !== "object" || Array.isArray(after)) return [];
  return FLEET_AUDIT_PATHS
    .filter(([pathName]) => !isDeepStrictEqual(fleetPathValue(before, pathName), fleetPathValue(after, pathName)))
    .map(([, auditName]) => auditName);
}

function fleetAction({ actor, revBefore, revAfter, changedKeys, outcome, reason, id }) {
  return {
    id: id || `fa-${Date.now()}-${randomUUID().slice(0, 8)}`,
    at: new Date().toISOString(),
    actor,
    revBefore: typeof revBefore === "string" ? revBefore : null,
    revAfter: typeof revAfter === "string" ? revAfter : null,
    changedKeys: Array.isArray(changedKeys) ? changedKeys.slice(0, FLEET_AUDIT_PATHS.length) : [],
    outcome,
    reason,
  };
}

function appendFleetAction(entry) {
  const log = readFleetActionLog();
  log.entries.push(entry);
  writeFleetActionLog(log);
  return entry;
}

function sendFleetFailure(res, status, error, { actor, current = null, candidate = null, reason, extra = {} }) {
  let action = null;
  try {
    action = appendFleetAction(fleetAction({
      actor,
      revBefore: current?.rev,
      revAfter: current?.rev,
      changedKeys: fleetChangedKeys(current, candidate),
      outcome: "failure",
      reason,
    }));
  } catch (auditError) {
    console.error("fleet action log write failed", auditError);
  }
  sendJson(res, status, { ok: false, error, ...extra, ...(action ? { action } : { audit: { recorded: false } }) });
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
  let hasCarriedMoney = false;
  const list = Array.isArray(snapshot.desks) ? snapshot.desks : [];
  for (const desk of list) {
    if (!desk || typeof desk.id !== "string" || !desk.id) continue;
    const money = moneyBag(desk.money);
    if (desk.moneyEvidence?.status === "carried") {
      money.equity = null;
      money.totalPnl = null;
      hasCarriedMoney = true;
    }
    desks[desk.id] = money;
    const basis = accountingBasis(desk.accounting);
    if (basis) accounting[desk.id] = basis;
    const basisId = historyBasisId(desk.historyBasis);
    if (basisId) historyBasis[desk.id] = basisId;
  }
  // Also accept object-shaped desks (defensive; producers may evolve).
  if (!list.length && snapshot.desks && typeof snapshot.desks === "object") {
    for (const [id, desk] of Object.entries(snapshot.desks)) {
      const money = moneyBag(desk && desk.money ? desk.money : desk);
      if (desk?.moneyEvidence?.status === "carried") {
        money.equity = null;
        money.totalPnl = null;
        hasCarriedMoney = true;
      }
      desks[id] = money;
      const basis = accountingBasis(desk && desk.accounting);
      if (basis) accounting[id] = basis;
      const basisId = historyBasisId(desk && desk.historyBasis);
      if (basisId) historyBasis[id] = basisId;
    }
  }
  const totals = moneyBag(snapshot.totals);
  if (hasCarriedMoney) {
    totals.equity = null;
    totals.totalPnl = null;
  }
  const point = {
    t: snapshot.generatedAt,
    desks,
    totals,
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

function sendFleetActions(res) {
  try {
    sendJson(res, 200, readFleetActionLog(), { "Cache-Control": "private, no-cache" });
  } catch (err) {
    console.error("fleet action log read failed", err);
    sendJson(res, 503, { ok: false, error: "fleet action log unavailable" });
  }
}

async function handleFleetPropagate(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  // Traefik strips the incoming identity header and oauth2-proxy supplies this
  // value only after Zitadel authentication. Never accept a browser-supplied
  // identity through the JSON envelope.
  const actor = fleetActor(req);
  if (!actor) {
    sendJson(res, 403, { ok: false, error: "Zitadel-authenticated user required" });
    return;
  }
  // Same-origin browser signals additionally reject cross-site writes.
  if (!requestIsSameOrigin(req)) {
    sendFleetFailure(res, 403, "same-origin authenticated browser required", { actor, reason: "origin_rejected" });
    return;
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    sendFleetFailure(res, 415, "content-type must be application/json", { actor, reason: "content_type_rejected" });
    return;
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (err) {
    sendFleetFailure(res, err.code === "TOO_LARGE" ? 413 : 400, err.code === "TOO_LARGE" ? "body too large" : "bad body", {
      actor,
      reason: err.code === "TOO_LARGE" ? "body_too_large" : "body_rejected",
    });
    return;
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendFleetFailure(res, 400, "invalid json", { actor, reason: "json_rejected" });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["baseRev", "config"].includes(key)) || !Object.hasOwn(body, "baseRev") || !Object.hasOwn(body, "config")) {
    sendFleetFailure(res, 422, "propagate envelope is invalid", { actor, candidate: body?.config, reason: "envelope_rejected" });
    return;
  }

  let current;
  try {
    current = readFleetConfig();
  } catch (err) {
    console.error("fleet config read failed", err);
    sendFleetFailure(res, 503, "fleet config unavailable", { actor, candidate: body.config, reason: "config_unavailable" });
    return;
  }
  if (body.baseRev !== current.rev || body.config?.rev !== body.baseRev) {
    sendFleetFailure(res, 409, "fleet config revision conflict", {
      actor,
      current,
      candidate: body.config,
      reason: "revision_conflict",
      extra: { currentRev: current.rev },
    });
    return;
  }

  const candidateResult = validateFleetConfig(body.config);
  if (!candidateResult.ok) {
    sendFleetFailure(res, 422, "schema validation failed", {
      actor,
      current,
      candidate: body.config,
      reason: "schema_rejected",
      extra: { errors: candidateResult.errors.slice(0, 20) },
    });
    return;
  }
  if (!isDeepStrictEqual(body.config.tools, current.tools)) {
    sendFleetFailure(res, 422, "tools are read-only", { actor, current, candidate: body.config, reason: "read_only_tools" });
    return;
  }
  if (!isDeepStrictEqual(body.config.secretSlots, current.secretSlots)) {
    sendFleetFailure(res, 422, "secret slots are read-only in HOSTD-49", {
      actor,
      current,
      candidate: body.config,
      reason: "read_only_secret_slots",
    });
    return;
  }
  const comparable = structuredClone(body.config);
  comparable.rev = current.rev;
  comparable.updatedAt = current.updatedAt;
  if (isDeepStrictEqual(comparable, current)) {
    sendFleetFailure(res, 422, "fleet config has no changes", { actor, current, candidate: body.config, reason: "no_changes" });
    return;
  }

  let next;
  let pendingAction;
  let actionLog;
  try {
    next = withNextFleetRevision(body.config, current.rev);
    const nextResult = validateFleetConfig(next);
    if (!nextResult.ok) throw new Error(nextResult.errors.slice(0, 5).join("; "));
    actionLog = readFleetActionLog();
    pendingAction = fleetAction({
      actor,
      revBefore: current.rev,
      revAfter: next.rev,
      changedKeys: fleetChangedKeys(current, next),
      outcome: "pending",
      reason: "write_started",
    });
    actionLog.entries.push(pendingAction);
    writeFleetActionLog(actionLog);
    atomicWriteJson(FLEET_CONFIG_FILE, next);
  } catch (err) {
    console.error("fleet config atomic write failed", err);
    if (pendingAction && actionLog) {
      try {
        actionLog.entries[actionLog.entries.length - 1] = fleetAction({
          id: pendingAction.id,
          actor,
          revBefore: current.rev,
          revAfter: current.rev,
          changedKeys: pendingAction.changedKeys,
          outcome: "failure",
          reason: "store_failed",
        });
        writeFleetActionLog(actionLog);
      } catch (auditError) {
        console.error("fleet action log failure update failed", auditError);
      }
    } else {
      try {
        appendFleetAction(fleetAction({
          actor,
          revBefore: current.rev,
          revAfter: current.rev,
          changedKeys: fleetChangedKeys(current, body.config),
          outcome: "failure",
          reason: "store_failed",
        }));
      } catch (auditError) {
        console.error("fleet action log write failed", auditError);
      }
    }
    sendJson(res, 500, { ok: false, error: "fleet config store failed" });
    return;
  }

  let action;
  try {
    action = fleetAction({
      id: pendingAction.id,
      actor,
      revBefore: current.rev,
      revAfter: next.rev,
      changedKeys: pendingAction.changedKeys,
      outcome: "success",
      reason: "propagated",
    });
    actionLog.entries[actionLog.entries.length - 1] = action;
    writeFleetActionLog(actionLog);
  } catch (err) {
    // The durable pending record is intentionally retained: it never falsely
    // claims a completed audit outcome if finalization fails after config write.
    console.error("fleet action log finalize failed", err);
    sendJson(res, 500, { ok: false, error: "fleet config stored but action log finalization failed", currentRev: next.rev });
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
    action,
    hooks: {
      secretSlots: "read-only-refs",
      rotation: "HOSTD-52",
    },
  });
}

function handleStatic(req, res, urlPath) {
  if (urlPath === "/joe/fleet-config.json") {
    sendFleetConfig(req, res);
    return;
  }

  if (urlPath === "/joe/fleet-config/actions.json") {
    sendFleetActions(res);
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
