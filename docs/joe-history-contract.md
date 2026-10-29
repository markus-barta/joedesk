# Joe household history contract

`GET /joe/history.json` is the desk time series companion to `/joe/data.json`.
It serves the unchanged `inspr.joe.household.history.v2` contract from
`contracts/history.schema.json`: `schema`, `seq`, `generatedAt`, `receivedAt`,
`points`, `sizeBytes`, and optional `compactedThrough`/`reason`. Each point has
`t`, `desks.<id>.money` (EUR decimal-string money or null with `reasons`), optional
per-desk `accounting`/`historyBasis`, and `totals`. The UI continues to read only
this desk contract; this ticket adds no chart or account presentation.

Each desk's compatibility identity is composite:
`[historyBasis ?? null, accounting.periodStart ?? null, accounting.method ?? null]`.
An explicit basis adds to, and never replaces, the accounting identity. A change
creates a boundary for that desk alone. Untyped old-only series remain one
legacy basis. All-null rows without metadata are unknown, not a new basis;
a trailing unknown row breaks the solid observed series, and matching known
observations on both sides keep that break. The newest contiguous compatible
run supplies each selected desk's observations and comparisons in every range,
including ALL. Older points remain stored; no consumer infers a basis cutover
from a money value.

## Account observations (JOED-150)

The server records whole paper-account equity and cash from `brokerAccount`,
including kept holdings, separately from the desk totals. Amounts preserve the
exact EUR decimal strings, including zero and negative cash; no conversion,
rounding, summing, interpolation or last-good substitution takes place. Only
fresh, unretained, reason-free panel values from an accepted new generation
qualify. Other observations contain null with the existing per-field reason,
or `source_unavailable` when the field was absent. The account's own
`observedAt` is preserved; a timestamp ahead of snapshot generation is withheld
with `clock_ahead`.

`history-state.json` uses envelope `joedesk.history-store.v3` with the existing
history value and an optional `account` on each stored point. Older
`joedesk.history-store.v2` files load unchanged; their points have no `account`
and mean **not recorded**, never zero. New points have this extension
(value-free shape):

```json
{
  "t": "<snapshot generatedAt UTC instant>",
  "account": {
    "observedAt": "<brokerAccount observedAt UTC instant or null>",
    "equity": { "amount": "<exact decimal string>", "currency": "EUR" },
    "cash": null,
    "reasons": { "cash": "source_unavailable" }
  }
}
```

The timestamp `t` remains the accepted snapshot generation, just as for desk
history. `account.observedAt` is the broker observation time, or null if the
account was absent. Each of equity/cash is independently exact or null;
`reasons` contains the null fields only. An existing reason-bearing value is
unavailable even if it contains an amount. No account identifiers are copied.

Desk compaction selects exactly the same indices from identical desk inputs:
endpoints, per-series extrema, gap edges, final observed values per Vienna day,
and composite desk-basis transitions. It retains or removes an entire point,
including its account observation. Account-only extrema/gaps do not change the
desk selection; the short account series is therefore thinned at those same
indices. This preserves all desk comparison and basis behavior. The complete
persisted envelope, account extensions included, stays bounded by 8 MiB;
compaction starts at 80% or above 10,000 points, with the existing 14-day cut.
`sizeBytes` still measures the complete persisted envelope. The desk API omits
account fields while retaining this storage-size diagnostic. Both the desk
projection and account extensions are validated before writing and after load.
A corrupt short store keeps the existing fail-closed recovery policy.

## Daily account closes

`account-closes-state.json` sits next to `history-state.json`, independently
persisted using the same bounded atomic write, fsync, rename and mode 0600.
Envelope format is `joedesk.account-closes-store.v1`; its value has schema
`inspr.joe.account-closes.v1`, `timeZone: Europe/Vienna`, and sorted `days`.

The day boundary uses the board's existing `viennaDay` helper on the broker
observation timestamp. Vienna calendar days align with the existing History
retention/compaction and board day helpers, and work beyond the pinned trading
calendar's coverage. These are last-observed daily values, **not NY market
closing valuations**. Weekends may have entries if exact observations arrive.
The current day remains provisional. DST and NY/Vienna offset mismatches do
not change this rule.

A day's entry is:

