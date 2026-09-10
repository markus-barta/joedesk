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
      "totals": { "equity": 19040.96, "dayPnl": 0, "totalPnl": 4040.96 }
    }
  ]
}
```

`point.accounting` is optional and maps only desks that supplied accounting
metadata in that snapshot. Existing v1 points without it remain valid and are
not rewritten. Consumers must break a desk's line when its accounting basis
changes and must calculate comparisons only inside a common compatible basis
window; a legacy-to-verified boundary is not profit movement. Other desks'
series remain continuous when their own basis is unchanged.

Producers append a point whenever they publish `data.json` (hsb1 only). Cap retained points (~4000). Never invent points. cs0 must not serve this file as household PnL.
