# Progress

Each milestone is tested, committed and pushed before the next one starts.

| # | Milestone | State | Evidence |
| --- | --- | --- | --- |
| 0 | Source audit, scaffold, runtime + games logic | done | `docs/SOURCE_AUDIT.md`; `npm test`: 59 unit tests pass; typecheck + lint clean |
| 1 | Transparent handheld rendering | done | `scripts/shoot.mjs` renders hero/side/back/top in headless Metal Chrome; typecheck + lint + 59 unit tests |
| 2 | Cartridges, power, buttons, drag-to-insert | done | E2E journey (real mouse drag, 3D switch, blocked actions) |
| 3 | Screen in 3D, input wiring, games on device | done | `shoot.mjs` stills of all three games on the LCD; E2E keyboard + 3D D-pad |
| 4 | UI, mobile, accessibility, E2E | done | `npm run test:e2e`: 3 tests (see log for run history); 390×844 stills |
| 5 | Demo films + media | done | `demo/ffprobe.json`: both 22.00 s, h264 yuv420p 30 fps, AAC; poster, contact sheet, 12 stills, GIF |
| 6 | Docs, deploy, handoff | done | https://pocket-study.vercel.app — E2E 3/3 against the live URL |

## Log

### Milestone 0 — 2026-11-23

- Audited the CD Case (rendering) and retro-pocket-games (MIT, game host) references and captured CD Case baselines.
- Scaffolded Next 15 + three 0.185 + Vitest + Playwright (dev port 5580, prod 4580).
- Runtime: 160×144 software framebuffer, original 5×7 font, seeded RNG, multi-source input hub,
  versioned save slots, Web Audio engine with original SFX and offline WAV render.
- Device: a pure state machine for slot, power and drag, with blocked reasons.
- Games: BLOOM, STARFALL and LITTLE SKY, each with pure logic and a cartridge wrapper (menus, saves, sound).
- Tests cover device states, input equivalence/taps/holds/cancel, each game's rules, save/reload, corrupt
  saves, pause freeze, and PNG export size + pixels.

### Milestone 1 — 2026-11-23

- Handheld geometry built from the CD Case pipeline: ray-traced rods for walls, lips, seams, bosses, ribs, slot
  jaws and rails; sheet panels for the front and back faces; ping-ponged glass groups (back, then front).
- Lavender body colour: rod absorption raised per channel, and the reference's neutral sheet shader gained a
  `uHaze`/`uTint` term (0 keeps the reference's behaviour) so the clear faces carry a faint lavender.
- PCB with a two-sided procedural texture (traces, vias, gold pads, silkscreen) and a metal mask; chips, SMD fields,
  carbon domes, connector, battery, speaker, screws, standoffs, flex cable, power switch, LED.
- Controls: D-pad (rocks on its pivot), A/B caps, Start/Select pills, all on springs.
- 160×144 LCD shader: sharp-bilinear sampling of the live framebuffer, a pixel grid that fades with distance,
  backlight and a cover-glass reflection.
- Three opaque cartridges with labels drawn from each game's own pixel art.
- Bloom status bar: one-pixel gap between its two text rows (they merged at on-device scale).

### Milestones 2–4 — 2026-11-23

- Controller: every input source (3D pointer, `key:<code>`, `touch:<action>`, gamepad) feeds one hub under its
  own id; blur/hidden releases all and pauses. Escape pauses; text fields are ignored.
- Cartridges: click to select (it lifts and a ghost outline appears over the slot), drag toward the slot (it turns
  to align and snaps within range), or click again / **Insert**. Second cartridge and eject-while-on are refused
  with a toast; the dragged cartridge springs back. Eject after power off slides it back to the tray.
- Power switch in 3D (or **Power on**): boot screen + chime, then the cartridge's title; nothing is drawn while off.
- HUD: kicker, title, state hint (`aria-live`), cartridge card, tray chips, Sound / Reset view / Photo / Credits;
  touch pad on coarse pointers while on; Credits with a two-step Clear Data; WebGL failure screen with retry.
- Phone (390×844): card on top, tray below; while on, the tray steps out of view.
- Fix found by the E2E test: taps of the same button inside one slow frame merged into one press; they are now
  queued (max 4) and delivered one per update (unit tests added).
- E2E run history on this machine: of the last four full-suite runs, three passed 3/3; one journey run failed while
  the headless renderer stalled for minutes (its in-page log shows every action took effect — power off 1 s after
  the click). Recorded here rather than retried away. Latest run (commit after `3ec4716`): 3 passed (1.6 min).
  Unit: 61 tests pass.

### Milestone 5 — 2026-11-23

- `scripts/film.mjs`: real `page.mouse` / `page.keyboard` input on the capture-mode virtual clock; pointer + key
  overlay driven by the same DOM events; targets re-resolved every frame (the camera moves after power off);
  screenshot retry after renderer stalls (the virtual clock does not move, so a retry captures the same frame).
- Landscape: drag Starfall in, power on, play with the keyboard, pause, power off, eject, pick up Bloom.
  Portrait: drag Little Sky in, power on, play with the console's 3D D-pad, A and Select, power off, eject.
- Found while filming: on phones the page card hid the top of the console (switch, slot, seated cartridge). The
  portrait camera now has idle / holding / on framings that keep it clear. `screenOf` aims at the visible part
  of a seated cartridge.

### Milestone 6 — 2026-11-23

- Docs: README, ARCHITECTURE, GAME_DESIGN, TESTING, CASE_STUDY (+ existing SOURCE_AUDIT, ATTRIBUTION), LICENSE.
- `next build` clean. E2E 3/3 against the production build (35 s) and against the live deployment (1.1 min).
- Deployed with the Vercel CLI: https://pocket-study.vercel.app (public, no Git integration).
