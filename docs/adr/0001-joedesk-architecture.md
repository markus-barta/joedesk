# ADR 0001: JoeDesk contracts and resilient read model

Status: P1 foundation, P2 server, P3 UI and P4 Results merged into rebuild/v2;
P5 Settings candidate for JOED-25 (last section). Earlier text: P2 server integration
candidate for JOED-22 (mapping below), under JOED-19. Coordinator
review remains outstanding. No runtime cutover, producer edit, push or deployment
is part of P1. P1 left the existing server and browser on legacy contracts;
the P2 candidate below connects the server, while browser integration stays P3.

Evidence: JOED-19 approved HTML/spec r3.1, decisions, research, art direction,
inventory, build handover §§1–9 and Amy's failure history a–j. The HTML is a
design reference; its generated demo trades, hard-coded session hours and sample
account hint are not production data or calculation code.

## 1. Contracts and ownership

Choose plain ES modules and native CSS/SVG components. The approved component
list already calls for small vanilla components. Three desks, four screens and
a small read model do not justify a framework, hydration or a dependency graph.
Use dependency-free modules with pure selectors and explicit errors, then
separate transport, persistence and rendering. No GridStack, layout manager,
layout storage, service worker, broker client or trade command enters the rebuild.
Old layout keys are left untouched and unread. Theme, observed events and the
reviewed Fleet Config draft retain their narrowly scoped browser storage.

`contracts/manifest.json` identifies `joedesk.contracts.v2`; five JSON Schemas,
`reason.schema.json`, `common.schema.json` and `index.mjs` form one offline set.
`validateContract(kind, payload, {stage})` is the same entry point for server,
browser and pusher CI. Browser imports require native JSON import attributes;
the server uses Node 22+. No runtime schema fetch, code generation or dependency
installation is needed. JSON Schema callers outside JS can use the same schema
files, then must run the shared semantic checks for ownership, evidence, sums
and KEEP; structural schema validation alone is insufficient.

The tiny validator implements only the vocabulary exercised by these schemas
(listed and checked in `test/contracts.mjs`), not general JSON Schema. Formats
are asserted, objects are closed, array lengths and wire sizes are bounded,
timestamps are real calendar-valid UTC instants, and decimals are strings with
at most eight fractional digits. No coercion, defaults or extra-field stripping.
Errors contain schema paths and rules, never rejected values or arbitrary keys.

| Contract | Candidate wire identifier | Effective owner |
| --- | --- | --- |
| data | `inspr.joe.household.v2` | pusher; exceptions below |
| history | `inspr.joe.household.history.v2` | server |
| results | `inspr.joe.household.results.v2` | paper executor 8470; `receivedAt` is server |
| fleet-config | `inspr.joe.fleet-config.v1` | server, accepting reviewed human policy |
| healthz | `inspr.joe.healthz.v2` | server |

Every property has an `x-owner`, or inherits exactly one from its enclosing
property when expanding a shared definition. The ownership traversal test
expands every reference and union. No field has multiple authorities:

- The pusher owns data sequence/generation, live API positions and valuation,
  desk/family accounting, DAY/OPEN evidence, heartbeat, learning and masked broker
  facts. J combines J2–J5; Joe and Joel remain separate. Data's
  `safety.halt` is the pusher's safety observation.
- Executor 8470 owns results days, FIFO round trips, commissions and close FX,
  and every field under `data.safety.executor` (including its own halt, brakes
  and `gatewayReachable`). The pusher may relay those facts without recomputing
  them. Broker API positions are not a substitute for executor order/fill truth.
- The server owns every `receivedAt`, generated-history fields, health projection
  and Fleet Config revision/update metadata. A transport relay does not transfer
  semantic ownership. Board-derived ratios are selectors, not competing fields.

The handover's sequence, decimal and reason requirements are incompatible with
the freeze's earlier additive-v1 proposal. Explicitly revise data/history to v2
and the not-yet-shipped results proposal to v2; never silently widen v1 or
autoconvert unproved money. Amy and JOED-20 must agree before activation.
Fleet Config keeps all v1 keys, editability, revision/conflict behavior and the
Diff → Confirm → Send flow. The P1 schema corrects the legacy timestamp-pattern
escaping and additionally requires SXR8 and TSLA to remain in KEEP. Those
validation fixes are candidate safeguards; the active legacy validator is not
changed in P1. The numeric v1 policy cap remains a bounded config value; it is
not valuation data and must be parsed into decimal units before calculations.

Schema IDs are protocol revisions, not release coordinates. Release identity
will use INSPR-CalVer3 (§8). Validation accepts exactly `manifest.contracts[kind]`
and the matching schema const; it does not read `manifest.compatibility`. That
list documents the current singleton IDs, not an implemented multi-version
allowlist. Compatibility is never inferred from version ordering. Old/unknown
schemas and invalid payloads return a transport-neutral `status: 422`;
`validateAndRetain` retains the identical
last-good value for all five contracts, and `acceptSnapshot` adds snapshot sequence
and receipt handling. P2 must map rejection to HTTP 422 before any atomic write,
and persist a separate safe rejection reason. Transport oversize remains HTTP
413 at the pre-parse body limit; an overbound parsed contract returns 422.
P1 tests exercise this boundary, not a claim that the legacy HTTP server now
accepts v2. Malformed JSON remains HTTP 400 in P2.

Results has one storage exception for the midnight-straddle predicate documented
in `docs/joe-data-contract.md`: its 422 response is unchanged, while the first
qualifying rejection preserves the feed reason and rejection file and logs
`rollover_resend_pending`. Only instants and failing dates enter that event.
Acceptance re-arms the in-memory flag, as does restart; a second rejection is
stored normally, and a missing resend surfaces through normal 60-second staleness.
Data/history ingress and the revision-6 contract package remain unchanged.

## 2. Freshness truth

Data, history and results carry an independently monotonic positive safe-integer
`seq` and UTC `generatedAt`. Producers persist sequences across restarts; P2
persists accepted sequence and generation-progress metadata across board
restarts. Exact/replayed or decreasing sequence returns 422
`sequence_replayed`; regressing generation/receive clocks return 422
`clock_regressed`. Recovery requires a higher valid sequence, not clearing the
last-good file. No wall-clock-derived sequence or guessed producer identity.

Ingress forbids `receivedAt`; the server stamps it after validation. Served
snapshots require it. Receipt age is server now minus server receipt, never
producer clock minus browser clock. P2 serves its clock so the browser can anchor an
elapsed monotonic timer; a client clock error cannot make old data fresh.
Future producer clocks do not make receipt age negative or extend freshness.
The ingress clock tolerance is exactly 5 seconds: `generatedAt` at receipt
+5000 ms is accepted; anything later is rejected as `clock_ahead` before a
snapshot/history write. A producer more than 5 seconds fast will have every
push rejected. Restore its clock synchronization (NTP), then send a higher
valid sequence; do not clear the board stores or reset sequence to recover.
Server clock regressions require an operator diagnostic, not a freshness reset.
Selectors take only validated served snapshots; missing/invalid data `receivedAt`
or invalid supplied `generatedAdvancedAt` fails closed with `contract_invalid`
for money/account/position and Gateway panels, while absent progress metadata
still falls back to the valid receipt anchor.

At receipt age below 60 seconds a reported value is fresh; exactly 60 seconds
is stale. The 30-second producer cadence gives this two-cadence threshold.
`generatedAdvancedAt` records the receive time of the last advancing generation.
New sequences with unchanged `generatedAt` do not advance it. After 60 seconds
without generation progress, data is stale with `producer_frozen`, displaying
the progress age. Otherwise stale displays receipt age and `snapshot_stale`.
Gateway check expiry applies only while receipt age is below 60 seconds and
generation is not frozen. At and after the stale boundary, otherwise valid
money/account/position values stay visible as stale, including on a cold load
without prior selector state; expiry never replaces this with a broken or empty
cell. Explicit upstream/field reasons and rejected feeds still take precedence.
This metadata stays outside producer JSON. All error codes come from the one
closed enum, including transport and storage failures.

