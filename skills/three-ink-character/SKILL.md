---
name: three-ink-character
description: |
  Turn a flat-colour character illustration into three ink plates (cream / orange / near-black) with
  cumulative masks, traced vector outlines, a half-resolution ink label map, and connected-part
  extraction, so the character can be rendered as a misregistered print from code. Use this skill when
  the user wants a character to look like a screen print, risograph or 版画; asks for "三墨" / "分色" /
  "墨版" / "错版" / "套印" / "silhouette separation"; wants to turn a generated character PNG into plates,
  masks or outlines; or wants to cut a body part (a hand, an ear, a lock of hair) out of existing artwork.
  Triggers on "three-ink", "ink separation", "print the character", "make it look printed". Do NOT use
  it for general photo editing, colour grading, or illustration that is not built on flat separations.
---

# Three-Ink Character

A character drawn with flat inks is not a picture, it is a set of separations. Once you have the
separations you can re-print the character at any size, any colour state, any registration error, and
any screen — without ever redrawing the figure.

`scripts/three-ink.mjs` does the deterministic part. Node.js >= 18, no dependencies, no install step.

## Inputs to collect

- **The source image** (path to a PNG). If the user has none, point them at
  `references/art-spec.md` — it carries the prompt and the checklist for an image generator that
  produces a source this pipeline can actually separate.
- **What the inks mean.** Defaults: cream = the user, orange = the character, black = shadow.
  Overridable per plate with `--roles 'cream:#faf9f5,orange:#d97757,black:#1f1e1d'`.
  Quote the whole value and use `name:#hex` — an unquoted `#` starts a comment in PowerShell, and
  a malformed entry is rejected rather than ignored, so a typo fails loudly instead of silently
  printing the default palette.
- **Where the outputs go.** `--out <dir>`.
- **Sibling poses.** If several poses of the same character must cut against each other, they need the
  same canvas size and shared anchor points; ask whether the user has a set already, otherwise say
  that registration is only reliable within one image.

## Procedure

1. **Check the source before separating it.**
   `node scripts/three-ink.mjs check <src.png>`
   The separation assumes a clean matte (alpha 255 inside the figure, 0 outside) and colours that sit
   on the three mixing lines. The tool absorbs the usual AI artefacts by itself: alpha below 16 is
   dropped as dust, and the outer edge is thresholded at the 50% coverage line, so a figure with a
   soft fringe still separates into hard-edged plates.

   Read the verdict for what it changes. Dust and a partly transparent body are a note about the
   *source*, not a blocker — the plates come out usable, and the trace is sharp. They matter in two
   places: when the figure will be magnified past about 2x (the anti-aliased edge becomes a wide
   soft band in the bitmap even though the traced path stays hard), and when the user wants a
   genuinely print-grade source, which means regenerating against `references/art-spec.md`. Never
   patch pixels to fix the matte: patched pixels become a fourth tone that the plates split
   between two inks, and the character quietly loses its flatness.

   A large off-line share means a fourth colour is really present. That one is worth regenerating
   for, because a fourth tone is a design decision, not a defect.

2. **Separate once, at load time, never per frame.**
   `node scripts/three-ink.mjs separate <src.png> --out <dir>`
   Produces three **cumulative** plates (`plate0_all`, `plate1_orange_black`, `plate2_black`), a
   half-resolution `labels` map (0 none / 1 cream / 2 orange / 3 black), and a JSON report with the
   estimated ink colours and coverage shares.
   The cumulative order is the whole trick: `plate0 ⊇ plate1 ⊇ plate2`, so a plate shifted out of
   register reveals the ink underneath instead of cutting a hole in the silhouette. Do not flatten the
   plates into independent layers — that is what breaks misregistration.

3. **Print in order, in palette roles.**
   Cream first, then orange+black, then black: lower plates run under upper ones. The role each plate
   is printed in carries meaning (orange = the character, cream = the user, red = error, grey =
   absence), so re-printing the same plates in a different state re-colours the character without
   touching the art. Two rules that are easy to miss and easy to get wrong:
   - when the character shares the frame with the user's cream interface, print her cream plate in a
     dimmer cream role, or the two creams become indistinguishable;
   - the black plate is nearly the page colour, so every use needs paper, a pool of light or a
     keyline behind it, or she disappears into the background.
   `references/printing-rules.md` has the role table and the misregistration, halftone and glyph
   recipes.

4. **Trace for close-ups instead of enlarging the bitmap.**
   `node scripts/three-ink.mjs trace <src.png> --out <file.svg> --ink black`
   A plate drawn at more than about 1.75x its source size at 4K goes soft; the traced path stays
   sharp at any size. The trace is a simplification of the raster (marching squares, then
   Ramer-Douglas-Peucker), so it is *crisper and slightly coarser* than the source — that is the
   intended print look, but do not use it for small on-screen sizes where the raster still holds up.

