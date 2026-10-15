#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateFleetConfig, nextFleetRevision } from "../fleet-config.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
// The legacy flip-plane editor retired with GridStack in P3 (JOED-23); the
// rebuilt Settings screen and its UI checks arrive with P5. The schema,
// example, propagate contract and docs stay checked here.
const [packageJson, schema, actionSchema, example, secretsDoc, humanDoc, scatterMap] = await Promise.all([
  readFile(resolve(repoRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config.schema.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config-actions.schema.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config.example.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "docs/joe-fleet-config-secrets.md"), "utf8"),
  readFile(resolve(repoRoot, "docs/fleet-config-human.md"), "utf8"),
  readFile(resolve(repoRoot, "docs/fleet-config-scatter-map.md"), "utf8"),
]);

function required(condition, message) {
  if (!condition) throw new Error(message);
}

required(schema.$id && schema.properties?.mode?.const === "paper", "Fleet Config schema must be paper-only");
required(schema.properties?.secretSlots?.$ref || schema.properties?.secretSlots, "Fleet Config schema must define secret slots");
required(actionSchema.properties?.schema?.const === "inspr.joe.fleet-config.actions.v1", "Fleet action-log schema id is invalid");
required(actionSchema.properties?.entries?.maxItems === 200, "Fleet action log must be bounded");
required(actionSchema.$defs?.action?.properties?.changedKeys && actionSchema.$defs?.action?.properties?.outcome, "Fleet action schema must expose redacted changed keys and outcomes");
const validated = validateFleetConfig(example);
required(validated.ok, `Fleet Config example is invalid: ${validated.errors.join("; ")}`);
required(example.rev === "fc-000000" && nextFleetRevision(example.rev) === "fc-000001", "Fleet Config revision fixture is invalid");
required(example.mode === "paper", "Fleet Config example must remain paper-only");
required(!/(?:password|apiKey|tokenValue|secretValue)/i.test(JSON.stringify(example)), "Fleet Config example contains a plaintext-secret field");
required(Array.isArray(example.secretSlots?.agenix) && example.secretSlots.agenix.every((ref) => typeof ref === "string"), "example secret slots must be reference names");
required(schema.properties?.secretSlots?.description && /plaintext/i.test(schema.properties.secretSlots.description), "schema must forbid plaintext credentials on secret slots");
required(/Plaintext policy vs AGE secrets/.test(secretsDoc) && /Janus\/agenix ops/.test(secretsDoc), "secrets doc must explain AGE vs plaintext and point at ops");
required(/click \*\*Fleet Config\*\*/.test(humanDoc) && /\*\*Propagate\*\*/.test(humanDoc), "human Fleet Config guide is incomplete");
required(/single source of truth/.test(scatterMap) && /quota-state\.json/.test(scatterMap) && /trading-team\/CONFIG\.md/.test(scatterMap) && /nixcfg/.test(scatterMap), "scatter map lacks required surfaces");

console.log(JSON.stringify({
  ok: true,
  version: packageJson.version,
  propagate: "atomic shared-file adapter",
  exampleRev: example.rev,
}, null, 2));