The Gateway signal is exclusively `apiSessionReady` plus `checkedAt` and a
reason when false. A port, container status or executor `gatewayReachable`
cannot set it true. **Choose explicit nulls while the session is dead or
unconfirmed**, rather than treating a new envelope as a new valuation. A missing
`safety.gateway`, or a ready check aged 60 seconds or more, is
`gateway_unconfirmed` (the freeze's “Gateway unsure” for absent/late checks).
The bound is two 30-second cadences; exactly 60 seconds is no longer fresh.
Checks later than their producer's `generatedAt` cannot confirm current money.
The shared validator compares `checkedAt` with `generatedAt`. Selectors use
`(generatedAt - checkedAt) + (now - generatedAdvancedAt)`: the first difference
uses only the producer clock, the second only the anchored server clock.
Without progress metadata, the accepted receipt is the fallback anchor.
A producer clock 5 seconds ahead or 61 seconds behind cannot cause flicker or
premature expiry. A frozen generation keeps ageing from its original progress
anchor. The Gateway panel displays this check age, rather than receipt age;
an invalid/future check has unknown age. An otherwise fresh feed whose check
expires between receipts invalidates its money/account/position cells with
`gateway_unconfirmed`; a stale/frozen feed keeps its freshness state as above.
That stale exemption covers only expiry between receipts; a gateway already
unconfirmed at generation stays broken with `gateway_unconfirmed` at every feed age.
When `apiSessionReady` is false, or confirmation is missing/expired, every
supplied desk/total money field (including total P&L, which depends
on marks) and broker equity must be null with a closed per-field/account reason.
Position marks, market values and DAY/OPEN must be null; the position set must
carry a reason even when its rows are empty. DAY/OPEN sources become unavailable.
Omit `desks[].moneyEvidence` while the session is dead or unconfirmed;
`observed` evidence alongside null money is rejected with `sessionUnavailable`.
Static position identity/quantity and the original observedAt may remain for
diagnosis; they cannot make the position panel fresh. A violation returns 422
`contract_invalid` with `sessionUnavailable`/`reasonRequired`, keeping last-good.

The conforming outage is accepted, but its money, paper-account and position
panels are broken with the explicit upstream reason. Previously observed money
is separately retained with its original board receipt, never relabelled as a
current observation. The ten-minute `a-gateway-up-but-dead` fixture freezes all
source observations while sequence/generation advance; the counterpart
`a-dead-session-current-money` rejects a contradictory non-null valuation.
`a-missing-gateway` and `a-frozen-ready-gateway` cover the two unconfirmed cases
with nulls and `gateway_unconfirmed`; each has its own 20-push regression over
ten minutes with frozen observations and advancing seq/generatedAt. Each test
also rejects contradictory current money, checks original retained ages and
proves recovery on a genuinely newer ready check. Static rows with null marks
can remain diagnostic; selectors withhold a still-valued row set when its check
expires, retaining prior rows only with their original receipt metadata.
`test/contracts.mjs` repeats 20 dead-session pushes as well. Independently
complete history/results remain available with their own receipt ages.

P2 must also track advancement of the Gateway's check timestamp; a repeatedly
relayed old ready check must become unconfirmed even if other data advances.
That persisted tracker must un-freshen **all desk/family money, paper-account
equity and both position panels**, as well as the Gateway panel, using nulls
plus `gateway_unconfirmed` and original last-good receipt metadata while the
feed is otherwise fresh. Stale/frozen feeds keep their stale state unless an
explicit upstream/field or transport error applies. Persistent check-progress
integration remains P2, including restart and clock-skew integration tests;
P1 bounds reported check age and tests both producer-skew directions in memory.
Broker observation times never reset a cell's receipt age. Missing retained
`valueReceivedAt` means unknown age, never
the newest envelope's age; P2 persistence must always carry that metadata.

## 3. Panel isolation and approved UI mapping

`panel-state.mjs` defines fresh, stale with age, not reported, and broken with a
closed reason. `fixtures/panel-state-table.json` names every tested panel/cell;
each incident records the expected state, age, reason and retained flag for all
25 entries. Fixtures for rejected/unreachable feeds fail ten minutes after the
last accepted receipt, so resetting age on failure cannot pass the table test.
State precedence is rejected feed/explicit reason → broken, missing/null without
reason → not reported, then stale/fresh. Computed gateway expiry adds a broken
reason only for an otherwise fresh feed; it cannot mask `snapshot_stale` or
`producer_frozen`. Gateway `ageSeconds` is the generation-relative check age
plus server elapsed time; the stale exemption covers only expiry between receipts,
so generation-time gateway failures still make the Gateway panel broken.
Other cells keep their receipt/progress/retention ages.
False HALT and a known-empty position list are reported values. Missing rows
are never known-empty. Independent
history, results and Fleet Config continue when data fails. An explicit null
with a field error may display a separately retained prior value, labeled as
last-good; it cannot enter current totals or observed history as fresh data.
Every displayed value from a rejected or unreachable feed has `retained: true`,
including false HALT and known-empty lists. A missing value with no prior value
has `retained: false`. The selector carries server-owned `valueReceivedAt`
outside the wire payload and preserves it through successive null/error states;
the retained value's age is now minus that original receipt. P2 persists this
metadata with the last-good values. Successful refreshes never stamp an old
retained field with the new snapshot's receipt.

P3 connects per-cell selectors to the frozen Desk hero, desk cards, runtime rows
and History. A single null does not blank the hero, a desk or the page. P2/P3
preserve the approved health labels and reason copy, including the stricter
stopped-feed/RTH severity presentation; the four data states do not replace that
presentation. The new enum is a wire error vocabulary, separate from legacy
`board_ok` and other presentation labels. Unknown codes are contract failures.

The five Today figures map to totals DAY/OPEN/total/equity and broker equity.
DAY/OPEN require their available method, currency, scope and observation;
SOD additionally needs `periodStart`. Totals require complete corresponding
desk values and exact sums. Positions explicitly come from the live IB API;
side-file truth is rejected. Native currency stays native. Optional company
names, opened times, learning, accounting and captured J metadata have schema
homes. The masked account hint is optional and restricted to paper `DU…dddd`,
narrowing the freeze's generic account-prefix pattern; no hint ships in fixtures.

### Legacy producer fields → candidate v2 mapping

This is an explicit producer migration, agreed with Amy before activation, not
an automatic legacy-to-v2 converter. Owners below are all **pusher**; the board
alone owns retention and its receipt metadata. Unavailable copy is selected from
the closed reason, never by parsing arbitrary diagnostic detail.

| Legacy field / meaning | v2 field and rule | Approved UI use |
| --- | --- | --- |
| `desks[].moneyEvidence.status = observed` | Preserve optional `moneyEvidence.status` as const `observed` | Distinguish actual producer observation from board retention |
| `desks[].moneyEvidence.observedAt` | Preserve `moneyEvidence.observedAt` with observed evidence; producer diagnostic time, not a substitute for server receipt | Observation detail; retained age uses the original server receipt |
| `moneyEvidence.status = carried` | Do not send `carried` as current evidence: publish null equity/total P&L with closed per-field reason `retained_values`; DAY/OPEN follow their own evidence. A known dead/unconfirmed session takes its upstream/`gateway_unconfirmed` reason for all money instead. Omit `moneyEvidence` until observed again. Board retains prior cells with `retained: true` and original `valueReceivedAt` | `Valuation input {age} ago` and retained-values yellow presentation, using retained receipt age; unknown if receipt metadata is absent; never current totals/history |
| `pnlSources.day.method = sod-virtual-equity`, genuine SOD | Preserve method plus required `periodStart` | `SOD · virtual desks · since …` |
| `pnlSources.day.detail` starts `session_open_proxy` | Explicit method `session-open-estimate`, required `periodStart` naming the actual estimate start; preserve bounded `detail` | `Session estimate`, distinguishable from genuine SOD without parsing text |
| Other available DAY method | Preserve `ib-daily-pnl`, `observedAt`, EUR and virtual-desk scope | `IB DailyPnL · virtual desks` |
| Available OPEN method | Preserve `ib-unrealized-pnl` or `owned-lots-current-mark-fx`, observation/currency/scope | Approved unrealised source caption |
| `pnlSources.day.detail`, `pnlSources.open.detail` | Preserve optional diagnostic strings, at most 240 characters; never a reason or freshness authority | Source tooltip detail; no status inferred from wording |
| Unavailable DAY/OPEN status and producer wording | Preserve `status: unavailable`; map cause to `pnlSources.{day,open}.reason` and affected `money.reasons`/`totals.reasons`; values null. The source reason is a selector fallback | `gateway_down`/`upstream_lost` → `Unavailable · Gateway down`; `gateway_degraded` → degraded copy; `baseline_pending` → `DAY is waiting on data`; other closed codes use the approved reason copy |
| `brokerAccount.status = unavailable` with old equity | Publish null equity plus `brokerAccount.reason`; board owns any displayed last-good NAV and its receipt age. `observedAt` stays the producer observation | `· unavailable · last observed {age} ago`; account cannot be fresh during a dead session |

The candidate's DAY method enum is closed; an arbitrary estimate name fails.
A legacy `session_open_proxy` detail without the explicit estimate method also
fails with `estimateMethodRequired`; it cannot silently masquerade as real SOD.
`b-session-open-estimate` and finding 3's regression test prove observation and
detail preservation, the distinct method, required start, unavailable reason
mapping, and rejection of `carried` or arbitrary reason text. P2/P3 retain the
approved health severity/grace; these P1 data states do not implement its colours.

P4 Results uses executor closed trips, Vienna daily equity closes and current
snapshot equity for today; Day drawdown uses intraday history. Closed trade
net, fees, counts, extremes and calendar cells are realised only. No-trade
periods show dashes and the approved empty copy. The benchmark is explicitly
null until Markus chooses one. JOED-20 absence shows the approved not-wired
state, never synthetic zero results. P4 must implement the freeze's scratch
threshold (absolute net below €0.005), small-sample, no-loser, drawdown and
empty-period tests. Generated design trades never ship.

P5 preserves all Settings keys and audited stale-revision conflicts. Phones
remain read-only. LIVE remains locked under OPS-266; even the typed-phrase
dialog cannot send a request or change mode. PAPER is fixed in both contracts.
KEEP SXR8/TSLA are excluded from desk totals/results and always inert in the
UI; their native values are included only in the broker account total. This
package contains no trading transport or action API.

`panelStates` takes the accepted Fleet Config KEEP list (from the config feed,
or its fourth argument). Any matching symbol goes only to Kept, regardless of
the producer's scope/desk. SXR8/TSLA remain an unconditional safety floor when
config is missing or retained. A scope/KEEP disagreement flags both row panels
with `source_not_authoritative`; it also withholds the affected desk's current
money and family totals, rather than attempting an unproved subtraction. An
unattributed disagreement withholds all desk money. Prior cells may be shown
only as retained. Independent desks and the inclusive broker NAV stay separate.
The payload's scope is never rewritten. `h-keep-policy-mismatch` proves a new
config-protected DEMO row cannot remain a desk position or trusted desk total.
P2/P4 and producer CI must use the same accepted policy to exclude all configured
KEEP symbols from accounting/results; the two hard-coded symbols are a safety
floor, not the full policy.

## 4. Time

P2 implements one `time.mjs` for NY day, Vienna day/ISO week, RTH boundaries
and calendar iteration. Use explicit IANA zones, cache formatters, and use a
pinned market calendar for holidays/early closes. Ordinary RTH is
[09:30, 16:00) America/New_York. A Vienna Results date is determined by
`closedAt`, distinct from the NY accounting day. Do not hard-code a six-hour
offset or display 06:00/15:30/22:00 when the actual offset differs.

P1 supplies 24 literal acceptance vectors in `fixtures/time-vectors.json`.
`test/time-vectors.mjs` checks them against an explicit-zone Intl oracle:
both midnights, open/close inclusivity, both instants at each DST transition,
the autumn 25 Oct–1 Nov 2026 five-hour interval, and the spring 8–29 Mar twin.
The spring mismatch lasts three weeks. The production module is deliberately
deferred; P2 must run these same vectors against it, then add holiday and
early-close vectors. The test oracle is not product code.

## 5. Money

Each measured value is `{amount: decimal-string, currency}`. No implicit EUR,
binary floating-point accumulation, fabricated zero or cross-currency sum.
`decimalUnits` converts up to eight fractional digits into BigInt units for
exact addition/subtraction and comparisons. P4 adds exact multiplication,
division and explicit final display rounding, including half-cent scratches;
never round every intermediate trade/statistic.

Converted results record FX base, quote, decimal rate, source and observedAt
at close. Entry/exit prices remain in native currency; gross/fees/net are
explicit EUR and net equals gross minus fees exactly. Captured J results stay
on their own native scale and never populate complete EUR history or totals.
An unavailable conversion remains unavailable. The pusher owns valuation FX;
executor 8470 owns close FX. P1 proves decimal sums, fee subtraction and unit
consistency; P4 must prove FX arithmetic and the complete §4.2 Results math.

## 6. History and bounded storage

The existing server already prunes at 10,000 points/14 days; Amy's unbounded
append concern remains relevant to bytes, write cost and the executor ledger.
Do not claim the current file has no point cap. P2 adds an 8 MiB hard bound and
a warning at 80%, compacts intraday observations in one bounded pass and
publishes an explicit `history_size_limit`/`history_write_failed` alarm instead
of silently swallowing failures. Reserve daily observed closes for Results;
its all-time retention belongs to the executor's separately bounded store,
not an endlessly growing board JSON array (100,000 trades/40,000 days and
8 MiB per response are the P1 limits; JOED-20 must define paging before them).

Only complete observed values enter measured series; null gaps are retained.
For each of the four money fields at **every point**, a non-null family total
requires non-null values for J, Joe and Joel and must equal their exact decimal
sum. A missing desk/field is incomplete just like null: reject with
`incompleteDeskSum`; unequal complete sums reject with `deskSum`. In
`f-history-gap`, J equity and family equity are both null with a reason, while
other observed fields/desks remain valid. `f-history-partial-projection` supplies
a real missing J value alongside a family total: 422 `contract_invalid`,
retaining the earlier history. The regression covers every money field, missing
desk, missing field, null and unequal sums, not merely a top-level error label.
Deduplicate by accepted generation/sequence, not receipt heartbeats. Preserve
the composite accounting/historyBasis identity independently for each desk.
No partial family result, carried value or basis cutover becomes profit.

P3 builds display continuity before clipping a range: grey dotted hold or
interpolate from an explicitly assumed €5,000 per desk, across missing spans
and beyond the last observation. Solid means observed. Estimates never enter
P&L, comparisons, sparklines, history storage or Results. Time-axis min/max
are explicit; no categorical financial timeline. Tests required in P2/P3:
empty, leading/internal/trailing gaps and a range wholly inside an outage;
basis breaks; retained money exclusion; bounded compaction preserving endpoints
and basis transitions; near-limit writes and alarm visibility. P1 provides
gap/rejection fixtures and contract bounds, not a history renderer/compactor.

## 7. Health and authentication

P2 adds unauthenticated read-only `/joe/healthz` with canonical version/scheme,
contract-set version, receipt-derived snapshot age and exactly four feed
states/reasons. Schema is an exact nested allowlist: no money, account/desk/trade
IDs, actor, file path, free diagnostic detail, token or full snapshot. The
health validator's rejection tests cover nested additions. Existing `/healthz`
and `/readyz` remain legacy probes until that change is separately integrated.

P6 must declaratively exempt only the health path from SSO and test it without
a cookie. Protected reads stay protected; a 302 is `auth_required`, not JSON
or successful live verification. Browser failures retain last-good and show
why; refresh never invents a new producer receipt. Cookie/session policy stays
with OPS; the board cannot repair an expired SSO session.

Optional OPS proposal: provision a separate read-only machine identity for
agent data reads through a narrowly scoped route. OPS owns issuance, storage,
rotation, redaction, proxy header stripping and negative authorization tests.
It must never reuse the inbox credential or grant push/config/trading access.
No credential is requested, created, read or embedded by this package. Public
health is sufficient for deployment smoke even if this option is deferred.

## 8. Build, deployment and version adoption

JOED-19 explicitly chooses **INSPR-CalVer3**, machine `inspr-calver-3`, canonical
`YYMMDDhhmmss.0.0`. This supersedes JOED-13's v2 plan; P6 must rescope/close that
ticket with the recorded owner decision. Published/live release authority remains
legacy `calendar` until P6 completes the migration inventory/gates. P6a may set
`release.json` to its reserved CalVer3 candidate for local builds while keeping
adoption closed; this does not change the deployed version. P1 does
not relabel package.json, existing releases or tags. Reserve one UTC coordinate
for an immutable release set; preserve release_sequence continuity and record
the legacy anchor. Protocol schema IDs remain independent.

P6 vendors the complete approved shared presentation bundle from `inspr-at/inspr`
at an exact full source commit, config digest and independently reviewed
manifest digest. Verify closure, sizes, hashes, missing/extra/untracked files
offline on every build. Review the saved presentation pin; do not invent a pin
in this ADR or fetch mutable settings at runtime. One thin adapter draws the
six-segment Pretty default, supports SemVer/reduced motion/focus/touch, and
copies the exact canonical coordinate including `.0.0`; accessibility and
tooltip include UTC. Pretty draws neither `v` nor `.0.0`. Carry forward any
explicit template selection. A bundled but unused renderer is not adoption.

Pin runtime/base image by digest and Nix inputs by immutable revision; the
current floating `node:22` development runner/image is not reproducibility
evidence. New JS dependencies: none. Versioned asset URLs reference one release
closure, with no service worker. P2 must package `contracts/` in both Docker
and Nix artifacts and serve only the explicit offline schema/module allowlist.
P1 intentionally changes neither install artifact nor legacy route table.

Declare the board/pusher/executor contract-set digest and exact compatibility
IDs together in release evidence. Stage producer compatibility tests before
cutover; pin all halves declaratively or prove their declared compatibility.
Do not roll v2 data into a v1 board. Keep previous artifacts/pins and a tested
data compatibility backup. No compose override, live container edit or hot-patch.
The production host gate must include `cs0.barta.cm`; P1 checks the actual
current function, P3 ports this test to the replacement host module.

P6 supplies and rehearses one operator command, `just rollback-joedesk`, in the
owning deployment repo: select the recorded previous compatible board/producer
pins and data backup, use its normal human-controlled switch, then run health
smoke. This command is a required future deliverable, not an existing verified
command. All changes in nixcfg/producer repos belong to their owners and review
paths. A release is complete only after anonymous `/joe/healthz` reports the
expected canonical version/schema/feed ages, protected reads reject anonymous
access, and Tick/Markus verify the signed-in approved UI. No production host
connection or smoke was run in P1.

## 9. Performance and package boundaries

Bound inputs before parse (P2), validate in linear passes and cap nested arrays.
Persist once per accepted snapshot; reject replay without cloning or history
work. Never recompute coverage over the full ledger per field, repeatedly clone
the whole payload or rebuild Intl formatters inside inner loops. P1's acceptance
path clones only once after validation; its schema/semantic checks are bounded.
OPS owns regression benchmarks for the pusher's combineIntervals/coverageFor
and accounting routines. The board cannot fix producer CPU by polling faster.

P3 budgets on the reference 390/1024/1440 layouts: no poll-triggered task over
50 ms, a normal patch under 16 ms on the agreed reference device, at most one
animation-frame batch per feed update. Data polls at 15 s, history at 30 s,
freshness text at 1 s; charts update only on changed inputs. Downsample only
display data, preserving extrema/basis transitions. P2/P3 record measured
worst-case 256-position/10,000-point traces and fail an agreed CI budget.
The fixed 6-row calendar, reserved values/heights, opaque overlays, honest
scales and reduced-motion behavior remain the freeze's AC-1…AC-47 obligations.

Where the budget is measured (LEAD decision, JOED-23 fix round 3): the
budget above (a normal patch under 16 ms, no task reaching 50 ms) is
measured on a named reference device, mbp2606 or mbp2607, by
`scripts/budget-reference.mjs` (`npm run budget:reference`); each record
names the device. CI runners are slower and vary from run to run, so CI
enforces a regression guard of 2.5 × the reference budget on the same
workload (`scripts/browser/budget.mjs`): a normal patch at most 40 ms, a
History draw at most 125 ms, no task reaching 125 ms.
The CI guard re-measures once on a task-only breach and fails if it reproduces; the reference budget never re-measures.
Recorded reference:
mbp2607 (Apple M5 Max, 18 cores, HeadlessChrome 153.0.8010.12, Node
v26.11.1) on 2026-10-15: Desk patch worst 7.7 ms, History draw worst
11.3 ms (8 MiB cold) and 5.7 ms (live), no long task at 390, 1024 or 1440.

Packages after P1: P2 server acceptance/health/time/history; P3 shell/Desk/History;
P4 Results and JOED-20 wiring; P5 Settings/mode; P6 CalVer3/build/deploy/rollback.
Their runtime tests are not substituted by P1 fixture tests. The coordinator
runs the cross-family gate after this worker exits; Amy reviews producer scope,
Tick reviews UI implications, and deployment remains human-controlled.

## Failure classes: mechanism → proof

`test/failure-fixtures.mjs` runs every named fixture below against the full
panel-state table. These are synthetic reconstructions, not captured production
payloads. Amy-owned recordings can replace them after safe anonymization.

| Class | Preventive mechanism | P1 proof | Later integration proof required |
| --- | --- | --- | --- |
| a Gateway up but dead | API-session readiness and check-age bound; dead/missing/old check requires null current money/marks plus reasons; board retention never current | `a-gateway-up-but-dead`, `a-dead-session-current-money`, `a-missing-gateway`, `a-frozen-ready-gateway`; three 20-push regressions and the exact 60-second boundary | P2 persisted check progress invalidates all money/account/position cells as well as Gateway; OPS real session probe, never TCP-only |
| b Null accounting / DAY | Per-field reasons, evidence gates, complete exact sums, last-good display | `b-equity-null-gateway-ready`, `b-weekend-no-sod`, `b-incomplete-family`; null sibling/retention test | P3 hero and desk render with one null, no red flash on brief retention |
| c Image regression / CPU | Exact contract allowlist, persistent sequence/progress, bounded linear work, immutable compatible pins | `c-old-producer-image`, `c-frozen-producer`, `unknown-schema`, `stale-receive-age`; replay/size tests | OPS image-pin recreation and CPU benchmark; P2 restart persistence |
| d Routing/deploy | Declarative routing, canonical-host inclusion, version-bound live smoke/rollback | `d-routing-stub`; production-host function test | P6 proxy path smoke and rehearsed rollback with previous pin |
| e Layout manager | Plain fixed modules, no layout reads/writes or GridStack dependency | `e-layout-storage-unavailable`; contract import/selector test with storage and GridStack getters that throw | P3 no-storage browser render at three widths; remove old GridStack checks with code |
| f History | Per-point complete three-desk exact sums, null gaps; observed basis separation and display-only dotted continuity | Real partial-point rejection in `f-history-partial-projection`, corrected `f-history-gap`; finding 2's missing/null/sum tests for all fields | P2/P3 compaction, continuity, clipping and basis-break tests described in §6 |
| g Expired auth / unverifiable live | Retain last-good on SSO failure, explicit auth reason; public allowlisted health | `g-expired-sso`; nested health leakage rejection tests | P2 endpoint and P6 unauthenticated smoke/SSO-negative tests |
| h Stale secondary positions | Live-API source only; Fleet Config KEEP owns routing and mismatches withhold untrusted rollups | `h-secondary-position-source`, `h-keep-policy-mismatch`; finding 5's policy/scope routing test | OPS producer open-order/position truth reconciliation and config-aware exclusions |
| i Store cap | Byte/item bounds, size alarm, bounded rollup and explicit executor failure | `i-executor-ledger-cap`, `i-history-size-alarm`, `i-oversize-data`; byte/point limit tests | P2 near-cap compaction/write failure; OPS ledger compaction/recovery |
| j Time | One explicit-zone time module, NY accounting/Vienna results distinction | `j-ny-midnight-gap`; all 24 time vectors, both odd seasons | P2 module runs same vectors plus pinned holidays/early closes; P4 Vienna bucket tests |

## Separate proposed owner tickets (not filed or implemented here)

These are proposed scopes for OPS/Amy, not JOED-21 implementation authority.
The coordinator must deduplicate/file them in the owning personal OPS project;
no hsb0 files, pins, secrets, executor or infrastructure are edited by P1.

1. **OPS proposal: pusher sequence and receive protocol.** Persist monotonic
   seq across recreate, advance generatedAt only for actual new generation,
   never send receivedAt, accept safe server receipt/rejection responses and
   publish API-session check progress. When the session is not ready, absent or
   unconfirmed by a ready check younger than 60 seconds, publish
   null current money/marks plus closed per-field/account/position reasons;
   advancing seq/generatedAt must never turn relayed old observations current.
   Test frozen generation, retry, restart, clock regression and ten minutes of
   an accepting socket with a failed, absent or frozen-ready session check.
   Coordinate P2's durable check-progress tracker: unconfirmed checks must also
   un-freshen every desk/family money cell, paper-account equity and both position
   panels with nulls plus `gateway_unconfirmed`, not only Gateway, while the feed
   is otherwise fresh; preserve stale/frozen precedence and compute check age
   using producer-relative age plus server progress elapsed time. Persist original
   retained-field receipt metadata and provide compatible rollback.
2. **OPS proposal: shared contracts in producer CI.** Vendor this exact complete
   contract set/digest in the producer repo and JOED-20, test ingress fixtures
   with the shared JS semantics, agree v2/decimal/evidence/owner mappings with
   Amy, and declare board/pusher/executor compatibility in declarative pins.
   Include a recreate-from-pin test and a bounded CPU regression benchmark.
3. **OPS proposal: closed reason enum adoption.** Map real gateway, ownership,
   baseline and store failures to the shared enum per field; preserve unknown
   data as absent/null, never invent zeros, never emit arbitrary reason strings.
   Adopt the field-by-field legacy mapping in §3: carried valuation becomes null
   plus `retained_values` and board retention with original receipt age; session-open proxy
   becomes explicit `session-open-estimate` with its actual start; unavailable
   wording becomes a closed reason with approved copy, preserving bounded
   diagnostics. Preserve observed evidence and DAY/OPEN detail fields. Use the
   accepted full Fleet Config KEEP list for exclusions, not only scope or the
   two mandatory symbols. Test every Amy failure recording and API-session
   truth; add codes only by reviewed contract-set revision.
4. **Optional OPS proposal: read-only machine data identity.** Provision and
   rotate a narrowly scoped read capability independently of ingress/SSO;
   implement deny-write/deny-config and redaction tests. Public health does not
   depend on it. No secret values in tickets or fixtures.

JOED-20 already owns the results producer; its executor-ledger compaction and
bounded retention remain OPS-owned, not an excuse for a board-side trade path.
The worker marker and version-adoption outcome are recorded on JOED-21.

## Deferred review notes

These notes preserve the round-1/round-2 review follow-ups. Phase ownership is
an integration obligation, not a claim of runtime completion in P1.

| Review note | Disposition / owner |
| --- | --- |
| Compatibility text claimed a manifest allowlist that validation did not read | **Fixed here:** §1 states the exact `manifest.contracts[kind]`/schema-const behavior. `compatibility` is descriptive; P2/P6 must agree and test any broader compatibility before activation. |
| History sizing by points/items underestimates v2 bytes | **P2:** measure serialized UTF-8 bytes, including envelope/metadata, before persistence; compact before the 6.4 MiB warning (80% of 8 MiB) and enforce the 8 MiB hard cap. The valid v2 point measures about 791 B: 10,000 such points are about 7.5 MiB before envelope overhead. Count limits are secondary, not a byte budget. Results paging/retention stays P4 with JOED-20. |
| Three additional time cases | **P2/P4:** add Vienna-midnight bucket behavior independently of the NY accounting day; distinguish both occurrences of New York's repeated 01:xx hour by UTC instant; cover extended-hours events after 18:00 New York. Existing boundary vectors do not prove these consumer behaviors. P2 owns clock/calendar vectors; P4 owns Results bucketing. Amy's 2027 spring mismatch vectors (US 14 March, EU 28 March) also belong to P2. |
| Gateway signal absent from healthz | **P2:** add an allowlisted gateway confirmation/check-age/reason projection, separate from feed freshness; no money, identifiers or diagnostic text. **P6:** verify the anonymous endpoint and SSO exception. |
| healthz `not reported` with a closed reason | **P2:** preserve and explicitly test this accepted combination when no feed has been received; retain null age and a safe closed reason. Test missing-feed and failed-refresh distinctions through the endpoint. |
| `e-layout-storage-unavailable.clientContext` is never consumed | **P3:** exercise the actual renderer with unavailable storage and layout globals at all three reference widths. P1's separate throwing-global import/selector test is the executable proof; fixture metadata alone is descriptive. |
| `g-expired-sso` covers data only | **P2/P6:** exercise auth failure and last-good age independently for data, history, results and Fleet Config through protected reads; anonymous health remains usable. |
| `b-incomplete-family` nulls all three desks | **P2/P3:** add a single missing desk with two observed sibling desks, no family sum, and unchanged sibling ages. Preserve per-field isolation and the approved yellow/no-red-flash grace. |
| `b-equity-null-gateway-ready` has fresh total P&L alongside null equity | **P2/P3:** confirm producer evidence for independently observed total P&L; add the coupled unavailable-equity/total-P&L recording when both depend on missing marks. Never infer profit from carried equity. |
| Results proposal renamed v1 → v2 | **P4 / JOED-20:** coordinate `inspr.joe.household.results.v2`, decimal money, seq/receipt ownership and shared validation before producer activation; no silent v1 widening. Coordinator must include JOED-20 in cutover/pin compatibility evidence. |
| Browser smoke | **P3 / coordinator:** **BLOCKED** by the installed NIX-445 browser guard in the prior native attempt. Saved runner includes the new gateway module and exact schema-error assertions; it still needs a supported browser run after worker exit. **P3/P6:** full signed-in design/live smoke remains separate. No bypass or browser-pass claim. |
| Low 4: observed money evidence during a dead session | **Fixed here:** `sessionUnavailable` rejects `desks[].moneyEvidence` during dead, absent or expired-check sessions, even with all money null. |
| Low 5: carried → null lacked a named reason | **Fixed here:** §3 and OPS proposal 3 name the closed `retained_values` code; dead/unconfirmed-session reasons take precedence. P3 owns the approved yellow retained-value presentation. |
| Low 6: retained value without receipt metadata reset its age | **Fixed here:** age stays null/unknown; it never borrows a newer feed receipt. **P2:** persist `valueReceivedAt` for every retained cell and prove restart behavior. |
| Low 7: baseline error path always named DAY | **Fixed here:** `baselineRequired` reports `$.pnlSources.{day,open}.periodStart` for the actual failing period. |
| Check already 20s old at generation: fresh → broken → stale | **P3 copy sign-off:** money is fresh until +40s, broken with `gateway_unconfirmed` from +40s to just before +60s (empty money on a cold load), then stale with its value from +60s; elapsed times are from the advancing receipt. |
| Amy's executor-vs-broker disagreement (orders, fills, brakes) | **P5 / producer; Amy sign-off required:** real disagreement needs executor order/fill/brake evidence. Gateway reachability and API-session readiness are independent signals, so P2 restores P1 executor selection and the original dead-gateway fixture. The closed reason remains available for actual producer evidence; P2 does not infer it from reachability. |

## P1 verification boundary

`npm test` runs the new contracts/fixture/vector suite and the 18 existing HTTP
tests in a local disposable Docker container with no network and an empty
tmpfs store. `npm run check` retains the current runtime's full check set.
The optional `npm run test:contracts:browser` smoke serves only local module
fixtures and tests the same entry point in installed Chrome with storage
unavailable. This worker's native launch was refused by the installed NIX-445
browser guard; it is **BLOCKED**, not a passed browser test. The coordinator can
run the saved script in its supported browser environment after worker exit.
No guard was bypassed. This optional smoke is separate from the required P1
Node tests and from P3's full approved-design browser gate.

Fix2 evidence: five named `fix2 finding 1`–`5` regressions were first run with
only tests changed on `4d4a218`; all five failed for the reported defects. After
these fixes, all 68 contract/fixture/time tests pass on native Node 24 and
isolated Node 22. The 18 existing HTTP tests pass with networking disabled and
an empty tmpfs; `npm run check` and `git diff --check` pass. The local Colima
instance was started solely for those isolated tests and returned to its prior
stopped state. No push, deployment, production-host probe, review gate or other
model CLI was run. Coordinator review remains pending.

Fix3 evidence: `npm run test:contracts` passes **77 tests, 0 failures** on native
Node 24.20.0, including the five fix2 regressions, two 20-push unconfirmed-session
regressions, the 60-second boundary/recovery checks and low 4–7 regressions.
A separate read-only in-memory replay loaded the original contracts directly
from `7b3eec2` without a checkout: both missing and frozen-ready gateway signals
left money, account and positions fresh after 20 pushes. The same contradictory
pushes now return 422 and retain last-good as broken; conforming fixtures accept
null money/account/marks with `gateway_unconfirmed` and 609-second retained
money age. Compact sample history points measure 787/791 bytes.
All 422 contract tests and rejection fixtures name their exact rule and path;
sequence/clock rejections now provide those structured diagnostics too.
`npm run check` and `git diff --check` pass. The unchanged legacy HTTP server
suite and optional browser smoke were not rerun in this round; the prior fix2
HTTP evidence above is historical, and browser verification stays BLOCKED for
the coordinator. No push, deployment, production-host access, review gate,
delegation or other model CLI was run.

Fix4 evidence: all five new A/B regressions first failed against the unchanged
`e19b0ef` implementation. After the fixes, `npm run test:contracts` passes
**82 tests, 0 failures** on native Node 24.20.0, including all fix2/fix3 tests.
Receipt and generation-freeze cases cover 59.999, 60.000, 60.001 and 90 seconds
across all 20 gated cells. Cold loads at 60 and 609 seconds keep all 17 money
cells visible as stale. The no-push check-expiry test uses a 30-second-old
receipt, so an expired check still cannot show fresh money before feed staleness.
The three rewritten fixtures again expect `producer_frozen`/`snapshot_stale`;
other changed fixture expectations correct only Gateway check age (including
609 seconds in `a-frozen-ready-gateway` and 129 in `c-frozen-producer`).

A separate read-only, in-memory replay loaded the original modules directly
from `e19b0ef` without a checkout or proof files. At 60 seconds, old code gave
broken money, a cold-load null and `gateway_unconfirmed` for frozen generation;
new code gives stale money and `producer_frozen` respectively. For each skew
(+5 seconds / −61 seconds), 20 advancing pushes with five probes per receipt
produce 100/100 fresh, valued observations across all gated cells. Old code
gave 60/100 broken probes for +5 seconds and 100/100 for −61 seconds. A check
already 20 seconds old at generation displays 29 seconds after 9 elapsed,
instead of the old 9-second receipt age. The tests also prove its frozen
check age reaches 149 seconds while money's generation-progress age is 129.
`npm run check` and `git diff --check` pass. The unchanged legacy HTTP suite and
optional browser smoke were not rerun; browser smoke remains coordinator-owned
and BLOCKED as recorded above. No push, deploy, production-host access, review
gate, delegation or other model CLI was run.

Fix5 evidence: all three new C/D regressions first failed against the unchanged
`498d53b` selector. After the fixes, `npm run test:contracts` passes **85 tests,
0 failures** on native Node 24.20.0. Missing and already-600-second-old ready
checks stay broken with `gateway_unconfirmed` at +60 and +300 seconds, with
cold loads and retained prior money covered. Missing/invalid receipt and invalid
progress metadata fail closed with `contract_invalid` across all 20 gated cells;
retained money keeps its original receipt and age. All fixtures are byte-identical
to `498d53b`, preserving the earlier stale/frozen, skew and session-null regressions.

A separate read-only in-memory import of the `498d53b` selector proves C in
4/4 probes: old ready checks previously became stale and missing gateways became
not reported, while the fixed Gateway panel stays broken consistently with money.
D's 4/4 probes at +9/+600 seconds show missing receipt/progress previously made
all 17 money cells fresh even at ten minutes; invalid progress made them fresh
at +9 seconds and stale at +600. Both now stay broken with `contract_invalid`
and zero fresh money cells. No checkout or proof files were written.
`npm run check` and `git diff --check` pass. The deferred notes record P3 copy
sign-off for the 20-second-old check's fresh → broken → stale transition.
The unchanged legacy HTTP suite and coordinator-owned browser smoke were not
rerun. No push, deployment, production-host call, review gate, delegation or
other model CLI was run.


## P2 server candidate — JOED-22

This branch connects the merged shared package to the server; it is not a
producer/UI cutover. P2 adds no trading action, LIVE path, deployment or release
coordinate. `calendar` remains the actual release scheme until P6, so the health
schema accepts the explicitly tagged current legacy identity as well as
CalVer3; it rejects mismatched schemes and invalid dates. LEAD accepts the
`calendar` health scheme and packaging of `server/`, `time.mjs`,
`market-calendar.json` and `release.json` beyond the original contracts-only
packaging wording; the existing Docker base/CMD and deployment/compose stay
unchanged. Closed reasons and selector handling are tested together. Contract
manifest revision 2 retains the exact v2 identifiers and adds candidate revision
metadata. Its complete shared-package delta from P1 needs coordinator
compatibility review before activation:

- The closed reason enum adds `executor_broker_disagreement` and
  `results_not_wired`, plus the five fix1 codes `clock_ahead`,
  `feed_not_received`, `market_closed`, `calendar_unavailable` and
  `history_compacted`. Executor selection retains P1 behavior; actual
  order/fill/brake reconciliation remains P5/producer work with Amy's sign-off.
- `acceptSnapshot` rejects generation beyond receipt +5000 ms as `clock_ahead`
  with the safe `$.generatedAt` / `clockAhead` diagnostic, before persistence.
- Shared selectors accept durable gateway check-progress metadata, validate its
  receipt/clock anchors, use its age for Gateway and current money expiry, and
  run the session check even when the data feed has a rejection. A rejection
  cannot bypass session or KEEP constraints. Never-received null values map to
  `not reported` / `feed_not_received`; false HALT stays a reported retained
  value. Non-identical replay rejections map to advisory `stale`; exact duplicate
  payload digests leave the server's display state and receipts unchanged.
- History adds optional server-owned `compactedThrough`. Fix2 makes it metadata
  without a required reason: successful compaction follows ordinary receipt
  freshness and becomes `snapshot_stale` at 60 seconds without updates. Earlier
  P2 `history_compacted` envelopes remain readable and follow the same age rules;
  that legacy reason still requires `compactedThrough`. The enum code remains
  compatible, but new successful compactions emit metadata alone.
- Health requires server-owned `serverNow` and the closed nested Gateway
  projection (`confirmed`, `checkAgeSeconds`, `reason`). The version schema
  accepts the declared legacy `calendar` coordinate alongside `inspr-calver-3`;
  semantics validate the scheme/coordinate pair, real date and confirmation
  consistency. These changes do not adopt CalVer or widen the data schema IDs.
- The new shared `acceptRead` boundary handles SSO redirects/status failures,
  validates served contracts and closed reasons, requires Fleet receipt time,
  and carries server generation/check progress. A validated HTTP 200 can retain
  the server's last-good snapshot plus its rejection reason on a cold load,
  preserving original receipts rather than discarding it.

Integration targets `rebuild/v2`, not `main`. Producer/UI activation and any
nixcfg deployment-pin movement remain P6/coordinator work after compatibility
approval; this worker does not push or deploy.

`data-state.json` atomically combines the accepted v2 snapshot, generation
progress, gateway check-progress watermark and per-cell valueReceivedAt.
History has an independent byte-bounded envelope; compaction also reserves each
Vienna day's final observed values. Rejection reasons stay in a
separate safe bounded file. The original legacy data/history files are not
silently converted or overwritten. A valid stored Fleet Config is loaded before
first ingress and its receipt survives reads/restarts. Corrupt sequence or
retained-receipt metadata fails closed. Each store has at most one retry file;
a post-rename sync error cannot roll the in-memory sequence watermark backward.
An unreadable, invalid, byte-count-invalid or oversized history store disables
history writes until operator recovery/restart and is never overwritten.
Valid snapshots continue advancing their durable sequence and money-board
receipts; only History stays broken with `history_write_failed`. Its alarm
survives every accepted snapshot and restart. Restore a compatible valid
history backup through the owning operations workflow before restarting.

The protected `/joe/state.json` serves serverNow, feeds/progress and selectors
for P3. `/joe/data.json` withholds current money/marks with closed reasons while
its otherwise fresh gateway check is unconfirmed; prior observations remain in
separate retained cells with original receipts. Stale/frozen precedence stays
as specified above. Health checks current confirmation independently of a
stale feed. Future/unconfirmed checks cannot poison the valid-check watermark.
Results is an HTTP 503 v2 error envelope with results_not_wired, without invented
executor sequence, receipt, days or trades. The executor owns any future producer.

The worker's ignored local status file is coordination state, never a product
artifact. This ADR and the JOED-22 tracker retain the item-to-test mapping.
All `P2 …` names below are `test/server-contract.mjs`; time cases are
`test/time-vectors.mjs`, run against the production module as well as the oracle.

| P2 obligation | Exact test names |
| --- | --- |
| ADR §1/§9: bound bytes before parse; malformed 400; unknown/invalid 422 before snapshot/history writes; keep last-good and serve closed rejection | `P2 acceptance: 400 malformed, 413 streamed bound, 422 contract failure precede snapshot writes`; `P2 transport: chunked oversized input responds 413 without resetting the connection` |
| ADR §2 / class c: server receivedAt; monotonic seq, generation/receive regression and frozen-generation progress across restart | `P2 restart: seq, generation progress and receive regressions stay durable`; `P2 durability: a post-rename sync failure cannot roll sequence back in memory or after restart` |
| ADR §2/§3 / deferred Low 6: retained valueReceivedAt for every cell across repeated null/error states and restart | `P2 retention: every retained cell keeps valueReceivedAt through nulls, rejection and restart`; `P2 outages: 20 dead, missing and frozen-ready pushes retain original money through restart and recover` |
| ADR §2 / class a / OPS proposal 1: durable gateway check advancement gates all 17 money/account cells and both position panels; two producer-skew directions, stale/frozen precedence, future check recovery | `P2 gateway: persisted old-check progress invalidates every money, account and both position panels`; `P2 gateway: stale/frozen precedence, initial check age and check regressions`; `P2 gateway: a future unconfirmed check cannot poison the valid-check recovery watermark`; `P2 outages: 20 dead, missing and frozen-ready pushes retain original money through restart and recover` |
| ADR §3 / class b / deferred single-desk and coupled-PnL notes: isolated unavailable desk, observed siblings, no incomplete family sums or carried equity profit | `P2 isolation: single unavailable desk and coupled equity/total P&L keep sibling receipts`; `P2 history sums: every field rejects missing/null desks or fields and unequal family sums` |
| ADR §3 / class h: accepted full Fleet Config KEEP policy before first ingress, mandatory SXR8/TSLA floor and untrusted-rollup withholding | `P2 KEEP: accepted Fleet Config policy withholds affected money and measured history`; `P2 Fleet receipt: stored policy constrains first ingress; unchanged reads and restart preserve its age`; `paper is fixed, KEEP is excluded from results and cannot be removed from fleet policy` |
| P1 executor behavior: reachability never implies API readiness or order/fill/brake disagreement; Amy/P5 owns real reconciliation | `P2 executor: reachability and API readiness remain independent in both directions` |
| ADR §4 / class j / deferred extra time cases: NY/Vienna day, ISO week, RTH, all 24 literal P1 vectors, pinned holidays/early closes, 2027 spring, Vienna midnight, repeated NY hour and extended hours | `time vector: <all 24 fixture ids in fixtures/time-vectors.json>`; `time: pinned holidays and early closes are closed at the exact boundary`; `time: 2027 spring mismatch spans US 14 March through EU 28 March`; `time: Vienna midnight and ISO week are independent of NY accounting day`; `time: repeated NY 01:xx instants remain distinct; extended hours after 18 NY stay outside RTH` |
| ADR §6 / class f: observed-only history, generation dedupe, per-point complete exact three-desk sums, null gaps and independent composite basis identity | `P2 history: dedupe generation, null gaps and composite per-desk bases survive restart`; `P2 history sums: every field rejects missing/null desks or fields and unequal family sums`; `P2 gap storage: empty, leading/internal/trailing and outage-only windows remain null observations`; `P2 daily closes: compaction retains every Vienna day final observed equity before null gaps` |
| ADR §6 / class i / deferred byte sizing: UTF-8 bytes including envelope, 80% warning compaction, extrema/endpoints/gap/basis edges, exact 8MiB and +1 failure; explicit size/write alarms | `P2 compaction: UTF-8 envelope warning compacts before 6.4MiB and preserves extrema and gap/basis edges`; `P2 hard cap: exact 8MiB complete envelope writes; +1 byte fails explicitly before persistence`; `P2 storage: data and history write failures are explicit and preserve independent last-good`; `P2 history metadata: compacted history stays fresh across restart and turns snapshot_stale at 60 seconds`; `P2 history cadence: 16 days of 30-second observations remain fresh through repeated compactions` |
| ADR §7 / class g / deferred gateway and not-reported health notes: anonymous exact nested allowlist, actual version/scheme, contract-set version, server clock, four receipt-aged feeds and gateway check confirmation/age/reason | `P2 health: anonymous exact allowlist, never-received null ages and failed-refresh distinctions` |
| ADR §7 / deferred g-expired-sso: auth failures and original independent last-good ages for data, history, results and Fleet Config, anonymous health usable | `P2 auth: all four protected reads retain independent last-good ages on SSO failures`; `P2 Fleet receipt: stored policy constrains first ingress; unchanged reads and restart preserve its age` |
| ADR §3/§9 / JOED-20 dependency: Results v2 not-wired error envelope only; no synthetic executor facts or results producer/write path | `P2 results: only v2 not-wired state; no executor producer fields or write route` |
| ADR §8 / deferred compatibility note: exact v2 allowlist, shared contract/module/schema allowlist and Docker/Nix artifact packaging; retain legacy release identity until P6 | `P2 packaging: offline allowlist serves shared contracts and rejects arbitrary source paths`; `P2 acceptance: 400 malformed, 413 streamed bound, 422 contract failure precede snapshot writes`; `P2 health: anonymous exact allowlist, never-received null ages and failed-refresh distinctions` |
| ADR §9: bounded 256-position/10000-point trace and provisional local CPU regression guard | `P2 performance: 256 positions and 10000 history points fit the local 5s CPU budget` |
| Preserve P5 write ownership: paper-only shared-schema Fleet Config with revision conflict, immutable references and bounded attributed audit | `Fleet Config propagates one atomic paper revision to the shared adapter` |

Re-deferred ownership remains explicit: Amy/OPS supplies safely anonymized real
recordings, independent total-PnL evidence, producer CI and broker/executor
reconciliation. The isolated/coupled null regressions here are synthetic.
P3/Tick owns approved yellow off-hours/class-b grace, dotted display continuity,
range clipping, reference-width rendering and browser smoke. P4/JOED-20 owns
realised results/FX and trade bucketing; the clock primitives alone do not prove
consumer math. P6 owns CalVer3/presentation adoption, immutable artifact pins,
proxy header stripping and anonymous health exception, compatible backups and
v2 migration, deployment/rollback/live smoke. A 5000ms local CPU guard is
provisional; the coordinator/P3 still owns an agreed reference-device CI budget.

The native macOS test runner uses only an empty private mode-0700 temporary root
with injected paths/clock/fixture credentials and loopback listeners, then
trashes its own root. Linux CI retains its empty tmpfs gate and Node22 runner.
No browser, production host, push, deployment, review gate, delegation or other
model CLI is part of this worker. Coordinator review happens after worker exit.

P2 builder validation: native Node 24.20.0, `npm test` **89 contract/fixture/time
+ 27 HTTP/storage tests passed**, `npm run check` passed. The final 256-position
acceptance plus 10000-point compaction/validation trace was 125.4ms against the
provisional 5000ms local CPU guard. Direct unguarded HTTP test invocation was
refused before any storage/listener creation. Docker/Colima were stopped, so no
local Node22 container or artifact build is claimed; CI keeps those checks.
The worker did not run a review gate, other model CLI, push or deployment.

### P2 fix round 1 — JOED-22

The fix1 brief addresses the Opus r1 findings against `f8f55f32e`. The table
below is the durable per-item evidence; earlier P2 validation counts above
describe the original candidate, not this fix round.

| Finding | Result and executable evidence |
| --- | --- |
| H1 | History retention uses server `now`. Ingress rejects producer generation beyond receipt +5000 ms as `clock_ahead`, before snapshot/history writes. `P2 clock ahead: five good observations survive a one-year jump and the next valid sequence` proves byte-identical stores and recovery across restart; `clock-ahead tolerance: exactly five seconds is valid; one more millisecond retains last-good` checks all snapshot contracts; `P2 history retention: server time prunes old points even with a slow producer clock` checks the cutoff. |
| M1 | Rejections keep the last snapshot, money, P&L-source evidence, API readiness and original receipts. Only session/KEEP constraints withhold values; headers/state carry feed rejection. A cold `acceptRead` accepts the validated retained snapshot with its rejection reason. `P2 cold retention: bad and replayed pushes preserve the last snapshot, ownership and original receipts` covers malformed-schema/replay cold loads, restart and independent check expiry. |
| M2 | **Superseded by LEAD's fix2 decision:** malformed, contract-invalid, byte-count-invalid and oversized history stores disable history writes without blocking valid snapshots. History bytes remain untouched, its alarm persists, and the data sequence never restarts at 1. `P2 corrupt history: snapshots advance while malformed, invalid and oversized history stays untouched and broken` proves live money, independent History failure and byte preservation through repeated restarts. |
| M3 | P1 executor behavior and the original `a-gateway-up-but-dead` fixture are restored. `P2 executor: reachability and API readiness remain independent in both directions` covers both boolean directions; the deferred note assigns order/fill/brake disagreement to P5/producer with Amy's sign-off. |
| M4 | `P2 inbox auth: missing and wrong bearer return 401; unconfigured token returns 503 before writes` proves all three cases precede parsing and every store write. |
| L1 | Time reasons are in the closed enum. `time: every market-session reason is closed and accepted by browser selectors` covers open, weekend, holiday, early-close and unavailable-calendar branches; `one closed reason enum is used everywhere, including field errors` exercises selector handling for every code. |
| L2 | Never-received feeds use `feed_not_received`, null age and `not reported`; data/history return 503 rather than route 404. `P2 empty feeds: 503 is not reported with feed_not_received, never route_not_found` and the exact health assertions cover these distinctions. |
| L3 | **Corrected in fix2:** successful compaction is server-owned `compactedThrough` metadata; it never forces a stale state or hides a stopped feed. `P2 history metadata: compacted history stays fresh across restart and turns snapshot_stale at 60 seconds` and the 16-day cadence test prove age-based freshness. Real size/write failures stay broken until an actual successful history write; dedupe cannot clear them. The hard-cap/storage regressions retain failure persistence and recovery. Exact duplicate replays are display no-ops; non-identical replays retain the advisory stale mapping. |
| L4 | Inbox 422 responses include at most 20 safe `path`/`rule` pairs, without rejected values. `P2 inbox diagnostics: schema, field and replay rejections expose only bounded safe path/rule pairs` plus the gateway-check regression test cover schema, field, sequence and timing diagnostics. |
| L5 | A committed snapshot rename followed by directory-sync failure continues through history recording before returning failure. `P2 durability: a post-rename sync failure cannot roll sequence back in memory or after restart` now asserts both original points survive retries/restart; the storage regression also covers history's own post-rename error. |
| L6 | Packaging assertions name exact Docker COPY/Nix install sources; HTTP assertions check `X-Joe-Server-Now`; auth ages come from real data/history/Fleet receipts (only the explicitly unwired Results client cache is synthetic). Time tests use production consumers; `P2 repeated NY hour: distinct UTC receipts and history points survive compaction and restart` proves repeated-hour storage behavior. The executor regression covers both directions, and `P2 history: J backfill is never accepted or copied into observed v2 history` restores the v2 observation-only check. |
| L7 | The previously committed worker status file is removed from the product index and `.gitignore` excludes it. Local coordination status can remain ignored. Verified with an empty `git ls-files -- .agent-status.json` result and a successful `git check-ignore .agent-status.json`. |
| INFO / M5 | LEAD's accepted packaging expansion and `calendar` scheme are recorded above. Closed reasons/selector handling are tested. Integration target is `rebuild/v2`; P6/coordinator owns activation and deployment pins. |

Fix1 validation on native Node 24.20.0: `npm test` passed **91 contract,
fixture and time tests + 36 isolated HTTP/storage tests (127 total), zero
failures**. `npm run check` passed **all 9 check scripts**; `git diff --check`
passed. The 256-position/10000-point trace was **120.0 ms**, below the existing
provisional 5000 ms CPU guard. Paper-only/LIVE rejection and mandatory KEEP
SXR8/TSLA remain covered by the existing contract tests. No Docker/default.nix,
compose, deployment, legacy UI or release-identity changes were made in fix1.
No review gate, other model CLI, delegation, push or deployment was run; the
coordinator owns the cross-family gate after this worker exits.

### P2 fix round 2 — JOED-22

This round addresses all seven adopted items from the Opus r2 review against
`af92602`, preserving the other fix1 safeguards. Exact duplicate ingress keeps
HTTP 422 `sequence_replayed` and its safe diagnostic; it performs no writes,
leaves any existing alarm alone and never refreshes receipt/check progress.
Identity requires the same sequence and SHA-256 of canonical JSON ingress
(object keys sorted, array order preserved, server `receivedAt` excluded).
Non-identical and lower-sequence replays retain the rejection behavior.

| Fix2 item | Result and executable evidence |
| --- | --- |
| 1: compaction is metadata | `P2 history metadata: compacted history stays fresh across restart and turns snapshot_stale at 60 seconds` checks `compactedThrough` on history.json, fresh health/panels, restart, 59.999/60.000/60.001-second and one-day stalls, then metadata expiry with retained raw observations. `P2 history cadence: 16 days of 30-second observations remain fresh through repeated compactions` replays all 46,080 observations in two-hour batches through production append/prune/compaction, checking every resulting receipt and its next 30-second probe; it requires at least three distinct compaction watermarks. The shared-contract test also proves metadata without a reason and age-based handling of legacy compaction reasons. |
| 2: corrupt history does not block ingress | `P2 corrupt history: snapshots advance while malformed, invalid and oversized history stays untouched and broken` covers malformed JSON, invalid schema, wrong byte count and oversize, each across two restarts. Snapshots advance sequence/receipts and fresh money/Gateway; history never writes, stays byte-identical and returns 503 with its independent broken alarm. A sequence-1 push still fails. The fix1 M2 row above records the revised decision. |
| 3: false HALT is retained | `missing feed retains false HALT with its original receipt rather than treating it as absent` exercises the shared selector with a last-good snapshot and `feed_not_received`: false remains visible, retained, with its original 30-second receipt age. |
| 4: exact replay is a display no-op | `P2 exact replay: same sequence and payload digest leave display, receipts and stores unchanged` checks identical and reordered-object payloads, no writes/headers/state/health changes, byte-identical stores, restart and a genuine 60-second stall. A different payload at the same sequence still warns, and an exact retry cannot clear that existing rejection. |
| 5: J-backfill rejection names the rule | `P2 history: J backfill is never accepted or copied into observed v2 history` now requires `contract_invalid` with exactly `$.desks[0]` / `additionalProperties`, in addition to 422, byte-identical history and later observation-only recovery. The path names the closed enclosing object, never the untrusted extra key. |
| 6: complete compatibility inventory | The revision-2 note above lists every shared-package change from P1, including rejected-feed session checks, state mappings, `compactedThrough`, both original P2 reason additions, all five fix1 codes, clock acceptance, health schema/semantics and `acceptRead`. Coordinator compatibility review remains required. |
| 7: clock recovery guidance | §2 records the exact +5000 ms boundary, all-push `clock_ahead` failure for a faster producer, NTP correction and recovery with a higher valid sequence. The existing clock-ahead boundary and five-good-push/restart regressions remain green. |

Fix2 validation on native Node 24.20.0: `npm test` passed **93 contract,
fixture and time tests + 38 isolated HTTP/storage tests (131 total), zero
failures**. `npm run check` passed **all 9 check scripts** and `git diff --check`
passed. The existing 256-position/10000-point CPU trace was **117.8 ms** against
the provisional 5000 ms guard. Four read-only in-memory negative controls loaded
`af92602` implementations via Git, reproduced the false-HALT, compaction-age,
corrupt-history-ingress and exact-replay defects, and verified the fixed behavior;
these probes wrote no store or checkout files. The HTTP runner used only its
guarded private temporary root and trashed that root afterward.

Paper-only, LIVE rejection and KEEP SXR8/TSLA remain covered. P1 failure fixtures,
deployment/compose/packaging files, legacy UI and release identity are unchanged
in fix2. Integration still targets `rebuild/v2` with a coordinator squash merge;
the ignored status file stays out of the product index. No push, deployment,
review gate, delegation or other model CLI ran. The coordinator owns the
cross-family gate after worker exit; the ticket remains QA.

## P3 UI candidate — JOED-23

P3 replaces the legacy GridStack board with plain ES modules under
`public/joe/` that follow the approved freeze (r3.1) and read only the P2
server: `/joe/state.json` every 15 s, `/joe/history.json` every 30 s and
`/joe/fleet-config.json`, each through `acceptRead`, then `panelStates` at the
server's clock anchored to a monotonic timer. No freshness rule is
re-implemented: the health light ranks the shared panel states with today's
`localBoardHealth` order, labels and plain-word copy (A1 renames "Gateway
unsure" to "Broker unsure"). Constants for sign-off: stale at the contract's
60 s; red "board updates stopped" at 3 × 60 s without a receipt, or "stuck"
at 3 × 60 s without generation progress; carried equity stays yellow for
today's five-minute grace, then red. A rejected push or failed read keeps
the last good snapshot with its original receipt and says why.

**Copy sign-off, check already 20 s old at generation** (fresh → broken →
stale): until +40 s money reads normally and the light is "Board OK"; from
+40 s to just before +60 s each money cell keeps its last good value with
"Last good value, {age} ago · broker connection not confirmed" (a dash with
"Unavailable · broker connection not confirmed" on a cold load) and the
light is "Broker unsure · the broker connection has not checked in — reload;
if still old, tell Amy"; from +60 s the values read "As of {age} ago ·
updates are late" and the light is "Stale 1 min". `test/ui-modules.mjs` pins
all three. (Fix round 1: a stale caption no longer keeps the designed caption
in front; it states its own age and reason, as every not-fresh state does.)

History is fetched, parsed and validated in a module worker
(`history-worker.js`) and handed to the page as typed columns by transfer, so
the 8 MiB read never blocks the page (measured figures: fix round 1 below). Continuity (dotted € 5.000 lead-in, gaps, carry), basis breaks,
compare and session closes run on those columns; estimates never enter
compare, sparklines or totals.

Named server changes (minimal): the static allowlist lists the UI modules and
drops the vendored GridStack, Chart.js, Hammer and zoom assets;
`/joe/state.json` omits history points from `feeds.history` and
`panels.history` (they were the whole history every 15 s). Shared module
addition: `time.mjs` gains `zonedInstant`, `sessionBounds` and `nextOpen` for
the session ring and today's chart. Packaging: `index.html` pins every module
to the release version through an import map; no service worker. Workers
ignore import maps, so the history worker starts at
`/joe/v/<release>/history-worker.js` and every module it imports resolves
under that path; the server serves only the current release's path (an old
page's worker gets 404 and the page falls back to its own, versioned modules).

| P3 obligation | Proof |
| --- | --- |
| §3 panel isolation; each panel fresh / stale with age / not reported / broken with reason; one null never blanks a panel or the page | `scripts/browser-p3.mjs` fixture run: 20 P1 fixtures plus two derived cases through the real server, every money cell's UI state equals the panel state, no blank panel, light per case |
| Deferred: `b-incomplete-family` single missing desk; `b-equity-null-gateway-ready` coupled equity/total P&L | `isolation: a single missing desk…`, `isolation: equity and total result unavailable together…` (`test/ui-modules.mjs`) and the `p3-*` browser cases |
| Deferred: `e-layout-storage-unavailable` renderer at three widths | browser fixture run with storage and layout globals throwing at 390/1024/1440 |
| Deferred: copy sign-off fresh → broken → stale | `health: the 20-second-old check reads fresh, then broken, then stale` |
| §6 display continuity, gaps, outage-only range, basis breaks, observed-only compare/sparklines | `history: …` tests (`test/ui-modules.mjs`); browser AC-20/AC-21 |
| §8 host gate on the replacement module | `production host remains inside the current canonical host gate` now imports `public/joe/host.js` |
| §9 render budget | browser `budget` checks on the 8 MiB history and on live 256-position pushes at every width (fix round 1) |
| P1 browser smoke (was BLOCKED) | `npm run test:contracts:browser` passes locally |

Retired with GridStack, as AC-35 asks: `check-joe-layout`, `check-joe-phone`
and `smoke-joe` (CI runs `scripts/browser-p3.mjs` instead), plus
`check-joe-history`, `check-joe-trust`, `check-joe-learning` and
`check-position-display`, which extracted code from the deleted `joe.js`;
their v2 equivalents live in `test/ui-modules.mjs` and the browser gate.
`check-fleet-config` keeps its schema, example and docs half; its flip-plane
UI half returns with P5's Settings. Results shows only its designed not-wired
state (P4); Settings shows its nav entry and a not-wired line (P5), so the
Appearance Light / Dark / System control also waits for P5 (the theme module
already supports system).

### P3 fix round 1 — JOED-23

Codex review r1 (changes) found three High and six Medium issues. All are
fixed; each High has a browser regression at 390/1024/1440 in light and dark.

| Finding | Fix | Proof |
| --- | --- | --- |
| High: a cold failure blanked every panel until `state.json` supplied a clock | The page always renders. The clock is state.json's `serverNow`, else any other read's `X-Joe-Server-Now`, else its HTTP `Date`; before any clock every panel still gets `panelStates` (no feed holds a value, so no state depends on the instant) and says "Time not known". A value can never be shown undated. | `cold start:` (ui-modules); browser `cold` at six combos for 401, and 302, 404, 503, connection refused; History answering while state.json is 404 keeps its own fresh value |
| High: the renderer re-mapped P1 states (`feed_not_received` → broken, retained replay → broken) | Every cell, card line, section line and History shows `cell.state` as given; captions are derived from it (`statePhrase`). NO DATA now reads "Not reported · no data received yet" (spec §9 said "Unavailable · no snapshot"; changed so the words match the state) | `cells: every P1 panel state…` over all fixtures; browser `passthrough` (replayed push stays stale at six combos), NO DATA at six combos |
| High: surfaces omitted their own age/reason | Desk cards list every not-fresh number with its own age and reason (one line per distinct state); Kept says "As of …" with its reason and drops "now"; J's result in History carries its age and reason; positions and kept have their own state line | browser `journey` (Today 1 min, open result 35 s, J's total 35 s, each with its reason) at six combos; fixture run checks every card names every affected reason |
| Medium: History compare used a different window from the chart | `rangeWindow` gives one window ending at the board's time (or the zoom); chart and compare both use it | `history: compare uses exactly the chart window…` (observations end 14 Oct, time 17 Oct → Day compares nothing) |
| Medium: freshness transitions shifted layout | State texts have reserved space: health line two rows, Today's sentence two lines, captions two (phone three), card state lines inside the sparkline's fixed box, a state line per section, History's state inside the chart's fixed box | browser `journey`: fresh → stale → broken → recovered moves nothing (±0.5 px) on Desk and History at six combos |
| Medium: dialog focus, rebuilt sections | Details is a focus-trapping dialog: focus moves in, Tab stays inside, Escape returns focus to Details. A rebuilt section keeps keyboard focus and an open or pinned tip on the same control | browser: keyboard dialog flow at six combos; focus, pinned tip and focus inside the dialog survive data updates |
| Medium: phone Retry 30 px; target scan only on healthy History | Retry is 44 px on phones; the full craft scan (targets, contrast, clipping, scroll) runs on degraded Desk and History states in both themes | browser `auditScreen` on cold, NO DATA, broken and refresh-failed states |
| Medium: performance evidence lacked the workload | Two phases at every width: the 9,000-point (8 MiB) history read cold, and five live pushes of 256 positions plus three History updates over 7,200+ points (the server compacts at its 6.4 MiB warning once pushes arrive). Every update must render and be measured; Desk patch < 16 ms, History < 50 ms, no long task, history only in the worker. Charts now measure before the long sections change (a forced full layout made the 256-row patch 23 ms; now 7–8 ms) | browser `budget`; trace and reference in the QA index |
| Medium: worker imports not version-bound | Release path `/joe/v/<release>/` (named server change below) | `P3 UI: the history worker graph is served only under this release path` |

Named server change (minimal): `server.mjs` serves the UI modules, contracts
and shared modules also under `/joe/v/<release.version>/`, from the same
allowlists; any other version, the index and the data reads are 404 there.

Performance reference: the headless Chromium shell the gate launches on the
local Apple Silicon workstation (exact build, CPU and Node version are written
into the QA index with every trace). The Linux CI run, with its own fonts, is
the merge gate for both the budget and the font-dependent layout checks.

Still open, with owner: the Appearance Light / Dark / System control (P5),
Results numbers and AC-46 (P4), and the Linux CI browser run before merge.

### P3 fix round 2 — JOED-23

Codex review r2 (changes) confirmed seven r1 findings fixed and found two
Medium gaps. Both are fixed with regressions.

| Finding | Fix | Proof |
| --- | --- | --- |
| Medium: a cold start without a clock still blanked Results | Results labels its calendar by this browser's date until the server's clock is known (`resultsToday`, shared by the renderer and its controls); it is not wired, so no state depends on that date. It shows its designed not-wired state | browser `cold`: Results reached from the nav and opened directly at `#results`, for 401 at six combos and 302, 404, 503, connection refused; `results:` (ui-modules) |
| Medium: the zoomed comparison used observations the chart left out | `chartRows` gives each desk's kept rows (up to the board's time, latest comparable bookkeeping basis); the chart, the comparison and the basis notice all read exactly those rows | `history: a zoom compares exactly the points the chart draws…` (ui-modules); browser `basis`: J changes basis at 13:00 on 14 Oct; zoomed before it, nothing about J is compared and the notice names J; the week and a zoom across it compare the chart's own points, at six combos (zoom on desktop) |


