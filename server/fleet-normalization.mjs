// Compatibility for stored v1 Fleet Config only. Submitted settings still use
// the unchanged contract; no other invalid field is repaired here.
import { randomUUID } from 'node:crypto';
import { validateContract } from '../contracts/index.mjs';
import { checkSchema } from '../contracts/schema-validator.mjs';
import { nextFleetRevision, withNextFleetRevision } from '../fleet-config.mjs';
import actionSchema from '../public/joe/fleet-config-actions.schema.json' with { type: 'json' };

export const FLEET_ACTION_LOG_MAX = actionSchema.properties.entries.maxItems;

// The bounded validator expresses nullable revisions with anyOf.
const auditSchema = structuredClone(actionSchema);
for (const key of ['revBefore', 'revAfter']) {
  const field = auditSchema.$defs.action.properties[key];
  field.anyOf = field.type.map(type => ({ type }));
  delete field.type;
}

export function fleetInvalid(errors) {
  return Object.assign(new Error('migration_fleet_invalid'), {
    detail: errors.map(({ path, rule }) => ({ path, rule })),
  });
}

export function inspectFleetConfig(config) {
  const keep = config?.desks?.keep;
  const added = Array.isArray(keep) && keep.every(symbol =>
    typeof symbol === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(symbol))
    ? ['SXR8', 'TSLA'].filter(symbol => !keep.includes(symbol)) : [];
  const value = added.length ? { ...config, desks: { ...config.desks, keep: [...keep, ...added] } } : config;
  const checked = validateContract('fleet-config', value);
  const errors = checked.errors.map(({ path, rule }) => ({ path, rule }));
  if (!errors.length && added.length) {
    try { nextFleetRevision(config.rev); }
    catch { errors.push({ path: '$.rev', rule: 'revisionExhausted' }); }
  }
  return { ok: !errors.length, value, added, errors };
}

export function normalizeFleetConfig(config, receivedAt) {
  const result = inspectFleetConfig(config);
  if (!result.ok) throw fleetInvalid(result.errors);
  if (!result.added.length) return { ...result, value: config };
  const value = withNextFleetRevision(result.value, config.rev, new Date(receivedAt));
  const checked = validateContract('fleet-config', value);
  if (!checked.ok) throw fleetInvalid(checked.errors);
  return { ...result, value };
}

export function validateFleetActions(log) {
  const errors = [];
  checkSchema(auditSchema, log, {}, errors);
  if (errors.length) throw new Error('migration_fleet_actions_invalid');
}

export function appendFleetNormalizationAudit(log, before, after, receivedAt, { pending = false } = {}) {
  validateFleetActions(log);
  const next = { ...log, entries: [...log.entries, {
    id: `fa-${Date.parse(receivedAt)}-${randomUUID().slice(0, 8)}`,
    at: receivedAt,
    actor: 'migration',
    revBefore: before.rev,
    revAfter: after.rev,
    changedKeys: ['desks.keep'],
    outcome: pending ? 'pending' : 'success',
    reason: pending ? 'write_started' : 'propagated',
  }].slice(-FLEET_ACTION_LOG_MAX) };
  // Match the board's bounded ring, dropping only the oldest entries needed.
  // Offline migration's verified v1 backup preserves the original log bytes.
  validateFleetActions(next);
  return next;
}
