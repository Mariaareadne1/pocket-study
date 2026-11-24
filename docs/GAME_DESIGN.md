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

## 04 · VINE — classic snake genre

**Goal:** grow the longest vine you can.

- A 20 × 16 grid of 8-px cells under the HUD. The vine moves one cell per tick: 0.16 s at first,
  0.005 s faster per dewdrop, down to 0.075 s. Holding **A** hurries it (twice as fast).
- The D-pad turns; a 180° reversal is ignored, and up to two quick turns are queued between ticks.
- A dewdrop grows the vine by one and scores 10. Every fifth dewdrop also opens a blossom for 6 s
  (50 points, grows two). Food never lands on the vine.
- Running into the wall or the vine ends the run (moving into the cell the tail is leaving is fine).
- Save: best score and runs played.

## 05 · GLASSHOUSE — brick breaker

**Goal:** break every coloured pane of the glasshouse roof.

- Five original roofs (SEEDLING, GABLE, COLD FRAME, LATTICE, ORANGERY), up to 10 × 7 panes of 14 × 6 px.
  Frosted panes take two hits; iron struts never break and don't count towards a clear. After the
  fifth roof they repeat, 15 % faster.
- A plank paddle (110 px/s, with a little acceleration). The pebble rests on it until **A**. The bounce
  angle follows where it hits: straight up in the middle, 60° at the ends.
- Pebble speed starts at 80 px/s, +1.6 per pane, capped at 130; it resets after a miss or a clear.
  Movement is sub-stepped (≤ 1 px) so it never passes through a pane or the paddle.
- 10 per pane, 25 per frosted pane, 100 per roof. Three lives. Save: best score and runs played.

## 06 · RALLY — paddle duel

**Goal:** first to seven points against the console.

- You're on the left (95 px/s), the console on the right. The server holds the ball until **A** (the
  console serves by itself after 0.8 s); after a point, the side that missed serves.
- Returns angle by where the ball meets the paddle (55° at the ends) plus a little spin from the
  paddle's motion. The ball starts at 70 px/s, gains 7 per return up to 150, and resets every point.
- Difficulty (Select or left/right on the title, remembered): EASY, NORMAL, HARD change the console's
  speed (52 / 60 / 74 px/s), reaction (0.32 / 0.25 / 0.17 s) and aim error (±13 / 11 / 9 px).
- Save: wins, losses and difficulty.

These three follow well-known genres. Their names, rules, numbers, art, layouts and sounds are original
to this study; they don't copy any particular commercial game.

---

## Sound

All sounds are synthesised in Web Audio (`src/runtime/sfx.ts`): no samples, no recorded audio. The
console has its own boot chime and mechanical clicks for every button (they click even when the power
is off, because the buttons are physical). Mute is remembered.

## What isn't here

No licensed characters, logos, boot screens, ROMs or sounds. The boot screen is an original mark (four
rounded tiles landing one after another) and the words POCKET STUDY typed out in the project's own
5 × 7 pixel font.
