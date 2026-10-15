// The board only runs on its canonical hosts; anywhere else it shows the
// privacy stub and makes no data request.
export function isCanonicalJoeHost(hostname) {
  let host = String(hostname || '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (['cs0.barta.cm', 'cs0', 'hsb1.lan', 'hsb1', 'localhost', '127.0.0.1', '::1'].includes(host)) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)) {
    const [a, b] = parts.map(Number);
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return host.endsWith('.ts.net') && host.includes('hsb1');
}
