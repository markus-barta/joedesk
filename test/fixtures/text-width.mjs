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
const ASCII_BOLD = [700, 824, 1203, 1776, 1456, 2605, 1766, 680, 1113, 1113, 1456, 1776, 740, 983, 740, 1412, 1456, 1456, 1456, 1456, 1456, 1456, 1456, 1456, 1456, 1456, 824, 824, 1776, 1776, 1776, 1263,
    1974, 1590, 1560, 1482, 1700, 1399, 1332, 1661, 1715, 1118, 1137, 1579, 1305, 1941, 1734, 1741, 1501, 1741, 1602, 1455, 1396, 1663, 1564, 2311, 1564, 1509, 1417, 1113, 1412, 1113, 1776, 1456,
    1456, 1368, 1432, 1205, 1432, 1360, 865, 1432, 1459, 700, 825, 1374, 700, 2167, 1459, 1406, 1432, 1432, 1018, 1215, 933, 1459, 1331, 2006, 1370, 1333, 1222, 1456, 1113, 1456, 1776];
export const VERDANA_BOLD = Object.fromEntries([
  ...ASCII_BOLD.map((w, i) => [String.fromCharCode(32 + i), w]),
  ['\u00a0', 700], ['·', 740], ['’', 680], ['−', 1776], ['€', 1456], ['—', 2048], ['–', 1456],
]);

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
