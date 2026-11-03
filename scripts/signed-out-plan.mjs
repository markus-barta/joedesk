// Checkout-only planning: no browser, fixture server or page imports.
// Manual redirects become opaqueredirect in the browser. Keep them in one
// path so the full reason sweeps also reach a non-redirect transport branch.
export const nativeAuthPaths = Object.freeze({
  '302 to SSO': 'redirect', '303 to SSO': 'redirect', opaqueredirect: 'redirect',
  '401': 'status', '403': 'status',
  'HTML content type': 'html-content-type', 'HTML body': 'html-body', 'HTML fragment': 'html-body',
});

export function parseSignedOutArgs(args) {
  if (!args.length) return 'full';
  if (args.length === 1 && ['--full', '--subset'].includes(args[0])) return args[0].slice(2);
  throw new Error('Signed-out matrix: use --full or --subset');
}

export function planSignedOutMatrix({ mode = 'full', widths, shapes, reasons, screens, endpoints }) {
  if (!['full', 'subset'].includes(mode)) throw new Error(`Unknown signed-out matrix mode: ${mode}`);
  for (const [name, list] of Object.entries({ widths, shapes, reasons, screens, endpoints })) {
    if (!Array.isArray(list) || !list.length) throw new Error(`Signed-out matrix requires nonempty ${name}`);
  }
  const fullShapes = [];
  const sampledReasons = ['refresh_failed', 'feed_not_received'];
  if (mode === 'subset') {
    for (const shape of shapes) {
      if (!Object.hasOwn(nativeAuthPaths, shape)) throw new Error(`Unclassified native auth shape: ${shape}`);
    }
    for (const path of ['redirect', 'status', 'html-content-type', 'html-body']) {
      const shape = shapes.find(shape => nativeAuthPaths[shape] === path);
      if (shape) fullShapes.push(shape);
    }
    for (const reason of sampledReasons) {
      if (!reasons.includes(reason)) throw new Error(`Signed-out subset requires sampled reason: ${reason}`);
    }
  }
  const views = widths.map((width, index) => {
    const fullShape = mode === 'full' ? null : fullShapes[index % fullShapes.length];
    const sampledReason = mode === 'full' ? reasons[index % reasons.length] : sampledReasons[index % sampledReasons.length];
    return { width, fullShape, sampledReason,
      matrix: shapes.map(shape => ({ shape,
        reasons: mode === 'full' || shape === fullShape ? [null, ...reasons] : [null, sampledReason] })),
      opaque: endpoints.flatMap(endpoint => screens.map(screen => ({ endpoint, screen }))),
      // Fresh documents with identical inputs make the cross-shape DOM
      // invariant independent of the preceding matrix's interaction history.
      invariant: mode === 'subset' ? shapes.flatMap(shape => screens.map(screen => ({ shape, screen }))) : [] };
  });
  const matrixCases = views.reduce((n, view) => n + view.matrix.reduce((m, entry) => m + entry.reasons.length * screens.length, 0), 0);
  const opaqueCases = views.reduce((n, view) => n + view.opaque.length, 0);
  const invariantCases = views.reduce((n, view) => n + view.invariant.length, 0);
  return { mode, shapes: [...shapes], screens: [...screens], views, matrixCases, opaqueCases, invariantCases,
    caseCount: matrixCases + opaqueCases + invariantCases };
}
