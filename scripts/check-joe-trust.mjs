#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const cssSource = await readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8");
const htmlSource = await readFile(resolve(repoRoot, "public/joe/index.html"), "utf8");
const sample = JSON.parse(await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"));

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const trustHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
  var accountingDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "America/New_York" });
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function amount(value, signed)", "\n\n  function moneyForCurrency")}
${extractJoeBlock("  function el(tag, className, text)", "\n\n  function endpoint")}
${extractJoeBlock("  function ageInSeconds(iso)", "\n\n  function openPnl(data)")}
${extractJoeBlock("  // HOSTD-33 / Wave D: Day P&L stays unavailable", "\n\n  function labelPaperCapital()")}
${extractJoeBlock("  function deskFreshnessFooter(desk, snapshotAge", "\n\n  function updateSnapshotFreshnessUI(data, snapshotAge, snapshotStale)")}
${extractJoeBlock("  function collectPositions(data)", "\n\n  function deskPositionsCoverage(deskId, data)")}
${extractJoeBlock("  function deskPositionsCoverage(deskId, data)", "\n\n  function positionsAvailability(data)")}
${extractJoeBlock("  function positionsAvailability(data)", "\n\n  function positionsSummaryText(data)")}
${extractJoeBlock("  function positionsEmptyMessage(data, filterDesk)", "\n\n  function renderPositions(data)")}`;

const createdTags = [];
const fakeDocument = {
  createElement(tag) {
    createdTags.push(tag);
    return {
      tag,
      className: "",
      children: [],
      textContent: "",
      appendChild(child) { this.children.push(child); return child; },
    };
  },
};

const api = new Function("document", `${trustHelpers}
  return {
    validate,
    validateAccounting,
    accountingPeriodLabel,
    accountingSinceLabel,
    renderAccountingBasis,
    amount,
    dayPnlDisplayValue,
    deskPositionsCoverage,
    positionsAvailability,
    positionsEmptyMessage,
    deskFreshnessFooter,
    snapshotProblems,
    gatewayHeartbeatAge,
    validIsoTimestamp,
    collectPositions,
    ageInSeconds,
    ageLabel
  };
