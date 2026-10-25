// Serialized into the page. Two matching frame reads after fonts are ready
// include the scrollbar width as well as the boxes under assertion.
export async function afterStableLayout(selectors, read = layout => layout) {
  await document.fonts.ready;
  const until = Date.now() + 2000;
  let previous = null;
  for (;;) {
    await new Promise(requestAnimationFrame);
    const current = { boxes: __audit.rects(selectors), clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth };
    if (previous && JSON.stringify(current) === JSON.stringify(previous)) return read(current);
    if (Date.now() >= until) throw new Error(`layout did not settle: ${JSON.stringify({ previous, current })}`);
    previous = current;
  }
}
