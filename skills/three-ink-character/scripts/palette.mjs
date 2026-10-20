// palette.mjs — the two colour sets the pipeline uses, and the named palettes.
//
// They are different things, and conflating them is the usual mistake:
//
//   PAPER INKS  the colours the source art is painted with. The separator looks
//               for these in the image, so the source must be painted in them
//               (or be close enough that the per-image refinement finds it).
//
//   PRINT ROLES the colours the plates are printed in. These carry the meaning:
//               in the reference film cream = the user, orange = the AI, and
//               the AI there is Claude — so the default palette is Claude's
//               brand orange, on a warm near-black ground.
//
// The default print palette is therefore Anthropic's Claude orange (#d97757).
// That is a deliberate inheritance from the film this technique comes from,
// not an arbitrary colour: the character in that film IS Claude, and she is
// orange because the film's whole colour system is "orange = the one talking".
// For any other character, --palette mono drops the brand meaning while
// keeping the same three-ink structure.
//
// Derived from the MIT-licensed artwork pipeline in
// https://github.com/Nyankomintsu/world-execute-me-lyric-mv (Copyright (c) 2026 Nyankomint).
// See NOTICE.md in the repository root.

/** The inks the source art is painted with. */
export const PAPER_INKS = { cream: '#f4e0c6', orange: '#dc723f', black: '#241a15' };

/** Named print palettes: what each plate is printed in. */
export const PALETTES = {
  claude: {
    cream: '#faf9f5',   // the user
    orange: '#d97757',  // the AI — Claude's brand orange
    black: '#1f1e1d',
    bg: '#262624',
  },
  mono: {
    cream: '#f4f1ea',
    orange: '#b3a89b',  // the same slot, without the brand
    black: '#232220',
    bg: '#1b1a18',
  },
};

export const DEFAULT_PALETTE = 'claude';

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a colour: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A palette by name; throws and lists the alternatives when the name is unknown. */
export function paletteByName(name) {
  const key = String(name || DEFAULT_PALETTE).trim().toLowerCase();
  if (!PALETTES[key]) {
    throw new Error(`unknown palette "${name}" — available: ${Object.keys(PALETTES).join(', ')}`);
  }
  return { name: key, ...PALETTES[key] };
}

/**
 * The roles a print run uses: a palette, with per-role overrides applied on top.
 * `spec` is "name:#hex,..." and may use ":" or "=". A malformed entry is an
 * error, never a silent fallback to the default colour.
 */
export function rolesFrom(spec, paletteName = DEFAULT_PALETTE) {
  const base = paletteByName(paletteName);
  const roles = {
    cream: hexToRgb(base.cream),
    orange: hexToRgb(base.orange),
    black: hexToRgb(base.black),
    bg: hexToRgb(base.bg),
    name: base.name,
  };
  if (!spec) return roles;
  for (const part of String(spec).split(',')) {
    const s = part.trim();
    if (!s) continue;
    const m = /^([a-z]+)\s*[:=]\s*(.+)$/i.exec(s);
    if (!m) throw new Error(`bad role entry "${part}" — write name:#hex, e.g. orange:#d97757`);
    const name = m[1].toLowerCase();
    if (!(name in roles) || name === 'name') throw new Error(`unknown role "${name}" (cream, orange, black, bg)`);
    roles[name] = hexToRgb(m[2]);
  }
  return roles;
}

/** The paper inks as RGB triples, in the order the separator expects. */
export function paperInkRGB(spec = null) {
  const src = { ...PAPER_INKS };
  if (spec) {
    for (const part of String(spec).split(',')) {
      const s = part.trim();
      if (!s) continue;
      const m = /^([a-z]+)\s*[:=]\s*(.+)$/i.exec(s);
      if (!m) throw new Error(`bad ink entry "${part}" — write name:#hex, e.g. orange:#dc723f`);
      const name = m[1].toLowerCase();
      if (!(name in src)) throw new Error(`unknown ink "${name}" (cream, orange, black)`);
      src[name] = m[2];
    }
  }
  return [src.cream, src.orange, src.black].map(hexToRgb);
}