```json
{
  "day": "<Vienna YYYY-MM-DD>",
  "t": "<latest exact field observation UTC instant>",
  "equity": { "amount": "<exact decimal string>", "currency": "EUR" },
  "cash": null,
  "equityAt": "<equity observation UTC instant>",
  "cashAt": null
}
```

Each exact field replaces only an older observation of that same field and
date. Equity and cash can therefore have different observation timestamps.
Unavailable samples cannot erase a close or renew its timestamp. An unrecorded
field and its timestamp are both null. A day with no exact account fields has
no entry. Missing days are never synthesized, and nothing carries into the
next day. Repeated broker observations cannot create a new day's close merely
because their snapshot generation or transport receipt advanced. Late broker
observations can update an older field/date without regressing a newer one.

The store retains the latest **2,196 observed calendar dates** (at least six
years even when every date is recorded), bounded to **2 MiB**. Sparse data may
span longer. It survives restart, short-history compaction and the 14-day cut;
short-history corruption or size failure cannot stop independent daily capture.
Missing or corrupt/oversized files start with empty daily data and report
`feed_not_received` or `contract_invalid`, respectively. Loading never rewrites
a damaged file; the next exact observation can atomically start a new store.
Write failures retain prior committed data and report `history_write_failed`;
a later successful write clears the reason. A rename followed by directory-sync
failure honors the committed data while reporting the failed durability check.

## Read-only account endpoint

`GET /joe/account-history.json` returns HTTP 200 with both series, including
when empty. Only GET is accepted (other methods return 405, `Allow: GET`).
It uses the same proxy-authenticated reader requirement as History (anonymous
requests get 401), `Cache-Control: no-store`, CSP and server/History feed headers.
There is no new ingress, credential, pusher contract or browser poll.

Value-free response shape:

```json
{
  "schema": "inspr.joe.account-history.v1",
  "generatedAt": "<short-history generation UTC instant or null>",
  "receivedAt": "<short-history receipt UTC instant or null>",
  "reason": null,
  "points": [
    { "t": "<snapshot generation UTC instant>", "account": "<account observation above>" },
    { "t": "<legacy snapshot generation UTC instant>" }
  ],
  "dailyCloses": {
    "schema": "inspr.joe.account-closes.v1",
    "timeZone": "Europe/Vienna",
    "days": ["<daily entry above>"],
    "reason": null
  }
}
```

`points` is chronological and matches the short History's retained timestamps;
`account` is absent on old points. `days` is chronological with unique date keys.
The top-level reason describes the short History feed; `dailyCloses.reason`
independently describes daily storage. Empty series are arrays, timestamps are
null before short History exists, and no client may treat missing observations
as zero. The route remains useful when either independent store is unavailable.

## Display-only continuity

History draws a second, gray dotted dataset for each desk. These lines are
explicitly estimated: linear interpolation across missing or null spans and
observation intervals longer than five minutes, plus a last-value carry to the
current chart time. A leading segment uses an assumed €5,000 baseline; its
starting time is a display assumption based on the retained history and visible
range, not an authoritative founding timestamp. With no observations, a gray
€5,000 guide is shown while the board still reports missing data.

The renderer builds continuity before clipping to 1D, 1W, 1M or ALL, so a window
inside an outage still contains a line. Solid observations keep the desk color;
gray segments and their tooltips identify the assumption. Range windows end at
the current chart time. This policy applies to each newly encountered gap.
Estimates are never written to `history.json`, counted as broker observations,
or used by P&L, comparison or sparkline calculations. Historical accounting
boundaries remain intact; the display layer does not recover missing records.

When selected J has a validated captured backfill curve in the current
snapshot, the History tile also shows it in a distinct native-currency panel.
The desk and range controls apply to that panel, but its USD or EUR realized
result is never overlaid on the complete EUR desk-equity axis and never written
to this history payload. A 1D selection is a trailing 24-hour window ending at
the latest retained history observation (or the snapshot observation when no
history exists); captured points outside it remain accurately unavailable.

The pusher submits observed snapshots to the authenticated inbox. Repeated or
older snapshot timestamps do not append History points; publisher heartbeats
must not invent financial observations. Account fields remain outside the
immutable desk wire contract and are exposed only by the sibling route above.
