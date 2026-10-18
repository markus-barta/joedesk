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
CI supplies image/SBOM/provenance digests through the release set below. The
coordinator still owns publication approval, signatures and reviewed downstream
compatibility.

### Publication (v2)

Publish the final candidate by merging `rebuild/v2` into `main` through a
reviewed PR **as a merge commit**, preserving history; do not squash. The CI run
of that exact `main` commit is the validation run. Its `joedesk-release-set`
artifact contains `release-set.json` (`joedesk.release-set.v1`) and
`release-set.json.sha256`. Hand both to OPS for OPS-354 and record them, with the
validation run URL/attempt, in the cutover commit. OPS pins the **full source
SHA**; no registry image or tag is needed. Never pin the moving `rebuild/v2` tip.
An SSH-signed tag `v261016151218.0.0` is optional; only Markus can create it.
The version reservation remains unchanged and does not imply cutover approval.

Every PR and `main` push builds two uncached `linux/amd64` OCI outputs from the
Dockerfile, with `SOURCE_DATE_EPOCH` set to the source commit time and layer
timestamps rewritten. No registry push occurs. The release-set job runs only
after `package`, `browser` and `docker` succeed. It records the platform image,
image index and config digests, and the **in-toto statement blob** digests for
the SPDX SBOM and SLSA v0.2/v1 provenance. These blobs are inside the first OCI
archive in `joedesk-oci-image`. Both artifacts are retained for 90 days; OPS
must preserve them in its durable cutover evidence before expiry.
`reproducible.identical` compares the two platform image manifest digests
(including config/layers), excluding time-varying attestation/index bytes;
a mismatch is recorded without failing CI. The JSON key order is stable;
`generated_at` is informational and never supplies the release version.

Verify a downloaded record from a local checkout containing its source commit:

```sh
shasum -a 256 -c release-set.json.sha256
node scripts/verify-release-set.mjs release-set.json --commit FULL_SOURCE_SHA
```

The verifier reads Git objects at that commit, checking the tree, reservation,
contract revision and complete contract file set, exact `release/contracts.json`
bytes, runtime base and closure pin. It rejects unknown keys and malformed
digests. It does not establish CI authenticity or re-download/verify the OCI
archive: retain the matching run artifacts for artifact inspection. GitHub
artifact signing (`actions/attest-build-provenance`) is deliberately omitted;
this workflow requires only read-only contents permission and no new secrets,
OIDC or attestation write grants. The BuildKit provenance is unsigned evidence;
coordinator signature/review and all producer/OPS/live gates remain separate.

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
   Do not add, strip or rewrite `X-JoeDesk-Origin` at the edge. Protected requests
   with spoofed identity must hit SSO before reaching the app. The exact health router
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
4. The production host gate including `cs0.barta.cm`; only the two exact paths
   `/joe/inbox` and `/joe/inbox/results` use token-only routers without SSO.
   Never use a prefix match; preserve the documented SSO and exact health policy
   on other routes.
