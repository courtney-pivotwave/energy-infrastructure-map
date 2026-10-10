#!/usr/bin/env node
// Weekly growth metrics for the editor agent, run by .github/workflows/metrics.yml (Mondays, before the editor).
// Writes metrics/<week-ending>.json for the last full Monday–Sunday week (UTC). Lives outside data/ on purpose:
// the build copies data/ onto the live site. Credentials stay in the workflow; agents only read the file.
//
// Sources: the repo, git and gh (always) · Bluesky public API (no key) · Google Search Console (GSC_SERVICE_ACCOUNT,
// a service-account JSON key; optional GSC_SITE) · Bing Webmaster (BING_WEBMASTER_KEY) · X (X_* posting keys, only
// when X_READS=1, because X bills reads) · Vercel Web Analytics (no API for this project: copied by hand into
// metrics/vercel.json). A source that isn't configured or fails is recorded with the reason, never fatal.
//
// Usage: node scripts/metrics.mjs [--week-ending YYYY-MM-DD] [--stdout]
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oauthHeader } from './social_post.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://strategicenergymap.org';
const BSKY_ACTOR = 'strategicenergymap.org';
const REPO = process.env.GITHUB_REPOSITORY || 'courtney-pivotwave/energy-infrastructure-map';
const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const readJson = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const sh = cmd => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const getJson = async (url, opts) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};

// Last full Monday–Sunday week before today (UTC), or the week ending on --week-ending.
export function weekWindow(now = new Date(), weekEnding = null) {
  const end = weekEnding ? Date.parse(`${weekEnding}T00:00:00Z`) : (() => {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return today - (new Date(today).getUTCDay() || 7) * DAY;
  })();
  return { start: iso(end - 6 * DAY), end: iso(end), from: end - 6 * DAY, to: end + DAY - 1 };
}

const args = process.argv.slice(2);
const week = weekWindow(new Date(), args.includes('--week-ending') ? args[args.indexOf('--week-ending') + 1] : null);
const inWeek = t => { const ms = Date.parse(t); return ms >= week.from && ms <= week.to; };
const sources = {};

// ── Site and agents: repo, git, gh ──
function site() {
  const ev = readJson('data/events.json').events;
  const sitemap = join(ROOT, 'dist/sitemap.xml');
  return {
    pages_in_sitemap: existsSync(sitemap) ? (readFileSync(sitemap, 'utf8').match(/<loc>/g) || []).length : null,
    events_total: ev.length,
    events_dated_this_week: ev.filter(e => inWeek(`${e.date}T12:00:00Z`)).length,
    changelog_entries_this_week: readJson('data/changelog.json').entries.filter(e => e.date && inWeek(`${e.date}T12:00:00Z`)).length,
  };
}

function agents() {
  const out = {};
  const range = `--since="${week.start}T00:00:00Z" --until="${week.end}T23:59:59Z"`;
  const days = sh(`git log ${range} --grep="^data: update" --format=%cs`).split('\n').filter(Boolean);
  out.daily_update_days = [...new Set(days)].sort();
  out.daily_update_runs = `${out.daily_update_days.length}/7`;
  out.other_commits = sh(`git log ${range} --no-merges --format="%cs %s"`).split('\n').filter(l => l && !/ (data: update|social: update post log|metrics: )/.test(l));
  try {
    const prs = JSON.parse(sh(`gh pr list --repo ${REPO} --state all --limit 50 --json number,title,headRefName,createdAt,mergedAt,closedAt,url`));
    const now = Date.now();
    out.prs_open = prs.filter(p => !p.closedAt).map(p => ({ number: p.number, title: p.title, branch: p.headRefName, opened: p.createdAt.slice(0, 10), waiting_days: Math.floor((now - Date.parse(p.createdAt)) / DAY), url: p.url }))
      .sort((a, b) => b.waiting_days - a.waiting_days);
    out.prs_closed_this_week = prs.filter(p => p.closedAt && inWeek(p.closedAt)).map(p => ({ number: p.number, title: p.title, merged: !!p.mergedAt, hours_open: Math.round((Date.parse(p.closedAt) - Date.parse(p.createdAt)) / 36e5) }));
  } catch (e) { out.prs_error = String(e.stderr || e.message).slice(0, 200); }
  try { sh('node scripts/validate.mjs'); out.validator = 'pass'; } catch (e) { out.validator = `fail: ${String(e.stdout || e.message).slice(0, 300)}`; }
  return out;
}

