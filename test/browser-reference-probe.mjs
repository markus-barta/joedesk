import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { runReferenceProbe } from '../scripts/browser/reference-probe.mjs';

// A DOM recorder exercises the serialized page workload itself, not a second
// implementation. No browser, JoeDesk data, wall-clock timing or layout engine.
function fixture({ layoutError = false } = {}) {
  const created = [], roots = [], connected = new Set();
  let layouts = 0, loops = 0, ticks = 0;
  const durations = [9, 2, 7, 4, 6, 1, 3];
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
    return Math.floor(tick / 2) * 100 + (tick % 2 ? durations[Math.floor(tick / 2)] : 0);
  } }, Math: { imul(a, b) { loops++; return Math.imul(a, b); } } };
  const page = { calls: 0, async evaluate(source) { this.calls++; return runInNewContext(source, context); } };
  return { page, created, roots, connected, counts: () => ({ layouts, loops }) };
}

test('JOED-186 (a): serialized reference probe repeats exactly the same isolated DOM and CPU shape without public imports', async () => {
  const source = readFileSync(new URL('../scripts/browser/reference-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s|public\/|__joedesk|Math\.random|Date\./);
  for (let run = 0; run < 2; run++) {
    const f = fixture();
    const result = await runReferenceProbe(f.page);
    assert.equal(f.page.calls, 1, 'all seven repetitions use one evaluate');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { medianMs: 4, minMs: 1, maxMs: 9, reps: 7 });
    assert.deepEqual(f.counts(), { layouts: 7, loops: 7000000 });
    assert.equal(f.connected.size, 0, 'no probe DOM survives');
    assert.equal(f.created.filter(n => n.tag === 'div').length, 7);
    assert.equal(f.created.filter(n => n.tag === 'style').length, 7);
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
