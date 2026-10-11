#!/usr/bin/env node
/* Cuts short clips for social posts out of finished renders, and writes them to media/social/ at the repo root.
 *
 *   node clip.mjs [id ...]        (default: every clip below)
 *   OUT=/path/to/renders node clip.mjs      (renders live in tools/video/out by default)
 *
 * For each clip: a 720p30 H.264 MP4 with a silent audio track (what X and Bluesky accept), ending on a card with
 * the site address and the recording date; a poster frame; and an entry in media/social/clips.json with its
 * length and an alt text taken from the captions in that stretch of the video.
 *
 * Committing media/social/ is the review step: scripts/social_post.mjs only posts clips listed in clips.json, and
 * scripts/validate.mjs refuses a post that names any other. Each clip adds about 2–4 MB to the repo.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || join(HERE, 'out');
const MEDIA = resolve(HERE, '../../media');
const SOCIAL = join(MEDIA, 'social');
const W = 1280, H = 720, FPS = 30, END_CARD = 2.6; // seconds the closing card stays up

// from/to are seconds in the render; cut on caption boundaries (see the .srt next to it).
// evergreen: nothing in the clip goes stale (a how-to). Otherwise the validator wants it re-recorded after 30 days.
// url: the page a post about this clip should link to (Bluesky shows it; X posts carry no link).
const SITE = 'https://strategicenergymap.org';
const CLIPS = [
  { id: 'what-if-hormuz', scene: 'what-if-hormuz', video: 'what-if', from: 29.2, to: 77.5, title: 'What if the Strait of Hormuz shut completely?', url: `${SITE}/` },
  { id: 'map-tour', scene: 'overview-tour', video: 'tour', from: 43.2, to: 83.2, title: 'A quick tour of the map', url: `${SITE}/?tour=1` },
  { id: 'embed-the-map', scene: 'embedding', video: 'embedding', from: 5.0, to: 40.6, title: 'Embed the live map on your site', url: `${SITE}/about.html#embed`, evergreen: true },
  { id: 'how-its-sourced', scene: 'daily-updates', video: 'daily-updates', from: 27.0, to: 55.8, title: 'How every claim on the map is sourced', url: `${SITE}/about.html`, evergreen: true },
  { id: 'dashboard', scene: 'dashboard', video: 'dashboard', from: 5.0, to: 50.5, title: 'The 2026 energy crisis in numbers', url: `${SITE}/dashboard/` },
];

const ids = process.argv.slice(2);
const chosen = ids.length ? CLIPS.filter(c => ids.includes(c.id)) : CLIPS;
if (ids.length && chosen.length !== ids.length) { console.error(`Unknown id. Known: ${CLIPS.map(c => c.id).join(', ')}`); process.exit(1); }

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();
const srtTime = t => { const [h, m, s] = t.replace(',', '.').split(':').map(Number); return h * 3600 + m * 60 + s; };
const captions = file => readFileSync(file, 'utf8').split(/\r?\n\r?\n/).map(b => b.split(/\r?\n/)).filter(l => l.length >= 3)
  .map(l => { const [a, b] = l[1].split(' --> '); return { from: srtTime(a), to: srtTime(b), text: l.slice(2).join(' ').trim() }; });
const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const chrome = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync) || 'google-chrome';

// The closing card, drawn by Chrome: X posts carry no link, so the address has to be in the video
function endCard(file, recorded) {
  const html = `<!DOCTYPE html><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box; } body { width:${W}px; height:${H}px; background:#120f1c; color:#fefeff; font-family:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif; display:grid; place-content:center; justify-items:center; gap:22px; }
  .b { display:flex; align-items:center; gap:18px; font-size:34px; font-weight:700; } h1 { font-size:64px; font-weight:700; letter-spacing:-.02em; }
  p { font-size:26px; color:#d7d3e1; } small { font-size:19px; color:#b0adbb; margin-top:18px; }
</style><div class="b"><svg viewBox="0 0 32 32" width="56" height="56"><rect width="32" height="32" rx="7" fill="#2e2940"/><path d="M5 22 C11 12, 17 24, 27 10" fill="none" stroke="#3b8fd9" stroke-width="3" stroke-linecap="round"/><polygon points="16,6 22,17 10,17" fill="#e0493a"/></svg>Strategic Energy Map</div>
<h1>strategicenergymap.org</h1><p>Free and ad-free. Updated daily, with a source behind every claim.</p><small>Recorded ${fmtDate(recorded)}</small>`;
  const dir = mkdtempSync(join(tmpdir(), 'endcard-')), page = join(dir, 'card.html');
  writeFileSync(page, html);
  spawnSync(chrome, ['--headless=new', `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, `--screenshot=${file}`, `file://${page}`], { stdio: 'ignore', timeout: 60000 });
  rmSync(dir, { recursive: true, force: true });
  if (!existsSync(file)) { console.error('Could not draw the closing card: is Google Chrome installed? (set CHROME to its path)'); process.exit(1); }
}

mkdirSync(SOCIAL, { recursive: true });
const indexFile = join(SOCIAL, 'clips.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { clips: {} };
const published = existsSync(join(MEDIA, 'videos.json')) ? JSON.parse(readFileSync(join(MEDIA, 'videos.json'), 'utf8')).videos : {};
const work = mkdtempSync(join(tmpdir(), 'clips-'));

for (const c of chosen) {
  // Prefer the 60 fps render; fall back to 30 fps
  const base = [`${c.scene}-60fps`, c.scene].find(b => existsSync(join(OUT, b + '.mp4')));
  if (!base) { console.error(`No render for ${c.id} in ${OUT}: run  node record.mjs ${c.scene} --fps 60`); process.exit(1); }
  const src = join(OUT, base + '.mp4'), srt = join(OUT, base + '.srt');
  // The date the footage shows: the published video's, when this render is the one that was published
  const recorded = published[c.video]?.recorded || statSync(src).mtime.toISOString().slice(0, 10);
  const len = c.to - c.from, card = join(work, `${c.id}.png`), mp4 = join(SOCIAL, `${c.id}.mp4`);
  process.stdout.write(`${c.id}: ${len.toFixed(1)}s of ${base}.mp4… `);
  endCard(card, recorded);
  ff('-ss', String(c.from), '-t', String(len), '-i', src, '-loop', '1', '-t', String(END_CARD), '-i', card, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', `[0:v]scale=${W}:${H},fps=${FPS},setsar=1,fade=t=in:d=0.25,fade=t=out:st=${(len - 0.3).toFixed(2)}:d=0.3[a];[1:v]scale=${W}:${H},fps=${FPS},setsar=1,fade=t=in:d=0.3[b];[a][b]concat=n=2:v=1:a=0,scale=out_range=tv,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-shortest', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-g', String(FPS * 2), '-flags', '+cgop', // X: 4:2:0 only, no open GOP
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', mp4);
  ff('-ss', String(len * 0.4), '-i', mp4, '-frames:v', '1', '-q:v', '4', join(SOCIAL, `${c.id}.jpg`));
  const said = existsSync(srt) ? captions(srt).filter(x => x.from >= c.from - 0.5 && x.to <= c.to + 0.5).map(x => x.text) : [];
  index.clips[c.id] = {
    title: c.title,
    src: `media/social/${c.id}.mp4`,
    poster: `media/social/${c.id}.jpg`,
    duration: Math.round(Number(probe(mp4, 'format=duration')) * 10) / 10,
    width: W, height: H,
    from_video: c.video,
    url: c.url,
    recorded,
    evergreen: !!c.evergreen,
    // Read out by screen readers on Bluesky: what the captions in this stretch say
    alt: `Screen recording of the site with captions: ${said.join(' ')} Ends on a card with the address strategicenergymap.org.`.slice(0, 1000),
  };
  console.log(`${(statSync(mp4).size / 1048576).toFixed(1)} MB, ${index.clips[c.id].duration}s`);
}
rmSync(work, { recursive: true, force: true });
index.updated = new Date().toISOString().slice(0, 10);
writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote ${indexFile}`);
