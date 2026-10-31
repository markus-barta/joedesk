const { boardSession, createBoardSession } = await import('../../public/joe/transport.js');
// A new browser document imports a new singleton. Unit previews emulate that
// module boundary without a reset/unfreeze capability in production.
export function freshPageSession() {
  const original = { ...boardSession }, session = createBoardSession();
  Object.assign(boardSession, session);
  return () => Object.assign(boardSession, original);
}
