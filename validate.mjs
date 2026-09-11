/** Lightweight contract checks for inspr.joe.household.v1 (paper only). */

const DESK_IDS = ["j", "joe", "joel"];
const STATES = new Set(["working", "sit-out", "stuck"]);
const LEARNING = new Set(["learning", "iterating", "steady", "blocked"]);
const GW = new Set(["ok", "degraded", "down"]);
const SIDES = new Set(["Long", "Short", "long", "short"]);
const ACCOUNTING_METHOD = "execution-fifo-net-current-fx";
const ACCOUNTING_DETAIL_MAX = 240;
const ACCOUNTING_KEYS = new Set(["periodStart", "method", "detail"]);
const HISTORY_BASIS_MAX = 96;
const HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
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
const RFC3339_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_OFFSET_MINUTES = 14 * 60;

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export function validIsoTimestamp(iso) {
  if (typeof iso !== "string" || !iso.length) return false;
  const match = RFC3339_DATETIME.exec(iso);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[8] === "Z") return true;

  const offHour = Number(match[10]);
  const offMinute = Number(match[11]);
  if (offHour > 23 || offMinute > 59) return false;
  return offHour * 60 + offMinute <= MAX_OFFSET_MINUTES;
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
    const v = m[k];
    if (!(v === null || (typeof v === "number" && Number.isFinite(v)))) {
      errors.push(`${path}.${k} must be number or null`);
    }
  }
  for (const k of Object.keys(m)) {
    if (!["equity", "dayPnl", "totalPnl"].includes(k)) errors.push(`${path} unknown key ${k}`);
  }
}

function accountingOk(accounting, path, errors) {
  if (!isObj(accounting)) {
    errors.push(`${path} must be object`);
    return;
  }
  for (const key of Object.keys(accounting)) {
    if (!ACCOUNTING_KEYS.has(key)) errors.push(`${path} unknown key ${key}`);
  }
  if (!validIsoTimestamp(accounting.periodStart)) {
    errors.push(`${path}.periodStart invalid`);
  }
  if (accounting.method !== ACCOUNTING_METHOD) {
    errors.push(`${path}.method invalid`);
  }
  if (
    typeof accounting.detail !== "string" ||
    accounting.detail.length < 1 ||
    accounting.detail.length > ACCOUNTING_DETAIL_MAX ||
    !/^[\x20-\x7e]+$/.test(accounting.detail)
  ) {
    errors.push(`${path}.detail must be 1-${ACCOUNTING_DETAIL_MAX} printable English characters`);
  }
}

function historyBasisOk(historyBasis, path, errors) {
  if (
    typeof historyBasis !== "string" ||
    historyBasis.length < 1 ||
    historyBasis.length > HISTORY_BASIS_MAX ||
    !HISTORY_BASIS.test(historyBasis)
  ) {
    errors.push(`${path} must be a 1-${HISTORY_BASIS_MAX} character stable lowercase basis id`);
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
      if (Object.prototype.hasOwnProperty.call(d, "accounting")) {
        accountingOk(d.accounting, `${p}.accounting`, errors);
      }
      if (Object.prototype.hasOwnProperty.call(d, "historyBasis")) {
        historyBasisOk(d.historyBasis, `${p}.historyBasis`, errors);
      }
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
