#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateFleetConfig, nextFleetRevision } from "../fleet-config.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const [html, css, js, packageJson, schema, actionSchema, example, secretsDoc] = await Promise.all([
  readFile(resolve(repoRoot, "public/joe/index.html"), "utf8"),
  readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8"),
  readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8"),
  readFile(resolve(repoRoot, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config.schema.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config-actions.schema.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "public/joe/fleet-config.example.json"), "utf8").then(JSON.parse),
  readFile(resolve(repoRoot, "docs/joe-fleet-config-secrets.md"), "utf8"),
]);

function required(condition, message) {
  if (!condition) throw new Error(message);
}

const configStart = html.indexOf('<section class="shell board-face board-face--back fleet-config"');
const configEnd = html.indexOf("\n</section>\n</div>\n</main>", configStart);
required(configStart >= 0 && configEnd > configStart, "Fleet Config back face is missing");
const configHtml = html.slice(configStart, configEnd);

required(/class="board-flipper" id="boardFlipper"/.test(html), "whole-board flipper is missing");
required(/id="tradingBoard"[^>]*aria-label="Household paper-trading board"/.test(html), "trading front face is missing");
required(/id="fleetConfigBoard"[^>]*aria-hidden="true" inert/.test(configHtml), "config back must start hidden and inert");
required((configHtml.match(/data-fleet-section=/g) || []).length === 7, "Fleet Config must expose seven technical sections");
required(/Technical/.test(configHtml) && /ELI10/.test(configHtml) && /What do you want to change/.test(configHtml), "human-first settings navigation is incomplete");
required(/data-fleet-action="diff"/.test(configHtml) && /data-fleet-action="confirm"/.test(configHtml), "preview actions are missing");
required(/Diff · see changes/.test(configHtml) && /Confirm review/.test(configHtml) && /Nothing is shared until you select Propagate/.test(html), "Diff and Confirm need plain-language labels");
required((configHtml.match(/data-fleet-action="propagate"/g) || []).length === 2, "both Propagate affordances are required");
required(/id="fleetConfigClose"/.test(configHtml), "Flip back control is missing");
required(!/id="fleetToast"/.test(configHtml) && html.indexOf('id="fleetToast"') > configEnd, "toast must live outside every transformed card ancestor");
required(!/Day P&amp;L|Open P&amp;L|Virtual desk equity/.test(configHtml), "config plane must not contain financial-result copy");
required(/id="fleetSecretSlots"/.test(configHtml) && /fleet-secret-capability/.test(js) && /fleet-secret-ref/.test(js), "secret slots must list capability and path refs");
required(/id="fleetSecretOps"/.test(configHtml) && /joe-fleet-config-secrets\.md/.test(configHtml), "Janus/agenix ops note must deep-link to the secrets doc");
required(/REDACTED/.test(configHtml) && !/(password|api[_ -]?key|bearer)[=:][^<\s]+/i.test(configHtml), "secret slots must remain redacted references");
required(!/(?:ghp_|xox[baprs]-|BEGIN [A-Z ]+PRIVATE KEY|api[_-]?key\s*[:=])/i.test(configHtml), "secret slots UI must not embed credential material");
required(/id="fleetActionLog"/.test(configHtml) && /Durable SSO-attributed outcomes/.test(configHtml), "visible durable action log is missing");
required(/secret values never logged/.test(configHtml), "action log must state its redaction boundary");

