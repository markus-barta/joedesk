// The last rendered document stays inert and visibly stale until a complete
// authenticated refresh has rendered. Only transient controls close on expiry.
const sections = ['acctHero', 'deskHero', 'desk-j', 'desk-joe', 'desk-joel', 'positions', 'kept',
  'rhero', 'tiles', 'breakdown', 'cal', 'daypanel', 'histChart', 'histCompare', 'jAcct', 'setMain'];
const vienna = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function createBoardFreeze(document, session, { cancelInteractions = () => {} } = {}) {
  const app = document.getElementById('app');
  const main = document.getElementById('main');
  const banner = document.getElementById('signedOutBanner');
  let frozen = false, description = null, renderedAt = null;
  const sync = () => {
    if (!session.signedOut() || frozen) return frozen;
    frozen = true;
    cancelInteractions();
    // Close native modals first: a modal makes even an external banner inert.
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    for (const node of document.querySelectorAll('.pop.on, .ctip.on, .tip.on, .bars-tap, .tapped, .panning')) {
      node.classList.remove('on', 'pinned', 'tapped', 'panning');
      if (node.classList.contains('bars-tap')) node.hidden = true;
    }
    for (const id of ['acctPop', 'histControls']) { const node = document.getElementById(id); if (node) node.hidden = true; }
    for (const node of document.querySelectorAll('[aria-expanded="true"]')) {
      // Disclosures retain their data; only transient popover controls close.
      const target = node.getAttribute('aria-controls');
      if (['acctPop', 'histControls', 'healthPop', 'tip'].includes(target) || node.getAttribute('aria-describedby') === 'tip') {
        node.setAttribute('aria-expanded', 'false');
        if (node.getAttribute('aria-describedby') === 'tip') node.removeAttribute('aria-describedby');
      }
    }
    for (const node of app.querySelectorAll('.dot-live, .live-dot, .draw-in, .fade-in')) {
      node.setAttribute('data-frozen-motion', node.getAttribute('class'));
      node.classList.remove('dot-live', 'live-dot', 'draw-in', 'fade-in');
    }
    for (const node of document.querySelectorAll('.xh, .xd, .xc')) node.setAttribute('visibility', 'hidden');
    description = main.getAttribute('aria-describedby');
    main.setAttribute('aria-describedby', [description, 'lastKnownLabel'].filter(Boolean).join(' '));
    app.setAttribute('data-last-known', '');
    app.setAttribute('inert', '');
    for (const id of sections) document.getElementById(id)?.setAttribute('data-frozen', '');
    const time = renderedAt && Number.isFinite(Date.parse(renderedAt)) ? vienna.format(new Date(renderedAt)) : 'unknown';
    banner.querySelector('strong').textContent = `Signed out — data as of ${time} (Vienna), not updating — reload to sign in`;
    banner.hidden = false;
    return frozen;
  };
  const remember = at => { if (!frozen) renderedAt = at; };
  const rendered = at => {
    if (session.signedOut()) return;
    renderedAt = at;
    if (!frozen) return;
    // Called synchronously after rendering fresh data, before the next paint.
    frozen = false;
    banner.hidden = true;
    if (description === null) main.removeAttribute('aria-describedby');
    else main.setAttribute('aria-describedby', description);
    for (const node of app.querySelectorAll('[data-frozen-motion]')) {
      node.setAttribute('class', node.getAttribute('data-frozen-motion')); node.removeAttribute('data-frozen-motion');
    }
    app.removeAttribute('data-last-known');
    app.removeAttribute('inert');
    for (const id of sections) document.getElementById(id)?.removeAttribute('data-frozen');
  };
  const unsubscribe = session.subscribe(sync);
  sync();
  return { sync, remember, rendered, frozen: () => frozen, stop: unsubscribe };
}
