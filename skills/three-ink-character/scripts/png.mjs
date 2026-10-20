// png.mjs — minimal, dependency-free PNG reader/writer (Node built-ins only).
//
// Supports what character plates actually need: 8-bit, non-interlaced, colour
// types 0/2/3/4/6 (grey, RGB, palette, grey+alpha, RGBA). Writes 8-bit RGBA.
//
// Derived in part from the MIT-licensed artwork pipeline in
// https://github.com/Nyankomintsu/world-execute-me-lyric-mv (Copyright (c) 2026 Nyankomint).
// See NOTICE.md in the repository root.

import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ------------------------------------------------------------------ CRC32 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ decode */

/**
 * Decode a PNG buffer into { width, height, data } where data is RGBA bytes.
 * Throws with a readable message when the file uses an unsupported variant.
 */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file (bad signature)');

  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // length + type + data + crc

    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }

  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  if (ihdr.depth !== 8) throw new Error(`unsupported bit depth ${ihdr.depth} (only 8-bit is supported)`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  if (!channels) throw new Error(`unsupported colour type ${ihdr.color}`);

  const { width, height } = ihdr;
  const bpp = channels;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // Undo the per-scanline filters.
  const pixels = Buffer.alloc(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = row[x];
      switch (filter) {
        case 0: out[x] = v; break;
        case 1: out[x] = (v + a) & 0xff; break;
        case 2: out[x] = (v + b) & 0xff; break;
        case 3: out[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          out[x] = (v + pr) & 0xff;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
    }
  }

  // Normalise to RGBA.
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * bpp, d = i * 4;
    switch (ihdr.color) {
      case 0: data[d] = data[d + 1] = data[d + 2] = pixels[s]; data[d + 3] = 255; break;
      case 2: data[d] = pixels[s]; data[d + 1] = pixels[s + 1]; data[d + 2] = pixels[s + 2]; data[d + 3] = 255; break;
      case 3: {
        const idx = pixels[s];
        data[d] = palette ? palette[idx * 3] : 0;
        data[d + 1] = palette ? palette[idx * 3 + 1] : 0;
        data[d + 2] = palette ? palette[idx * 3 + 2] : 0;
        data[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
        break;
      }
      case 4: data[d] = data[d + 1] = data[d + 2] = pixels[s]; data[d + 3] = pixels[s + 1]; break;
      case 6: data[d] = pixels[s]; data[d + 1] = pixels[s + 1]; data[d + 2] = pixels[s + 2]; data[d + 3] = pixels[s + 3]; break;
    }
  }
  return { width, height, data };
}

/* ------------------------------------------------------------------ encode */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA bytes ({ width, height, data }) into a PNG buffer. */
export function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ helpers */

/** Build an RGBA image from a callback (x, y) -> [r, g, b, a]. */
export function makeImage(width, height, fn) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

/** Convert an RGBA image to an opaque 8-bit grey PNG (white = ink coverage). */
export function toGreyPNG(img, coverage) {
  const { width, height } = img;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = 255 - Math.round(coverage[i] * 0.92);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return encodePNG({ width, height, data });
}
