# JoeDesk

Standalone Joe household paper-trading desk: static `/joe/` UI plus a small Node inbox server. Paper projection only — no broker access, no order placement.

**Candidate version:** `261016151218.0.0` (`inspr-calver-3`, stable sequence 24). `release.json` is authoritative for this candidate's builds; package and UI match it. The last published legacy anchor is `calendar` / `26.09.21.12.00` / sequence 23. No publication, deployment or authoritative live adoption is claimed by this branch.

## P6a release preparation (JOED-26)

This branch is paper-only preparation on `rebuild/v2`. It is **not ready for
cutover**. No source, image or tag was published. The candidate reservation and
legacy anchor live in `release/preparation.json`; historical tags, releases and
version-history entries are unchanged. The old CalVer2 proposal JOED-13 is
superseded by JOED-19's approved CalVer3 decision and consolidated into JOED-26.

The shared presentation uses INSPR-486's merged and reviewed **bundle pin for
consumers**, under JOED-19's choice of the global defaults (no named template):
source `01b3080948c21899cbbacbfa3447da6799af1b56`, config SHA256
`bf6aa144cd73dc97dc941f0f0914138b04ae0a28fbead5123465b15b1f2a2fd9`, manifest SHA256
`d4dcb8c05d0fcad7d60183156166c5a30f21e6abc1ac0c274ee3e0791e5ea912`.
The complete bundle lives under `public/joe/vendor/calver/`; its manifest is
byte-identical to that saved record. `version-display.js` is the only product
adapter. The shared renderer owns six-segment Pretty geometry, reduced SemVer,
reveal/reduced motion and canonical copy. The footer and current About entry
use it; legacy history remains plain. The SemVer/Pretty switch is session-only;
auto colors follow the actual product accent. Tooltip and accessible name
carry the complete coordinate and UTC timestamp; English copy feedback uses
the shared interaction helper. No runtime settings are fetched.
`node scripts/check-release.mjs --require-adoption` still fails until the
coordinator's immutable-publication and live gates are met.

Every `npm run check`, Docker build and Nix package build verifies the committed
runtime closure offline: exact file set, regular files, byte counts and SHA256.
Working-tree checks also reject untracked payloads. `release/contracts.json`
binds the complete shared validator/schema set and exact compatibility IDs for
board, pusher and executor; fixture compatibility is a rehearsal, not Amy's
producer approval. Health readers now accept the deprecated `inspr-calendar-v2`
identifier as well as CalVer3 and the published legacy `calendar` declaration.
The Docker base and disposable test runner use immutable OCI index digests;
the default Nix input uses a full revision and NAR hash. A caller injecting
`pkgs` must retain its own immutable deployment lock. No JS dependency was added.
Stale `?v=` asset coordinates return 404 instead of another release's bytes;
the worker already uses the matching release path. No service worker is used.

`npm run release:evidence -- VALIDATION_RUN_ID` emits source commit/tree,
runtime-closure and contract-set digests, dependency pins, candidate metadata
and pending gates from a clean committed source. It emits candidate evidence;
the coordinator still supplies the immutable output artifact coordinates and
digests, signatures/SBOM/provenance and reviewed downstream compatibility.

### Offline data preparation and rollback

`scripts/prepare-data.mjs` requires explicit `--offline`, source and **new**
destination paths. OPS must stop writers first. Backups copy only the known
board data/config/audit files, retain exact bytes, use directory mode 0700 and
file mode 0600, and record sizes/SHA256 in `backup-manifest.json`. Unknown files,
symlinks, oversized input, incomplete backups and existing destinations fail
closed; nothing is deleted or overwritten.

The command forms are:

```sh
node scripts/prepare-data.mjs backup --offline SOURCE NEW_BACKUP v1
node scripts/prepare-data.mjs verify --offline BACKUP
node scripts/prepare-data.mjs migrate-v2 --offline V1_BACKUP NEW_V2_STORE V2_SNAPSHOT UTC_RECEIPT
node scripts/prepare-data.mjs restore --offline BACKUP NEW_RESTORE v1
```