// ── Social: drafts, what posted when, engagement ──
function socialPosts() {
  const drafts = readJson('data/social.json').posts;
  const log = readJson('data/social-log.json').posted;
  const byId = Object.fromEntries(drafts.map(p => [p.id, p]));
  const drafted = {};
  drafts.filter(p => inWeek(`${p.created}T12:00:00Z`)).forEach(p => { drafted[p.type] = (drafted[p.type] || 0) + 1; });
  const posts = Object.entries(log).filter(([, pl]) => Object.values(pl).some(e => e.at && inWeek(e.at))).map(([id, pl]) => {
    const p = byId[id] || {};
    const first = Object.values(pl).map(e => e.at).filter(Boolean).sort()[0];
    return {
      id, type: p.type || null, created: p.created || null, url: p.url || null, tags: p.tags || [],
      // What the post carried: chart, daily-board or asset-card (recorded by social_post.mjs when it posts), else no-image
      media: pl.x?.media || pl.bluesky?.media || (p.image && p.image !== 'none' ? 'chart' : 'no-image'),
      days_after_draft: p.created ? Math.round((Date.parse(first.slice(0, 10)) - Date.parse(p.created)) / DAY) : null,
      x: pl.x?.id ? { id: pl.x.id, posted_at: pl.x.at } : null,
      bluesky: pl.bluesky?.uri ? { uri: pl.bluesky.uri, posted_at: pl.bluesky.at } : null,
    };
  });
  const failed = Object.entries(log).flatMap(([id, pl]) => Object.entries(pl).filter(([, e]) => !e.id && !e.uri && e.error && inWeek(e.last_try || 0)).map(([platform, e]) => ({ id, platform, attempts: e.attempts, error: e.error.slice(0, 160) })));
  return { drafted_by_type: drafted, posted: posts.length, posted_same_day: posts.filter(p => p.days_after_draft === 0).length, posts, failed };
}

function byType(posts, platform, fields, key = 'type') {
  const out = {};
  for (const p of posts) {
    const m = p[platform]?.metrics;
    if (!m) continue;
    const t = (out[p[key] || 'unknown'] ||= { posts: 0, ...Object.fromEntries(fields.map(f => [f, 0])) });
    t.posts++;
    for (const f of fields) t[f] += m[f] || 0;
  }
  return out;
}

async function bluesky(social) {
  const profile = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${BSKY_ACTOR}`);
  const withUri = social.posts.filter(p => p.bluesky);
  for (let i = 0; i < withUri.length; i += 25) {
    const qs = withUri.slice(i, i + 25).map(p => `uris=${encodeURIComponent(p.bluesky.uri)}`).join('&');
    const { posts } = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${qs}`);
    for (const bp of posts) {
      const p = withUri.find(x => x.bluesky.uri === bp.uri);
      if (p) p.bluesky.metrics = { likes: bp.likeCount || 0, reposts: bp.repostCount || 0, replies: bp.replyCount || 0, quotes: bp.quoteCount || 0 };
    }
  }
  const fields = ['likes', 'reposts', 'replies', 'quotes'];
  const totals = Object.fromEntries(fields.map(f => [f, withUri.reduce((s, p) => s + (p.bluesky.metrics?.[f] || 0), 0)]));
  return { followers: profile.followersCount, following: profile.followsCount, posts_all_time: profile.postsCount, interactions: fields.reduce((s, f) => s + totals[f], 0), ...totals, by_type: byType(social.posts, 'bluesky', fields), by_media: byType(social.posts, 'bluesky', fields, 'media') };
}

