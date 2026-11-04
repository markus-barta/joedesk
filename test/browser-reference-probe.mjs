import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { runReferenceProbe, referenceProbeWorkload, captureReferenceProbe, probeCell } from '../scripts/browser/reference-probe.mjs';

// A DOM recorder exercises the serialized page workload itself, not a second
// implementation. No browser, JoeDesk data, wall-clock timing or layout engine.
function fixture({ layoutError = false } = {}) {
  const created = [], roots = [], connected = new Set();
  let layouts = 0, loops = 0, ticks = 0;
  const layoutDurations = [9, 2, 7, 4, 6, 1, 3];
  const jsDurations = [1, 8, 2, 6, 3, 7, 4];
  const document = {
    documentElement: { append(host) { connected.add(host); } },
    createElement(tag) {
      const node = { tag, style: {}, children: [],
        append(child) { this.children.push(child); },
        attachShadow(options) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), { mode: 'closed' });
          const root = { children: [], append(child) { this.children.push(child); } };
          roots.push(root);
          return root;
        },
        getBoundingClientRect() {
          assert.equal(connected.size, 1, 'layout occurs on the connected synthetic DOM');
          layouts++;
          if (layoutError) throw new Error('layout failed');
          return { width: 1024, height: 6144 };
        },
        remove() { assert.equal(connected.delete(this), true); },
      };
      created.push(node);
      return node;
    },
  };
  const context = { document, performance: { now() {
    const tick = ticks++;
    const rep = Math.floor(tick / 3), part = tick % 3;
    return rep * 100 + (part ? layoutDurations[rep] : 0) + (part === 2 ? jsDurations[rep] : 0);
  } }, Math: { imul(a, b) { loops++; return Math.imul(a, b); } } };
  const page = { calls: 0, async evaluate(source) { this.calls++; return runInNewContext(source, context); } };
  return { page, created, roots, connected, counts: () => ({ layouts, loops }) };
}

test('JOED-186 (a): serialized reference probe repeats exactly the same isolated DOM and CPU shape without public imports', async () => {
  const source = readFileSync(new URL('../scripts/browser/reference-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s|public\/|__joedesk|Math\.random/);
  assert.doesNotMatch(referenceProbeWorkload.toString(), /Date\./);
  for (let run = 0; run < 2; run++) {
    const f = fixture();
    const result = await runReferenceProbe(f.page);
    assert.equal(f.page.calls, 1, 'warm-up and all seven timed repetitions use one evaluate');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { layoutMedianMs: 4, jsMedianMs: 4, medianMs: 9, minMs: 7, maxMs: 10, reps: 7 });
    assert.deepEqual(f.counts(), { layouts: 8, loops: 80000000 });
    assert.equal(f.connected.size, 0, 'no probe DOM survives');
    assert.equal(f.created.filter(n => n.tag === 'div').length, 8);
    assert.equal(f.created.filter(n => n.tag === 'style').length, 8);
    for (const root of f.roots) {
      assert.equal(root.children[0].tag, 'style');
      const table = root.children[1];
      assert.equal(table.tag, 'table');
      assert.equal(table.children.length, 256);
      assert.ok(table.children.every(row => row.tag === 'tr' && row.children.length === 8));
      assert.ok(table.children.flatMap(row => row.children).every(td => td.tag === 'td' && td.textContent === 'Reference 012345'));
    }
    const hosts = f.created.filter(n => n.tag === 'div');
    assert.equal(new Set(hosts.map(h => h.style.cssText)).size, 1);
    assert.match(hosts[0].style.cssText, /left:-10000px/);
    assert.match(hosts[0].style.cssText, /contain:strict/);
    assert.doesNotMatch(hosts[0].style.cssText, /display:none|content-visibility/);
    assert.equal(new Set(f.roots.map(root => root.children[0].textContent)).size, 1);
  }
});

test('JOED-186 (a): reference probe removes its DOM even when forced layout throws', async () => {
  const f = fixture({ layoutError: true });
  await assert.rejects(runReferenceProbe(f.page), /layout failed/);
  assert.equal(f.connected.size, 0);
});

test('JOED-186 L1/L2: capture waits for a neutral document and tolerates navigation, readiness and probe errors', async () => {
  for (const failure of [null, 'navigation', 'readiness', 'probe']) {
    const events = [];
    const result = { layoutMedianMs: 5, jsMedianMs: 7, medianMs: 12, minMs: 10, maxMs: 14, reps: 7 };
    const fail = stage => { if (failure === stage) throw new Error(`${stage}|\n${'x'.repeat(80)}`); };
    const page = { async s(method, params) {
      assert.equal(method, 'Page.navigate');
      assert.deepEqual(params, { url: 'about:blank' });
      events.push('navigation');
      fail('navigation');
    } };
    const captured = await captureReferenceProbe(page, async receivedPage => {
      assert.equal(receivedPage, page);
      events.push('probe');
      fail('probe');
      return result;
    }, async (receivedPage, expression) => {
      assert.equal(receivedPage, page);
      assert.equal(expression, "location.href === 'about:blank' && document.readyState === 'complete'");
      events.push('readiness');
      fail('readiness');
    }, () => { events.push('timestamp'); return new Date('2026-11-04T10:00:00.000Z'); });
    const stages = ['navigation', 'readiness', 'timestamp', 'probe'];
    assert.deepEqual(events, failure ? stages.slice(0, stages.indexOf(failure) + 1) : stages);
    if (failure) {
      assert.equal(captured.probe, null);
      assert.equal(captured.probeMs, null);
      assert.equal(captured.probeReason.length, 60);
      assert.doesNotMatch(captured.probeReason, /[|\r\n]/);
      assert.equal(probeCell(captured), `unavailable (${captured.probeReason})`);
    } else {
      assert.deepEqual(captured, { probe: result, probeMs: 12, probeCapturedAt: '2026-11-04T10:00:00.000Z' });
      assert.equal(probeCell(captured), '5.0 / 7.0');
    }
  }
});

test('JOED-187: malformed probe results become unavailable inside capture, before tables or ratio decisions', async () => {
  const good = { layoutMedianMs: 5, jsMedianMs: 7, medianMs: 12, minMs: 10, maxMs: 14, reps: 7 };
  for (const field of Object.keys(good)) {
    for (const invalid of [undefined, null, '12', NaN, Infinity]) {
      const captured = await captureReferenceProbe({ async s() {} }, async () => ({ ...good, [field]: invalid }), async () => {});
      assert.equal(captured.probe, null, `${field}: ${invalid}`);
      assert.equal(captured.probeMs, null);
      assert.match(captured.probeReason, /finite numbers/);
      assert.match(probeCell(captured), /unavailable/);
    }
  }
});
