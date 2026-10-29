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

`history-state.json` remains `joedesk.history-store.v2`, with exactly the
pre-JOED-150 desk fields, size measurement, compaction trigger and selection.
The persisted desk file contains no account data. Its `sizeBytes` is the byte
length of that desk envelope alone.

Account samples live in **`account-history-state.json`**, envelope format
`joedesk.account-history.v1`. The value has schema `inspr.joe.account-series.v1`,
`generatedAt`, `receivedAt`, and chronological `points`. An account point is:

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

The timestamp `t` is the accepted snapshot generation; `account.observedAt` is
the broker observation time, or null when absent. As in desk History, envelope
`generatedAt` and `receivedAt` are the server receipt time, while point `t`
preserves producer time. Validation uses the acceptance contract's shared
`MAX_CLOCK_AHEAD_MS` tolerance, including its boundary, relative to `receivedAt`;
it never clamps accepted producer timestamps to receipt time. Each field is
independently exact or null; `reasons` contains only null fields. Reason-bearing values are
unavailable even when they contain an amount. No account identifiers are copied.
Older desk-only files do not create account points: absent means not recorded,
never zero.

This store independently retains 14 days, with a 2 MiB envelope cap and a
10,000-point limit. At 80% size or above the point limit, one bounded compaction
pass keeps account endpoints, equity/cash extrema, both sides of null gaps,
and the last exact field observations per Vienna day. If still above either
limit, it refuses the write and reports `history_write_failed`. It does not
share desk timestamps or compaction decisions. A failed account write cannot
stop desk History or daily-close recording, and desk corruption cannot stop
either account series. All three stores write in the accepted snapshot step.

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
Both account stores use the following independent recovery policy:

- A missing file starts empty with `feed_not_received`, clearing after its
  first successful recording. No older account observations are invented.
- A file or journal I/O error reports `history_write_failed` without moving or
  replacing the file. A later recording retries the load before appending, so
  temporary read failures cannot restart a healthy series from empty memory.
- A corrupt, oversized or unknown-format file starts empty with
  `contract_invalid`. Before the first replacement write, the server atomically
  renames its bytes to `<filename>.damaged-<UTC instant>` (adding a numeric
  suffix on collision), then fsyncs the directory. The damaged bytes survive.
- Recovery adds `{ discontinuity: { at, reason: "contract_invalid", preservedAs } }`
  to the new envelope and API series. `preservedAs` is the damaged basename.
  Its reason stays visible after successful writes and restarts. A bounded,
  atomic mode-0600 `<filename>.discontinuity.json` journal records the same
  marker before the rename, so an interruption before replacement cannot hide
  the loss. Keep that journal and preserved file with backups. Each later
  corruption gets a new timestamp and preserved name, even if an earlier
  preserved copy has been retired.
- Recognized future versions (`v2` and higher) stay untouched and read-only,
  returning `store_version_unsupported`. New observations continue to the
  other stores. This release never overwrites or quarantines a future format.
- Write failures retain committed data and report `history_write_failed`.
  Successful writes clear a transient write reason; a durable discontinuity
  remains `contract_invalid`. A rename followed by directory-sync failure
  honors the committed data while reporting the failed durability check.

An invalid journal keeps that store read-only with `contract_invalid`; an
unreadable journal is retried as an I/O failure. For recovery, stop the server
and back up the store, journal and preserved copies together. Restore a valid,
matching journal/store pair from backup, then restart and verify the series.
Loss markers deliberately never expire, including after the short retention
window. To acknowledge a loss and clear its alarm, with the server stopped and
the backup retained, remove the `discontinuity` property from the valid store
envelope and retire its journal together; restart and verify both history and
the cleared reason. Clearing only one leaves the other marker active. This
operator action acknowledges the gap; it does not reconstruct missing values.

### Release 39 rollback

