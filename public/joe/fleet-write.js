// The fleet policy write: a reviewed paper draft of the fleet settings, sent
// to the board server's propagate route as { baseRev, config }. Board display
// settings have their own writer. The mode stays paper: a
// candidate in any other mode, or not based on the version it names, is
// refused here before any request is made.
const ROUTE = './fleet-config/propagate';

export async function sendFleetDraft(baseRev, config) {
  if (!config || typeof config !== 'object' || config.mode !== 'paper' || typeof baseRev !== 'string' || config.rev !== baseRev) {
    throw new Error('refused: only a paper draft of the version it names can be sent');
  }
  try {
    const response = await fetch(ROUTE, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, config }),
    });
    if (response.type === 'opaqueredirect') return { status: 302, body: null };
    let body = null;
    try { body = await response.json(); } catch { /* an answer without JSON */ }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}
