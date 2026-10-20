# Art spec — getting a source image this pipeline can separate

The separator assumes two things about its input: a **clean alpha matte** and **flat colours that sit
on the three mixing lines**. An image generator will not give you either unless the prompt asks for
them. This file is the prompt and the checklist that get you there.

## Why the source has to be flat

The separator projects every pixel onto the three mixing lines between cream, orange and black. A
pixel that sits exactly on a line is a clean blend of two inks and splits predictably. A pixel that
sits off every line is a fourth colour: the separator has to guess which two inks it belongs to, and
the result reads as a muddy tone rather than a flat one.

A gradient is the same failure spread over many pixels: every one of them is slightly off the line,
so the whole area turns soft. So the requirement is not "three colours" but "three colours, each
flat".

## Prompt template

Give the generator the pose and the framing you want, then this block:

```
Flat vector illustration, screen-print look, printed in exactly THREE flat inks and nothing else:
1) cream   #F4E0C6
2) orange  #DC723F
3) near-black #241A15

Strictly three inks. Every region is ONE flat colour with hard edges between inks.
No gradients, no shading, no soft shadows, no glow, no transparency inside the figure,
no texture inside the figure. Transparent background.
```

Negative / exclusion terms worth adding: `gradient, soft shading, airbrush, glow, drop shadow,
semi-transparent, more than three colours, watermark, text, signature`.

### Sizing

| use | long side |
| --- | --- |
| face close-up, or anything that will be magnified past 2x | 3000 px or more |
| bust, portrait, full body | 2000 px or more |

Below these, a 4K close-up has no detail left to keep: the pixels are stretched and the edge
softens. If the source is smaller, either draw it smaller on screen, or trace it and accept that the
traced outline is the level of detail you actually have.

### Framing

Leave **at least 5% margin** on every side, and more above the head. A cut edge cannot be
reconstructed: a cropped image can only be used bleeding off the frame or off a panel edge, which
dictates the composition for the rest of the project. Ask for uncropped art and crop later.

### Registration between poses

If the same character appears in several poses and you want to cut between them, they have to share
a canvas size and land on the same points. Put these in the prompt:

```
Same canvas size and same scale as the reference image.
The chin, the hair ornament and the collar must land on identical coordinates in every pose.
Keep the head at the same tilt unless the prompt asks for a different tilt.
```

If the generator will not hold the registration, measure it after the fact: take the chin of each
pose, compute the scale and offset that maps it onto the reference pose, and store those numbers
next to the plates. That is the same `s = scale, t = (dx, dy)` correction the reference project
applies to its sibling busts.

### Faces

Faceless art is the robust choice: it cannot be misdrawn, it cannot be animated wrongly, and it
survives magnification. When a face is needed, keep the face flat and keep it to one state per
image — the reference project lets a character open her eye in exactly one image and forbids
animating the mouth anywhere.

If several images share a face, ask for them to be the same image with only the eyes changed, so
the rest stays pixel-identical.

### Layers, if the tool offers them

Asking for **one layer per ink** removes the in-app separation step entirely and makes misregistration
cleaner, because each plate is already a real layer. Worth it when the generator supports it.

## Verification loop

```
node scripts/three-ink.mjs check art.png
```

Then fix the source against the report, one item at a time:

| report says | what to change in the prompt |
| --- | --- |
| dust pixels below alpha 16, some carrying a stray colour | ask for a cleaner transparent background, no halo, no anti-aliased fringe |
| body pixels are not fully opaque | ask for a hard matte; a generator that anti-aliases the whole figure cannot be fixed downstream |
| a large share sits off the mixing lines | a fourth colour crept in — name the three inks again, and name the colours to avoid |
| coverage share of one ink is near zero | that ink is missing from the pose; ask for it explicitly |

Re-run `check` after each regeneration. Two or three rounds is normal; a source that passes cleanly
is worth the wait, because every downstream plate inherits its quality.

### When the background is faked

Asking for a transparent background does not get you one. Most generators bake in a flat colour, and
some draw a grey-and-white **checkerboard** to look transparent. The checkerboard is the dangerous
case: it is two achromatic greys, so the separator reads it as a fourth colour and smears it across
the figure.

Do not regenerate your way out of this — the same generator will do it again. Clean the matte:

```
node scripts/clean-matte.mjs raw.png --out clean.png --light-ink cream
```

The tool measures the checkerboard period from the image, verifies the lattice, then solves the
coverage of every pixel against the background and snaps it to the nearest flat ink, writing alpha 0
or 255. Highlights enclosed by the figure are kept as the light ink. Then run `check` again.

If the tool refuses — it says the border is not a flat surface — then the background really is
something else, and that one does need regenerating.

Three things it taught us, worth knowing before you prompt:

- **The faked background comes in both flavours.** Sometimes it is light (white and pale grey
  squares), sometimes it is dark (grey and near-black squares). The tool measures which; do not
  assume a light one.
- **The generator may hand you a JPEG.** A JPEG has no alpha at all, and its compression leaves
  ringing along every edge, which turns into speckle in the flat areas. Convert it to PNG first and
  ask for PNG output; the tool can cope with a little ringing, but not with a lot.
- **One thing cannot be recovered: a figure region that is the same flat colour as one of the
  background levels and touches the edge of the canvas.** A white dress on a white checkerboard is
  literally the same colour as the background, and no amount of geometry can separate them. Give
  that region its own colour in the prompt — ask for the dress in cream, not white — and the
  problem disappears.

## What you get

`check` only reports. The plates come from `separate`, and the plate order, the cumulative masks
and the print rules are in `references/printing-rules.md`.
