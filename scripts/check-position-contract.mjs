#!/usr/bin/env node
/** Focused HOSTD-32 position contract checks (synthetic fixtures only). */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateHouseholdSnapshot, validIsoTimestamp } from "../validate.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const sample = JSON.parse(
  await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"),
);

function assertOk(snapshot, label) {
  const { ok, errors } = validateHouseholdSnapshot(snapshot);
  if (!ok) {
    throw new Error(`${label}: expected acceptance, got ${JSON.stringify(errors)}`);
  }
}

function assertFail(snapshot, pattern, label) {
  const { ok, errors } = validateHouseholdSnapshot(snapshot);
  if (ok) {
    throw new Error(`${label}: expected rejection`);
  }
  const joined = errors.join("\n");
  if (pattern && !pattern.test(joined)) {
    throw new Error(`${label}: expected ${pattern}, got ${JSON.stringify(errors)}`);
  }
}

function coverageStates(snapshot) {
  const top = Object.prototype.hasOwnProperty.call(snapshot, "positions")
    ? Array.isArray(snapshot.positions)
      ? snapshot.positions.length ? "present" : "empty"
      : "invalid"
    : "absent";
  const desks = Object.fromEntries(
    snapshot.desks.map((desk) => [
      desk.id,
      Object.prototype.hasOwnProperty.call(desk, "positions")
        ? Array.isArray(desk.positions)
          ? desk.positions.length ? "present" : "empty"
          : "invalid"
        : "absent",
    ]),
  );
  return { top, desks };
}

function assertTimestamp(value, expected, label) {
  if (validIsoTimestamp(value) !== expected) {
    throw new Error(`${label}: validIsoTimestamp(${JSON.stringify(value)}) expected ${expected}`);
  }
}

function positionWithUpdatedAt(updatedAt) {
  const snapshot = structuredClone(sample);
  snapshot.positions = [{ desk: "j", symbol: "TS", updatedAt }];
  return snapshot;
}

assertTimestamp("1", false, "numeric string");
assertTimestamp("2026-09-10", false, "bare date without time or offset");
assertTimestamp("2026-02-30T12:00:00Z", false, "impossible calendar date");
assertTimestamp("2026-09-10T25:00:00Z", false, "impossible clock time");
assertTimestamp("2026-09-10T12:00:00+25:00", false, "impossible offset hour");
assertTimestamp("2026-09-10T12:00:00+14:01", false, "offset beyond RFC3339 bounds");
assertTimestamp("2026-09-08T08:00:00.123Z", true, "fractional seconds with UTC");
assertTimestamp("2026-09-08T08:00:00+02:00", true, "numeric offset");
assertTimestamp(sample.generatedAt, true, "sample offset timestamp");

assertOk(positionWithUpdatedAt(null), "position updatedAt null accepted");
assertFail(positionWithUpdatedAt("1"), /updatedAt invalid/, "position updatedAt 1 rejected");
assertFail(
  positionWithUpdatedAt("2026-09-10"),
  /updatedAt invalid/,
  "position updatedAt bare date rejected",
);
assertFail(
  positionWithUpdatedAt("2026-02-30T12:00:00Z"),
  /updatedAt invalid/,
  "position updatedAt impossible calendar date rejected",
);
assertFail(
  positionWithUpdatedAt("2026-09-10T12:00:00+25:00"),
  /updatedAt invalid/,
  "position updatedAt impossible offset rejected",
);
assertOk(
  positionWithUpdatedAt("2026-09-08T08:00:00.500Z"),
  "position updatedAt fractional UTC accepted",
);

const openPnlTotals = structuredClone(sample);
delete openPnlTotals.pnlSources;
openPnlTotals.totals.openPnl = 12.5;
openPnlTotals.desks[0].money.openPnl = 0;
openPnlTotals.desks[1].money.openPnl = null;
assertOk(openPnlTotals, "optional finite-or-null money.openPnl accepted on desks and totals");

const invalidDeskOpenPnl = structuredClone(openPnlTotals);
invalidDeskOpenPnl.desks[0].money.openPnl = Number.NaN;
assertFail(invalidDeskOpenPnl, /desks\[0\]\.money\.openPnl must be number or null/, "non-finite desk money.openPnl rejected");

const invalidTotalsOpenPnl = structuredClone(openPnlTotals);
invalidTotalsOpenPnl.totals.openPnl = "12.5";
assertFail(invalidTotalsOpenPnl, /totals\.openPnl must be number or null/, "string totals.openPnl rejected");