### P3 fix round 3 — JOED-23

The first Linux CI run on PR #37 (job 116624253606, 1752/1767) failed in
three groups and left its scratch directories behind. Each cause is fixed,
and the local gate now reproduces what the Linux runner saw.

| CI failure | Root cause | Fix | Proof |
| --- | --- | --- | --- |
| No-shift at 390, light and dark: stale → broken grew the health line from 122.75 to 143 px and Today's sentence by a line, moving the hero and its numbers | Product: the room kept for state texts fitted this Mac's font. In Linux's wider fonts the reason wrapped onto a second line in the free-wrapping health line, and Today's not-fresh sentence needed a third line | Up to 900 px the health line has fixed rows: reason; broker; emergency stop; data age beside Details (whose 44 px on phones hold two lines). The reason's cell and Today's sentence hold hidden twins (`aria-hidden`, `visibility: hidden`) of their longest forms (every health reason; the largest amount with the longest age and reason), so the browser lays out their room in its own font. No clamp, no ellipsis; the full text is always shown. Wider, the line keeps its two reserved rows | The browser `journey` also runs in a wide font (Verdana, else DejaVu Sans) at 390 light and 1024 dark; before the fix it failed exactly as on CI (143 px), now nothing moves. All 17 health reasons with the longest broker and data wordings give one height per width (390 to 1440) in both fonts |
| `basis`, every width and theme: the week and the zoom compared nothing ("Choose two or more desks…") and named no desk | Test race, not time zone: the page marked itself ready once any first read had answered, and the gate read History before its worker delivered (about 650 ms on CI, 80 ms locally). The History model computes only through `time.mjs` in explicit zones; no local-time API is used in `public/joe` or the gate, and the browser follows the runner's zone. Product side-finding: before History arrived, the compare line asked for desks that were already chosen | `ready` waits until every first read (state, history, fleet settings) has answered with a value or a reason. With no history rows, `sharedWindowCompare` gives `insufficient-points` ("Not enough history in this window to compare.") | browser `basis`: History's read held back 1.5 s. The page is not ready before History answers and never asks for desks; once ready it compares the chart's own points. This fails on the previous code with CI's exact output. Empty-history case in `ui-modules`. `npm test` and the full gate pass under TZ=UTC, Europe/Vienna and America/New_York |
| `budget`, every width: Desk patch 22–25 ms, tasks 53–86 ms on the runner | Measurement place, not a regression: 16 ms / 50 ms is a reference-device budget, and CI runners are slower | §9 decision: the budget is measured on the reference device; CI holds the 2.5 × guard on the same workload | Reference run on mbp2607: 22/22, figures in §9. Guard: 22/22 locally; the CI run's figures are within it |
| "trash failed": 41 directories left in `/tmp` | Test: CI runners have no `trash` | Scratch directories come from `scripts/browser/scratch.mjs`. With `CI=true` they are removed with `fs.rm`; elsewhere they go to the Trash. Only directories this run made are ever removed | A run with `CI=true` leaves no `joed-p3-*` directory and prints no "trash failed" |