Migration accepts a real, validated v2 producer snapshot and an explicit UTC
receipt (ISO form with milliseconds). It creates a separate v2 store, preserving
compatible Fleet Config and its validated change log (`fleet-config-actions.json`)
byte-for-byte, including pending/failed audit entries, and establishing durable sequence/receipt state through
the real server acceptance path. Legacy money/history cannot prove the v2
decimal/evidence/basis contract: their original bytes remain in the v1 backup;
they are never relabelled or used to fabricate historical observations. The v2
board refuses to start in a directory containing legacy data/history. A v2
backup can be restored only with `v2`; a v1 board rollback selects its previous
producer **and v1 backup**, never the current v2 data directory. The CLI does not
stop services, select deployment pins or switch a host.

`V2_SNAPSHOT` is Amy's JOED-20 approved staged **ingress** snapshot (no
`receivedAt`), not a copied v1 file or a served response. `UTC_RECEIPT` is the
actual UTC time that this snapshot was received for staging, recorded as
`YYYY-MM-DDTHH:mm:ss.sssZ`; never substitute cutover time to make old evidence
look fresh. The next pusher sequence must exceed the snapshot's `seq`, with
non-regressing generation/evidence times. If staging has aged before cutover,
require a new accepted producer observation before the fresh-feed smoke passes.

### OPS-354 / P6b handoff

OPS owns these exact nixcfg items through its existing review path:

1. An exact `/joe/healthz` anonymous GET/HEAD SSO exception, tested without a
   cookie; keep UI/assets and all six protected reads behind SSO. Strip incoming
   identity headers (including `X-Auth-Request-User`, the app's actual identity,
   and `X-Forwarded-User`) before SSO, and inject `X-Auth-Request-User` only from
   the authenticated SSO result over the private app connection. Keep the app
   port unreachable from the public network. Neither inbox credentials nor auth policy change here.
   Configure the SSO rejection handler to return `X-JoeDesk-SSO: required`
   **only** on its own anonymous redirect/deny responses (30x with a nonempty
   `Location`, or 401/403). Strip any upstream copy of that header; never add it
   globally, on app responses, or on health. This distinguishes an SSO denial
   from the app's own 401. Protected requests with spoofed identity must hit the
   same SSO rejection handler before reaching the app. The exact health router
   must not match `/joe/healthz/` or `/joe/healthz-extra`.
2. Board/pusher/executor immutable deployment pins, the contract-set SHA256 and
   exact IDs in `release/contracts.json`, with Amy's JOED-20 staging and
   reconciliation approval. Retain previous compatible pins/image/generation.
   The previous board source pin is `db621bf` (legacy `calendar` version
   `26.09.21.12.00`, sequence 23); it was deployed without a corresponding tag.
   Existing tags end at `v26.09.14.17.40` (sequence 22); preserve that history.
   Do not pin `rebuild/v2` before the separate approved cutover.
3. A private verified v1 backup, a separately staged v2 directory, and one
   `just rollback-joedesk` command selecting the previous compatible pins **and
   v1 data backup** through the normal human-controlled switch, followed by
   health smoke. Rehearse on a workstation/CI lab, never on a production host.
   A rollback to the original v1 board uses its retained private `/healthz` /
   `/readyz` probe and original authenticated version/data checks; it has no v2
   `/joe/healthz` contract. Do not broaden the public SSO exception or treat a
   404 from the new smoke as success. OPS must bind that legacy smoke to the
   exact previous image and its matching v1 backup in the rollback rehearsal.
   The board's fixed store is `/var/lib/joe-board`, uid 1000. While the board
   and all writers are stopped, prepare the new directory on the same filesystem,
   chown the staged directory and every staged file to uid 1000 and the board's
   configured gid, and preserve 0700/0600 modes. Rename the current store to a
   retained, unique sibling, then rename the staged directory to the fixed path;
   never overwrite a directory. Restore the retained directory if the second
   rename fails. For rollback, restore the verified v1 backup into a new sibling,
   apply the same ownership/modes and stopped-service swap, then start the
   compatible v1 pins. Chown is required even when no NixOS activation occurs.
4. The production host gate including `cs0.barta.cm`; no other route exemption
   beyond the existing token-only `/joe/inbox` router.
