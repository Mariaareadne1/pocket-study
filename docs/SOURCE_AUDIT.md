# Source audit

Read before any Pocket Study code was written. Both reference repositories were cloned read-only into
`~/Development/_refs/`. Nothing was pushed to them, and their working trees were not modified.

## 1. Ann Nguyen — CD Case (primary rendering reference)

- Source: <https://github.com/annnguyentt/vibe-coding/tree/main/cd-case>, commit `faca2f6` (2026-10-12)
- Live: <https://www.bubbbly.com/cd-case>, built with **TypingMind**
- Licence: **no licence file.** The collection README asks anyone who uses, remixes, forks or learns from
  it to credit Ann Nguyen and TypingMind. We treat that as permission to remix with credit, not as an
  open-source licence (see [ATTRIBUTION.md](ATTRIBUTION.md)).
- Baseline: ran locally (Next dev, port 9283). Screenshots of rest, opening, open and drag are in
  `docs/media/reference/` (60 fps, no console errors).

### What makes it look the way it does

| Technique | Where | Why it matters |
| --- | --- | --- |
| **Analytic studio baked to a 512² HDR cube map** | `STUDIO` + `ROOM_BAKE_FRAG` in `shaders.js` | Softboxes, floor bounce and a "star" lamp are evaluated once into a cube. The alpha channel stores lamp energy so later passes know which reflections are hot. |
| **Camera-fixed (view-space) lighting** | `CaseStage.js` | The studio rotates with the camera, so highlights stay composed when you orbit. That is what keeps it "product photo" rather than "game asset". |
| **Ray-traced refraction rods** | `ROD_VERT/FRAG` | Every thick edge is a swept rounded-rect profile, ray-traced analytically in the fragment shader: entry and exit normals, IOR 1.59, Beer–Lambert absorption `[0.0042, 0.003, 0.0026]`, total internal reflection. Real polycarbonate edge glow comes from this, not from a transmission material. |
| **Cheap sheets for thin panels** | `SHEET_VERT/FRAG` | Big flat faces are thin slabs: Fresnel reflection plus an offset sample of what's behind. |
| **Explicit framebuffer sequence** | `draw()` | Opaque page → each glass group back-to-front into a 4× MSAA ping-pong target: copy quad of what's behind (renderOrder −10), depth-only proxies of opaque parts (−5), then rods sampling `uBehind`. Everything is scissored to the projected bounds. |
| **Alpha as data** | throughout | 0 = backdrop, ≥1 = matter, >2 = sparkle. The post chain uses it to bloom only real glints. |
| **Post chain** | `BRIGHT/STREAK/FINAL` | Thresholded bright pass, an anamorphic star streak, then sRGB/tonemap. |
| **Analytic backdrop shadows** | `BACKDROP_FRAG` | Soft contact shadows are box SDFs in a shader, not shadow maps. They stay soft and alias-free. |
| **Motion** | `curve()`, grab spring (k 16, c 5.5), tap slop 6 px | A monotone Hermite spline drives the opening. Drag rotation is spring-damped, so the object has weight. |
| **Adaptive DPR** | `CaseStage.js` | The resolution steps down when frames run long. |

### Reused (credited) vs new

The Ann-derived passes arrive through `~/Development/cassette-study`, the owner's previous study. That
study already ported them to TypeScript with credit, and they are copied from there:

- `src/engine/shaders/studio.ts`: studio, room bake, rod and sheet shaders, post passes
- `src/engine/geometry/rods.ts`: rounded-rect sweeps, `RodBuilder`
- `src/engine/stage/pipeline.ts`: the framebuffer sequence, generalised to N glass groups
- `src/engine/stage/motion.ts`: `curve()`

New for Pocket Study: all handheld and cartridge geometry, the PCB, the screen/LCD shader, picking and
drag-to-insert, the device state machine, the console runtime, input, audio and the three games.

## 2. C0deWiz4rd010 — retro-pocket-games (secondary game reference)

- Source: <https://github.com/C0deWiz4rd010/retro-pocket-games>, commit `db390f2` (2026-07-31)
- Licence: **MIT**, © 2026 C0deWiz4rd010
- Stack: PixiJS + Vite, a set of small handheld-style games behind a `GameHost`

### What we learned

| Area | Observation | What we did |
| --- | --- | --- |
| Seeded RNG (`rng.ts`) | mulberry32, small and deterministic | **Adopted** in `src/runtime/rng.ts`, with the MIT notice in the file header and in ATTRIBUTION.md. Added `snapshot`/`restore` so a run's RNG state can live inside immutable game state. |
| Input (`InputManager.ts`) | One `Set` of held actions, shared by every source. If keyboard and touch both hold "left", releasing either one releases both. | Not copied. Our `InputHub` keeps a held set per source and counts presses, so taps shorter than one tick are not lost. |
| Host/game contract (`GameHost.ts`, `types.ts`) | The game gets update/draw plus host services | The idea is similar, but our `Game`/`GameHost` interfaces were written for this project (framebuffer drawing, save slots, image export, phases). |
| Games | Classic arcade clones | Not used. BLOOM, STARFALL and LITTLE SKY are original designs (see [GAME_DESIGN.md](GAME_DESIGN.md)). |

## 3. Marks and content we deliberately avoid

- No Nintendo (or any manufacturer) names, logos, boot screens, button lettering or cartridge shapes copied
  from real products. The "four tiles" boot mark, the chime (E5 → B5 triangle) and all label art are
  original.
- No ROMs, emulation or third-party game assets. Every sprite and the 5×7 font are drawn in code.
