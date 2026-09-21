# Fleet Config: the short operator guide

Fleet Config is the one place to change a board-controlled setting. It is
paper-only; it cannot place a trade.

1. Open JoeDesk and click **Fleet Config** in the top bar.
2. Click the row for what you want to change: **Quota policy**, **Desk fleet**,
   **Cadence**, or **Amy Grok routines**.
3. Change the value in **Edit selected values** at the bottom.
4. Click **Diff**, read the change, then click **Confirm**.
5. Click **Propagate**. The green message names the new `fc-…` revision.

Use **Sources — one home per knob** on the right to see the live file and any
old location. Anything labelled **DEPRECATED / OUTSIDE** must not be used to
change a board knob.

Do not use Fleet Config for passwords, tokens, broker access, or HALT. Those
stay in the host secret workflow or the separate safety workflow.

The old `~/trading-team/shared/fleet-config.json` path is a deprecated mirror;
JoeDesk does not read it. The live file is
`/var/lib/joe-board/fleet-config.json` and consumers reload it by revision.