const unknownMoneyKey = structuredClone(openPnlTotals);
unknownMoneyKey.desks[0].money.accountValue = 1;
assertFail(unknownMoneyKey, /money unknown key accountValue/, "unknown money keys remain rejected");

assertOk(structuredClone(sample), "snapshot with scoped broker account observation");

const olderPnlPayload = structuredClone(sample);
delete olderPnlPayload.pnlSources;
assertOk(olderPnlPayload, "older snapshot without P&L source evidence");

for (const [path, mutate, pattern] of [
  ["day currency", (snapshot) => { snapshot.pnlSources.day.currency = "USD"; }, /pnlSources\.day\.currency must be EUR/],
  ["day method", (snapshot) => { snapshot.pnlSources.day.method = "calculated-somehow"; }, /pnlSources\.day\.method invalid/],
  ["SOD period", (snapshot) => { snapshot.pnlSources.day.periodStart = null; }, /periodStart required for SOD method/],
  ["open method", (snapshot) => { snapshot.pnlSources.open.method = "portfolio-guess"; }, /pnlSources\.open\.method invalid/],
  ["open observedAt", (snapshot) => { snapshot.pnlSources.open.observedAt = null; }, /observedAt required when available/],
]) {
  const malformedSource = structuredClone(sample);
  mutate(malformedSource);
  assertFail(malformedSource, pattern, `P&L source ${path} rejected`);
}

const inconsistentOpenRollup = structuredClone(sample);
inconsistentOpenRollup.totals.openPnl = 999;
assertFail(inconsistentOpenRollup, /totals\.openPnl must equal sum/, "OPEN household rollup must equal all desk values");

const incompleteAvailableOpen = structuredClone(sample);
incompleteAvailableOpen.desks[1].money.openPnl = null;
incompleteAvailableOpen.totals.openPnl = null;
assertFail(incompleteAvailableOpen, /open available requires finite openPnl/, "available OPEN evidence requires complete desk and household values");

const numericUnavailableDay = structuredClone(sample);
numericUnavailableDay.pnlSources.day = {
  status: "unavailable",
  method: null,
  currency: "EUR",
  scope: "virtual-desks",
  observedAt: null,
  periodStart: null,
  detail: "SOD baseline pending - HOSTD-33",
};
assertFail(numericUnavailableDay, /day unavailable requires null dayPnl/, "unavailable DAY evidence cannot carry placeholder numbers");

const positionPnlWithoutEvidence = structuredClone(sample);
delete positionPnlWithoutEvidence.pnlSources;
positionPnlWithoutEvidence.positions = [{ desk: "j", symbol: "SYNTH-ZERO", dayPnl: 0, openPnl: 0 }];
assertFail(positionPnlWithoutEvidence, /position dayPnl requires available pnlSources\.day/, "position placeholder P&L requires matching source evidence");

const olderPayload = structuredClone(sample);
delete olderPayload.brokerAccount;
assertOk(olderPayload, "older snapshot without brokerAccount");

const retainedBrokerAccount = structuredClone(sample);
retainedBrokerAccount.brokerAccount.status = "unavailable";
assertOk(retainedBrokerAccount, "last-good broker equity retained as unavailable");

const unavailableBrokerAccount = structuredClone(sample);
unavailableBrokerAccount.brokerAccount.status = "unavailable";
unavailableBrokerAccount.brokerAccount.equity = null;
assertOk(unavailableBrokerAccount, "unavailable broker equity remains null");

for (const [field, value, pattern] of [
  ["equity", Number.NaN, /equity must be number or null/],
  ["currency", "USD", /currency must be EUR/],
  ["observedAt", "2026-09-08", /observedAt invalid/],
  ["scope", "virtual-desks", /scope invalid/],
  ["status", "stale", /status invalid/],
]) {
  const invalidBrokerAccount = structuredClone(sample);
  invalidBrokerAccount.brokerAccount[field] = value;
  assertFail(invalidBrokerAccount, pattern, `brokerAccount ${field} rejected`);
}

const availableWithoutBrokerEquity = structuredClone(sample);
availableWithoutBrokerEquity.brokerAccount.equity = null;
assertFail(
  availableWithoutBrokerEquity,
  /equity must be finite when available/,
  "available broker account requires finite equity",
);

const brokerAccountUnknownKey = structuredClone(sample);
brokerAccountUnknownKey.brokerAccount.account = "redacted";
assertFail(brokerAccountUnknownKey, /brokerAccount unknown key account/, "broker account identifiers rejected");

const brokerAccountMissingField = structuredClone(sample);
delete brokerAccountMissingField.brokerAccount.observedAt;
assertFail(brokerAccountMissingField, /observedAt required/, "broker account requires observation time");

