/** Lightweight contract checks for inspr.joe.household.v1 (paper only). */

const DESK_IDS = ["j", "joe", "joel"];
const STATES = new Set(["working", "sit-out", "stuck"]);
const LEARNING = new Set(["learning", "iterating", "steady", "blocked"]);
const GW = new Set(["ok", "degraded", "down"]);
const BOARD_HEALTH = new Set(["green", "yellow", "red"]);
const BOARD_HEALTH_REASONS = new Map([
  ["board_ok", "green"],
  ["snapshot_stale", "yellow"],
  ["retained_values", "yellow"],
  ["gateway_degraded", "yellow"],
  ["open_unavailable_rth", "yellow"],
  ["day_pending", "yellow"],
  ["halt_on", "red"],
  ["gateway_down", "red"],
  ["equity_unavailable", "red"],
  ["producer_stuck", "red"],
  ["day_unavailable_rth", "red"],
]);
const SIDES = new Set(["Long", "Short", "long", "short"]);
const ACCOUNTING_METHOD = "execution-fifo-net-current-fx";
const ACCOUNTING_DETAIL_MAX = 240;
const ACCOUNTING_KEYS = new Set(["periodStart", "method", "detail"]);
const MONEY_EVIDENCE_KEYS = new Set(["status", "observedAt"]);
const MONEY_EVIDENCE_STATUSES = new Set(["observed", "carried"]);
const HISTORY_BASIS_MAX = 96;
const HISTORY_BASIS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const BROKER_ACCOUNT_KEYS = new Set(["equity", "currency", "observedAt", "scope", "status"]);
const PNL_SOURCE_GROUP_KEYS = new Set(["day", "open"]);
const DAY_PNL_SOURCE_KEYS = new Set(["status", "method", "currency", "scope", "observedAt", "periodStart", "detail"]);
const OPEN_PNL_SOURCE_KEYS = new Set(["status", "method", "currency", "scope", "observedAt", "detail"]);
const DAY_PNL_METHODS = new Set(["ib-daily-pnl", "sod-virtual-equity", null]);
const OPEN_PNL_METHODS = new Set(["ib-unrealized-pnl", "owned-lots-current-mark-fx", null]);
const BACKFILL_KEYS = new Set([
  "status",
  "fullTotalAvailable",
  "capturedSubtotal",
  "coverage",
  "missingOpeningLotCount",
  "orphanCommissionCount",
]);
const BACKFILL_CAPTURE_KEYS = new Set([
  "realizedPnl",
  "currency",
  "method",
  "executionCount",
  "commissionCount",
  "fromInclusive",
  "throughInclusive",
  "points",
  "pointsTruncated",
]);
const BACKFILL_CAPTURE_REQUIRED_KEYS = new Set([
  "realizedPnl",
  "currency",
  "executionCount",
  "commissionCount",
  "fromInclusive",
  "throughInclusive",
]);
const BACKFILL_POINT_KEYS = new Set(["at", "realizedPnl"]);
const BACKFILL_COVERAGE_KEYS = new Set([
  "target",
  "completeIntervalCount",
  "knownIntervalCount",
  "gapCount",
  "firstGap",
]);
const INTERVAL_KEYS = new Set(["fromInclusive", "toExclusive"]);
const MAX_BACKFILL_COUNT = 1_000_000;
const MAX_BACKFILL_POINTS = 2_048;
const BACKFILL_ENDPOINT_TOLERANCE = 0.000001;
const CAPTURED_FIFO_METHOD = "captured-fifo-matched-roundtrips";
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
  if (Object.prototype.hasOwnProperty.call(m, "openPnl")) {
    finiteOrNull(m.openPnl, `${path}.openPnl`, errors);
  }
  for (const k of Object.keys(m)) {
    if (!["equity", "dayPnl", "totalPnl", "openPnl"].includes(k)) errors.push(`${path} unknown key ${k}`);
  }
}

function moneyEvidenceOk(evidence, path, errors) {
  if (!exactKeys(evidence, MONEY_EVIDENCE_KEYS, path, errors)) return;
  if (!MONEY_EVIDENCE_STATUSES.has(evidence.status)) errors.push(`${path}.status invalid`);
  if (!validIsoTimestamp(evidence.observedAt)) errors.push(`${path}.observedAt invalid`);
}