Visible change for the visual check: up to 900 px the health line keeps a
second line under a short reason. On phones, Today's sentence keeps three
lines. So the phone Desk is about 43 px taller in every state; at 1024 and
1440 nothing changes. The gate now has 1871 checks (1767 plus the
wide-font journeys and the slow-History case). All pass locally
(Europe/Vienna) and under TZ=UTC and America/New_York.

### P3 fix round 4 — JOED-23

Tick's visual check of f3bee55: use the calmer alternative, not blank
reserved lines; empty bands are an anti-pattern (GUI 1316). Round 3's hidden
twins are replaced by clamps. Everything else from round 3 stays: ready after
every first read, the budget split, the CI scratch cleanup.

| Surface | Round 3 | Now | Proof |
| --- | --- | --- | --- |
| Health line reason | Up to 900 px a row as tall as the longest reason, so a short reason had a blank line under it; wider, two reserved rows, a blank band at 1440 | One line at every width, with an ellipsis when it is longer; the full reason is its `title` and the Details heading. No other fact wraps, so the rows are fixed per width: one row from 1181 px (34 px); from 901 to 1180 px the reason beside Details, the other facts on a row below (60.25 px); up to 900 px one row per fact, the data age beside Details. With no data the line keeps its four facts (the broker and the emergency stop say "not reported"), so the first snapshot moves nothing | `lines`: all 17 health reasons with the longest broker, emergency-stop and data wordings at 1440, 1181, 1180, 1024, 901, 900, 701, 700 and 390 px, in this machine's font and the wide one: one box, nothing overflows the line, whole lines with an ellipsis |
| Today's sentence | Hidden twins of its longest forms: three lines on phones in every state | Two lines at every width, a box of twice its line height (45 px). A longer sentence ends in an ellipsis. The sentence is a button: a click, tap or keyboard focus shows it whole in the explanation tip (hover does not, as its words are in view). A pinned tip follows the sentence through a rebuild, and its ages tick | `clamp`: on every Desk audit the two clamps show only whole lines (none cut through), end in an ellipsis and give their full text; a tap shows the sentence whole at six combos and in the journey; `lines`: 32 sentence forms |
| Today's number | Not measured | A missing value's dash had a shorter box than a number, because the € sign's leading adds 9 px (7 to 8 px on phones). So the first snapshot moved Today's sentence. The number now keeps the approved box with or without a value (61 px; 53 px on phones) | `journey` from "not reported" |

