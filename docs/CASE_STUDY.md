# Case study — Pocket Study

**Object Study / 002.** A clear, faintly lavender handheld console you can pick up, turn over, load
with a cartridge and play. The second in a series that began with Cassette Study: take one everyday
object, render it so you can see how it's made, and make it actually work.

## The brief

Build an original handheld — not a replica of any real console — as a photoreal transparent object in a
white studio, using Ann Nguyen's CD case glass as the rendering foundation; give it three original games
that run on its own screen; make every interaction physical (drag a cartridge into the slot, flick the
power switch, press the buttons) with an accessible equivalent for each; and record the demo films from
the real app with real input.

## Decisions

**Clear plastic is mostly edges.** In a clear-shell handheld you read the object through its walls,
seams, bosses and ribs — the broad faces nearly disappear. So the shell is dozens of ray-traced rods
(each an exact rounded profile with refraction and absorption), and the faces are thin sheets. The board,
chips, screws and battery are opaque and do the work of making the transparency legible.

**Lavender, faintly.** The reference shader only darkens what's behind the glass, which reads as grey.
Raising per-channel absorption colours the thick edges; a small body-tint term on the sheets carries the
colour across the faces without fogging the board. The buttons are a deeper lavender so the colour has
an anchor.

**The machine decides, the stage obeys.** A pure state machine owns the slot, power and drag. The 3D
stage proposes ("the cartridge was dropped near the slot") and the machine accepts or refuses with a
reason. That's what makes the rules consistent across 3D, keyboard, buttons and tests: you can't insert
a second cartridge or eject while it's on, whichever way you try, and the message is the same.

**One framebuffer.** Games draw into a 160 × 144 RGBA buffer; the screen shader samples it directly,
the boot screen writes to it, and "off" clears it. There is no second path that could show something on
a powered-off screen. The fixed 60 Hz step and seeded RNG make games reproducible in tests and films.

**Inputs don't fight.** Every source holds actions under its own id. Letting go of the 3D A button
doesn't release the Z key you're still holding; blur releases everything. Quick taps that land between
frames are queued rather than merged — the E2E test found that one on a slow frame.

**Games that suit the object.** A watering game (slow, tactile), an arcade catcher (quick, scored) and a
sky maker (no goal, exports a PNG). Each fits a small screen and four buttons, each saves, and none
borrows anyone's characters or marks.

## Process

Seven milestones, each tested and pushed before the next (see `PROGRESS.md`): source audit and runtime;
the transparent handheld; cartridges, power and drag; the screen and input; UI, mobile and accessibility;
films; docs and deploy. Visual QA ran through a headless Metal Chrome script (`scripts/shoot.mjs`) at each
step; the films use the same app in capture mode with real pointer and keyboard events.

## Credits

Glass rendering adapted from Ann Nguyen's CD case (made with TypingMind). Seeded RNG adapted from
retro-pocket-games (MIT). Everything else — geometry, textures, games, sounds, the 5 × 7 pixel font,
interface — is original to this project. See `ATTRIBUTION.md`.
