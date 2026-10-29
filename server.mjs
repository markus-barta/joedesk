#!/usr/bin/env node
/**
 * Joe household board service (csb0).
 * Serves static /joe/ UI + schemas + latest snapshot + history + Fleet Config.
 * Accepts POST /joe/inbox[/results] with Bearer token (machine push; no browser OAuth).
 * Accepts same-origin POST /joe/fleet-config/propagate with proxy-supplied Zitadel identity.
 * Paper mutation only — never talks to IB, never places orders.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import release from "./release.json" with { type: "json" };
import { CONTRACTS, validateContract } from "./contracts/index.mjs";
import { createReadModel } from "./server/read-model.mjs";
import { healthProjection } from "./server/health.mjs";
import { withNextFleetRevision } from "./fleet-config.mjs";
import { normalizeFleetConfig, appendFleetNormalizationAudit, validateFleetActions, FLEET_ACTION_LOG_MAX } from "./server/fleet-normalization.mjs";
import { createBoardSettingsStore, validateBoardSettings } from "./server/board-settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public", "joe");

export function createJoeServer({ dataDir = "/var/lib/joe-board", clock = () => new Date().toISOString(), inboxToken = null, write } = {}) {
// Fixed container paths (not taken from request or free-form env paths).
const DATA_DIR = dataDir;
const model = createReadModel({ dataDir, clock, ...(write ? { write } : {}) });
const boardSettings = createBoardSettingsStore({ dataDir, ...(write ? { write } : {}) });
const FLEET_CONFIG_FILE = path.join(DATA_DIR, "fleet-config.json");
const FLEET_ACTION_LOG_FILE = path.join(DATA_DIR, "fleet-config-actions.json");
const FLEET_CONFIG_EXAMPLE = path.join(PUBLIC, "fleet-config.example.json");
const FLEET_ACTION_LOG_SCHEMA = "inspr.joe.fleet-config.actions.v1";
const FLEET_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,159}$/;
const TOKEN_FILE = "/run/secrets/joe-board-push-token";
const MAX_BODY = 262144;

const PROTECTED_READS = new Set(["/joe/data.json", "/joe/history.json", "/joe/account-history.json", "/joe/history-continuity.json", "/joe/results.json", "/joe/state.json", "/joe/fleet-config.json", "/joe/fleet-config/actions.json", "/joe/board-settings.json"]);
// Offline native imports share this exact package with server acceptance.
const CONTRACT_FILES = Object.freeze(Object.fromEntries([
  "index.mjs", "read.mjs", "schema-validator.mjs", "semantics.mjs", "vienna-date.mjs", "accept.mjs", "decimal.mjs", "gateway.mjs", "panel-state.mjs",
  "manifest.json", "common.schema.json", "reason.schema.json", "data.schema.json", "history.schema.json", "results.schema.json", "fleet-config.schema.json", "healthz.schema.json",
].map(name => [`/joe/contracts/${name}`, name])));
const SHARED_FILES = Object.freeze({ "/joe/time.mjs": "time.mjs", "/joe/market-calendar.json": "market-calendar.json" });
function feedHeaders(kind) {
  const feed = model.feeds()[kind];
  const receivedAt = feed.value?.receivedAt ?? feed.receivedAt;
  return { "X-Joe-Server-Now": clock(),
    ...(feed.reason ? { "X-Joe-Feed-Reason": feed.reason } : {}),
    ...(feed.generatedAdvancedAt ? { "X-Joe-Generated-Advanced-At": feed.generatedAdvancedAt } : {}),
    ...(receivedAt ? { "X-Joe-Received-At": receivedAt } : {}) };
}

// The UI is plain ES modules; every served asset is listed here explicitly.
const UI_MODULES = ["app.js", "host.js", "ui.js", "terms.js", "format.js", "health.js", "feed.js", "board-state.js", "events.js",
  "desk.js", "performance.js", "history.js", "history-model.js", "history-worker.js", "history-continuity.js", "chart.js", "results.js", "results-model.js", "theme.js",
  "settings.js", "settings-model.js", "board-settings.js", "board-settings-validation.js", "board-settings-write.js", "fleet-write.js", "version-display.js"];
const VENDOR_FILES = Object.freeze(Object.fromEntries(['display.json', 'version.js', 'presentation.js', 'version-interaction.js', 'schemes.json', 'package.json', 'manifest.json']
  .map(name => [`/joe/vendor/calver/${name}`, `vendor/calver/${name}`])));
const STATIC_FILES = Object.freeze({
  "/joe/": "index.html",
  "/joe/index.html": "index.html",
  "/joe/app.css": "app.css",
  ...Object.fromEntries(UI_MODULES.map(name => [`/joe/${name}`, name])),
  "/joe/data.schema.json": "data.schema.json",
  "/joe/fleet-config.schema.json": "fleet-config.schema.json",
  "/joe/fleet-config-actions.schema.json": "fleet-config-actions.schema.json",
  "/joe/fleet-config.example.json": "fleet-config.example.json",
  "/joe/joe-version.js": "joe-version.js",
});
// Workers ignore the page's import map, so the history worker and its imports
// load under this release's own path; another release's path is not found.
const RELEASE_PREFIX = `/joe/v/${release.version}/`;
const VERSIONED_FILES = Object.freeze({
  ...Object.fromEntries(Object.entries(VENDOR_FILES).map(([route, name]) => [route.replace('/joe/', RELEASE_PREFIX), path.join(PUBLIC, name)])),
  ...Object.fromEntries(UI_MODULES.map(name => [`${RELEASE_PREFIX}${name}`, path.join(PUBLIC, name)])),
  ...Object.fromEntries(Object.entries(CONTRACT_FILES).map(([route, name]) => [route.replace("/joe/", RELEASE_PREFIX), path.join(__dirname, "contracts", name)])),
  ...Object.fromEntries(Object.entries(SHARED_FILES).map(([route, name]) => [route.replace("/joe/", RELEASE_PREFIX), path.join(__dirname, name)])),
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
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

function parseFleetConfig(raw) {
  const parsed = JSON.parse(raw);
  const result = validateContract("fleet-config", parsed);
  if (!result.ok) {
    throw new Error("Fleet Config contract_invalid");
  }
  return parsed;
}

function readFleetConfig(source = {}) {
  let raw;
  try {
    raw = fs.readFileSync(FLEET_CONFIG_FILE, "utf8");
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    const accepted = model.feeds()["fleet-config"].value;
    const starter = parseFleetConfig(fs.readFileSync(FLEET_CONFIG_EXAMPLE, "utf8"));
    if (accepted && !isDeepStrictEqual(accepted, starter)) {
      model.fleetFailure();
      throw err;
    }
    source.path = FLEET_CONFIG_EXAMPLE;
    source.kind = "example";
    return starter;
  }
  const parsed = JSON.parse(raw);
  const normalized = normalizeFleetConfig(parsed, clock());
  const config = normalized.value;
  if (normalized.added.length) {
    let log = readFleetActionLog();
    validateFleetActions(log);
    // A failed or interrupted attempt belongs to this stored revision. Reuse
    // its latest migration row so repeated reads cannot grow the action log.
    let action = log.entries.findLast(entry => entry.actor === "migration" &&
      entry.revBefore === parsed.rev && ["pending", "failure"].includes(entry.outcome));
    if (action) {
      Object.assign(action, { at: config.updatedAt, revAfter: config.rev,
        changedKeys: ["desks.keep"], outcome: "pending", reason: "write_started" });
    } else {
      log = appendFleetNormalizationAudit(log, parsed, config, config.updatedAt, { pending: true });
      action = log.entries[log.entries.length - 1];
    }
    // Match the board's audit-first write: a failed config write can never
    // leave a false success. Finalization replaces this one pending entry.
    try {
      writeFleetActionLog(log);
      atomicWriteJson(FLEET_CONFIG_FILE, config);
    } catch (error) {
      Object.assign(action, { revAfter: parsed.rev, outcome: "failure", reason: "store_failed" });
      try {
        validateFleetActions(log);
        writeFleetActionLog(log);
      } catch { /* Best effort: preserve the original store failure. */ }
      throw error;
    }
    action.outcome = "success";
    action.reason = "propagated";
    validateFleetActions(log);
    writeFleetActionLog(log);
  }
  source.path = FLEET_CONFIG_FILE;
  source.kind = "stored";
  return config;
}