const syntheticBackfill = {
  status: "BEST_AVAILABLE",
  fullTotalAvailable: false,
  capturedSubtotal: {
    realizedPnl: -37.125,
    currency: "USD",
    executionCount: 43,
    commissionCount: 42,
    fromInclusive: "2026-09-10T08:00:00.000Z",
    throughInclusive: "2026-09-10T08:05:00.000Z",
  },
  coverage: {
    target: {
      fromInclusive: "2026-09-10T08:00:00.000Z",
      toExclusive: "2026-09-10T08:20:00.000Z",
    },
    completeIntervalCount: 0,
    knownIntervalCount: 1,
    gapCount: 1,
    firstGap: {
      fromInclusive: "2026-09-10T08:05:00.000Z",
      toExclusive: "2026-09-10T08:20:00.000Z",
    },
  },
  missingOpeningLotCount: 1,
  orphanCommissionCount: 1,
};
const partialJBackfill = structuredClone(sample);
delete partialJBackfill.pnlSources;
partialJBackfill.desks[0].backfill = syntheticBackfill;
partialJBackfill.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
partialJBackfill.totals = { equity: null, dayPnl: null, totalPnl: null };
assertOk(partialJBackfill, "bounded partial J backfill with unknown full totals");

const curvedBackfill = structuredClone(partialJBackfill);
curvedBackfill.desks[0].backfill.capturedSubtotal.method = "captured-fifo-matched-roundtrips";
curvedBackfill.desks[0].backfill.capturedSubtotal.points = [
  { at: "2026-09-10T08:00:20.000Z", realizedPnl: -4.5 },
  { at: "2026-09-10T08:01:50.000Z", realizedPnl: 8.25 },
  { at: "2026-09-10T08:04:10.000Z", realizedPnl: 8.25 },
  { at: "2026-09-10T08:05:00.000Z", realizedPnl: -37.125 },
];
curvedBackfill.desks[0].backfill.capturedSubtotal.pointsTruncated = true;
assertOk(curvedBackfill, "nonuniform native-currency captured history curve");

const nullMethodBackfill = structuredClone(partialJBackfill);
nullMethodBackfill.desks[0].backfill.capturedSubtotal.method = null;
assertOk(nullMethodBackfill, "captured subtotal with unavailable calculation method");

const singletonBackfill = structuredClone(partialJBackfill);
singletonBackfill.desks[0].backfill.capturedSubtotal.points = [
  { at: "2026-09-10T08:03:00.000Z", realizedPnl: -37.125 },
];
singletonBackfill.desks[0].backfill.capturedSubtotal.pointsTruncated = false;
assertOk(singletonBackfill, "singleton captured history curve");

const emptyBackfill = structuredClone(partialJBackfill);
emptyBackfill.desks[0].backfill.capturedSubtotal.realizedPnl = null;
emptyBackfill.desks[0].backfill.capturedSubtotal.currency = null;
emptyBackfill.desks[0].backfill.capturedSubtotal.points = [];
emptyBackfill.desks[0].backfill.capturedSubtotal.pointsTruncated = false;
assertOk(emptyBackfill, "explicitly unavailable captured history curve");

const eurBackfill = structuredClone(partialJBackfill);
eurBackfill.desks[0].backfill.capturedSubtotal.currency = "EUR";
assertOk(eurBackfill, "native EUR backfill subtotal");

for (const [mutate, pattern, label] of [
  [(value) => { value.status = "PARTIAL"; }, /status invalid/, "invalid status"],
  [(value) => { value.capturedSubtotal.currency = "GBP"; }, /currency invalid/, "invalid currency"],
  [(value) => { value.capturedSubtotal.realizedPnl = Number.NaN; }, /realizedPnl must be/, "invalid subtotal"],
  [(value) => { value.capturedSubtotal.fromInclusive = "2026-09-10"; }, /fromInclusive invalid/, "invalid capture interval"],
  [(value) => { value.capturedSubtotal.method = "account-average-cost-realized"; }, /method invalid/, "unrelated account method"],
  [(value) => { value.coverage.gapCount = 0; }, /firstGap must be null/, "gap summary mismatch"],
  [(value) => { value.fullTotalAvailable = true; }, /conflicts with incomplete coverage/, "partial promoted to full"],
  [(value) => { value.receipts = []; }, /unknown key receipts/, "private receipt surface"],
]) {
  const invalidBackfill = structuredClone(partialJBackfill);
  mutate(invalidBackfill.desks[0].backfill);
  assertFail(invalidBackfill, pattern, `backfill ${label} rejected`);
}

