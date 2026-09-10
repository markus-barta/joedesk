# Joe household data contract

`/joe/` is a read-only projection of the paper-trading book. The browser reads
`/joe/data.json` every 15 seconds. The dashboard itself never reads the raw
`book.json`, contacts a broker, or places an order.

The canonical JSON Schema is served as `/joe/data.schema.json`. A synthetic,
non-secret example lives at `docs/examples/joe-data.sample.json`. The example is
not copied into the public package as `data.json`; a missing live projection must
produce an obvious `NO DATA` state rather than plausible-looking money.

## Projection rules

The producer that can read `~/trading-team/shared/book.json` must emit exactly:

- one snapshot with schema `inspr.joe.household.v1`, `mode: PAPER`, and EUR values;
- exactly three unique desks: `j`, `joe`, and `joel`;
- a plain-language desk state: `working`, `sit-out`, or `stuck`;
- one current-action sentence and one learning/iteration summary per desk;
- paper equity, today's PnL, and since-start PnL per desk and in `totals`;
- the real HALT state, gateway health, and a short staleness threshold.

The existing compact snapshot remains valid. Producers may additionally emit
`money.openPnl`, `tradeCount`, and `heartbeatAt` on each desk, plus a top-level
`positions` array. Position rows accept desk, symbol, side, quantity, mark,
market value, day/open PnL, and update time. When those optional fields are not
present, the board shows an explicit dash or empty-table message; it never
invents a zero position or a healthy heartbeat.

The browser endpoint is isolated behind `window.JOE_DATA_URL` (or the
`joe-data-endpoint` meta value), and validated snapshots can be pushed with
`window.JoeBoard.ingest(snapshot)`. That adapter boundary is ready for a future
inbox-backed reader without coupling this static board to an inbox transport.

## Local layout

Grid geometry is browser-local and contains no trading data. GridStack saves it
under `localStorage` key `joe-board-layout-v1`; **Reset layout** removes that key
and restores the checked-in arrangement. The dashboard vendors GridStack,
Chart.js, Hammer.js, and the Chart.js zoom plug-in, so hsb1 does not depend on a
public CDN.

Use `null`, not zero, when a money value is unknown. Set `stuck` and add a short
entry to `issues` when a desk cannot continue. A down gateway, HALT, stale file,
or stuck desk becomes the prominent broken-state banner.

Do not copy raw account identifiers, order payloads, credentials, or the whole
book into this file. `data.json` is a small projection, not an archive.

## Atomic host sync

After the Mac-side `book.json` mapper produces a contract-valid snapshot, stage
and replace it atomically. Adapt only `JOE_WEBROOT` to the hsb1 nginx bind mount:

```bash
JOE_WEBROOT=/var/lib/joe-dashboard
install -d -m 0755 "$JOE_WEBROOT"
jq -e '.schema == "inspr.joe.household.v1" and .mode == "PAPER" and (.desks | length == 3)' joe-data.next.json >/dev/null
install -m 0644 joe-data.next.json "$JOE_WEBROOT/data.json.next"
mv "$JOE_WEBROOT/data.json.next" "$JOE_WEBROOT/data.json"
```

Bind-mount that single file at
`/usr/share/nginx/html/joe/data.json:ro` for the legacy hsb1 LAN board if still
enabled. Primary cloud path is `https://cs0.barta.cm/joe/` behind HostDash
oauth2-proxy / Zitadel. csb0 `joe-board` accepts machine pushes at
`POST /joe/inbox` (Bearer token; no browser OAuth on that path) and serves the
latest snapshot at `/joe/data.json` to authenticated browsers. Canonical hosts
for the full board UI include `cs0.barta.cm`, `cs0`, `hsb1.lan`, Tailscale CGNAT
IPv4 (`100.64.0.0/10`), hsb1 `*.ts.net` names, and localhost. Other public
hostnames stay on the private stub before any `data.json` fetch.

## Release/deploy hand-off

After this repository PR lands:

1. bump the `hostdash` flake input in `nixcfg`;
2. add the hsb1-only `data.json` bind mount/producer wiring;
3. build the hsb1 configuration;
4. deploy hsb1 through the normal HIL-gated host path if the change requires it;
5. verify `http://hsb1.lan/joe/` (legacy) and/or Tailscale IP render three desks if still mounted;
6. verify unauthenticated `https://cs0.barta.cm/joe/` redirects to login via oauth2-proxy;
7. verify authenticated `https://cs0.barta.cm/joe/` renders the GridStack household desk from inbox data;
8. verify `POST /joe/inbox` without token is rejected and with token updates within ≤35s.

This repository change does not perform the nixcfg bump or live deployment.
