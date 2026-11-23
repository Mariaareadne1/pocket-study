# Testing

| Layer | Command | What it covers |
| --- | --- | --- |
| Types | `npm run typecheck` | strict TypeScript over `src`, `tests` |
| Lint | `npm run lint` | ESLint (Next config) over `src`, `tests`, `scripts` |
| Unit | `npm test` | 61 Vitest tests in Node, no browser |
| End-to-end | `npm run test:e2e` | 3 Playwright tests in GPU Chrome (Metal on macOS) |
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

## End-to-end (`tests/e2e/journey.spec.ts`)

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

### Results

| Target | Result |
| --- | --- |
| dev server (`localhost:5580`) | 3 passed (1.6 min) |
| production build (`localhost:4580`) | 3 passed (35 s) |
| live (`https://pocket-study.vercel.app`) | 3 passed (1.1 min) |

**Honest note on flakiness.** On this machine the headless renderer occasionally stalls for seconds to
minutes (input events and screenshots wait; the page's own clock keeps running). It caused one failing
journey run out of the last four on the dev server; the failure dump showed every action had taken effect.
The test waits on device state rather than fixed times, re-checks the cursor after each key, and dumps an
in-page event log on failure (pointer events and device transitions with timestamps) to tell a stall from a
bug. Two real bugs were found this way and fixed: merged quick taps, and the 3D target for a seated
cartridge.

## Visual QA

`node scripts/shoot.mjs [base] [outDir] --w=1440 --h=900 --shots=hero,side,back,top,selected,inserted,boot,bloom,starfall,littlesky`
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
