// Explicit schemes: never infer one from punctuation or SemVer shape.
export const CALENDAR_SCHEMES = ['inspr-calendar-v2', 'inspr-calver-3'];
export function parseVersion({ version_scheme: scheme, version }) {
  if (typeof version !== 'string') throw new Error('version_required');
  let digits;
  if (CALENDAR_SCHEMES.includes(scheme)) {
    if (!/^[1-9]\d{11}\.0\.0$/.test(version)) throw new Error('calendar_shape');
    digits = version.slice(0, 12);
  } else if (scheme === 'calendar') {
    // JoeDesk's published custom calendar is legacy, not INSPR-CalVer1.
    if (!/^\d{2}\.\d{2}\.\d{2}(?:\.\d{2}\.\d{2})?$/.test(version)) throw new Error('legacy_shape');
    digits = version.replaceAll('.', '').padEnd(12, '0');
  } else if (scheme === 'legacy') {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('legacy_shape');
    return { scheme, version, utc: null };
  } else if (scheme === 'inspr-calendar-v1') {
    if (!/^\d{2}\.\d{2}\.\d{2}(?:\.\d{2}\.\d{2}\.\d{2})?$/.test(version)) throw new Error('v1_shape');
    digits = version.replaceAll('.', '').padEnd(12, '0');
  } else throw new Error('scheme_required');
  const utc = `20${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}T${digits.slice(6, 8)}:${digits.slice(8, 10)}:${digits.slice(10, 12)}.000Z`;
  if (!Number.isFinite(Date.parse(utc)) || new Date(utc).toISOString() !== utc) throw new Error('calendar_date');
  return { scheme, version, utc };
}

export function reserveVersion(previous, utc) {
  parseVersion(previous);
  if (!Number.isSafeInteger(previous.release_sequence) || previous.release_sequence < 1 || !previous.release_channel) throw new Error('sequence_required');
  if (!/^20[1-9]\d-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(utc)) throw new Error('reservation_utc_second');
  const version = utc.replace(/\D/g, '').slice(2) + '.0.0';
  const next = { version_scheme: 'inspr-calver-3', version, release_channel: previous.release_channel, release_sequence: previous.release_sequence + 1 };
  parseVersion(next);
  if (CALENDAR_SCHEMES.includes(previous.version_scheme) && version <= previous.version) throw new Error('reservation_not_later');
  return next;
}

export function compareReleases(a, b, anchor) {
  const x = parseVersion(a), y = parseVersion(b);
  if (a.release_channel !== b.release_channel || !a.release_channel) throw new Error('channel_mismatch');
  if (CALENDAR_SCHEMES.includes(x.scheme) && CALENDAR_SCHEMES.includes(y.scheme)) return x.version < y.version ? -1 : x.version > y.version ? 1 : 0;
  if (x.scheme === y.scheme) {
    if (x.utc) return x.utc < y.utc ? -1 : x.utc > y.utc ? 1 : 0;
    for (let i = 0; i < 3; i++) { const d = BigInt(x.version.split('.')[i]) - BigInt(y.version.split('.')[i]); if (d) return d > 0n ? 1 : -1; }
    return 0;
  }
  if (!anchor || !Number.isSafeInteger(anchor.first_calendar_sequence) ||
      !Number.isSafeInteger(anchor.last_legacy_sequence) || anchor.last_legacy_sequence < 1 ||
      anchor.first_calendar_sequence !== anchor.last_legacy_sequence + 1 ||
      anchor.legacy_scheme !== (CALENDAR_SCHEMES.includes(x.scheme) ? y.scheme : x.scheme)) throw new Error('migration_anchor_required');
  parseVersion({ version_scheme: anchor.legacy_scheme, version: anchor.last_legacy_version });
  parseVersion({ version_scheme: 'inspr-calver-3', version: anchor.first_calendar_version });
  for (const r of [a, b]) {
    if (!Number.isSafeInteger(r.release_sequence) || r.release_sequence < 1) throw new Error('sequence_required');
    if (CALENDAR_SCHEMES.includes(r.version_scheme)) {
      if (r.release_sequence < anchor.first_calendar_sequence || r.version < anchor.first_calendar_version ||
          (r.release_sequence === anchor.first_calendar_sequence && r.version !== anchor.first_calendar_version)) throw new Error('anchor_mismatch');
    } else if (r.release_sequence > anchor.last_legacy_sequence ||
        (r.release_sequence === anchor.last_legacy_sequence && r.version !== anchor.last_legacy_version)) throw new Error('anchor_mismatch');
  }
  return Math.sign(a.release_sequence - b.release_sequence);
}