The browser `journey` now starts with no snapshot ("not reported") and
asserts that the health line and Today's sentence keep one box (position and
size, ±0.5 px) through not reported, fresh, stale, broken and recovered. It
runs at six combos and in the wide font at 390 light and 1024 dark, so the
Linux CI run asserts the same in its own fonts. AC-36 still scans everything
else; the two clamps are its only exemption, and `clamp` checks them. The
gate now has 2049 checks (1871 plus `lines`, `clamp` and the journey's
not-reported step). All pass locally (Europe/Vienna) and under TZ=UTC with
CI=true.

Visible change for the visual check: no blank line or band remains. At 1440
the health line is one row (34 px instead of 61). At 1024 its height is
unchanged, and Details sits beside the reason. On phones the reason is one
line and Today's sentence two, so the phone Desk is about as tall as before
round 3. From 901 to 1180 px, Details is visually on the reason's row but
stays last in the Tab order, after the facts it details.

Found, not in this round's scope: from 701 to about 860 px (about 910 px in
a wide font) the desktop header (brand, navigation, light, theme button) is
wider than the window and scrolls sideways. It predates this round; the
gate's widths are 390, 1024 and 1440.

### P3 fix round 5 — JOED-23

The horizontal page scroll found in round 4 (AC-28: never a horizontal page
scroll). A sweep of every width in 10 px steps found two more defects of the
same kind between the gate's widths; this round fixes them too.

