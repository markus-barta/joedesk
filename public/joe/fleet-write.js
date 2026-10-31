// The fleet policy write: a reviewed paper draft of the fleet settings, sent
// to the board server's propagate route as { baseRev, config }. Board display
// settings have their own writer. The mode stays paper: a
// candidate in any other mode, or not based on the version it names, is
// refused here before any request is made.
const ROUTE = './fleet-config/propagate';
import { readJSON, boardSession } from './transport.js';

export async function sendFleetDraft(baseRev, config) {
  if (!config || typeof config !== 'object' || config.mode !== 'paper' || typeof baseRev !== 'string' || config.rev !== baseRev) {
    throw new Error('refused: only a paper draft of the version it names can be sent');
  }
  if (boardSession.signedOut()) return { status: 401, body: null };
  const epoch = boardSession.epoch();
  const response = await readJSON(ROUTE, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, config }),
    });
  if (epoch !== boardSession.epoch()) return { abandoned: true };
  const accepted = boardSession.accept('/joe/fleet-config.json', response);
  return { status: response.httpStatus ?? response.status, body: accepted ? response.payload : null };
}
