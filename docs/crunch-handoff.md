# Codex crunch handoff — 2026-09-21

Stack for Markus Opus QA, then Amy. Do not merge to `main` from this pass. No deploy, no nix pin, no live Gateway or secret changes, and no P&L was invented.

## Merge order

1. [#28](https://github.com/markus-barta/joedesk/pull/28) `feat/crunch-settings-edit-limits` → `main` (`8c80240`, unchanged)
2. [#31](https://github.com/markus-barta/joedesk/pull/31) `feat/crunch-settings-ia-eli10` → #28 (`b9cb2d9`, unchanged)
3. [#33](https://github.com/markus-barta/joedesk/pull/33) `feat/crunch-limits-home` → #31 (`587d353`, unchanged)
4. [#27](https://github.com/markus-barta/joedesk/pull/27) `feat/crunch-settings-ssot-map` → #33 (this note; sources panel already on #33)
5. [#26](https://github.com/markus-barta/joedesk/pull/26) `fix/joed17-resilience` → #27 (JOED-17 Gateway banner)
6. [#30](https://github.com/markus-barta/joedesk/pull/30) `feat/crunch-reporting-clarity` → #26 (decision-pulse smoke lock)
7. [#32](https://github.com/markus-barta/joedesk/pull/32) `docs/joed18-harness-health` → #30 (harness contract; not implemented)

## What the stack keeps

- Fleet Config opens on **Desk limits** (ELI10). **Limits home** stays in the same navigation.
- Edit → Diff → Confirm → Propagate, including the review checkbox.
- **Sources — one home per knob** stays under the editor, with field links and deprecated/outside labels.
- Household **Decision pulse** strip above the board. DAY and OPEN stay evidence-gated.
- JOED-17 Gateway / stopped-feed banner: a late or missing heartbeat is yellow and actionable; a snapshot older than three freshness windows is a red stopped feed. Checklist: `docs/gateway-flap-recovery.md`.
- JOED-18 `harnessSignals` proposal in `docs/joe-data-contract.md` only. It is not a schema field and not a UI control. Cadence copy already says settings do not prove a wake ran.

## Residuals

- **#27.** Replaying “land on Sources” made Sources the default detail tab and hid the ELI10 explanation. The auto-merged source renderer also read `entry.legacy` on array rows. That behavior was not kept. The Sources panel already on #31/#33 is the resolution. This PR only carries the handoff so the stack stays open.
- **#30.** The original reporting commit’s HTML/CSS still described the pre-ELI10 fleet rows and overlapped the settings plane. The decision-pulse markup, CSS, and renderer were already identical via #31 `d0f6bb7`, so those hunks were dropped. This PR adds a smoke lock that the strip is present and does not print Day P&L / Open P&L labels.
- **#32.** The cadence-intro commit was already on the stack, so only the harness contract text is new.
- Pairwise merge-tree was clean before the handoff and pulse-smoke commits. Re-check GitHub CI on #26, #30, and #32 after the repaired pushes. #28, #31, and #33 were not rewritten.