| Surface | Before | Now | Proof |
| --- | --- | --- | --- |
| Header | From 701 px the desktop header (brand, PAPER, nav, light, theme button) needed 855 px in this machine's font, 937 px in the wide font and up to 1,056 px with the longest light label ("Stale 23 h 59 min · Broker unstable"). The page scrolled sideways from 701 to about 860 px (910 px in the wide font), and in the wide font with that label at 1024 px too | Up to 960 px the approved phone header: brand, PAPER, the light (above 700 px still with its broker word, as §1 asks) and a 44 px theme button; the nav is the bottom bar. Above 960 px the desktop header, unchanged. When it is short of room (the wide font with a long label, 961 to about 1,060 px), the light's broker word moves under its label, inside the 34 px button. Its widest case needs 928 px | `sweep`: page scroll, the header's row, one nav, 44 px targets, centred icons; 6 light labels × 4 broker words at every width |
| Kept holdings | Up to 1180 px a kept row's columns need about 730 px plus gutters: the page scrolled from 701 to about 730 px, and up to about 850 px the holding's name had no room and was cut | Up to 900 px a kept row has two lines: the holding and its worth, then the kept label under the holding. Side and last price are already in the holding's second line, as on phones | `sweep`: page scroll and nothing past the right edge, on every screen |
| Desk card header | The state ("Sitting out since 16:02") never wraps, but the heartbeat line ("Checked in 18 s ago") took its room. With the design data the two overlapped at 710–780 and 1110–1150 px (to 820 and 1200 px in the wide font); with the longest heartbeat ("Checked in 23 h 59 min ago") at 710–870 px (910 px in the wide font) and 1110–1440 px | The state keeps its width. The heartbeat line may take two lines, inside the name and state's height (36 of 41 px, so nothing moves). A card narrower than 340 px puts it under the state, as on phones (710–830 and 1110–1230 px). At 1024 and 1440 the design state looks as approved | `sweep`: no text overlaps other text on any screen; each card header keeps one box with its longest state and heartbeat texts |

The sweep (`sweep`, 121 checks) resizes the live page to every width from
390 to 1440 px in 10 px steps (106), light and dark, in this machine's font
and the wide one, on all four screens. It asserts:

- no horizontal page scroll (`scrollWidth ≤ innerWidth`), and nothing reaches past the page's right edge, where a scrollbar sits;
- the header's items stay in one row and never overlap;
- one nav: the bottom bar up to 960 px, the header's above, with all four screens in view;
- 44 px targets in the compact header and the bottom bar;
- the header's and the bottom bar's icons centred (±0.5 px);
- no text overlaps other text.

On Desk it also puts every light label with every broker word through the
header, and the longest state and heartbeat texts through each desk card. The
same sweep against 44d1532 fails 108 of its 121 checks. The gate now has 2170
checks (2049 plus the sweep). All pass locally (Europe/Vienna) and under
TZ=UTC with CI=true.

Deferred, a copy decision: on phones the light has about 72 to 84 px for its
words. "Stale 23 h 59 min" (an age in hours and minutes) runs 2 px into the
button's padding at 390 px in this machine's font, and up to 30 px over the
theme button from 390 to 410 px in the wide font. Spacing cannot absorb
30 px without dropping something §1 asks for. Proposal: once the age is an
hour or more, the light says "Stale 23 h"; the Desk line keeps the exact age.
The sweep exempts only this label on phones. It must still move nothing, and
index.md lists every exempted width.

Visible change for the visual check: the compact header and bottom bar from
701 to 960 px, two-line kept rows up to 900 px, and the card heartbeat under
the state at 710–830 and 1110–1230 px. At 390, 1024 and 1440 the design state
is unchanged.

## P4 Results candidate — JOED-24

P4 builds Results on the results v2 contract, exactly per the approved freeze
(r3.1) and spec §4 / Part A. The live board still shows the designed not-wired
state: the server answers `/joe/results.json` with 503 `results_not_wired`
until JOED-20 delivers the record; P4 proves everything against v2 fixtures.

**Data path.** The page reads `/joe/results.json` every 30 s in the read worker
(`history-worker.js`, which now serves both large reads) through the shared
`acceptRead`, so SSO redirects, failed refreshes and invalid records keep the
last good record with its original receipt. An accepted record is indexed once
(`results-model.js`, `indexResults`): trades sorted by `closedAt`, and per
(Vienna date, desk) cell the counts and exact sums (net, gross, fees, winners,
losers, best and worst trade), plus each desk's equity close with carry. The
index travels to the page as typed columns by transfer (trade text as one
string with offsets) and exact money columns of BigInt in 10⁻⁸ units, by copy
(fix round 1: a `BigInt64Array` wrapped past € 92 billion). Every Results number is
then a pure selector over the index, the snapshot's current desk equity (today's
E) and, for Day, History's observed intraday rows. `panelStates` gives the
record its own state; a not-fresh record says so inside the hero chart's box
(same pattern as History), so no state moves the page. Ticks only refresh ages:
Results is rebuilt when its inputs change.

