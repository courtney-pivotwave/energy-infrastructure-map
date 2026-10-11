#!/usr/bin/env node
// Posts queued items from data/social.json to X and Bluesky, and records results in data/social-log.json.
// Runs in GitHub Actions (.github/workflows/social.yml) with credentials from repository secrets.
// The research agent only drafts posts; it never sees these credentials.
//
// Usage: node scripts/social_post.mjs [--dry-run]
//   Env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET, BSKY_HANDLE, BSKY_APP_PASSWORD,
//        DRY_RUN=1, LOCAL_SITE (e.g. http://localhost:8765, serving dist/ — needed for images), CHROME,
//        PREVIEW_DIR (dry runs save each rendered image there, to check cards before they go out)
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = join(ROOT, 'data/social.json');
const LOG = join(ROOT, 'data/social-log.json');
const FRESH_HOURS = 48;       // never post a draft older than this (stale news)
const MAX_ATTEMPTS = 3;       // per platform, then give up on that post

// ── OAuth 1.0a (X) ──
const pct = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export function oauthHeader(method, url, params, creds, { nonce = crypto.randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000).toString() } = {}) {
  const oauth = { oauth_consumer_key: creds.key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp, oauth_token: creds.token, oauth_version: '1.0' };
  const all = { ...params, ...oauth };
  const paramStr = Object.keys(all).map(k => [pct(k), pct(all[k])]).sort(([a, x], [b, y]) => a === b ? (x < y ? -1 : 1) : (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join('&');
  oauth.oauth_signature = crypto.createHmac('sha1', `${pct(creds.secret)}&${pct(creds.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

// ── Bluesky rich-text link facet (byte offsets in UTF-8) ──
export function linkFacet(text, url) {
  const i = text.lastIndexOf(url);
  if (i < 0) return [];
  const byteStart = Buffer.byteLength(text.slice(0, i), 'utf8');
  return [{ index: { byteStart, byteEnd: byteStart + Buffer.byteLength(url, 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }];
}

// ── Post text: body + hashtags (X: first 2, Bluesky: up to 3) + optional link. Shared with validate.mjs ──
export const TAG_LIMIT = { x: 2, bluesky: 3 };
export function composeText(p, platform, withLink = true) {
  const tags = (p.tags || []).slice(0, TAG_LIMIT[platform]).map(t => `#${t}`).join(' ');
  return [p.text + (tags ? ` ${tags}` : ''), withLink ? p.url : null].filter(Boolean).join('\n\n');
}
export function tagFacets(text) { // Bluesky: make #tags clickable
  const out = [], re = /(^|\s)#([A-Za-z][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const byteStart = Buffer.byteLength(text.slice(0, m.index + m[1].length), 'utf8');
    out.push({ index: { byteStart, byteEnd: byteStart + Buffer.byteLength(`#${m[2]}`, 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return out;
}

// ── Which image a post carries: its own `image` (a chart), or the data card for its type — the daily board for
// digests, the asset fact card for explainers. `"image": "none"` opts a post out. Shared with validate.mjs ──
export const CHART_IMAGES = ['fuel-weekly', 'chokepoints-weekly', 'chokepoint-oil-flows', 'hormuz-bypass'];
export function cardFor(p) {
  if (p.image === 'none') return null;
  if (p.image) return p.image;
  if (p.type === 'digest') return 'daily-board';
  const m = p.type === 'explainer' && (p.url || '').match(/\/(?:chokepoints|facilities)\/([a-z0-9-]+)\/$/);
  return m ? `asset/${m[1]}` : null;
}
// What the weekly metrics compare: chart, daily-board, asset-card
export const cardFamily = key => !key ? null : CHART_IMAGES.includes(key) ? 'chart' : key.startsWith('asset/') ? 'asset-card' : key;

// ── Images: headless Chrome screenshot of dist/social/<key>.html (charts and cards, built by scripts/build.mjs) ──
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const paths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return paths.find(existsSync) || 'google-chrome';
}
export async function renderImage(key) {
  const site = process.env.LOCAL_SITE;
  if (!site) { console.log(`  (no LOCAL_SITE; posting without the ${key} image)`); return null; }
  // A missing page would otherwise be screenshotted as the server's 404 text and posted
  if (!(await fetch(`${site}/social/${key}.html`).then(r => r.ok, () => false))) { console.log(`  image ${key}: no such card, posting without it`); return null; }
  const out = join(tmpdir(), `social-${key.replace(/\W+/g, '-')}-${Date.now()}.png`);
  const profile = mkdtempSync(join(tmpdir(), 'chrome-'));
  const chrome = spawn(findChrome(), ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--hide-scrollbars',
    '--window-size=1200,675', '--virtual-time-budget=6000', `--screenshot=${out}`, `${site}/social/${key}.html`], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(existsSync(out) && readFileSync(out).length > 1000); i++) await new Promise(r => setTimeout(r, 500));
  chrome.kill('SIGKILL'); chrome.unref(); // Chrome can ignore SIGTERM in headless mode
  await new Promise(r => setTimeout(r, 300));
  rmSync(profile, { recursive: true, force: true });
  if (!existsSync(out)) { console.log(`  image ${key}: render failed, posting without it`); return null; }
  console.log(`  rendered ${key} → ${out}`);
  return readFileSync(out);
}

// ── X ──
let xLinkTypes = new Set(['announcement', 'digest', 'correction']);
async function postX(p, img, alt, replyToId, creds) {
  let mediaId = null;
  if (img) {
    try {
      const url = 'https://api.x.com/2/media/upload';
      const form = new FormData();
      form.append('media', new Blob([img], { type: 'image/png' }), 'chart.png');
      form.append('media_category', 'tweet_image');
      const r = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url, {}, creds) }, body: form });
      const j = await r.json().catch(() => ({}));
      mediaId = j?.data?.id || j?.media_id_string || null;
      if (!mediaId) console.log(`  X media upload failed (${r.status}); posting text only`);
      else if (alt) {
        const meta = 'https://api.x.com/2/media/metadata';
        await fetch(meta, { method: 'POST', headers: { Authorization: oauthHeader('POST', meta, {}, creds), 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: alt.slice(0, 1000) } } }) }).catch(() => {});
      }
    } catch (e) { console.log(`  X media upload error: ${e.message}; posting text only`); }
  }
  const url = 'https://api.x.com/2/tweets';
  // X charges more for posts with links; only some post types carry one there (data/social.json → x_links)
  const body = { text: composeText(p, 'x', xLinkTypes.has(p.type)) };
  if (mediaId) body.media = { media_ids: [mediaId] };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url, {}, creds), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.id) throw new Error(`X ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { id: j.data.id };
}

// ── Bluesky ──
const BSKY = 'https://bsky.social/xrpc';
let bskySession = null;
async function bsky(method, body, { raw = null, type = 'application/json' } = {}) {
  const r = await fetch(`${BSKY}/${method}`, { method: 'POST', headers: { 'Content-Type': raw ? type : 'application/json', ...(bskySession ? { Authorization: `Bearer ${bskySession.accessJwt}` } : {}) }, body: raw || JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bluesky ${method} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
async function pageCard(url) { // title/description for the link card, from the page itself
  try {
    const html = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).text();
    const get = re => (html.match(re) || [])[1] || '';
    const dec = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { title: dec(get(/<title>([^<]*)<\/title>/)).slice(0, 300), description: dec(get(/<meta name="description" content="([^"]*)"/)).slice(0, 1000) };
  } catch { return { title: 'Strategic Energy Map', description: '' }; }
}
async function postBluesky(p, img, alt, replyRef, creds) {
  if (!bskySession) bskySession = await bsky('com.atproto.server.createSession', { identifier: creds.handle, password: creds.password });
  const text = composeText(p, 'bluesky', true);
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), langs: ['en'], facets: [...tagFacets(text), ...linkFacet(text, p.url)] };
  if (img) {
    const { blob } = await bsky('com.atproto.repo.uploadBlob', null, { raw: img, type: 'image/png' });
    record.embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: alt || '', aspectRatio: { width: 1200, height: 675 } }] };
  } else {
    const card = await pageCard(p.url);
    const external = { uri: p.url, title: card.title, description: card.description };
    try {
      const thumb = await (await fetch('https://strategicenergymap.org/og.png')).arrayBuffer();
      external.thumb = (await bsky('com.atproto.repo.uploadBlob', null, { raw: Buffer.from(thumb), type: 'image/png' })).blob;
    } catch { /* card without thumbnail */ }
    record.embed = { $type: 'app.bsky.embed.external', external };
  }
  if (replyRef) record.reply = { root: replyRef.root || { uri: replyRef.uri, cid: replyRef.cid }, parent: { uri: replyRef.uri, cid: replyRef.cid } };
  const j = await bsky('com.atproto.repo.createRecord', { repo: bskySession.did, collection: 'app.bsky.feed.post', record });
  return { uri: j.uri, cid: j.cid, root: record.reply?.root || { uri: j.uri, cid: j.cid } };
}

// ── Login check: confirms each configured account's credentials without posting ──
async function checkLogins(creds) {
  let failed = false;
  if (creds.x) {
    const url = 'https://api.x.com/2/users/me';
    const r = await fetch(url, { headers: { Authorization: oauthHeader('GET', url, {}, creds.x) } });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.data?.username) console.log(`X: signed in as @${j.data.username} ✓`);
    else { failed = true; console.log(`X: login failed (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 300)}`); }
  } else console.log('X: not configured (missing X_* secrets)');
  if (creds.bluesky) {
    try { const s = await bsky('com.atproto.server.createSession', { identifier: creds.bluesky.handle, password: creds.bluesky.password }); console.log(`Bluesky: signed in as @${s.handle} ✓`); }
    catch (e) { failed = true; console.log(`Bluesky: login failed: ${e.message}`); }
  } else console.log('Bluesky: not configured (missing BSKY_* secrets)');
  if (failed) process.exitCode = 1;
}

// ── Main ──
async function main() {
  const queue = JSON.parse(readFileSync(QUEUE, 'utf8'));
  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : { posted: {} };
  const dry = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1' || queue.dry_run === true;
  if (!queue.enabled) { console.log('Social posting is paused (data/social.json → enabled: false).'); return; }

  const creds = {
    x: process.env.X_API_KEY && process.env.X_ACCESS_TOKEN ? { key: process.env.X_API_KEY, secret: process.env.X_API_SECRET, token: process.env.X_ACCESS_TOKEN, tokenSecret: process.env.X_ACCESS_SECRET } : null,
    bluesky: process.env.BSKY_HANDLE && process.env.BSKY_APP_PASSWORD ? { handle: process.env.BSKY_HANDLE, password: process.env.BSKY_APP_PASSWORD } : null,
  };
  if (process.argv.includes('--check') || process.env.CHECK === '1') return checkLogins(creds);
  if (Array.isArray(queue.x_links)) xLinkTypes = new Set(queue.x_links);
  const platforms = ['x', 'bluesky'];
  const today = new Date().toISOString().slice(0, 10);
  const postedToday = () => Object.values(log.posted).filter(e => platforms.some(pl => (e[pl]?.at || '').startsWith(today))).length;
  const fresh = p => (Date.now() - Date.parse(p.created + 'T00:00:00Z')) / 36e5 < FRESH_HOURS;
  const done = (p, pl) => !!(log.posted[p.id]?.[pl]?.id || log.posted[p.id]?.[pl]?.uri);
  const images = {};
  let cardAlts;
  // Drip: start at most max_per_run new posts per run, so the queue spreads across the day's scheduled runs.
  // Corrections and posts already out on one platform don't count; they go straight away.
  const perRun = queue.max_per_run || Infinity;
  let startedThisRun = 0;
  // Spacing: runs are hourly (GitHub drops some scheduled runs), so a new post waits until min_gap_minutes after the
  // last one on any platform. A dropped run just means the next hourly run posts it.
  const gapMs = (queue.min_gap_minutes || 0) * 6e4;
  // Posting hours: runs triggered by a push (the agent, a manual edit) can fire at any time; new posts wait for these UTC hours.
  const [h0, h1] = queue.post_hours_utc || [0, 24];
  const inHours = (h => h >= h0 && h < h1)(new Date().getUTCHours());
  const lastPostAt = () => Math.max(0, ...Object.values(log.posted).flatMap(e => platforms.map(pl => Date.parse(e[pl]?.at || 0) || 0)));

  console.log(`${dry ? 'DRY RUN — ' : ''}queue: ${queue.posts.length} post(s); X ${creds.x ? 'configured' : 'not configured'}; Bluesky ${creds.bluesky ? 'configured' : 'not configured'}; posted today: ${postedToday()}/${queue.max_per_day}`);
  for (const p of queue.posts) {
    if (!fresh(p)) continue;
    if (p.not_before && Date.parse(p.not_before) > Date.now()) { console.log(`Holding ${p.id} until ${p.not_before}`); continue; }
    const todo = platforms.filter(pl => !done(p, pl) && (log.posted[p.id]?.[pl]?.attempts || 0) < MAX_ATTEMPTS && (dry || creds[pl]));
    if (!todo.length) continue;
    const isNewPost = !platforms.some(pl => done(p, pl));
    if (isNewPost && postedToday() >= queue.max_per_day) { console.log(`Daily limit reached; holding ${p.id}`); break; }
    if (isNewPost && p.type !== 'correction') {
      if (!dry && !inHours) { console.log(`Holding ${p.id}: outside posting hours (${h0}:00–${h1}:00 UTC)`); continue; }
      if (startedThisRun >= perRun) { console.log(`Holding ${p.id} for the next scheduled run (max_per_run ${perRun})`); continue; }
      const wait = lastPostAt() + gapMs - Date.now();
      if (!dry && wait > 0) { console.log(`Holding ${p.id}: last post was under ${queue.min_gap_minutes} min ago (${Math.ceil(wait / 6e4)} min to go)`); continue; }
      startedThisRun++;
    }
    const key = cardFor(p);
    if (key && !(key in images)) images[key] = await renderImage(key);
    const img = key ? images[key] : null;
    // Charts carry the draft's alt text; cards describe themselves (cards.json is written with them by the build)
    if (img && !p.alt && cardAlts === undefined) cardAlts = await fetch(`${process.env.LOCAL_SITE}/social/cards.json`).then(r => r.json()).catch(() => ({}));
    const alt = img ? (p.alt || cardAlts?.[key]?.alt || '') : '';
    if (img && dry && process.env.PREVIEW_DIR) { mkdirSync(process.env.PREVIEW_DIR, { recursive: true }); writeFileSync(join(process.env.PREVIEW_DIR, `${p.id}.png`), img); }
    const parent = p.reply_to ? log.posted[p.reply_to] : null;
    const indent = t => t.replace(/\n/g, '\n     ');
    console.log(`\n→ ${p.id} [${p.type}]${img ? ` +image ${key}` : ''}${p.reply_to ? ` (reply to ${p.reply_to})` : ''}\n  X:   ${indent(composeText(p, 'x', xLinkTypes.has(p.type)))}\n  Bsky: ${indent(composeText(p, 'bluesky', true))}`);
    if (dry) { console.log(`  would post to: ${todo.join(', ')}`); continue; }
    log.posted[p.id] ||= {};
    for (const pl of todo) {
      const prev = log.posted[p.id][pl] || {};
      try {
        const res = pl === 'x' ? await postX(p, img, alt, parent?.x?.id, creds.x) : await postBluesky(p, img, alt, parent?.bluesky, creds.bluesky);
        log.posted[p.id][pl] = { ...res, at: new Date().toISOString(), ...(img ? { media: cardFamily(key) } : {}) };
        console.log(`  ✓ ${pl}: ${res.id || res.uri}`);
      } catch (e) {
        log.posted[p.id][pl] = { attempts: (prev.attempts || 0) + 1, error: String(e.message).slice(0, 300), last_try: new Date().toISOString() };
        console.log(`  ✗ ${pl}: ${e.message}`);
        if (log.posted[p.id][pl].attempts >= MAX_ATTEMPTS) { console.log(`  giving up on ${pl} after ${MAX_ATTEMPTS} attempts`); process.exitCode = 1; } // red run → GitHub emails the owner
      }
    }
  }
  if (!dry) writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then(() => process.exit(process.exitCode ?? 0), e => { console.error(e); process.exit(1); });
