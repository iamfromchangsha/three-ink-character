// three-ink.mjs — turn a flat-colour character image into three ink plates.
//
// Pipeline (one pass, at load time in any renderer):
//   1. matte cleanup        alpha < 16 is dust, alpha >= 250 becomes solid
//   2. ink estimation       this image's own three ink colours, from solid pixels
//   3. separation           each pixel is projected onto the three mixing lines
//                           in RGB space and split between the two inks it lies between
//   4. edge inheritance     soft outer pixels inherit their most opaque neighbour
//   5. cumulative masks     mask0 = whole figure, mask1 = ink A + ink C, mask2 = ink C
//   6. label map            half resolution: which single ink sits at each point
//
// The cumulative order is the point: a plate shifted out of register reveals the ink
// underneath instead of cutting a hole in the silhouette.
//
// Derived from the MIT-licensed artwork pipeline in
// https://github.com/Nyankomintsu/world-execute-me-lyric-mv (Copyright (c) 2026 Nyankomint).
// See NOTICE.md in the repository root.
//
// Node.js >= 18, no dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePNG, encodePNG, makeImage, toGreyPNG } from './png.mjs';
import { PAPER_INKS, DEFAULT_PALETTE, PALETTES, hexToRgb, paletteByName, rolesFrom } from './palette.mjs';

export const INK_NAMES = ['cream', 'orange', 'black'];

/** Seed inks — the colours the source art is painted with. Refined per image at run time. */
const INK_RGB = [PAPER_INKS.cream, PAPER_INKS.orange, PAPER_INKS.black].map(hexToRgb);
const INK_KEY = { cream: 0, orange: 1, black: 2 };

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/* ============================================================== separation */

