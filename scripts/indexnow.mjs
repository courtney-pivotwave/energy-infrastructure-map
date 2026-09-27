#!/usr/bin/env node
// Tells Bing (and other IndexNow engines; Bing's index also feeds ChatGPT search and Copilot) which pages changed.
// Run AFTER a deploy is live. Usage: node scripts/indexnow.mjs [--all]
//   default: pages whose sitemap <lastmod> is today (UTC) or yesterday; --all: every page in the sitemap.
const SITE = 'https://strategicenergymap.org';
const KEY = '5f3c9a1e7b2d48c6a0e4f81b9d27c653'; // must match INDEXNOW_KEY in scripts/build.mjs (served at /<key>.txt)
const all = process.argv.includes('--all');
const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
const recent = new Set([0, 1].map(d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)));
const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)]
  .filter(([, , lastmod]) => all || (lastmod && recent.has(lastmod))).map(m => m[1]);
if (!urls.length) { console.log('IndexNow: nothing changed recently.'); process.exit(0); }
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: 'strategicenergymap.org', key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls.slice(0, 10000) }),
});
console.log(`IndexNow: submitted ${urls.length} URL(s) → HTTP ${r.status}`);
process.exit(r.ok || r.status === 202 ? 0 : 1);
