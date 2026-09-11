#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const [html, css, js, packageJson] = await Promise.all([
  readFile(resolve(repoRoot, "public/joe/index.html"), "utf8"),
  readFile(resolve(repoRoot, "public/joe/joe.css"), "utf8"),
  readFile(resolve(repoRoot, "public/joe/joe.js"), "utf8"),
  readFile(resolve(repoRoot, "package.json"), "utf8").then(JSON.parse),
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
required(/Technical/.test(configHtml) && /ELI10/.test(configHtml) && /Edit selected values/.test(configHtml), "two-column docs plane IA is incomplete");
required(/data-fleet-action="diff"/.test(configHtml) && /data-fleet-action="confirm"/.test(configHtml), "preview actions are missing");
required((configHtml.match(/data-fleet-action="propagate"/g) || []).length === 2, "both Propagate affordances are required");
required(/id="fleetConfigClose"/.test(configHtml), "Flip back control is missing");
required(!/id="fleetToast"/.test(configHtml) && html.indexOf('id="fleetToast"') > configEnd, "toast must live outside every transformed card ancestor");
required(!/Day P&amp;L|Open P&amp;L|Virtual desk equity/.test(configHtml), "config plane must not contain financial-result copy");
required(/REDACTED/i.test(configHtml) && !/(password|api[_ -]?key|bearer)[=:][^<\s]+/i.test(configHtml), "secret slots must remain redacted references");

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
  required(Array.isArray(section.fields) && section.fields.length >= 2 && section.fields.length <= 3, `${id} edit fields are out of bounds`);
  required(section.fields.every((field) => /^[A-Za-z][A-Za-z0-9.]*$/.test(field.key) && typeof field.value === "string"), `${id} has an invalid preview field`);
  required(section.fields.every((field) => configHtml.includes(`data-fleet-readout="${field.key}"`)), `${id} summary does not mirror every preview field`);
}
required(/HOSTD-49\/50 will carry confirmed previews/.test(js), "Propagate must name its follow-up tickets");
required(/front\.inert = showFleet/.test(js) && /back\.inert = !showFleet/.test(js), "inactive face must be removed from interaction");
required(/dataset\.joePlane = showFleet \? "fleet-config" : "trading"/.test(js), "active plane state is missing");
required(new RegExp(`rev <span id="fleetRevision">${packageJson.version.replaceAll(".", "\\.")}</span>`).test(configHtml), "Fleet Config fallback revision must match package version");

console.log(JSON.stringify({
  ok: true,
  version: packageJson.version,
  sections: Object.keys(model).length,
  fields: Object.values(model).reduce((count, section) => count + section.fields.length, 0),
  motion: "native CSS 3D rigid-card transform",
  propagate: "stubbed to HOSTD-49/50",
}, null, 2));
