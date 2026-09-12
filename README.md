# JoeDesk

Standalone Joe household paper-trading desk: static `/joe/` UI plus a small Node inbox server. Paper projection only — no broker access, no order placement.

**Version:** `26.09.12` (calendar `yy.mm.dd[.hh.mm]`; package and UI share `JoeVersion.APP_VERSION` in `public/joe/joe-version.js`).

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
docker build -t joedesk:26.09.12 .
```

Image copies `public/` unchanged. No sample or synthetic `data.json` is baked in — an empty store shows `NO DATA`.

**Nix (static + server install):**

```bash
nix-build -E 'with import <nixpkgs> {}; callPackage ./default.nix {}'
# UI assets: $out/share/joedesk/public/joe/
# server:     $out/bin/joedesk-server
```

## Test

```bash
node scripts/check-package.mjs
node scripts/check-joe-layout.mjs
node scripts/check-fleet-config.mjs
node scripts/run-server-contract.mjs   # disposable Docker tmpfs; never touches host /var/lib/joe-board
```

Server contract tests refuse to run unless `/var/lib/joe-board` is an empty tmpfs mount (see `test/server-contract.mjs`). CI and the runner script use:

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
  joedesk:26.09.12
```

## Deploy notes

### Read routes — external OAuth

Browser GET routes (`/joe/`, `/joe/data.json`, `/joe/history.json`, `/joe/fleet-config/actions.json`, static assets) have **no built-in OAuth**. Authentication for read access is **external**: configure OAuth (or another access gate) in a trusted reverse proxy in front of this service.

The UI gates non-canonical hosts client-side (privacy stub). That is UX only, not a network security boundary.

### Write routes

`POST /joe/inbox` accepts machine pushes with `Authorization: Bearer <token>`. Configure the token via the secret file or `JOE_INBOX_TOKEN`. No browser session or OAuth on this route.

`POST /joe/fleet-config/propagate` accepts the flip plane's JSON `{baseRev, config}` envelope. It requires same-origin browser headers plus the proxy-supplied `X-Auth-Request-User` identity and **must remain behind the same trusted Zitadel SSO reverse proxy as `/joe/`**. The proxy must strip any client-supplied copy of that header before oauth2-proxy supplies the authenticated Zitadel identity; never expose this route directly. The server validates the strict paper-only v1 schema, rejects stale revisions, assigns the next `fc-NNNNNN` revision, and atomically renames it into `/var/lib/joe-board/fleet-config.json` with mode `0644`.

Amy and desk processes consume that JSON file directly and reload only when its top-level `rev` changes; they never scrape JoeDesk HTML. `GET /joe/fleet-config.json` exposes the same current document to the authenticated board. The checked-in `public/joe/fleet-config.example.json` is revision `fc-000000` until the first write. Secret slots contain agenix/Janus reference names only.

Every authenticated propagation outcome is stored in `/var/lib/joe-board/fleet-config-actions.json` with mode `0600` and exposed to the authenticated plane at `GET /joe/fleet-config/actions.json`. Entries contain the timestamp, SSO identity, before/after revisions, approved changed-key names, outcome and a fixed reason code. They never contain before/after values; any attempted secret-slot change is recorded only as `secretSlots.[redacted]`.

### Outside this app

- Deployment secrets (push token file, TLS certs)
- The pusher / producer that maps `book.json` → household snapshot
- Broker, gateway, and HALT machinery

### Preserved contracts

- Storage: `/var/lib/joe-board/data.json`, `history.json`, `fleet-config.json`, `fleet-config-actions.json`
- Browser `localStorage` keys: `joe-board-layout-v1`, `joe-board-named-layouts-v1`, `joe-board-active-layout-v1`, `joe-board-grid-settings-v1`, `joe-board-phone-order-v1`, `joe-board-theme-v1`
- Phone order is an optional field on named layouts and a separate active draft; desktop geometry retains its existing array format. Legacy layouts derive their initial phone order from desktop positions. On phones, scroll the page between tile drags; helper-edge autoscroll is disabled because tall tiles can otherwise pull against the drag direction. Desktop drag autoscroll remains enabled.
- Fleet Config requires Diff → Confirm before Propagate. Save Preview remains browser-local; Propagate writes only a paper-mode config revision and its durable action record. Secret slots list agenix/Janus capability and path refs only and always show REDACTED; they never display plaintext credentials. HOSTD-52 rotation remains a response hook. See `docs/joe-fleet-config-secrets.md`.
- API paths: `/healthz`, `/readyz`, `/joe/*`, `/joe/fleet-config.json`, `/joe/fleet-config/actions.json`, `/joe/fleet-config/propagate`
- Schemas: `inspr.joe.household.v1`, `inspr.joe.household.history.v1`, `inspr.joe.fleet-config.v1`, `inspr.joe.fleet-config.actions.v1`
- Vendor JS/CSS under `public/joe/vendor/` with bundled LICENSE files

See `docs/joe-data-contract.md` and `docs/joe-history-contract.md`.