**§4.2 exactly.** Vienna dates of `closedAt` (one Intl call per UTC hour, since
Vienna's midnight is always a whole UTC hour). E(d) is the selected desks' last
equity close on or before d, € 5.000 per desk before tracking or before a desk's
first close, null when the record says unknown; today E is the snapshot's
current (non-retained) desk equity and nothing else (fix round 1: a close in
the record never stands in), else unknown, in which case Net, Still open and
the dip are "—" with a sentence, never a zero. Won ≥ € 0,005, lost ≤ −€ 0,005,
flat otherwise; win rate over decided
trades with "small sample" under 30; expectancy over all trades; profit factor
without a loser is "—"; drawdown over [E(S−1), each session close (Day: each
observed intraday point), E now]; best and worst day by realised net per Vienna
date with "only day". Display values are rounded once, half away from zero
(`contracts/decimal.mjs` gains exact `divRound`, `roundUnits`, `mulUnits`,
`divUnits`, `unitsDecimal`, `unitsNumber`); FX arithmetic is proven exact per
trade (`grossFromFx`: quantity × price move × close rate = `grossEur`).

**KEEP.** The contract rejects SXR8/TSLA trades. A record that still trades any
symbol on the accepted Fleet Config KEEP list is held back as a whole
(`source_not_authoritative`), never partially subtracted (§3's rule).

| P4 obligation (deferred notes) | Proof |
| --- | --- |
| Vienna-midnight buckets independent of the NY day; both NY 01:xx occurrences by UTC instant; extended hours after 18:00 NY | `fixtures/results/dst-weeks.json`; `vienna dates: …` (`test/results-model.mjs`); browser `vienna` at a 2027 today (the five-hour week, 1 Nov's two 01:30s, Vienna midnight on 25 Oct, the spring twin) |
| Results v1 → v2 | P4 consumes only `inspr.joe.household.results.v2` through `validateContract`; no v1 path or widening. JOED-20 coordination items below |
| Results paging/retention | The board reads the whole record (≤ 8 MiB) in the worker; the budget trace uses 14,000 trades (7.8 MiB). Paging before the limit stays with JOED-20 |
| §4.2 math, scratches, small sample, no loser, drawdown incl. Day intraday, empty period (AC-12) | `test/results-model.mjs` on hand-checkable fixtures (`scratches`, `no-losers`, `drawdown`, `empty`); browser `AC-12`/`AC-16` show the same numbers |
| §9 budget | Workload: the 14,000-trade record (7.77 MiB) read, validated and indexed in the worker, then 11 period, desk, step and day changes at each width. Reference on mbp2607 (Apple M5 Max, HeadlessChrome 153.0.8010.12, Node v26.11.1), 2026-10-15: Results render worst 7.0 ms, no long task at 390, 1024 or 1440; the P3 workload unchanged (Desk patch 7.7 ms, History draw 9.3 ms). CI guard (2.5 ×): browser `budget` |

**For JOED-20 (producer coordination; board obligations implemented by JOED-27).**
1. Freshness: the shared selector marks a record stale after 60 s. The producer
   re-sends at least every 30 s with a strictly increasing sequence and
   non-regressing generation. Stale Results remains visible with Stale and age.
2. Ingress: JOED-27 adds `POST /joe/inbox/results`, acceptance through
   `acceptSnapshot('results')`, durable persistence and `X-Joe-Received-At`,
   sharing the existing machine token. OPS must add the second exact-path
   token-only edge router without SSO; no prefix exemption. README is the
   producer/edge handoff. Nothing is deployed by this worker.
3. Amy's 2026-10-16 contract decision (LEAD day-level clarification): each full
   Vienna day covers every trade closed on that day, including every desk that
   traded. An omitted trading desk returns a per-day 422 (`dayDeskRequired`);
   count, realised net and fees reconcile exactly. Per-day mismatches retain
   last good. Dates with no `days[]` entry are skipped by reconciliation.
   JOED-28 computes server-owned `missingDays` on acceptance: sorted unique
   past Vienna dates with closed trades and no daily entry. They accept with
   200 and show the existing Stale warning on the affected calendar day and
   day summary, with fixed geometry and unchanged trade amounts. Today's open
   Vienna date is silent; receipt time defines today, including DST. The list
   is omitted when empty and persists with the accepted snapshot across
   restart/rejection, until recomputed by the next accepted push. Optional
   day-level `coverage: "full" | "partial"` defaults to full; only explicit
   partial days skip reconciliation. The board still derives trade P&L from
   trades, never from day summaries (spec §7).
   JOED-30 manifest revision 5 adds optional, nonempty unique `partialReasons`
   in canonical enum order and optional known `unattributedCount` (minimum 1,
   only with `unattributed_activity`). Reasons require `coverage: "partial"`;
   semantic failures use the existing per-day 422 paths. JOED-34 revision 6
   requires reasons on closed partial days (`partialReasonsRequired` at
   `$.days[i].partialReasons`); closure means date before the server receipt's
   Vienna date, using the same DST-safe helper and receipt as `missingDays`.
   The open day may omit reasons unless a real cause exists (e.g. `fx_missing`);
   supplied arrays remain nonempty and canonical, with the enum unchanged.
   `capture_gap` is reserved for a real mid-day tracking start. Served validation
   uses the persisted receipt, keeping then-open records readable after midnight
   and restart. Empty-desk rows remain valid under these rules.
   `avg_cost_mismatch` is reserved for future producer emission. The order and exact sentences are
   recorded in `docs/joe-data-contract.md`; `fx_disabled` suppresses `fx_missing`
   only in presentation. The board keeps the fallback for absent/unknown reasons,
   renders known reasons on separate lines, and uses the first short label plus
   “and N more” for cell aria. Desktop shows every sentence; a phone shows two
   with a 44 px one-way disclosure, named “Show N more reasons” (singular
   “Show 1 more reason”). It removes itself and focuses the first revealed
   sentence in a polite live region; reopening starts collapsed. Sheet height
   reserves the full expanded content, capped at 80vh, with collapsed spare
   room at the bottom; reveal preserves its top, height and prior geometry.
   Filters state that coverage applies to the whole day after the sentence
   qualified. Today has no marker; known amounts say “so far” and an empty
   selected desk says “No trades so far”. Count text keeps U+00A0 between its
   positive number and unit. Empty detail summaries omit the trailing dash; cells
   and amount slots retain it. All closed partial dates, including escalated
   Stale dates, count in the desktop month hint; missing-summary Stale alone
   does not. Empty-desk rows add nothing to sums and show unknown under every
   filter. Today without reasons has no reason note; with `fx_missing` it shows
   “No EUR exchange rate was recorded for this day.” No rendering change is
   needed for revision 6. The revision-6 contract digest, participant requirements
   and runtime closure move together through the offline release checker; no release or
   downstream repository change is implied.
4. Amy's gross decision: exact decimal strings end to end, no contract rounding
   and never rounding before summing. Only board display rounds to cents.
   Fixtures prove exact FX arithmetic and sums whose cents differ when rounded
   before summing.
5. Every configured KEEP symbol stays out of the record (the board holds back a
   record that trades one). SXR8/TSLA are excluded from both trades and day
   totals; `fixtures/results-keep-exclusion.json` proves that exclusion.
6. (Fix round 1.) The record's closes carry no bookkeeping basis, so the board
   can detect a change of basis only inside History's 14 days or against the
   snapshot now. A basis id per desk close in `days[]` (or a restated record
   after a change) would let the board check every period.

**Changed P3 expectations (deliberate).** Results now reads its own record, so
P3's cold-start checks route `results.json` with the other reads and expect
Results to show its own failure reason ("Results are unavailable: sign-in
expired — reload."), and the unit cold-start test expects the record's own
reason. The not-wired 503 now carries `X-Joe-Server-Now` like every other read
(server-contract test updated). The P3 audit moved unchanged to
`scripts/browser/gate.mjs`, shared by both gates. Budget renders exclude every
read's accept/worker timing.

**Tick's P3 follow-up.** At 390 (and in any card narrower than 340 px) the desk
card keeps "Checked in … ago" right-aligned on the name row, the state on the
row below; its term has an invisible 44 px hit area. Browser `P3-follow-up`.

**Decisions for the visual check.** (1) The hero chart is zero-based (AC-46)
and keeps §4.7's minimum span of ±0,5 % of the period-start money (AC-17), so
a small week uses part of the height; the zero line is the period-start
line. (2) The split and the benchmark line sit at the hero's bottom, so a
longer sentence never moves a number. (3) Best and worst trade are named by
symbol and desk, never clipped by a long company name. (4) US market holidays
read "closed"; weeks still ahead show no sum. (5) In a wide font a By-desk
row's facts take a second line inside the row. (6) A day's chart spans the
regular session in Vienna time, widened to any change outside it.

**Verification (this candidate).** `npm run check`; `npm test` (contracts 95,
UI 38 incl. 16 Results, server contract 40); `node scripts/browser-p4.mjs`
1323/1323 under Europe/Vienna and under TZ=UTC; `node scripts/browser-p3.mjs`
2170/2170; reference budget 31/31 on mbp2607. Screenshots and the AC → test
map: `~/.local/share/joedesk-qa/p4/index.md`. No push, deploy or review gate.

### P4 fix round 1 — JOED-24

Codex review r1 (changes) found one High and five Medium issues. All are fixed
at the root; each has a unit test in `test/results-model.mjs` that fails on
7009b62, and a browser regression at 1440 light and 390 dark.

| Finding | Fix | Proof |
| --- | --- | --- |
| High: incompatible bookkeeping bases became losses (intraday observations used without their basis) | No Results number is derived across a change of a desk's bookkeeping basis (History contract: a cutover is not profit). `basisCuts` finds every change between two of a desk's meaningful History observations (all-null rows without metadata are unknown, not a new basis) and one at now when the snapshot's basis differs from History's last row; `basisKey`/`meaningful` are shared with History. `moneyContext` checks, per desk, from the close E(S−1) stands on to the close E(end) stands on (or now); `intraday` itself returns no points across a change. Across one, Net, Still open, the dip and the chart are "—"/empty and the change is said ("No result this week: J’s bookkeeping basis changed on Wed 14 Oct, and a change of basis is not a gain or a loss."); closed-trade numbers and unaffected desks stand. The record carries no basis, so a change older than History's 14 days is not visible to the board (JOED-20 item 6 above) | `basis: …`; browser `r1-basis` (J changes at 13:00 on 14 Oct: every period × desk) |
| Medium: missing current equity was replaced with today's close | E(today) is the snapshot's current desk equity only; a retained or missing value stays unknown. The dip is unknown when any value on its path is (an unknown session close included), never computed over the known part | `today’s money: …`; browser `r1-money-now` (J without money now, the record holding a close for today) |
| Medium: Week/Month used Day's calculations when start = end | Intraday points and Day's chart follow the period kind (`per.p === 'day'`), never `start === end`; `moneyContext` fetches History's points for Day only | `period kind decides: …` (Week on Monday, Month on the 1st, the year on 1 Jan, All on day one); browser `AC-10` on every switch |
| Medium: sparse dates distorted the chart's time scale | The x axis is real time over the period: each close at the end of its Vienna date (`viennaMidnight`, via `time.mjs`), today at now, before tracking zero by definition up to the tracking start; missing dates keep their width and a session without a close breaks the line. Labels at the first and last point and the point nearest the middle | `hero chart: a real time axis …`; browser `r1-time-axis` (drawn x of every point against its time) |
| Medium: accepted money could overflow (`BigInt64Array`) | Money columns and every sum are BigInt (arbitrary precision); History's columns also carry each desk's equity exactly (`equityUnits`, parsed in the worker), so Day's intraday points no longer go through a Number; text is formatted from exact units (`format.js` and `bn`/`pl` accept BigInt units: rounded once, never through a Number), prices included. Found with it: calendar cells clipped any day from about € 100 (desktop) or € 1.000 (phones); a day's amount now always fits its cell (`calAmount`: "4,10", "123", "12k", "1,2M" … "9e15"; phones "4,1", "123", "1,2k", "0,1M", scaled forms a step smaller), exact in the label and the day's trades | `money: exact …` (€ 100.000,12345678, € 100 billion, a 64-bit-overflowing sum, the longest amount the contract allows); `calendar amounts: …`; browser `r1-exact` (tiles, split, calendar and labels, audit clean at 390 and 1440) |
| Medium: equal daily results implied one trading day | "only day" follows the count of trading days (`R.days === 1`, `dayTile`); ties: the first equal day is the best, the last the worst | `best and worst day: …`; browser `r1-days` |

The review listed no Low findings.

**Verification (fix round 1).** `npm run check`; `npm test` (contracts 95,
UI 45 incl. 23 Results, server contract 40) under Europe/Vienna, UTC and
America/New_York; `node scripts/browser-p4.mjs` 1613/1613 under Europe/Vienna
and under TZ=UTC (new section `r1`); `node scripts/browser-p3.mjs` 2170/2170;
reference budget 31/31 on mbp2607 (Apple M5 Max, HeadlessChrome 153.0.8010.12,
Node v26.11.1), 2026-10-15: Results render worst 7.3 ms, no long task at 390,
1024 or 1440; Desk patch 7.4 ms, History draw 8.7 ms. Exact money adds about
1 ms to receiving a record or a History on the page (BigInt columns are
copied, not transferred). No push, deploy or review gate.

## P5 Settings candidate — JOED-25

P5 builds Settings exactly per the approved freeze (r3.1, spec § 8, Part A)
on the P3 shell, theme module, panel states and patterns: Mode first, then
Runtime state, the seven Fleet Config groups, How fleet settings work, Where
this is defined, the change log, Appearance and About. A sticky sub-nav
reaches every section and marks the one in view.

**Modules.** `settings-model.js` is pure (fields, validation, candidate,
diff, the edit flow's states, the change log, the browser draft) and runs
under Node. `settings.js` draws it. `fleet-write.js` is the board's one
write: a single POST of `{ baseRev, config }` to `/joe/fleet-config/propagate`,
refused before any request unless the config is paper and names the version
it was made against. Only Settings imports it. Transport stays in `feed.js`:
the Fleet Config read also keeps `X-Joe-Fleet-Source-Path/-Kind`, and a
read-only `fleet-config/actions.json` poll runs while Settings is open. No
new state logic: Runtime state reads the shared `panelStates` cells,
`brokerState`, `dataAge` and `boardHealthPresentation`; the written
settings are checked with the shared `validateContract('fleet-config')`.

**Write ownership (ADR "Preserve P5 write ownership").** The server is
unchanged: same-origin, proxy-identified actor, revision check, schema,
read-only tools and secret references, atomic write, bounded attributed
audit. The UI edits exactly today's 14 settings; everything else is
read-only with a lock and its reason. Edit → Review changes (the dialog and
its review tick) → Confirm → Send. A draft in progress keeps the version it
was made against, so a newer version makes its send meet the server's
409, which the edit bar and the toast surface as "revision changed to
fc-…; reload before retrying"; the server audits it. Discard takes the
newest saved version. Save draft keeps today's browser key
`joe-fleet-config-preview-v1`, restored only for the same version.

**Paper and KEEP.** PAPER is fixed: the candidate is always the saved
settings plus validated changes with `mode = "paper"`, and the writer refuses
anything else. The LIVE gate (three fixed-size steps, the typed phrase, a
disabled final switch) has no request and no state: every close route
returns to PAPER with the toast. SXR8 and TSLA are named as always kept
(inert text); only the other symbols are editable, and the candidate always
starts with the floor in its saved order. With the stored settings
unreadable, values are hidden, editing is off, the floor is still named, and
Desk still routes SXR8/TSLA to Kept holdings (`panelStates` floor).

**Leaf keys.** `fleet-config.schema.json` has 36 leaf keys (34 leaves, plus
the two arrays of objects listed beside their item keys). The ticket's "39"
counts the spec's 39 table rows in § 8.3, three of which are not schema keys
(Routine health, File the board reads, Last sent). The tests derive the keys
from the schema file and assert all of them, visible in mono.

| P5 obligation | Proof |
| --- | --- |
| AC-22 Mode, then Runtime state; every leaf key as `data-key` with visible mono text, against the schema | browser `AC-22` (clean, starter file, unavailable; six combos); `schema keys` (`test/settings-model.mjs`) |
| AC-23 today's editable/read-only split; phones read-only with the note, no inputs | browser `AC-23`; `editability` |
| AC-24 edit flow, edit-bar states and toasts; stale version surfaced and audited | browser `AC-24` (edited at six combos incl. the wide font; draft; stale; failures; unavailable); `edit flow`, `stale version`, `review`, `load states`, `browser draft`, `candidate`, `validation`, `diff model` |
| AC-25 seven rows; "Not reported"; no secret, token, full account number or env content | browser `AC-25` (incl. a snapshot without executor and hint; the inbox token never reaches the page) |
| AC-26 sub-nav reaches and marks every section | browser `AC-26` (clicks and scrolling; nothing moves) |
| AC-27 § 8.5 sections and copy | browser `AC-27`; `change log` |
| AC-3/4/37 LIVE gate, asserted at the network layer | browser `AC-3`, `AC-4`, `AC-37` (six combos: no request but the board's GET reads, no stored state, server still paper at the same version); `writer` |
| AC-5 the only write is a paper draft to propagate | browser `AC-5` (every write of the run); `check-joe-ui` (one writer, one route, paper guard, no live mode anywhere) |
| AC-28 no horizontal scroll 390–1440 | browser `AC-28` (audits; sweep in 10 px steps, both fonts and themes, plus the edit bar's longest note) |
| AC-31 Light / Dark / System; System follows the OS live | browser `AC-31` |
| No layout shift on edit, review, toast or section change (±0.5 px) | browser `no-shift` (six combos, both fonts), `AC-26`, `AC-4`, `AC-31` |
| Tick's P4 carry-over: pointer opens the 390 day sheet without a ring | browser `P4-carry-over` (tap: heading, no ring; keyboard: close button with its ring) |

**Changed expectations (deliberate).**
- `check-joe-ui`: "the board only reads" now allows exactly `fleet-write.js`
  (one POST to the propagate route, the paper guard), imported only by
  `settings.js`; the preview key joins the allowed browser storage; no module
  may assign a live mode.
- The shared audit (`gate.mjs`, `audit.js`): the LIVE label may render only
  inside Mode's locked option (AC-2); the locked "Switch to LIVE…" opener and
  controls inside dialogs are exempt from the AC-5 action scan (P5 proves the
  gate sends nothing); the Mode panel is a primary card (AC-44); config
  values (`[data-value]`) count as exempt text for AC-38, as the AC says;
  the sweep treats the edit bar as fixed chrome like the header and the
  bottom bar.
- Dialogs open through one rule (`ui.js openDialog`): by a pointer, focus
  goes to the heading (tabindex -1) without a ring; from the keyboard, to the
  first control with its ring. The browser's own first focus picked the
  heading, so it is chosen explicitly. A tip inside a dialog joins it (shown
  above it); Escape closes the tip before the dialog.
- A disabled button keeps its disabled look under the pointer (found in the
  contrast audit: a disabled primary button under the pointer read 2.4:1).
- `startBoard` (test only) can seed the change log and an unreadable store
  and exposes its store path; the CDP client records request bodies.

**Decisions for the visual check.** (1) The edit bar is one row above
1180 px, two rows (note, buttons) at 961–1180 px, and floats above the bottom
bar up to 960 px; its note keeps two lines' room. (2) The wake windows take
the whole row. (3) The Saved line stays one short line ("Saved: 2 wake
windows · Review changes lists every difference" for the windows). (4) Adding
or removing a wake window is the one edit that changes the page's height;
everything above the list stays put. (5) Read-only values carry a lock icon
and their reason ("Fixed by the settings format", "Read-only · not used").
(6) Long keys and paths break after a dot or slash. (7) As in the approved
design, phones have no sub-nav: Settings is one read-only column there.

**Not in P5.** Deploy, CalVer3 and rollback (P6); the executor-vs-broker
order/fill/brake reconciliation (producer side, Amy's sign-off). Found, not
changed (server, P2 scope): when the stored settings cannot be read, the
audit's changed keys list every key of the candidate, because there is no
current version to compare with.

**Verification (this candidate).** `npm run check`; `npm test` (contracts
95, UI 57 incl. 12 Settings, server contract 40); `node scripts/browser-p5.mjs`
890/890 under TZ=UTC with CI=true and under Europe/Vienna;
`node scripts/browser-p3.mjs` 2170/2170 and `node scripts/browser-p4.mjs`
1613/1613 with the P5 changes. One headless browser at a time, on the local
Apple Silicon workstation (HeadlessChrome 153); the Linux CI run (now with a
P5 step and a 45-minute browser job) is the merge gate for the font-dependent
checks. Screenshots and the AC → test map: `~/.local/share/joedesk-qa/p5/index.md`.
No push, deploy or review gate.


## JOED-26 / P6a repository preparation

This addendum records repository preparation and deployment history; the current
candidate still awaits publication and live adoption. JOED-26 originally reserved `inspr-calver-3` / `261016151218.0.0`
at `2026-10-16T15:12:18Z`, stable sequence 24. That rev 7 candidate was published
on `main` at `dafe7909af04ba5ded3c4b55504ea10970e07e4d` and its release set
verified under JOED-41, but it was never deployed.

JOED-50 superseded it before deployment with the initially rev 8 candidate
`261019102825.0.0`, reserved once at `2026-10-19T10:28:25Z`, stable sequence 25.
The changed artifact set includes paper-account cash, nullable position values
with per-field reasons, and the stable hero; it cannot reuse sequence 24's
immutable coordinate. It was published with contracts revision 9 on `main` at
`d36b5295295a6901e36fdf2dc0d64353ddf88d0e`; JOED-50 records its verified release
set. The 2026-10-21 cut-over aborted in phase 1 (`migrate-v2`) before the swap,
so sequence 25 was never deployed either.

JOED-58 superseded it before deployment with the rev 9 retry candidate
`261021015923.0.0`, reserved once at `2026-10-21T01:59:23Z`, stable sequence 26.
JOED-57 keeps desk values calm when they are not exact yet; JOED-58 normalizes
a v1 Fleet Config during migration with an audited update of required KEEP
symbols. Those changed board bytes require a later coordinate; neither
`261016151218.0.0` nor `261019102825.0.0` may be resealed or republished with
new bytes. Sequence 26 was published on `main` at
`6eacd6c707386cabe8245e1f97df2ef93965b394` and went live at
`2026-10-21T08:15Z` (OPS-354 attempt 3). Its live verification used the documented
smoke variant recorded on JOED-59.

JOED-59 reserved `261021083537.0.0` once at `2026-10-21T08:35:37Z`, stable
sequence 27, for smoke and health semantics on a settled v2 board. A valid,
unrejected stored Fleet Config is current (`fresh`) with an honest informational
receipt age. Release smoke polls health every 10 seconds for up to 150 seconds
by default, requiring fresh data/history, current config and a gateway confirmation
observed in the window before running the access probes. No contract changes are
needed. Sequence 27 was published on `main` at
`040d6756e92dc7c4e05fcf63b865242819b3d0ce` and has been live on csb0 since
`2026-10-21T11:22:48Z` (JOED-59).

JOED-60 reserved `261021113113.0.0` once at `2026-10-21T11:31:13Z`, stable
sequence 28, for the bounded yellow **Broker unsure** header when money is null
only because the broker check is unconfirmed. The shared gateway panel's check
age must be known and below 180 seconds; unknown or older checks keep missing
equity red. Cell copy and the other red rules stay unchanged.
Sequence 28 was published on `main` at
`a60f4c561b05fa26ee8fa1dd31ab725714399340` and has been live on csb0 since
`2026-10-21T15:22:58Z` (JOED-60).

JOED-70 reserved `261023100632.0.0` once at `2026-10-23T10:06:32Z`, stable
sequence 29, for one calm status line. A neutral Live surface carries a small
green mark; a red problem shows a short label in the header and the full
sentence once on the reserved line. A desk with no heartbeat falls back to
snapshot age, shown only when stale.
Sequence 29 was published on `main` at
`cdf843a587d1066d544beea92f7b8ceef5d103bf` under JOED-74 and has been live on
csb0 since `2026-10-23T14:53:28Z` (JOED-75).

JOED-77 reserves `261023155418.0.0` once at `2026-10-23T15:54:18Z`, stable
sequence 30, for performance at a glance. Today and Since start share the hero,
with exact percentages where a base is known; desk cards rank by since-start
result. Results metrics use info buttons and reserved rows for paired values.
`release/preparation.json` records sequence 29 as `previous_release`
(`published-candidate`, disposition `deployed`, `deployed: true`, JOED-74) and
`last_deployed_release`; this does not claim sequence-30 publication or adoption.
The explicit sequence-23 → sequence-24 migration anchor and legacy inventory
stay unchanged.
Footer/About and `/joe/healthz` derive the current version from the active build;
About lists the current build, deployed sequences 29, 28, 27 and 26, then legacy history; it
excludes both superseded, never-deployed publications.
`check-release` still enforces a strictly later reservation, with CLI regressions
covering equal/earlier coordinates after closure verification. Contract revision
9 and its complete set `000045fb7843a16be95f6a7e42d46d4b4ecb34b0efd39fc987bee444817fc9d5`
remain unchanged by the sequence-30 reservation, as do the pusher/executor
requirements, producer pins and null deployment pins. No retry release set is
claimed for sequence 30; main-push CI produces it after publication. The custom legacy scheme is not relabelled as
INSPR-CalVer1. JOED-19's owner decision supersedes JOED-13, whose v2 proposal is
cancelled and consolidated into JOED-26. Published history stays intact.

The shared global-default pin is the merged/live, independently reviewed
consumer bundle record on INSPR-486: source
`01b3080948c21899cbbacbfa3447da6799af1b56`, config
`bf6aa144cd73dc97dc941f0f0914138b04ae0a28fbead5123465b15b1f2a2fd9`, manifest
`d4dcb8c05d0fcad7d60183156166c5a30f21e6abc1ac0c274ee3e0791e5ea912`.
No product-specific template selection exists; JOED-19 chooses the shared
default. The complete unchanged bundle is vendored and verified offline on
normal builds. The one thin product adapter serves footer/current About,
resolves auto tint from product branding and supplies English interaction text.
The source is a candidate until publication, review, producer/OPS compatibility,
Markus's cutover and live behavior gates pass.

| JOED-26 acceptance / P6 deferred scope | Implementation and executable evidence | Remaining owner gate |
| --- | --- | --- |
| Migration inventory, UTC reservation, sequence and legacy anchor | `release/preparation.json`; `release/versioning.mjs`; `P6 version: …` and `P6 reservation: …` in `test/release.mjs` cover dates, aliases, 32-bit overflow, suffixes, scheme rejection, collisions, ordering and anchors | Candidate is not authoritative; immutable publication and live behavior remain coordinator/OPS/Markus work |
| Complete shared presentation bundle, saved pin and thin Pretty adapter | `public/joe/vendor/calver/` pins the recorded source/config/manifest; normal offline build checks enforce exact closure/regular files/sizes/hashes/tracking. `version-display.js` uses the shared renderer/helper; P6 browser asserts six segments, no v/tail, Pretty/SemVer, zero-width seconds, reveal/copy, keyboard/touch, UTC labels, reduced motion and English confirmation at 390/1440 in light/dark | Tick visual approval and coordinator gate; `--require-adoption` stays closed until publication/live evidence |
| Runtime and Nix pins; no new dependencies; release asset graph | Docker/test OCI index digests and immutable nixpkgs revision/NAR hash in preparation; Docker and Nix run `scripts/check-release.mjs` offline; `P6 normal build …` mutates bytes, extras, missing files and manifest; P3 worker closure test; `P6 staged ingress …` rejects stale/duplicate asset versions | OPS records exact built board image/source and its own immutable nixcfg lock; no published artifact was replaced |
| Board/pusher/executor compatibility | `release/contracts.json` records exact IDs, participant requirements and complete sorted path/size/hash contract-set digest; `P6 staged ingress …` proves real HTTP v2 accept, v1/unknown reject and durable sequence; full P1/P2 tests remain required | Amy's actual producer and executor evidence + JOED-20; fixtures do not establish deployed compatibility |
| Data backup, migration and exact compatible rollback (class d, §8) | `release/data-migration.mjs`, explicit offline `scripts/prepare-data.mjs`; `P6 backup and v2 staging …` proves byte-exact restore, private modes, new v2 receipt and restart/replay continuity, no fabricated legacy history, wrong-board rollback rejection; `P6 backup refuses …` proves corruption/extra/missing/symlink/size rejection; server refuses legacy stores | OPS supplies real quiesced backup, compatible pins and rehearsed `just rollback-joedesk`; preserve old artifacts |
| Anonymous health, protected reads, auth redirects (class g, §7/§8) | Existing exact health allowlist remains; the app stamps every response `X-JoeDesk-Origin: app`. `scripts/smoke-release.mjs` checks canonical metadata/feed ages, stamped health and unstamped SSO denials on anonymous and spoofed-identity reads, UI/assets and near-health paths. `P6 staged ingress …` proves the bare app fails and the local proxy/CLI passes with oauth2-proxy-style bare JSON 401s and browser redirects; `P6 SSO smoke …` rejects missing health proof, stamped denials, exposed surfaces, broad exemptions and per-read spoof bypasses. Health 302 remains auth_required; size/privacy checks retained | OPS exact-path SSO exception + preserve app origin stamp + edge identity-header stripping + production-host gate incl. cs0; signed-in spoof check verifies audit actor replacement; Markus/Tick signed-in UI; no production smoke performed |
| Tick: Saved line always one line; count long lists; accessible full string | `settings-model.savedText`, CSS width/height/ellipsis and hover title in Settings; a visually hidden full-text span describes only the primary control (or the named wake-window group) through aria-describedby, with no Saved tab stop. P5 no-shift and P6 accessibility-tree checks cover long strings and one description owner per field | Tick review of local P6a shots; phone remains read-only |
| Tick: phone no-break space before middle dot | `format.joinUnits` with phone option in app text observer; unit regression and direct P6 raw DOM checks; copy-only browser assertions accept NBSP-dot | Tick visual review; no data/accounting semantics change |

The release evidence command requires a clean committed tree and a validation
run identifier, binds source commit/tree, runtime closure and exact contract-set
digests, and explicitly emits `candidate-awaiting-coordinator-gates` with no published
artifacts. The coordinator adds actual artifact coordinates/digests,
SBOM/signatures/provenance and review evidence before any immutable release set
is published. The candidate is never labelled an authoritative live release by these
local build checks.

The exact OPS-354 handoff and CLI forms live in README's P6a section. No nixcfg,
producer, secret, broker, production host or infrastructure was changed. No push,
deployment, cross-family gate or product/taste approval is part of this worker.

Fix round 1 also carries the compatible Fleet Config change log byte-for-byte
into v2 after schema validation. `P6 backup and v2 staging …` checks success,
failure and pending entries, exact v1 rollback and v2 backup/restore;
`P6 migration refuses …` checks invalid audit data fails before staging begins.
`release/preparation.json` records the deployed legacy `db621bf` anchor without
inventing a sequence-23 tag. The evidence CLI uses its own repository root and
names the preparation manifest digest `preparation_sha256`. README records
directory ownership/swap/rollback, the exact token-only `/joe/inbox` and
`/joe/inbox/results` edge exceptions (separate routers, no SSO, never prefix
matches), staging receipt
and pusher-sequence rules, and the public smoke's exact route/outputs/exit codes.
