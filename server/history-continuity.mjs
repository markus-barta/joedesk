import { renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readJson } from './storage.mjs';
import { CONTINUITY_CAP, emptyContinuity, validContinuity } from '../public/joe/history-continuity.js';

// JOED-150's account-store helper is not on this base. Preserve damaged or
// unsupported bytes beside the store under a unique name before any recovery
// write. Optional provenance never makes opening the money/history stores fail.
export function openHistoryContinuity(file) {
  try {
    const value = readJson(file, CONTINUITY_CAP);
    if (!validContinuity(value)) throw new Error('continuity_invalid');
    return { value, writable: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { value: emptyContinuity(), writable: true };
    try {
      renameSync(file, `${file}.damaged-${randomUUID()}`);
      return { value: emptyContinuity(), writable: true };
    } catch {
      // Do not overwrite bytes we could not preserve.
      return { value: emptyContinuity(), writable: false };
    }
  }
}