function emptyFleetActionLog() {
  return { schema: FLEET_ACTION_LOG_SCHEMA, entries: [] };
}

function readFleetActionLog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLEET_ACTION_LOG_FILE, "utf8"));
    if (!parsed || parsed.schema !== FLEET_ACTION_LOG_SCHEMA || !Array.isArray(parsed.entries)) {
      throw new Error("migration_fleet_actions_invalid");
    }
    return parsed;
  } catch (err) {
    if (err && err.code === "ENOENT") return emptyFleetActionLog();
    if (err instanceof SyntaxError) throw new Error("migration_fleet_actions_invalid");
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


function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    ...headers,
    // The deploy smoke distinguishes app responses from edge SSO denials.
    "X-JoeDesk-Origin": "app",
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
    let size = 0, oversized = false;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        if (!oversized) { oversized = true; chunks.length = 0; reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" })); }
        return;
      }
      if (!oversized) chunks.push(chunk);
    });
    req.on("end", () => { if (!oversized) resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("body aborted")));
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

async function handleInbox(req, res, kind = 'data') {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, reason: "route_not_found" });
  const expected = inboxToken ?? readToken();
  if (!expected) return sendJson(res, 503, { ok: false, reason: "auth_required" });
  if (!safeEqualStr(bearerToken(req), expected)) return sendJson(res, 401, { ok: false, reason: "auth_required" });
  let raw;
  try { raw = await readBody(req, CONTRACTS.limits[kind]); }
  catch (error) {
    const status = error.code === "TOO_LARGE" ? 413 : 400;
    const rejected = model.reject("contract_invalid", status, kind);
    return sendJson(res, rejected.status, rejected);
  }
  let candidate;
  try { candidate = JSON.parse(raw.toString("utf8")); }
  catch {
    const rejected = model.reject("contract_invalid", 400, kind);
    return sendJson(res, rejected.status, rejected);
  }
  const result = kind === 'results' ? model.acceptResults(candidate) : model.accept(candidate);
  sendJson(res, result.status, result);
}

