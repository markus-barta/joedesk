#!/usr/bin/env node
/**
 * Run server-contract tests inside a disposable Docker container or Linux
 * user/mount/network namespace when needed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const DATA_DIR = "/var/lib/joe-board";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = "joedesk-isolated-contract-fixture";

function isDisposableJoeBoardEnv() {
  if (process.platform !== "linux") return false;
  try {
    const mountinfo = readFileSync("/proc/self/mountinfo", "utf8");
    let tmpfsMount = false;
    for (const line of mountinfo.split("\n")) {
      if (!line) continue;
      const split = line.split(" - ");
      if (split.length < 2) continue;
      const left = split[0].split(" ");
      const mountPoint = left[4];
      const fsType = split[1].split(" ")[0];
      if (mountPoint === DATA_DIR && fsType === "tmpfs") tmpfsMount = true;
    }
    if (!tmpfsMount) return false;
    return readdirSync(DATA_DIR).length === 0;
  } catch {
    return false;
  }
}

function runNodeTest() {
  const result = spawnSync(
    "node",
    ["--test", "test/server-contract.mjs"],
    { cwd: repoRoot, stdio: "inherit", env: { ...process.env, JOE_INBOX_TOKEN: token } },
  );
  process.exit(result.status ?? 1);
}

if (isDisposableJoeBoardEnv()) {
  runNodeTest();
}

const result = spawnSync(
  "docker",
  [
    "run", "--rm", "--network", "none",
    "--tmpfs", "/var/lib/joe-board",
    "-e", `JOE_INBOX_TOKEN=${token}`,
    "-v", `${repoRoot}:/repo:ro`,
    "-w", "/repo",
    "node:22",
    "node", "--test", "test/server-contract.mjs",
  ],
  { stdio: "inherit" },
);

if (result.error) {
  const isolated = spawnSync(
    "unshare",
    [
      "--user", "--map-root-user", "--mount", "--net", "--fork",
      "sh", "-c",
      "set -eu; mount -t tmpfs tmpfs /var/lib; mkdir -p /var/lib/joe-board; mount -t tmpfs tmpfs /var/lib/joe-board; ip link set lo up; exec node --test test/server-contract.mjs",
    ],
    { cwd: repoRoot, stdio: "inherit", env: { ...process.env, JOE_INBOX_TOKEN: token } },
  );
  if (!isolated.error) process.exit(isolated.status ?? 1);
  console.error(`docker run failed: ${result.error.message}`);
  console.error(`unshare failed: ${isolated.error.message}`);
  console.error(
    "Run manually with Docker:\n" +
    `  docker run --rm --network none --tmpfs /var/lib/joe-board ` +
    `-e JOE_INBOX_TOKEN='${token}' -v "$PWD:/repo:ro" -w /repo node:22 ` +
    "node --test test/server-contract.mjs",
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
