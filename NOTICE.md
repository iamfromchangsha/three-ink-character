# NOTICE

## What this is derived from

The separation, tracing and part-extraction algorithms in
`skills/three-ink-character/scripts/three-ink.mjs` and the PNG codec in
`skills/three-ink-character/scripts/png.mjs` are derived from the artwork pipeline of

> **world.execute(me); — Lyric MV**
> https://github.com/Nyankomintsu/world-execute-me-lyric-mv
> Copyright (c) 2026 Nyankomint — MIT License

That project's `src/engine/art.js` (`_prepareInk`, `inks`, `part`) and `src/engine/trace.js`
(`traceLoops`, `simplify`, `smoothPath`) are MIT licensed, so this repository is MIT licensed too and
retains the upstream copyright notice in `LICENSE`.

The palette roles, the cumulative plate order, the misregistration and reveal model, the paper
treatment and the rules about faces follow `docs/v4/PLAN.md` of the same project. The art-direction
checklist in `references/art-spec.md` follows `docs/v4/WANTED_ART.md` of the same project.

`scripts/three-ink.mjs` adds a source-quality gate (`check`) and a `print` preview that the
upstream project does not have; the upstream keeps the same logic inside its browser renderer.

## What is NOT included

**No character artwork from the upstream project is included in this repository.** The silhouettes in
that project (`assets/character/*.png`) are licensed **CC BY-NC-SA 4.0**, credit Nyankomint — non
commercial, share alike — and are deliberately left out so this repository stays MIT licensed and
commercially usable.

`scripts/make-test-image.mjs` generates a synthetic three-ink fixture (crude geometric shapes, one of
them deliberately in a fourth "rust" tone) so the pipeline can be exercised without any third-party
art.

## Third-party software

None. The scripts use only the Node.js standard library (`node:fs`, `node:path`, `node:url`,
`node:zlib`). There is no `package.json`, no dependency install and no build step.

## Trademarks

Claude is a trademark of Anthropic PBC. This repository is an independent technical extraction of a
print-simulation technique and is not affiliated with or endorsed by Anthropic, Mili, or the
upstream project's author.
