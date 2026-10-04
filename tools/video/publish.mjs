#!/usr/bin/env node
/* Publishes finished renders to the website: writes web versions to media/ at the repo root, which
 * scripts/build.mjs copies into the site.
 *
 *   node publish.mjs [id ...]     (default: the videos marked site: true)
 *
 * For each video: a 1080p30 H.264 MP4 (small enough to self-host), a poster frame, and an entry in
 * media/videos.json with the title, length, recording date and a transcript taken from the .srt captions.
 * The site renders its players from videos.json, so re-recording + re-publishing updates everything.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const MEDIA = resolve(HERE, '../../media');

const VIDEOS = [
  { id: 'tour', scene: 'overview-tour', title: 'A quick tour of the map', site: true },
  { id: 'what-if', scene: 'what-if-hormuz', title: 'What if the Strait of Hormuz shut completely?', site: true },
  { id: 'daily-updates', scene: 'daily-updates', title: 'How the map stays current and sourced', site: true },
  { id: 'embedding', scene: 'embedding', title: 'Embed the live map on your site', site: true },
  { id: 'chokepoints', scene: 'chokepoints', title: 'Ship traffic through the energy chokepoints' },
  { id: 'pump-prices', scene: 'pump-prices', title: 'Pump prices since the crisis began' },
];

const ids = process.argv.slice(2);
const chosen = ids.length ? VIDEOS.filter(v => ids.includes(v.id)) : VIDEOS.filter(v => v.site);
if (ids.length && chosen.length !== ids.length) { console.error(`Unknown id. Known: ${VIDEOS.map(v => v.id).join(', ')}`); process.exit(1); }

mkdirSync(MEDIA, { recursive: true });
const indexFile = join(MEDIA, 'videos.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { videos: {} };
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
const srtText = srt => srt.split(/\r?\n\r?\n/).map(b => b.split(/\r?\n/).slice(2).join(' ').trim()).filter(Boolean);

for (const v of chosen) {
  // Prefer the 60 fps render; fall back to 30 fps
  const base = [`${v.scene}-60fps`, v.scene].find(b => existsSync(join(OUT, b + '.mp4')));
  if (!base) { console.error(`No render for ${v.id}: run  node record.mjs ${v.scene} --fps 60`); process.exit(1); }
  const src = join(OUT, base + '.mp4');
  process.stdout.write(`${v.id}: encoding ${base}.mp4… `);
  ff('-i', src, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(MEDIA, `${v.id}.mp4`));
  ff('-ss', '1', '-i', src, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', join(MEDIA, `${v.id}.jpg`)); // the title card
  const duration = Math.round(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString()));
  const srt = join(OUT, base + '.srt');
  index.videos[v.id] = {
    title: v.title,
    src: `/media/${v.id}.mp4`,
    poster: `/media/${v.id}.jpg`,
    duration,
    recorded: statSync(src).mtime.toISOString().slice(0, 10),
    transcript: existsSync(srt) ? srtText(readFileSync(srt, 'utf8')) : [],
  };
  console.log(`${(statSync(join(MEDIA, `${v.id}.mp4`)).size / 1048576).toFixed(1)} MB, ${duration}s`);
}
index.updated = new Date().toISOString().slice(0, 10);
writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${indexFile}`);