5. After the gates and Markus's cutover decision, run
   `node scripts/smoke-release.mjs BASE_JOE_URL VERSION_SCHEME CANONICAL_VERSION`.
   `BASE_JOE_URL` is the public SSO route ending **exactly** in `/joe/`, with no
   credentials, query or fragment (for example `https://board.example.invalid/joe/`).
   It sends no cookies or authorization, follows no redirect, validates the exact health
   allowlist and expected version/schema, requires fresh data/history/config
   and a confirmed gateway. It probes all six reads, `/joe/`,
   `/joe/app.js?v=CANONICAL_VERSION`, and both near-health paths, first anonymously
   and again with well-formed synthetic `X-Auth-Request-User` and `X-Forwarded-User`.
   Every protected probe must lack `X-JoeDesk-Origin` and receive a 30x with a
   nonempty `Location`, or 401/403. The app stamps every response with
   `X-JoeDesk-Origin: app`, including its own 401; a bare app, an exposed UI/asset,
   a broad exemption or a spoof bypass fails. Health must return 200 with that
   app stamp. Health 302 is `auth_required`.
   Exit 0 emits one JSON record with `ok: true`, canonical version/schema, feed
   ages/states, `protectedReads`, `protectedUI` and `spoofedIdentity` all
   `sso-rejected`, `healthException: exact-path`, and Results state. Exit 1 emits
   one value-free stderr reason: `auth_required`, `release_mismatch`,
   `feeds_not_ready`, `protected_read_exposed`, `protected_ui_exposed`,
   `spoofed_identity_exposed`, `sso_not_proven`, `app_origin_not_proven`, or
   `release_smoke_failed` for malformed input/health, transport or other errors.
   Bodies, identities and credentials are never printed. Unwired Results remains explicitly reported;
   this smoke does not substitute for Amy's results sign-off or Tick/Markus's
   signed-in UI verification.
6. Post-deploy, send one signed-in request with a spoofed identity header and
   verify that its Fleet Config audit actor is the authenticated SSO identity.
   cs0's `authResponseHeaders` must replace the client-supplied
   `X-Auth-Request-User` with the SSO result. Use a paper-only edit through the
   trusted proxy, verify the attributed audit entry, and restore the setting.
   This complements the anonymous spoof probes; no live check ran during P6a.

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

`npm run test:results` runs the full P4 Results gate sequentially under **UTC**
and **America/New_York**. `test:browser` includes this guard. CI includes Vienna
too; run the same three-zone check with:

```bash
npm run test:results -- UTC Europe/Vienna America/New_York
# One zone, same P4 suite (including the render budget):
TZ=UTC node scripts/browser-p4.mjs
```

Each child process sets `TZ` for the injected board server and Chrome. The CDP
page also sets its requested zone explicitly, since macOS Chrome may keep the
OS zone despite `TZ`; P4 checks the server, page and dedicated worker zones.
Reports stay separate under `~/.local/share/joedesk-qa/p4/<zone>/index.md`
(`JOED_QA_DIR` overrides the parent; slashes in zone names become hyphens).
Use an approved browser test host; an installed browser guard refusal is a
blocked check and must be handed to the coordinator without bypassing it.

Every P3–P6 inbox push first runs `acceptSnapshot` in Node against the prior
accepted record and the board's receipt clock. Unexpected rejection stops with
the contract rule and path before HTTP or a page wait; rejection scenarios name
their expected status and reason. Partial-day replacements wait for the refresh
and render, including changes to today's reason that leave calendar HTML intact.
Default-line coverage uses a reasonless snapshot accepted while the day was open
and retained into the next day. Reason overflow is measured at the enclosing
note and individual lines: the paragraph deliberately allows the 4 px reason
box overhang within the note's reserved padding.

P3–P6 share browser teardown: request a graceful close, wait for process exit,
then remove the profile. A stuck browser gets SIGTERM and then SIGKILL with
bounded exit waits; if it still has not exited, cleanup fails and retains the
profile. CI scratch removal retries filesystem contention up to five times
(100 ms delay); workstation scratch still goes to Trash.

Vienna day keys always come from the explicit `Europe/Vienna` zone in
`contracts/vienna-date.mjs` and `time.mjs`; Results uses that same zone for its
instant-to-day index. UTC date getters serve calendar arithmetic only. The DST
fixture includes both 02:30s and the exact fallback boundary on **25 Oct 2026**;
Node tests also check both midnights of that 25-hour day. Full daily summaries
reconcile the five closes on 25 Oct in every host zone.

`createFeed().refresh()` waits for worker acceptance, including unchanged
replies, and overlapping worker polls share that pending read. A fast state
read can advance the clock and display Stale before a Results worker answers;
dispatch alone must not count as a completed refresh. Otherwise the next
refresh after a rejected push can be skipped while the previous read is busy.
The worker regression holds replies explicitly to exercise this ordering,
rejection retention and fallback completion without timing sleeps. P4 keeps
the rejection assertion and its existing timeout.

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
`feed_not_received`, including Results before its first accepted push. Data/history
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

