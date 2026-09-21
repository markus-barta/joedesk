# Fleet Config: the short operator guide

Fleet Config is the one place to change a board-controlled setting. It is
paper-only; it cannot place a trade.

1. Open JoeDesk and click **Fleet Config** in the **Settings · Fleet Config** top-bar button (or use the limits link in board settings).
2. **Desk limits** opens first: set the risk cap, busy-desk maximum or KEEP. Choose **Quota & low-capacity behavior** or **Wake times & cadence** in the same navigation. **Limits home** remains an overview; Amy’s check-ins are also in the navigation.
3. Change the value under its plain-English explanation. Each field says where it applies. For example, a 20% quota reserve keeps 20 of every 100 capacity units for essential work.
4. Click **Review changes (Diff)**, read every change, tick the review box, then click **Confirm changes**.
5. Click **Propagate**. The success message names the new `fc-…` revision written to the shared file. Consumer reload is not confirmed here.

**Save preview** keeps a draft in this browser. Navigation values show that preview;
**Technical · exact keys & saved values** shows the last loaded document.

**Where is this defined?** stays above the settings navigation. It shows the schema,
revision, actual file read, and last propagation attempt. Before the first save,
the board may read its starter example; the strip says so.

Expand **Sources — one home per knob** below the editor for each schema key and
its older locations. Anything labelled **DEPRECATED / OUTSIDE** is not an input
for that board knob. Legacy Mac mirror paths are read-only references.

Passwords, tokens, broker access and HALT stay in the host secret workflow or the
separate safety workflow. Fleet Config displays secret reference names only.
