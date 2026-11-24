# Testing

| Layer | Command | What it covers |
| --- | --- | --- |
| Types | `npm run typecheck` | strict TypeScript over `src`, `tests` |
| Lint | `npm run lint` | ESLint (Next config) over `src`, `tests`, `scripts` |
| Unit | `npm test` | 112 Vitest tests in Node, no browser |
| End-to-end | `npm run test:e2e` | 6 Playwright tests in GPU Chrome (Metal on macOS) |
| Visual QA | `node scripts/shoot.mjs` | stills of states/angles in headless Chrome, plus `stage.debug()` dumps |
| Films | `node scripts/film.mjs` + `node scripts/media.mjs` | demo films + ffprobe verification |

## Unit tests (`tests/unit`)

The runtime, device and games are plain TypeScript with no DOM, so they're tested directly:

- **machine** (14): slot/power/drag transitions with exact timings; second cartridge refused; eject and
  cartridge changes refused while on; drag release near/far; boot reports the seated cartridge.
- **input** (11): press/release per direction; keyboard and 3D button don't release each other; sub-frame
  taps are seen; several taps between polls are each delivered (max 4 queued); hold = one edge;
  pointer/touch cancel releases only that source; `releaseAll`; `flush`; auto-repeat in game time.
- **console** (7): off draws nothing; empty-slot screen; insert → boot → play → off; eject blocked while on;
  blur releases inputs and pauses; switching cartridges saves; clearing saves.
- **bloom** (13), **starfall** (9), **littlesky** (7): each game's rules (planting, watering, growth,
  completion once; movement, collision, lives, dash, hitboxes; placing, painting, undo), immutability,
  save → reload round trips, corrupt saves, pause freezing time, and Little Sky's PNG export — decoded with
  `pngjs` and compared pixel-for-pixel with the renderer at 160 × 128.
- **vine** (17), **glasshouse** (14), **rally** (15): movement and timing, turn queueing, collisions,
  sub-stepped ball physics (no tunnelling at top speed with a large step), scoring, lives and match end,
  the console's difficulty levels (a corner shot EASY misses and HARD returns), food never on the vine,
  level loops, determinism from a seed, immutability, saves and corrupt saves, pause freezing.
- **recording** (5): recorder format choice (mp4 preferred, webm fallback), file names, durations.
- **text-fit** (8): the console font is proportional, so every string each game draws is recorded while
  seeded random button presses drive the game through title, play, menus, help pages, confirmations and
  game over (4 seeds × 90 s per game). Every string must stay on the 160 × 144 screen, and text drawn
  after a panel that starts inside it must end inside it. Also boot/no-cartridge screens and pixel-width
  wrapping. This caught Starfall's "+50" pop-up running off the left edge.
- **keys** (5): the keyboard map (A/Z/J/Space → A, B/X/K → B, Enter → Start, Shift → Select), turning
  each cartridge's controls into key-guide rows, Escape folded into the pause row, the one-line hint.

## Demo options (`tests/e2e/demo-options.spec.ts`)

1. **One cartridge** — `/?only=vine` leaves one chip on the tray and one cartridge in frame (the other five
   project outside the viewport); choosing "All cartridges" in the real `<select>` brings all six back and
   drops `only` from the URL; "Only Rally" updates the URL, the card shows Rally, and **Insert** inserts it
   with no selection.
2. **No cartridges** — choosing it empties the tray list, moves all six out of frame, titles the card
   "The console" and centres the screen within 40 px of the middle; `?only=none` survives a reload and the
   console still powers on with nothing inserted.
3. **Bad value** — `/?only=nope` falls back to all six.
4. **Key guide** — hidden while off; after Power on it lists ← ↑ ↓ →, A Z Space, Enter Esc for
   Glasshouse; Enter starts the game, the hint reads "Arrows move · A launch · Enter/Esc pause", Escape
   pauses; the **Keys** pill hides the guide and the choice survives a reload.

## End-to-end journey (`tests/e2e/journey.spec.ts`)

Every action is a real browser input event (`page.mouse`, `page.keyboard`, DOM button clicks). The page's
`window.__pocket` hook is only read, to assert state.

1. **Full journey** — click Bloom in 3D, drag it into the slot (real pointer drag); dragging Starfall
   in too is refused with a toast; flick the 3D power switch → boot → title; **Eject** is refused while on;
   Enter starts, ArrowRight moves, Z plants; the 3D D-pad moves the cursor; Escape pauses, Z resumes; mute
   toggles; power off in 3D (screen goes black) and eject; click-to-insert Little Sky with the tray chip,
   **Insert** and **Power on**; place a star; export a PNG through the game menu (a real download,
   `little-sky-01.png`, 160 × 128); saves and the mute setting survive a reload; **Clear saved data…** asks
   first, then removes every save. Fails on any page error.
2. **Blur** — while holding ArrowLeft in Starfall, a window blur releases every input and pauses.
3. **WebGL failure** — with WebGL disabled the page shows the failure message; **Try again** recovers once
   it's available.

