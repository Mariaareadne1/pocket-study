# Architecture

```
 input (3D pointer · keyboard · touch pad · gamepad)
        │  every source presses/releases under its own id
        ▼
  PocketController (src/app)  ── settings, exports, focus/visibility, audio unlock
        │
        ▼
  ConsoleRuntime (src/runtime/console.ts)
   ├─ DeviceMachine (src/device)   slot · power · drag — pure, time-stepped, refuses impossible actions
   ├─ InputHub → Pad               held + press edges, per-source, auto-repeat in game time
   ├─ fixed 60 Hz loop             boot screen / game update+draw / nothing when off
   ├─ Game (src/games/*)           pure rules + view + cartridge (menus, saves, sound)
   ├─ Framebuffer 160×144 RGBA     the only thing the screen ever shows
   └─ AudioEngine (Web Audio)      synthesised SFX; offline WAV render for films
        │ reads only
        ▼
  Stage (src/engine/stage)  ── Three.js: rigs → poser → assembly → glass pipeline → canvas
        │ reads only
        ▼
  Hud (src/ui)  ── React: masthead, cartridge card, tray chips, toast, touch pad, credits
```

The runtime owns all state. The stage and the interface **read** it each frame and send intents back
through the same handful of methods (`insert`, `eject`, `togglePower`, `beginDrag`…). Nothing in the
stage decides whether an action is allowed: if the machine refuses (slot occupied, powered on,
cartridge still moving) it emits a `blocked` event with a reason, the toast shows it, and the 3D
cartridge springs back.

## Device machine

`src/device/machine.ts` is a pure state machine with explicit timings (`insert 0.9 s`, `eject 0.85 s`,
`boot 2.7 s`, `shutdown 0.5 s`):

- power: `off → booting → ready → playing ⇄ paused → shutting_down → off` (the game phase is reported
  back by the running cartridge);
- slot: `empty → inserting → inserted → ejecting → empty`;
- drag: `selected`, `dragging`, `nearSlot`.

It is advanced by `tick(dt)` only, so tests drive it with exact times and films with a virtual clock.

## Rendering

The object is drawn with the technique from Ann Nguyen's CD case (see `docs/SOURCE_AUDIT.md`),
generalised:

- **Studio.** An analytic white studio is baked once into a cube map; it lights everything and is what
  the glass reflects and refracts.
- **Rods.** Every edge, wall, lip, seam, boss, rib, rail and slot jaw of the shell is a ray-traced "rod":
  a box primitive whose fragment shader intersects the view ray with the rod's rounded profile and
  computes Fresnel reflection, refraction of the scene behind (read from a copy of the frame) and
  per-channel absorption along the path inside.
- **Sheets.** The broad front and back faces are thin refracting panels. Pocket Study adds a body-tint
  term (`uHaze`, `uTint`) to the reference sheet shader so the faces carry the shell's faint lavender;
  with `uHaze = 0` it is the reference shader unchanged.
- **Order.** Opaque parts (PCB, screen, controls, cartridges, screws) render first. Then the glass groups
  (back half, front half; ordered by which faces the camera) are each drawn into an MSAA target with the
  current frame copied beneath them — so the front shell refracts the back shell, which refracts the board.
  Depth-only proxies keep the opaque parts correctly occluded. A bright/streak/final post chain adds the
  reference's highlights and star glints.
- **Screen.** `src/engine/shaders/screen.ts` samples a `DataTexture` that shares memory with the runtime's
  framebuffer (no copy) with sharp-bilinear filtering, a pixel grid that fades with on-screen size,
  backlight from the device state, and a faint cover-glass reflection. When the device is off the
  framebuffer is cleared and the backlight is 0.
- **PCB.** A procedural two-sided board texture (traces, vias, gold pads, silkscreen) plus a metal mask,
  generated on a canvas at load (`src/engine/textures/pcb.ts`).

`assembly.ts` builds meshes and hit boxes, `poser.ts` animates rigs (button springs, D-pad rock, switch,
cartridge places: tray → selected → dragging → inserting → inserted → ejecting), and `Stage.ts` owns the
camera, pointer gestures, the render loop and capture hooks.

## Input

- **3D:** pointer on a button presses `pointer` source; dragging off it or `pointercancel` releases it.
  The D-pad reads which arm is under the thumb and rolls as the pointer moves.
- **Keyboard:** arrows; Z/J = A; X/K = B; Enter = Start; Shift = Select; Escape = pause. Each key is
  its own source (`key:ArrowLeft`…), so releasing one key never cancels the same action held elsewhere.
- **Touch pad:** DOM buttons for coarse pointers while the power is on (`touch:a`…).
- **Gamepad:** standard mapping, polled each frame.
- Window blur / tab hidden: every source is released and the game paused. Taps shorter than a frame are
  queued (max 4) and delivered one per update, so quick double taps survive slow frames.

## Saves

`src/runtime/storage.ts` wraps `localStorage` under `pocket-study:` keys. Every slot is
`{ v: version, data }`, loaded through a validator; corrupt, foreign or newer-version data comes back as
`corrupt` (the game starts fresh and says so) instead of throwing. Private mode / quota errors degrade to
"not saved". Settings (mute, last cartridge) are a separate slot. "Clear saved data…" in Credits asks for
confirmation, stops the running game without saving, and removes every slot.

## Capture mode

`?capture` makes the stage manual (no `requestAnimationFrame`), switches storage to memory, seeds the RNG
with 2026 and puts the audio engine on a virtual clock that logs every sound. `window.__pocket.advance(n)`
renders `n` frames; `soundtrack(duration, offset)` renders the logged sounds to a WAV with the same
synthesis code. The films and QA stills use this; the E2E tests do not (they run the normal loop).

## Layout

```
src/
  app/controller.ts     glue: input sources, settings, export, lifecycle
  device/machine.ts     slot / power / drag state machine
  runtime/              framebuffer, font, rng, input hub, storage, audio, sfx, boot screen, console loop
  games/                bloom/, starfall/, littlesky/ (logic · view · cartridge), common/menu.ts
  engine/               materials, shaders (studio, surfaces, screen), geometry (handheld, cartridge),
                        textures (pcb, prints, labels), stage (assembly, poser, motion, Stage)
  ui/                   Experience (WebGL check, failure UI), Hud, TouchPad, Credits
```
