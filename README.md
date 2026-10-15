# JoeDesk

Standalone Joe household paper-trading desk: static `/joe/` UI plus a small Node inbox server. Paper projection only — no broker access, no order placement.

**Version:** `26.09.14.17.08` (calendar `yy.mm.dd[.hh.mm]`; package and UI share `JoeVersion.APP_VERSION` in `public/joe/joe-version.js`).

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
nix-build -E 'with import <nixpkgs> {}; callPackage ./default.nix {}'
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
node scripts/check-package.mjs
node scripts/check-joe-layout.mjs
node scripts/check-fleet-config.mjs
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
  -v "$PWD:/repo:ro" -w /repo node:22 \
  node --test test/server-contract.mjs
```

Linux browser smoke (desktop, mobile, privacy) uses `scripts/smoke-joe.mjs` with Chrome — CI/Linux only:

```bash
BROWSER_PATH=/usr/bin/google-chrome node scripts/smoke-joe.mjs
JOE_SMOKE_VIEWPORT=mobile BROWSER_PATH=/usr/bin/google-chrome node scripts/smoke-joe.mjs
JOE_SMOKE_VIEWPORT=privacy BROWSER_PATH=/usr/bin/google-chrome node scripts/smoke-joe.mjs
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
check age and closed reason. Never-received feeds have null age and a closed
reason. It has no money, identifiers, paths or diagnostic text. The legacy
`calendar` scheme remains truthful until P6 completes CalVer3 adoption.

`/joe/state.json` is the protected read model for P3: serverNow, four feeds with
progress metadata, safe data projection and panel states. Anchor serverNow to
the browser's monotonic timer; pass feed metadata and prior cells to the shared
selectors. `valueReceivedAt` is the original retained-cell receipt. Data/history
responses also send `X-Joe-Server-Now`, data generation progress and any closed
feed rejection reason as headers. `contracts/read.mjs` handles SSO redirects,
401/403 and invalid refreshes without replacing the client's last-good value.

`/joe/results.json` returns HTTP 503 with the v2 schema identifier and
`results_not_wired`. It contains no fabricated executor sequence, days or trades;
there is no results ingress until JOED-20/P4. History stores only observations
and null gaps, never the UI's assumed/interpolated continuity values.

P2 persists `data-state.json` (snapshot plus progress and retained-cell receipts)
and `history-state.json` as independent atomic/fsynced envelopes. Closed rejection
reasons have a separate bounded file. Fleet Config keeps its audited v1 file and
a server-owned `fleet-receipt.json` for last-good/receipt retention. Refreshes of
an unchanged revision never reset its age. Corrupt sequence/retention metadata
fails closed; restore a compatible backup instead of resetting sequence state.
Legacy data/history files are neither migrated nor overwritten automatically;
P6 owns the compatible backup and cutover. History's `sizeBytes` measures its
complete UTF-8 storage envelope; compaction begins at 80% of 8 MiB, preserves
endpoints/extrema/gap edges/per-desk basis transitions, and reports an explicit
alarm if the hard cap or a write cannot be satisfied.

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
- Browser `localStorage` keys: `joe-board-layout-v1`, `joe-board-named-layouts-v1`, `joe-board-active-layout-v1`, `joe-board-grid-settings-v1`, `joe-board-phone-order-v1`, `joe-board-theme-v1`
- Phone order is an optional field on named layouts and a separate active draft; desktop geometry retains its existing array format. Legacy layouts derive their initial phone order from desktop positions. On phones, scroll the page between tile drags; helper-edge autoscroll is disabled because tall tiles can otherwise pull against the drag direction. Desktop drag autoscroll remains enabled.
- Fleet Config requires Diff → Confirm before Propagate. Save Preview remains browser-local; Propagate writes only a paper-mode config revision and its durable action record. Secret slots list agenix/Janus capability and path refs only and always show REDACTED; they never display plaintext credentials. HOSTD-52 rotation remains a response hook. See `docs/joe-fleet-config-secrets.md`.
- Gateway light: yellow means the paper connection is unstable or its check-in is late; red means the Gateway reports down. These are health readings, not settings that Fleet Config can fix.
- API paths: `/healthz`, `/readyz`, `/joe/*`, `/joe/fleet-config.json`, `/joe/fleet-config/actions.json`, `/joe/fleet-config/propagate`
- Schemas: `inspr.joe.household.v1`, `inspr.joe.household.history.v1`, `inspr.joe.fleet-config.v1`, `inspr.joe.fleet-config.actions.v1`
- Vendor JS/CSS under `public/joe/vendor/` with bundled LICENSE files

See `docs/joe-data-contract.md` and `docs/joe-history-contract.md`.

### Fleet settings: human path and schema inventory (HOSTD-48)

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