async function x(social) {
  if (process.env.X_READS !== '1') { sources.x = 'off: set repository variable X_READS=1 to collect (X bills API reads)'; return null; }
  const creds = process.env.X_API_KEY && process.env.X_ACCESS_TOKEN ? { key: process.env.X_API_KEY, secret: process.env.X_API_SECRET, token: process.env.X_ACCESS_TOKEN, tokenSecret: process.env.X_ACCESS_SECRET } : null;
  if (!creds) { sources.x = 'not configured: X_* secrets missing'; return null; }
  const get = (url, params) => getJson(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: oauthHeader('GET', url, params, creds) } });
  const me = await get('https://api.x.com/2/users/me', { 'user.fields': 'public_metrics' });
  const withId = social.posts.filter(p => p.x);
  if (withId.length) {
    const url = 'https://api.x.com/2/tweets';
    const ids = withId.map(p => p.x.id).join(',');
    // Impressions and link clicks (non-public metrics) only exist for our own posts under 30 days old.
    const j = await get(url, { ids, 'tweet.fields': 'public_metrics,non_public_metrics' }).catch(() => get(url, { ids, 'tweet.fields': 'public_metrics' }));
    for (const t of j.data || []) {
      const p = withId.find(q => q.x.id === t.id);
      const pub = t.public_metrics || {}, priv = t.non_public_metrics || {};
      if (p) p.x.metrics = { impressions: priv.impression_count ?? pub.impression_count ?? null, link_clicks: priv.url_link_clicks ?? null, likes: pub.like_count || 0, reposts: pub.retweet_count || 0, replies: pub.reply_count || 0, quotes: pub.quote_count || 0 };
    }
  }
  const fields = ['impressions', 'link_clicks', 'likes', 'reposts', 'replies', 'quotes'];
  const totals = Object.fromEntries(fields.map(f => [f, withId.reduce((s, p) => s + (p.x.metrics?.[f] || 0), 0)]));
  sources.x = 'ok';
  return { followers: me.data?.public_metrics?.followers_count ?? null, ...totals, by_type: byType(social.posts, 'x', fields), by_media: byType(social.posts, 'x', fields, 'media') };
}

// ── Search: Google Search Console and Bing Webmaster ──
async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const j = await getJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  return j.access_token;
}

async function google() {
  if (!process.env.GSC_SERVICE_ACCOUNT) { sources.google = 'not configured: add the GSC_SERVICE_ACCOUNT secret'; return null; }
  const token = await googleToken(JSON.parse(process.env.GSC_SERVICE_ACCOUNT));
  const auth = { Authorization: `Bearer ${token}` };
  const { siteEntry = [] } = await getJson('https://www.googleapis.com/webmasters/v3/sites', { headers: auth });
  const site = process.env.GSC_SITE || ['sc-domain:strategicenergymap.org', `${SITE}/`].find(s => siteEntry.some(e => e.siteUrl === s));
  if (!site) { sources.google = `no access: add the service account as a user on the Search Console property (it sees: ${siteEntry.map(e => e.siteUrl).join(', ') || 'nothing'})`; return null; }
  // Search data lags 2–3 days, so use the latest 7 complete days rather than the calendar week.
  const end = iso(Date.now() - 3 * DAY), start = iso(Date.now() - 9 * DAY);
  const query = (dimensions, rowLimit) => getJson(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit }) });
  const row = r => ({ clicks: r.clicks, impressions: r.impressions, ctr: +r.ctr.toFixed(4), position: +r.position.toFixed(1) });
  const [total, queries, pages] = await Promise.all([query([], 1), query(['query'], 50), query(['page'], 50)]);
  sources.google = 'ok';
  return {
    property: site, range: { start, end },
    totals: total.rows?.[0] ? row(total.rows[0]) : { clicks: 0, impressions: 0, ctr: 0, position: null },
    top_queries: (queries.rows || []).map(r => ({ query: r.keys[0], ...row(r) })),
    top_pages: (pages.rows || []).map(r => ({ page: r.keys[0].replace(SITE, ''), ...row(r) })),
  };
}

