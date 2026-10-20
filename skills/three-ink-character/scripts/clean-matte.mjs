// clean-matte.mjs — turn a flat-colour character image into a source the
// three-ink pipeline can actually separate.
//
// The problem: image generators rarely produce a real transparent background.
// They either bake a solid colour or, worse, draw a checkerboard to look
// transparent — and a checkerboard is two achromatic greys, which the separator
// would read as a fourth colour and smear across the figure.
//
// The fix: recover the background model, then solve
//     P = a * C + (1 - a) * B
// for the ink C and the coverage a of every pixel, and emit a HARD matte
// (alpha 0 or 255) with flat ink colours.
//
//   node clean-matte.mjs <src.png> --out <clean.png> [--inks cream:#f4e0c6,...] [--light-ink cream]
//
// Background models handled:
//   solid      one bright achromatic colour around the border (white, off-white)
//   lattice    a regular two-tone checkerboard (period measured from the image)
//
// If the border is neither, the script stops and says so: the source has to be
// regenerated, because un-matting against a background that is not there would
// eat the figure.
//
// Derived from the MIT-licensed artwork pipeline in
// https://github.com/Nyankomintsu/world-execute-me-lyric-mv (Copyright (c) 2026 Nyankomint).
// See NOTICE.md in the repository root.

import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './png.mjs';
import { PAPER_INKS, hexToRgb, paperInkRGB } from './palette.mjs';

const INK_KEY = { cream: 0, orange: 1, black: 2 };

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const hex = (s) => hexToRgb(s);

const args = process.argv.slice(2);
const src = args[0];
const out = args[args.indexOf('--out') + 1];
if (!src || !out) {
  console.error(`usage: node clean-matte.mjs <src.png> --out <clean.png> [--inks 'cream:${PAPER_INKS.cream},orange:${PAPER_INKS.orange},black:${PAPER_INKS.black}'] [--light-ink cream]`);
  process.exit(2);
}
const inkSpec = args.includes('--inks') ? args[args.indexOf('--inks') + 1] : null;
const lightInkName = args.includes('--light-ink') ? args[args.indexOf('--light-ink') + 1] : null;

const INKC = paperInkRGB(inkSpec);

const img = decodePNG(fs.readFileSync(src));
const { width: W, height: H, data: d } = img;
const px = (x, y, o) => d[(y * W + x) * 4 + o];
const rgbAt = (x, y) => [px(x, y, 0), px(x, y, 1), px(x, y, 2)];

/* ------------------------------------------------------------------ helpers */

const isAchromatic = (x, y, tol = 14) => {
  const [r, g, b] = rgbAt(x, y);
  return Math.max(r, g, b) - Math.min(r, g, b) <= tol;
};
const bright = (x, y) => Math.min(...rgbAt(x, y)) >= 200;
const lumAt = (x, y) => { const [r, g, b] = rgbAt(x, y); return (r + g + b) / 3; };

/** The ring of pixels along the border — always background, never the figure. */
const ring = [];
{
  const R = Math.max(2, Math.round(Math.min(W, H) * 0.03));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= R && x < W - R && y >= R && y < H - R) continue;
      ring.push([x, y]);
    }
  }
}

/* ------------------------------------------------- background model detection */

// The border holds two achromatic levels (white and grey of a checkerboard, or
// one flat colour). Find them as the two strongest separated peaks of the
// histogram, not by thresholding: a figure that reaches the image edge (a
// white dress, say) adds its own bright cluster, and a threshold would then
// split the background instead of separating it from the figure.
const peaks = (values) => {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const sm = hist.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < 256) { s += hist[j]; n++; } }
    return s / n;
  });
  let p1 = 0;
  for (let i = 1; i < 256; i++) if (sm[i] > sm[p1]) p1 = i;
  let p2 = -1, best = 0;
  for (let i = 0; i < 256; i++) {
    if (Math.abs(i - p1) < 15) continue;
    if (sm[i] > best) { best = sm[i]; p2 = i; }
  }
  if (p2 < 0) return null;
  const mean = (p) => {
    const sel = values.filter((v) => Math.abs(v - p) <= 6);
    return sel.length ? { mean: sel.reduce((s, v) => s + v, 0) / sel.length, n: sel.length } : null;
  };
  const a = mean(p1), b = mean(p2);
  if (!a || !b || a.n < 500 || b.n < 500) return null;
  return [a.mean, b.mean].sort((x, y) => x - y);
};