## Record demo (`tests/e2e/record.spec.ts`)

Runs in full Chromium (the lightweight headless shell has no screen capture) with
`--auto-accept-this-tab-capture`, so the "share this tab" prompt is accepted without a person.

1. **Tab recording** — Bloom is inserted and switched on with real clicks, then a real click on **Record
   demo** and the countdown; the whole control, the heading, the view/sound buttons, the cartridge card,
   the tray and the key guide are hidden for the take and come back after it, and the mouse is drawn as a
   pointer (tab capture leaves the system cursor out). **R** stops. The downloaded file is checked with
   ffprobe (more than 2 s), then frames sampled at 4 fps are scanned for the button's red dot where the
   button sits: 0 pixels (the same detector finds it in a screenshot taken before recording, as a
   control), and for the pointer's dark arrow where the test parked the mouse: found.
2. **Canvas recording** (`?rec=canvas`, the fallback for browsers without screen capture) — the Stop
   button stays on screen and is absent from the film; the pointer is drawn into the film.
3. **Cancel** — a person refusing the share prompt (after 1.5 s) shows "Recording cancelled." and the
   button works again.
4. **Blocked** — a refusal with no prompt (the Claude app's built-in browser refuses tab capture in about
   150 ms) switches to recording the 3D scene: Stop appears, a playable file downloads, and the next take
   goes straight to the scene without asking for the tab again. Checked by hand in that browser too: a
   26 s mp4 with the console visibly switching on.

While writing these, every film came out about 1 s long: this Mac's audio output had stalled (the Web
Audio clock reported "running" but moved 0.006 s in 1.5 s), so the soundtrack carried no samples and the
recorder waited on it. The recorder now watches the audio clock for 0.3 s in the last second of the
countdown and, if it isn't moving, records without sound and says so (unit-tested in `tests/unit/recording.test.ts`). The video size
is also fixed for the whole take (an mp4 stops if it changes), and the console's adaptive resolution holds
still while recording.

A manual tab recording at 1280 × 720 came out as H.264 + AAC (`.mp4`), with Rally being played and no
Record control in any frame.

### Results

| Target | Result |
| --- | --- |
| live (`https://pocket-study.vercel.app`), 2026-11-24 deploy | 10 passed (1.1 min) |
| production build (`localhost:4580`), plus the No cartridges option | 10 passed (1.1 min) |
| dev server (`localhost:5580`), plus the No cartridges option | 10 passed (1.3 min) |
| dev server (`localhost:5580`), new font + key guide + one-cartridge mode | 9 passed (1.2 min) |
| production build (`localhost:4580`), new font + key guide + one-cartridge mode | 9 passed (1.0 min) |
| dev server (`localhost:5580`), with six cartridges and Record demo | 6 passed (56 s) |
| dev server (`localhost:5580`), original three tests | 3 passed (1.6 min) |
| production build (`localhost:4580`), six cartridges + Record demo | 6 passed (48 s) |
| production build (`localhost:4580`), original three tests | 3 passed (35 s) |
| live (`https://pocket-study.vercel.app`) | 3 passed (1.1 min) |

**Honest note on flakiness.** On this machine the headless renderer occasionally stalls for seconds to
minutes (input events and screenshots wait; the page's own clock keeps running). It caused one failing
journey run out of the last four on the dev server; the failure dump showed every action had taken effect.
The test waits on device state rather than fixed times, re-checks the cursor after each key, and dumps an
in-page event log on failure (pointer events and device transitions with timestamps) to tell a stall from a
bug. Two real bugs were found this way and fixed: merged quick taps, and the 3D target for a seated
cartridge.

## Visual QA

`node scripts/shoot.mjs [base] [outDir] --w=1440 --h=900 --shots=hero,side,back,top,selected,inserted,boot,bloom,starfall,littlesky,vine,glasshouse,rally`
renders each state on the real app in capture mode and prints `stage.debug()` + `runtime.inspect()`.
Checked at 1440 × 900, 1280 × 720, 540 × 960 and 390 × 844.

## Films

`scripts/film.mjs` records with real `page.mouse`/`page.keyboard` events on a virtual clock (`?capture`);
a small overlay shows the pointer and pressed keys and is driven by the same DOM events. `scripts/media.mjs`
checks both films with ffprobe (H.264, yuv420p, 30 fps, AAC, 15–25 s, exact sizes) and writes
`demo/ffprobe.json`:

| Film | Size | Codec | Frames | Audio | Duration |
| --- | --- | --- | --- | --- | --- |
| `demo/pocket-study-landscape.mp4` | 1920 × 1080 | h264 yuv420p 30/1 | 660 | AAC 48 kHz | 22.00 s |
| `demo/pocket-study-portrait.mp4` | 1080 × 1920 | h264 yuv420p 30/1 | 660 | AAC 48 kHz | 22.00 s |

The soundtrack is rendered offline from the app's own logged sound events with the same synthesis code —
it is not a recording of speakers.
