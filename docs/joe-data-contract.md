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

### Board health

Producers may emit `boardHealth` and `shortReason` together. Older snapshots
without either field remain valid. `boardHealth` is `green`, `yellow`, or
`red`; `shortReason` is one of these stable codes:

- green: `board_ok`;
- yellow: `snapshot_stale`, `retained_values`, `gateway_degraded`, or
  `open_unavailable_rth`, or `day_pending`;
- red: `halt_on`, `gateway_down`, `equity_unavailable`, `producer_stuck`, or
  `day_unavailable_rth`.

The browser treats this pair as advisory. It derives health again from the
current payload and current time, and accepts the producer result only when it
is worse. This prevents an old producer `green` from surviving after source
timestamps cross `safety.staleAfterSeconds`. Weekday New York regular trading
hours are 09:30 inclusive through 16:00 exclusive. Missing DAY or OPEN is
yellow when equity remains usable. The old red `day_unavailable_rth` code
remains accepted for compatibility; current producers use yellow `day_pending`. Outside those hours a known unavailable or not-wired
DAY/OPEN source does not prevent green when the rest of the board is healthy.

The default board banner contains one coloured light, a short label, a colon,
and a plain-language reason. The subtle “read more” control expands the header
in place to show full diagnostics and the Accounting diagnostic link. It stays
closed by default and supports keyboard and touch.

Consumer-only health reasons do not change the producer schema: a late
late or absent `safety.gateway.lastSeenAt` makes a reported `ok` Gateway yellow and
unconfirmed; a failed browser fetch is yellow while the last snapshot is
recent; a snapshot older than three freshness thresholds is red as a stopped
board feed. The banner gives the reader a reload or Amy escalation action.
See [Gateway flap recovery](gateway-flap-recovery.md) for the operator checklist.

Producers may also emit the additive top-level account observation:

```json
{
  "brokerAccount": {
    "equity": 31482.75,
    "currency": "EUR",
    "observedAt": "2026-09-08T06:00:00.000Z",
    "scope": "paper-account-including-keep",
    "status": "available"
  }
}
```

This is the paper broker account's authoritative EUR `NetLiquidation`, not a
sum of virtual desk equities. Its scope includes KEEP. `observedAt` is the
actual completed broker-book observation and must not advance on publisher
heartbeats. `available` requires a finite `NetLiquidation` whose own currency
proves EUR, a live gateway, and a fresh observation. Missing, invalid, or
foreign-currency values publish `equity: null` with `status: unavailable`.
After upstream loss or staleness, a last-good finite value may be retained with
its original `observedAt` and `status: unavailable`.

`totals` remains the sum of the three virtual desk money objects. If any desk,
including J, has incomplete accounting, the affected total fields remain
`null`; neither the broker account value nor a partial desk sum may replace
them. The server deliberately excludes `brokerAccount` from J, Joe, Joel, and
All bots history. Consumers must continue accepting older snapshots where the
additive object is absent. The board leads with virtual desk equity, labels the
configured EUR 15,000 virtual starting capital separately, and presents the IB
paper account NAV only as secondary whole-account detail: including KEEP and
not virtual desk capital.

### DAY and OPEN evidence

Numeric DAY values are displayed only when the snapshot carries matching
`pnlSources.day` evidence. This prevents an older producer's placeholder zero
from looking measured. The supported methods are IB `DailyPnL` or a durable
start-of-day virtual-equity baseline. Both must prove EUR and the
`virtual-desks` scope; a SOD source also names its exact `periodStart`.
Position-level `dayPnl` is likewise accepted and rendered only while that DAY
source is available; an unproved position zero is not a substitute.

OPEN uses IB unrealized P&L attributed to J, Joe, and Joel, or a producer
calculation from fresh complete execution-owned lots, current marks, and
explicit FX using method `owned-lots-current-mark-fx`. The owned-lots method
excludes KEEP holdings and unowned or netted residuals; it must not fill gaps
with estimates. A complete rollup publishes `money.openPnl` for every desk,
`totals.openPnl` as their sum, and an available `pnlSources.open` record with
one of those methods. Joel's grandfathered KEEP holdings remain outside the
virtual Stage-0 desk scope. Position-level `openPnl` follows the same evidence
gate and the same EUR `virtual-desks` scope.

Each source record includes an availability status, method, EUR currency,
scope, observation time, and short detail. When the Gateway is healthy but a
verified source or SOD baseline is still missing, money stays `null`; the board
labels the dash as not wired or baseline-pending instead of presenting an
outage. A down/degraded Gateway gets a distinct unavailable label.