for (const [mutate, pattern, label] of [
  [(captured) => { delete captured.pointsTruncated; }, /must appear together/, "missing truncation flag"],
  [(captured) => { captured.pointsTruncated = "no"; }, /must be boolean/, "invalid truncation flag"],
  [(captured) => { captured.points[1].at = captured.points[0].at; }, /strictly increasing/, "same-time points"],
  [(captured) => { captured.points[0].at = "2026-09-10T07:59:59.000Z"; }, /outside captured interval/, "point outside capture"],
  [(captured) => { captured.points.at = "ignored"; captured.points[0].execId = "private"; }, /unknown key execId/, "raw id on point"],
  [(captured) => { captured.points[0].currency = "USD"; }, /unknown key currency/, "per-point currency"],
  [(captured) => { captured.points.at = "ignored"; captured.points[captured.points.length - 1].realizedPnl = -37; }, /endpoint must match/, "endpoint mismatch"],
  [(captured) => { captured.points = Array.from({ length: 2049 }, (_, index) => ({ at: new Date(Date.parse(captured.fromInclusive) + index).toISOString(), realizedPnl: index })); }, /at most 2048/, "oversized curve"],
  [(captured) => { captured.realizedPnl = null; captured.currency = null; captured.method = "captured-fifo-matched-roundtrips"; captured.points = []; }, /method must be null/, "FIFO claim without subtotal"],
]) {
  const invalidCurve = structuredClone(curvedBackfill);
  mutate(invalidCurve.desks[0].backfill.capturedSubtotal);
  assertFail(invalidCurve, pattern, `captured curve ${label} rejected`);
}

const misplacedBackfill = structuredClone(sample);
misplacedBackfill.desks[1].backfill = syntheticBackfill;
assertFail(misplacedBackfill, /only valid for desk j/, "backfill rejected outside J");

const accounting = {
  periodStart: "2026-09-10T04:00:00Z",
  method: "execution-fifo-net-current-fx",
  detail: "Net of recorded fees; converted at observed FX. Earlier results unavailable.",
};
const scopedAccounting = structuredClone(sample);
scopedAccounting.desks[0].accounting = accounting;
assertOk(scopedAccounting, "desk with bounded accounting basis");

for (const [field, value, pattern] of [
  ["periodStart", "2026-09-10", /periodStart invalid/],
  ["periodStart", "2026-02-30T04:00:00Z", /periodStart invalid/],
  ["method", "average-cost", /method invalid/],
  ["detail", "", /detail must be/],
  ["detail", "x".repeat(241), /detail must be/],
  ["detail", "Observed FX €", /detail must be/],
]) {
  const invalidAccounting = structuredClone(scopedAccounting);
  invalidAccounting.desks[0].accounting[field] = value;
  assertFail(invalidAccounting, pattern, `accounting ${field}:${JSON.stringify(value).slice(0, 30)}`);
}

const accountingUnknownKey = structuredClone(scopedAccounting);
accountingUnknownKey.desks[0].accounting.source = "unbounded";
assertFail(accountingUnknownKey, /accounting unknown key source/, "accounting unknown key rejected");

const accountingInMoney = structuredClone(sample);
accountingInMoney.desks[0].money.accounting = accounting;
assertFail(accountingInMoney, /money unknown key accounting/, "accounting stays outside money");

const syntheticPerDesk = structuredClone(sample);
syntheticPerDesk.source.label = "Synthetic position contract fixture";
syntheticPerDesk.desks[0].positions = [
  {
    desk: "j",
    symbol: "SYNTH-A",
    side: "Long",
    quantity: 2,
    mark: 10,
    marketValue: 20,
    dayPnl: null,
    openPnl: 1.5,
    updatedAt: sample.generatedAt,
    currency: "USD",
    accountingScope: "legacy",
  },
];
syntheticPerDesk.desks[1].positions = [];
syntheticPerDesk.desks[2].positions = [];
assertOk(syntheticPerDesk, "synthetic per-desk rows with optional extensions");

const syntheticTopLevel = structuredClone(sample);
syntheticTopLevel.source.label = "Synthetic top-level position fixture";
syntheticTopLevel.positions = [
  {
    desk: "joe",
    symbol: "SYNTH-B",
    side: "Short",
    quantity: 1,
    mark: 5,
    marketValue: 5,
    openPnl: null,
    updatedAt: sample.generatedAt,
    accountingScope: "stage0",
  },
];
assertOk(syntheticTopLevel, "synthetic top-level rows with explicit desk");

