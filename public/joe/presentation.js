// One board-level boundary. Auth failures never ask a renderer to reinterpret
// the last good document; all its text, figures and accessible names stay put.
export function createBoardFreeze(document, session) {
  const app = document.getElementById('app');
  const main = document.getElementById('main');
  const banner = document.getElementById('signedOutBanner');
  let frozen = false, description = null;
  const sync = () => {
    const next = session.signedOut();
    if (next === frozen) return frozen;
    frozen = next;
    banner.hidden = !frozen;
    if (frozen) {
      description = main.getAttribute('aria-describedby');
      main.setAttribute('aria-describedby', [description, 'lastKnownLabel'].filter(Boolean).join(' '));
      app.setAttribute('data-last-known', '');
    } else {
      if (description === null) main.removeAttribute('aria-describedby');
      else main.setAttribute('aria-describedby', description);
      app.removeAttribute('data-last-known');
    }
    return frozen;
  };
  const unsubscribe = session.subscribe(sync);
  sync();
  return { sync, frozen: () => frozen, stop: unsubscribe };
}
