(function () {
  "use strict";

  window.JoeVersion = Object.freeze({
    APP_VERSION: "26.09.12.12.54",
    VERSION_HISTORY: [
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