For a DAY source whose `detail` starts with `session_open_proxy`, the board
labels the value `Session estimate` and retains the full producer detail as its
tooltip. The value is an estimate since the ISO timestamp named by the
producer, rather than an exact start-of-day result.

### J backfill summary

The producer may receive an optional `familyHistory` result from the ledger
adapter through `projectBook(book, { familyHistory })`. A valid result adds only
`desks[j].backfill`; older producers and snapshots without it remain valid.
The public summary is deliberately smaller than the private ledger result:

```json
{
  "backfill": {
    "status": "BEST_AVAILABLE",
    "fullTotalAvailable": false,
    "capturedSubtotal": {
      "realizedPnl": -37.125,
      "currency": "USD",
      "method": "captured-fifo-matched-roundtrips",
      "executionCount": 43,
      "commissionCount": 42,
      "fromInclusive": "2026-09-10T08:00:00.000Z",
      "throughInclusive": "2026-09-10T08:05:00.000Z",
      "points": [
        { "at": "2026-09-10T08:00:30.000Z", "realizedPnl": -4.5 },
        { "at": "2026-09-10T08:05:00.000Z", "realizedPnl": -37.125 }
      ],
      "pointsTruncated": false
    },
    "coverage": {
      "target": {
        "fromInclusive": "2026-09-10T08:00:00.000Z",
        "toExclusive": "2026-09-10T08:20:00.000Z"
      },
      "completeIntervalCount": 0,
      "knownIntervalCount": 1,
      "gapCount": 1,
      "firstGap": {
        "fromInclusive": "2026-09-10T08:05:00.000Z",
        "toExclusive": "2026-09-10T08:20:00.000Z"
      }
    },
    "missingOpeningLotCount": 1,
    "orphanCommissionCount": 1
  }
}
```

`BEST_AVAILABLE` means the captured subtotal is useful but partial. It stays in
its evidenced native currency; a USD subtotal is never converted to EUR when
historical FX is absent. `fullTotalAvailable` can be true only for `COMPLETE`
coverage with finite ledger equity, no gaps, no missing opening lots, and no
orphan commissions. Even then, `backfill.capturedSubtotal` remains presentation
metadata and never replaces `desks[j].money`, household `totals`, or history.

`capturedSubtotal.method` is optional for compatibility. The only evidenced
value is `captured-fifo-matched-roundtrips`: J-family FIFO matched round trips,
net of recorded fees and calculated only from family-owned fills. The board
labels that value “J-family FIFO, net of fees.” An absent or `null` method makes
no FIFO claim. Producers map missing, unavailable, and unrelated account-level
methods to `null`, and must emit `null` when the captured subtotal is
unavailable. Broker account realized PnL or average-cost results must not be
substituted because concurrent activity can share a symbol. This method does
not change or populate full J money, virtual desk totals, History, or FX.

`capturedSubtotal.points` and `pointsTruncated` are an optional pair, so older
backfill summaries without a curve remain compatible. When present, the array
contains at most 2048 cumulative native-currency realized-PnL observations.
Every point inherits `capturedSubtotal.currency`; point objects cannot carry a
second currency or any account, receipt, or execution identifier. Timestamps
must be strictly increasing RFC 3339 values inside the inclusive capture
interval, and the last point must match `realizedPnl` within `0.000001`.
Same-time fills therefore arrive already aggregated. The producer and clients
reject malformed curves rather than inventing an opening anchor, a wall-clock
endpoint, or an FX conversion. `pointsTruncated: true` means only the latest
captured points are shown.

The public projection includes only bounded counts and time intervals. It
discards gap reasons, raw account and execution identifiers, receipt objects,
and the contents of missing-lot or orphan-commission arrays. The J card labels
best-available data as “Captured results (partial)”, shows the native-currency
subtotal and fill count, and states that the full J total is unavailable while
coverage gaps remain. A new `familyHistory` result appears on the next ordinary
snapshot push without changing broker observation time or history semantics.
The J card disclosure and the History tile plot only these actual observations.
Inside History the panel is titled “Captured J results · [currency] · partial,”
uses the existing 1D (exact trailing 24 hours), 1W, 1M, and ALL controls, and
keeps its native-currency scale separate from the complete EUR equity chart.
An empty range is shown as empty; no anchor, endpoint, zero, or FX value is
invented. This remains separate from the preserved household History dataset
and never adds a J, Joe, Joel, or All bots history point.

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
entry to `issues` when a desk cannot continue. The combined board signal keeps
the underlying detail available without placing per-desk diagnostic prose in
the default banner.

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