async function bing() {
  const key = process.env.BING_WEBMASTER_KEY;
  if (!key) { sources.bing = 'not configured: add the BING_WEBMASTER_KEY secret'; return null; }
  const call = async method => {
    const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${method}?siteUrl=${encodeURIComponent(`${SITE}/`)}&apikey=${key}`);
    if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`); // never echo the URL: it carries the key
    return ((await r.json()).d || []).map(row => ({ ...row, Date: +(String(row.Date).match(/-?\d+/) || [NaN])[0] }));
  };
  // Bing groups query and page stats into its own periods; keep rows dated in the 14 days to the week's end.
  const recent = rows => rows.filter(r => r.Date > week.to - 14 * DAY && r.Date <= week.to);
  const top = (rows, label) => Object.values(recent(rows).reduce((acc, r) => {
    const k = r.Query; acc[k] ||= { [label]: label === 'page' ? k.replace(SITE, '') : k, clicks: 0, impressions: 0 };
    acc[k].clicks += r.Clicks || 0; acc[k].impressions += r.Impressions || 0; return acc;
  }, {})).sort((a, b) => b.impressions - a.impressions).slice(0, 50);
  const [traffic, queries, pages] = await Promise.all(['GetRankAndTrafficStats', 'GetQueryStats', 'GetPageStats'].map(call));
  const daily = traffic.filter(r => r.Date >= week.from && r.Date <= week.to);
  sources.bing = 'ok';
  return {
    range: { start: week.start, end: week.end },
    totals: { clicks: daily.reduce((s, r) => s + (r.Clicks || 0), 0), impressions: daily.reduce((s, r) => s + (r.Impressions || 0), 0) },
    top_queries: top(queries, 'query'), top_pages: top(pages, 'page'),
    note: 'query and page rows are Bing\'s own periods dated within the 14 days to the week\'s end',
  };
}

// ── Traffic: Vercel Web Analytics, copied by hand ──
function vercel() {
  const f = join(ROOT, 'metrics/vercel.json');
  if (!existsSync(f)) { sources.vercel = 'manual: metrics/vercel.json missing'; return null; }
  const v = JSON.parse(readFileSync(f, 'utf8'));
  const current = v.week_ending === week.end;
  sources.vercel = current ? 'manual: entered for this week' : `manual: last entered for the week ending ${v.week_ending || 'never'}`;
  return { ...v, current };
}

// ── Run ──
const attempt = async (name, fn) => { try { const r = await fn(); sources[name] ||= 'ok'; return r; } catch (e) { sources[name] = `failed: ${String(e.message).slice(0, 200)}`; return null; } };
const social = socialPosts();
const out = {
  week: { start: week.start, end: week.end },
  generated: new Date().toISOString(),
  sources,
  site: await attempt('repo', site),
  agents: await attempt('github', agents),
  social: { ...social, bluesky: await attempt('bluesky', () => bluesky(social)), x: await attempt('x', () => x(social)) },
  search: { google: await attempt('google', google), bing: await attempt('bing', bing) },
  traffic: { vercel: vercel() },
};

const json = JSON.stringify(out, null, 1) + '\n';
if (args.includes('--stdout')) process.stdout.write(json);
else {
  mkdirSync(join(ROOT, 'metrics'), { recursive: true });
  writeFileSync(join(ROOT, `metrics/${week.end}.json`), json);
  console.log(`Wrote metrics/${week.end}.json (${week.start} to ${week.end})`);
  for (const [k, v] of Object.entries(sources)) console.log(`  ${k}: ${v}`);
}
