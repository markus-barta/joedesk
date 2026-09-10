# Joe household history contract

`/joe/history.json` is the time series companion to `/joe/data.json`.

Schema `inspr.joe.household.history.v1`:

```json
{
  "schema": "inspr.joe.household.history.v1",
  "points": [
    {
      "t": "2026-09-08T21:45:00+02:00",
      "desks": {
        "j": { "equity": 5001.03, "dayPnl": 0, "totalPnl": 1.03 },
        "joe": { "equity": 5000, "dayPnl": 0, "totalPnl": 0 },
        "joel": { "equity": 9039.93, "dayPnl": 0, "totalPnl": 4039.93 }
      },
      "totals": { "equity": 19040.96, "dayPnl": 0, "totalPnl": 4040.96 }
    }
  ]
}
```

Producers append a point whenever they publish `data.json` (hsb1 only). Cap retained points (~4000). Never invent points. cs0 must not serve this file as household PnL.