assertFail(
  Object.assign(structuredClone(sample), { positions: null }),
  /positions must be array/,
  "positions:null must not pass as empty",
);
assertFail(
  Object.assign(structuredClone(sample), { positions: "bad" }),
  /positions must be array/,
  "positions:string must not pass as empty",
);

const deskNullPositions = structuredClone(sample);
deskNullPositions.desks[0].positions = null;
assertFail(
  deskNullPositions,
  /desks\[0\]\.positions must be array/,
  "desk positions:null must not pass as empty",
);

const deskMismatch = structuredClone(sample);
deskMismatch.desks[0].positions = [{ desk: "joe", symbol: "WRONG-DESK" }];
assertFail(
  deskMismatch,
  /desks\[0\]\.positions\[0\]\.desk must match j/,
  "per-desk row with mismatched desk",
);

const unknownKey = structuredClone(sample);
unknownKey.positions = [{ desk: "j", symbol: "X", brokerId: "secret-ish" }];
assertFail(
  unknownKey,
  /unknown key brokerId/,
  "unknown position keys rejected",
);

const badNumber = structuredClone(sample);
badNumber.positions = [{ desk: "j", symbol: "X", mark: Number.NaN }];
assertFail(
  badNumber,
  /mark must be number or null/,
  "non-finite optional numbers rejected",
);

const badDate = structuredClone(sample);
badDate.positions = [{ desk: "j", symbol: "X", updatedAt: "not-a-date" }];
assertFail(
  badDate,
  /updatedAt invalid/,
  "invalid updatedAt rejected",
);

const badCurrency = structuredClone(sample);
badCurrency.positions = [{ desk: "j", symbol: "X", currency: "eur" }];
assertFail(
  badCurrency,
  /currency must be uppercase three-letter code/,
  "lowercase currency rejected",
);

const badScope = structuredClone(sample);
badScope.positions = [{ desk: "j", symbol: "X", accountingScope: "paper" }];
assertFail(
  badScope,
  /accountingScope invalid/,
  "unknown accountingScope rejected",
);

const knownEmptyTop = validateHouseholdSnapshot(
  Object.assign(structuredClone(sample), { positions: [] }),
);
if (!knownEmptyTop.ok) {
  throw new Error("top-level positions:[] must remain valid complete-empty coverage");
}
const knownEmptyDesk = structuredClone(sample);
knownEmptyDesk.desks.forEach((desk) => {
  desk.positions = [];
});
const knownEmptyDeskResult = validateHouseholdSnapshot(knownEmptyDesk);
if (!knownEmptyDeskResult.ok) {
  throw new Error("per-desk positions:[] must remain valid complete-empty coverage");
}

const missingCoverage = coverageStates(structuredClone(sample));
if (missingCoverage.top !== "absent") {
  throw new Error("missing positions key must stay absent, not empty");
}
if (Object.values(missingCoverage.desks).some((state) => state !== "absent")) {
  throw new Error("missing per-desk positions keys must stay absent");
}

const invalidCoverage = coverageStates(
  Object.assign(structuredClone(sample), { positions: null }),
);
if (invalidCoverage.top !== "invalid") {
  throw new Error("positions:null must classify as invalid, not absent or empty");
}

const emptyCoverage = coverageStates(
  Object.assign(structuredClone(sample), { positions: [] }),
);
if (emptyCoverage.top !== "empty") {
  throw new Error("positions:[] must classify as empty, not absent");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 84,
      note: "Synthetic fixtures only — not live broker evidence",
      accepted: {
        legacy: true,
        accounting: true,
        syntheticPerDesk: true,
        syntheticTopLevel: true,
        completeEmptyTop: true,
        completeEmptyDesks: true,
        brokerAccount: true,
        olderPayload: true,
        retainedBrokerAccount: true,
        partialJBackfill: true,
        eurBackfill: true,
        curvedBackfill: true,
        singletonBackfill: true,
        emptyBackfill: true,
        nullMethodBackfill: true,
        moneyOpenPnl: true,
      },
      rejected: [
        "positions:null",
        "positions:string",
        "desk positions:null",
        "desk mismatch",
        "unknown keys",
        "non-finite numbers",
        "invalid dates",
        "bad currency",
        "bad accountingScope",
        "malformed J backfill",
        "backfill outside J",
        "invalid money.openPnl",
        "updatedAt:1",
        "updatedAt:bare-date",
        "updatedAt:feb30",
        "updatedAt:bad-offset",
      ],
    },
    null,
    2,
  ),
);