`/joe/results.json` serves the last accepted results v2 snapshot with its
original server receipt and any persisted rejection reason in headers. Before
the first accepted push it returns 503 `feed_not_received` with the v2 schema
identifier and server clock. The P4 board reads it every 30 s in its read
worker (shared `acceptRead`, then indexed once) and uses its existing
live/stale/rejected/unavailable states. History stores only observations
and null gaps, never the UI's assumed/interpolated continuity values.

P2 persists `data-state.json` (snapshot plus progress and retained-cell receipts),
`history-state.json` and `results-state.json` as independent atomic/fsynced
envelopes (mode 0600). Results snapshots, receipts, generation progress and
rejection reasons survive restarts; corrupt Results storage stays untouched
and fails closed independently of data/history. Closed rejection
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

### Results ingress (for the producer)

`POST /joe/inbox/results` uses the **same** `Authorization: Bearer <token>` as
`POST /joe/inbox`: `/run/secrets/joe-board-push-token`, with the existing
`JOE_INBOX_TOKEN` fallback. No new credential or variable; no browser/SSO identity
is needed for this machine route. Keep the protected read behind trusted SSO.

OPS must add a **second token-only edge router for the exact path
`/joe/inbox/results`**, without SSO, next to the existing exact `/joe/inbox`
router. Never use a prefix match: every other `/joe/` route keeps its existing
SSO policy (including the separately documented exact health exception).
This repository documents that edge prerequisite; it does not configure it.

Send exactly one JSON `inspr.joe.household.results.v2` snapshot as the body,
without an envelope, `receivedAt` or `missingDays` (both server-owned).
Validate it with
`validateContract('results', snapshot, {stage: 'ingress'})` from the pinned
`contracts/` package. To check receipt-dependent rules locally, also pass the
expected server `receivedAt` as a validation option; `acceptSnapshot` always
supplies the actual trusted receipt. The UTF-8 request limit is
`CONTRACTS.limits.results`
(8,388,608 bytes); the served snapshot, including the server's `receivedAt`
and diagnostics,
must also fit that contract limit. Money, including gross, stays in exact decimal
strings (up to eight fractional digits) through validation, storage and reads.
Never round before summing; only the board display rounds to cents. Each trade's
`netEur` equals its exact `grossEur` minus `feesEur`.

For each fully covered Vienna date in `days[]`, **every trade closed that day**
must be covered by its desk summary. A desk with closed trades cannot be omitted:
that returns 422 with path `$.days[i].desks.id` and rule `dayDeskRequired`.
Desks without closed trades may be omitted. For each included desk,
`days[i].desks[id].trades` must equal the count of that desk's `trades[]` whose
`closedAt` falls on that date in `Europe/Vienna`; `realisedNet` and `fees` must
equal their exact `netEur` and `feesEur` sums. A zero-trade day requires zero
totals; null totals do not reconcile. A mismatch returns 422 with the per-day
path (`$.days[i].desks.id.trades`, `.realisedNet` or `.fees`) and rule
(`dayTradeCount`, `dayNetSum` or `dayFeeSum`), retaining the last good snapshot.
Trades on dates with no `days[]` entry (for example today before daily close)
are skipped by this cross-check; their schema and trade checks still apply.
Day-level `coverage` is optional: `"full"` (the default when omitted) or
`"partial"`. Use `"partial"` when the day's record may be incomplete, including
a windowed trade record, capture gaps, unattributed activity, stale currency
conversion or a broker-backstop mismatch. Its day/trade cross-check is skipped;
schema and trade checks still apply. Unknown summary `realisedNet` and `fees`
may be `null`. An unattributed-only day can be `{date, desks: {}, coverage:
"partial", partialReasons: ["unattributed_activity"]}` with no trades; it is
not a confirmed zero-trade day. A closed partial day requires a reason. The
open Vienna day may omit reasons when there is no real cause beyond the day
still being open.
KEEP holdings **SXR8 and TSLA are excluded from both `trades[]` and all `days[]`
totals**, including partial days. Results derives trade P&L from `trades[]`;
day summaries are validated, never substituted for the trade record.

