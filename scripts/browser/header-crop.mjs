// Capture production header markup without stopping the live board. Disabling
// scripts can consume a pending rAF without invoking it (JOED-47).
function mountHeaderCrop(view) {
  const live = document.querySelector('header.top');
  const copy = live.cloneNode(true), box = live.getBoundingClientRect();
  const button = copy.querySelector('#hdrHealth');
  button.innerHTML = view.html;
  if (view.statusTone) button.dataset.tone = view.statusTone;
  button.setAttribute('aria-label', view.label);
  if (view.title) button.setAttribute('title', view.title);
  else button.removeAttribute('title');
  // Keep production classes/styles and SVG references; IDs must still resolve
  // to live nodes when a render runs during capture. Header CSS uses classes.
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
  copy.setAttribute('data-joedesk-header-crop', '');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  // Out of flow, below the content: no overlay, duplicate glass background or
  // change to the live header's geometry. The crop already captures offscreen.
  Object.assign(copy.style, { position: 'absolute', left: `${box.left + scrollX}px`,
    top: `${Math.ceil(document.documentElement.scrollHeight) + 16}px`, width: `${box.width}px`, pointerEvents: 'none' });
  live.parentElement.append(copy);
}

export async function captureHeaderCrop(page, view, capture) {
  const selector = '[data-joedesk-header-crop]';
  try {
    await page.evaluate(`(${mountHeaderCrop.toString()})(${JSON.stringify(view)})`);
    await capture(selector);
  } finally {
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.remove()`);
  }
}
