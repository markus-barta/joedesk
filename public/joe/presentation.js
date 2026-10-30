import { age as formatAge } from './format.js';

// One presentation policy for a board, a panel, or a derived warning. Never
// rewrite accepted values/reasons: Details can still explain the last read.
export function signedOut(board) {
  if (!board) return false;
  if (Array.isArray(board)) return board.some(signedOut);
  if (typeof board.signedOut === 'function') return board.signedOut();
  return board.signedOut === true || board.session === 'signed-out'
    || signedOut(board.states) || signedOut(board.cell);
}

export function present(text, board, kind = 'reason') {
  if (!signedOut(board)) return text;
  if (kind === 'status') return 'Signed out — reload to sign in';
  if (kind === 'label') return 'Signed out';
  if (kind === 'diagnostics') return 'The sign-in has expired; reload to sign in. Values shown are last known. Broker connection and panel ages are unknown while signed out.';
  if (['history', 'account history', 'results'].includes(kind)) return `${board?.value == null ? `${kind[0].toUpperCase() + kind.slice(1)} unavailable` : `Last known ${kind}`} · ages unknown while signed out`;
  if (kind === 'retained') return board?.value == null ? 'Unavailable' : 'Last known';
  if (kind === 'warning') return `${board?.value == null ? 'Unavailable' : 'Last known value'} · unknown while signed out`;
  return 'unknown while signed out';
}
export const presentReason = (text, board) => present(text, board, 'reason');
export const presentAge = (value, board) => present(typeof value === 'number' || value == null ? formatAge(value) : value, board, 'age');
export const presentWarning = (text, board) => present(text, board, 'warning');
