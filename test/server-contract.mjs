#!/usr/bin/env node
/**
 * HTTP contract tests against server.mjs.
 * MUST run only inside a disposable Linux environment with:
 *   --network none --tmpfs /var/lib/joe-board
 * See scripts/run-server-contract.mjs or CI package job.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { resolve, join } from "node:path";

const DATA_DIR = "/var/lib/joe-board";
const BIND_PORT = 8080;
const TOKEN = "joedesk-isolated-contract-fixture";
const BASE = `http://127.0.0.1:${BIND_PORT}`;
const repoRoot = resolve(import.meta.dirname, "..");

const DOCKER_INVOCATION = [
  "docker run --rm --network none --tmpfs /var/lib/joe-board",
  `-e JOE_INBOX_TOKEN='${TOKEN}'`,
  '-v "$PWD:/repo:ro" -w /repo node:22',
  "node --test test/server-contract.mjs",
].join(" ");

let serverProc;
let appVersion;


function failClosed(reason) {
  throw new Error(
    `${reason}\n\nRefusing to run server-contract on this host.\n` +
    `Use a disposable container:\n  ${DOCKER_INVOCATION}`,
  );
}

function assertDisposableJoeBoardDir() {
  if (process.platform !== "linux") {
    failClosed(`platform is ${process.platform}, expected linux`);
  }
  const mountinfo = readFileSync("/proc/self/mountinfo", "utf8");
  let tmpfsMount = false;
  for (const line of mountinfo.split("\n")) {
    if (!line) continue;
    const split = line.split(" - ");
    if (split.length < 2) continue;
    const left = split[0].split(" ");
    const mountPoint = left[4];
    const fsType = split[1].split(" ")[0];
    if (mountPoint === DATA_DIR && fsType === "tmpfs") {
      tmpfsMount = true;
      break;
    }
  }
  if (!tmpfsMount) {
    failClosed(`/proc/self/mountinfo has no tmpfs mount at ${DATA_DIR}`);
  }
  const entries = readdirSync(DATA_DIR);
  if (entries.length > 0) {
    failClosed(`${DATA_DIR} must be empty before start (found: ${entries.join(", ")})`);
  }
}

async function loadAppVersion() {
  const versionSource = await readFile(join(repoRoot, "public/joe/joe-version.js"), "utf8");
  const joeVersion = new Function("window", `${versionSource}; return window.JoeVersion;`)({});
  if (!joeVersion?.APP_VERSION) throw new Error("JoeVersion.APP_VERSION missing");
  return joeVersion.APP_VERSION;
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/healthz", method: "GET", timeout: 500 },
      (res) => {
        res.resume();
        reject(new Error(`refusing to run: port ${port} already in use (got HTTP ${res.statusCode})`));
      },
    );
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") resolve();
      else reject(err);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`refusing to run: port ${port} did not answer before timeout`));
    });
    req.end();
  });
}

function assertServerAlive() {
  if (!serverProc || serverProc.exitCode !== null) {
    throw new Error(`server process exited (code ${serverProc?.exitCode ?? "unknown"})`);
  }
}

async function waitForServer(proc, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    assertServerAlive();
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assertServerAlive();
  throw new Error("server did not become ready");
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

before(async () => {
  assertDisposableJoeBoardDir();
  if (TOKEN.length < 16) {
    throw new Error("JOE_INBOX_TOKEN must be at least 16 characters");
  }
  appVersion = await loadAppVersion();
  await assertPortFree(BIND_PORT);

  serverProc = spawn("node", ["server.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, JOE_INBOX_TOKEN: TOKEN, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  serverProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`server exited with code ${code}\n`);
    }
  });

  await waitForServer(serverProc);


});

after(async () => {
  if (serverProc && serverProc.exitCode === null) {
    serverProc.kill("SIGTERM");
    await new Promise((resolve) => serverProc.on("exit", resolve));
  }
});

describe("server contract", () => {
  test("healthz matches initial server response", async () => {
    assertServerAlive();
    const res = await jsonFetch("/healthz");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, service: "joe-board", hasData: false });
    assert.equal(res.body.ok, true);
    assert.equal(res.body.service, "joe-board");
    assert.equal(res.body.hasData, false);
  });

  test("readyz matches initial server response", async () => {
    assertServerAlive();
    const res = await jsonFetch("/readyz");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, service: "joe-board", hasData: false });
  });

  test("GET /joe/data.json matches empty-store server response", async () => {
    assertServerAlive();
    const res = await jsonFetch("/joe/data.json");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { ok: false, error: "NO DATA" });
  });

  test("GET /joe/history.json matches missing-file server response", async () => {
    assertServerAlive();
    const res = await jsonFetch("/joe/history.json");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { schema: "inspr.joe.household.history.v1", points: [] });
  });

  test("GET /joe permanently redirects to the canonical slash and preserves query", async () => {
    assertServerAlive();
    for (const [source, location] of [
      ["/joe", "/joe/"],
      ["/joe?desk=j&view=wide", "/joe/?desk=j&view=wide"],
    ]) {
      const res = await fetch(`${BASE}${source}`, { redirect: "manual" });
      assert.equal(res.status, 308, source);
      assert.equal(res.headers.get("location"), location, source);
    }
  });

  test("GET /joe/ serves HTML with the canonical document base", async () => {
    assertServerAlive();
    const res = await fetch(`${BASE}/joe/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /^text\/html\b/);
    assert.match(await res.text(), /<base href="\/joe\/">/);
  });

  test("static UI assets are served with JoeVersion from source", async () => {
    assertServerAlive();
    for (const path of ["/joe/", "/joe/joe.js", "/joe/joe-version.js", "/joe/data.schema.json"]) {
      const res = await fetch(`${BASE}${path}`);
      assert.equal(res.status, 200, path);
      const text = await res.text();
      assert.ok(text.length > 0, path);
    }
    const versionRes = await fetch(`${BASE}/joe/joe-version.js`);
    const versionText = await versionRes.text();
    assert.match(versionText, new RegExp(`APP_VERSION:\\s*"${appVersion.replace(/\./g, "\\.")}"`));
  });

  test("POST /joe/inbox rejects missing auth per server", async () => {
    assertServerAlive();
    const res = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
  });

  test("POST /joe/inbox rejects invalid snapshot", async () => {
    assertServerAlive();
    const res = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ schema: "wrong" }),
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, "schema validation failed");
    assert.ok(Array.isArray(res.body.errors));
  });

  test("POST /joe/inbox stores legacy and accounting-scoped snapshots in ephemeral tmpfs", async () => {
    assertServerAlive();
    const sample = JSON.parse(
      await readFile(join(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"),
    );
    sample.generatedAt = new Date().toISOString();

    const push = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(sample),
    });
    assert.equal(push.status, 200);
    assert.equal(push.body.ok, true);
    assert.equal(typeof push.body.historyPoints, "number");

    const health = await jsonFetch("/healthz");
    assert.equal(health.body.hasData, true);

    const data = await jsonFetch("/joe/data.json");
    assert.equal(data.status, 200);
    assert.equal(data.body.schema, sample.schema);
    assert.equal(data.body.generatedAt, sample.generatedAt);

    const history = await jsonFetch("/joe/history.json");
    assert.equal(history.status, 200);
    assert.equal(history.body.schema, "inspr.joe.household.history.v1");
    assert.ok(history.body.points.length >= 1);
    assert.equal(history.body.points.at(-1).t, sample.generatedAt);
    assert.equal(history.body.points.at(-1).accounting, undefined);
    assert.equal(history.body.points.at(-1).historyBasis, undefined);
    const retainedLegacyPointBytes = JSON.stringify(history.body.points.at(-1));

    const scoped = structuredClone(sample);
    scoped.generatedAt = new Date(Date.parse(sample.generatedAt) + 1000).toISOString();
    scoped.desks[0].accounting = {
      periodStart: "2026-09-10T04:00:00Z",
      method: "execution-fifo-net-current-fx",
      detail: "Net of recorded fees; converted at observed FX. Earlier results unavailable.",
    };
    scoped.desks.find((desk) => desk.id === "joel").historyBasis = "joel.stage0-keep-excluded.v1";
    const scopedPush = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(scoped),
    });
    assert.equal(scopedPush.status, 200);
    const scopedHistory = await jsonFetch("/joe/history.json");
    assert.deepEqual(scopedHistory.body.points.at(-1).accounting, {
      j: scoped.desks[0].accounting,
    });
    assert.deepEqual(scopedHistory.body.points.at(-1).historyBasis, {
      joel: "joel.stage0-keep-excluded.v1",
    });

    const unavailable = structuredClone(scoped);
    unavailable.generatedAt = new Date(Date.parse(scoped.generatedAt) + 1000).toISOString();
    unavailable.source.label = "Synthetic J-unavailable contract fixture";
    unavailable.desks[0].money = { equity: null, dayPnl: null, totalPnl: null };
    delete unavailable.desks[0].accounting;
    delete unavailable.desks[0].positions;
    unavailable.totals = { equity: null, dayPnl: null, totalPnl: null };
    const unavailablePush = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(unavailable),
    });
    assert.equal(unavailablePush.status, 200);
    const unavailableData = await jsonFetch("/joe/data.json");
    assert.deepEqual(unavailableData.body.desks[0].money, unavailable.desks[0].money);
    assert.equal(Object.prototype.hasOwnProperty.call(unavailableData.body.desks[0], "positions"), false);
    const unavailableHistory = await jsonFetch("/joe/history.json");
    const unavailablePoint = unavailableHistory.body.points.at(-1);
    assert.equal(unavailablePoint.accounting, undefined);
    assert.deepEqual(unavailablePoint.desks.j, unavailable.desks[0].money);
    assert.deepEqual(unavailablePoint.desks.joe, unavailable.desks[1].money);
    assert.deepEqual(unavailablePoint.desks.joel, unavailable.desks[2].money);
    assert.deepEqual(unavailablePoint.totals, unavailable.totals);

    const restored = structuredClone(scoped);
    restored.generatedAt = new Date(Date.parse(unavailable.generatedAt) + 1000).toISOString();
    restored.source.label = "Synthetic J-restored contract fixture";
    const restoredPush = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(restored),
    });
    assert.equal(restoredPush.status, 200);
    const restoredHistory = await jsonFetch("/joe/history.json");
    const jWindow = restoredHistory.body.points.slice(-3).map((point) => point.desks.j.equity);
    assert.deepEqual(jWindow, [scoped.desks[0].money.equity, null, restored.desks[0].money.equity]);
    for (const deskId of ["joe", "joel"]) {
      const expected = restored.desks.find((desk) => desk.id === deskId).money.equity;
      assert.deepEqual(restoredHistory.body.points.slice(-3).map((point) => point.desks[deskId].equity), [expected, expected, expected]);
    }
    assert.equal(JSON.stringify(restoredHistory.body.points[0]), retainedLegacyPointBytes);
    assert.deepEqual(restoredHistory.body.points.slice(-3).map((point) => point.historyBasis), [
      { joel: "joel.stage0-keep-excluded.v1" },
      { joel: "joel.stage0-keep-excluded.v1" },
      { joel: "joel.stage0-keep-excluded.v1" },
    ]);

    const dirEntries = await readdir(DATA_DIR);
    assert.ok(dirEntries.includes("data.json"));
    assert.ok(dirEntries.includes("history.json"));
  });

  test("POST /joe/inbox rejects malformed explicit history basis metadata", async () => {
    assertServerAlive();
    const sample = JSON.parse(
      await readFile(join(repoRoot, "docs/examples/joe-data.sample.json"), "utf8"),
    );
    sample.generatedAt = new Date(Date.now() + 60_000).toISOString();
    sample.desks.find((desk) => desk.id === "joel").historyBasis = "KEEP excluded current";
    const res = await jsonFetch("/joe/inbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(sample),
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.errors.some((error) => error.includes("historyBasis")));
  });

  test("unknown routes match server 404 contract", async () => {
    assertServerAlive();
    const res = await jsonFetch("/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { ok: false, error: "not found" });
  });
});