export function separate(img, opts = {}) {
  const {
    alphaDust = 16,      // below this, a pixel is dust
    alphaSolid = 250,    // at or above this, a pixel is solid
    rampLo = 0.15,       // fraction along the mixing line that already counts as ink A
    rampHi = 0.70,       // fraction along the mixing line that already counts as ink B
    offLineTol = 18,     // perpendicular RGB distance that still counts as on the line
  } = opts;

  const { width: W, height: H, data: px } = img;
  const N = W * H;

  // 1. matte
  const A = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = px[i * 4 + 3];
    A[i] = a < alphaDust ? 0 : a >= alphaSolid ? 255 : a;
  }

  // 2. this image's own three inks
  const ink = INK_RGB.map((c) => [...c]);
  const sum = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < N; i += 3) {
    if (A[i] !== 255) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    let best = -1, bd = 40 * 40;
    for (let k = 0; k < 3; k++) {
      const d = (r - ink[k][0]) ** 2 + (g - ink[k][1]) ** 2 + (b - ink[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) { const s = sum[best]; s[0] += r; s[1] += g; s[2] += b; s[3]++; }
  }
  for (let k = 0; k < 3; k++) {
    if (sum[k][3] > 200) for (let c = 0; c < 3; c++) ink[k][c] = sum[k][c] / sum[k][3];
  }

  // mixing lines: cream-orange, cream-black, orange-black
  const PAIR = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
    const d = [0, 1, 2].map((c) => ink[b][c] - ink[a][c]);
    return { a, b, d, len2: d[0] * d[0] + d[1] * d[1] + d[2] * d[2] };
  });
  const ramp = (t) => clamp((t - rampLo) / (rampHi - rampLo));

  // 3. split every solid pixel between the two inks it lies between
  const C1 = new Uint8Array(N); // "cream or orange" coverage
  const C2 = new Uint8Array(N); // "black" coverage
  let offLine = 0, offSum = [0, 0, 0];
  const split = (r, g, b, record) => {
    let bestD = Infinity, bt = 0, bp = PAIR[0];
    for (const p of PAIR) {
      const x = r - ink[p.a][0], y = g - ink[p.a][1], z = b - ink[p.a][2];
      const t = clamp((x * p.d[0] + y * p.d[1] + z * p.d[2]) / p.len2);
      const ex = x - t * p.d[0], ey = y - t * p.d[1], ez = z - t * p.d[2];
      const d = ex * ex + ey * ey + ez * ez;
      if (d < bestD) { bestD = d; bt = t; bp = p; }
    }
    if (record && Math.sqrt(bestD) > offLineTol) {
      offLine++;
      offSum[0] += r; offSum[1] += g; offSum[2] += b;
    }
    const t = Math.round(255 * ramp(bt));
    return bp.a === 0 && bp.b === 1 ? [t, 0] : bp.a === 0 ? [t, t] : [255, t];
  };
  for (let i = 0; i < N; i++) {
    if (A[i] < 128) continue;
    const s = split(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], true);
    C1[i] = s[0]; C2[i] = s[1];
  }

  // 4. soft outer edge inherits the split of its most opaque neighbour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (A[i] === 0 || A[i] >= 128) continue;
      let best = -1, ba = 127;
      for (let r = 1; r <= 2 && best < 0; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (A[j] > ba) { ba = A[j]; best = j; }
          }
        }
      }
      if (best >= 0) { C1[i] = C1[best]; C2[i] = C2[best]; }
    }
  }

  // 5. cumulative masks
  const cover = [A, new Uint8Array(N), new Uint8Array(N)];
  for (let i = 0; i < N; i++) {
    cover[1][i] = (A[i] * C1[i] + 127) / 255;
    cover[2][i] = (A[i] * C2[i] + 127) / 255;
  }

  // 6. half-resolution label map: 0 none, 1 cream, 2 orange, 3 black
  const lw = Math.ceil(W / 2), lh = Math.ceil(H / 2);
  const label = new Uint8Array(lw * lh);
  const labelCount = [0, 0, 0, 0];
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const i = Math.min(H - 1, 2 * y) * W + Math.min(W - 1, 2 * x);
      const v = A[i] < 128 ? 0 : C2[i] > 127 ? 3 : C1[i] > 127 ? 2 : 1;
      label[y * lw + x] = v; labelCount[v]++;
    }
  }

  return {
    W, H, A, C1, C2, cover, label, lw, lh, labelCount, ink,
    stats: {
      offLine,
      offLineRatio: offLine / Math.max(1, labelCount[1] + labelCount[2] + labelCount[3]),
      offLineColour: offLine ? offSum.map((v) => Math.round(v / offLine)) : null,
      ink: ink.map((c, i) => ({ name: INK_NAMES[i], rgb: c.map((v) => Math.round(v)) })),
    },
  };
}

/* ============================================================== tracing */

const ISO = 127.5;

/** Contours of the region where field > 127.5, with sub-pixel vertices. */
export function traceLoops(field, W, H) {
  const HW = W + 1, NH = H * HW, VH = H + 1;
  const next = new Int32Array(NH + W * VH).fill(-1);
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : field[j * W + i]);
  const hId = (i, j) => j * HW + (i + 1);
  const vId = (i, j) => NH + i * VH + (j + 1);
  for (let cy = -1; cy < H; cy++) {
    for (let cx = -1; cx < W; cx++) {
      const tl = at(cx, cy) > ISO, tr = at(cx + 1, cy) > ISO, br = at(cx + 1, cy + 1) > ISO, bl = at(cx, cy + 1) > ISO;
      const k = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const T = hId(cx, cy), B = hId(cx, cy + 1), L = vId(cx, cy), R = vId(cx + 1, cy);
      switch (k) {
        case 1: next[L] = B; break; case 2: next[B] = R; break; case 3: next[L] = R; break;
        case 4: next[R] = T; break; case 5: next[L] = T; next[R] = B; break; case 6: next[B] = T; break;
        case 7: next[L] = T; break; case 8: next[T] = L; break; case 9: next[T] = B; break;
        case 10: next[T] = R; next[B] = L; break; case 11: next[T] = R; break; case 12: next[R] = L; break;
        case 13: next[R] = B; break; default: next[B] = L; break;
      }
    }
  }
  const point = (id, out) => {
    if (id < NH) {
      const j = Math.floor(id / HW), i = (id % HW) - 1, a = at(i, j), b = at(i + 1, j);
      out.push(i + 0.5 + (ISO - a) / (b - a), j + 0.5);
    } else {
      const q = id - NH, i = Math.floor(q / VH), j = (q % VH) - 1, a = at(i, j), b = at(i, j + 1);
      out.push(i + 0.5, j + 0.5 + (ISO - a) / (b - a));
    }
  };
  const loops = [];
  for (let s = 0; s < next.length; s++) {
    if (next[s] < 0) continue;
    const pts = [];
    let e = s, guard = 0;
    while (e >= 0 && next[e] >= 0 && guard++ < 4e6) { point(e, pts); const n = next[e]; next[e] = -1; e = n; }
    if (pts.length >= 6) loops.push(Float32Array.from(pts));
  }
  return loops;
}

