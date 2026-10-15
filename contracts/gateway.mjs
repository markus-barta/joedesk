import { validInstant } from './schema-validator.mjs';

// Two 30-second check cadences, matching the candidate's freshness bound.
export const GATEWAY_CHECK_MAX_AGE_MS = 60000;

export function gatewayReason(gateway, at) {
  if (gateway?.apiSessionReady === false) return gateway.reason || 'gateway_unconfirmed';
  const age = Date.parse(at) - Date.parse(gateway?.checkedAt);
  return gateway?.apiSessionReady === true && validInstant(gateway.checkedAt) &&
    age >= 0 && age < GATEWAY_CHECK_MAX_AGE_MS ? null : 'gateway_unconfirmed';
}