function brokerAccountOk(account, path, errors) {
  if (!isObj(account)) {
    errors.push(`${path} must be object`);
    return;
  }
  for (const key of Object.keys(account)) {
    if (!BROKER_ACCOUNT_KEYS.has(key)) errors.push(`${path} unknown key ${key}`);
  }
  for (const key of BROKER_ACCOUNT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(account, key)) errors.push(`${path}.${key} required`);
  }
  finiteOrNull(account.equity, `${path}.equity`, errors);
  if (account.currency !== "EUR") errors.push(`${path}.currency must be EUR`);
  if (!validIsoTimestamp(account.observedAt)) errors.push(`${path}.observedAt invalid`);
  if (account.scope !== "paper-account-including-keep") errors.push(`${path}.scope invalid`);
  if (account.status !== "available" && account.status !== "unavailable") {
    errors.push(`${path}.status invalid`);
  }
  if (account.status === "available" && !Number.isFinite(account.equity)) {
    errors.push(`${path}.equity must be finite when available`);
  }
}

function pnlSourceOk(source, kind, path, errors) {
  const keys = kind === "day" ? DAY_PNL_SOURCE_KEYS : OPEN_PNL_SOURCE_KEYS;
  if (!exactKeys(source, keys, path, errors)) return;
  if (source.status !== "available" && source.status !== "unavailable") {
    errors.push(`${path}.status invalid`);
  }
  if (kind === "day") {
    if (!DAY_PNL_METHODS.has(source.method)) errors.push(`${path}.method invalid`);
    if (!(source.periodStart === null || validIsoTimestamp(source.periodStart))) {
      errors.push(`${path}.periodStart invalid`);
    }
    if (source.method === "sod-virtual-equity" && !validIsoTimestamp(source.periodStart)) {
      errors.push(`${path}.periodStart required for SOD method`);
    }
  } else if (!OPEN_PNL_METHODS.has(source.method)) {
    errors.push(`${path}.method invalid`);
  }
  if (source.currency !== "EUR") errors.push(`${path}.currency must be EUR`);
  if (source.scope !== "virtual-desks") errors.push(`${path}.scope invalid`);
  if (!(source.observedAt === null || validIsoTimestamp(source.observedAt))) {
    errors.push(`${path}.observedAt invalid`);
  }
  if (source.status === "available") {
    if (source.method === null) errors.push(`${path}.method required when available`);
    if (!validIsoTimestamp(source.observedAt)) errors.push(`${path}.observedAt required when available`);
  }
  if (typeof source.detail !== "string" || source.detail.length < 1 || source.detail.length > 160 || !/^[ -~]+$/.test(source.detail)) {
    errors.push(`${path}.detail must be 1-160 printable English characters`);
  }
}

function pnlSourcesOk(sources, path, errors) {
  if (!exactKeys(sources, PNL_SOURCE_GROUP_KEYS, path, errors, new Set())) return;
  if (Object.prototype.hasOwnProperty.call(sources, "day")) pnlSourceOk(sources.day, "day", `${path}.day`, errors);
  if (Object.prototype.hasOwnProperty.call(sources, "open")) pnlSourceOk(sources.open, "open", `${path}.open`, errors);
}

function pnlEvidenceValuesOk(raw, errors) {
  if (!Array.isArray(raw.desks) || !isObj(raw.totals)) return;
  const positions = [
    ...(Array.isArray(raw.positions) ? raw.positions : []),
    ...raw.desks.flatMap((desk) => Array.isArray(desk?.positions) ? desk.positions : []),
  ];
  for (const [kind, field] of [["day", "dayPnl"], ["open", "openPnl"]]) {
    const source = isObj(raw.pnlSources) ? raw.pnlSources[kind] : null;
    if ((!isObj(source) || source.status !== "available") &&
        positions.some((position) => Number.isFinite(position?.[field]))) {
      errors.push(`position ${field} requires available pnlSources.${kind}`);
    }
    if (!isObj(source)) continue;
    const values = raw.desks.map((desk) => desk?.money?.[field]);
    const total = raw.totals[field];
    if (source.status === "available") {
      if (!values.every(Number.isFinite) || !Number.isFinite(total)) {
        errors.push(`pnlSources.${kind} available requires finite ${field} for every desk and totals`);
      }
    } else if (source.status === "unavailable") {
      if (!values.every((value) => value === null) || total !== null) {
        errors.push(`pnlSources.${kind} unavailable requires null ${field} for every desk and totals`);
      }
    }
  }
}

