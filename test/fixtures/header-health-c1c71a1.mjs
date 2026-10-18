// Frozen pre-JOED-44 renderer from c1c71a127116969cb33fa76f50aab3b47dbb965f:
// public/joe/desk.js headerHealth + TONE_ICON, with its transitive helpers from
// public/joe/{health,ui,format}.js. Keep these bytes independent of product
// imports so changing a helper cannot silently change the regression baseline.
const TONE_ICON = { ok: 'ok', warn: 'half', bad: 'stop', none: 'ring' };
const icon = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function brokerState(states, data) {
  const cell = states.gateway;
  const gateway = data?.safety.gateway;
  if (gateway?.apiSessionReady === false && ['gateway_down', 'upstream_lost'].includes(gateway.reason)) return { tone: 'bad', word: 'down' };
  if (gateway?.apiSessionReady === false && gateway.reason === 'gateway_degraded') return { tone: 'warn', word: 'degraded' };
  if (cell?.state === 'fresh' && gateway?.apiSessionReady === true) return { tone: 'ok', word: 'OK' };
  return { tone: 'warn', word: 'unsure' };
}

export function headerHealth(ctx, health) {
  const data = ctx.feeds.data?.value;
  const broker = data ? brokerState(ctx.states, data) : { word: 'unsure', tone: 'warn' };
  const words = { OK: 'Broker OK', degraded: 'Broker unstable', down: 'Broker down', unsure: 'Broker unsure' };
  return { html: `${icon(TONE_ICON[health.statusTone], `i tone-${health.statusTone}`)}<span class="lbl"><b>${esc(health.label)}</b><span class="lbl-long">· ${words[broker.word]}</span></span>`,
    label: `${health.label}, broker connection ${broker.word === 'OK' ? 'OK' : broker.word}. Open Desk.` };
}