5. After the gates and Markus's cutover decision, run
   `node scripts/smoke-release.mjs BASE_JOE_URL VERSION_SCHEME CANONICAL_VERSION`.
   `BASE_JOE_URL` is the public SSO route ending **exactly** in `/joe/`, with no
   credentials, query or fragment (for example `https://board.example.invalid/joe/`).
   It sends no cookies or authorization, follows no redirect, validates the exact health
   allowlist and expected version/schema, requires fresh data/history/config
   and a confirmed gateway. It probes all six reads, `/joe/`,
   `/joe/app.js?v=CANONICAL_VERSION`, and both near-health paths, first anonymously
   and again with well-formed synthetic `X-Auth-Request-User` and `X-Forwarded-User`.
   Every protected probe must receive the marked SSO redirect/deny; a bare app,
   an app 401, an exposed UI/asset, a broad exemption or a spoof bypass fails.
   Health must return an unmarked 200. Health 302 is `auth_required`.
   Exit 0 emits one JSON record with `ok: true`, canonical version/schema, feed
   ages/states, `protectedReads`, `protectedUI` and `spoofedIdentity` all
   `sso-rejected`, `healthException: exact-path`, and Results state. Exit 1 emits
   one value-free stderr reason: `auth_required`, `release_mismatch`,
   `feeds_not_ready`, `protected_read_exposed`, `protected_ui_exposed`,
   `spoofed_identity_exposed`, `sso_not_proven`, `sso_marker_on_health`, or
   `release_smoke_failed` for malformed input/health, transport or other errors.
   Bodies, identities and credentials are never printed. Unwired Results remains explicitly reported;
   this smoke does not substitute for Amy's results sign-off or Tick/Markus's
   signed-in UI verification.

Tests and acceptance mapping: ADR's JOED-26 addendum, `test/release.mjs` and
`scripts/browser-p6.mjs`. Local Tick evidence goes to
`~/.local/share/joedesk-qa/p6a/index.md`. The version shots cover the
Pretty rest/reveal, canonical copy/UTC accessibility, reduced SemVer, keyboard,
touch and reduced motion. Tick/coordinator approval remains outstanding.

## Provenance

