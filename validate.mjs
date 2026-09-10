/** Lightweight contract checks for inspr.joe.household.v1 (paper only). */

const DESK_IDS = ["j", "joe", "joel"];
const STATES = new Set(["working", "sit-out", "stuck"]);
const LEARNING = new Set(["learning", "iterating", "steady", "blocked"]);
const GW = new Set(["ok", "degraded", "down"]);
const SIDES = new Set(["Long", "Short", "long", "short"]);
const POSITION_KEYS = new Set([
  "desk",
  "symbol",
  "side",
  "quantity",
  "mark",
  "marketValue",
  "dayPnl",
  "openPnl",
  "updatedAt",
  "currency",
  "accountingScope",
]);
const MONEY_KEYS = new Set(["equity", "dayPnl", "totalPnl", "openPnl"]);

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function validIsoTimestamp(iso) {
  return typeof iso === "string" && iso.length > 0 && !Number.isNaN(Date.parse(iso));
}

function finiteOrNull(v, path, errors) {
  if (!(v === null || (typeof v === "number" && Number.isFinite(v)))) {
    errors.push(`${path} must be number or null`);
  }
}

function moneyOk(m, path, errors) {
  if (!isObj(m)) {
    errors.push(`${path} must be object`);
    return;
  }
  for (const k of ["equity", "dayPnl", "totalPnl"]) {
    finiteOrNull(m[k], `${path}.${k}`, errors);
  }
  if (Object.prototype.hasOwnProperty.call(m, "openPnl")) {
    finiteOrNull(m.openPnl, `${path}.openPnl`, errors);
  }
  for (const k of Object.keys(m)) {
    if (!MONEY_KEYS.has(k)) errors.push(`${path} unknown key ${k}`);
  }
}

function positionOk(position, path, expectedDesk, errors) {
  if (!isObj(position)) {
    errors.push(`${path} must be object`);
    return;
  }
  for (const k of Object.keys(position)) {
    if (!POSITION_KEYS.has(k)) errors.push(`${path} unknown key ${k}`);
  }
  if (typeof position.symbol !== "string" || !position.symbol) {
    errors.push(`${path}.symbol required`);
  }
  if (typeof position.desk !== "string" || !DESK_IDS.includes(position.desk)) {
    errors.push(`${path}.desk invalid`);
  } else if (expectedDesk !== null && position.desk !== expectedDesk) {
    errors.push(`${path}.desk must match ${expectedDesk}`);
  }
  if (Object.prototype.hasOwnProperty.call(position, "side") && !SIDES.has(position.side)) {
    errors.push(`${path}.side invalid`);
  }
  for (const k of ["quantity", "mark", "marketValue", "dayPnl", "openPnl"]) {
    if (Object.prototype.hasOwnProperty.call(position, k)) {
      finiteOrNull(position[k], `${path}.${k}`, errors);
    }
  }
  if (Object.prototype.hasOwnProperty.call(position, "updatedAt")) {
    const v = position.updatedAt;
    if (!(v === null || validIsoTimestamp(v))) {
      errors.push(`${path}.updatedAt invalid`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(position, "currency")) {
    if (typeof position.currency !== "string" || !/^[A-Z]{3}$/.test(position.currency)) {
      errors.push(`${path}.currency must be uppercase three-letter code`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(position, "accountingScope")) {
    if (position.accountingScope !== "stage0" && position.accountingScope !== "legacy") {
      errors.push(`${path}.accountingScope invalid`);
    }
  }
}

function positionsArrayOk(arr, path, expectedDesk, errors) {
  if (!Array.isArray(arr)) {
    errors.push(`${path} must be array`);
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    positionOk(arr[i], `${path}[${i}]`, expectedDesk, errors);
  }
}

export function validateHouseholdSnapshot(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ["body must be a JSON object"] };

  if (raw.schema !== "inspr.joe.household.v1") errors.push("schema must be inspr.joe.household.v1");
  if (raw.mode !== "PAPER") errors.push("mode must be PAPER");
  if (raw.currency !== "EUR") errors.push("currency must be EUR");
  if (typeof raw.generatedAt !== "string" || !raw.generatedAt) errors.push("generatedAt required");

  if (!isObj(raw.source) || typeof raw.source.label !== "string" || !raw.source.label) {
    errors.push("source.label required");
  }

  if (!isObj(raw.safety)) {
    errors.push("safety required");
  } else {
    if (typeof raw.safety.halt !== "boolean") errors.push("safety.halt boolean");
    if (!(raw.safety.haltReason === null || typeof raw.safety.haltReason === "string")) {
      errors.push("safety.haltReason string|null");
    }
    if (!Number.isInteger(raw.safety.staleAfterSeconds) || raw.safety.staleAfterSeconds < 1) {
      errors.push("safety.staleAfterSeconds >= 1");
    }
    const gw = raw.safety.gateway;
    if (!isObj(gw) || !GW.has(gw.status)) errors.push("safety.gateway.status invalid");
  }

  if (Object.prototype.hasOwnProperty.call(raw, "positions")) {
    positionsArrayOk(raw.positions, "positions", null, errors);
  }

  if (!Array.isArray(raw.desks) || raw.desks.length !== 3) {
    errors.push("desks must have length 3");
  } else {
    const seen = new Set();
    for (let i = 0; i < raw.desks.length; i++) {
      const d = raw.desks[i];
      const p = `desks[${i}]`;
      if (!isObj(d)) {
        errors.push(`${p} must be object`);
        continue;
      }
      if (!DESK_IDS.includes(d.id)) errors.push(`${p}.id invalid`);
      if (seen.has(d.id)) errors.push(`${p}.id duplicate`);
      seen.add(d.id);
      if (typeof d.label !== "string" || !d.label) errors.push(`${p}.label`);
      if (!STATES.has(d.state)) errors.push(`${p}.state`);
      if (!(d.stateSince === null || typeof d.stateSince === "string")) errors.push(`${p}.stateSince`);
      if (typeof d.action !== "string" || !d.action) errors.push(`${p}.action`);
      if (!isObj(d.learning) || !LEARNING.has(d.learning.status)) errors.push(`${p}.learning`);
      moneyOk(d.money, `${p}.money`, errors);
      if (!Array.isArray(d.issues)) errors.push(`${p}.issues array`);
      if (Object.prototype.hasOwnProperty.call(d, "positions")) {
        positionsArrayOk(d.positions, `${p}.positions`, d.id, errors);
      }
    }
    for (const id of DESK_IDS) {
      if (!seen.has(id)) errors.push(`missing desk ${id}`);
    }
  }

  moneyOk(raw.totals, "totals", errors);

  // Soft consistency: when all money fields are numbers, totals should match sums.
  if (Array.isArray(raw.desks) && raw.desks.length === 3 && isObj(raw.totals)) {
    for (const field of ["equity", "dayPnl", "totalPnl"]) {
      const parts = raw.desks.map((d) => d?.money?.[field]);
      if (parts.every((v) => typeof v === "number") && typeof raw.totals[field] === "number") {
        const sum = parts.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - raw.totals[field]) >= 0.01) {
          errors.push(`totals.${field} must equal sum of desk money.${field}`);
        }
      }
    }
  }

  // Reject obvious secret-ish keys anywhere at top level
  for (const k of Object.keys(raw)) {
    if (/password|passwd|secret|token|credential|api[_-]?key/i.test(k)) {
      errors.push(`forbidden key ${k}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