function exactKeys(value, keys, path, errors, requiredKeys = keys) {
  if (!isObj(value)) {
    errors.push(`${path} must be object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${path} unknown key ${key}`);
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} required`);
  }
  return true;
}

function backfillPointsOk(captured, path, errors) {
  const hasPoints = Object.prototype.hasOwnProperty.call(captured, "points");
  const hasTruncated = Object.prototype.hasOwnProperty.call(captured, "pointsTruncated");
  if (!hasPoints && !hasTruncated) return;
  if (!hasPoints || !hasTruncated) {
    errors.push(`${path}.points and ${path}.pointsTruncated must appear together`);
    return;
  }
  if (!Array.isArray(captured.points) || captured.points.length > MAX_BACKFILL_POINTS) {
    errors.push(`${path}.points must contain at most ${MAX_BACKFILL_POINTS} items`);
    return;
  }
  if (typeof captured.pointsTruncated !== "boolean") {
    errors.push(`${path}.pointsTruncated must be boolean`);
  }

  const from = Date.parse(captured.fromInclusive);
  const through = Date.parse(captured.throughInclusive);
  let previous = null;
  captured.points.forEach((point, index) => {
    const pointPath = `${path}.points[${index}]`;
    if (!exactKeys(point, BACKFILL_POINT_KEYS, pointPath, errors)) return;
    const atOk = validIsoTimestamp(point.at);
    if (!atOk) errors.push(`${pointPath}.at invalid`);
    if (!Number.isFinite(point.realizedPnl)) errors.push(`${pointPath}.realizedPnl must be finite`);
    if (!atOk) return;
    const at = Date.parse(point.at);
    if (Number.isFinite(from) && Number.isFinite(through) && (at < from || at > through)) {
      errors.push(`${pointPath}.at outside captured interval`);
    }
    if (previous !== null && at <= previous) {
      errors.push(`${path}.points timestamps must be strictly increasing`);
    }
    previous = at;
  });

  if (captured.points.length === 0) {
    if (captured.realizedPnl !== null) errors.push(`${path}.points cannot be empty with a finite subtotal`);
    if (captured.pointsTruncated === true) errors.push(`${path}.pointsTruncated cannot be true for an empty series`);
    return;
  }
  const endpoint = captured.points[captured.points.length - 1]?.realizedPnl;
  if (!Number.isFinite(captured.realizedPnl) ||
      !Number.isFinite(endpoint) ||
      Math.abs(endpoint - captured.realizedPnl) > BACKFILL_ENDPOINT_TOLERANCE) {
    errors.push(`${path}.points endpoint must match realizedPnl`);
  }
}

function boundedCountOk(value, path, errors) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BACKFILL_COUNT) {
    errors.push(`${path} must be an integer from 0 to ${MAX_BACKFILL_COUNT}`);
    return false;
  }
  return true;
}

function intervalOk(interval, path, errors) {
  if (!exactKeys(interval, INTERVAL_KEYS, path, errors)) return false;
  const fromOk = validIsoTimestamp(interval.fromInclusive);
  const toOk = validIsoTimestamp(interval.toExclusive);
  if (!fromOk) errors.push(`${path}.fromInclusive invalid`);
  if (!toOk) errors.push(`${path}.toExclusive invalid`);
  if (fromOk && toOk && Date.parse(interval.fromInclusive) >= Date.parse(interval.toExclusive)) {
    errors.push(`${path} must have positive duration`);
  }
  return fromOk && toOk;
}

function backfillOk(backfill, path, errors) {
  if (!exactKeys(backfill, BACKFILL_KEYS, path, errors)) return;
  if (backfill.status !== "BEST_AVAILABLE" && backfill.status !== "COMPLETE") {
    errors.push(`${path}.status invalid`);
  }
  if (typeof backfill.fullTotalAvailable !== "boolean") {
    errors.push(`${path}.fullTotalAvailable must be boolean`);
  }
  boundedCountOk(backfill.missingOpeningLotCount, `${path}.missingOpeningLotCount`, errors);
  boundedCountOk(backfill.orphanCommissionCount, `${path}.orphanCommissionCount`, errors);

  const capturedPath = `${path}.capturedSubtotal`;
  if (exactKeys(
    backfill.capturedSubtotal,
    BACKFILL_CAPTURE_KEYS,
    capturedPath,
    errors,
    BACKFILL_CAPTURE_REQUIRED_KEYS,
  )) {
    finiteOrNull(backfill.capturedSubtotal.realizedPnl, `${capturedPath}.realizedPnl`, errors);
    if (!["USD", "EUR", null].includes(backfill.capturedSubtotal.currency)) {
      errors.push(`${capturedPath}.currency invalid`);
    }
    if (Number.isFinite(backfill.capturedSubtotal.realizedPnl) && backfill.capturedSubtotal.currency === null) {
      errors.push(`${capturedPath}.currency required for finite subtotal`);
    }
    if (Object.prototype.hasOwnProperty.call(backfill.capturedSubtotal, "method") &&
        ![CAPTURED_FIFO_METHOD, null].includes(backfill.capturedSubtotal.method)) {
      errors.push(`${capturedPath}.method invalid`);
    }
    if (backfill.capturedSubtotal.realizedPnl === null &&
        backfill.capturedSubtotal.method === CAPTURED_FIFO_METHOD) {
      errors.push(`${capturedPath}.method must be null when subtotal is unavailable`);
    }
    boundedCountOk(backfill.capturedSubtotal.executionCount, `${capturedPath}.executionCount`, errors);
    boundedCountOk(backfill.capturedSubtotal.commissionCount, `${capturedPath}.commissionCount`, errors);
    const fromOk = validIsoTimestamp(backfill.capturedSubtotal.fromInclusive);
    const throughOk = validIsoTimestamp(backfill.capturedSubtotal.throughInclusive);
    if (!fromOk) errors.push(`${capturedPath}.fromInclusive invalid`);
    if (!throughOk) errors.push(`${capturedPath}.throughInclusive invalid`);
    if (fromOk && throughOk &&
        Date.parse(backfill.capturedSubtotal.fromInclusive) > Date.parse(backfill.capturedSubtotal.throughInclusive)) {
      errors.push(`${capturedPath} interval invalid`);
    }
    backfillPointsOk(backfill.capturedSubtotal, capturedPath, errors);
  }

  const coveragePath = `${path}.coverage`;
  if (exactKeys(backfill.coverage, BACKFILL_COVERAGE_KEYS, coveragePath, errors)) {
    intervalOk(backfill.coverage.target, `${coveragePath}.target`, errors);
    boundedCountOk(backfill.coverage.completeIntervalCount, `${coveragePath}.completeIntervalCount`, errors);
    boundedCountOk(backfill.coverage.knownIntervalCount, `${coveragePath}.knownIntervalCount`, errors);
    boundedCountOk(backfill.coverage.gapCount, `${coveragePath}.gapCount`, errors);
    if (backfill.coverage.firstGap === null) {
      if (backfill.coverage.gapCount !== 0) errors.push(`${coveragePath}.firstGap required when gaps exist`);
    } else {
      intervalOk(backfill.coverage.firstGap, `${coveragePath}.firstGap`, errors);
      if (backfill.coverage.gapCount === 0) errors.push(`${coveragePath}.firstGap must be null without gaps`);
    }
  }

  if (backfill.fullTotalAvailable &&
      (backfill.status !== "COMPLETE" || backfill.coverage?.gapCount !== 0 ||
       backfill.missingOpeningLotCount !== 0 || backfill.orphanCommissionCount !== 0)) {
    errors.push(`${path}.fullTotalAvailable conflicts with incomplete coverage`);
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

  const hasBoardHealth = Object.prototype.hasOwnProperty.call(raw, "boardHealth");
  const hasShortReason = Object.prototype.hasOwnProperty.call(raw, "shortReason");
  if (hasBoardHealth !== hasShortReason) {
    errors.push("boardHealth and shortReason must appear together");
  } else if (hasBoardHealth) {
    if (!BOARD_HEALTH.has(raw.boardHealth)) errors.push("boardHealth invalid");
    if (!BOARD_HEALTH_REASONS.has(raw.shortReason)) errors.push("shortReason invalid");
    else if (BOARD_HEALTH_REASONS.get(raw.shortReason) !== raw.boardHealth) {
      errors.push("shortReason does not match boardHealth");
    }
  }

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
  if (Object.prototype.hasOwnProperty.call(raw, "brokerAccount")) {
    brokerAccountOk(raw.brokerAccount, "brokerAccount", errors);
  }
  if (Object.prototype.hasOwnProperty.call(raw, "pnlSources")) {
    pnlSourcesOk(raw.pnlSources, "pnlSources", errors);
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
      if (Object.prototype.hasOwnProperty.call(d, "moneyEvidence")) {
        moneyEvidenceOk(d.moneyEvidence, `${p}.moneyEvidence`, errors);
      }
      if (Object.prototype.hasOwnProperty.call(d, "accounting")) {
        accountingOk(d.accounting, `${p}.accounting`, errors);
      }
      if (Object.prototype.hasOwnProperty.call(d, "historyBasis")) {
        historyBasisOk(d.historyBasis, `${p}.historyBasis`, errors);
      }
      if (Object.prototype.hasOwnProperty.call(d, "backfill")) {
        if (d.id !== "j") errors.push(`${p}.backfill is only valid for desk j`);
        backfillOk(d.backfill, `${p}.backfill`, errors);
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
  pnlEvidenceValuesOk(raw, errors);

  // Soft consistency: when all money fields are numbers, totals should match sums.
  if (Array.isArray(raw.desks) && raw.desks.length === 3 && isObj(raw.totals)) {
    for (const field of ["equity", "dayPnl", "totalPnl", "openPnl"]) {
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