On acceptance, the server computes `missingDays`: sorted unique **past Vienna
dates** with closed trades but no `days[]` entry. The protected Results read
includes this server-owned list when nonempty (omitted means no missing-summary
warnings).
This is accepted with **200**, never a rejection for a missing daily entry.
The current open Vienna date and future dates are skipped; a reported
`coverage: "partial"` day is present and does not warn as missing. Dates use
explicit `Europe/Vienna` conversion, including the 25-hour DST day, against
the server's receipt date. Diagnostics stay with that accepted snapshot across reads,
rejections and restart; the next accepted push recomputes them.
The affected calendar day and its trade summary use the existing **Stale**
warning marker, without moving the layout or changing the trade amounts.
The day panel and phone sheet prefix the retained trade count and net amount
with **Stale** and show **Daily summary missing** in the day note.
Desk filtering warns only where the selected desks have trades on that date.

Results marks **closed past Vienna dates** with `coverage: "partial"` as
**Partial**, using the existing half-circle warning SVG and calendar warning
slot. On tinted cells the icon inherits the cell's ink, as Stale does; on a
neutral no-trade Partial it uses the warning token. Desktop cells replace the
note with **Partial** in full ink; phones show the icon.
The cell's accessible label includes “Partial: this day's record is incomplete”
and the reason. The day panel and phone sheet prefix the exact visible trade
count and amount with **Partial**, label known amounts **so far**, and explain
by default on the existing day-note line:
“Part of this day's activity couldn't be confirmed, so its result may be
incomplete.” A partial day with no visible trades shows a muted **—** on the
neutral calendar surface, and **Partial · record incomplete** in the day
summary; it never claims €0, “no trades” or “sat out”. This day-wide warning
also applies when a desk filter has no visible trades. **Stale** takes priority
if both diagnostics occur. From Vienna day D+2, a date D still partial shows
**Stale**, retaining the partial reason and “so far” on known amounts. Its
accessible explanation is “Stale: still incomplete;” plus the reason. Escalation
uses date-key arithmetic, including across DST and month/year boundaries.
The open Vienna date has no marker; its known partial amount still says **so far**.
Its reason note appears only for explicit producer reasons, never the generic
default sentence or a lead without reasons. Narrow day summaries drop the trade count
before the Partial/Stale label, exact amount or “so far”; unknown amounts never
say “so far”. Calendar amounts never say “so far”.
The server preserves producer coverage and nullable summaries on protected
reads and restart; both the read worker and fallback retain partial dates.
All amounts and totals still come from the existing exact trade calculations.
The desktop calendar month summary appends a warning segment, **incl. N partial
days**, counting every closed partial date, including dates escalated to Stale.
Today, future dates and a missing-summary Stale without partial coverage do not
count. With no trades and a counted partial date it says
**No trades recorded this month ◑ incl. 1 partial day**. If room is tight,
“over N trading days” shortens to “in N days”. This line is hidden on phones;
the record-status line, period tiles and week column do not carry the hint.