export function loopArea(p) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return a / 2;
}

/** Ramer-Douglas-Peucker on a closed loop. */
export function simplify(p, eps = 0.3) {
  const n = p.length / 2;
  if (n < 8) return p;
  let far = 0, d0 = -1;
  for (let i = 1; i < n; i++) {
    const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2;
    if (d > d0) { d0 = d; far = i; }
  }
  const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  const e2 = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = p[2 * a], ay = p[2 * a + 1], bi = b % n, bx = p[2 * bi], by = p[2 * bi + 1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = p[2 * i] - ax, py = p[2 * i + 1] - ay;
      let d;
      if (len2 < 1e-9) d = px * px + py * py;
      else {
        const u = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const qx = px - u * dx, qy = py - u * dy;
        d = qx * qx + qy * qy;
      }
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > e2) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out.length >= 6 ? Float32Array.from(out) : p;
}

/** Coverage map -> simplified closed loops. */
export function outline(field, W, H, { eps = 0.3, minArea = 10 } = {}) {
  return traceLoops(field, W, H)
    .filter((l) => Math.abs(loopArea(l)) >= minArea)
    .map((l) => simplify(l, eps));
}

/* ============================================================== part extraction */

/**
 * One connected patch of a single ink: everything printed in `ink` that hangs
 * together with the seed point. Built on the half-resolution label map, so no
 * pixels are read and the result can be cached.
 */
export function partOf(R, seed, inkName = 'cream', grow = 2) {
  const { label, lw, lh } = R;
  const want = (INK_KEY[inkName] ?? 0) + 1;
  const cover = new Uint8Array(lw * lh);
  const sx = clamp(Math.round(seed[0] / 2), 0, lw - 1);
  const sy = clamp(Math.round(seed[1] / 2), 0, lh - 1);
  let start = -1;
  for (let rad = 0; rad < 24 && start < 0; rad++) {
    for (let dy = -rad; dy <= rad && start < 0; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < lw && y < lh && label[y * lw + x] === want) { start = y * lw + x; break; }
      }
    }
  }
  if (start < 0) return null;
  const stack = [start];
  cover[start] = 255;
  while (stack.length) {
    const i = stack.pop(), x = i % lw;
    for (const j of [i - lw, i + lw, x > 0 ? i - 1 : -1, x < lw - 1 ? i + 1 : -1]) {
      if (j >= 0 && j < cover.length && !cover[j] && label[j] === want) { cover[j] = 255; stack.push(j); }
    }
  }
  for (let n = Math.round(grow / 2); n > 0; n--) {
    const src = cover.slice();
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const i = y * lw + x;
        if (!src[i] && ((x > 0 && src[i - 1]) || (x < lw - 1 && src[i + 1]) || (y > 0 && src[i - lw]) || (y < lh - 1 && src[i + lw]))) cover[i] = 255;
      }
    }
  }
  return cover;
}

/* ============================================================== CLI */