5. **Sample the label map for screens, not the bitmap.**
   Halftone dots and glyph plates should ask "which ink is at this point" (the label map) or "how
   bright is this point", not "what colour is this pixel". One screen per ink keeps the separations
   legible; a single brightness screen destroys them.

6. **Cut body parts out of the art, never by hand.**
   `node scripts/three-ink.mjs part <src.png> --ink cream --seed 290,1100 --out <file.png>`
   The seed is a point in source pixels; the tool floods the label map and returns the connected
   patch of that ink around it. A reaching hand, an ear, a lock of hair cut this way stays in
   register with the figure and inherits the same three inks. A hand-drawn mask never does.
   The patch carries **one** ink, so the outline that gives the part its shape stays behind in the
   figure. To keep it, take the same region in the black plate as well (`--ink black`, a seed on
   the outline) and print the two in the normal cream-then-black order; to pull the outline in from
   the surrounding art, flood the black plate outwards from the skin in a few bounded passes
   rather than cutting at a fixed radius, or the flood runs into the hair.

7. **Record anchor points.**
   Note the coordinates you used (chin, flower, collar, hand, eye) in a `regions.json` next to the
   plates, so later shots can point the camera at them and sibling poses can be registered.

## Output contract

Report back to the user:

- the estimated ink colours and the coverage share of each ink (from the report JSON);
- the path to the plates directory and the label map;
- the verdict from `check`, with the concrete remedy when it is not clean — a vague "the image is
  low quality" is not actionable;
- the anchor points you measured, and where you stored them.

Do not paste large base64 or dump the whole plates into the chat. Reference file paths.

## Failure handling

- **`check` says the matte is dirty** → report it, keep going. The plates will still be correct;
  regenerate the source only if the figure is being magnified or the user wants print-grade art.
- **`check` says a fourth colour is present** → the source has to be regenerated. Say so plainly
  and hand over `references/art-spec.md`; do not silently clean pixels in a loop, because the
  cleaned pixels will read as a new tone.
- **`part` finds no ink near the seed** → the seed sits on another ink or on a boundary between two.
  Move the seed onto the wanted ink (the label map image shows where it is) or pick a different ink.
- **A plate shows seams** → the plates were flattened or painted out of order. Keep the cumulative
  order and print lower plates first.
- **A close-up looks wrong rather than soft** → the traced path was simplified too hard; lower `--eps`.
- **The character reads as a different colour than expected** → the palette role, not the art, is
  wrong. Check the role table before touching the source image.

## Examples

**Input**: "把这张角色图做成三墨版画的效果，能单独印橙色那一版吗。"

```
node scripts/three-ink.mjs check src.png
node scripts/three-ink.mjs separate src.png --out out/plates
node scripts/three-ink.mjs print src.png --out out/print.png
```
Report the three estimated inks, the coverage shares, and the paths. If `check` flagged the matte,
tell the user the source needs regenerating and point at `references/art-spec.md`.

**Input**: "最后一张版画里她伸出的手要单独放大,把那只手取出来。"

```
node scripts/three-ink.mjs part src.png --ink cream --seed 290,1100 --out out/hand.png
node scripts/three-ink.mjs trace src.png --out out/hand.svg --ink cream
```
The part is cut from the cream plate, so it keeps the figure's inks and stays in register.

## Windows (win32) platform notes

The commands are identical on Windows, macOS and Linux: they are `node` invocations against a script
path relative to this skill directory. In PowerShell:

```powershell
$Skill = "D:\path\to\three-ink-character"
node "$Skill\scripts\three-ink.mjs" check ".\src.png"
node "$Skill\scripts\three-ink.mjs" separate ".\src.png" --out ".\out\plates"
```

No `npm install` step exists or is needed. Use `$env:TEMP` for scratch output. If a path contains
spaces, quote it.

**Quote every hex value.** In PowerShell a bare `#262624` starts a comment, so the argument
disappears and the tool reports `not a colour: true`; write `--bg '#262624'` and
`--roles 'cream:#f4e0c4,orange:#db723f,black:#2a1b16'`. The same quoting is harmless in bash.

## References

- `references/art-spec.md` — how to get a source image this pipeline can separate: the prompt, the
  three-ink rule, matte hygiene, resolution rules for close-ups, and registration between poses.
- `references/printing-rules.md` — the print contract: palette roles and their meaning, cumulative
  plate order, misregistration, halftone and glyph screens, the paper, and the rules about faces.