The hero's stated result (**Up/Down € …**, or **Flat**) and empty-period
sentence append **incl. N partial days** for the selected period, using the
same count helper as the calendar month line. Unavailable, basis-change and
unknown-result explanations keep their full stop and carry no hero hint.
Day, Week, Month, This year and All count closed partial-coverage dates across
their whole range, including Stale-escalated dates and days without trades.
Today, future dates and missing-summary Stale without partial coverage never
count. Desk filters keep the same count because coverage belongs to the whole
day. One warning SVG follows the sentence; tiles and By-desk rows stay plain.
With a hint, the sentence drops its final full stop. The warning SVG itself
separates the hint from the sentence, with one plain breaking space before the
icon, on both the hero and calendar month line. The space collapses at a wrap,
so the icon starts flush with the sentence's first line. The icon and words stay
one nowrap unit. Without a hint the full
stop stays. An empty period (no closed trades and a known, flat result) with
counted partial days says **No trades recorded**, as on the calendar month
line; without them it says **No trades**. Open-position gains or losses keep
their **Up/Down € …** sentence and its hint; the calendar month line keeps its
own coverage hint even when the hero cannot state a result.
Phones at ≤ 700 px keep a two-line sentence reserve inside a fixed 301 px left
column; its content needs 300.75 px with three lines, leaving slack for a long
sentence and hint without moving the split or benchmark. The browser assertions
require the longest eligible empty wording, with **Paper results start on
30 Sep 2026** and the older **week of 21 Sep**, to fit three lines at 360/390
without moving the split rows, benchmark, chart, legend or tiles. Desktop keeps
the original 340 px left column (280 px at ≤ 1180 px); hinted result and empty
sentences may use three lines at 768/1024. At 1440 they keep two lines where
they fit, otherwise three, with the same exact zero-movement requirement and
the hint unbroken.
The dedicated `period-hint` browser scenario checks zero movement of tiles and
hero children at 360/390/768/1024/1440, the desktop line limits, warning-icon contrast
and clipping. It also forbids middle dots in both lines and splitting either
hint unit, while preserving the calendar geometry. It writes full-hero crops,
including the unchanged chart, at
1440/1024/768/390 in both themes, plus 390 without the hint, under `JOED_QA_DIR`
for the visual check. At 1024 the hint must wrap onto line 2, whose left edge
matches line 1 within 0.5 px; `1024-light-results-period-hint-hero.png` is the
visual-check crop. The `partial-days` scenario adds cropped 1440 px month
lines in both themes (`1440-*-results-partial-month-line.png`) and checks that
the month summary keeps its long-to-short wording when space is tight.

On phones, Results calendar amounts use compact forms such as `1`, `4,1`,
`13`, `1k` and `1,2k`, rounded once from exact decimals, half away from zero.
A trailing `,0` is omitted. Phone day cells use the sign and tint for direction,
with no arrow; scaled amounts use 10 px text. Phone cells use 3 px horizontal
padding, with the missing-day warning aligned at the same right offset.
An amount that rounds to zero shows an unsigned `0` and keeps its day tint;
an exactly zero day stays flat.
The cell's accessible label and the day sheet retain the exact amount.
Desktop calendar amounts and the week column keep their existing formatting.
The focused `phone-calendar` browser scenario measures the full signed form
set at 360/390 in light/dark against fractional amount-box widths, also
requiring `scrollWidth ≤ clientWidth`. Signed `999k` probes are INFO only;
the formatter emits `1M` for € 999.000. Its five calendar crops show October's
±€ 1.200.000, gain, loss, zero, k and missing-day warning, under `JOED_QA_DIR`.
The generated `index.md` and CI log retain the measurement table.