const ringLum = [];
for (const [x, y] of ring) if (isAchromatic(x, y)) ringLum.push(lumAt(x, y));
if (ringLum.length < 100) {
  throw new Error('the border has no flat colour — the background is not a plain surface; regenerate the source');
}
const lv = peaks(ringLum);
if (!lv) {
  throw new Error('the border does not hold two flat levels — regenerate the source');
}
const [gLo, gHi] = lv;
const twoTone = gHi - gLo > 12;

let model;
if (twoTone) {
  // ---- two-tone lattice -------------------------------------------------
  const mid = (gLo + gHi) / 2;
  const isDark = (x, y) => isAchromatic(x, y) && lumAt(x, y) < mid;
  // period: most common run length of the darker value on a background row
  const P = (() => {
    const counts = new Map();
    for (let r = 0; r < Math.max(1, Math.round(H * 0.04)); r++) {
      const runs = [];
      let cur = isDark(0, r), n = 0;
      for (let x = 0; x < W; x++) {
        const val = isDark(x, r);
        if (val === cur) n++; else { runs.push(n); cur = val; n = 1; }
      }
      runs.push(n);
      for (const len of runs) if (len >= 4) counts.set(len, (counts.get(len) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  })();
  if (P < 4) throw new Error('could not measure the checkerboard period — regenerate the source');
  // origin: first dark pixel on a background row, then the first dark pixel in that column
  const row = Math.max(1, Math.round(H * 0.02));
  let x0 = -1, y0 = -1;
  for (let x = 0; x < W && x0 < 0; x++) if (isDark(x, row)) x0 = x;
  if (x0 < 0) throw new Error('could not find the checkerboard origin — regenerate the source');
  for (let y = 0; y < H && y0 < 0; y++) if (isDark(x0, y)) y0 = y;
  if (y0 < 0) throw new Error('could not find the checkerboard origin — regenerate the source');
  // verify per phase: the two greys must land on those levels
  const phase = [[], [], [], []];
  for (const [x, y] of ring) {
    if (!isAchromatic(x, y)) continue;
    const cx = Math.floor((x - x0) / P), cy = Math.floor((y - y0) / P);
    const par = (((cx + cy) % 2) + 2) % 2;
    phase[par * 2 + (((cy % 2) + 2) % 2)].push(lumAt(x, y));
  }
  const med = (a) => { const s = [...a].sort((u, w) => u - w); return s.length ? s[s.length >> 1] : NaN; };
  const m = phase.map(med);
  // phases 0,1 are the grey squares; phases 2,3 are the white ones
  const greyPh = [m[0], m[1]], whitePh = [m[2], m[3]];
  const ok = greyPh.every((q) => !Number.isNaN(q) && Math.abs(q - gLo) < 10)
    && whitePh.every((q) => !Number.isNaN(q) && Math.abs(q - gHi) < 10);
  if (!ok) {
    throw new Error(`the border is not a clean two-tone lattice (phase medians ${m.map((q) => q.toFixed(1)).join('/')}, expected ${gLo.toFixed(1)}/${gHi.toFixed(1)}) — regenerate the source`);
  }
  model = {
    kind: 'lattice',
    at: (x, y) => {
      const cx = Math.floor((x - x0) / P), cy = Math.floor((y - y0) / P);
      return (((cx + cy) % 2) + 2) % 2 === 0 ? gLo : gHi;
    },
    detail: `checkerboard, ${P}px squares, greys ${Math.round(gLo)} / ${Math.round(gHi)}`,
  };
} else {
  // ---- single flat colour ----------------------------------------------
  const B = Math.round(Number.isFinite(gHi) && gHi > gLo ? gHi : gLo);
  model = { kind: 'solid', at: () => B, detail: `flat ${B}` };
}
console.log(`background model: ${model.kind} — ${model.detail}`);

/* ------------------------------------------------------------- the un-mix */

// background mask first, so highlights enclosed by the figure can be kept
const bgLo = Math.min(gLo, gHi), bgHi = Math.max(gLo, gHi);
const bgFlag = new Uint8Array(W * H);
{
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (bgFlag[i]) return;
    const [r, g, b] = rgbAt(x, y);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // Background = achromatic AND inside the range of the two background levels.
    // The test must NOT compare against a single model value: the soft border
    // between two squares of a checkerboard sits between the two levels, and a
    // strict test would stop the fill there. The range also makes the tool work
    // on a DARK faked background, not just a light one.
    if (mx - mn > 16) return;
    const lum = (r + g + b) / 3;
    if (lum < bgLo - 16 || lum > bgHi + 16) return;
    bgFlag[i] = 1; stack.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

const outBuf = Buffer.alloc(W * H * 4);
const counts = [0, 0, 0];
let bg = 0, highlights = 0, hard = 0;

// 0 = background, 1..3 = the ink index + 1
const inkOf = new Uint8Array(W * H);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const o = i * 4;
    const [r, g, b] = rgbAt(x, y);

    if (bgFlag[i]) { outBuf[o + 3] = 0; bg++; continue; }

    // an achromatic bright pixel enclosed by the figure is a highlight: the light ink
    if (lightInkName && isAchromatic(x, y) && bright(x, y)) {
      const k = INK_KEY[lightInkName];
      const C = INKC[k];
      outBuf[o] = C[0]; outBuf[o + 1] = C[1]; outBuf[o + 2] = C[2]; outBuf[o + 3] = 255;
      inkOf[i] = k + 1;
      counts[k]++; highlights++; continue;
    }

    const B = model.at(x, y);
    let best = -1, bestA = 0, bestRes = Infinity;
    for (let k = 0; k < 3; k++) {
      const C = INKC[k];
      const dv = [C[0] - B, C[1] - B, C[2] - B];
      const pv = [r - B, g - B, b - B];
      const len2 = dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2;
      let a = (pv[0] * dv[0] + pv[1] * dv[1] + pv[2] * dv[2]) / len2;
      a = clamp(a);
      const res = (pv[0] - a * dv[0]) ** 2 + (pv[1] - a * dv[1]) ** 2 + (pv[2] - a * dv[2]) ** 2;
      if (res < bestRes) { bestRes = res; bestA = a; best = k; }
    }

    if (bestA < 0.5) { outBuf[o + 3] = 0; bg++; continue; }
    const C = INKC[best];
    outBuf[o] = C[0]; outBuf[o + 1] = C[1]; outBuf[o + 2] = C[2]; outBuf[o + 3] = 255;
    inkOf[i] = best + 1;
    counts[best]++;
    if (bestA < 0.995) hard++;
  }
}

// ---- despeckle -------------------------------------------------------------
// A JPEG source (or a noisy generator) leaves isolated pixels of the wrong ink
// inside flat areas. Only ISOLATED pixels are corrected: a pixel whose four
// orthogonal neighbours all disagree with it takes the ink its neighbourhood
// mostly has. Edges are left alone, so the silhouette does not erode.
{
  const fixed = new Uint8Array(inkOf);
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const k = inkOf[i];
      if (!k) continue;
      const up = inkOf[i - W], dn = inkOf[i + W], lf = inkOf[i - 1], rt = inkOf[i + 1];
      if (up === k || dn === k || lf === k || rt === k) continue;   // not isolated
      const tally = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = inkOf[(y + dy) * W + (x + dx)];
          if (v && v !== k) tally.set(v, (tally.get(v) || 0) + 1);
        }
      }
      let win = 0, winN = 0;
      for (const [v, c] of tally) if (c > winN) { winN = c; win = v; }
      if (win && winN >= 4) { fixed[i] = win; n++; }
    }
  }
  if (n) {
    for (let i = 0; i < W * H; i++) {
      const k = fixed[i];
      if (!k) continue;
      const C = INKC[k - 1];
      const o = i * 4;
      outBuf[o] = C[0]; outBuf[o + 1] = C[1]; outBuf[o + 2] = C[2]; outBuf[o + 3] = 255;
    }
    // recount
    counts[0] = counts[1] = counts[2] = 0;
    for (let i = 0; i < W * H; i++) { const k = fixed[i]; if (k) counts[k - 1]++; }
  }
  console.log(`  despeckled ${n} isolated pixels`);
}

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, encodePNG({ width: W, height: H, data: outBuf }));

const n = W * H, fig = n - bg;
console.log(`wrote ${out}`);
console.log(`  background  ${(100 * bg / n).toFixed(1)}%  (alpha 0)`);
console.log(`  figure      ${(100 * fig / n).toFixed(1)}%  (alpha 255 — hard matte)`);
if (highlights) console.log(`  highlights  ${highlights} enclosed light pixels kept as the light ink`);
console.log(`  edge pixels that were partially covered and snapped to a hard edge: ${(100 * hard / n).toFixed(2)}%`);
for (let k = 0; k < 3; k++) {
  const nm = ['cream', 'orange', 'black'][k];
  console.log(`  ${nm.padEnd(7)} ${(100 * counts[k] / fig).toFixed(2)}%  of the figure  (${counts[k]} px)`);
}
