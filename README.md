# JoeDesk

Standalone Joe household paper-trading desk: static `/joe/` UI plus a small Node inbox server. Paper projection only — no broker access, no order placement.

**Version:** `0.7.4` (package and UI share `JoeVersion.APP_VERSION` in `public/joe/joe-version.js`).

## Provenance

| Piece | Source |
|-------|--------|
| UI (`public/joe/`) | Extracted from [hostdash PR #21](https://github.com/markus-barta/hostdash/pull/21), `7ffdae42951170b84af6ae713421d6263d344a6d` |
| Server (`server.mjs`, `validate.mjs`) | nixcfg `0c65a3d891ab0c4ed5b689f91f04454e8c787e65` |

This repo inherits the source availability of those trees. Do not add license claims for material that was not licensed in the upstream.

## Requirements

- Node.js 22+
- Server data store at `/var/lib/joe-board` (fixed path; provision on the host or in a container volume)
- Push token via `/run/secrets/joe-board-push-token` or `JOE_INBOX_TOKEN` (≥16 chars) when the secret file is absent

## Setup

```bash
git clone https://github.com/markus-barta/joedesk.git && cd joedesk
```

Provision the data directory and inbox token on your deployment host (not shown here — use your secret manager).

## Build

**Docker (recommended):**

```bash
docker build -t joedesk:0.7.4 .
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
  joedesk:0.7.4
```

## Deploy notes

### Read routes — external OAuth

Browser GET routes (`/joe/`, `/joe/data.json`, `/joe/history.json`, static assets) have **no built-in OAuth**. Authentication for read access is **external**: configure OAuth (or another access gate) in a trusted reverse proxy in front of this service.

The UI gates non-canonical hosts client-side (privacy stub). That is UX only, not a network security boundary.

### Write route — inbox token only

`POST /joe/inbox` accepts machine pushes with `Authorization: Bearer <token>`. Configure the token via the secret file or `JOE_INBOX_TOKEN`. No browser session or OAuth on this route.

### Outside this app

- Deployment secrets (push token file, TLS certs)
- The pusher / producer that maps `book.json` → household snapshot
- Broker, gateway, and HALT machinery

### Preserved contracts

- Storage: `/var/lib/joe-board/data.json`, `history.json`
- Browser `localStorage` keys: `joe-board-layout-v1`, `joe-board-named-layouts-v1`, `joe-board-grid-settings-v1`, `joe-board-theme-v1`
- API paths: `/healthz`, `/readyz`, `/joe/*` as served today
- Schemas: `inspr.joe.household.v1`, `inspr.joe.household.history.v1`
- Vendor JS/CSS under `public/joe/vendor/` with bundled LICENSE files

See `docs/joe-data-contract.md` and `docs/joe-history-contract.md`.