Day-detail trade amounts keep their full value on one right-aligned line.
Their columns grow to fit, with the original 92 px minimum for short amounts
on desktop. Names keep at least 120 px and wrap between whole words; only
an individual token wider than the column may break internally. English
company letter runs of eight or more contain deterministic soft hyphens,
with at least three source letters before, between and after opportunities.
`hyphens: manual` draws a hyphen only when the oversized word breaks, without
a browser dictionary; `overflow-wrap: anywhere` remains the final fallback
if even a fragment cannot fit. Symbols, numbers and meta text receive no soft
hyphens, and text comparisons strip U+00AD to preserve the recorded copy.
Copying selected text from the day panel or phone sheet removes U+00AD and
maps U+00A0 to normal spaces, preserving every other character and line break.
Meta units (desk, side/quantity, close time and holding duration) stay together and wrap
between units. Each middle dot is a nowrap suffix of the preceding unit;
after layout and resize, line-ending dots use `visibility: hidden`, retaining
their width so lines stay stable and the next line starts flush.
Entry/exit prices wrap first, then the entire panel uses the 11 px small token
if any row needs it, then fees may wrap. Wider panels recover their regular
price size together. Phone amount
columns size to their content, while prices and fees span the second row
beneath the company and amount columns.
The focused `trade-amount` browser scenario checks −€ 100.000,12,
+€ 999.999,99 and −€ 1.000.000,12 beside USD price pairs with up to eight decimals at
1440/1024/390/360 in both themes, through the real inbox and worker/fallback.
It asserts exact amount, price and fee text, no clipping or row overflow,
common right edges, desktop-only 92 px sizing, phone content sizing, wrapping
of the eight-decimal pair at 1440, and exactly 0 px outer movement on open/close.
Range rectangles check every name/meta word, atomic meta units, the 120 px
desktop name floor, full panel-header visibility and the price/fee yield order.
Per-character Range measurements exclude U+00AD, require every broken-word
line to contain at least three source characters, and require a positive-width
soft-hyphen glyph at every break. The 360 million row must exercise a break;
desktop fixture words remain unbroken.
Synthetic copy events at 360/1440 in both themes must copy the full company
name without U+00AD and the visible amount with normal spaces from the sheet
and panel respectively.
Visible glyph checks reject a middle dot at either end of every meta line;
resize and repeated-fit probes verify flush starts, reserved suffix widths,
stable wrapping and uniform panel price sizing, including a roomy peer row.
Widest-row crops go to `JOED_QA_DIR` as
`*-results-trade-amount-{panel,sheet}-crop.png` for the visual check.
Whole-panel crops at 1440/1024 in both themes add
`*-results-trade-amount-panel-full-crop.png` with a 16 px margin beyond the
panel's right edge for clipping and cross-row alignment review. Captures
temporarily expand the list's height at its tested content width and reset
its scroll to the top, then restore the original layout. All four rows,
including every symbol/name first line, must fit inside the list and panel;
bottom-scrolling to the million/short rows had clipped row 1's symbol line.
Symbol checks compare the name prefix with the recorded symbol, require a
non-zero visible symbol box, and verify list/panel containment in capture
state at all four widths and both themes.
The full 360 px sheet in each theme is
`360-*-results-trade-amount-sheet-full-crop.png`, using the same temporary
height expansion to show every row's first line.

