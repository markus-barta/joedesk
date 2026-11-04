// JOED-186: fixed work, independent of JoeDesk modules, data and page styles.
// Seven timed 256 × 8 layouts and CPU loops target ~110–180 ms total
// on a quiet laptop, plus one untimed warm-up (~16–26 ms). Fixed work.
// Keep this function self-contained: CDP evaluates it in the page, once.
export function referenceProbeWorkload() {
  const durations = [], layouts = [], scripts = [];
  for (let rep = -1; rep < 7; rep++) {
    const start = rep >= 0 ? performance.now() : 0;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;width:1024px!important;height:8192px!important;contain:strict!important;pointer-events:none!important;';
    try {
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = 'table{all:initial;display:table;table-layout:fixed;border-collapse:collapse;width:1024px;font:12px/16px monospace;color:#000;direction:ltr}tr{all:initial;display:table-row}td{all:initial;display:table-cell;box-sizing:border-box;width:128px;height:24px;padding:4px;border:1px solid #888;font:12px/16px monospace;white-space:nowrap}';
      root.append(style);
      const table = document.createElement('table');
      for (let row = 0; row < 256; row++) {
        const tr = document.createElement('tr');
        for (let col = 0; col < 8; col++) {
          const td = document.createElement('td');
          td.textContent = 'Reference 012345';
          tr.append(td);
        }
        table.append(tr);
      }
      root.append(table);
      document.documentElement.append(host);
      table.getBoundingClientRect(); // Force style and layout while connected.
    } finally { host.remove(); }
    const layoutEnd = rep >= 0 ? performance.now() : 0;
    let checksum = 0;
    const imul = Math.imul;
    // ~10 ms of JS per rep on a quiet laptop, comparable to DOM/layout.
    for (let i = 0; i < 10000000; i++) checksum = imul(checksum ^ i, 16777619) >>> 0;
    // Consume the CPU result without retaining state in the page.
    if (!Number.isFinite(checksum)) throw new Error('Invalid reference probe checksum');
    if (rep < 0) continue; // Discard warm-up work before taking any timestamps.
    const end = performance.now();
    layouts.push(layoutEnd - start);
    scripts.push(end - layoutEnd);
    durations.push(end - start);
  }
  durations.sort((a, b) => a - b);
  layouts.sort((a, b) => a - b);
  scripts.sort((a, b) => a - b);
  return { layoutMedianMs: layouts[3], jsMedianMs: scripts[3], medianMs: durations[3], minMs: durations[0], maxMs: durations[6], reps: durations.length };
}

// Call before navigation installs the attempt's observer / timing windows.
// The new document also discards buffered tasks from this evaluate call.
export async function runReferenceProbe(page) {
  return page.evaluate(`(${referenceProbeWorkload.toString()})()`);
}

// Discard the previous JoeDesk document (including pending layout) before
// probing. The attempt's existing load() still opens a fresh measured page.
// Evidence failures must never prevent that attempt or change its decisions.
export async function captureReferenceProbe(page, probe, waitFor) {
  try {
    await page.s('Page.navigate', { url: 'about:blank' });
    await waitFor(page, `location.href === 'about:blank' && document.readyState === 'complete'`);
    const result = await probe(page);
    if (!result || !['layoutMedianMs', 'jsMedianMs', 'medianMs', 'minMs', 'maxMs', 'reps'].every(field => Number.isFinite(result[field]))) {
      throw new Error('Invalid reference probe: fields must be finite numbers');
    }
    return { probe: result, probeMs: result.medianMs };
  } catch (error) {
    const probeReason = String(error?.message ?? error).replace(/[|\r\n]/g, ' ').slice(0, 60);
    return { probe: null, probeMs: null, probeReason };
  }
}

export function probeCell(row) {
  return row.probe ? `${row.probe.layoutMedianMs.toFixed(1)} / ${row.probe.jsMedianMs.toFixed(1)}`
    : `unavailable${row.probeReason ? ` (${row.probeReason})` : ''}`;
}
