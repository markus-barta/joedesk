# Joe household history contract

`/joe/history.json` is the time series companion to `/joe/data.json`.

Schema `inspr.joe.household.history.v1`:

```json
{
  "schema": "inspr.joe.household.history.v1",
  "points": [
    {
      "t": "2026-09-10T21:45:00+02:00",
      "desks": {
        "j": { "equity": 5001.03, "dayPnl": 0, "totalPnl": 1.03 },
        "joe": { "equity": 5000, "dayPnl": 0, "totalPnl": 0 },
        "joel": { "equity": 9039.93, "dayPnl": 0, "totalPnl": 4039.93 }
      },
      "accounting": {
        "j": {
          "periodStart": "2026-09-10T04:00:00Z",
          "method": "execution-fifo-net-current-fx",
          "detail": "Net of recorded fees; converted at observed FX. Earlier results unavailable."
        }
      },
      "historyBasis": {
        "joel": "joel.stage0-keep-excluded.v1"
      },
      "totals": { "equity": 19040.96, "dayPnl": 0, "totalPnl": 4040.96 }
    }
  ]
}
```

`point.accounting` is optional and maps only desks that supplied accounting
metadata in that snapshot. Existing v1 points without it remain valid and are
not rewritten. Consumers must break a desk's observed line when its accounting basis
changes and must calculate comparisons only inside a common compatible basis
window; a legacy-to-verified boundary is not profit movement. Other desks'
series remain continuous when their own basis is unchanged.

`point.historyBasis` is also optional and maps a desk id to the stable
calculation-definition identifier supplied by that desk. The compatibility
identity is composite: an explicit id adds to (and never replaces) that desk's
`accounting.periodStart` and `accounting.method`. Any difference in the fields
that are present creates a boundary. For points without `historyBasis`, J's
existing accounting period and method remain its compatibility key; fully
untyped old-only series remain viewable as one legacy basis.

The dashboard selects the newest contiguous comparable basis independently for
each selected desk in every range, including explicit `ALL`. Older observations
outside that run remain unchanged in `history.json` and can still be
deliberately inspected there, but they are excluded from observed chart series,
sparklines and comparisons. The UI states that records
were retained without claiming that an unidentified calculation was the same
or wrong. A basis with only one current point is shown as one observation; any connecting
display estimate is separate and never becomes a measured trend or comparison. No consumer may infer a cutover from
the money value itself. All-null rows without calculation metadata are
unknown, not a new basis: a trailing unknown row breaks the solid
observed series, and matching known observations on both sides retain that
break in the measured data.

## Display-only continuity

History draws a second, gray dashed dataset for each desk. These lines are
explicitly estimated: linear interpolation across null values and across rows
more than 20 minutes apart, plus a last-value carry to the current chart time.
The 20 minutes are `GAP_MS` in `time.mjs`, one value shared by the server and
the page: the longest time between two rows that still counts as continuous
reporting, above the producer's slowest normal cadence (one snapshot every
900 s overnight). A leading segment uses an assumed €5,000 baseline; its
starting time is a display assumption based on the retained history, not an
authoritative founding timestamp. With no observations, a gray €5,000 guide is
shown while the board still reports missing data. Where no chosen desk has a
number for more than five minutes, the chart also hatches that stretch (one
legend entry, "No data"); a stretch without rows lasts more than 20 minutes,
so it is always hatched, and a desk missing alone is shown by its dashed line.

Rows at or before `compactedThrough` were thinned by the server to stay inside
its size limit (`compactPoints`: per 64 rows the bucket ends, each series'
extrema, both sides of every presence or basis change, and each Vienna day's
last valued row; later passes thin the kept rows again). Compaction is
gap-preserving and so says where it thinned. Rows more than `GAP_MS` apart are
a gap in reporting, and both rows around a gap are always kept: a pass never
merges across one, and every run of continuous reporting keeps its first and
last row. Inside a run no pass leaves more than `GAP_MS` between kept rows.
Every interval therefore says what it is without a mark on any row, so this
contract and the history store stay as they are and older pages and servers
read them unchanged: an interval of at most `GAP_MS` is continuous reporting,
thinned or not, drawn as observed with the tooltip naming the nearest kept
row; a longer one is exactly a gap in the rows that arrived, drawn as an
estimate and hatched. The page infers nothing from neighbouring rows.
Versions before this rule thinned old rows to hours apart. Where such rows
are still kept, a longer interval at or before `compactedThrough` may be that
thinning as well as an outage: it stays no data, and its tooltip adds
"Thinned or not reported: coverage unknown". Explicit null values survive
thinning and stay estimates.

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
The comparison always uses the window the chart settles on, over the last
stretch of continuous data in it: every chosen desk has a number on its
current basis and every interval is observed by the same rule. A stretch that
starts after the window's first row is named ("Last 3 h 22 min with
continuous data, from …", or "on the current bookkeeping" after a basis
change); nothing is claimed across a stretch without rows. This policy applies
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

The hsb0 pusher submits observed snapshots to the authenticated cs0 inbox. The JoeDesk server appends accepted observations to `history.json`, retaining up to 10,000 points from the last 14 days. A repeat of the latest snapshot timestamp updates that point rather than appending another. Publisher heartbeats must not invent financial observations.
