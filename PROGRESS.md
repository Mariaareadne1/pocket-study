# Progress

Each milestone is tested, committed and pushed before the next one starts.

| # | Milestone | State | Evidence |
| --- | --- | --- | --- |
| 0 | Source audit, scaffold, runtime + games logic | done | `docs/SOURCE_AUDIT.md`; `npm test`: 59 unit tests pass; typecheck + lint clean |
| 1 | Transparent handheld rendering | in progress | |
| 2 | Cartridges, power, buttons, drag-to-insert | pending | |
| 3 | Screen in 3D, input wiring, games on device | pending | |
| 4 | UI, mobile, accessibility, E2E | pending | |
| 5 | Demo films + media | pending | |
| 6 | Docs, deploy, handoff | pending | |

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
