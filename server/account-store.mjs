import fs from 'node:fs';
import path from 'node:path';
import { validInstant } from '../contracts/schema-validator.mjs';
import { atomicWrite, readJson } from './storage.mjs';

// A separate journal closes the rename/new-file crash window. It contains only
// a loss marker, never account values, and remains after successful recovery.
export function openAccountStore({ file, format, cap, empty, validate, clock, write = atomicWrite }) {
  const markerFile = `${file}.discontinuity.json`;
  const validMarker = marker => marker && Object.keys(marker).length === 3 && validInstant(marker.at) &&
    marker.reason === 'contract_invalid' && typeof marker.preservedAs === 'string' &&
    marker.preservedAs.startsWith(`${path.basename(file)}.damaged-`) &&
    path.basename(marker.preservedAs) === marker.preservedAs;
  let value = empty(), reason = null, discontinuity = null, damaged = false, readOnly = false;
  try {
    discontinuity = readJson(markerFile, 4096);
    if (!validMarker(discontinuity)) throw new Error('contract_invalid');
  } catch (error) {
    discontinuity = null;
    if (error.code !== 'ENOENT') { reason = 'contract_invalid'; readOnly = true; }
  }
  try {
    let stored;
    try { stored = readJson(file, cap); }
    catch (error) {
      if (error.message !== 'storage_size_limit') throw error;
      // Future envelopes may outgrow today's cap. Inspect only the bounded
      // format header (the first field of our envelopes), never their payload.
      const fd = fs.openSync(file, 'r'), header = Buffer.alloc(4096);
      try {
        const bytes = fs.readSync(fd, header, 0, header.length, 0);
        const match = /^\s*\{\s*"format"\s*:\s*("[^"\\]*")/.exec(header.toString('utf8', 0, bytes));
        stored = { format: match ? JSON.parse(match[1]) : null };
      } finally { fs.closeSync(fd); }
    }
    // Recognized future formats are never quarantined or replaced by v1.
    const prefix = format.slice(0, format.lastIndexOf('v') + 1);
    if (typeof stored?.format === 'string' && stored.format.startsWith(prefix) &&
        /^[2-9][0-9]*$|^1[0-9]+$/.test(stored.format.slice(prefix.length))) {
      reason = 'store_version_unsupported'; readOnly = true;
    } else {
      if (stored?.format !== format || (stored.discontinuity !== undefined && !validMarker(stored.discontinuity))) throw new Error('contract_invalid');
      value = validate(stored.value);
      discontinuity ??= stored.discontinuity ?? null;
    }
  } catch (error) {
    reason ??= error.code === 'ENOENT' ? 'feed_not_received' : 'contract_invalid';
    damaged = error.code !== 'ENOENT';
  }
  const view = () => {
    const currentReason = reason === 'feed_not_received' && discontinuity ? discontinuity.reason : reason;
    return { ...value, reason: currentReason ?? discontinuity?.reason ?? null,
      ...(discontinuity ? { discontinuity } : {}) };
  };
  function append(update) {
    if (readOnly) return;
    try {
      const next = update(value);
      if (next === value) return;
      validate(next);
      if (damaged) {
        // Persist the marker before moving the only damaged copy. Retry uses
        // the same destination after a failed write, including after restart.
        if (!discontinuity || fs.existsSync(path.join(path.dirname(file), discontinuity.preservedAs))) {
          const at = clock();
          let preservedAs = `${path.basename(file)}.damaged-${at}`, suffix = 0;
          while (fs.existsSync(path.join(path.dirname(file), preservedAs))) preservedAs = `${path.basename(file)}.damaged-${at}-${++suffix}`;
          discontinuity = { at, reason: 'contract_invalid', preservedAs };
        }
        write(markerFile, discontinuity, 4096);
        fs.renameSync(file, path.join(path.dirname(file), discontinuity.preservedAs));
        damaged = false;
        const fd = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      const envelope = { format, value: next, ...(discontinuity ? { discontinuity } : {}) };
      try { write(file, envelope, cap); }
      catch (error) { if (error.committed) value = next; throw error; }
      value = next; reason = null;
    } catch { reason = 'history_write_failed'; }
  }
  return { view, append };
}
