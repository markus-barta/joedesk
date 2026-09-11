const SCHEMA_ID = "inspr.joe.fleet-config.v1";
const REVISION = /^fc-([0-9]{6})$/;
const ROUTINE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SECRET_REF = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const ISO_INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, keys, at, errors) {
  if (!object(value)) {
    errors.push(`${at} must be an object`);
    return false;
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${at}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push(`${at}.${key} is not allowed`);
  }
  return true;
}

function integer(value, min, max, at, errors) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${at} must be an integer from ${min} to ${max}`);
  }
}

function text(value, pattern, max, at, errors) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !pattern.test(value)) {
    errors.push(`${at} is invalid`);
  }
}

function uniqueStrings(value, pattern, maxItems, maxLength, at, errors, allowed) {
  if (!Array.isArray(value) || value.length > maxItems) {
    errors.push(`${at} must be an array with at most ${maxItems} entries`);
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > maxLength || !pattern.test(entry) || (allowed && !allowed.has(entry))) {
      errors.push(`${at}[${index}] is invalid`);
    }
    if (seen.has(entry)) errors.push(`${at}[${index}] is duplicated`);
    seen.add(entry);
  });
}

function validateReserve(value, at, errors) {
  if (!exactObject(value, ["reservePct"], at, errors)) return;
  integer(value.reservePct, 0, 100, `${at}.reservePct`, errors);
}

function validateWakeWindow(value, index, errors) {
  const at = `fleetConfig.cadence.wakeWindows[${index}]`;
  if (!exactObject(value, ["id", "days", "from", "until", "desks"], at, errors)) return;
  text(value.id, ROUTINE_ID, 64, `${at}.id`, errors);
  if (Array.isArray(value.days) && value.days.length < 1) errors.push(`${at}.days must not be empty`);
  uniqueStrings(value.days, /^[a-z]{3}$/, 7, 3, `${at}.days`, errors, DAYS);
  text(value.from, HHMM, 5, `${at}.from`, errors);
  text(value.until, HHMM, 5, `${at}.until`, errors);
  if (!Array.isArray(value.desks) || value.desks.length < 1) errors.push(`${at}.desks must not be empty`);
  else uniqueStrings(value.desks, ROUTINE_ID, 32, 64, `${at}.desks`, errors);
}

export function validateFleetConfig(config) {
  const errors = [];
  const topKeys = ["$schema", "schema", "rev", "updatedAt", "mode", "quota", "desks", "cadence", "amy", "mac", "tools", "secretSlots"];
  if (!exactObject(config, topKeys, "fleetConfig", errors)) return { ok: false, errors };

  if (config.$schema !== "/joe/fleet-config.schema.json") errors.push("fleetConfig.$schema is invalid");
  if (config.schema !== SCHEMA_ID) errors.push("fleetConfig.schema is invalid");
  if (typeof config.rev !== "string" || !REVISION.test(config.rev)) errors.push("fleetConfig.rev is invalid");
  if (typeof config.updatedAt !== "string" || !ISO_INSTANT.test(config.updatedAt) || !Number.isFinite(Date.parse(config.updatedAt)) || new Date(config.updatedAt).toISOString() !== config.updatedAt) errors.push("fleetConfig.updatedAt is invalid");
  if (config.mode !== "paper") errors.push("fleetConfig.mode must remain paper");

  if (exactObject(config.quota, ["grok", "codex", "behavior"], "fleetConfig.quota", errors)) {
    validateReserve(config.quota.grok, "fleetConfig.quota.grok", errors);
    validateReserve(config.quota.codex, "fleetConfig.quota.codex", errors);
    if (exactObject(config.quota.behavior, ["green", "amber", "red"], "fleetConfig.quota.behavior", errors)) {
      if (config.quota.behavior.green !== "run_normally") errors.push("fleetConfig.quota.behavior.green is invalid");
      if (!["slow_nonessential", "park_nonessential"].includes(config.quota.behavior.amber)) errors.push("fleetConfig.quota.behavior.amber is invalid");
      if (config.quota.behavior.red !== "park_nonessential") errors.push("fleetConfig.quota.behavior.red is invalid");
    }
  }

  if (exactObject(config.desks, ["maxBusyDesks", "stage0", "keep"], "fleetConfig.desks", errors)) {
    integer(config.desks.maxBusyDesks, 1, 32, "fleetConfig.desks.maxBusyDesks", errors);
    if (exactObject(config.desks.stage0, ["capEur"], "fleetConfig.desks.stage0", errors)) {
      const cap = config.desks.stage0.capEur;
      if (typeof cap !== "number" || !Number.isFinite(cap) || cap < 0 || cap > 1000000) errors.push("fleetConfig.desks.stage0.capEur is invalid");
    }
    uniqueStrings(config.desks.keep, SYMBOL, 64, 16, "fleetConfig.desks.keep", errors);
  }

  if (exactObject(config.cadence, ["timeZone", "usOpenArm", "deskWatch", "darwin", "quotaGovernor", "wakeWindows"], "fleetConfig.cadence", errors)) {
    if (config.cadence.timeZone !== "Europe/Vienna") errors.push("fleetConfig.cadence.timeZone is invalid");
    text(config.cadence.usOpenArm, HHMM, 5, "fleetConfig.cadence.usOpenArm", errors);
    for (const key of ["deskWatch", "darwin", "quotaGovernor"]) text(config.cadence[key], ROUTINE_ID, 64, `fleetConfig.cadence.${key}`, errors);
    if (!Array.isArray(config.cadence.wakeWindows) || config.cadence.wakeWindows.length > 32) errors.push("fleetConfig.cadence.wakeWindows is invalid");
    else config.cadence.wakeWindows.forEach((window, index) => validateWakeWindow(window, index, errors));
  }

  if (exactObject(config.amy, ["routines"], "fleetConfig.amy", errors) && exactObject(config.amy.routines, ["morning", "review", "close"], "fleetConfig.amy.routines", errors)) {
    for (const key of ["morning", "review", "close"]) text(config.amy.routines[key], /^[\x20-\x7e]+$/, 80, `fleetConfig.amy.routines.${key}`, errors);
  }

  if (exactObject(config.mac, ["shared", "knobs"], "fleetConfig.mac", errors)) {
    if (exactObject(config.mac.shared, ["configPath", "docsPath"], "fleetConfig.mac.shared", errors)) {
      for (const key of ["configPath", "docsPath"]) text(config.mac.shared[key], /^(?:~\/|\/)[\x20-\x7e]+$/, 160, `fleetConfig.mac.shared.${key}`, errors);
    }
    if (exactObject(config.mac.knobs, ["syncMode"], "fleetConfig.mac.knobs", errors) && config.mac.knobs.syncMode !== "read_on_revision") {
      errors.push("fleetConfig.mac.knobs.syncMode is invalid");
    }
  }

  if (exactObject(config.tools, ["statusSource", "entries"], "fleetConfig.tools", errors)) {
    if (config.tools.statusSource !== "/joe/data.json") errors.push("fleetConfig.tools.statusSource is invalid");
    if (!Array.isArray(config.tools.entries) || config.tools.entries.length < 1 || config.tools.entries.length > 32) errors.push("fleetConfig.tools.entries is invalid");
    else {
      const toolEntries = new Set();
      config.tools.entries.forEach((entry, index) => {
        const at = `fleetConfig.tools.entries[${index}]`;
        if (!exactObject(entry, ["id", "label"], at, errors)) return;
        text(entry.id, ROUTINE_ID, 64, `${at}.id`, errors);
        text(entry.label, /^[\x20-\x7e]+$/, 80, `${at}.label`, errors);
        const serialized = JSON.stringify(entry);
        if (toolEntries.has(serialized)) errors.push(`${at} is duplicated`);
        toolEntries.add(serialized);
      });
    }
  }

  if (exactObject(config.secretSlots, ["agenix", "janus"], "fleetConfig.secretSlots", errors)) {
    uniqueStrings(config.secretSlots.agenix, SECRET_REF, 32, 96, "fleetConfig.secretSlots.agenix", errors);
    uniqueStrings(config.secretSlots.janus, SECRET_REF, 32, 96, "fleetConfig.secretSlots.janus", errors);
  }

  return { ok: errors.length === 0, errors };
}

export function nextFleetRevision(rev) {
  const match = typeof rev === "string" ? REVISION.exec(rev) : null;
  if (!match) throw new Error("invalid fleet revision");
  const sequence = Number(match[1]) + 1;
  if (!Number.isSafeInteger(sequence) || sequence > 999999) throw new Error("fleet revision exhausted");
  return `fc-${String(sequence).padStart(6, "0")}`;
}

export function withNextFleetRevision(candidate, currentRev, now = new Date()) {
  const next = structuredClone(candidate);
  next.rev = nextFleetRevision(currentRev);
  next.updatedAt = now.toISOString();
  return next;
}

export const FLEET_CONFIG_SCHEMA = SCHEMA_ID;
