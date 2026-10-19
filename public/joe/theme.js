// Theme: light, dark or system, saved in this browser only. With nothing
// stored the page follows the system; the header button remembers its choice.
export const THEME_KEY = 'joe-board-theme-v1';
const root = document.documentElement;

export function storedTheme() {
  try { const m = localStorage.getItem(THEME_KEY); return m === 'light' || m === 'dark' || m === 'system' ? m : 'system'; } catch { return 'system'; }
}
export const resolvedTheme = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function setTheme(mode) {
  if (mode === 'system') delete root.dataset.theme; else root.dataset.theme = mode;
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* this session only */ }
  syncThemeButton();
}
export function syncThemeButton() {
  document.getElementById('themeBtn')?.setAttribute('aria-label', `Switch to ${resolvedTheme() === 'dark' ? 'light' : 'dark'} theme`);
}
export const toggleTheme = () => setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
