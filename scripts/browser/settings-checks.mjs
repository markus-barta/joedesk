// Independent expectations for Settings, including JOED-155's board setting.
export const SETTINGS_SECTION_IDS = Object.freeze([
  'set-mode', 'set-account', 'set-runtime', 'set-desks', 'set-quota',
  'set-cadence', 'set-amy', 'set-tools', 'set-secrets', 'set-mac',
  'set-how', 'set-source', 'set-log', 'set-appearance', 'set-about',
]);

export const PHONE_SETTINGS_NOTE = 'Account start and appearance can be changed here. Change fleet settings on a larger screen.';

// Serialized into the browser. A Fleet Config outage must leave no fleet
// editing controls, even hidden ones. Account start has independent storage
// and its own reviewed form, so those controls are outside this assertion.
export function fleetSettingsControls(root) {
  return [...root.querySelectorAll('input, select, textarea, [role="switch"], [data-bump], .tog, [data-wwdel], #wwAdd')]
    .filter(control => !control.closest('#set-account'));
}