const USAGE = `three-ink.mjs — separate a flat-colour character image into three ink plates

  node three-ink.mjs check    <src.png> [--json]
  node three-ink.mjs separate <src.png> --out <dir> [--palette ${DEFAULT_PALETTE}] [--roles 'orange:#d97757']
  node three-ink.mjs print    <src.png> --out <file.png> [--palette ${DEFAULT_PALETTE}] [--roles ...] [--bg '#262624']
  node three-ink.mjs trace    <src.png> --out <file.svg> [--ink cream|orange|black|all] [--eps 0.25]
  node three-ink.mjs part     <src.png> --ink cream --seed x,y --out <file.png> [--grow 2]

Palettes (what the plates are PRINTED in):
${Object.entries(PALETTES).map(([k, p]) => `  ${k.padEnd(8)} cream ${p.cream}  orange ${p.orange}  black ${p.black}  bg ${p.bg}`).join('\n')}
  The default is "claude": Claude's brand orange, inherited from the reference
  film, where orange = the AI and the AI is Claude. Use --palette mono when the
  character is not that orange and the meaning would be borrowed.

Paper inks (what the SOURCE is painted with): cream ${PAPER_INKS.cream}  orange ${PAPER_INKS.orange}  black ${PAPER_INKS.black}
  These are only seeds for finding the inks in the image; every image's own
  colours are measured at run time.

Quote every hex value: in PowerShell a bare #262624 starts a comment, and
in bash #262624 may be read as the start of a word. Write --bg '#262624'.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[k] = argv[++i]; }
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function parseHex(hex) {
  return hexToRgb(hex);
}

const rgbCss = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

function loadImage(file) {
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  return decodePNG(fs.readFileSync(file));
}

function writeOut(file, buf) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

function cmdCheck(args) {
  const img = loadImage(args._[1]);
  const R = separate(img);
  const { width: W, height: H, data: px } = img;

  let dust = 0, dustStray = 0, nonSolid = 0, solid = 0, transparent = 0;
  for (let i = 0; i < W * H; i++) {
    const a = px[i * 4 + 3];
    if (a === 0) { transparent++; continue; }
    if (a < 16) {
      dust++;
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 24) dustStray++;
      continue;
    }
    if (a >= 250) solid++; else nonSolid++;
  }

  const solidPixels = R.labelCount[1] + R.labelCount[2] + R.labelCount[3];
  const pct = (v, n) => (n ? (100 * v / n).toFixed(1) + '%' : 'n/a');
  const report = {
    file: args._[1],
    size: [W, H],
    transparent,
    dust,
    dustWithStrayColour: dustStray,
    bodyNotFullyOpaque: nonSolid,
    solid,
    estimatedInks: R.stats.ink,
    inkCoverage: {
      cream: pct(R.labelCount[1], solidPixels),
      orange: pct(R.labelCount[2], solidPixels),
      black: pct(R.labelCount[3], solidPixels),
    },
    offMixingLine: {
      ratio: pct(R.stats.offLine, solidPixels),
      meanColour: R.stats.offLineColour,
    },
    verdict: verdictOf({ dust, dustStray, nonSolid, offLine: R.stats.offLine, solidPixels }),
  };

  if (args.json) { console.log(JSON.stringify(report, null, 2)); return report; }

  console.log(`source      ${report.file}  ${W}x${H}`);
  console.log(`inks        cream ${report.estimatedInks[0].rgb.join(',')}   orange ${report.estimatedInks[1].rgb.join(',')}   black ${report.estimatedInks[2].rgb.join(',')}`);
  console.log(`coverage    cream ${report.inkCoverage.cream}   orange ${report.inkCoverage.orange}   black ${report.inkCoverage.black}`);
  console.log(`dust        ${report.dust} px below alpha 16 (${report.dustWithStrayColour} of them carry a stray colour)`);
  console.log(`body alpha  ${report.bodyNotFullyOpaque} px are not fully opaque (want 255)`);
  console.log(`off line    ${report.offMixingLine.ratio} of the body sits off the three mixing lines` +
    (report.offMixingLine.meanColour ? `, mean ${report.offMixingLine.meanColour.join(',')}` : ''));
  console.log(`verdict     ${report.verdict}`);
  return report;
}

function verdictOf({ dust, dustStray, nonSolid, offLine, solidPixels }) {
  const issues = [];
  if (dust > 0) issues.push(`${dust} dust pixels below alpha 16 (${dustStray} carry a stray colour) — regenerate or clean the alpha, do not patch pixels one by one`);
  if (nonSolid > 0) issues.push(`${nonSolid} body pixels are not fully opaque — the matte must be 255 inside the figure and 0 outside`);
  const ratio = solidPixels ? offLine / solidPixels : 0;
  if (ratio > 0.12) issues.push(`${(ratio * 100).toFixed(1)}% of the body is off the three mixing lines — a fourth colour is present; it will be split between two inks instead of staying a flat tone`);
  if (!issues.length) return 'separable — three flat inks, clean matte, ready for plates';
  return issues.join('; ');
}

function cmdSeparate(args) {
  const src = args._[1];
  if (!args.out) throw new Error('separate needs --out <dir>');
  const img = loadImage(src);
  const R = separate(img);
  const roles = rolesFrom(args.roles, args.palette);
  const dir = path.resolve(args.out);
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.basename(src).replace(/\.png$/i, '');

  const files = {};
  files.plateAll = writeOut(path.join(dir, `${stem}_plate0_all.png`), toGreyPNG(img, R.cover[0]));
  files.plateOrangeBlack = writeOut(path.join(dir, `${stem}_plate1_orange_black.png`), toGreyPNG(img, R.cover[1]));
  files.plateBlack = writeOut(path.join(dir, `${stem}_plate2_black.png`), toGreyPNG(img, R.cover[2]));

  // label map, half resolution, one flat colour per ink
  const LC = [[255, 255, 255], [235, 235, 225], [210, 150, 120], [20, 18, 16]];
  const labelPng = makeImage(R.lw, R.lh, (x, y) => {
    const v = LC[R.label[y * R.lw + x]];
    return [v[0], v[1], v[2], 255];
  });
  files.labelMap = writeOut(path.join(dir, `${stem}_labels.png`), encodePNG(labelPng));

  const report = {
    source: src, size: [R.W, R.H],
    estimatedInks: R.stats.ink,
    inkCoverage: {
      cream: +(100 * R.labelCount[1] / Math.max(1, R.labelCount[1] + R.labelCount[2] + R.labelCount[3])).toFixed(2),
      orange: +(100 * R.labelCount[2] / Math.max(1, R.labelCount[1] + R.labelCount[2] + R.labelCount[3])).toFixed(2),
      black: +(100 * R.labelCount[3] / Math.max(1, R.labelCount[1] + R.labelCount[2] + R.labelCount[3])).toFixed(2),
    },
    offMixingLine: { ratio: +(100 * R.stats.offLineRatio).toFixed(2), meanColour: R.stats.offLineColour },
    roles,
    files,
  };
  const reportPath = writeOut(path.join(dir, `${stem}_plates.json`), JSON.stringify(report, null, 2));
  report.report = reportPath;
  console.log(`plates      ${dir}`);
  for (const [k, v] of Object.entries(files)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(`  ${'report'.padEnd(18)} ${reportPath}`);
  return report;
}

function cmdPrint(args) {
  const src = args._[1];
  if (!args.out) throw new Error('print needs --out <file.png>');
  const img = loadImage(src);
  const R = separate(img);
  const roles = rolesFrom(args.roles, args.palette);
  const bg = args.bg ? parseHex(args.bg) : roles.bg;
  const out = makeImage(R.W, R.H, () => [bg[0], bg[1], bg[2], 255]);
  // print order: cream, then orange+black, then black — lower plates run under upper ones
  const paint = (cover, rgb) => {
    for (let i = 0; i < R.W * R.H; i++) {
      const a = cover[i] / 255;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(out.data[i * 4 + c] * (1 - a) + rgb[c] * a);
    }
  };
  paint(R.cover[0], roles.cream);
  paint(R.cover[1], roles.orange);
  paint(R.cover[2], roles.black);
  writeOut(args.out, encodePNG(out));
  console.log(`print       ${path.resolve(args.out)}`);
  return { out: path.resolve(args.out) };
}

function cmdTrace(args) {
  const src = args._[1];
  if (!args.out) throw new Error('trace needs --out <file.svg>');
  const img = loadImage(src);
  const R = separate(img);
  const which = String(args.ink || 'black');
  const eps = Number(args.eps ?? 0.25);
  const idx = which === 'all' ? [0] : which === 'cream' ? [0] : which === 'orange' ? [1] : [2];
  const paths = [];
  for (const k of idx) {
    const loops = outline(R.cover[k], R.W, R.H, { eps, minArea: 10 });
    for (const l of loops) {
      let d = '';
      for (let i = 0; i < l.length; i += 2) d += (i ? 'L' : 'M') + l[i].toFixed(2) + ' ' + l[i + 1].toFixed(2) + ' ';
      paths.push({ d: d + 'Z', area: Math.abs(loopArea(l)) });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${R.W} ${R.H}" width="${R.W}" height="${R.H}">\n` +
    paths.map((p) => `  <path d="${p.d}" fill="none" stroke="${rgbCss(rolesFrom(args.roles, args.palette).orange)}" stroke-width="2"/>`).join('\n') +
    `\n</svg>\n`;
  writeOut(args.out, svg);
  console.log(`trace       ${path.resolve(args.out)}  (${paths.length} loops, ink ${which})`);
  return { out: path.resolve(args.out), loops: paths.length };
}