required(/\.board-stage\s*\{[^}]*perspective:/s.test(css), "3D scene perspective is missing");
required(/\.board-flipper\s*\{[^}]*transition:\s*transform\s+760ms/s.test(css), "rigid card transition is missing");
required(/\.board-stage\.is-flipping \.board-flipper[^}]*transform-style:\s*preserve-3d/s.test(css), "3D context must activate only while the card is moving or showing its back");
required(/\.board-stage\s*\{[^}]*perspective:\s*none/s.test(css), "idle trading plane must not create a fixed-position containing block");
required(/\.board-flipper\.is-flipped\s*\{\s*transform:\s*rotateY\(180deg\)/.test(css), "flipped board transform is missing");
required(/backface-visibility:\s*hidden/.test(css), "card faces must hide their reverse sides");
required(/prefers-reduced-motion:\s*reduce/.test(css), "flip must honor reduced motion");

const modelStart = js.indexOf("  var FLEET_CONFIG = {");
const modelEnd = js.indexOf("\n  var fleetSectionId", modelStart);
required(modelStart >= 0 && modelEnd > modelStart, "Fleet Config model is missing");
const model = new Function(`${js.slice(modelStart, modelEnd)}; return FLEET_CONFIG;`)();
required(JSON.stringify(Object.keys(model)) === JSON.stringify(["quota", "desks", "cadence", "paths", "routines", "tools", "secrets"]), "Fleet Config section order changed");
for (const [id, section] of Object.entries(model)) {
  required(typeof section.label === "string" && section.label.length > 0, `${id} label is missing`);
  required(typeof section.headline === "string" && typeof section.intro === "string", `${id} ELI10 copy is missing`);
  required(Array.isArray(section.sections) && section.sections.length >= 3, `${id} needs durable ELI10 sections`);
  required(Array.isArray(section.fields) && section.fields.length >= 2 && section.fields.length <= 6, `${id} edit fields are out of bounds`);
  required(section.fields.every((field) => /^[A-Za-z][A-Za-z0-9.]*$/.test(field.key) && typeof field.value === "string"), `${id} has an invalid preview field`);
  required(section.fields.every((field) => field.path || field.editable === false), `${id} editable fields need schema paths`);
}
required(model.quota.fields.find((field) => field.key === "onAmber")?.choices?.length === 2, "amber behavior must be selectable");
required(model.cadence.fields.some((field) => field.key === "darwin"), "Darwin routine must be editable");
required(model.cadence.fields.some((field) => field.key === "wakeWindows" && field.type === "windows"), "wake windows need a form editor");
required(/id="fleetDiffReviewed"/.test(html) && /fleetDiffReviewed.*checked/.test(js), "Confirm needs an explicit review acknowledgement");
required(/\.\/fleet-config\.json/.test(js) && /\.\/fleet-config\/propagate/.test(js) && /\.\/fleet-config\/actions\.json/.test(js), "Fleet Config read/write/action-log endpoints are missing");
required(/fleetDiffFingerprint !== fleetChangeFingerprint/.test(js), "Confirm must require the current diff preview");
required(/fleetConfirmedFingerprint !== fleetChangeFingerprint/.test(js), "Propagate must require the current confirmed diff");
required(/must be a decimal number/.test(js), "number fields must reject implicit JavaScript coercions");
required(/Array\.isArray\(result\.errors\)/.test(js), "server field errors must reach the operator");
required(/field\.editable !== false/.test(js), "stored previews must not override read-only fields");
required(/secretSlots/.test(js) && /editable: false/.test(js), "secret slots must remain read-only");
required(/Plaintext policy vs AGE secrets/.test(js) && /AGE\/agenix holds the encrypted secret material/.test(js), "ELI10 must explain plaintext policy vs AGE secrets");
required(/renderSecretSlots/.test(js) && /fleet-redacted/.test(js) && /REDACTED/.test(js), "secret slot renderer must paint refs with REDACTED only");
required(!/type:\s*"password"/.test(js) && model.secrets.fields.every((field) => field.editable === false), "UI must not bind plaintext credential inputs");
required(/Propagation failed for/.test(js) && /Propagated " \+ result\.rev \+ ": "/.test(js), "propagation outcome toasts must name revision and changed keys");
required(/front\.inert = showFleet/.test(js) && /back\.inert = !showFleet/.test(js), "inactive face must be removed from interaction");
required(/dataset\.joePlane = showFleet \? "fleet-config" : "trading"/.test(js), "active plane state is missing");
required(/id="fleetRevision">Loading/.test(configHtml), "Fleet Config must not claim an example revision before loading");
required(/id="fleetTechnical"/.test(configHtml) && !/id="fleetTechnical"[^>]*\bopen/.test(configHtml), "Technical detail must start collapsed");
for (const id of ["fleetSchemaId", "fleetSourceRevision", "fleetSourcePath", "fleetLastPropagate", "settingsFleetConfig"]) {
  required(html.includes(`id="${id}"`), `${id} findability control is missing`);
}
required(/guide\.label/.test(js) && /guide\.help/.test(js) && /guide\.scope/.test(js), "fields need a human label, help and scope");
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

console.log(JSON.stringify({
  ok: true,
  version: packageJson.version,
  sections: Object.keys(model).length,
  fields: Object.values(model).reduce((count, section) => count + section.fields.length, 0),
  motion: "native CSS 3D rigid-card transform",
  propagate: "atomic shared-file adapter",
  exampleRev: example.rev,
}, null, 2));
