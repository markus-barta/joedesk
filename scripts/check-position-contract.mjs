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
openPnlTotals.totals.openPnl = 12.5;
assertFail(openPnlTotals, /totals unknown key openPnl/, "money.openPnl remains rejected on server");

assertOk(structuredClone(sample), "legacy snapshot without positions keys");

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
      checks: 30,
      note: "Synthetic fixtures only — not live broker evidence",
      accepted: {
        legacy: true,
        syntheticPerDesk: true,
        syntheticTopLevel: true,
        completeEmptyTop: true,
        completeEmptyDesks: true,
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
        "money.openPnl",
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
