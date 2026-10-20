# Printing rules — turning plates into a character on screen

The plates are separations. Everything below is about how they get put on the page, and what each
move means.

## Roles carry the meaning

A plate is printed in a **role**, not in a colour. The role decides what the ink means in the
picture, so the same separations can be re-printed in a different state without touching the art.

| role | meaning in the reference project | typical use |
| --- | --- | --- |
| `text` | cream = **the user** | interface text, the user's own marks |
| `me` / `meHot` / `meDim` | orange = **the character** | the figure, her ink, her accent |
| `err` | red = an error | error states |
| `bg` / `panel` / `raised` | the surfaces of the interface | windows, cards, inputs |
| `line` | hairlines and separators | borders, rules, keylines |
| `sub` / `mute` | dimmer text | secondary text, and **the character's cream plate when she shares the frame with the user's cream interface** |
| `bloom` | the colour that is allowed to glow | saturated accents only |

Two consequences that are easy to get wrong:

- **Cream belongs to the user.** When the character's cream plate and the user's cream interface are
  in the same frame, print her cream in `sub`. Two identical creams side by side make it ambiguous
  who is speaking.
- **Black is nearly the page colour.** Every use of the black plate needs paper, a pool of light or
  a keyline behind it. Without a ground, the black parts of the character vanish into the
  background rather than reading as ink.

The palette is a **state**, not a style: greyscale when the character is not present or the user is
gone, hotter when the conversation warms, red on an error, dimmed after the error is dismissed. A
per-state "how much colour the art keeps" factor is the cheapest way to grey a character out
without re-drawing her.

## Plate order is cumulative

Print in this order, each plate running **under** the ones above it:

1. cream plate (the whole figure)
2. orange plate (orange + black)
3. black plate (black)

Because the masks are cumulative (`plate0 ⊇ plate1 ⊇ plate2`), a registered print has no seam, and
a plate shifted out of register shows the ink underneath instead of a hole. Flattening the plates
into independent layers destroys exactly that property.

To lay the separations side by side instead of on top of each other (a "proof" look), print each
plate with the plates above it subtracted, so each ink occupies only its own area.

### Trapping, the alternative

There is a second way to build the plates: as exact complements, each ink covering only its own
territory, with nothing under it. That is how a commercial separation works, and it is what a
screen-printing house would ask for.

It has one problem: shift a complement plate and the area it vacated is simply *empty*, so the
print tears open a hole. Print practice solves this with **trapping** (套准加放): each plate gets
a thin outline in its own colour, so it swells slightly past its boundary and covers the gap that
opens. In SVG that is a `stroke` with the plate's own `fill`, `stroke-linejoin="round"`, and a
width of twice the trap distance; on a canvas it is the same plate printed nine times, once at the
centre and once in each of the 8 neighbours.

The cumulative masks used here avoid the problem instead of compensating for it, which is why the
tool does not need trapping. If you rebuild the plates as complements — or you take the plates
from a different source — add trapping, or the misregistration will read as damage rather than as a
press defect.

## Misregistration is the animation

The main way a printed character moves is by moving its plates apart by a few pixels and sliding them
back. A per-plate offset, a per-plate reveal and a red plate printed under the orange one produce
the effect of a badly aligned press run — which is a far better fit for a character who is a print
than any facial animation.

Rules that make it work:

- offset the cream plate slightly one way and the black plate slightly another, so the figure never
  looks like a single flat shape;
- let the red plate follow late and travel further, so the error reads as mechanical;
- spring the plates apart on a beat and slide them home over a fraction of a second — a continuous
  drift reads as a blur, not a print defect;
- a single event per beat, held for its full duration, so it never flickers.

## Reveal (develop)

A plate can be wiped in from one edge: 0 to 1 of the plate is printed, growing down, up, right or
left. This is the equivalent of a print developing under a lamp, and it is the natural way to
introduce the character or a new pose.

## Screens

Two screens work on a character, and both must respect the separations:

- **Halftone** — dots whose size follows the brightness of the source. Screening one ink at a time
  keeps the figure legible as three separations; screening on brightness alone merges them.
- **Glyph plate** — the figure drawn in characters, clipped to its own outline, with one character
  set per ink. The rule is that the *ink separation carries the picture* exactly as in the flat
  print, so the characters are coloured by ink, not by brightness.

For both, print a flat under-colour of the figure first so it reads as a shape before any character
does.

## The paper

The ground a plate sits on is part of the print, not a background:

- warm near-black paper, never pure black;
- a flat dot screen at 45 degrees, often denser towards the bottom;
- a fine grain;
- a pool of light behind the subject in **two flat steps**, not a gradient — two steps read as a
  print, a gradient reads as a glow;
- crop marks and a registration target in the corners, because the frame is a sheet in a press.

## The face

The rule that keeps this technique honest: **never distort the features, never animate the mouth,
never draw a face in code.** A face drawn by code is always slightly wrong, and once it is wrong the
character stops being a print.

When a face is in frame:

- no transition that warps the picture, no tearing, no channel separation or datamosh on the figure;
- only misregistration and dropped frames are allowed to disturb it;
- the ground behind the black ink stays flat.

## Registration between images

When two poses of the same character have to cut against each other, correct them by a scale and an
offset measured on a shared landmark (the chin, the hair ornament, the collar):

```
s' = s * k,   t' = t + (dx, dy)
```

Measure the landmarks in source pixels and store them next to the plates. Two images that register
correctly can be swapped, hard-cut or overlaid without the figure appearing to jump.