| Piece | Source |
|-------|--------|
| UI (`public/joe/`) | Extracted from [hostdash PR #21](https://github.com/markus-barta/hostdash/pull/21), `7ffdae42951170b84af6ae713421d6263d344a6d` |
| Server (`server.mjs`, `validate.mjs`) | nixcfg `0c65a3d891ab0c4ed5b689f91f04454e8c787e65` |

This repo inherits the source availability of those trees. Do not add license claims for material that was not licensed in the upstream.

## Requirements

- Node.js 22+
- Server data store at `/var/lib/joe-board` (fixed path; provision on the host or in a container volume)
- Fleet Config adapter at `/var/lib/joe-board/fleet-config.json` (created atomically on first propagation; mode is fixed to `paper`)
- Fleet Config action log at `/var/lib/joe-board/fleet-config-actions.json` (latest 200 attributed outcomes; changed-key names only)
- Push token via `/run/secrets/joe-board-push-token` or `JOE_INBOX_TOKEN` (≥16 chars) when the secret file is absent

## Setup

```bash
git clone https://github.com/markus-barta/joedesk.git && cd joedesk
```

Provision the data directory and inbox token on your deployment host (not shown here — use your secret manager).

## Build

**Docker (recommended):**

```bash
docker build -t joedesk:26.09.14.17.08 .
```

Image copies `public/` unchanged. No sample or synthetic `data.json` is baked in — an empty store shows `NO DATA`.

**Nix (static + server install):**

```bash
nix-build --no-out-link
# UI assets: $out/share/joedesk/public/joe/
# server:     $out/bin/joedesk-server
```

## Test

The JOED-21/JOED-22 rebuild lives in
[ADR 0001](docs/adr/0001-joedesk-architecture.md). The P2 server uses the offline
`contracts/` package for v2 data/history and v1 Fleet Config. The existing UI
remains legacy until P3; this branch requires coordinated producer/UI cutover
and is not a deployable compatibility upgrade on its own. Synthetic incident
payloads are in `fixtures/`. `time.mjs` runs all 24 P1 vectors plus 2027 spring,
Vienna week/midnight, repeated NY hours, extended-hours and pinned NYSE calendar
tests. The full per-item P2 test mapping is at the end of the ADR.

```bash
npm run test:contracts   # pure local contracts, fixtures and time vectors
npm run test:contracts:browser  # installed Chrome + trash; BROWSER_PATH override
npm test                # contracts plus isolated P2 HTTP/restart/storage tests
npm run check           # existing package and UI checks
```

Import `validateContract` from `./contracts/index.mjs` on Node 22+ or in a
browser with JSON module import attributes. Use `stage: "ingress"` for a
producer payload (receivedAt forbidden) and the default served stage after the
server stamps it. The pure `acceptSnapshot` helper returns 422 and retains
last-good on rejection; `server/read-model.mjs` connects it to durable receipt,
sequence, gateway-check progress and per-cell retention. The schemas and
shared semantic validator must travel together when pinned in producer CI.
`validateAndRetain` applies the same last-good rule to all five contracts,
including browser reads and server-controlled Fleet Config/health projections.

The candidate rejects non-null current money/marks when the API session is
dead, missing or unconfirmed by a check younger than 60 seconds. Panel selectors
expire old checks independently of new receipts. It also rejects incomplete or
unequal family totals at any history point. Source detail and observed valuation
evidence have explicit v2 homes; session-open
estimates use a distinct method (see the ADR's legacy mapping table). Panel
states expose retained values with their original receipt age (unknown if that
receipt is missing); `retained_values` names the carried-to-null mapping. Pass
the accepted Fleet Config feed (or the fourth `panelStates` argument, its KEEP symbols) for
policy-based row routing; scope disagreement withholds affected desk totals.

```bash
npm run check                          # package, board UI source, Fleet Config, position contract
npm run test:ui                        # board UI modules under Node
node scripts/run-server-contract.mjs   # private macOS temp root or disposable Linux tmpfs
```

The factory `createJoeServer` injects storage, clock and fixture authentication;
importing it does not start a listener or read a credential. On macOS the runner
creates an empty mode-0700 temporary root, validates its owner/location and
trashes only that root afterward. On Linux the tests still require an empty
`/var/lib/joe-board` tmpfs. Neither path touches the host production store.
CI uses:

```bash
docker run --rm --network none --tmpfs /var/lib/joe-board \
  -e JOE_INBOX_TOKEN="$JOE_INBOX_TOKEN" \
  -v "$PWD:/repo:ro" -w /repo node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 \
  node --test test/server-contract.mjs
```

The board UI gate (`scripts/browser-p3.mjs`, JOED-23) runs the real board
server with an injected clock, the P1 failure fixtures and one headless
browser at 390, 1024 and 1440 px in light and dark. It checks the approved
design's acceptance criteria (mode label, KEEP inertness, health light and
copy, panel states, honest chart scales, contrast, 44 px targets, clipping
and the two clamped state lines, layout shift in this machine's font and a
wide one, terms, privacy stub) and writes screenshots plus an
`index.md` to `~/.local/share/joedesk-qa/p3` (`JOED_QA_DIR` overrides it).
It uses `BROWSER_PATH`, a Playwright headless shell or Google Chrome:

```bash
npm run test:browser
BROWSER_PATH=/usr/bin/google-chrome node scripts/browser-p3.mjs
```

The gate holds the render budget's CI guard (2.5 × the reference budget,
ADR §9). The budget itself is measured on a reference device (mbp2606 or
mbp2607) with the same workload:

```bash
npm run budget:reference
```

## Run

```bash
node server.mjs
# listens on 0.0.0.0:8080
```

**Docker (local example — bind loopback only):**

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -v joe-board-data:/var/lib/joe-board \
  -v /path/to/push-token:/run/secrets/joe-board-push-token:ro \
  joedesk:26.09.14.17.08
