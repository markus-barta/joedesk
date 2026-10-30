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

The hsb0 pusher submits observed snapshots to the authenticated cs0 inbox. The JoeDesk server appends accepted observations to `history.json`, retaining up to 10,000 points from the last 14 days. A repeat of the latest snapshot timestamp updates that point rather than appending another. Publisher heartbeats must not invent financial observations.