A pre-JOED-150 server continues to load the unchanged desk v2 file and simply
ignores `account-history-state.json` and `account-closes-state.json`, including
their recovery journals and preserved damaged copies. No desk-store conversion
is required. Keep the new files with the data backup: rollback pauses account
capture, and returning to this server resumes it without filling that gap.
Future account formats remain read-only if this release is used as a rollback.

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
    { "t": "<snapshot generation UTC instant>", "account": "<account observation above>" }
  ],
  "dailyCloses": {
    "schema": "inspr.joe.account-closes.v1",
    "timeZone": "Europe/Vienna",
    "days": ["<daily entry above>"],
    "reason": null
  }
}
```

`points` is chronological in the independent short account store; it need not
match desk History timestamps. `days` has chronological unique date keys. The
top-level reason and optional `discontinuity` describe short account storage;
`dailyCloses.reason` and its optional `discontinuity` describe daily storage.
Empty series are arrays, and timestamps are null before short account History
exists. No client may treat missing observations as zero. The route remains
useful when any independent store is unavailable. Existing History feed headers
remain desk diagnostics; consumers use body reasons for account-store status.

Desk's whole-account block (JOED-156, `public/joe/account.js` and
`account-model.js`) is the consumer. It reads this route when Desk is shown,
then every 60 s (15 s after a failed read, which keeps the last good series
and says so). A module worker (`account-worker.js`, started under the
release's own path like the History worker) fetches, parses and checks it
and transfers compact columns to the page; it answers "unchanged" when the
page already holds that history. Without module workers the page reads it
itself. 1D and 5D draw `points`, the longer ranges `dailyCloses`
(`equityAt` and `equity`; a cash-only day draws nothing). Only exact values
are drawn: an unavailable value, more than 20 minutes between snapshots or a
missing Vienna day breaks the line with a hatched band, and nothing is drawn
before the first or after the last value. The value the board shows now joins
the line only when it is current and exact. A range longer than the record
says since when it records; the change says what it covers. The store's own
reason and `discontinuity` appear as one line under the chart.

## Display-only continuity

History draws a second, gray dashed dataset for each desk. These lines are
explicitly estimated: linear interpolation across missing or null spans and
observation intervals longer than five minutes, plus a last-value carry to the
current chart time. A leading segment uses an assumed €5,000 baseline; its
starting time is a display assumption based on the retained history, not an
authoritative founding timestamp. With no observations, a gray €5,000 guide is
shown while the board still reports missing data. Where no chosen desk has a
number for more than five minutes, the chart also hatches that stretch (one
legend entry, "No data"); a desk missing alone is shown by its dashed line.

Rows at or before `compactedThrough` were thinned by the server to stay inside
its size limit (`compactPoints`: per 64 rows the bucket ends, each series'
extrema, both sides of every presence or basis change, and each Vienna day's
last valued row; later passes thin the kept rows again, so spacing grows with
age). The server records nothing where no row arrived, so an outage and a
thinned stretch can look alike. The display connects a thinned interval as
observed, with the tooltip naming the nearest kept observation, only where
thinning explains it: it does not cross a Vienna midnight except from that
day's last row (at most five minutes before midnight) into the next day, and
it is no longer than three times the longest of the 16 kept intervals on
either side. Longer intervals stay estimates and, where no chosen desk has a
number, hatched no-data bands. Explicit null values survive thinning and stay
estimates. An outage shorter than the thinning step at its age cannot be told
apart from thinning; History says so under the chart.

The renderer builds continuity over the whole kept history before clipping to
the shown window, so a window inside an outage still contains a line. Solid
observations keep the desk color; gray segments and their tooltips identify the
assumption. The window is a preset (Fit all, Day, Week, Month; a preset longer
than the kept history shows all of it) or a manual view chosen on the chart or
its overview strip; it never leaves the kept history, never shows less than
five minutes (a narrower manual view is widened around its middle each time the
window is resolved, also once newer history allows it), and ends at the current
chart time while it follows the newest. A move by pan, zoom, drag or keys keeps
following only if the window still ends exactly at the newest time.
The comparison always uses the window the chart settles on. This policy applies
to each newly encountered gap. Estimates are never written to `history.json`,
counted as broker observations, or used by P&L, comparison or sparkline
calculations. Historical accounting boundaries remain intact; the display layer
does not recover missing records.

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
