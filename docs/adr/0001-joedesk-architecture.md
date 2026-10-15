# ADR 0001: JoeDesk contracts and resilient read model

Status: P1 implementation candidate for JOED-21, under JOED-19. Coordinator
review remains outstanding. No runtime cutover, producer edit, push or deployment
is part of P1. The existing server and browser still use their legacy contracts.

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
will use INSPR-CalVer3 (§8). Compatibility is an exact allowlist in the manifest,
never inferred from version ordering. Old/unknown schemas and invalid payloads
return a transport-neutral `status: 422`; `validateAndRetain` retains the identical
last-good value for all five contracts, and `acceptSnapshot` adds snapshot sequence
and receipt handling. P2 must map rejection to HTTP 422 before any atomic write,
and persist a separate safe rejection reason. Transport oversize remains HTTP
413 at the pre-parse body limit; an overbound parsed contract returns 422.
P1 tests exercise this boundary, not a claim that the legacy HTTP server now
accepts v2. Malformed JSON remains HTTP 400 in P2.

## 2. Freshness truth

Data, history and results carry an independently monotonic positive safe-integer
`seq` and UTC `generatedAt`. Producers persist sequences across restarts; P2
persists accepted sequence and generation-progress metadata across board
restarts. Exact/replayed or decreasing sequence returns 422
`sequence_replayed`; regressing generation/receive clocks return 422
`clock_regressed`. Recovery requires a higher valid sequence, not clearing the
last-good file. No wall-clock-derived sequence or guessed producer identity.

Ingress forbids `receivedAt`; the server stamps it after validation. Served
snapshots require it. Age is server now minus server receipt, never producer
clock minus browser clock. P2 serves its clock so the browser can anchor an
elapsed monotonic timer; a client clock error cannot make old data fresh.
Future producer clocks do not make receipt age negative or extend freshness.
Server clock regressions require an operator diagnostic, not a freshness reset.

At receipt age below 60 seconds a reported value is fresh; exactly 60 seconds
is stale. The 30-second producer cadence gives this two-cadence threshold.
`generatedAdvancedAt` records the receive time of the last advancing generation.
New sequences with unchanged `generatedAt` do not advance it. After 60 seconds
without generation progress, data is stale with `producer_frozen`, displaying
the progress age. Otherwise stale displays receipt age and `snapshot_stale`.
This metadata stays outside producer JSON. All error codes come from the one
closed enum, including transport and storage failures.

The Gateway signal is exclusively `apiSessionReady` plus `checkedAt` and a
reason when false. A port, container status or executor `gatewayReachable`
cannot set it true. The Gateway panel and each money field have separate
states: upstream loss need not erase an independent complete result. P2 must
also track advancement of the Gateway's own check timestamp; a repeatedly
relayed old check must become unconfirmed even if other data advances. P1
proves session semantics and separate panel states; the per-signal progress
tracker belongs to P2 along with persistent freshness metadata.

## 3. Panel isolation and approved UI mapping

