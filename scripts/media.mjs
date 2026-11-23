// Verifies both demo films with ffprobe, then derives the poster, contact sheet, screenshots and a GIF
// from them (every still comes from a recorded film frame). usage: node scripts/media.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const run = (args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args]);
const probe = (file) =>
  JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());

const FILMS = {
  landscape: { file: 'demo/pocket-study-landscape.mp4', w: 1920, h: 1080 },
  portrait: { file: 'demo/pocket-study-portrait.mp4', w: 1080, h: 1920 },
};

const report = {};
for (const [name, f] of Object.entries(FILMS)) {
  const p = probe(f.file);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const dur = Number(p.format.duration);
  const problems = [];
  if (v?.codec_name !== 'h264') problems.push(`video codec ${v?.codec_name}`);
  if (v?.pix_fmt !== 'yuv420p') problems.push(`pix_fmt ${v?.pix_fmt}`);
  if (v?.width !== f.w || v?.height !== f.h) problems.push(`size ${v?.width}x${v?.height}`);
  if (v?.r_frame_rate !== '30/1') problems.push(`fps ${v?.r_frame_rate}`);
  if (a?.codec_name !== 'aac') problems.push('no AAC audio');
  if (dur < 15 || dur > 25) problems.push(`duration ${dur}`);
  report[name] = { width: v.width, height: v.height, codec: v.codec_name, pix_fmt: v.pix_fmt, fps: v.r_frame_rate, frames: Number(v.nb_frames), audio: a ? `${a.codec_name} ${a.sample_rate} Hz` : null, duration: Number(dur.toFixed(3)), bytes: Number(p.format.size) };
  console.log(`${name}: ${v.width}x${v.height} ${v.codec_name} ${v.pix_fmt} ${v.r_frame_rate} · ${a?.codec_name} ${a?.sample_rate}Hz · ${dur.toFixed(2)}s · ${(Number(p.format.size) / 1048576).toFixed(1)} MB${problems.length ? ' — PROBLEMS: ' + problems.join(', ') : ' ✓'}`);
  if (problems.length) process.exitCode = 1;
}
fs.writeFileSync('demo/ffprobe.json', JSON.stringify(report, null, 2) + '\n');

fs.mkdirSync('demo/screenshots', { recursive: true });
fs.mkdirSync('docs/media', { recursive: true });
const L = FILMS.landscape.file;
const P = FILMS.portrait.file;

// Poster: Starfall running on the console (landscape film).
run(['-ss', '12.6', '-i', L, '-frames:v', '1', 'demo/poster.png']);
run(['-ss', '11.0', '-i', P, '-frames:v', '1', '-vf', 'crop=1080:1290:0:410,scale=900:-1', '-q:v', '2', 'docs/media/hero.jpg']);
// Contact sheet: 12 moments of the landscape film.
run(['-i', L, '-vf', 'fps=12/22,scale=640:-1,tile=4x3:padding=8:margin=8:color=0xfbfaf7', '-frames:v', '1', 'demo/contact-sheet.png']);
// Stills of key states, from both films.
const STILLS = {
  landscape: [[0.2, 'tray'], [3.0, 'drag-to-slot'], [7.6, 'boot'], [12.6, 'starfall'], [15.4, 'paused'], [18.9, 'eject'], [21.5, 'select-bloom']],
  portrait: [[3.0, 'drag-to-slot'], [6.8, 'boot'], [11.0, 'little-sky'], [16.5, 'little-sky-cloud'], [21.0, 'ejected']],
};
for (const [film, list] of Object.entries(STILLS)) {
  for (const [t, n] of list) run(['-ss', String(t), '-i', FILMS[film].file, '-frames:v', '1', '-q:v', '3', `demo/screenshots/${film}-${n}.jpg`]);
}
// Short loop: the drag into the slot and the boot, from the portrait film.
run(['-ss', '2.0', '-t', '5.0', '-i', P, '-vf', 'fps=12,crop=1080:1350:0:150,scale=320:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', '-loop', '0', 'demo/insert-and-boot.gif']);
for (const f of ['demo/poster.png', 'demo/contact-sheet.png', 'demo/insert-and-boot.gif', 'docs/media/hero.jpg', 'demo/ffprobe.json']) {
  console.log(f, `${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
console.log('screenshots:', fs.readdirSync('demo/screenshots').length);
