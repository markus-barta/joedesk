# JoeDesk

Standalone Joe household paper-trading desk: static `/joe/` UI plus a small Node inbox server. Paper projection only — no broker access, no order placement.

**Candidate version:** `261026232616.0.0` (`inspr-calver-3`, stable sequence 34), reserved once at `2026-10-26T23:26:16Z` for follow-up review fixes ([JOED-93](https://aeon.barta.cm/p/JOED/JOED-93), release [JOED-97](https://aeon.barta.cm/p/JOED/JOED-97)). `release.json` is authoritative for this candidate's builds; package, UI and `/joe/healthz` report that running version. This candidate has not been published or deployed.

**Last deployed release:** `inspr-calver-3` / `261026070713.0.0` / sequence 33,
published on `main` at `e96ff9a55c8809045c5e5d3491796579669a3531` under JOED-90,
live on csb0 since `2026-10-26T20:06:06Z` (JOED-90). `previous_release` and
`last_deployed_release` both record that release. This history does not claim
adoption for sequence 34. Sequence 32 (`261025221940.0.0`) was previously deployed
at `2026-10-26T01:13:15Z` (JOED-87). Sequence 31 (`261025144826.0.0`) was previously deployed
at `2026-10-25T21:22:26Z` (JOED-84). Sequence 30 (`261023155418.0.0`) was previously deployed
at `2026-10-24T03:46:42Z` (JOED-78). Sequence 29 (`261023100632.0.0`) was previously deployed
at `2026-10-23T14:53:28Z` (JOED-75). Sequence 28 (`261021113113.0.0`) was previously deployed
at `2026-10-21T15:22:58Z` (JOED-60). Sequence 27 (`261021083537.0.0`) was previously deployed
and has been live on csb0 since `2026-10-21T11:22:48Z` (JOED-59). Sequence 26
(`261021015923.0.0`) was previously deployed at `2026-10-21T08:15Z` (OPS-354
attempt 3), with the documented smoke variant on JOED-59.

The previous coordinate `261019102825.0.0` (stable sequence 25, rev 9) was
published on `main` at `d36b5295295a6901e36fdf2dc0d64353ddf88d0e`; JOED-50
records its verified release set. It was **never deployed**: the 2026-10-21
cut-over aborted in phase 1 (`migrate-v2`) before the swap. It is superseded
before deployment.

The earlier coordinate `261016151218.0.0` (stable sequence 24, rev 7) was
published on `main` at `dafe7909af04ba5ded3c4b55504ea10970e07e4d`; JOED-41
records its verified release set. It was also **never deployed**. Both
publications' immutable artifacts and the legacy-to-calendar migration
anchor remain history. `release/preparation.json` distinguishes the
`previous_release` from `last_deployed_release`. About lists the current build,
deployed sequences 33, 32, 31, 30, 29, 28, 27 and 26, then legacy history; neither aborted publication is a deployed entry.
Never reseal or republish `261016151218.0.0` or `261019102825.0.0` with new bytes.

## P6a release preparation (JOED-26)

This branch carries paper-only preparation from `rebuild/v2`. It is **not ready for
cutover**. The sequence-34 candidate has not been published. The candidate
reservation and unchanged legacy anchor live in `release/preparation.json`;
published artifacts, historical tags and legacy history are preserved. The old CalVer2 proposal JOED-13 is
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
`node scripts/check-release.mjs --require-adoption` fails until a matching
adoption record captures the coordinator's immutable-publication and live gates.

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
An SSH-signed tag `v261026232616.0.0` is optional; only Markus can create it.
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

### Recording adoption

JOED writes `adoption/<active-version>.json` only after OPS's live checks and
the UI look by Markus or his recorded delegate. Use a normal reviewed PR to
`rebuild/v2`. The record is outside the runtime closure and Docker COPY set: recording adoption requires no image
change, rebuild, new release coordinate or change to published artifacts. Keep
the original main merge, immutable release set and image digest. Run this from
a checkout containing that merge and its descendants, not inside the image.

The strict `joedesk.adoption.v1` validator in `scripts/check-adoption.mjs` requires
these fields (unknown keys at any level fail):

- `schema`, `version`, `version_scheme`, `release_channel`, `release_sequence`;
  the four coordinates must match `release.json` and the reservation.
- `source: { commit, tree }` with full main-merge Git SHAs;
  `release_set_sha256`, `image_digest`, `contract_set_sha256`, and
  `validation_run_id` (a positive decimal string). Digests are lowercase SHA256;
  `image_digest` includes `sha256:`. The contract digest matches `release/contracts.json`.
- `decisions`: at least one distinct Desk question UUID.
- `deployment: { deployed_at, operator_ticket, rollback_reference }`: UTC time,
  an operator ticket key (such as `OPS-354`), and a value-free procedure/evidence reference identifying
  the retained immutable artifact and compatible backup for rollback.
- `live_checks`: exactly `joed_live_check`, `ops_t76_live`, `smoke_release`, and
  `spoof_check`, each `{ status: "pass", checked_at }`.
- `markus_ui_look`: exactly one of `{ status: "confirmed", checked_at }` for
  Markus's own look, or `{ status: "delegated", checked_at, performed_by, delegation }`
  for a completed delegated look. `performed_by` must match `/^[A-Z][A-Z0-9-]{1,31}$/`
  (such as `"JOED"`); `delegation` is a non-empty string of at most 500 characters
  naming where Markus's delegation is recorded (such as `"JOED-42 comment 2026-10-20:
  Markus delegated the post-switch look to JOED"`). Use `delegated` only when
  Markus's delegation is recorded on the ticket. Keep the field name and
  `joedesk.adoption.v1` schema; existing confirmed records stay valid.
- `adopted_at`.

All times must be real UTC instants (`YYYY-MM-DDThh:mm:ss[.sss]Z`). Keep records
value-free: no secrets, credential-bearing hostnames, IPs, account data or money.
Verify the retained release-set bytes and committed source metadata as well:

```sh
node scripts/check-release.mjs --require-adoption --release-set /path/to/release-set.json
```

Without `--release-set`, the same command verifies the record, active coordinates,
contracts and local Git source/tree/ancestry. With it, the shared release-set
verifier also binds the exact manifest SHA256, commit, image and validation run.
Success reports `adopted` and `authoritative: true`; normal checks retain their
candidate output. Record the AGENTS-VERSIONING adoption outcome on the owning
ticket: the presentation pin was reviewed and unchanged. Preserve previous
records and releases; rollback selects the recorded prior immutable artifact
and matching backup, recording a new deployment event.

### Offline data preparation and rollback

Mutating commands in `scripts/prepare-data.mjs` require explicit `--offline`,
source and **new** destination paths. OPS must stop writers first. Backups copy only the known
board data/config/audit files, retain exact bytes, use directory mode 0700 and
file mode 0600, and record sizes/SHA256 in `backup-manifest.json`. Unknown files,
symlinks, oversized input, incomplete backups and existing destinations fail
closed; nothing is deleted or overwritten.

The command forms are:

```sh
node scripts/prepare-data.mjs check-fleet V1_STORE_OR_BACKUP
node scripts/prepare-data.mjs backup --offline SOURCE NEW_BACKUP v1
node scripts/prepare-data.mjs verify --offline BACKUP
node scripts/prepare-data.mjs migrate-v2 --offline V1_BACKUP NEW_V2_STORE V2_SNAPSHOT UTC_RECEIPT
node scripts/prepare-data.mjs restore --offline BACKUP NEW_RESTORE v1
```

Before stopping writers, OPS can run the read-only `check-fleet` preflight on
the live v1 store or a verified v1 backup. It reports `fleet ok`,
`fleet normalizable (keep: +SXR8 +TSLA)` (only missing symbols are listed), or
`fleet invalid: <path/rule list>`. A second line reports `actions ok` or
`actions invalid`, checking the action log's JSON, schema and ability to accept
the normalization row under the same ring rule as migration. These are codes
only, never log values. It writes nothing and needs no `--offline`; either
invalid result exits 1, while valid/normalizable configurations with valid
action logs exit 0. An absent action log is valid and stays absent.
A backup must also pass its manifest/digest checks. This is a Fleet Config
preflight; the stopped-writer backup and full migration checks still apply.

Migration accepts a real, validated v2 producer snapshot and an explicit UTC
receipt (ISO form with milliseconds). It creates a separate v2 store. A v1
Fleet Config with a valid symbol array can lack the v2 policy KEEP symbols:
migration appends missing `SXR8`, then `TSLA`, keeping existing entries and
their order. No duplicates or other invalid fields are repaired. The normalized
config must pass the unchanged contract (contract set revision 9); any remaining
violation fails closed as `migration_fleet_invalid`, with value-free path/rule
detail. The CLI prints specific error codes, never payload values or paths.

Only a changed config advances `rev` using the board's `withNextFleetRevision`
rule (`fc-NNNNNN` plus one, refusing exhaustion) and sets `updatedAt` to the
migration receipt. It appends exactly one valid action to
`fleet-config-actions.json`: actor `migration`, `changedKeys: ["desks.keep"]`,
the old/new revisions, receipt time, outcome `success`, reason `propagated`.
The audit schema has no free-text summary field. Normalization follows the
board's bounded ring of the last 200 actions, dropping only the oldest entries
needed to fit the new row; retained entries, including pending/failed actions,
stay in order. The verified v1 backup keeps the original log bytes unchanged,
so migration loses no history. A full valid log never blocks normalization;
bad JSON, schema or entries still fail closed as `migration_fleet_actions_invalid`.
An absent audit is created only when normalization changes the config. Already
compliant config and audit files retain their exact bytes.
The board applies the same normalization when loading a stored v1 config in an
otherwise v2 store, with an audit-first pending entry finalized after the config
write. Before appending, it searches from the end for the latest `migration`
row for the stored revision with outcome `pending` or `failure`, reusing that
row's ID when found. A config write failure records `failure`/`store_failed`
with the unchanged revision, best effort, then fails the read. Repeated failing
reads do not grow the log. Recovery finalizes the same row as
`success`/`propagated`, with the new revision and this attempt's `updatedAt` as
its receipt. Subsequent loads/restarts add no actions or revisions; submitted
settings still require the strict contract.

Migration establishes durable sequence/receipt state through the real server
acceptance path. Legacy money/history cannot prove the v2
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

### Private preview captures for OPS (JOED-53, JOED-54)

Run from the source checkout against the board on an authorized **private
host**, through its trusted authenticated proxy or an operator SSH tunnel to
the board container's port. The CLI sends `x-auth-request-user` only with an
explicit `--actor` and a loopback `--base-url` (`127.0.0.1`, `::1` or
`localhost`), and only to that base origin, including dedicated workers.
Use `--actor joedesk-qa` for the tunnel so the Fleet Config audit never names
a human. Actor names must match `/^[a-z][a-z0-9-]{2,39}$/`; other hosts are
refused before browser launch or output writes. Keep the producer stopped for
the staged snapshot check. Chrome/Chromium and Node 22+ must be available;
`BROWSER_PATH` can select the browser. Do not launch a browser on the Mac
during the daytime restriction.

```sh
capture_dir=$(mktemp -d)
chmod 0700 "$capture_dir"
node scripts/preview-capture.mjs --base-url http://127.0.0.1:PORT/joe/ --out "$capture_dir" --actor joedesk-qa
```

Replace `PORT` with the operator tunnel's local port. Omit `--actor` when using
the trusted authenticated proxy. With `--actor`, capture is **read-only by
construction**: every method except GET/HEAD is failed by CDP Fetch before it
reaches the server, counted as `writeBlocked`, and fails the run (exit 1).
Without `--actor`, identity and method handling stay unchanged. Defaults are
`--widths 1440,390 --themes light,dark --screens desk,positions,settings,results`.
Widths are unique integers from 320 to 3840; screens also accept `history`.
Positions is a crop of Desk's `#positions`. Each selected combination writes
`<screen>-<width>-<theme>.png` and a shared `summary.json`, all mode 0600.
The directory must already exist, belong to the caller and have no group/other
permission bits; existing output filenames and symlinks are refused. Use a new
directory for each staged snapshot. Chrome's temporary private profile is
created inside that directory and cleaned up by the shared browser helper.

The selector table is `SECTIONS` in `scripts/preview-capture.mjs`: Desk hero,
each desk card, position rows, kept rows, History chart/bookkeeping/events,
Results hero/tiles/calendar/breakdown, and Settings mode/runtime, every field
group, source/log, appearance and About. Desk captures also visit History to
check it, then return to Desk. Only Results with the health feed's exact
`not reported` / `feed_not_received` pair may be empty; its unavailable UI
currently emits no panel `data-state` line, so the summary reports no observed
state names there. Missing sections still fail. A received Results section
counts as content when it has a real value, or every dash tile has its own
explanation (for example, profit factor needs a losing trade).

The summary uses an allow-list serializer: fixed section/screen/state names,
widths, themes, the validated `actor` (or null), booleans, counts (including
`writeBlocked`), and only `/joe/healthz`'s `version` and
`schemaVersion`. It contains no page text, money, quantities, symbols, account
hints, URLs or error messages. Requests outside the base origin are blocked
with CDP Fetch interception, including worker requests; any block fails the run.
Exit 0 means all checks passed; exit 1 means capture/content/errors failed;
exit 2 means invalid arguments or output permissions. Terminal lines are also
value-free: check exceptions print a fixed step id and exception class, with
the message added only when `CI=true` for synthetic diagnostics. Exception
messages never enter the summary. Dedicated-worker requests pause on their
owning page/frame's Fetch session; workers resume after their runtime and
nested-worker tracking are enabled. CI alone uploads **synthetic** fixture
images and the checked summary as `joedesk-preview-capture`.

**Real screenshots go only to JOED/Amy: never commit or upload them. Trash the
captures afterwards** (`trash "$capture_dir"`). Only the value-free summary
belongs on tickets. This script is outside the shipped runtime closure and
does not change contracts, release metadata or deployment approval.

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
   allowlist and expected version/schema on every health poll. By default it polls
   every 10 seconds for up to 150 seconds: data and history must be fresh with
   snapshot/feed ages below 60 seconds, Fleet Config must be current, and gateway
   confirmation must have been observed in at least one poll. Set
   `--max-wait-seconds N` (integer 0–600) to change the bound; 0 checks once.
   Fleet Config is current (`fresh`) while a valid stored revision has no rejection;
   its age is informational time since that revision was received/changed. It need
   not change every minute. Missing/rejected config, stale data/history, or a gateway
   never confirmed within the window fail with `feeds_not_ready`. These semantics
   accommodate unchanged config and the gateway check cadence ([JOED-59](https://aeon.barta.cm/p/JOED/JOED-59)).
   After readiness, it probes all six reads once anonymously and once with spoofed
   identity, together with `/joe/`,
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

## CI runners

CI defaults to `ubuntu-latest`. Setting the repository variable
`JOEDESK_AGM2=on` enables the `[self-hosted, agm2]` runner for same-repository
pushes, manual dispatches and PRs whose head repository matches this repository.
Fork PRs always run hosted. Keep the switch unset until OPS registers the runner
and requires approval for all outside collaborators; `pull_request_target` is
forbidden. Checkout explicitly cleans the workspace, and CI temporary files and
npm's cache stay under `RUNNER_TEMP`.

Chrome installation runs hosted-only. Self-hosted jobs first use a non-empty,
executable `BROWSER_PATH`; otherwise they resolve `chromium`, `chromium-browser`,
then `google-chrome` from `PATH`. They export the resolved `BROWSER_PATH` and fail
clearly if no browser is available. Workflow shell tests resolve `bash` from
`PATH`, including on NixOS runners.

The Docker build requests neither host networking nor privileged build steps.
Buildx's `docker-container` driver does create an internal privileged BuildKit
helper; on agm2 it must remain inside the rootless daemon's user namespace,
checked before builder setup. The self-hosted runner must provide Chromium,
rootless Docker and the prerequisites for `actions/setup-node`. Actual agm2
browser/OCI execution remains to be verified before enabling the switch.

## Test

The workflow lint uses a pinned YAML parser in the checkout-only `test/` package;
run `npm ci --prefix test --ignore-scripts --no-audit --no-fund` before the tests.
It runs with `npm run test:contracts` and `npm test`. The sealed runtime package
and its release reservation retain their existing dependency and version policy.

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
P3, P4 and P5 print a **Time per group** table after their summary and include
the same table in their QA `index.md`, in full and subset modes. It reports
wall seconds, checks, screenshots and share of total time, slowest group first.
Repeated blocks (such as P3's `design`) are summed; only selected blocks enter
the timing helper. The window starts before browser launch and ends after
cleanup; module imports and report writing are excluded. `setup` and `cleanup`
have their own rows, as do P4's mandatory `host-timezone` checks and P5's final
`network` check. Counts come from the existing append-only logs, including
shared audits and direct captures; no check details or screenshot paths enter
the timing table. `scripts/browser/group-timing.mjs` exposes
`createGroupTiming({ results, shots, now? })` with `enter(name)` and `finish()`,
plus `groupTimingTable(report)`. Its fake-clock tests run directly with
`node --test test/browser-group-timing.mjs` and through `test/ui-modules.mjs`.

The Board width sweep defaults to `--full`: both themes, both fonts and all
four screens at every 10 px from 360 to 1440. CI PRs pass `--subset`: light
keeps the full grid and dark uses the code-derived viewport breakpoints and
their ±10 px neighbors, plus 360/1024/1440. Pushes to main and manual dispatch
keep `--full`. Both plans retain 137 sweep checks and six screenshots; the
resize/measure rounds are 1,744 full and 1,088 subset with the current code.
`scripts/board-sweep-plan.mjs` derives boundaries from `app.css` viewport
`@media` queries, `public/joe/*.js` `matchMedia` queries and P3's `COMPACT`.
The 339.98 px card container query describes a card rather than a viewport;
the full light grid still covers its geometry. Every run's QA index records
the plan and actual selected widths, including when `JOED_P3_ONLY` skips the
sweep. Checks keep their full-grid inventory names across plans; execution
reconciliation verifies checks, captures and each theme/font/screen/width.
`test/theme-geometry.mjs` statically enforces theme-independent geometry:
colour/shadow tokens may only feed painting, with two named exceptions for
the root `color-scheme` palette hint and the equal-size sun/moon swap.
It and `test/board-sweep-plan.mjs` join the existing UI unit suite.

The budget trace keeps timestamped long-task attribution, overlapping render
and worker-reply events, and long-animation-frame script/layout attribution
where supported. Desk and History live-push windows begin after their setup
settles; setup tasks remain in the trace separately, and tasks crossing into
an update window still count. The CI guard remains 125 ms (2.5 × reference).
The Board and Results CI guards re-measure once per viewport (the Board:
per viewport and phase), only when every failed condition is a render-time
or long-task limit. The second measurement is final; a reproduced breach or
any functional failure still fails. Both
attempts appear in the trace, table and failure detail. Results keeps its
40 ms switch-render guard and rejects tasks reaching 125 ms; worker/main-thread
and render-count failures never trigger a re-measure. The reference budget
never re-measures and its limits stay unchanged.
When no long task was observed, concise attempt diagnostics report
`taskMs: null`; tables show “—” for the worst long-task duration, while the
task count remains zero. A zero-duration group's share is also “—”.
Term-focus checks reacquire rebuilt terms and wait up to 2 s for each term's
own tip and expanded state. The large-ledger Settings check waits up to 5 s
for its exact-byte title and accessible name before measuring containment.
These checks report their failed sub-conditions explicitly.
It uses `BROWSER_PATH`, a Playwright headless shell or Google Chrome:

```bash
npm run test:browser
BROWSER_PATH=/usr/bin/google-chrome node scripts/browser-p3.mjs
```

`npm run test:results` runs the full P4 Results gate sequentially under **UTC**
and **America/New_York**. `test:browser` includes this guard. CI pushes to main
run the full suite in all three zones; PRs and manual dispatch run full in
Europe/Vienna and repeat only explicitly zone-sensitive **views** in UTC and
America/New_York, retaining every check in a selected view. A view identifies
its group, fixture/interaction, width and theme; workflows can include their
associated detail screenshots and crops. Check-only setup, boundary and
geometry cases are also inventoried. Full mode retains every existing check.

```bash
npm run test:results -- UTC Europe/Vienna America/New_York
# PR/manual-dispatch plan (full budget only in Vienna):
npm run test:results -- --full Europe/Vienna --subset UTC America/New_York
# One zone, same P4 suite (including the render budget):
TZ=UTC node scripts/browser-p4.mjs
# Only zone-sensitive views in one host zone:
TZ=UTC node scripts/browser-p4.mjs --zone-subset
```

Each child process sets `TZ` for the injected board server and Chrome. The CDP
page also sets its requested zone explicitly, since macOS Chrome may keep the
OS zone despite `TZ`; P4 checks the server, page and dedicated worker zones.
Reports stay separate under `~/.local/share/joedesk-qa/p4/<zone>/index.md`
(`JOED_QA_DIR` overrides the parent; slashes in zone names become hyphens).
The parent index identifies each zone's mode, selected view count, static
check count and share of full P4, plus sensitive/independent counts per group.
The child index lists every selected view and reconciles its static check
count against executed checks, including the shared craft audit. An omitted
view or a check-count mismatch fails the gate. New anonymized real fixtures
join the full inventory at all five fixture width/theme variants. They reuse
existing date paths and do not automatically expand the zone subset.

**Zone-subset rule (JOED-65 fix2):** repeat every host-zone check, the exact
14 empirically differing width/theme variants from run 39793917962, and one
**1440 light** representative per distinct date code path. Rendering another
date through an already-covered helper does not add a zone variant. The
explicit per-view `zoneSensitive` flag now records that selection; `coverage`
still describes the view's actual assertions, including unselected date views.
The full Vienna run and full ×3 main-push release net retain every check;
`ci.yml` is unchanged.

The source inventory comes from reading `public/joe/*.js` and searching
`Intl`, `Date`, `wall`, `viennaDay`, `viennaDate`, `viennaMidnight`, the date/time
formatters and their callers. These are the call-site families exercised by
P4 Results and its shared board shell; Desk, History and Settings have their
own P3/P5 gates rather than additional P4 copies. Shared zoned primitives live
in `time.mjs` (served to the page and worker); `format.js` uses explicit Vienna
wall parts, and Results date-only arithmetic uses UTC fields. The time-vector
and Node suites still run under all three host zones in CI.

`scripts/results-gate-plan.mjs` declares the following paths and representative
views. A lightweight static test parses this declaration and the table, checks
that the named helpers exist, and requires each representative to be selected
exactly once. Each representative executes assertions, rather than relying on
a screenshot alone.

| Date code path | Source helper/call-site family | Representative view |
| --- | --- | --- |
| `wall-clock-formatters` | format.js: parts, timeHM, dateTimeFull; app.js: renderHeader | `design/matrix/1440/light` |
| `calendar-day-labels` | results-model.js: fmtDM, fmtDDM, fmtDay; results.js: renderCalendar | `design/matrix/1440/light` |
| `period-labels-and-stepping` | results-model.js: periodOf, rangeLabel, stepAnchor, addDays, monday, daysIn | `design/matrix/1440/light` |
| `best-worst-day-labels` | results.js: dayTile | `r1/large-amounts/1440/light` |
| `today-money-boundary` | results.js: resultsView; results-model.js: equityAt, moneyContext | `r1/money-now/1440/light` |
| `basis-cut-date` | results.js: cutText; results-model.js: moneyContext, viennaMidnight | `r1/basis/1440/light` |
| `chart-day-session-and-times` | results-model.js: dayWindow, intraday; results.js: renderCurve | `design/matrix/1440/light` |
| `chart-period-midnights-and-gaps` | results-model.js: curve, viennaMidnight; results.js: renderCurve | `r1/time-axis/1440/light` |
| `tracking-start-date` | results.js: startText, heroSentence, dayState | `fixtures/before-tracking/1440/light` |
| `closed-partial-days` | results-model.js: countPartialDays; results.js: partialDay, dayWarning | `partial-days/calendar/1440/light` |
| `open-today-partial` | results.js: dayWarning, dayContent | `partial-days/today-reason/1440/light` |
| `missing-closed-and-open-days` | results.js: missingDayText, dayWarning, dayState | `missing-days/closed-open-recovery/1440/light` |
| `period-partial-day-hints` | results.js: renderHero, renderCalendar; results-model.js: countPartialDays | `period-hint/partial/1440/light` |
| `trade-open-close-and-held` | results.js: held, tradeRows; format.js: timeHM | `trade-amount/rows/1440/light` |
| `open-position-today-time` | results.js: dayContent; results-model.js: viennaDate | `partial-days/desk-filtered-reasoned/1440/light` |
| `receipt-ingress-clock` | feed.js: serverClock, createFeed; history-worker.js: serverClock, clockNow | `ingress/live-stale-recovery/1440/light` |
| `stale-retained-ago` | results.js: renderStatus; format.js: age; ui.js: ageSpan | `states/stale-retained/1440/light` |
| `worker-date-indexing` | history-worker.js: pollResults; results-model.js: indexResults, viennaDate | `ingress/live-stale-recovery/1440/light` |
| `today-rollover-retained-receipt` | results.js: resultsToday, renderResults; results-model.js: addDays | `partial-days/retained-midnight/1440/light` |
| `vienna-dst-and-2027-04-01` | results-model.js: viennaDate, marketHoliday; results.js: renderCalendar, tradeRows | `vienna/dst-calendar/1440/light` |

`design/matrix/1440/light` switches all five periods, steps day/week/month,
compares calendar labels and opens dated trades; its chart covers both day
and longer-period date labels. `r1/time-axis/1440/light` covers gaps and the
real period time axis; `vienna/dst-calendar/1440/light` uses the later
**2027-04-01** clock and checks both DST changes, midnight trade assignment
and the repeated hours. The retained-midnight fixture accepts its receipt
on an open day and reads it after midnight. The open-position representative
opens both the closed day and today, asserting the actual `11:15` time.

Two representatives need a minimal pair of declared views: trade rows retain
`trade-amount/ingress` (2 contract/acceptance checks before row rendering), and
`period-hint/partial/1440/light` retains
`period-hint/baseline/1440/light` (3 checks establishing the unhinted chart and
geometry). Their dependencies are explicit in the plan. Independent state
and partial-day transitions have selection guards; any necessary uncounted
fixture setup still rejects failed ingress. No other width/theme is added for
a path. The 14 measured variants are additional coverage and retain all their
associated checks, even when a difference may be render noise.

The current inventory includes the real anonymized paper-proof fixture
`fixtures/results/real/2026-10-22-paper-proof.json` (2026-10-19 through
2026-10-22, two round trips). Its five views add 104 checks to the 4,957-check
synthetic UX 1 baseline from run 39929690916; real fixtures stay out of the
zone subset.

| Group | Sensitive views | Independent views |
| --- | --- | --- |
| host-timezone | 1 | 0 |
| design | 2 | 12 |
| fixtures | 1 | 25 |
| states | 2 | 15 |
| vienna | 1 | 1 |
| cards | 0 | 3 |
| r1 | 4 | 6 |
| trade-amount | 2 | 7 |
| phone-calendar | 0 | 6 |
| ingress | 3 | 3 |
| period-hint | 2 | 78 |
| partial-days | 12 | 136 |
| missing-days | 1 | 5 |
| budget | 0 | 1 |
| **Total** | **31** | **298** |

The subset is **31/329 views and 627/5,291 checks (11.85%)**, enforced at
**≤25%** by the lightweight inventory test. The PR plan performs **6,545**
checks (5,291 + 2 × 627), compared with 14,174 in fix1 and 15,873 for full ×3
with the real fixture (14,871 for UX 1's synthetic baseline; 14,862 for the
original synthetic baseline).
The measured agm2 Results times were **788 s** for baseline, **779 s** for the
group subset and **744 s** for fix1's 93.06% view subset. At approximately
**263 s** per original baseline full Vienna run, weighting the current PR plan
by that 4,954-check baseline projects **347 s (5.8 min)**, below the **450 s**
target. This is an expected runtime, not a measurement: setup and interactions
have different costs. The coordinator's PR CI on agm2 measures the actual
result; no local browser run is part of this change.

The lightweight tests also preserve the 4,957-check synthetic UX 1 baseline and
104 additional checks per real fixture, exact measured variants, explicit
booleans, setup dependencies, sequential zone orchestration and executed-count
reconciliation.
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
check age and closed reason. Fleet Config's `fresh` state means a current, valid
stored document without rejection, independent of its informational receipt age;
rejections and clock regression retain their failure states. The board light,
Settings and desk cards do not use Fleet Config age to warn about timed staleness.
Never-received feeds have null age and
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

JOED-40 prepares a real-producer CI slot in `fixtures/results/real/`. Only JOED
adds files there, after Amy's paper-proof sign-off. Raw inputs and identity maps
stay outside the checkout. Run:

```sh
node scripts/anonymize-results.mjs /private/input.json /private/new-output.json
node scripts/anonymize-results.mjs --check /private/new-output.json
```

Both ingress producer snapshots and served snapshots use the existing offline
Results contract validator, before and after anonymization. The schema-derived
allow-list preserves constants/enums (including desk ids and reasons), symbols,
currencies, dates/instants, decimals, quantities, FX rates, numbers, nulls and
structure. It replaces trade `id` with `rt-anon-N`, optional `company` with
`company-N`, and every FX `source` with `source-N`, deterministically in first-seen
order per category. These are the only identifying/free-form string fields the
current contract accepts. Account ids/hints, order/exec ids, permIds, orderRef,
person/host fields and any other unknown string fail closed with a JSON path
(exit 1); malformed JSON or other contract-invalid input exits 2. They cannot be
silently added or stripped from this closed contract. Decimal strings are never
converted or reformatted. A deep projection check preserves every other leaf.
The CLI creates a new 0600 output, refuses overwrites/symlinks, and prints counts
or paths only. `--check` requires canonical synthetic tokens in all free-form
fields, preventing unrecognized name/id patterns from slipping through.

`npm run test:contracts` (and `npm test`) validates every real JSON and its
already-anonymous check; the empty slot logs `no real fixture yet`. P4's fixture
list automatically includes the real files at 1440 and 390, light and dark,
using their captured clock, the same model comparisons, explained-dash and
complete-section assertions, and accessibility/layout audit as synthetic files.
PR CI runs P4 in UTC, Europe/Vienna and America/New_York. No local browser is
needed to prepare or validate the fixture.

After OPS confirms exact deployed commits, the follow-up can run:

```sh
node scripts/set-deployment-pins.mjs --producer SHA40 --pusher SHA40 --executor SHA40
```

At least one flag is required; each can be used on its own. Every pin must be a
40-hex **nixcfg** commit, confirmed by OPS. `--pusher` and `--executor` update
`participants.pusher.deployment_pin` and `participants.executor.deployment_pin`;
a missing or malformed participant fails without writing the manifest.
`--producer` updates `participants.producer.deployment_pin`. Only when that flag
is supplied and the producer participant is absent, the helper adds it in the
pusher's shape: the requested `deployment_pin`, `required_contract_set_sha256`
from the manifest's active set, `required_data_schema` set to
`inspr.joe.household.results.v2`, and pending status
`Amy JOED-20 real producer rehearsal/sign-off required`. The release checks
permit this additional participant; no validator change is needed. The helper
never creates a top-level `producers` key. Unknown/duplicate flags, missing
values and invalid SHAs fail. Existing statuses, unrequested pins and activation
wording stay untouched; recording a pin does not claim sign-off. No deployment
pin is set by this tooling change.
`release/contracts.json` **is inside** `release/closure.json`, whose
bytes are pinned by `CLOSURE_SHA256` in `scripts/check-release.mjs`. A future pin
change invalidates the current closure: prepare a new, later release reservation,
closure file hashes and closure pin, and immutable release set through the normal
reviewed release process. Never reseal or republish `261016151218.0.0` or
`261019102825.0.0` with new bytes. This tooling leaves contracts and pins unchanged;
JOED-58 reserved sequence 26 for the cut-over retry's changed board bytes; that
release was deployed. JOED-59 reserved sequence 27 for the changed health and
smoke semantics; that release is now live. JOED-60 reserved sequence 28 for the
bounded yellow broker-check warning; that release is now live. JOED-70 reserved
sequence 29 for the calm status line; that release is now live (JOED-75).
JOED-77 reserved sequence 30 for performance at a glance; that release is now
live (JOED-78). JOED-81 reserved sequence 31 for Round 2: calmer outage view;
that release is now live (JOED-84). JOED-85 reserved sequence 32 for Phase B:
exact desk money and position values (JOED-55); that release is now live (JOED-87).
JOED-90 reserves sequence 33 for Results speed fix (JOED-89).
Never reseal or republish sequences 26, 27, 28, 29, 30, 31 or 32 with these new bytes.

JOED-20 producers must re-vendor the complete self-contained `contracts/`
directory, including `vienna-date.mjs`, and re-pin to `release/contracts.json`'s
`contract_set_sha256`; an earlier digest does not cover revision-10 acceptance
and reads. The release manifest's pusher/executor requirements carry that
same digest. This remains a coordinated cutover candidate, pending
producer rehearsal and sign-off.

### Phase B exact money (JOED-85, contract-set revision 10)

The data ID stays `inspr.joe.household.v2`. Every valid revision-9 payload
remains accepted, including the live Phase A null/`not_exact_yet` switch set.
Revision 9 already allowed non-null desk money, native position values,
per-value `money.fx` provenance and a position's callback `updatedAt`; these
fields are reused. Revision 10 adds only optional pusher-owned
`desks[].pnlSources` and the append-only reasons `sod_missing`,
`ledger_unreconciled`, `position_stale`. The schema/manifest, validator and
selector, complete contract digest and all participant requirements in
`release/contracts.json`, runtime closure and its checker pin move together.
Historical revision and release records remain unchanged.

Amy's binding JOED-55 specification (2026-10-25T20:14Z) governs producer
exactness; accepting a shape does not prove its underlying broker/ledger data.

Amy's board display rule (JOED-91, 2026-10-26, release 33) is applied in
`public/joe/board-state.js` after the unchanged contract selector.
`not_exact_yet`, `sod_missing`, `ledger_unreconciled` and `position_stale`
always show a dash, including when a feed or gateway failure masks the scoped
reason. An outage may retain individual last-good observations with their own
age and reason, for strictly less than 60 minutes from their original receipt;
an unknown age or age ≥ 60 minutes shows a dash. Retained inputs never feed
board totals, since-start figures, ranking, Results' current money, kept-worth
sums or percentage bars. Independent exact siblings stay usable. Recovery
shows the new exact observation. Withholding derived amounts preserves value-free
health evidence: retained equity keeps the existing five-minute yellow grace,
while missing or older equity and higher-priority health failures keep their
existing red rules. Existing caption reserves stay fixed;
rendered pixel verification remains a coordinator gate. This board-only policy
does not change revision 10 or require producer re-vendoring.
When Today is a broken dash, its local caption states the reason unless the
board's state line already explains it. This includes pending start-of-day
results and every revision-10 exactness reason; repeated section reasons stay shared.

Release 34 (JOED-93 follow-up: JOED-98/94/95) also treats revision-9
`baseline_pending` and `day_pnl_unavailable` as missing exactness, never as
last-good. The server clears the cell's durable last-good when any of these
six reasons arrives, even alongside a value or behind another reason; only
a new exact observation restores retention. Startup checks the latest snapshot.
On first load of a pre-release-34 store (Today cells have no `valueSource` key),
the server also drops non-null day/equity cells from earlier receipts: release 33
stored only `{value, valueReceivedAt}`, so their historical exactness cannot be proven.
This one-time cleanup costs at most 60 minutes of last-good display. The server
attempts to persist it at startup with explicit Today provenance keys. If that
write fails, it logs a value-free line and keeps serving the cleaned in-memory
store; the next accepted snapshot persists the cleanup, or the next boot repeats
it. Current observations keep their Today source and observation date; unrelated
cells and sequence metadata survive, and new exact values retain normally.
The board withholds current scoped exactness failures even when gateway or
feed failures mask their reason; historical exactness is enforced by the server.
Today belongs to the observation's America/New_York date: a missing baseline,
an outage over New York midnight or a late receipt of yesterday's observation
shows a dash with its reason on the hero, every desk card and phone row.
When the board detects yesterday's observation itself, it says “waiting on
the start-of-day value”; an existing outage reason still takes precedence.
Since start and other outage retention keep their existing rules. Internal
Today observation dates and source metadata persist across server restart
without changing the producer contract. Session-open estimates say **Estimated** beside desktop and
phone desk Today figures, with the hero's full explanation in the accessible
label, without repeating “Today” in the phone row's accessible name. A retained
estimate keeps its mark during an outage. Marks use 10 px text with space
reserved in the label. Desktop cards keep the mark beside Today; expanded
phone cards reserve a 30 px label box in every state and put the mark below
Today, keeping it clear of the state icon at 360 px. The compact phone Today column is 96 px (48 px for
the mark, 48 px for Today plus its state icon), taking 14 px from the flexible
identity column; Since start stays 82 px. They have no hover title. Detail values
and dashes use the same 26 px block flex box, avoiding the inline money baseline's
extra 4 px. Money and target geometry stay fixed across states; CI checks
exact/estimate transitions at 360/390/1024/1440 and stale/kept estimates at
360/390, in both themes and normal/wide fonts, against the complete label content.

| Field | JOED-86 emission rule |
| --- | --- |
| Position `quantity`, `mark`, `marketValue`, `openPnl` | Exact broker portfolio callback values for that conid only while fresh. Money keeps its native currency. Keep the actual callback time in `updatedAt`; a new envelope or position-list completion never refreshes it. Stale callback: all affected fields null with their own `position_stale` reasons. Missing/unverified callback: null with `not_exact_yet` (or `source_unavailable` when not reported). |
| Desk `money.equity`, `openPnl`, `totalPnl` | Current v1 FIFO desk ledger values, only when that desk reconciles with broker positions and has no unclaimed/pre_ledger rows. Unreconciled: null with `ledger_unreconciled`. Stale or otherwise unverified inputs stay null with their actual reason, never re-stamped carried v1 money. KEEP contributes nothing. |
| Desk `money.dayPnl` | Current proven desk equity minus its saved, once-daily exact SOD at the agreed America/New_York midnight boundary, with no missed snapshot. Missing/reseeded SOD or a v1 `session_open_proxy`: null with `sod_missing`; do not promote an estimate to exact DAY. Ledger reconciliation and freshness gates also apply. |
| J-family FX | Reuse `desks[j].money[field].fx` on each converted EUR value: actual `base`, `quote: "EUR"`, positive decimal `rate`, `source`, and actual `observedAt`. Carry the rate used by the calculation, not a later rate. Missing/stale rate or timestamp withholds the affected money. J rolls J and J2–J5 together. |
| Desk since start (`totalPnl`) | The verified base is **€5,000 per desk**, **€15,000 aggregate**, not €15,000 per desk. If that desk's base is unknown, send null with `not_exact_yet`; never infer its base from current equity. Preserve any verified `accounting` period and `historyBasis`. |
| `totals` | Exact decimal sum for each field only when all three desk inputs for that field are exact; otherwise null with the blocking reason. No partial sum, KEEP, or broker-account NAV is a desk total. |
| Cash | Account-level `brokerAccount.cash` only: raw IB `TotalCashValue` in base EUR, same whole-account scope as NAV including KEEP. Keep missing/non-EUR/stale cash null with its own reason. There is no desk cash field: omit it (do not add `money.cash`, even as null). |

For independent desk DAY/OPEN, each desk may send `pnlSources.day` / `.open`
with the existing source shape (`status`, `method`, `currency: "EUR"`,
`scope: "virtual-desks"`, `observedAt`, optional `periodStart`, `reason`,
`detail`). The source applies only to its containing desk and overrides the
corresponding top-level source. Exact desk DAY uses `sod-virtual-equity` with
the real `periodStart`; exact desk OPEN uses `owned-lots-current-mark-fx`.
Unavailable sources use `status: "unavailable"`, `method: null`,
`observedAt: null`, and a closed reason, also present in the money reason bag.
The aggregate source is unavailable when its total is null; exact sibling
desks keep their own available evidence. Omitting the new sources keeps rev 9's
all-or-nothing aggregate evidence rule. New unavailability reasons cannot
accompany a non-null field and cannot fill cells from older retained values.
Session/KEEP safety still overrides every source; served desk evidence is
withheld alongside the money it describes.

The base finding comes from nixcfg `origin/main` (read-only),
`hosts/hsb0/docker/joe-board-pusher/project.mjs:12` (`VIRTUAL_EQUITY = 5000`),
`desk-ledger.mjs:404` (passes `virtualEquity: 5000` for each desk), and
`family-ledger.mjs:440` (the `virtualEquity = 5000` default). That parameter
becomes `virtualCapital` at line 456; lines 622–623 compute net PnL and equity
including that capital.
`public/joe/performance.js:6` keeps the established €15,000 aggregate base;
neither data nor Fleet Config declares individual starting capital. Per-desk
percentages therefore remain absent. Today/Since start aggregate percentages
already render when their complete exact inputs exist.

KEEP SXR8 and TSLA remain account-level `scope: "keep"`, `desk: null`, inert
and excluded from all desk money. Position DAY is not made exact merely by a
portfolio callback: omit it or send a reasoned null until independently proven.
The board shows the new reasons as “start-of-day value missing”, “desk ledger
not reconciled”, and “position update is old”, preserving one repeated reason
per section and full accessible field explanations.

`fixtures/phase-b.json` contains synthetic exact and mixed snapshots (one desk
unreconciled, another missing SOD, a stale conid beside a fresh conid).
`test/phase-b.mjs` covers old/new acceptance, FX, complete totals, null reasons,
actual selectors/rendering, percentages, restart and session expiry. Position
last price, worth and open result, kept rows and per-currency kept totals use
exact decimal units through formatting: one half-away-from-zero rounding to
cents, with no Number conversion of money. Half-cent fixture values exercise
this path in unit tests and P3/P5; units also preserve large amounts and
cancellation before rounding. P3's `phase-b` scenario checks exact values;
P5's checks mixed values and exact
recovery, at 1440/1024/390/360 in both themes through real ingress. Browser
execution and visual verdict remain with PR CI on agm2 and the coordinator.

JOED-85 reserved sequence 32 / `261025221940.0.0` at
`2026-10-25T22:19:40Z` for Phase B; that release is now live (JOED-87).
JOED-90 reserves sequence 33 / `261026070713.0.0` at
`2026-10-26T07:07:13Z` for Results speed fix (JOED-89) and reseals its runtime
closure. Sequence 32 remains immutable deployed history. Publication,
cross-family review and deployment gates remain with the coordinator.
JOED-86 must vendor the complete revision-10 package and its digest before
activation; existing deployment pins and prior producer sign-off prove rev 9
only. PAPER remains the only mode; LIVE stays locked.

Contract-set revision 8 (JOED-49) adds optional `brokerAccount.cash` as EUR
`money|null`, owned by the pusher. Amy's definition is IB account summary
`TotalCashValue` in base currency EUR: the raw decimal lexeme at account level,
the same scope as NAV including KEEP (`paper-account-including-keep`), and the
same `observedAt` as equity. Preserve the broker bytes: no float conversion or
rounding in the producer or storage. Missing or non-EUR means null with a
reason; never derive cash from NAV or desk totals, or convert another currency.
`brokerAccount.reasons.cash` supplies cash's own closed null reason, following
the per-field bags on desks/totals. `brokerAccount.reason` remains equity-only
and cannot justify null cash. An explicitly null cash without its own reason
fails with `reasonRequired`; a value with a reason is accepted, matching equity.
Rev-7 payloads omitting cash or the whole account still validate when their
position nulls carry reasons as described below. Old durable cell sets retain
their sequence and last-good observations on restart. The data ID stays
`inspr.joe.household.v2`.

Revision 8 also permits null `positions.rows[].quantity` and adds the closed
per-row `reasons` object with optional `quantity`, `mark`, `marketValue`,
`dayPnl` and `openPnl` reason refs. Every explicitly null field requires its own
reason. The existing session exception is unchanged: `positions.reason` may
justify row nulls while the API session is unconfirmed; it cannot justify
them when the session is confirmed. Optional omitted money fields remain
accepted. An omitted row `openPnl` shows a plain muted dash without a title or
reason. Only explicitly present null `dayPnl` / `openPnl` fields add their
per-field reason to the row. KEEP rows retain symbol, side, `scope: "keep"`
and `desk: null`.
This tightens rev-7 acceptance for unreasoned position nulls at Amy's request;
no v2 producer has shipped, so no live producer payload is affected. The
historical session fixtures still exercise their unchanged panel exception.
The frozen-ready fixture also carries row reasons because its advancing-push
test initially uses a still-confirmed check; its original payload observations
and panel expectations stay unchanged. `fixtures/positions-null.json` adds
reasoned KEEP nulls and a stage0 null mark.

Contract-set revision 9 (JOED-52) adds optional pusher-owned `reasons.desk`
to that closed per-row bag and appends `desk_unmapped` to the reason enum,
preserving its earlier order and the `inspr.joe.household.v2` data ID.
A broker-reported non-KEEP position absent from the dated ownership mapping
stays `scope: "stage0"`, `desk: null`, with `reasons.desk: "desk_unmapped"`;
the producer never guesses a desk or drops the row. A stage0 null desk without
its own reason fails `deskRequired`. A desk reason with a non-null desk, or
on any KEEP row, fails `contradictoryDesk`. KEEP still requires `scope: "keep"`
and `desk: null` without a desk reason; legacy rules and all rev-8 payloads
stay valid. The API-session exception cannot replace a desk reason.
The board's existing name line reads **No desk · not matched to a desk**,
also in title and accessible name, with no desk colour or mark. Unmapped
stage0 rows sort after all desk rows, retaining other ordering, and add
nothing to desk figures or Today totals. When any are present, the subtitle
counts every listed row and names the unmatched ones: `4 open · 1 not matched
to a desk · each in its own currency`. Without them its wording is unchanged.
An unknown worth has no visible bar track; the hidden track retains its space.
KEEP rows have no worth track. Amy's switch
snapshot keeps their values null with `not_exact_yet`; the row shows em
dashes with each value's own reason, without partial totals.
`fixtures/positions-unmapped.json` supplies this synthetic row. P5's existing
`positions` scenario adds real-ingress, accessible-copy, neutral-identity,
ordering, row-count, figure-exclusion and exact 0 px cash/KPI/card movement checks,
plus an exact 0 px row/cell/track check when the unknown-worth track is hidden,
plus `<width>-<theme>-desk-unmapped.png` crops at 1440/1024/390/360 in both
themes. Browser execution and visual approval remain with CI/coordinator.
The cash and KPI sizing reserves include the new short reason through
`CELL_REASON`, with their existing geometry checks unchanged.

JOED-60 excuses null equity with `gateway_unconfirmed` only while the broker
state is `unsure`, the real gateway has a canonical `checkedAt`, and the shared
gateway panel's check age is known and below 180 seconds (`FEED_STOPPED_S`).
An excused cell makes the header show yellow **Broker unsure** immediately,
ahead of stale-feed and other yellow warnings; the cells still say
**Unavailable · broker connection not confirmed**. A missing or invalid real
check, an unknown age, an age of 180 seconds or more, or null unconfirmed equity
while the broker is `OK` or degraded stays red `equity_unavailable`. Receipt age
never substitutes for a missing broker check. Other missing-equity reasons and
the halt, ledger limit, broker-down, stopped-feed and stuck-producer red rules
keep their precedence.

JOED-57 treats null desk equity with `not_exact_yet` as deliberately uncaptured,
so an otherwise healthy board stays **Board OK** and Details adds one neutral
“Desk values are not exact yet” line. Other missing reasons stay red except for
the bounded broker-check gap above; retained values, stuck desks and regular-session result warnings keep
their existing rules. `NOT_EXACT_TONE` in `health.js` defaults to `green`;
`yellow` opts into `values_not_exact` after those checks. Null not-exact cells
use the neutral info SVG with existing tokens and spacing. JOED-57 kept contracts
at revision 9 and left its release coordinate unchanged.

The header status stays on one line at 360/390/1024/1440 px. A hidden CSS
sizer reserves the longest existing status, “Broker unsure”, in the rendered
font, so status changes move no header component. At widths up to 400 px the
brand shows its logo and retains the accessible name “JoeDesk”; PAPER stays
visible. P5's `not-exact` checks the real-ingress Board OK / Needs fix / recovery
sequence in both themes at all four widths: status height equals one line box,
no horizontal overflow, and the brand, PAPER, status and theme button stay
inside the header with no intersecting bounds. Its exact 0 px checks include
the status and its label. These browser assertions run in PR CI.

The reason enum appends `not_exact_yet` (the broker reports it, but it is not
yet captured exactly) and `source_unavailable` (the broker did not report it,
or did not report it in the required currency). Board copy is “not exact yet”
and “not reported by the broker”. `source_not_authoritative` still means the
kept-holdings list disagrees. Desk and KEEP null values show an accessible
em dash plus visible per-row reasons; KEEP remains read-only. A missing
market-value summand makes the entire kept worth unavailable with its reason,
including stale and broken states; it never displays a partial total.

The independent `paperCash` panel follows account freshness, retention and
API-session checks. The read model withholds broken retained cash with its
own reason; an unconfirmed session nulls cash alongside equity. Desk has a
separate supporting Cash figure, and Settings appends it to the account
row. Both use the label “Cash” and caption “cash · as the broker reports it”.
They show two decimals using exact integer units for display only, with
the untouched broker lexeme in title and accessible name. Null Cash shows a
muted dash in the Desk figure with “not reported · [reason]” in its caption;
Settings retains that wording inline. Rev-7 omission reads “no data received yet”.
Desk reserves fixed caption lines inside each cell; Settings reserves the actual
wrapped value/stale/null reason forms, including the session reason at 360 px. They wrap
text and keep the existing header. P5's `cash` cases cover real ingress, stale, null, API-session loss,
rev-7 omission and recovery at 1440/1024/390/360 in both themes, with exact
component geometry checks, overflow/clipping assertions and
`<width>-<theme>-{desk-hero,settings-account}-cash-{value,null}` crops.
Browser results and visual approval remain with CI and the coordinator.
The three account/result captions retain their overlapping, accessibility-hidden
caption samples, including unknown ages, 999 days and 23 h 59 min. All four
secondary cells now use equal fixed caption blocks; Cash needs no hidden samples.
The primary Since start caption retains its content-sized grid reserve.
CI owns the rendered geometry and overflow result.
P5's `positions` cases assert null KEEP quantity and values with visible and
accessible reasons, a stage0 null mark, and no `button`, `a`, `input` or
`[tabindex]` inside any `[data-keep]` row. At 1440/1024/390/360 in both themes,
they check overflow/clipping and emit `<width>-<theme>-desk-kept-null` crops.

Contract-set revision 7 keeps every revision-6 payload valid and the data ID
`inspr.joe.household.v2`. The optional executor reason `results_capture_failed`
means degraded health: results capture is failing and trading continues. Settings
shows the reason in yellow. Desk’s health explanation adds “Paper executor
degraded: results capture failing, trading continues (ledger 3,2 MB of 8,0 MB).”
using the reported size; without ledger fields it omits the parentheses.

JOED-70 replaces the earlier header pair, always-visible status strip, fresh
card check-ins and footer data age with one shared header status button.
Green reads “Live · updated 9 s ago” (on a phone, “Live · 9 s”), using receipt
age and the existing age formatter. Yellow/red show the top-ranked problem;
“Emergency stop is ON” keeps first priority. Health ranking, all thresholds,
JOED-60's broker gap, `not_exact_yet`, and Settings runtime content stay intact.
The control has a fixed width and tabular numerals. Fitting yellow sentences
appear in the control. At compact widths (≤1100 px), or when measurement shows
the full sentence would overflow, it switches to a short label and the reserved
56 px line below the header displays the sentence and action in yellow, at body
size with a status icon and space above the hero. Its button has a 44 px target.
Red always uses that line. Each non-green sentence appears once outside Details;
green may stay compact on narrow screens. The line ends in an ellipsis when
necessary and retains a complete title. Its space stays reserved in green, so
tone changes and ticks cannot move the content.

The header button and visible problem line open the shared, opaque Details
dialog on every screen. Its full sentence wraps at the top, in view on opening.
It holds the former strip's numbers, broker check age, emergency-stop state,
data time/age, and all their existing term explanations, plus each desk's
check-in age. Escape closes the dialog and returns focus to its opener
(an open term tip consumes the first Escape). Fresh desk check-ins are hidden;
at the existing 60-second boundary they return in the stale tone. The footer
retains the read-only paper-board promise and version. A polite live region
announces each change of ranked tone/reason once, without announcing age ticks.

JOED-77 puts Today and Since start beside each other as the two primary Desk
figures, each with euros and a signed percentage to two decimals. Today uses
`dayPnl / (equity - dayPnl) × 100`; Since start uses `totalPnl / 15000 × 100`.
The existing aggregate practice-capital base is retained: neither the data
contract nor fleet settings supplies a starting base. Individual desk percentages
are omitted for the same reason; their term explanation says why. The History
model's assumed € 5.000 is a chart estimate, not evidence of an individual base.
All percentage arithmetic uses exact decimal BigInt units and rounds once;
missing, nonpositive, retained, incompatible or not-exact inputs omit the
percentage. An estimated session-open day also omits it. Desk cards rank by
their since-start euro result, best first, retaining current order on ties and
putting unavailable results last. Position rows keep their instrument currency:
the current row contract supplies neither a separate EUR result nor a usable
native-to-EUR rate (a rate from another row or the results record is not used).

JOED-83 adds the selected period's percentage beside the Results hero's euros
for All desks. All time divides by `STARTING_MONEY` (€ 15.000), matching
Desk's Since start for the same aggregate result. Other periods divide by
`STARTING_MONEY + prior.units.net`, equivalent to the after-fee `rollup`
from `trackingStart` through the day before the period starts. JOED-89 caches
that exact cumulative result in each record index's BigInt `netPrefix`, built
once from carried equity closes. A date lookup replaces the full prior rollup
on each switch; current money and basis-change checks still run on every call.
Pre-tracking closes retain their exact value or unknown state across gaps at
tracking start; periods starting before or at tracking still use the initial base.
Unknown closes recover only with a later known close, and a new record gets a
new prefix. `node scripts/benchmark-period-base.mjs` compares the old and new
Node model paths over the 14,000-trade/288-day fixture and eleven switches;
browser render-budget validation remains in CI. The base includes open-position
movement without summing closed trades alone or rounding either input to cents. Individual
desks, empty periods, basis changes, unknown/non-exact results and unknown or
nonpositive bases omit the percentage. The shared Desk formatter retains its
two decimals, signs and tones, with “of the money at the period start” in the
figure's accessible text and the formula in the existing Result explanation.
Both figure columns reserve their width when the percentage is absent, with
tabular numerals and fixed height. Results unit tests cover the exact base,
rounding boundaries, Since start parity and omissions. P4's existing number
comparison now checks percentage presence, value, tone, meaning and bounds
for the standard fixture's All desks and individual-desk selections; its
existing tick/filter geometry checks include the figure and percentage slot.

A snapshot state shared by money cells appears once in the hero's board caption.
The cells keep subtle state icons. Different states, reasons, ages, missing
values or retained observations keep their own explanations; positions and kept
holdings retain their section state lines. Caption and percentage space stays
reserved across ticks. Results' eight metric help controls are small info icons
with names of the form “Learn about Typical win and loss”, opening the same
explanations. Two-value metrics use two reserved numeral rows inside fixed-height
cards, including unavailable and single-value states, without clipping or scroll.
`test/performance-glance.mjs` covers exact percentage math, omissions, ranking and
caption sharing. P3 preserves the Desk state/geometry checks with the new hero,
order and shared caption; P4 checks all info controls and both value rows against
their card bounds. Browser validation belongs to CI.

JOED-81 also shares repeated field reasons within each section. During a broker
outage the hero/account caption says “Numbers unavailable · broker connection
down”; Positions and Kept holdings each say “Prices unavailable · broker
connection down”, with the section's age and incomplete-worth notice where
applicable. Desk cards state the common reason once in their existing chart
status; different observation ages remain on their own lines. A different row
or cell reason stays beside that field. Every missing money or position value
keeps its field and complete reason in its accessible name and title.
Collapsed phone summaries retain the icon and short reason, with each distinct
reason once in their complete accessible copy. Expanded summaries leave the
shared reason to the section body while preserving independent warnings.
Opened Account repeats the hero's shared reason once inside its own phone
body, in a fixed 48 px state box (two 18 px lines plus 12 px padding), empty
and hidden from accessibility when fresh; desktop keeps the existing hero
caption. Grid layout prevents an inline status's baseline from growing this
box. Desk reasons stay inside the fixed 84 px chart; Positions and Kept keep
their existing state lines and phone reserves (48 px and 62 px respectively).
A null position's today's result keeps “Today’s result: —” when its reason is
shared by the section; the dash's name and title carry the complete reason.
A different reason remains in the row's field reason list. Both use an
always-present two-line detail reserve, empty and hidden from accessibility
for omitted or valued optional results. Independent field reasons remain whole
and can grow beyond that baseline. Phone position summaries reserve three
12.5 px text lines for side/quantity, last price and worth; Kept reserves two
lines for side/quantity and last price, and one for its phone worth summary.
The read-only Kept caption reserves two lines on desktop and five on phones,
including space for either its paper-account figure or dash. These reserves
keep the fresh, stale, broker-down and cash-session templates from shrinking
when values become shorter. Other visible dashes retain their complete field
and reason in their accessible names and titles.
`test/ui-modules.mjs` covers reason aliases, mixed ages, exceptions and labelled
dashes. P3 reuses `a-gateway-up-but-dead` for section counts and a fresh-to-outage
geometry check at 390/1024/1440 in both themes. The phone transition checks
visible collapsed summaries first, then opens the disclosures and checks each
body and its rows; expanded and collapsed geometry checks remain. Execution
belongs to agm2 CI.
The hero keeps its primary results, sentence and board caption on the left,
with the clock and chart on the right. Open positions, Desks’ money, Paper
account and Cash share one row below both columns above 1180 px; at 701–1180 px
they form a 2×2 grid. The chart fills the primary area's height, removing the
empty right column. At 481–700 px the order stays primary results, secondary
figures (Cash below Paper account), then clock and chart. Cash keeps its exact
broker lexeme in its title/accessibility name, its independent missing/stale
reason and a state-independent reserve; Settings keeps its existing cash layout.
Each secondary cell reserves five 16 px caption lines (eight on phones) inside
the cell, with a 20 px label and a 28 px value row. Cash's broker caption uses
the first two reserved lines; the same `.cash-caption` contains
“not reported · no data received yet” (or its own reason) below the broker
description when Cash is a muted em dash. AC-19 compares the four supporting
captions through the shared copy normalizer, preserving the phone's nonbreaking
space before middle dots; its Cash reason selector stays inside the caption.
The fixed 80 px caption block (128 px on phones) remains state-independent. The hero
has no reserved card height. Fix 4 removes Cash's hidden sizing paragraphs:
the more-specific `.kpi .c` block display had defeated their grid overlap and
inflated every stretched secondary cell. CI's 1440 primary/chart height of
about 272 px plus the new 147 px secondary row, 10 px gap and 46 px padding
predicts a hero near 475 px. At 1024 the 2×2 secondary grid is 291 px, giving
`max(primary height, 272 px) + 347 px` (roughly 619–670 px, font-dependent).
These are CSS estimates; browser height and zero-shift verification stay in CI.
Desk check-ins stay on one line. A long status yields with an ellipsis and a
complete native title; cards below 340 px retain the check-in on the name row.

JOED-79 changes only Desk at widths up to 480 px. The first screen contains
the existing header status control and reserved red/yellow problem line,
Today and Since start with euros and percentages, the one-line Today summary,
and three ranked desk rows. Each row retains its desk mark, name, state word,
Today and Since start euros, tones and state markers. Tapping it exposes the
original complete card, including action, all three figures, chart and learning.
The Account figures, today's clock/chart, Positions and Kept holdings have
separate native button disclosures, initially collapsed. Buttons expose
`aria-expanded` and `aria-controls`, support Enter/Space and have targets at
least 44 px tall. Expansion survives ticks and navigation during the current
page visit, with no additional browser storage or server writes. Resizing
above 480 px exposes every original detail; returning restores phone choices.

Collapsed summaries show the worst actual state and its short reason in one
fixed-height line with an ellipsis. The complete set of reasons remains in
their title and accessible button text. Partial/null row fields and
unmatched desks count even when the overall position panel is fresh. Old or
missing check-ins, stuck desks, blocked learning, unavailable history and
unknown market hours stay visible in their affected summary. Positions shows
its open count and Kept holdings its count. Since start retains a three-line
phone caption whose complete text opens in the existing explanation tip;
Today's one-line summary also opens its complete sentence there.

CSS-only budget at 390×844: 54 px header + 56 px problem reserve +
285 px primary card + 64 px Desks heading + three 66 px rows and two 8 px
gaps = 673 px, leaving 99 px above the bottom navigation's 772 px top.
JOED-82 replaces each 92 px row's automatic tracks and 28 px warning reserve
with explicit 36 px identity/money and 14 px warning tracks, plus 8 px padding
at either end. The reserved warning line remains even when fresh; this keeps
state and tone changes from moving the rows. The CSS gap from the end of that
line to the card/section end is 8 px (previously about 25 px with stretched
automatic tracks); the list itself has no
trailing padding or collapsed-detail gap. P3 measures both gaps at 360/390 in
both themes and retains its 44 px target, first-screen and zero-shift checks.
These are CSS calculations; rendered measurements remain for agm2 CI.
The primary card is 14 + 20 + 32 + 0 + 53 + 24 + 48 + 0 + 44 + 0 + 36 + 14:
padding, date, label, numeral margin, numeral, percent, caption, sentence
margin, sentence target, board-caption margin, board caption and padding.
The numeral, sentence and board-caption margins are explicitly zero on phones;
money type sizes and the three-line Since start explanation are retained. The four
76 px disclosure summaries, their margins, footer and bottom navigation
allowance put the collapsed page at roughly 1,300–1,450 px. These are estimates,
not browser measurements; CI owns rendered heights, both themes, 360/390 px,
no horizontal scroll and zero movement on ticks. 1024/1440 retain their grids.

P3/P5 explicitly open phone disclosures before the existing detailed checks:
AC-19 supporting figures and captions, full desk states/bars/sparklines,
positions, kept exclusion/inertness/worth, nullable rows, cash states, geometry
and tick movement. P3 adds default collapsed 360/390 captures, first-screen
bounds above the navigation, compact-to-full value/ranking parity, page height,
Enter/Space expansion and exact zero-shift checks. P3 failure fixtures and P5
not-exact/cash/partial-position cases separately check the collapsed warnings.
The Positions preview capture opens its disclosure before taking the crop.
`test/phone-first-screen.mjs` adds small, browser-free state/markup tests;
the coordinator runs browser CI and review after this local handoff.

Fix 1 corrects the disclosure handler's tooltip call so one native activation
opens each detail and renders its charts. Missing Cash summaries use the same
missing-feed reason as the figure; unavailable money takes priority over an
old check-in while keeping its true neutral or error icon. Cash's value,
broker caption and independent reason have explicit text separators even in
a collapsed body. The padded full desk detail is the phone header's query
container, preserving the name-row check-in and invisible 44 px term target.
P4 opens those full cards before its unchanged header measurements; the shared
clamp inventory now includes the phone's existing Since start explanation.
P3 requires at least 8 px clearance above the navigation.

Fix 2 retains the warning reserve while limiting its visible text to one
14 px line. Rebuilding a section restores its disclosure bodies' visibility
before handing focus and a pinned explanation to the replacement term.
P3 opens the phone disclosures and scrolls the Account term into view before
measuring its baseline and dispatching the pin click; Account now follows
the expanded desks, so its old unscrolled click was outside the viewport.
The P5 Cash session probe changes the connection on a clone of its baseline,
preserving actions, learning and position identities. Replacing those with
shorter fixture text had shrunk `.now` and `footer` in the expanded cards above
Account. A failed session also requires null current desk/account money and
position marks, independent reasons, unavailable result sources and no current
money evidence; keeping the baseline's observations caused ingress to reject
the probe with 422. The corrected clone meets that contract and retains every
geometry assertion. Its Node test uses the real ingress preflight before
checking isolation and the broker panel state.

Fix round 3 also gives the Results tests' markup-only sinks an empty
`querySelectorAll`: they have no disclosure bodies, while the real patcher now
queries those bodies before a rebuild. That missing test DOM method caused
35 rendering tests to throw before checking their markup. The runtime patcher
and fixed-height summaries are unchanged; the existing real patch test still
covers disclosure visibility and pin/focus handoff.

Fix 3's best-effort CSS height budget at 1440 is about 480 px, versus about
751 px before (the screenshot QA reported about 760 px). This assumes five
16 px lines for the primary reserve, four for the widened secondary captions
(five before), and three for the former nested Cash reserve. The new budget
is 46 px padding + 294 px primary/chart area + 10 px gap + 17 px divider/padding
+ 113 px secondary row. Actual font wrapping requires browser confirmation.
P3 checks the actual height is at most 590 px at 1440, the row spans both
columns and the chart ends with the primary area; its state/theme checks still
require exactly 0 px shift. The card-header sweep requires one check-in line,
an intact status title, no overlaps and a stable height. Check counts stay fixed.
Chart tips retain the opaque theme surface. P3 scrolls the SVG into view before
dispatching a real mouse hover and requires a visible, fully opaque tip with
nonempty text. Browser execution and the cross-family gate remain with the
coordinator; the local fix uses only syntax, focused unit and release checks.
Term underlines stay faint, dotted, 1 px thick and 3 px
below the text, including on hover, focus and while their explanation is open.

`node --test test/status-line.mjs` is the small local presentation suite, also
included in `npm run test:ui` on CI. P3 moves strip/age checks into Details,
checks all Details terms on native focus/hover in a focused page, verifies the
sentence is visible once, opens Details from each status control, and stresses
every status sentence in fixed boxes. Fixture health expectations include the
active KEEP policy and the browser's retained state clock on failed reads.
P5 keeps executor/ledger priority and neutral not-exact checks,
with complete status names/titles, token colours, crops and zero-movement
checks. P4 now exercises desk-card placement only after the check-ins become
stale. P6 checks Details from all four screens, red halt visibility without
interaction, one announcement per transition, silent ticks, and recovery.
Full and browser validation runs on agm2 CI; local work runs only syntax,
the small unit file, and `git diff --check`.

The following paragraph records the earlier header presentation and its
historical evidence; JOED-70 supersedes its header wording and layout.

Capture failure and a degraded executor without a reason leave the header’s
board-data tone and label unchanged; the board does not infer capture failure.
The `ledger_size_limit` reason is red regardless of executor status: the header
uses the existing “Needs fix” label, with “trade record is full — new orders
refused” in its title and accessible name. Desk’s problem sentence is “Trade
record is full: new orders refused (ledger 9,0 MB of 8,0 MB).” The emergency stop
keeps precedence, including an executor/broker disagreement halt.

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
keeps its 16 px phone inset and existing heights. The icon and status share one
line at every supported width; the longest status reserves its width (JOED-57).
The brand's wordmark occupies the only shrinking flex slot, down to its 24 px
icon. A `ResizeObserver` compares the word's natural rendered width with that
slot and hides the whole word if it cannot fit. If the icon-only row still
overflows, measured geometry selects tighter gaps and navigation/status
padding. Neither decision estimates font metrics or uses a wordmark breakpoint;
the PAPER pill, theme target, outer inset and header heights retain their sizes.
Desktop reserves include the sweep's longest stale label and broker suffix;
the phone reserve keeps “Broker unsure”. Hidden grid sizers and inline size
containment keep both status columns fixed across label and broker changes.
Loading alone hides its decorative icon at widths up to 700 px while retaining
the icon's space; its accessible name stays unchanged.
It introduces no new header labels. PR CI's P5
`executor` checks cover all three degraded wire combinations, recovery and ledger
rounding at 1440/1024/390/360 in both themes, with Settings executor-row, header
and Desk explanation crops and no-overflow/no-clipping checks. It records
Chrome’s actual rendered font and checks every existing label plus “Check” fits
on one line at all four widths, including “Stale 2 min” and “Loading”. P3 reuses
P5's header-layout measurement at all 109 widths from 360 to 1440 in 10 px
steps, on every screen, in both themes and the normal and wide fonts. It checks
one-line status height, row containment, overlap and complete wordmarks, then
crosses eight labels with four broker words on Desk and requires zero movement
of the header components, status button, label, word and main content. The old
synthetic 23 h 59 min phone-label overflow exception remains; the live stale
label (“Stale 2 min”) has no exception. History's legend entries allow the
estimate note to wrap inside the chart card at 360 px; entries keep their
single line when space permits. Browser execution belongs to CI. Label
evidence includes line and glyph boxes, intact words, icon containment and no
icon overlap, with an explicit
check that only phone Loading hides its icon. At 360/390 in both themes it
emits `header-{board-ok,needs-fix,data-delayed,broker-unsure,stale}` crops. It
captures a static production-header clone outside the live header, with scripts
running throughout; disabling scripts can consume a pending animation callback
and strand the board's pending-frame flag (JOED-47). After the header loop at
every width/theme, a refresh must increase the board's render count within 5 s.
The large-TB check still requires its exact byte title and accessible name,
formatted text and containment, and logs each failing condition. It
measures exact 0 px movement including the reserved status within the
same page and broker state, and compares every board-health sentence to its
reserve. Node tests compare the six existing header labels (including Loading)
and every broker word against a frozen c1c71a1 renderer fixture, including the
full-ledger “Needs fix” markup and its additional title; tests need no Git history.
The Desk executor sentence, including ledger arithmetic, is computed once per
snapshot and reused on live ticks. Settings formatting and its hidden sizers run
only while Settings renders (the executor sizer is prepared once at module load).
The header’s ledger-priority check remains a constant-time reason comparison;
the performance budgets are unchanged. Browser verification and the coordinator’s
gate remain required.

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

### Release 34 preparation (JOED-97)

JOED-97 reserves `261026232616.0.0` once at `2026-10-26T23:26:16Z`, stable sequence 34,
for follow-up review fixes (JOED-93: JOED-98, JOED-94 and JOED-95).
The prior release is sequence 33, deployed on csb0 at `2026-10-26T20:06:06Z`.
The runtime closure is resealed for this candidate. The revision-10 contract set,
shared presentation pin, legacy anchor and historical artifacts remain unchanged.
Publication, deployment, browser validation and cross-family approval remain coordinator work.

Fix 4 keeps the detail money in fixed 26 px flex lines and sizes its type from
each column and the complete formatted amount, with room for the arrow and
trailing glyph spacing. At 390 px the detail's equal columns are 102 px wide;
the full-size anonymous flex text could exceed that width. The collapsed
summary's separate 96 px Today track does not determine these columns.
Upgrade-write failure diagnostics include the filesystem error code (or
`unknown`), without logging the error message, path or stored values.