`)(fakeDocument);

const validated = api.validate(structuredClone(sample));
if (api.dayPnlDisplayValue(validated, validated.totals.dayPnl) !== null) {
  throw new Error("day P&L must stay unavailable until producer contract lands");
}
if (api.positionsAvailability(validated) !== "absent") {
  throw new Error("sample without positions keys must be absent");
}
if (api.accountingSinceLabel(validated.desks[0]) !== "Since start") {
  throw new Error("legacy desk must retain Since start label");
}

const accountingSnapshot = structuredClone(sample);
accountingSnapshot.desks[0].accounting = {
  periodStart: "2026-09-10T04:00:00Z",
  method: "execution-fifo-net-current-fx",
  detail: "<img src=x onerror=globalThis.accountingInjected=true>",
};
const accountingValidated = api.validate(accountingSnapshot);
if (api.accountingSinceLabel(accountingValidated.desks[0]) !== "Since 10 Sep") {
  throw new Error("accounting period label must derive Sep 10 in New York from periodStart");
}
const basisNode = api.renderAccountingBasis(accountingValidated.desks[0]);
if (
  basisNode.children[0].textContent !== "J + J2–J5 · verified from 10 Sep" ||
  basisNode.children[1].textContent !== accountingSnapshot.desks[0].accounting.detail ||
  createdTags.includes("img") || createdTags.includes("script") || globalThis.accountingInjected
) {
  throw new Error("accounting detail must render as literal text without markup execution");
}

const malformedAccounting = structuredClone(accountingSnapshot);
malformedAccounting.desks[0].accounting.periodStart = "2026-09-10";
let malformedAccountingRejected = false;
try {
  api.validate(malformedAccounting);
} catch {
  malformedAccountingRejected = true;
}
if (!malformedAccountingRejected) {
  throw new Error("client validator must reject invalid accounting periodStart");
}

const unavailableJ = structuredClone(accountingSnapshot);
unavailableJ.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
delete unavailableJ.desks[0].positions;
unavailableJ.totals = { equity: null, dayPnl: null, totalPnl: null };
const unavailableJValidated = api.validate(unavailableJ);
if (
  api.amount(unavailableJValidated.desks[0].money.equity, false) !== "—" ||
  api.deskPositionsCoverage("j", unavailableJValidated) !== "absent"
) {
  throw new Error("unavailable J must render unknown money and unavailable positions, not zero or known-empty");
}

const nullTop = api.validate(Object.assign(structuredClone(sample), { positions: null }));
if (api.positionsAvailability(nullTop) !== "partial") {
  throw new Error("positions:null must be partial, not empty");
}

const malformedTop = api.validate(Object.assign(structuredClone(sample), { positions: "bad" }));
if (api.positionsAvailability(malformedTop) !== "partial") {
  throw new Error("non-array positions must be partial");
}

const oneDeskEmpty = structuredClone(sample);
oneDeskEmpty.desks[0].positions = [];
const oneDeskEmptyValidated = api.validate(oneDeskEmpty);
if (api.positionsAvailability(oneDeskEmptyValidated) !== "partial") {
  throw new Error("one empty desk with others absent must be partial");
}
if (api.deskPositionsCoverage("j", oneDeskEmptyValidated) !== "empty") {
  throw new Error("desk j with positions:[] must be known empty");
}
if (api.deskPositionsCoverage("joe", oneDeskEmptyValidated) !== "absent") {
  throw new Error("desk joe without positions key must stay absent in partial coverage");
}

const allDeskEmpty = structuredClone(sample);
allDeskEmpty.desks.forEach((desk) => { desk.positions = []; });
const allDeskEmptyValidated = api.validate(allDeskEmpty);
if (api.positionsAvailability(allDeskEmptyValidated) !== "empty") {
  throw new Error("complete per-desk empty coverage must be empty");
}

const topLevelEmpty = api.validate(Object.assign(structuredClone(sample), { positions: [] }));
if (api.positionsAvailability(topLevelEmpty) !== "empty") {
  throw new Error("top-level positions:[] without desk keys must be complete empty");
}

const presentPositions = structuredClone(sample);
presentPositions.positions = [
  { desk: "j", symbol: "DEMO", side: "Long", quantity: 1, mark: 10, marketValue: 10, dayPnl: null, openPnl: 1, updatedAt: sample.generatedAt },
];
const presentValidated = api.validate(presentPositions);
if (api.positionsAvailability(presentValidated) !== "partial") {
  throw new Error("single-desk top-level rows must be partial coverage");
}
if (api.deskPositionsCoverage("j", presentValidated) !== "present") {
  throw new Error("desk j must be present when row supplied");
}
if (api.deskPositionsCoverage("joe", presentValidated) !== "absent") {
  throw new Error("desk joe must remain absent under partial top-level coverage");
}

const partialMessage = api.positionsEmptyMessage(presentValidated, "all");
if (!/partial/i.test(partialMessage)) {
  throw new Error("partial coverage must not claim a full-account flat state");
}

const deskOnlyMessage = api.positionsEmptyMessage(oneDeskEmptyValidated, "joe");
if (!/not available for this desk/i.test(deskOnlyMessage)) {
  throw new Error("filtered absent desk must not inherit another desk's empty state");
}

const desk = validated.desks[0];
const updatedAtOnly = api.deskFreshnessFooter(
  Object.assign({}, desk, { updatedAt: new Date().toISOString(), heartbeatAt: null }),
  30,
  false,
  false,
  300
);
if (/Heartbeat/.test(updatedAtOnly.text)) {
  throw new Error("updatedAt must not be relabeled as heartbeat");
}
if (!/Snapshot/.test(updatedAtOnly.text)) {
  throw new Error("without heartbeatAt the footer must use snapshot age");
}

const heartbeatDesk = api.deskFreshnessFooter(
  Object.assign({}, desk, { heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  30,
  false,
  false,
  300
);
if (!/Heartbeat/.test(heartbeatDesk.text)) {
  throw new Error("heartbeatAt must label the desk footer as heartbeat");
}

const gatewaySeen = api.gatewayHeartbeatAge(validated);
if (!Number.isFinite(gatewaySeen)) {
  throw new Error("valid gateway.lastSeenAt must produce an age");
}
const badGateway = structuredClone(validated);
badGateway.safety.gateway.lastSeenAt = "not-a-date";
if (api.gatewayHeartbeatAge(badGateway) !== null) {
  throw new Error("invalid gateway.lastSeenAt must be unknown");
}

const staleProblems = api.snapshotProblems(validated, validated.safety.staleAfterSeconds + 5);
if (!staleProblems.some((problem) => /stale/i.test(problem))) {
  throw new Error("snapshotProblems must flag stale age without a successful fetch");
}
const halted = structuredClone(validated);
halted.safety.halt = true;
halted.safety.haltReason = "Operator check";
const haltProblems = api.snapshotProblems(halted, 1);
if (!haltProblems.some((problem) => /HALT/.test(problem))) {
  throw new Error("snapshotProblems must retain HALT even when snapshot age is fresh");
}

if (/attributionNote\.textContent\s*=\s*"Day P&L is not available yet; attribution/.test(joeSource)) {
  throw new Error("labelPaperCapital must not duplicate attribution unavailable copy");
}
const attributionBodyHtml = htmlSource.match(/attribution-body[\s\S]*?<div id="attribution"/);
if (attributionBodyHtml && /<p class="widget-note">/.test(attributionBodyHtml[0])) {
  throw new Error("attribution tile must not keep a static note above the dynamic body");
}
if (/\+ "snapshot " \+ ageLabel\(snapshotAge\)/.test(joeSource)) {
  throw new Error("hero freshness value must not repeat snapshot in the value cell");
}
if (!/table\.positions-table-empty\s*\{[^}]*min-width:\s*0/.test(cssSource)) {
  throw new Error("positions empty table must drop the wide min-width");
}
if (!/table\.positions-table-empty thead\s*\{[^}]*display:\s*none/.test(cssSource)) {
  throw new Error("empty positions table must hide column headers that force horizontal scroll");
}
if (!/syncPositionsTableLayout/.test(joeSource) || !/positions-table-empty/.test(joeSource)) {
  throw new Error("renderPositions must toggle the empty positions table layout");
}

console.log(JSON.stringify({
  ok: true,
  checks: 24,
  positionsPartial: api.positionsAvailability(oneDeskEmptyValidated),
  dayPnl: api.dayPnlDisplayValue(validated, 0),
}, null, 2));
