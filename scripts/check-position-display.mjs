#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const joeSource = await readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8");
const cssSource = await readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8");
const sample = JSON.parse(await readFile(resolve(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"));

function extractJoeBlock(startMarker, endMarker) {
  const start = joeSource.indexOf(startMarker);
  const end = joeSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${startMarker} missing from joe.js`);
  return joeSource.slice(start, end);
}

const displayHelpers = `${extractJoeBlock("  var DESK_IDS = [", "\n  var DEFAULT_LAYOUT = [")}
  var money = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
  var moneyFormatters = { EUR: money };
${extractJoeBlock("  function required(condition, message)", "\n\n  function amount(value, signed)")}
${extractJoeBlock("  function moneyForCurrency(currencyCode)", "\n\n  function tone(value)")}
${extractJoeBlock("  function collectPositions(data)", "\n\n  function deskPositionsCoverage(deskId, data)")}`;

const api = new Function(`${displayHelpers}
  return {
    validate,
    collectPositions,
    positionCurrencyCode,
    positionAccountingScopeLabel,
    formatPositionMoney,
    positionMarketValue,
    positionSymbolText
  };
`)();

api.validate(structuredClone(sample));

const syntheticEur = {
  desk: "j",
  symbol: "SYN-EUR",
  side: "Long",
  quantity: 2,
  currency: "EUR",
  mark: 101,
  marketValue: 202,
  openPnl: 12.5,
  updatedAt: sample.generatedAt
};
if (api.positionCurrencyCode(syntheticEur) !== "EUR") {
  throw new Error("explicit EUR currency code must be accepted");
}
if (!/€/.test(api.formatPositionMoney(101, false, "EUR"))) {
  throw new Error("EUR position mark must format in EUR");
}
if (api.formatPositionMoney(202, false, "EUR") !== api.formatPositionMoney(202, false, "EUR")) {
  throw new Error("EUR market value must format without conversion");
}

const syntheticUsd = {
  desk: "joe",
  symbol: "SYN-USD",
  side: "Long",
  quantity: 1,
  currency: "USD",
  mark: 50,
  marketValue: 50,
  openPnl: 1.25,
  updatedAt: sample.generatedAt
};
if (!/\$|US\$/.test(api.formatPositionMoney(50, false, "USD"))) {
  throw new Error("USD position must format in USD without FX conversion");
}
if (api.formatPositionMoney(50, false, "USD") === api.formatPositionMoney(50, false, "EUR")) {
  throw new Error("USD and EUR formatters must not collapse to the same string");
}

const missingCurrency = {
  desk: "joel",
  symbol: "SYN-NOCUR",
  side: "Long",
  quantity: 3,
  mark: 10,
  marketValue: 30,
  openPnl: 2,
  updatedAt: sample.generatedAt
};
if (api.positionCurrencyCode(missingCurrency) !== null) {
  throw new Error("missing currency must stay unavailable");
}
if (api.formatPositionMoney(10, false, null) !== "—") {
  throw new Error("missing currency must render unavailable monetary values");
}
if (api.positionSymbolText(missingCurrency) !== "SYN-NOCUR") {
  throw new Error("missing currency must preserve symbol");
}

const invalidCurrency = Object.assign({}, syntheticEur, { currency: "eur" });
if (api.positionCurrencyCode(invalidCurrency) !== null) {
  throw new Error("lowercase currency must be unavailable");
}

const noMarketValue = Object.assign({}, syntheticEur, { marketValue: null });
if (api.positionMarketValue(noMarketValue) !== null) {
  throw new Error("missing marketValue must not synthesize from qty*mark");
}
if (api.formatPositionMoney(api.positionMarketValue(noMarketValue), false, "EUR") !== "—") {
  throw new Error("missing marketValue must display as unavailable");
}

const legacyPosition = Object.assign({}, syntheticUsd, { accountingScope: "legacy" });
if (api.positionAccountingScopeLabel(legacyPosition) !== "Legacy · excluded from Stage-0") {
  throw new Error("legacy accountingScope must expose the quiet label");
}
if (api.positionAccountingScopeLabel(syntheticUsd) !== null) {
  throw new Error("absent accountingScope must not invent a classification");
}
if (api.positionAccountingScopeLabel(Object.assign({}, syntheticUsd, { accountingScope: "stage0" })) !== null) {
  throw new Error("stage0 accountingScope must not add a consumer label");
}

const dedupSnapshot = api.validate(Object.assign(structuredClone(sample), {
  positions: [
    { desk: "j", symbol: "TOP-ONLY", side: "Long", quantity: 1, currency: "EUR", mark: 1, marketValue: 1, openPnl: 0, updatedAt: sample.generatedAt }
  ],
  desks: structuredClone(sample.desks).map((desk) => {
    if (desk.id !== "j") return desk;
    return Object.assign({}, desk, {
      positions: [
        { symbol: "DESK-ONLY", side: "Long", quantity: 2, currency: "EUR", mark: 2, marketValue: 4, openPnl: 0, updatedAt: sample.generatedAt }
      ]
    });
  })
}));
const deduped = api.collectPositions(dedupSnapshot);
if (deduped.length !== 1 || deduped[0].symbol !== "DESK-ONLY") {
  throw new Error("per-desk positions must win over conflicting top-level rows");
}

const topLevelOnly = api.validate(Object.assign(structuredClone(sample), {
  positions: [
    { desk: "j", symbol: "TOP-J", side: "Long", quantity: 1, currency: "EUR", mark: 1, marketValue: 1, openPnl: 0, updatedAt: sample.generatedAt },
    { desk: "joe", symbol: "TOP-JOE", side: "Long", quantity: 1, currency: "USD", mark: 2, marketValue: 2, openPnl: 0, updatedAt: sample.generatedAt }
  ]
}));
const topRows = api.collectPositions(topLevelOnly);
if (topRows.length !== 2 || topRows.some((row) => row.symbol === "TOP-J" && api.positionCurrencyCode(row) !== "EUR")) {
  throw new Error("legacy top-level rows must still render when per-desk arrays are absent");
}

const browserSyntheticCases = [
  {
    label: "synthetic-eur-position",
    position: syntheticEur,
    expect: { mark: /€/, marketValue: /€/, symbol: "SYN-EUR", scope: null }
  },
  {
    label: "synthetic-usd-position",
    position: syntheticUsd,
    expect: { mark: /[$]/, symbol: "SYN-USD", scope: null }
  },
  {
    label: "synthetic-missing-currency",
    position: missingCurrency,
    expect: { mark: "—", marketValue: "—", symbol: "SYN-NOCUR", scope: null }
  },
  {
    label: "synthetic-legacy-position",
    position: legacyPosition,
    expect: { symbol: "SYN-USD", scope: "Legacy · excluded from Stage-0" }
  }
];

for (const caseEntry of browserSyntheticCases) {
  const currencyCode = api.positionCurrencyCode(caseEntry.position);
  const mark = api.formatPositionMoney(caseEntry.position.mark, false, currencyCode);
  const marketValue = api.formatPositionMoney(api.positionMarketValue(caseEntry.position), false, currencyCode);
  const symbol = api.positionSymbolText(caseEntry.position);
  const scope = api.positionAccountingScopeLabel(caseEntry.position);
  if (caseEntry.expect.mark instanceof RegExp && !caseEntry.expect.mark.test(mark)) {
    throw new Error(`${caseEntry.label}: mark mismatch (${mark})`);
  }
  if (typeof caseEntry.expect.mark === "string" && mark !== caseEntry.expect.mark) {
    throw new Error(`${caseEntry.label}: mark must be ${caseEntry.expect.mark}`);
  }
  if (caseEntry.expect.marketValue instanceof RegExp && !caseEntry.expect.marketValue.test(marketValue)) {
    throw new Error(`${caseEntry.label}: market value mismatch (${marketValue})`);
  }
  if (typeof caseEntry.expect.marketValue === "string" && marketValue !== caseEntry.expect.marketValue) {
    throw new Error(`${caseEntry.label}: market value must be ${caseEntry.expect.marketValue}`);
  }
  if (symbol !== caseEntry.expect.symbol) {
    throw new Error(`${caseEntry.label}: symbol mismatch (${symbol})`);
  }
  if (scope !== caseEntry.expect.scope) {
    throw new Error(`${caseEntry.label}: scope mismatch (${scope})`);
  }
}

if (/quantity \* position\.mark/.test(joeSource)) {
  throw new Error("renderPositions must not synthesize marketValue from qty*mark");
}
if (!/formatPositionMoney\(position\.mark/.test(joeSource)) {
  throw new Error("renderPositions must use per-position currency formatting");
}
if (!/position-scope-note/.test(cssSource)) {
  throw new Error("legacy accounting scope label needs quiet styling");
}
if (!/Object\.prototype\.hasOwnProperty\.call\(desk, "positions"\)/.test(joeSource)) {
  throw new Error("collectPositions must prefer per-desk arrays over top-level rows");
}

console.log(JSON.stringify({
  ok: true,
  checks: 22,
  dedupedSymbol: deduped[0].symbol,
  browserSyntheticCases: browserSyntheticCases.map((entry) => entry.label),
  note: "Synthetic browser-ready cases only; not live evidence."
}, null, 2));
