#!/usr/bin/env node
/* Records a scripted walkthrough of the map as an MP4.
 *
 *   node record.mjs <scene> [--no-build] [--4k] [--fps 60] [--debug]
 *
 * Builds the site, serves dist/ locally and drives Chrome (playwright-core, system Chrome) through
 * scenes/<scene>.mjs. Rendering is frame by frame: before each screenshot the page's clock, timers and CSS
 * animations advance by exactly one frame (overlay.js) and the map's tiles finish loading, so motion is even
 * however long a frame takes to render. Screenshots are piped straight into ffmpeg. Captions, the cursor and
 * title cards are an overlay injected into the page. Writes out/<scene>.mp4 and out/<scene>.srt.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = join(ROOT, 'dist');
const OUT = join(HERE, 'out');

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const sceneName = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--fps'));
if (!sceneName) { console.error('Usage: node record.mjs <scene> [--no-build] [--4k] [--fps 60] [--debug]'); process.exit(1); }
const scene = await import(join(HERE, 'scenes', sceneName + '.mjs'));

// 1440×810 CSS px keeps the desktop layout roomy; the scale factor sets the output resolution.
const VIEW = { width: 1440, height: 810 };
const SCALE = flag('--4k') ? 8 / 3 : 4 / 3;
const OUT_W = Math.round(VIEW.width * SCALE), OUT_H = Math.round(VIEW.height * SCALE);
const FPS = Number(opt('--fps', 30));
const FRAME_MS = 1000 / FPS;
const TILE_WAIT_MS = 3000; // give up waiting on a slow tile after this long (real time)

// ── Build + static server ──
if (!flag('--no-build')) execFileSync('node', ['scripts/build.mjs'], { cwd: ROOT, stdio: 'inherit' });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// ── Browser ──
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find(p => existsSync(p));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--font-render-hinting=none'] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, reducedMotion: 'no-preference' });
await context.route(/_vercel\/insights/, r => r.abort()); // never count recordings as visits
await context.addInitScript({ path: join(HERE, 'overlay.js') });
const page = await context.newPage();
page.on('pageerror', e => console.warn('[page error]', e.message));
const cdp = await context.newCDPSession(page);

// ── Frame-by-frame capture ──
mkdirSync(OUT, { recursive: true });
const base = sceneName + (FPS !== 30 ? `-${FPS}fps` : '') + (flag('--4k') ? '-4k' : '');
const mp4 = join(OUT, base + '.mp4');
let ff = null, recording = false, frameNo = 0, slowTiles = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = () => frameNo / FPS; // seconds into the video

async function frame() {
  let st = await page.evaluate(ms => window.__vd.tick(ms), FRAME_MS);
  // Hold virtual time still until the map's tiles for this frame have arrived
  const t = Date.now();
  while (st.loading && Date.now() - t < TILE_WAIT_MS) { await sleep(20); st.loading = await page.evaluate(() => window.__vd.tilesLoading()); }
  if (st.loading) slowTiles++;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
  if (!ff.stdin.write(Buffer.from(data, 'base64'))) await once(ff.stdin, 'drain');
  frameNo++;
  if (frameNo % (FPS * 10) === 0) process.stdout.write(`  ${clock().toFixed(0)}s rendered\n`);
  return st;
}
/** Advance the video by ms (rendering frames); before recording starts, just wait in real time. */
async function render(ms) {
  if (!recording) return sleep(ms);
  for (let i = Math.round(ms / FRAME_MS); i > 0; i--) await frame();
}

