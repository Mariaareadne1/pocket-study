# Game design

Three original cartridges, each written for a 160 × 144 screen, four face buttons and a D-pad. Every game
is split into **pure rules** (`logic.ts`: immutable state in, new state out, no clock, no randomness
except a seeded `Rng` passed in), a **view** (`view.ts`: draws state into the framebuffer) and a
**cartridge** (`index.ts`: title, menus, pause, sound, save/reset). The console runs them at a fixed
60 Hz step, so behaviour does not depend on display refresh rate, and a saved game resumes exactly.

All three share the same conventions:

| Input | Everywhere |
| --- | --- |
| Start | title → play; in play, opens the cartridge menu (pause) |
| Escape (keyboard) | pause from anywhere in play |
| B in a menu | back / resume |
| Power off | saves first, then cuts the screen |
| Window blur / tab hidden | all held inputs released, game paused |

Menus are built from one shared component (`src/games/common/menu.ts`): wraparound cursor, auto-repeat on
held directions, and a two-step confirm for destructive items (New Garden, Clear Sky).

---

## 01 · BLOOM — a tiny garden

**Goal:** grow eight flowers to full bloom.

- A 9 × 6 grid of soil plots. Tools: **seed packet** (four varieties: daisy, tulip, bell, sun),
  **watering can**, **trowel**.
- A plant moves **seed → sprout → bud → bloom**. Growth only accumulates while the plot is damp:
  5, 6 and 6 watered seconds per stage. Moisture drains fully in 14 s, so each plant needs water about
  twice. Planting on dry soil works, but nothing grows until it is watered.
- Reaching 8 blooms plays a one-time celebration (petals, chime) and the garden stays playable.
- Controls: D-pad moves, **A** uses the tool, **B** cycles tools, **Select** cycles seed variety (and picks up the seed packet),
  **Start** menu (Resume · New Garden · Help).
- Save: the whole garden (plots, moisture, growth, cursor, tool, garden time). Corrupt or old-format
  saves are detected by a validator and the game starts a fresh garden with a short notice.

Why it's shaped this way: the console has no idle loop or wall clock, so watering is the pacing. It
gives a slow, tactile game that suits a glass object you turn over in your hands.

## 02 · STARFALL — arcade

**Goal:** catch falling stars, avoid rocks, chase your best score.

- A small craft moves in the lower band of the screen (speed 74 px/s). Stars (7 px) and big stars
  (9 px) score; rocks (8 px) cost a life. Three lives; 1.4 s of blinking invulnerability after a hit.
- **A — dash:** 0.16 s burst at 236 px/s, 0.55 s cooldown.
- **B — star pulse:** for 1.6 s, nearby stars (58 px radius) are pulled in. 7 s cooldown, shown on
  the HUD.
- Catching in a row builds a streak multiplier (×1 to ×4, one step per 5 catches; letting a star fall past or being hit resets it). Stars score 10, big stars 50, times the multiplier.
- Difficulty steps every 14 catches: spawn interval 0.92 s → 0.30 s, fall speed +5 px/s per level,
  rock share 22 % → 50 %.
- Hitboxes are smaller than sprites (2 px inset) so near misses feel fair.
- Save: best score and runs played. A run in progress is not saved; pausing freezes it exactly.

## 03 · LITTLE SKY — sky maker

**Goal:** none. Compose a small sky and keep it.

- A 160 × 128 canvas with a 16-px toolbar. Themes: day, dusk, night.
- Tools: **star** (three shapes), **cloud** (two shapes, drift slowly), **moon**, **bird**, **glow**,
  and a **brush** with an eight-colour palette for painting single pixels (hold A to draw lines).
- **A** place / paint, **B** erase under the cursor, **Select** next tool, **Start** menu: Resume ·
  Undo · Sky theme · Brush colour · Save · **Export PNG** · Clear Sky · Help.
- Up to 160 elements; undo history of 40 steps.
- **Export PNG** renders the composition alone (no cursor, no toolbar) at 160 × 128 and downloads it at
  4× with hard pixel edges (`little-sky-01.png`, …). The unit tests decode the PNG and compare every pixel
  with the renderer.
- Save: theme, elements, painted pixels. Autosaves on power off.

---

## Sound

All sounds are synthesised in Web Audio (`src/runtime/sfx.ts`): no samples, no recorded audio. The
console has its own boot chime and mechanical clicks for every button (they click even when the power
is off, because the buttons are physical). Mute is remembered.

## What isn't here

No licensed characters, logos, boot screens, ROMs or sounds. The boot screen is an original mark (four
rounded tiles landing one after another) and the words POCKET STUDY typed out in the project's own
5 × 7 pixel font.
