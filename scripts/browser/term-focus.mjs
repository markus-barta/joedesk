// Serialized into the page. Focus each visible identity, including repeated
// terms, and read only once its own accessible tip is open and expanded.
export async function focusTermTips(scope, heads) {
  const out = [];
  const visible = () => [...document.querySelectorAll(`${scope} [data-term]`)].filter(__audit.visible);
  const counts = new Map();
  const terms = visible().map(t => {
    const term = t.dataset.term, index = counts.get(term) ?? 0;
    counts.set(term, index + 1);
    return { term, index };
  });
  for (const { term, index } of terms) {
    const until = Date.now() + 2000;
    let seen, t;
    do {
      // A tick can replace a section between frames; never focus a stale node.
      t = visible().filter(e => e.dataset.term === term)[index];
      if (t && document.activeElement !== t) t.focus({ preventScroll: true });
      const tip = document.getElementById('tip');
      const describedBy = t?.getAttribute('aria-describedby') ?? '';
      const conditions = { pageFocused: document.hasFocus(), connected: Boolean(t?.isConnected), focused: Boolean(t && document.activeElement === t),
        tipOpen: Boolean(tip?.classList.contains('on')), ownHead: tip?.querySelector('b')?.textContent === heads[term],
        ownTip: Boolean(tip && describedBy.split(/\s+/).includes(tip.id)), expanded: t?.getAttribute('aria-expanded') === 'true' };
      seen = { term, index, head: tip?.querySelector('b')?.textContent ?? null, expectedHead: heads[term],
        describedBy, expanded: t?.getAttribute('aria-expanded') ?? null, conditions, failed: Object.keys(conditions).filter(k => !conditions[k]) };
      if (!seen.failed.length || Date.now() >= until) break;
      // Observe the focus handler and any rebuild on the next painted frame;
      // elapsed time never makes an unsettled tip pass.
      await new Promise(requestAnimationFrame);
    } while (true);
    out.push(seen);
    t?.blur();
  }
  return out;
}