function sendFleetConfig(req, res) {
  let config;
  const source = {};
  try {
    config = readFleetConfig(source);
    const checked = model.observeFleet(config);
    if (!checked.ok) throw new Error("contract_invalid");
  } catch (err) {
    model.fleetFailure();
    sendJson(res, 503, { ok: false, error: "fleet config unavailable", reason: "refresh_failed" });
    return;
  }
  const etag = `"${config.rev}"`;
  const headers = {
    ...feedHeaders("fleet-config"),
    ETag: etag,
    "Cache-Control": "private, no-cache",
    "X-Joe-Fleet-Source-Path": source.path,
    "X-Joe-Fleet-Source-Kind": source.kind,
  };
  if (req.headers["if-none-match"] === etag) {
    send(res, 304, "", headers);
    return;
  }
  sendJson(res, 200, config, headers);
}

function sendFleetActions(res) {
  try {
    sendJson(res, 200, readFleetActionLog(), { "Cache-Control": "private, no-cache" });
  } catch (err) {
    console.error("fleet action log read failed", err);
    sendJson(res, 503, { ok: false, error: "fleet action log unavailable" });
  }
}

async function handleBoardSettings(req, res) {
  // Mirror handleFleetPropagate: same trusted proxy identity, browser origin
  // check, JSON content type and bounded body. No machine-token write path.
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method not allowed" });
  const actor = fleetActor(req);
  if (!actor) return sendJson(res, 403, { ok: false, error: "Zitadel-authenticated user required" });
  const log = (outcome, reason) => console.info(JSON.stringify({ event: "board_settings_write", at: clock(), actor,
    changedKeys: ["accountStart"], outcome, reason }));
  const fail = (status, error, reason) => {
    log("failure", reason);
    return sendJson(res, status, { ok: false, error });
  };
  if (!requestIsSameOrigin(req)) return fail(403, "same-origin authenticated browser required", "origin_rejected");
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return fail(415, "content-type must be application/json", "content_type_rejected");
  let raw;
  try { raw = await readBody(req, MAX_BODY); }
  catch (err) { return fail(err.code === "TOO_LARGE" ? 413 : 400, err.code === "TOO_LARGE" ? "body too large" : "bad body",
    err.code === "TOO_LARGE" ? "body_too_large" : "body_rejected"); }
  let body;
  try { body = JSON.parse(raw.toString("utf8")); }
  catch { return fail(400, "invalid json", "json_rejected"); }
  const error = validateBoardSettings(body);
  if (error) return fail(422, error, "validation_rejected");
  log("pending", "write_started");
  let saved;
  try { saved = boardSettings.save(body); }
  catch (err) {
    return fail(500, err.committed ? "board settings replaced but durability could not be confirmed; reload before retrying" : "board settings store failed", "store_failed");
  }
  log("success", "saved");
  return sendJson(res, 200, { ok: true, ...saved });
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

  const candidateResult = validateContract("fleet-config", body.config);
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
    const nextResult = validateContract("fleet-config", next);
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

  // The source replacement has committed. Enforce it before receipt/audit
  // failures can return, and leave the durable audit pending on failure.
  const observed = model.observeFleet(next);
  if (!observed.ok) {
    sendJson(res, 500, { ok: false, error: "fleet config stored and policy in effect but receipt save failed", currentRev: next.rev });
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
  if (urlPath === "/joe/board-settings.json") {
    sendJson(res, 200, boardSettings.read());
    return;
  }
  if (urlPath === "/joe/fleet-config.json") {
    sendFleetConfig(req, res);
    return;
  }

  if (urlPath === "/joe/fleet-config/actions.json") {
    sendFleetActions(res);
    return;
  }

  if (urlPath === "/joe/data.json") {
    const value = model.view().data;
    sendJson(res, value ? 200 : 503, value ?? { ok: false, reason: model.feeds().data.reason }, feedHeaders("data"));
    return;
  }
  if (urlPath === "/joe/history.json") {
    const feed = model.feeds().history;
    sendJson(res, feed.value ? 200 : 503, feed.value ?? { ok: false, schema: CONTRACTS.contracts.history, reason: feed.reason }, feedHeaders("history"));
    return;
  }
  if (urlPath === "/joe/account-history.json") {
    sendJson(res, 200, model.accountHistory(), feedHeaders("history"));
    return;
  }
  if (urlPath === "/joe/history-continuity.json") {
    sendJson(res, 200, model.historyContinuity(), feedHeaders("history"));
    return;
  }
  if (urlPath === "/joe/results.json") {
    const feed = model.feeds().results;
    sendJson(res, feed.value ? 200 : 503, feed.value ?? { ok: false, schema: CONTRACTS.contracts.results, reason: feed.reason }, feedHeaders("results"));
    return;
  }
  if (urlPath === "/joe/state.json") {
    // Both large feeds have separate worker reads on a 30 s cadence. Keep
    // their snapshots out of the 15 s state poll, including panel values.
    const view = model.view();
    const { value, ...history } = view.feeds.history;
    const { value: _points, ...historyPanel } = view.panels.history;
    const { value: record, ...results } = view.feeds.results;
    const { value: _record, ...resultsPanel } = view.panels.results;
    sendJson(res, 200, { ...view, panels: { ...view.panels, history: historyPanel, results: resultsPanel }, feeds: { ...view.feeds,
      results: { ...results, ...(record ? { receivedAt: record.receivedAt, seq: record.seq } : {}) }, history: { ...history,
      ...(value ? { receivedAt: value.receivedAt, pointCount: value.points.length } : {}) } } });
    return;
  }
  const contractFile = CONTRACT_FILES[urlPath];
  if (contractFile) {
    const file = path.join(__dirname, "contracts", contractFile);
    send(res, 200, fs.readFileSync(file), { "Content-Type": MIME[path.extname(file)] });
    return;
  }
  const versionedFile = VERSIONED_FILES[urlPath];
  if (versionedFile) {
    send(res, 200, fs.readFileSync(versionedFile), { "Content-Type": MIME[path.extname(versionedFile)] });
    return;
  }
  const sharedFile = SHARED_FILES[urlPath];
  if (sharedFile) {
    const file = path.join(__dirname, sharedFile);
    send(res, 200, fs.readFileSync(file), { "Content-Type": MIME[path.extname(file)] });
    return;
  }

  const name = STATIC_FILES[urlPath] ?? VENDOR_FILES[urlPath];
  if (!name) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  const file = path.join(PUBLIC, name);
  const body = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  send(res, 200, body, { "Content-Type": MIME[ext] || "application/octet-stream" });
}

// An existing accepted policy must constrain the very first ingress after a
// restart, even before any browser requests Fleet Config. A durable receipt
// also requires checking whether the established source has disappeared.
if (fs.existsSync(FLEET_CONFIG_FILE) || model.feeds()["fleet-config"].value) {
  try {
    if (!model.observeFleet(readFleetConfig()).ok) model.fleetFailure();
  } catch { model.fleetFailure(); }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const u = new URL(req.url || "/", `http://${host}`);
    const urlPath = u.pathname;

    // POST authenticates inside its handler, matching Fleet Config's 403
    // response. GET/HEAD use the protected-read 401 path below.
    if (urlPath === "/joe/board-settings.json" && !["GET", "HEAD"].includes(req.method)) {
      await handleBoardSettings(req, res);
      return;
    }

    if (urlPath === "/joe") {
      send(res, 308, "", { Location: `/joe/${u.search}` });
      return;
    }

    if (urlPath === "/healthz" || urlPath === "/readyz") {
      sendJson(res, 200, { ok: true, service: "joe-board", hasData: model.hasData() });
      return;
    }

    if (urlPath === "/joe/healthz") {
      if (!["GET", "HEAD"].includes(req.method)) return sendJson(res, 405, { ok: false, reason: "route_not_found" });
      sendJson(res, 200, healthProjection(model, release, clock()));
      return;
    }

    if (PROTECTED_READS.has(urlPath) && !fleetActor(req)) {
      sendJson(res, 401, { ok: false, reason: "auth_required" });
      return;
    }
    if (urlPath === "/joe/account-history.json" && req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method not allowed" }, { Allow: "GET" });
      return;
    }

    if (urlPath === "/joe/inbox") {
      await handleInbox(req, res);
      return;
    }
    if (urlPath === "/joe/inbox/results") {
      await handleInbox(req, res, 'results');
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
      // A surviving tab must not receive another release's bytes under its
      // cached module coordinates. Unversioned API reads are unaffected.
      if (u.searchParams.has('v') && (u.searchParams.getAll('v').length !== 1 || u.searchParams.get('v') !== release.version)) {
        sendJson(res, 404, { ok: false, reason: 'route_not_found' });
        return;
      }
      handleStatic(req, res, urlPath);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    console.error("request failed");
    sendJson(res, 500, { ok: false, reason: "refresh_failed" });
  }
});

server.readModel = model;
return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createJoeServer();
  server.listen(8080, "0.0.0.0", () => console.log("joe-board listening"));
}
