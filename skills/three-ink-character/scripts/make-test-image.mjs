// make-test-image.mjs — generate a deterministic synthetic three-ink character
// image, so the pipeline can be exercised without shipping anyone's artwork.
//
// The shapes are deliberately crude: what matters is that the file has a clean
// alpha matte (255 inside, 0 outside), exactly three flat inks, no gradients,
// and one extra rust tone so the "fourth colour folds into black" path is
// exercised too.
//
//   node make-test-image.mjs --out test.png [--size 420x560]

import fs from 'node:fs';
import path from 'node:path';
import { encodePNG, makeImage } from './png.mjs';
import { PAPER_INKS, hexToRgb } from './palette.mjs';

const INKS = {
  cream: hexToRgb(PAPER_INKS.cream),
  orange: hexToRgb(PAPER_INKS.orange),
  black: hexToRgb(PAPER_INKS.black),
  rust: [150, 72, 40],   // a fourth tone, between orange and black
};

const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

function build(W, H) {
  const cx = W / 2;
  const headY = H * 0.30;
  const hair = [];
  const face = [];
  const collar = [];
  const rust = [];

  // hair mass: a wide ellipse plus a few strands
  hair.push({ t: 'e', cx, cy: headY, rx: W * 0.34, ry: H * 0.24 });
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.34;
    hair.push({
      t: 'r',
      x: cx + Math.cos(a) * W * 0.30, y: headY + Math.sin(a) * H * 0.22,
      w: W * 0.045, h: H * 0.30,
    });
  }
  // face: one flat shape, the way a three-ink character is drawn
  face.push({ t: 'e', cx, cy: headY + H * 0.02, rx: W * 0.16, ry: H * 0.13 });
  // collar: a flat trapezoid
  collar.push([
    [cx - W * 0.20, headY + H * 0.20], [cx + W * 0.20, headY + H * 0.20],
    [cx + W * 0.30, headY + H * 0.46], [cx - W * 0.30, headY + H * 0.46],
  ]);
  // rust: a patch over the hair, the fourth tone
  rust.push({ t: 'e', cx: cx - W * 0.22, cy: headY + H * 0.10, rx: W * 0.07, ry: H * 0.05 });

  const hit = (list, x, y) => list.some((s) => {
    if (s.t === 'e') return ell(x, y, s.cx, s.cy, s.rx, s.ry);
    if (s.t === 'r') return Math.abs(x - s.x) <= s.w / 2 && Math.abs(y - s.y) <= s.h / 2;
    return inPoly(x, y, s);
  });

  return makeImage(W, H, (x, y) => {
    if (hit(rust, x, y)) return [...INKS.rust, 255];
    if (hit(face, x, y)) return [...INKS.black, 255];
    if (hit(collar, x, y)) return [...INKS.cream, 255];
    if (hit(hair, x, y)) return [...INKS.orange, 255];
    return [0, 0, 0, 0];
  });
}

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'three-ink-test.png';
const sizeArg = args.includes('--size') ? args[args.indexOf('--size') + 1] : '420x560';
const [W, H] = sizeArg.split('x').map(Number);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, encodePNG(build(W, H)));
console.log(`wrote ${path.resolve(out)}  ${W}x${H}`);