```

## Deploy notes

### Read routes — trusted external OAuth

OAuth remains external. Dynamic reads of data, history, results, state, Fleet
Config and its audit log require the trusted proxy's `X-Auth-Request-User`;
missing/invalid identity receives 401 `auth_required`. The proxy must strip
client identity headers and keep the service private. P6 owns that integration.
Only `/joe/healthz` is the new anonymous health route; `/healthz` and `/readyz`
retain their legacy probe responses. Static UI/assets remain behind external SSO.

`/joe/healthz` reports the actual `release.json` version/scheme, server clock,
contract-set identifier, four feed states/receipt ages and gateway confirmation,
check age and closed reason. Never-received feeds have null age and
`feed_not_received`; unwired Results uses `results_not_wired`. Data/history
without observations return HTTP 503 with that reason, distinct from a missing
route. Health has no money, identifiers, paths or diagnostic text. The historical
`calendar` scheme remains readable; this branch reports its CalVer3 candidate.
Authoritative live adoption still requires the P6b and coordinator gates.

`/joe/state.json` is the protected read model for P3: serverNow, four feeds with
progress metadata, safe data projection and panel states. Anchor serverNow to
the browser's monotonic timer; pass feed metadata and prior cells to the shared
selectors. `valueReceivedAt` is the original retained-cell receipt. Data/history
responses also send `X-Joe-Server-Now`, data generation progress and any closed
feed rejection reason as headers. A rejected push leaves the last good snapshot
and its original receipts available, including to cold clients. Feed-level
rejection reasons live in headers/state; only actual session or KEEP-policy
constraints withhold current values. The server never rewrites producer-owned
API readiness. `contracts/read.mjs` handles SSO redirects, 401/403 and invalid
refreshes with retention. Replayed deliveries show retained/advisory state,
preserve the original age and cannot freshen data or turn healthy cells red.

`/joe/results.json` returns HTTP 503 with the v2 schema identifier,
`results_not_wired` and `X-Joe-Server-Now`. It contains no fabricated executor
sequence, days or trades; there is no results ingress until JOED-20. The P4
board reads it every 30 s in its read worker (shared `acceptRead`, then indexed
once) and shows Results' designed not-wired state until a valid v2 record with
its server `receivedAt` arrives. History stores only observations
and null gaps, never the UI's assumed/interpolated continuity values.

P2 persists `data-state.json` (snapshot plus progress and retained-cell receipts)
and `history-state.json` as independent atomic/fsynced envelopes. Closed rejection
reasons have a separate bounded file. Fleet Config keeps its audited v1 file and
a server-owned `fleet-receipt.json` for last-good/receipt retention. Refreshes of
an unchanged revision never reset its age. Corrupt sequence/retention metadata
or a corrupt/oversized history store fails closed without overwriting either
store or restarting sequences; restore a compatible backup. Producer generation
more than 5 seconds ahead of server receipt is rejected with `clock_ahead`
before snapshot/history writes, so a higher valid sequence can recover normally.
Legacy data/history files are neither migrated nor overwritten automatically;
P6 owns the compatible backup and cutover. History's `sizeBytes` measures its
complete UTF-8 storage envelope; compaction begins at 80% of 8 MiB, preserves
endpoints/extrema/gap edges/per-desk basis transitions, and prunes its 14-day
window by server time. Successful compaction reports the advisory
`history_compacted` state until the compacted range (`compactedThrough`) leaves
retention; it does not mark history broken. Actual `history_size_limit` and
`history_write_failed` alarms remain broken until a successful history write
resolves them; deduplication alone cannot clear one. A snapshot rename followed
by a directory-sync failure still records its history point before replying.

The UI gates non-canonical hosts client-side (privacy stub). That is UX only, not a network security boundary.

### Write routes

`POST /joe/inbox` accepts machine pushes with `Authorization: Bearer <token>`. Configure the token via the secret file or `JOE_INBOX_TOKEN`. No browser session or OAuth on this route.

`POST /joe/fleet-config/propagate` accepts the flip plane's JSON `{baseRev, config}` envelope. It requires same-origin browser headers plus the proxy-supplied `X-Auth-Request-User` identity and **must remain behind the same trusted Zitadel SSO reverse proxy as `/joe/`**. The proxy must strip any client-supplied copy of that header before oauth2-proxy supplies the authenticated Zitadel identity; never expose this route directly. The server validates the strict paper-only v1 schema, rejects stale revisions, assigns the next `fc-NNNNNN` revision, and atomically renames it into `/var/lib/joe-board/fleet-config.json` with mode `0644`.

Amy and desk processes consume that JSON file directly and reload only when its top-level `rev` changes; they never scrape JoeDesk HTML. `GET /joe/fleet-config.json` exposes the same current document to the authenticated board. The checked-in `public/joe/fleet-config.example.json` is revision `fc-000000` until the first write. Secret slots contain agenix/Janus reference names only.

In the flip plane, start at **Limits** near the top: its quota, desk, and cadence cards jump to the matching editor. Edit the plainly labeled fields, open **Diff**, review the named before/after values with their units, tick the review box, then **Confirm changes** and **Propagate**. Quota reserves and amber behavior, desk limits and KEEP symbols, routine names and desk wake windows are form controls. Green and red behavior stay fixed by the v1 schema. The result remains in the edit strip after the toast closes. Propagate changes paper policy data; external schedulers must separately adopt revision polling before these settings affect their routines.

For a paper smoke edit through the trusted SSO proxy, use an existing authenticated cookie jar. Set `FLEET_URL` to the JoeDesk origin and `FLEET_COOKIE_JAR` to that jar; do not add an identity header yourself. This changes the current `maxBusyDesks` value by one, writes a new revision, then checks that GET returns that revision and value:

```sh
before=$(curl -fsS --cookie "$FLEET_COOKIE_JAR" "$FLEET_URL/joe/fleet-config.json")
base_rev=$(jq -r '.rev' <<<"$before")
old_limit=$(jq -r '.desks.maxBusyDesks' <<<"$before")
new_limit=$((old_limit == 32 ? 31 : old_limit + 1))
envelope=$(jq -n --arg rev "$base_rev" --argjson config "$(jq --argjson limit "$new_limit" '.desks.maxBusyDesks = $limit' <<<"$before")" '{baseRev: $rev, config: $config}')
written=$(curl -fsS --cookie "$FLEET_COOKIE_JAR" -H 'content-type: application/json' -H "Origin: $FLEET_URL" -H 'Sec-Fetch-Site: same-origin' --data "$envelope" "$FLEET_URL/joe/fleet-config/propagate")
new_rev=$(jq -r '.rev' <<<"$written")
curl -fsS --cookie "$FLEET_COOKIE_JAR" "$FLEET_URL/joe/fleet-config.json" | jq -e --arg rev "$new_rev" --argjson limit "$new_limit" '{rev, maxBusyDesks: .desks.maxBusyDesks} | select(.rev == $rev and .maxBusyDesks == $limit)'
```

Every authenticated propagation outcome is stored in `/var/lib/joe-board/fleet-config-actions.json` with mode `0600` and exposed to the authenticated plane at `GET /joe/fleet-config/actions.json`. Entries contain the timestamp, SSO identity, before/after revisions, approved changed-key names, outcome and a fixed reason code. They never contain before/after values; any attempted secret-slot change is recorded only as `secretSlots.[redacted]`.

### Outside this app

- Deployment secrets (push token file, TLS certs)
- The pusher / producer that maps `book.json` → household snapshot
- Broker, gateway, and HALT machinery

For a reported paper Gateway outage or stopped board updates, use the
[Gateway flap recovery checklist](docs/gateway-flap-recovery.md). JoeDesk shows
the health signal and next action but does not restart the Gateway or pusher.

### Preserved contracts

- Storage: `/var/lib/joe-board/data.json`, `history.json`, `fleet-config.json`, `fleet-config-actions.json`
- Browser `localStorage` keys: `joe-board-theme-v1` (light, dark or system) and `joe-board-observed-events-v1` (desk changes this browser saw). The GridStack layout keys of the old board are left untouched and unread; the rebuilt board has no layout manager or layout storage.
- Fleet Config requires Diff → Confirm before Propagate. Save Preview remains browser-local; Propagate writes only a paper-mode config revision and its durable action record. Secret slots list agenix/Janus capability and path refs only and always show REDACTED; they never display plaintext credentials. HOSTD-52 rotation remains a response hook. See `docs/joe-fleet-config-secrets.md`.
- Gateway light: yellow means the paper connection is unstable or its check-in is late; red means the Gateway reports down. These are health readings, not settings that Fleet Config can fix.
- API paths: `/healthz`, `/readyz`, `/joe/*`, `/joe/fleet-config.json`, `/joe/fleet-config/actions.json`, `/joe/fleet-config/propagate`
- Schemas: `inspr.joe.household.v1`, `inspr.joe.household.history.v1`, `inspr.joe.fleet-config.v1`, `inspr.joe.fleet-config.actions.v1`
- The board is plain ES modules under `public/joe/` plus the pinned shared version bundle; `index.html` pins every module to the release version through an import map, and nothing installs a service worker.

See `docs/joe-data-contract.md` and `docs/joe-history-contract.md`.

### Fleet settings: human path and schema inventory (HOSTD-48)

The rebuilt board (JOED-19) moves this editor into **Settings**, implemented in P5. The propagate API, schema and audit log below are unchanged.

Open **Settings · Fleet Config** on the board, or **Limits, quota & wake times** in the board-settings menu. Desk limits opens first, with risk cap, busy-desk maximum and KEEP ready to edit. Quota behavior, wake times and the Limits home overview are in the same navigation. Each input explains what it changes and where it applies. **Technical · exact keys & saved values** is collapsed until requested; it shows the saved document, while inputs and navigation values show the current preview. Board layout and theme remain browser-local.

| Find it under | Stored v1 definition | Meaning and current boundary |
| --- | --- | --- |
| Desk limits | `desks.maxBusyDesks`, `desks.stage0.capEur`, `desks.keep` | Maximum simultaneous learning desks, Stage-0 paper capital ceiling (not a daily-loss limit), protected symbols. |
| Quota & low-capacity behavior | `quota.grok.reservePct`, `quota.codex.reservePct`, `quota.behavior.{green,amber,red}` | Reserve capacity plus policy for each color. GREEN and RED are schema constants; AMBER may slow or park nonessential work. These are policies, not live quota measurements. |
| Wake times & cadence | `cadence.timeZone`, `usOpenArm`, `deskWatch`, `darwin`, `quotaGovernor`, `wakeWindows` | Vienna-time arming and day/time/desk windows. Routine names are identifiers, not polling intervals. An empty window list does not prove a consumer is asleep. |
| Amy’s check-ins | `amy.routines.{morning,review,close}` | Labels only; v1 has no Amy run-time schedule or last-run evidence. |
| Legacy Mac locations | `mac.shared.{configPath,docsPath}`, `mac.knobs.syncMode` | Historical mirror/docs paths, read-only in this UI; sync mode is fixed to `read_on_revision`. The definition strip reports the actual board source. |
| Tools | `tools.statusSource`, `tools.entries` | Declared tool IDs/labels. Actual board health comes from `/joe/data.json`; a declared tool is not a health check. |
| Secret slots | `secretSlots.{agenix,janus}` | Read-only reference names; secret material stays in the host secret workflow. |

The original flip exposed 20 fields, omitted editable AMBER and wake windows, displayed fixed example prose, and separated explanations from a bottom edit strip. This IA moves the editor next to its explanation, reads summaries from the configuration, and exposes every saved section key in Technical. AMBER and wake-window controls share that human path. Sources is collapsed below the editor and maps each knob to the file actually read, including the starter example. Reserve percentages also have a plain-number example that follows the draft value.

**Where is this defined?** remains above the section navigation and shows the schema ID, saved revision, actual file used by the board, and latest propagation attempt/outcome. `GET /joe/fleet-config.json` reports `X-Joe-Fleet-Source-Path` and `X-Joe-Fleet-Source-Kind` (`example` or `stored`) from the successful file read, including on 304 responses. Thus the untouched starter example is distinguishable from `/var/lib/joe-board/fleet-config.json`. Missing provenance or failed reads are shown as unknown/unavailable, never inferred from the declared Mac path. The action log supplies propagation evidence; `updatedAt` is not treated as a successful propagation. Writing the shared file does not confirm that Amy, Mac or desk consumers reloaded it.