`panel-state.mjs` defines fresh, stale with age, not reported, and broken with a
closed reason. `fixtures/panel-state-table.json` names every tested panel/cell;
each incident records the expected state, age and reason for all 25 entries.
State precedence is rejected feed/explicit reason → broken, missing/null without
reason → not reported, then stale/fresh. False HALT and a known-empty position
list are reported values. Missing rows are never known-empty. Independent
history, results and Fleet Config continue when data fails. An explicit null
with a field error may display a separately retained prior value, labeled as
last-good; it cannot enter current totals or observed history as fresh data.
The helper's age is the feed/progress age; P2 must also persist the original
receipt of each retained field and show that older value's age beside it.

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
homes. The masked account hint is optional; no real hint ships in fixtures.

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
ticket with the recorded owner decision. The current release source remains
legacy `calendar` until P6 completes the migration inventory/gates. P1 does
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
| a Gateway up but dead | API-session readiness, explicit upstream reason, independent money states | `a-gateway-up-but-dead`; session-reason consistency in `test/contracts.mjs` | P2 relayed-check freeze test; OPS real session probe, never TCP-only |
| b Null accounting / DAY | Per-field reasons, evidence gates, complete exact sums, last-good display | `b-equity-null-gateway-ready`, `b-weekend-no-sod`, `b-incomplete-family`; null sibling/retention test | P3 hero and desk render with one null, no red flash on brief retention |
| c Image regression / CPU | Exact contract allowlist, persistent sequence/progress, bounded linear work, immutable compatible pins | `c-old-producer-image`, `c-frozen-producer`, `unknown-schema`, `stale-receive-age`; replay/size tests | OPS image-pin recreation and CPU benchmark; P2 restart persistence |
| d Routing/deploy | Declarative routing, canonical-host inclusion, version-bound live smoke/rollback | `d-routing-stub`; production-host function test | P6 proxy path smoke and rehearsed rollback with previous pin |
| e Layout manager | Plain fixed modules, no layout reads/writes or GridStack dependency | `e-layout-storage-unavailable`; contract import/selector test with storage and GridStack getters that throw | P3 no-storage browser render at three widths; remove old GridStack checks with code |
| f History | Time axis, observed basis separation, explicit gaps, display-only dotted continuity | `f-history-partial-projection`, `f-history-gap`; ordered/bounded history contract tests | P2/P3 compaction, continuity, clipping and basis-break tests described in §6 |
| g Expired auth / unverifiable live | Retain last-good on SSO failure, explicit auth reason; public allowlisted health | `g-expired-sso`; nested health leakage rejection tests | P2 endpoint and P6 unauthenticated smoke/SSO-negative tests |
| h Stale secondary positions | Only live-API position source, no side-file fallback | `h-secondary-position-source`; source rejection test | OPS producer open-order/position truth reconciliation |
| i Store cap | Byte/item bounds, size alarm, bounded rollup and explicit executor failure | `i-executor-ledger-cap`, `i-history-size-alarm`, `i-oversize-data`; byte/point limit tests | P2 near-cap compaction/write failure; OPS ledger compaction/recovery |
| j Time | One explicit-zone time module, NY accounting/Vienna results distinction | `j-ny-midnight-gap`; all 24 time vectors, both odd seasons | P2 module runs same vectors plus pinned holidays/early closes; P4 Vienna bucket tests |

## Separate proposed owner tickets (not filed or implemented here)

These are proposed scopes for OPS/Amy, not JOED-21 implementation authority.
The coordinator must deduplicate/file them in the owning personal OPS project;
no hsb0 files, pins, secrets, executor or infrastructure are edited by P1.

1. **OPS proposal: pusher sequence and receive protocol.** Persist monotonic
   seq across recreate, advance generatedAt only for actual new generation,
   never send receivedAt, accept safe server receipt/rejection responses and
   publish API-session check progress. Test frozen generation, retry, restart,
   clock regression and an accepting socket with a failed session. Coordinate
   P2's durable progress metadata and pin-compatible rollback.
2. **OPS proposal: shared contracts in producer CI.** Vendor this exact complete
   contract set/digest in the producer repo and JOED-20, test ingress fixtures
   with the shared JS semantics, agree v2/decimal/evidence/owner mappings with
   Amy, and declare board/pusher/executor compatibility in declarative pins.
   Include a recreate-from-pin test and a bounded CPU regression benchmark.
3. **OPS proposal: closed reason enum adoption.** Map real gateway, ownership,
   baseline and store failures to the shared enum per field; preserve unknown
   data as absent/null, never invent zeros, never emit arbitrary reason strings.
   Test every Amy failure recording and API-session truth; add codes only by
   reviewed contract-set revision.
4. **Optional OPS proposal: read-only machine data identity.** Provision and
   rotate a narrowly scoped read capability independently of ingress/SSO;
   implement deny-write/deny-config and redaction tests. Public health does not
   depend on it. No secret values in tickets or fixtures.

JOED-20 already owns the results producer; its executor-ledger compaction and
bounded retention remain OPS-owned, not an excuse for a board-side trade path.
The worker marker and version-adoption outcome are recorded on JOED-21.

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
