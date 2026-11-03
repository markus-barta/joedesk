// Checkout-only planning: no browser, fixture server or page imports.
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
  const views = widths.map((width, index) => {
    const fullShape = mode === 'full' ? null : shapes[index % shapes.length];
    const sampledReason = reasons[index % reasons.length];
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
