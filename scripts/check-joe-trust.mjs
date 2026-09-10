#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const sample = JSON.parse(await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"));

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const trustHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function ageInSeconds(iso)", "\n\n  function openPnl(data)")}
${extractJoeBlock("  var TRUSTED_DAY_PNL = {", "\n\n  function gatewayHeartbeatAge(data)")}
${extractJoeBlock("  function collectPositions(data)", "\n\n  function positionsAvailability(data)")}
${extractJoeBlock("  function positionsAvailability(data)", "\n\n  function cell(text, className)")}`;

const api = new Function(`${trustHelpers}
  return {
    validate,
    dayPnlProvenance,
    dayPnlTrusted,
    dayPnlDisplayValue,
    positionsAvailability,
    collectPositions,
    ageInSeconds,
    ageLabel
  };
`)();

const validated = api.validate(structuredClone(sample));
if (api.dayPnlTrusted(validated)) throw new Error("sample without provenance must not trust day P&L");
if (api.dayPnlDisplayValue(validated, validated.totals.dayPnl) !== null) {
  throw new Error("untrusted day P&L must not render a numeric display value");
}
if (api.positionsAvailability(validated) !== "absent") {
  throw new Error("sample without positions keys must be absent");
}

const provenanced = structuredClone(sample);
provenanced.source.dayPnl = "broker-daily";
const trusted = api.validate(provenanced);
if (!api.dayPnlTrusted(trusted)) throw new Error("broker-daily provenance must trust day P&L");
if (api.dayPnlDisplayValue(trusted, trusted.totals.dayPnl) !== trusted.totals.dayPnl) {
  throw new Error("trusted day P&L must display the supplied value");
}

const zeroDay = structuredClone(sample);
zeroDay.source.dayPnl = "broker-daily";
zeroDay.totals.dayPnl = 0;
zeroDay.desks.forEach((desk) => { desk.money.dayPnl = 0; });
const zeroTrusted = api.validate(zeroDay);
if (api.dayPnlDisplayValue(zeroTrusted, 0) !== 0) {
  throw new Error("trusted zero day P&L must remain displayable");
}

const fakeZero = structuredClone(sample);
fakeZero.totals.dayPnl = 0;
fakeZero.desks.forEach((desk) => { desk.money.dayPnl = 0; });
const fakeValidated = api.validate(fakeZero);
if (api.dayPnlDisplayValue(fakeValidated, 0) !== null) {
  throw new Error("untrusted zero day P&L must not be shown as earnings");
}

const emptyPositions = structuredClone(sample);
emptyPositions.positions = [];
const emptyValidated = api.validate(emptyPositions);
if (api.positionsAvailability(emptyValidated) !== "empty") {
  throw new Error("explicit empty positions array must be empty, not absent");
}

const presentPositions = structuredClone(sample);
presentPositions.positions = [
  { desk: "j", symbol: "DEMO", side: "Long", quantity: 1, mark: 10, marketValue: 10, dayPnl: null, openPnl: 1, updatedAt: sample.generatedAt },
];
const presentValidated = api.validate(presentPositions);
if (api.positionsAvailability(presentValidated) !== "present") {
  throw new Error("positions with rows must be present");
}
if (api.collectPositions(presentValidated).length !== 1) {
  throw new Error("collectPositions must return supplied rows");
}

const deskEmpty = structuredClone(sample);
deskEmpty.desks[0].positions = [];
const deskEmptyValidated = api.validate(deskEmpty);
if (api.positionsAvailability(deskEmptyValidated) !== "empty") {
  throw new Error("desk-level empty positions must be empty, not absent");
}

const nestedProvenance = structuredClone(sample);
nestedProvenance.provenance = { dayPnl: "snapshot-diff" };
const nestedValidated = api.validate(nestedProvenance);
if (!api.dayPnlTrusted(nestedValidated)) {
  throw new Error("root provenance.dayPnl must be accepted");
}

const staleAge = api.ageInSeconds(new Date(Date.now() - 120_000).toISOString());
if (!Number.isFinite(staleAge) || staleAge < 110 || staleAge > 130) {
  throw new Error(`ageInSeconds drift unexpected: ${staleAge}`);
}
if (api.ageLabel(staleAge) !== "2m") throw new Error("ageLabel must format minutes");

console.log(JSON.stringify({
  ok: true,
  checks: 12,
  provenance: api.dayPnlProvenance(validated),
  trustedAfter: api.dayPnlProvenance(trusted),
}, null, 2));
