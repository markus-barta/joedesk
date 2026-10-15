// Desk changes recorded by this browser while JoeDesk is open (today's rules:
// state, action, learning and issues, compared between later snapshots).
export const OBSERVED_EVENTS_KEY = 'joe-board-observed-events-v1';
export const MAX_OBSERVED_EVENTS = 200;
export const SHOWN_EVENTS = 20;
const STATE_WORD = { working: 'Working', 'sit-out': 'Sitting out', stuck: 'Stuck' };

const fields = desk => ({
  state: desk.state, action: desk.action,
  learning: desk.learning ? [desk.learning.status, desk.learning.headline, desk.learning.detail, desk.learning.iteration].join('|') : '',
  issues: Array.isArray(desk.issues) ? desk.issues.join('|') : '',
});

export function learningLine(learning) {
  if (!learning) return null;
  const parts = [learning.headline];
  if (learning.detail && learning.detail !== learning.headline) parts.push(learning.detail);
  parts.push(`round ${learning.iteration}`);
  return parts.join(' · ');
}

export function diffDesk(previous, desk, at, source) {
  if (!previous) return [];
  const next = fields(desk), events = [];
  const base = { deskId: desk.id, snapshotAt: at, sourceLabel: source };
  if (previous.state !== next.state) events.push({ ...base, kind: 'state', summary: `Now ${STATE_WORD[desk.state].toLowerCase()}${desk.action ? `: ${desk.action}` : ''}` });
  else if (previous.action !== next.action) events.push({ ...base, kind: 'action', summary: desk.action });
  if (previous.learning !== next.learning) events.push({ ...base, kind: 'learning', summary: learningLine(desk.learning) ?? 'Learning update not supplied' });
  if (previous.issues !== next.issues && next.issues) events.push({ ...base, kind: 'issues', summary: desk.issues.join(' · ') });
  return events;
}

export function createObservedEvents(storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  let memory = null, last = null;
  function load() {
    if (memory) return memory;
    try {
      const parsed = JSON.parse(storage?.getItem(OBSERVED_EVENTS_KEY) ?? 'null');
      if (parsed?.schema === 'inspr.joe.observed-events.v1' && Array.isArray(parsed.events)) return (memory = parsed);
    } catch { /* storage unavailable or unreadable: keep this session in memory */ }
    return (memory = { schema: 'inspr.joe.observed-events.v1', events: [] });
  }
  function save() { try { storage?.setItem(OBSERVED_EVENTS_KEY, JSON.stringify(memory)); } catch { /* memory only */ } }
  return {
    observe(data) {
      const at = Date.parse(data?.generatedAt ?? '');
      if (!Number.isFinite(at)) return;
      if (!last) { last = { at, desks: Object.fromEntries(data.desks.map(d => [d.id, fields(d)])) }; return; }
      if (at <= last.at) return;
      const store = load();
      for (const desk of data.desks) {
        store.events.push(...diffDesk(last.desks[desk.id], desk, data.generatedAt, data.source?.label ?? 'snapshot'));
        last.desks[desk.id] = fields(desk);
      }
      last.at = at;
      if (store.events.length > MAX_OBSERVED_EVENTS) store.events = store.events.slice(-MAX_OBSERVED_EVENTS);
      save();
    },
    baseline: () => Boolean(last),
    recent: (limit = SHOWN_EVENTS) => load().events.slice(-limit).reverse(),
  };
}
