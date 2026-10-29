// Text widths for reserve checks without a browser: Verdana's advances (in
// 1/2048 em; the wide font that stands in for Linux's in the layout checks),
// Regular and Bold (the face a 650 weight takes), for the characters Desk's
// captions, status lines and amounts use. A character outside the table
// fails loudly, so new copy cannot slip past a reserve check.
const ASCII = [720, 806, 940, 1676, 1302, 2204, 1488, 550, 930, 930, 1302, 1676, 745, 930, 745, 930, 1302, 1302, 1302, 1302, 1302, 1302, 1302, 1302, 1302, 1302, 930, 930, 1676, 1676, 1676, 1117,
    2048, 1400, 1404, 1430, 1578, 1295, 1177, 1588, 1539, 862, 931, 1419, 1140, 1726, 1532, 1612, 1235, 1612, 1424, 1400, 1262, 1499, 1400, 2025, 1403, 1260, 1403, 930, 930, 930, 1676, 1302,
    1302, 1230, 1276, 1067, 1276, 1220, 720, 1276, 1296, 562, 705, 1212, 562, 1992, 1296, 1243, 1276, 1276, 874, 1067, 807, 1296, 1212, 1676, 1212, 1212, 1076, 1300, 930, 1300, 1676];
export const VERDANA = Object.fromEntries([
  ...ASCII.map((w, i) => [String.fromCharCode(32 + i), w]),
  ['\u00a0', 720], ['·', 745], ['’', 550], ['‘', 550], ['—', 2048], ['–', 1302], ['−', 1676], ['€', 1302], ['…', 1676], ['“', 940], ['”', 940],
]);
export const VERDANA_BOLD = { ...Object.fromEntries([...'0123456789'].map(d => [d, 1456])), '+': 1776, '−': 1776, '.': 740, ',': 740, '€': 1456 };

// A run's width in px at a font size, `factor` wider (1.06: DejaVu Sans and rounding).
export function width(text, size, { factor = 1, table = VERDANA } = {}) {
  let units = 0;
  for (const ch of text) {
    if (table[ch] === undefined) throw new Error(`no width for ${JSON.stringify(ch)}`);
    units += table[ch];
  }
  return units / 2048 * size * factor;
}
// A text measured once for wrapping: its words' widths (and each word's
// characters, for overflow-wrap: anywhere) and the space between them.
export function measure(text, size, { factor = 1 } = {}) {
  const chars = text.split(' ').map(word => [...word].map(ch => width(ch, size, { factor })));
  return { space: width(' ', size, { factor }), chars, words: chars.map(cs => cs.reduce((a, b) => a + b, 0)) };
}
// Its lines, wrapped greedily at spaces (never inside a no-break space) into
// `max` px; with `anywhere`, a word wider than a line breaks inside it. A
// wider line never takes more lines.
export function lineCount({ space, chars, words }, max, { anywhere = false } = {}) {
  let n = 1, line = 0;
  words.forEach((w, i) => {
    if (line > 0 && line + space + w <= max) { line += space + w; return; }
    if (line > 0) { n++; line = 0; }
    if (w <= max || !anywhere) { line = w; return; }
    for (const c of chars[i]) {
      if (line > 0 && line + c > max) { n++; line = 0; }
      line += c;
    }
  });
  return n;
}
