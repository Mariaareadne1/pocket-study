# Attribution

## Ann Nguyen — CD Case (primary rendering reference)

Pocket Study's transparent-plastic rendering is adapted from **Ann Nguyen**'s CD case experiment.
It is live at <https://www.bubbbly.com/cd-case>, and its source is at
<https://github.com/annnguyentt/vibe-coding/tree/main/cd-case> (commit `faca2f6`). It was made with
**TypingMind** (<https://www.typingmind.com>).

The collection asks that anyone who uses, remixes, forks or learns from it credit Ann Nguyen and
TypingMind; a mention or link back is enough. It has no licence file, so we read this as permission to
remix with credit, not as an open-source licence. Ann's original repository was never modified or
pushed to.

The ports came by way of the owner's earlier study, Cassette Study, which already credits Ann.

| File here | What came from the CD case | What changed |
| --- | --- | --- |
| `src/engine/shaders/studio.ts` | `STUDIO`, room bake, `ROD_VERT/FRAG` (ray-traced refraction rods), `SHEET_*`, copy/bright/streak/final passes | Ported to TypeScript, then retinted for the faint lavender polycarbonate |
| `src/engine/geometry/rods.ts` | Rounded-rect profile sweeps, `RodBuilder`, sheet helpers | Ported to TypeScript and generalised for many parts |
| `src/engine/stage/pipeline.ts` | The framebuffer sequence: opaque page → back-to-front glass in MSAA ping-pong targets with a copy quad and depth proxies → bloom/streak → sRGB | Generalised to N nested glass groups |
| `src/engine/stage/motion.ts` | Monotone cubic `curve()` | Ported unchanged |
| `src/engine/shaders/surfaces.ts` | The backdrop's analytic box shadows follow `BACKDROP_FRAG` | Rewritten for opaque PBR-ish surfaces lit by the same studio |

Not copied: the TypingMind badge, the disc print, any of the case geometry, and any branding.

## C0deWiz4rd010 — retro-pocket-games (MIT)

<https://github.com/C0deWiz4rd010/retro-pocket-games>, commit `db390f2`. Only the seeded random number
generator was copied (`src/runtime/rng.ts`, mulberry32). Its licence:

```
MIT License

Copyright (c) 2026 C0deWiz4rd010

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Its input manager, host contract and games were read for comparison, but none of that code was copied.

## Original work

All of the following were made for this study, in code:

- the handheld and cartridge models
- the PCB art
- the device state machine
- the console runtime
- the 5×7 pixel font
- every sprite
- the three games (BLOOM, STARFALL, LITTLE SKY)
- the boot mark and chime
- every sound effect, synthesised with Web Audio

No samples, ROMs or third-party game assets are used.

## Dependencies

three.js, Next.js and React are used under the MIT licence. Dev tools: Playwright, Vitest, pngjs, and
ffmpeg-static / ffprobe-static. ffmpeg itself is LGPL/GPL; it is used only as a local tool to build the
demo films and is not shipped.

## Marks

No console manufacturer names, logos, boot screens or trade dress are reproduced. "Pocket Study",
"OBJECT STUDY / 002" and all lettering on the object were invented for this study.
