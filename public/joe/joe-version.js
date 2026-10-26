(function () {
  "use strict";

  window.JoeVersion = Object.freeze({
    APP_VERSION: "261026070713.0.0",
    VERSION_SCHEME: "inspr-calver-3",
    RELEASE_SEQUENCE: 33,
    VERSION_HISTORY: [
      {
        version: "261026070713.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-26",
        title: "Faster Results",
        changes: ["Keep switching Results periods fast as the trade history grows.", "Show a dash for values that are not exact; keep outage values out of totals and hide them after an hour."],
      },
      {
        version: "261025221940.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-25",
        title: "Exact desk and position values",
        changes: ["Show exact desk money and position values, with percentages when their base is known.", "Explain unavailable values and retain each position's own observation age."],
      },
      {
        version: "261025144826.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-25",
        title: "Calmer outage view",
        changes: ["Explain a shared broker outage once per section, with labelled dashes and distinct reasons beside their fields.", "Keep each retained observation’s age and the icon and short reason in collapsed phone summaries."],
      },
      {
        version: "261023155418.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-23",
        title: "Performance at a glance",
        changes: ["Show Today and Since start side by side, in euros and percent, with desks ranked by result.", "Keep shared data status in one board caption, and explain Results metrics through small info buttons.", "Keep paired Results values inside their cards, chart tips opaque, and term underlines faint."],
      },
      {
        version: "261023100632.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-23",
        title: "Calm status line",
        changes: ["Show one calm status line: neutral Live, a short red label, and the problem sentence once.", "Fall back to snapshot age when a desk has no heartbeat, and show it only when stale."],
      },
      {
        version: "261021113113.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-21",
        title: "Calmer broker check-ins",
        changes: ["Show Broker unsure during a brief gap in the broker check-in.", "Keep missing money red when the broker check age is unknown or reaches three minutes."],
      },
      {
        version: "261021083537.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-21",
        title: "Reliable checks for a settled board",
        changes: ["Keep valid Fleet Config current between changes.", "Wait for fresh data and history and an observed broker confirmation before release checks."],
      },
      {
        version: "261021015923.0.0",
        versionScheme: "inspr-calver-3",
        date: "2026-10-21",
        title: "Calmer desk values and a safer cut-over",
        changes: ["Keep desk values calm while exact values are not available yet.", "Migrate the existing Fleet Config with an audited update of required KEEP symbols."],
      },
      {
        version: "26.09.21.12.00",
        date: "2026-09-21",
        title: "Decision pulse makes the household legible",
        changes: [
          "Add a compact household strip for virtual busy count, KEEP scope, and the J + Joe + Joel rollup.",
          "Surface each desk's short happened/next learning line before the detailed card timeline.",
        ],
      },
      {
        version: "26.09.14.17.40",
        date: "2026-09-14",
        title: "Clear reasons and steadier accounting status",
        changes: [
          "Explain each status light in one short line; read more expands diagnostics in place.",
          "Keep carried balances and pending DAY data yellow when equity remains usable.",
        ],
      },
      {
        version: "26.09.14.17.08",
        date: "2026-09-14",
        title: "Keep the board available when OPEN marks recover",
        changes: ["Accept the existing producer method for execution-owned OPEN values in the browser.", "Keep traffic lights and session DAY estimates available as current marks recover."]
      },
      {
        version: "26.09.14.16.32",
        date: "2026-09-14",
        title: "One accounting light, details when needed",
        changes: [
          "Show one compact accounting traffic light; open the information control for diagnostics.",
          "Keep stale and unavailable data distinct as snapshots age, including during the trading session.",
          "Label fallback DAY values as session estimates with their actual reference time.",
        ],
      },
      {
        version: "26.09.12.20.36",
        date: "2026-09-12",
        title: "Valuation age stays visible",
        changes: [
          "Show the age of retained valuation inputs separately from a healthy Gateway or a fresh producer heartbeat.",
          "Keep Gateway and accounting warnings visible; missing DAY and OPEN values remain explicitly unavailable.",
        ],
      },
      {
        version: "26.09.12.12.54",
        date: "2026-09-12",
        title: "Carried balances stay distinct from observations",
        changes: [
          "Keep the last verified desk balances visible while current valuation inputs are unavailable.",
          "History leaves carried spans to the gray dotted gap display instead of recording them as fresh observations.",
        ],
      },
      {
        version: "26.09.12.12.03",
        date: "2026-09-12",
        title: "OPEN follows the owned trading lots",
        changes: [
          "Accept verified OPEN values calculated from execution-owned lots, current broker marks, and explicit EUR conversion.",
          "KEEP holdings and unproved ownership remain excluded; incomplete data stays clearly unavailable.",
        ],
      },
      {
        version: "26.09.12",
        date: "2026-09-12",
        title: "DAY and OPEN say what they know",
        changes: [
          "DAY appears only with explicit EUR source evidence from IB DailyPnL or a durable start-of-day virtual-equity baseline.",
          "OPEN uses complete desk-level IB unrealized P&L and a matching household rollup when the producer supplies it.",
          "Healthy-Gateway gaps are labelled as not wired or baseline-pending; Gateway outages remain visibly distinct.",
        ],
      },
      {
        version: "26.09.11",
        date: "2026-09-11",
        title: "Fleet Config reaches the paper fleet safely",
        changes: [
          "Diff and Confirm now guard every Fleet Config propagation from the back plane.",
          "Each propagation writes a new shared revision for Amy and desks plus a durable, SSO-attributed outcome containing changed-key names only.",
          "The plane shows success and failure toasts and the latest propagation records without logging config values.",
          "Secret slots show redacted agenix and Janus capability/path references only; credential values and rotation stay outside JoeDesk.",
        ],
      },
      {
        version: "0.8.0",
        date: "2026-09-11",
        title: "Fleet Config, explained on the back",
        changes: [
          "The whole JoeDesk board flips as one card between the trading view and Fleet Config.",
          "Technical controls and plain-language explanations stay side by side, with selection-bound preview fields.",
          "Diff, Confirm and Save Preview are browser-local; Propagate clearly points to HOSTD-49/50 until delivery is connected.",
        ],
      },
      {
        version: "0.7.7",
        date: "2026-09-11",
        title: "Phone layouts remember their order",
        changes: [
          "Keep a separate tile order on your phone while preserving your desktop arrangement.",
          "Save and restore phone order with named layouts, including after reloads or screen-size changes.",
          "Automatic resizing stays separate from manual edits, so it does not create unsaved-change prompts.",
        ],
      },
      {
        version: "0.7.6",
        date: "2026-09-11",
        title: "Continuous History, clear evidence",
        changes: [
          "Gray dotted lines connect missing History spans and carry the last value; an assumed €5,000 start is explicitly marked.",
          "Observed desk values stay solid green, blue and brown. Estimates never change stored history, P&L or comparisons.",
          "The same gap policy applies to every desk and time range, with readable calendar labels and a line-meaning legend.",
        ],
      },
      {
        version: "0.7.5",
        date: "2026-09-11",
        title: "Layouts that remember your work",
        changes: [
          "Return to your last layout, save changes in place, or save a separate named arrangement.",
          "Switching, resetting, deleting and overwriting layouts protect unsaved work with clear confirmations.",
          "Layout and Settings use compact SVG controls with accessible labels and keyboard focus.",
        ],
      },
      {
        version: "0.7.4",
        date: "2026-09-11",
        title: "Readable History at every size",
        changes: [
          "History labels adapt from weekday and time to days, weeks, months and years in Europe/Vienna.",
          "Subtle calendar boundaries replace unexplained trading-session shading.",
          "Chart sizing stays stable across phone, desktop and saved tile layouts, keeping labels clear of the frame.",
        ],
      },
      {
        version: "0.7.3",
        date: "2026-09-11",
        title: "Desk equity and accessible J history",
        changes: [
          "Virtual desk equity is primary; whole paper-account NAV, including KEEP holdings, is shown separately.",
          "Captured J-family results appear in History with shared desk and time filters, on their own native-currency scale.",
          "Supplied Open P&L is accepted, and restored desk accounting no longer carries an unavailable warning just because captured history remains available.",
        ],
      },
      {
        version: "0.7.2",
        date: "2026-09-11",
        title: "Account equity and captured J history",
        changes: [
          "Paper account equity remains visible when a desk has incomplete accounting, with KEEP holdings clearly included.",
          "J shows captured results and an actual-timestamp history curve, calculated from family-owned fills using FIFO and recorded fees.",
          "Partial coverage, native currency and unavailable complete totals stay explicit; existing desk history is preserved.",
        ],
      },
      {
        version: "0.7.1",
        date: "2026-09-11",
        title: "Comparable desk history",
        changes: [
          "History separates changed calculations so older Joel values cannot distort the current chart.",
          "Earlier observations remain stored, with a clear explanation when they are excluded from comparisons.",
          "J reporting periods and gaps remain intact while other desks keep updating.",
        ],
      },
      {
        version: "0.7.0",
        date: "2026-09-10",
        title: "Verified reporting periods",
        changes: [
          "Desk figures show the verified reporting start date and supplied fee and currency basis.",
          "J-family reporting identifies J + J2–J5 while keeping Joe and Joel separate.",
          "History and comparisons keep earlier unverified results separate from the new reporting period.",
          "Unavailable desk figures remain gaps in history while other desks continue updating.",
        ],
      },
      {
        version: "0.6.1",
        date: "2026-09-10",
        title: "One canonical board address",
        changes: [
          "Opening /joe now permanently redirects to /joe/ while keeping the query string.",
          "The board declares /joe/ as its document base so relative assets and data load consistently.",
        ],
      },
      {
        version: "0.6.0",
        date: "2026-09-10",
        title: "Clearer supplied positions",
        changes: [
          "Position values use their supplied currency; missing values remain unavailable.",
          "Explicit legacy holdings are labeled as excluded from Stage-0 accounting.",
          "Incoming position rows are validated, with distinct incomplete and empty coverage.",
        ],
      },
      {
        version: "0.5.0",
        date: "2026-09-10",
        title: "History that holds up and clearer desk activity",
        changes: [
          "History survives failed refreshes with a Retry control; sparklines follow the selected time range.",
          "Desk cards explain supplied actions and learning state, with a timeline of changes observed by this browser.",
          "Compare desks over shared timestamps, with explicit missing data and taller default desktop tiles.",
        ],
      },
      {
        version: "0.4.1",
        date: "2026-09-10",
        title: "Clearer values and a readable phone layout",
        changes: [
          "Paper capital is labeled clearly; unavailable Day P&L and position data are no longer mistaken for zero or none.",
          "The last valid snapshot stays visible through refresh failures, with advancing age and distinct heartbeat status.",
          "Narrow screens stack tiles automatically while preserving desktop layouts and readable controls.",
        ],
      },
      {
        version: "0.4.0",
        date: "2026-09-10",
        title: "JoeDesk becomes independent",
        changes: [
          "JoeDesk now owns its application, data contracts, tests and releases in a dedicated repository.",
          "Existing board address, sign-in protection, inbox and saved layouts remain compatible.",
        ],
      },
      {
        version: "0.3.0",
        date: "2026-09-10",
        title: "Compact board and personal layouts",
        changes: [
          "Grid columns, row height, tile padding and gaps saved with each named layout.",
          "Compact SVG header and Layout menu replace the introductory strip and toolbar.",
          "Bright, Dark and System themes apply across widgets and history charts.",
        ],
      },
      {
        version: "0.2.0",
        date: "2026-09-10",
        title: "Board UX polish",
        changes: [
          "All three desks can show in history at once, with an All bots toggle and clearer Desks vs Range controls.",
          "Named layout save, load, rename, and delete; default layout stays available.",
          "Footer version history, US RTH shading, today marker, and more comfortable grid spacing.",
        ],
      },
      {
        version: "unversioned milestone",
        date: "2026-09-09",
        title: "Configurable GridStack household board",
        changes: [
          "Draggable and resizable widget grid with automatic layout persistence across reloads.",
          "Canonical host gate extended for cs0, Tailscale mesh, and localhost.",
        ],
      },
      {
        version: "unversioned milestone",
        date: "2026-09-09",
        title: "History time axis and zoom",
        changes: [
          "Chart.js history with real timestamps, wheel or pinch zoom, and shift-drag pan.",
        ],
      },
      {
        version: "unversioned milestone",
        date: "2026-09-08",
        title: "Household history chart",
        changes: [
          "Inbox-backed equity history from /joe/history.json with desk series and sparklines.",
          "Private split-flap household board replacing the public drill card.",
        ],
      },
      {
        version: "unversioned milestone",
        date: "2026-09-02",
        title: "Household money page",
        changes: [
          "English household money view with Tabler layout for the three desks.",
        ],
      },
      {
        version: "unversioned milestone",
        date: "2026-08-27",
        title: "Joe board at /joe/",
        changes: [
          "First static Joe paper-trading board shipped on hostdash.",
        ],
      },
    ],
  });
}());
