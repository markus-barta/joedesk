// Test-only: the colours of a screenshot region, read from the PNG Chrome
// writes (8-bit RGB or RGBA, not interlaced), to prove a region paints
// nothing but its background. No dependencies.
import { inflateSync } from 'node:zlib';

export function pngColours(buffer) {
  let pos = 8, width = 0, height = 0, depth = 0, type = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos), kind = buffer.toString('ascii', pos + 4, pos + 8), data = buffer.subarray(pos + 8, pos + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9];
      if (data[12]) throw new Error('interlaced PNG');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + length;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${type})`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride), up = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      row[x] = (src[x] + predicted) & 255;
    }
  }
  const colours = new Map();
  for (let i = 0; i < pixels.length; i += bpp) {
    const key = `rgb(${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]})`;
    colours.set(key, (colours.get(key) ?? 0) + 1);
  }
  return { width, height, colours };
}
