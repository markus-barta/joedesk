(function () {
  "use strict";

  window.JoeVersion = Object.freeze({
    APP_VERSION: "0.4.1",
    VERSION_HISTORY: [
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
