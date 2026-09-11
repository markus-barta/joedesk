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
`money.openPnl`, `tradeCount`, and `heartbeatAt` on each desk, plus optional
position detail. Position rows accept desk, symbol, side, quantity, mark,
market value, day/open PnL, update time, and the frozen optional extensions
`currency` and `accountingScope`.

A desk may also carry an `accounting` object beside (not inside) `money` with
all three fields: RFC 3339 `periodStart`, method
`execution-fifo-net-current-fx`, and a 1–240 character printable-English
`detail`. Its presence means that desk's total PnL is scoped to that verified
period and method; absence retains the legacy since-start meaning. For J, the
current producer period begins at `2026-09-10T04:00:00Z` (10 September in New
York), combines J and J2–J5, deducts recorded commissions, and converts using
explicit observed FX. Unverified 2–3 September records are excluded rather
than described as losses or lifetime performance.

A desk may independently carry a `historyBasis` string: a stable, lowercase
calculation-definition identifier (1–96 characters; letters, digits, dots, and
hyphens). It is not a poll, deployment, or snapshot identifier. A producer
must change it only when that desk's money definition becomes incompatible
with its earlier observations. The corrected Joel Stage-0 projection uses
`joel.stage0-keep-excluded.v1`; it excludes the grandfathered KEEP SXR8 and
TSLA×1 positions from Joel money. The tag begins on the first newly published
observation and must never be backdated onto existing history.

`historyBasis` does not replace J's `accounting` object. J continues to use its
verified execution-FIFO period and method metadata, while Joe and Joel remain
independent desk series. An absent `historyBasis` retains legacy/untyped
semantics and must not be guessed from an equity value.

### Position coverage semantics

Position detail is optional at every level. A missing `positions` key means
**unavailable** — the consumer must not treat absence as a known-empty book or
infer EUR, Stage-0, or desk ownership from it.

| Shape | Meaning |
|---|---|
| key absent | unavailable for that scope |
| `[]` | complete known-empty coverage for that scope |
| `[{…}]` | one or more supplied rows for that scope |
| `null`, non-array, or invalid row | invalid snapshot (rejected by server validation) |

Producers should prefer per-desk `desks[].positions` arrays. Each row still
carries an explicit `desk` that must match its parent desk id. A legacy
top-level `positions` array remains accepted when rows name their desk
explicitly; unknown symbols must never default to Joe or any other desk.

Optional row fields keep their own null/absent rules:

- `currency` — when absent, position monetary values are unavailable for
  display (not silently EUR). When present, it is an uppercase three-letter
  ISO 4217 code such as `EUR` or `USD`.
- `accountingScope` — when absent, accounting classification is unavailable
  (not silently Stage-0). When present, it is either `stage0` or `legacy`.

When optional position fields are not present, the board shows an explicit dash
or empty-table message; it never invents a zero position, a currency, an
accounting label, or a healthy heartbeat.

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