// ── Scene API ──
const cues = []; // caption timings for the .srt
const box = async target => {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const b = await loc.boundingBox();
  if (!b) throw new Error(`Not visible: ${target}`);
  return b;
};
const v = {
  page, SITE,
  data: name => JSON.parse(readFileSync(join(DIST, 'data', name + '.json'), 'utf8')),
  wait: render,
  /** Show a caption (trusted HTML; escape data with esc()) and hold it long enough to read (≈15 characters a second, 3 s minimum). */
  async say(html, { hold } = {}) {
    await v.clearCaption();
    await page.evaluate(t => window.__vd.caption(t), html);
    const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    cues.push({ start: clock(), text });
    await render(hold ?? Math.max(3000, text.length / 15 * 1000));
  },
  async clearCaption() {
    if (!cues.length || cues.at(-1).end != null) return;
    await page.evaluate(() => window.__vd.caption(''));
    cues.at(-1).end = clock();
    await render(450);
  },
  async card(kind, title, sub, hold = 3500) {
    await v.clearCaption();
    await page.evaluate(([k, t, s]) => window.__vd.card(k, t, s), [kind, title, sub]);
    await render(hold);
  },
  async hideCard() { await page.evaluate(() => window.__vd.hideCard()); await render(700); },
  /** Glide the cursor to an element (or {x, y}), then click it for real. */
  async click(target, { pause = 350, move = 850, keepCaption = false } = {}) {
    if (!keepCaption) await v.clearCaption(); // a new action starts a new beat
    const b = target.x != null ? { ...target, width: 0, height: 0 } : await box(target);
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.evaluate(([x, y, ms]) => window.__vd.cursorTo(x, y, ms), [x, y, move]);
    await render(move + 50);
    await page.mouse.move(x, y);
    await render(pause);
    await page.evaluate(() => window.__vd.ripple());
    await page.mouse.click(x, y);
  },
  async cursorAway() { await page.evaluate(() => window.__vd.cursorTo(innerWidth * 0.55, innerHeight * 0.55)); },
  /** Pulse a ring around an element so viewers know where to look. */
  async highlight(selector, ms = 2500) {
    await page.evaluate(([s, ms]) => window.__vd.highlight(s, ms), [selector, ms]);
  },
  /** Eased scroll of an element inside its panel into view. */
  async scrollTo(selector, block = 'start') {
    await page.evaluate(([s, b]) => window.__vd.scrollTo(s, b, 800), [selector, block]);
    await render(900);
  },
  /** Slow, cinematic camera moves on the real Leaflet map. */
  async flyBounds(bounds, seconds = 3, padding = { paddingTopLeft: [40, 80], paddingBottomRight: [410, 40] }) {
    await v.clearCaption();
    await page.evaluate(([b, o]) => window.__vd.move('flyToBounds', [b, o]), [bounds, { ...padding, duration: seconds, easeLinearity: 0.2 }]);
    if (recording) { const limit = frameNo + (seconds + 3) * FPS; while ((await frame()).moving && frameNo < limit); }
    await render(400);
  },
  text: selector => page.locator(selector).first().innerText(),
};

if (flag('--debug')) for (const [k, fn] of Object.entries(v)) if (typeof fn === 'function' && fn.constructor.name === 'AsyncFunction') {
  v[k] = async (...a) => { const s = Date.now(), f = frameNo; const r = await fn(...a); console.log(`  ${k.padEnd(12)} ${((frameNo - f) / FPS).toFixed(2)}s video, ${((Date.now() - s) / 1000).toFixed(1)}s real  ${String(a[0]).slice(0, 50)}`); return r; };
}

// ── Run ──
console.log(`Recording "${sceneName}" at ${OUT_W}×${OUT_H}, ${FPS} fps…`);
const started = Date.now();
await page.goto(`${SITE}/?notrack=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__map && document.querySelector('#tab-scenario .sc-list'));
await page.evaluate(() => document.fonts.ready);
if (scene.setup) await scene.setup(v);

ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos,format=yuv420p`, '-r', String(FPS),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = once(ff, 'exit');
await page.evaluate(() => window.__vd.virtualize());
recording = true;
await scene.run(v);
await v.clearCaption();
ff.stdin.end();
const [code] = await ffDone;
await browser.close();
server.close();
if (code !== 0) throw new Error('ffmpeg failed');

// Captions as a sidecar .srt (YouTube accepts it as a subtitle track).
const ts = s => new Date(Math.round(s * 1000)).toISOString().slice(11, 23).replace('.', ',');
writeFileSync(join(OUT, base + '.srt'), cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end ?? clock())}\n${c.text}\n`).join('\n'));

console.log(`Wrote ${mp4} (${clock().toFixed(1)}s, ${frameNo} frames, rendered in ${((Date.now() - started) / 60000).toFixed(1)} min) and ${base}.srt`);
if (slowTiles) console.warn(`  ${slowTiles} frames were captured before all tiles had loaded`);
