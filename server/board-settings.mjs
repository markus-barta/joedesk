import path from 'node:path';
import { readJson, atomicWrite } from './storage.mjs';
import { validateBoardSettings } from '../public/joe/board-settings-validation.js';

export { validateBoardSettings };
export const BOARD_SETTINGS_MAX_BYTES = 4096;

export function createBoardSettingsStore({ dataDir, write = atomicWrite }) {
  const file = path.join(dataDir, 'board-settings.json');
  return {
    read() {
      try {
        const value = readJson(file, BOARD_SETTINGS_MAX_BYTES);
        if (validateBoardSettings(value)) return { accountStart: null, reason: 'invalid' };
        return { ...value, reason: value.accountStart === null ? 'unset' : null };
      } catch (error) {
        return { accountStart: null, reason: error.code === 'ENOENT' ? 'missing' :
          error instanceof SyntaxError || error.message === 'storage_size_limit' ? 'invalid' : 'unreadable' };
      }
    },
    save(value) {
      const error = validateBoardSettings(value);
      if (error) throw new TypeError(error);
      write(file, value, BOARD_SETTINGS_MAX_BYTES, 0o600);
      return { ...value, reason: value.accountStart === null ? 'unset' : null };
    },
  };
}
