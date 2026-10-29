// Read-only page accessor. The writable client stays behind the Settings boundary.
export { validateBoardSettings } from './board-settings-validation.js';
export { accountStart, boardSettingsState, refreshBoardSettings, onBoardSettingsChange } from './board-settings-write.js';
