# Fleet Config scatter map

This is the inventory for the 2026-09-21 Amy-box review. Its rule is simple:
if Markus can change it on the board, its single source of truth is the document
reported by **Where is this defined?**. The default saved path is
`/var/lib/joe-board/fleet-config.json`; before first propagation the board can
read its starter example. Expand **Sources — one home per knob** below the
ELI10 editor for the matching file and schema keys.

## One source for board knobs

| Knob family | Single source of truth | Old / adjacent location | Decision |
| --- | --- | --- | --- |
| Grok and Codex reserves; green/amber/red behavior | `fleet-config.json#quota` | `quota-state.json`, quota entries in desk journals | Fleet Config; state files are observations only. |
| Busy desk limit, Stage-0 cap, KEEP symbols | `fleet-config.json#desks` | `~/trading-team/CONFIG.md`, desk journals | Fleet Config for board controls; CONFIG and journals remain policy/history. |
| US-open arm, watchers, governor, wake windows | `fleet-config.json#cadence` | Amy/desk scheduler definitions and journals | Fleet Config owns the declaration; scheduler adoption is outside this repository. |
| Amy morning/review/close labels | `fleet-config.json#amy.routines` | Amy routine definitions and journals | Fleet Config for the board declaration; journals remain history. |
| Tool names and status endpoint | `fleet-config.json#tools` | `data.json` | Fleet Config for declared names; `data.json` is a runtime snapshot. |
| Secret capability references | `fleet-config.json#secretSlots` | agenix / Janus host secret stores | Fleet Config may list references only; values never move here. |
| Mac config/docs paths | `fleet-config.json#mac` (read-only legacy metadata) | `~/trading-team/shared/fleet-config.json`, `~/trading-team/shared/docs` | Deprecated. The box scan found no shared Fleet Config file, and JoeDesk has no reader for either path. |

## Other locations found

| Location | What it is | Does it control JoeDesk board knobs? | Keep / move |
| --- | --- | --- | --- |
| `/var/lib/joe-board/fleet-config.json` | Persisted, atomically-written Fleet Config. Created from the checked-in example on first use. | Yes. | Keep as the only live board-control file. |
| `public/joe/fleet-config.example.json` | Safe bootstrap/example fixture used before the persisted file exists. | Only before first propagation. | Keep; it is not a competing runtime source after propagation. |
| `/var/lib/joe-board/fleet-config-actions.json` | SSO-attributed, redacted propagation audit log. | No. | Keep as evidence, not config. |
| `/var/lib/joe-board/data.json` and `history.json` | Runtime snapshot and history supplied to the board. | No. | Keep as telemetry, not configuration. |
| `/run/secrets/joe-board-push-token` (or local-dev `JOE_INBOX_TOKEN`) | Ingress credential for machine snapshot pushes. | No. | Host secret; never Fleet Config. |
| `~/trading-team/CONFIG.md` | Trading charter values, stages, accounts, gateway addressing, research budget, and HALT path. | No JoeDesk code reads it. | Keep as human trading policy until separately migrated with its owner; do not copy credentials or live-stage controls into Fleet Config. |
| `~/trading-team/CHARTER.md` | Governance and hard trading rules. | No. | Keep outside Fleet Config. |
| `~/trading-team/shared/HALT` | Fail-closed, operator-controlled safety interlock. | No. | Keep separate and host/safety owned; never make it a board toggle. |
| `~/trading-team/shared/journal/**` and desk journals | Append-only observations, including quota state, routine runs, and Amy reports. | No. | Keep as history; mark any attempted setting copy deprecated. |
| `quota-state.json` (referred to by desk journals; no file was present on this box scan) | Live quota observation. | No. | Keep as runtime state when supplied; never use it to set reserve policy. |
| `docs/joe-data-contract.md` nixcfg mentions | Deployment hand-off documentation, not a config reader. | No. | Keep as deployment documentation. The nixcfg pin/switch remains a separate declarative delivery step. |

## What is intentionally not moved

- Credentials, tokens, passwords, AGE ciphertext, broker connection access, and
  Zitadel proxy configuration stay host-secret or host-infrastructure owned.
- HALT stays a separate fail-closed interlock. A board cannot clear or weaken
  it.
- Live-stage/account decisions, trading charter limits, and funding/promotion
  gates remain human trading governance; Fleet Config is paper-only.
- Journals, action logs, quota state, and snapshots are facts about what
  happened. They cannot become desired configuration.

## Wiring blocker, stated plainly

JoeDesk now writes and displays the single persisted revision, and it does not
read the deprecated Mac shared paths. Amy and desk scheduler/consumer code is
outside this repository, so this PR cannot redirect those processes. Their
required adoption contract is: read `/var/lib/joe-board/fleet-config.json`,
reload only when its top-level `rev` changes, and treat the old shared path and
journals as non-authoritative. That follow-up belongs with the Amy/desk runtime
owner, not a silent JoeDesk fallback reader.