function cmdPart(args) {
  const src = args._[1];
  if (!args.out) throw new Error('part needs --out <file.png>');
  if (!args.seed) throw new Error('part needs --seed x,y in source pixels');
  const [sx, sy] = String(args.seed).split(',').map(Number);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new Error('--seed must be "x,y"');
  const img = loadImage(src);
  const R = separate(img);
  const cover = partOf(R, [sx, sy], String(args.ink || 'cream'), Number(args.grow ?? 2));
  if (!cover) {
    console.error(`no ${args.ink || 'cream'} ink within 24 px of (${sx}, ${sy})`);
    process.exitCode = 1;
    return null;
  }
  const loops = outline(cover, R.lw, R.lh, { eps: 0.3, minArea: 6 });
  const scaled = loops.map((l) => {
    const o = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) o[i] = l[i] * 2;
    return o;
  });
  const area = loops.reduce((s, l) => s + Math.abs(loopArea(l)), 0) * 4;
  const full = new Uint8Array(R.W * R.H);
  // rasterise the traced patch back at source resolution
  const edges = [];
  for (const l of scaled) {
    for (let i = 0; i < l.length; i += 2) {
      const j = (i + 2) % l.length;
      edges.push([l[i], l[i + 1], l[j], l[j + 1]]);
    }
  }
  for (let y = 0; y < R.H; y++) {
    const ys = y + 0.5, xs = [];
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= ys && y1 > ys) || (y1 <= ys && y0 > ys)) xs.push(x0 + ((ys - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(R.W, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) full[y * R.W + x] = 255;
    }
  }
  const roles = rolesFrom(args.roles, args.palette);
  const inkName = String(args.ink || 'cream');
  // cut-out keeps the rest of the canvas transparent, so it can be composited anywhere
  const rgb = roles[inkName] || [250, 249, 245];
  const cut = Buffer.alloc(R.W * R.H * 4);
  for (let i = 0; i < R.W * R.H; i++) {
    const a = full[i];
    if (!a) continue;
    cut[i * 4] = rgb[0]; cut[i * 4 + 1] = rgb[1]; cut[i * 4 + 2] = rgb[2]; cut[i * 4 + 3] = a;
  }
  writeOut(args.out, encodePNG({ width: R.W, height: R.H, data: cut }));
  console.log(`part        ${path.resolve(args.out)}  (${loops.length} loops, ~${Math.round(area)} source px²)`);
  return { out: path.resolve(args.out), area };
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];
  try {
    switch (cmd) {
      case 'check': cmdCheck(args); break;
      case 'separate': cmdSeparate(args); break;
      case 'print': cmdPrint(args); break;
      case 'trace': cmdTrace(args); break;
      case 'part': cmdPart(args); break;
      case undefined:
      case 'help':
      case '--help': console.log(USAGE); break;
      default: console.error(`unknown command: ${cmd}\n\n${USAGE}`); process.exitCode = 2;
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