**Producer contract pin — manifest revision 6.** Compared with revision 2,
revision 3 keeps the `inspr.joe.household.results.v2` schema identifier and adds
optional day-level `coverage` (`"full"` by default, or `"partial"`), the exact
day/trade cross-check across every desk described above, and explicit KEEP
exclusion from both trade records and day totals. It also removes
`results_not_wired` from the closed reason enum. Revision 4 adds the optional
server-owned `missingDays` read diagnostic and forbids producer-supplied copies.
Revision 5 adds optional `days[].partialReasons` and `unattributedCount` without
changing the schema ID. Revision 6 requires at least one reason for every
**closed partial Vienna day** (date before the server receipt's Vienna date).
The open day may omit `partialReasons` unless a real cause exists, such as
`fx_missing`, in which case emit at least one. `capture_gap` is reserved for a
real mid-day tracking start; an unfinished day alone is not a capture gap.
The enum and canonical order stay unchanged: `capture_gap`, `history_gap`,
`broker_trade_count_mismatch`, `broker_realised_pnl_mismatch`,
`unattributed_activity`, `avg_cost_mismatch`, `fx_disabled`, `fx_missing`,
`broker_evidence_missing`. `avg_cost_mismatch` is reserved: accepted and rendered,
not yet emitted. Reasons must be unique and nonempty and are allowed only with
`coverage: "partial"`. `unattributedCount` is a positive integer (minimum 1), omitted when
unknown, and allowed only with `unattributed_activity`. Invalid combinations or
order return per-day 422 errors. A closed partial day without reasons returns
422 at `$.days[i].partialReasons` with rule `partialReasonsRequired`, retaining
the last good snapshot. Closure uses the same DST-safe `viennaDay` helper and
server receipt as `missingDays`, never the producer or host date. Served
validation uses the persisted receipt, so an accepted open day remains readable
after midnight. Omit `partialReasons` when there is no cause; an explicit empty
array still fails `minItems`.
`{date, desks: {}, coverage: "partial", partialReasons: ["history_gap"]}` is valid;
it shows **—** under every desk filter, adds nothing to sums, and counts as one
closed partial day in the month hint.

Known reasons replace the default note with **Result may be incomplete.** and
one exact explanation per reason in canonical order (see the data contract).
With `fx_disabled`, the board omits `fx_missing`. Unknown codes never appear as
raw text: known codes still render; when none remain, closed days use the default
sentence and today has no reason note. Today with `fx_missing` shows
**No EUR exchange rate was recorded for this day.**
The cell's accessible reason is the first short label plus **, and N more**.
Desktop panels show all reasons. Phone sheets show two reason sentences, then a
44 px **+N more** button on its own row, left-aligned with the text, named
**Show N more reasons** (singular **Show 1 more reason**). The note's text column
and its reason and positions blocks always fill the width available beside the
info icon, with or without the button. Activation removes the button and focuses
the first revealed reason (`tabindex="-1"`) in a polite live region. Its keyboard
focus ring stays inset within that line, at least 2 px clear of its first glyph
and clear of neighbouring reasons. Every reason has 4 px inline padding and
−4 px inline margins in both states, keeping its text aligned with the lead;
the note reserves 4 px at its inline end to contain the overhang without
horizontal overflow. Reopening starts collapsed. The sheet reserves its full
content height, capped at 80vh;
collapsed spare room sits at the bottom, and revealing reasons changes neither
its top edge nor height nor the position or width of already visible reason lines.
Short days have short sheets. A desk filter adds **Applies to the whole day;
this desk may be unaffected.** after the reason or default sentence and before
any “opened …, is still open” position sentences. Today gets desk scope only with
explicit reasons. Position sentences always occupy their own paragraph, 8 px
after the complete reason/desk block in both the panel and sheet. The sheet's
reserved expanded height includes this gap. Count copy
uses “1 trade couldn't be matched to a desk.” or “N trades couldn't be matched
to a desk.”, with U+00A0 between the number and unit. An empty selected desk on
today, including an empty-desk row, reads **No trades so far**, without Partial
or “record incomplete”.

JOED-20 producers must re-vendor the complete self-contained `contracts/`
directory, including `vienna-date.mjs`, and re-pin to `release/contracts.json`'s
`contract_set_sha256`; an earlier digest does not cover revision-7 acceptance
and reads. The release manifest's pusher/executor requirements carry that
same digest. This remains a coordinated cutover candidate, pending
producer rehearsal and sign-off.

Contract-set revision 7 keeps every revision-6 payload valid and the data ID
`inspr.joe.household.v2`. The optional executor reason `results_capture_failed`
means degraded health: results capture is failing and trading continues. Settings
shows the reason in yellow and the header reads “Degraded”, after every
existing data warning. A degraded executor without a reason stays “Degraded”
in Settings; the board does not infer capture failure. The `ledger_size_limit`
reason is red regardless of executor status: the header reads “No new orders”,
with “trade record is full — new orders refused”. The emergency stop keeps
precedence, including an executor/broker disagreement halt.

Optional `safety.executor.ledgerBytes` (integer ≥ 0) and `ledgerCapBytes`
(integer ≥ 1) belong to paper executor 8470. A cap requires a byte count;
over-cap reports remain valid. Settings scales decimal MB/GB/TB by 1,000
(1 MB = 1,000,000 bytes), using one decimal with a comma and integer half-even
rounding. Rounding to 1000,0 promotes to the next unit: 999,950,000 bytes reads
1,0 GB. The reserve uses 999,9 TB per value and the longest flag tail; larger
values remain correct in TB and may wrap. A count
without a cap shows only its size; neither field means no ledger text. The title
and accessible name retain exact byte counts. Settings health text reserves its
space so state changes do not move later sections within that reserve. The header
keeps its pre-JOED-44 layout and 16 px phone inset, without a sizing reserve or a
forced line break. The two short labels have full titles and accessible names:
“Executor degraded: results capture failing, trading continues” and
“Trade record is full: new orders refused”. PR CI's P5
`executor` checks cover all three degraded wire combinations, recovery and ledger
rounding at 1440/1024/390/360 in both themes, with executor-row and header crops.
It records Chrome's actual rendered font, checks every header label for wrapping
and clipping, measures exact 0 px movement outside the intrinsic pill within the
same page and broker state, and compares every board-health sentence to its
reserve. Node tests compare the six existing header labels (including Loading)
and every broker word against a frozen c1c71a1 renderer fixture; tests need no
Git history. Browser verification and the coordinator's gate remain required.

Re-send at least every 30 s with a strictly higher `seq` and non-regressing
`generatedAt`. Generation may be at most 5 s ahead of the server clock; server
receipt time may not regress. Only accepted pushes advance the receipt. The
shared selector marks Results stale at 60 s without a new acceptance; repeated
generation also becomes `producer_frozen` at 60 s. Exact retries return 422
without changing stores, freshness or an existing rejection. Other rejections,
except the midnight-straddle case below,
persist their closed reason and keep the last good record and its original age.
Stale Results stays visible, labelled **Stale** with its last-good age.

Once until the next accepted Results push, a midnight-straddle 422 leaves the
feed reason and rejection file unchanged: every validation error must be
`partialReasonsRequired` for the generated Vienna day, receipt must be on the
next Vienna calendar day, and the positive generation-to-receipt interval must
be at most five minutes. The response stays unchanged and the server logs the
non-fault event `rollover_resend_pending` with the instants and failing dates.
A second qualifying rejection is stored normally. The flag is in memory and
restart re-arms it; a missing resend surfaces through normal staleness at 60 s.

| Response | Meaning |
| --- | --- |
| 200 | `{ok:true,status:200,reason:null,receivedAt}` — accepted and persisted. |
| 422 | Rejected snapshot; closed `reason` and at most 20 `errors` containing only `{path,rule}`. |
| 401 | `auth_required` — missing/incorrect Bearer token. |
| 413 | `contract_invalid` — body exceeds the request limit. |
| 400 | `contract_invalid` — malformed JSON/body. |
| 405 | Method not allowed — this ingress accepts POST only. |
| 503 | `auth_required` if the shared token is unavailable; `contract_invalid` for unreadable/corrupt Results storage; `refresh_failed` if snapshot/rejection persistence fails. |

Persistence failures return 503 `refresh_failed` here; the existing data inbox
still returns 500 for its snapshot save failure.

`GET /joe/results.json` returns the last accepted snapshot (200), including
`receivedAt`, with `X-Joe-Received-At`, `X-Joe-Server-Now`,
`X-Joe-Generated-Advanced-At` and, when present, `X-Joe-Feed-Reason`. No snapshot
means 503 with the closed reason (`feed_not_received` before any push). Reads
and rejected pushes never refresh receipts. `/joe/state.json` carries Results
metadata only; the full record stays on its worker read path.

### Fleet Config propagation

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
