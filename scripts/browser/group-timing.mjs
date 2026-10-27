// Read only the append-only gate logs: this also counts checks inside shared
// audits and screenshots captured directly, without wrapping either operation.
export function createGroupTiming({ results, shots, now = () => performance.now() }) {
  const groups = new Map();
  const started = now();
  let active = 'setup', since = started;
  let checks = results.length, screenshots = shots.length, report;

  function close(at) {
    const group = groups.get(active) ?? { name: active, ms: 0, checks: 0, screenshots: 0 };
    group.ms += at - since;
    group.checks += results.length - checks;
    group.screenshots += shots.length - screenshots;
    groups.set(active, group);
    since = at;
    checks = results.length;
    screenshots = shots.length;
  }

  return {
    // Call only for a selected block. A later block with the same name adds
    // to its existing row; skipped blocks never open a row or close the last.
    enter(name) {
      if (report) throw new Error('Group timing already finished');
      close(now());
      active = name;
    },
    finish() {
      if (!report) {
        const ended = now();
        close(ended);
        report = { totalMs: ended - started, groups: [...groups.values()].sort((a, b) => b.ms - a.ms) };
      }
      return report;
    },
  };
}

// One value-free Markdown table for both stdout and the QA index. Only group
// names, wall time and counts are included; no check details or capture paths.
export function groupTimingTable({ totalMs, groups }) {
  const seconds = ms => (ms / 1000).toFixed(3);
  return `## Time per group

Wall time: ${seconds(totalMs)} s (setup through cleanup). Repeated blocks are summed.

| Group | Seconds | Checks | Screenshots | Share |
| --- | ---: | ---: | ---: | ---: |
${groups.map(g => `| ${g.name} | ${seconds(g.ms)} | ${g.checks} | ${g.screenshots} | ${totalMs ? `${(g.ms / totalMs * 100).toFixed(1)}%` : '—'} |`).join('\n')}
`;
}
