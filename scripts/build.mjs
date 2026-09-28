#!/usr/bin/env node
// Static site build: copies the map and generates crawlable answer pages from data/*.json into dist/.
// Runs on every Vercel deploy (vercel.json → buildCommand). No dependencies.
// Usage: node scripts/build.mjs        (then serve dist/: python3 -m http.server 8765 -d dist)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://strategicenergymap.org';
const LINKEDIN = 'https://www.linkedin.com/in/courtneyhwilson/';
const PORTWATCH = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const BASELINE = { from: '2025-09-01', to: '2026-02-27', label: 'Sep 2025–Feb 2026 average' };
const INDEXNOW_KEY = '5f3c9a1e7b2d48c6a0e4f81b9d27c653';

const read = f => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const infra = read('infrastructure.json');
const statusData = read('status.json');
const eventsData = read('events.json');
const market = read('market.json');
const scenarios = read('scenarios.json');
const fuel = read('fuel.json');
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const CSS = (indexHtml.match(/styles\.css\?v=\d+/) || ['styles.css'])[0];

// ── Helpers ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);
const fmtDate = d => d ? new Date(d.length === 7 ? d + '-01T00:00:00Z' : d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const fmtMonth = d => new Date(d + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const n = (v, dp = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(dp);
const pct = (a, b) => (a != null && b) ? (a - b) / b * 100 : null;
const signed = (p, dp = 0) => p == null ? '—' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(dp)}%`;
const firstSentences = (t, k = 2) => (String(t || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [t]).slice(0, k).join('').trim();
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
const events = (eventsData.events || []).slice().sort((a, b) => b.date.localeCompare(a.date));
const statusOf = id => statusData.assets?.[id] || null;
const eventsFor = id => events.filter(e => e.assets?.includes(id));
const TODAY = new Date().toISOString().slice(0, 10);

const STATUS_LABEL = { closed: 'Closed', damaged: 'Damaged', offline: 'Offline', disrupted: 'Disrupted', reduced: 'Reduced' };
const STATUS_COLOR = { closed: '#b3261e', damaged: '#d63031', offline: '#6c7a89', disrupted: '#e67e22', reduced: '#b8860b' };
const SITE_KIND = { production: 'Production site', refinery: 'Refinery', hub: 'Port / transit hub', lng: 'LNG terminal' };

// Registry of facilities (pipelines, sites, fields) and chokepoints
const REG = {};
infra.pipelines.forEach(p => { REG[p.id] = { ...p, type: 'facility', tag: p.commodity === 'gas' ? 'Gas pipeline' : 'Oil pipeline', center: p.coords[Math.floor(p.coords.length / 2)] }; });
infra.sites.forEach(s => { REG[s.id] = { ...s, type: 'facility', tag: SITE_KIND[s.kind] || 'Site', center: s.coords }; });
infra.fields.forEach(f => { REG[f.id] = { ...f, type: 'facility', tag: f.commodity === 'oil' ? 'Oil field' : 'Gas field', center: f.coords }; });
infra.chokepoints.forEach(c => { REG[c.id] = { ...c, type: 'chokepoint', tag: 'Chokepoint', center: c.coords }; });

const facilityIds = [...infra.pipelines, ...infra.sites, ...infra.fields].map(a => a.id);
// A facility gets its own page only with enough substance: geopolitical context, or a substantial description plus
// a live status or linked events. Thinner facilities are listed on the /facilities/ hub (no thin pages).
const hasPage = id => REG[id]?.type === 'chokepoint' || (REG[id]?.type === 'facility' &&
  (REG[id].geo || ((statusOf(id) || eventsFor(id).length) && String(REG[id].details || '').length >= 250)));
const urlFor = id => REG[id]?.type === 'chokepoint' ? `/chokepoints/${id}/` : hasPage(id) ? `/facilities/${id}/` : `/facilities/#${id}`;
const link = id => REG[id] ? `<a href="${urlFor(id)}">${esc(REG[id].name)}</a>` : esc(id);

function sourcesHTML(sources, label = 'Sources') {
  const seen = new Set();
  const list = (sources || []).filter(s => s && !seen.has(s.url) && seen.add(s.url));
  if (!list.length) return '';
  return `<div class="sources"><b>${label}:</b> ${list.map(s => { const u = safeUrl(s.url); return u ? `<a href="${esc(u)}" rel="noopener" target="_blank">${esc(s.name)}</a>` : esc(s.name); }).join(' · ')}</div>`;
}
const statusChip = st => st ? `<span class="pill" style="background:${STATUS_COLOR[st.status] || '#777'}">${esc(STATUS_LABEL[st.status] || st.status)}</span>` : '';
const confChip = c => c ? `<span class="conf ${esc(c)}">${esc(c)}</span>` : '';
function eventItem(e, withAssets = true) {
  return `<article class="ev" id="${esc(e.id)}"><div class="ev-meta">${esc(fmtDate(e.date))} · ${esc(e.category)} ${confChip(e.confidence)}</div>
    <h3 class="ev-h">${esc(e.title)}</h3><p>${esc(e.summary)}</p>
    ${withAssets && e.assets?.length ? `<p class="note">Related: ${e.assets.filter(a => REG[a]).map(link).join(', ')}</p>` : ''}
    ${sourcesHTML(e.sources)}</article>`;
}
function spark(series, { w = 640, h = 90, ref = null, refLabel = '', color = '#b3261e', series2 = null, color2 = '#1a6bb5' } = {}) {
  if (!series || series.length < 2) return '';
  const all = [...series, ...(series2 || [])].map(p => p[1]).concat(ref != null ? [ref] : []);
  const min = Math.min(...all) * 0.95, max = Math.max(...all) * 1.05 || 1;
  const x = i => i / (series.length - 1) * w, y = v => h - (v - min) / (max - min) * h;
  const path = s => s.map((p, i) => `${i ? 'L' : 'M'}${x(i * (series.length - 1) / (s.length - 1)).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
    ${ref != null ? `<line x1="0" x2="${w}" y1="${y(ref)}" y2="${y(ref)}" stroke="#8a94a6" stroke-dasharray="4 4"/>` : ''}
    ${series2 ? `<path d="${path(series2)}" fill="none" stroke="${color2}" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${path(series)}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>
    <figcaption><span>${esc(fmtDate(series[0][0]))}</span>${refLabel ? `<span>${esc(refLabel)}</span>` : ''}<span>${esc(fmtDate(series[series.length - 1][0]))}</span></figcaption></figure>`;
}
function haversine(a, b) {
  const r = d => d * Math.PI / 180, dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ── Page shell ──
const pages = []; // for sitemap
function layout({ path, title, description, crumbs = [], body, jsonld = [], lastmod = null, type = 'article' }) {
  const url = SITE + path;
  const crumbLd = crumbs.length ? [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', url: SITE + '/' }, ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url.startsWith('http') ? c.url : SITE + c.url })) }] : [];
  const ld = [...crumbLd, ...jsonld].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  pages.push({ path, lastmod });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Strategic Energy Infrastructure Map">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
${lastmod ? `<meta property="article:modified_time" content="${lastmod}">` : ''}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="Energy infrastructure events" href="/events.xml">
<link rel="stylesheet" href="/${CSS}">
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>
${ld}
</head>
<body class="doc">
<header class="site-nav"><a class="brand" href="/">Strategic Energy Map</a>
<nav aria-label="Site"><a href="/">Live map</a><a href="/chokepoints/">Chokepoints</a><a href="/fuel-prices/">Pump prices</a><a href="/facilities/">Facilities</a><a href="/events/">Events</a><a href="/about.html">About</a></nav></header>
<main class="doc-wrap">
${crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${crumbs.map((c, i) => i < crumbs.length - 1 ? ` › <a href="${c.url}">${esc(c.name)}</a>` : ` › <span>${esc(c.name)}</span>`).join('')}</nav>` : ''}
${body}
</main>
<footer class="doc-wrap doc-foot">${lastmod ? `Last updated ${esc(fmtDate(lastmod))}. ` : ''}Every figure links its source. Parties to the conflicts are treated alike: claims that can't be independently verified are labelled, and ship traffic comes only from independent trackers. <a href="/about.html#rule">Sourcing rule</a> · <a href="/about.html">About &amp; methods</a> · Built by <a href="${LINKEDIN}" rel="noopener" target="_blank">Courtney Wilson</a></footer>
</body>
</html>
`;
}
function write(path, html) {
  const file = join(DIST, path.endsWith('/') ? path + 'index.html' : path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
const faqLd = qa => ({ '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const faqHTML = qa => `<section class="faq"><h2>Common questions</h2>${qa.map(([q, a]) => `<details open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>`;
const placeLd = (name, coords, description) => ({ '@context': 'https://schema.org', '@type': 'Place', name, description,
  geo: { '@type': 'GeoCoordinates', latitude: coords[0], longitude: coords[1] } });

// ── Live ship traffic (IMF PortWatch), fetched at build time; the build never fails on it ──
async function portwatch(name) {
  const params = new URLSearchParams({ where: `portname='${name.replace(/'/g, "''")}' AND date >= DATE '${BASELINE.from}'`,
    outFields: 'date,n_tanker,n_total', orderByFields: 'date', returnGeometry: 'false', resultRecordCount: '2000', f: 'json' });
  try {
    const r = await fetch(`${PORTWATCH}?${params}`, { signal: AbortSignal.timeout(20000) });
    const rows = ((await r.json()).features || []).map(f => f.attributes).map(a => ({ date: String(a.date).slice(0, 10), t: a.n_tanker, all: a.n_total }));
    if (rows.length < 14) return null;
    const avg = (arr, k) => arr.reduce((s, x) => s + x[k], 0) / (arr.length || 1);
    const base = rows.filter(x => x.date >= BASELINE.from && x.date <= BASELINE.to);
    const last7 = rows.slice(-7);
    const roll = rows.map((x, i) => [x.date, avg(rows.slice(Math.max(0, i - 6), i + 1), 't')]);
    return { lastDate: rows[rows.length - 1].date, now: avg(last7, 't'), nowAll: avg(last7, 'all'), base: avg(base, 't'), roll };
  } catch (e) { console.warn(`PortWatch unavailable for ${name}: ${e.message}`); return null; }
}

// ── What-if for a single chokepoint (mirrors app.js scenarioResult) ──
function closure(id) {
  const c = scenarios.chokepoints?.[id]; if (!c) return null;
  const stranded = c.reroute === 'none' ? c.oil_mbd : 0;
  const usable = [], impaired = [];
  (c.bypass || []).forEach(b => {
    const down = [b.asset, b.outlet].filter(Boolean).map(a => [a, statusOf(a)]).find(([, st]) => st && ['offline', 'damaged', 'closed'].includes(st.status));
    if (down) impaired.push({ ...b, down }); else if (b.spare_mbd) usable.push(b);
  });
  const bypass = usable.reduce((s, b) => s + b.spare_mbd, 0);
  const shortfall = Math.max(0, stranded - bypass);
  return { c, stranded, bypass, usable, impaired, shortfall, pctDemand: shortfall / (scenarios.globals?.world_oil_demand_mbd || 104) * 100 };
}

// ═════════ Build ═════════
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
for (const f of ['about.html', 'styles.css', 'app.js', 'favicon.svg', 'og.png']) cpSync(join(ROOT, f), join(DIST, f));
cpSync(join(ROOT, 'data'), join(DIST, 'data'), { recursive: true, filter: s => !s.includes(`${'data'}/research`) });
writeFileSync(join(DIST, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
// Local only: the link-preview card template (tools/ is excluded from Vercel uploads via .vercelignore)
if (existsSync(join(ROOT, 'tools/og-card.html'))) cpSync(join(ROOT, 'tools/og-card.html'), join(DIST, 'tools/og-card.html'));

const pw = {};
await Promise.all(Object.entries(scenarios.chokepoints || {}).filter(([, c]) => c.portwatch).map(async ([id, c]) => { pw[id] = await portwatch(c.portwatch); }));

// ── Chokepoint pages ──
function chokepointAnswer(c, st, live) {
  const d = fmtDate(st?.updated || statusData.updated);
  let a;
  if (!st) a = `Yes. As of ${d}, this map records no disruption to commercial traffic through the ${c.name}.`;
  else if (st.status === 'closed') a = `No. As of ${d}, the ${c.name} is effectively closed to normal commercial traffic${st.since ? ` (since ${fmtDate(st.since)})` : ''}.`;
  else if (st.status === 'disrupted') a = `Only partly. As of ${d}, shipping through the ${c.name} is disrupted${st.since ? ` (since ${fmtDate(st.since)})` : ''}.`;
  else a = `Yes, but with reduced traffic. As of ${d}, flows through the ${c.name} are below normal.`;
  if (live) {
    const p = pct(live.now, live.base);
    a += ` IMF PortWatch satellite tracking recorded an average of ${n(live.now)} tankers a day in the week to ${fmtDate(live.lastDate)}, ${Math.abs(p).toFixed(0)}% ${p < 0 ? 'below' : 'above'} the ${BASELINE.label} of ${n(live.base)}.`;
    if (st && ['closed', 'disrupted'].includes(st.status)) a += ' Some ships sail with transponders off, so tracked counts may understate traffic.';
  }
  return a;
}
const chokeIds = infra.chokepoints.map(c => c.id);
for (const c of infra.chokepoints) {
  const st = statusOf(c.id), sc = scenarios.chokepoints?.[c.id], live = pw[c.id], evs = eventsFor(c.id), cl = closure(c.id);
  const answer = chokepointAnswer(c, st, live);
  const qa = [[`Is the ${c.name} open?`, answer]];
  if (sc) {
    qa.push([`How much oil passes through the ${c.name}?`, `About ${sc.oil_mbd} million barrels a day of crude and oil products before the 2026 crisis${sc.lng_share_pct ? `, plus around ${sc.lng_share_pct}% of global LNG trade` : ''}. Baseline: ${sc.sources?.[0]?.name || 'published tanker-tracking data'}.`]);
    const alt = sc.reroute === 'none'
      ? `There is no sea route around it. ${cl.usable.length ? `Pipelines can bypass about ${n(cl.bypass)} mb/d (${cl.usable.map(b => REG[b.asset]?.name).join(', ')}), leaving roughly ${n(cl.shortfall)} mb/d with no alternative route.` : 'No usable pipeline bypass is available.'}`
      : `Ships can sail around it (${sc.reroute === 'cape' ? 'via the Cape of Good Hope' : 'via the Lombok or Sunda straits'}), adding about ${sc.reroute_days} days per voyage, so flows are delayed rather than lost.${cl.usable.length ? ` Pipelines add about ${n(cl.bypass)} mb/d of bypass capacity.` : ''}`;
    qa.push([`What are the alternatives if the ${c.name} closes?`, alt]);
    if (sc.exposed?.length) qa.push([`Which countries are most exposed to the ${c.name}?`, sc.exposed.map(x => `${x.country}: ${x.note}`).join(' ')]);
  }
  const lastmod = [st?.updated, evs[0]?.date].filter(Boolean).sort().pop() || statusData.updated;
  const body = `
<p class="kicker">Chokepoint ${statusChip(st)}</p>
<h1>${esc(c.name)}: status, ship traffic and energy flows</h1>
<div class="answer"><p class="q">Is the ${esc(c.name)} open?</p><p>${esc(answer)}</p>
<p class="note">Updated ${esc(fmtDate(lastmod))} · <a href="/?focus=${c.id}">View on the live map →</a></p></div>
${st ? `<section><h2>Current situation</h2><p>${esc(st.summary)}</p>${sourcesHTML(st.sources)}</section>` : ''}
${live ? `<section><h2>Ship traffic</h2>
<table class="fact-table"><tr><th>Tankers per day, last 7 days</th><td>${n(live.now)}</td></tr><tr><th>${BASELINE.label}</th><td>${n(live.base)}</td></tr><tr><th>Change</th><td>${signed(pct(live.now, live.base))}</td></tr><tr><th>All vessels per day, last 7 days</th><td>${n(live.nowAll, 0)}</td></tr></table>
${spark(live.roll, { ref: live.base, refLabel: `dashed: ${BASELINE.label}`, color: '#1a6bb5' })}
<p class="note">7-day average of daily tanker transits from <a href="https://portwatch.imf.org/" rel="noopener" target="_blank">IMF PortWatch</a> (satellite AIS data, about a week's lag), through ${esc(fmtDate(live.lastDate))}.</p></section>` : ''}
${sc ? `<section><h2>Key figures</h2><table class="fact-table">
<tr><th>Oil flow before the crisis</th><td>${sc.oil_mbd} million barrels a day</td></tr>
${sc.lng_share_pct ? `<tr><th>Share of global LNG trade</th><td>~${sc.lng_share_pct}%</td></tr>` : ''}
<tr><th>Sea route around it</th><td>${sc.reroute === 'none' ? 'None' : sc.reroute === 'cape' ? `Cape of Good Hope, +${sc.reroute_days} days` : `Indonesian straits, +${sc.reroute_days} days`}</td></tr>
${(sc.bypass || []).map(b => `<tr><th>Bypass: ${link(b.asset)}</th><td>${b.spare_mbd ? `~${b.spare_mbd} mb/d spare` : 'not counted'}</td></tr>`).join('')}
</table>${sc.bypass_note ? `<p class="note">${esc(sc.bypass_note)}</p>` : ''}</section>
<section><h2>What if the ${esc(c.name)} closes?</h2>
<p>${cl.stranded ? `Closing it would cut about <b>${n(cl.stranded)} mb/d</b> of oil with no sea route around it. Usable pipeline bypass capacity of ~${n(cl.bypass)} mb/d leaves a net shortfall of about <b>${n(cl.shortfall)} mb/d</b>, roughly ${n(cl.pctDemand)}% of world oil demand.` : `Ships could divert, adding about ${sc.reroute_days} days per voyage for ~${n(sc.oil_mbd)} mb/d of oil. That ties up tankers and raises freight and insurance costs, but supply is delayed rather than lost.`}
${cl.impaired.length ? ` Not counted: ${cl.impaired.map(b => `${link(b.asset)} (${esc(REG[b.down[0]]?.name)} is ${esc(STATUS_LABEL[b.down[1].status]?.toLowerCase())})`).join(', ')}.` : ''}</p>
${sc.exposed?.length ? `<h3>Most exposed</h3><ul>${sc.exposed.map(x => `<li><b>${esc(x.country)}</b>: ${esc(x.note)}</li>`).join('')}</ul>` : ''}
${sc.stranded?.length ? `<p>Facilities cut off: ${sc.stranded.filter(id => REG[id]).map(link).join(', ')}.</p>` : ''}
<p class="note">Illustrative model using pre-crisis baselines; see <a href="/about.html#whatif">how the what-if model works</a>. Try combinations in the <a href="/">live map's What-if tab</a>.</p>
${sourcesHTML(sc.sources, 'Baseline sources')}</section>` : ''}
${evs.length ? `<section><h2>Recent developments</h2>${evs.slice(0, 12).map(e => eventItem(e, false)).join('')}${evs.length > 12 ? `<p><a href="/events/">All events →</a></p>` : ''}</section>` : ''}
<section><h2>Background</h2><p>${esc(c.details)}</p>${c.geo ? `<h3>Geopolitical context</h3><p>${esc(c.geo)}</p>` : ''}</section>
${faqHTML(qa)}
<p class="more">Other chokepoints: ${chokeIds.filter(x => x !== c.id).map(link).join(' · ')}</p>`;
  write(`/chokepoints/${c.id}/`, layout({
    path: `/chokepoints/${c.id}/`, lastmod,
    title: `${c.name}: is it open? Status, ship traffic and oil flows | Strategic Energy Map`,
    description: firstSentences(answer, 2).slice(0, 300),
    crumbs: [{ name: 'Chokepoints', url: '/chokepoints/' }, { name: c.name, url: `/chokepoints/${c.id}/` }],
    jsonld: [faqLd(qa), placeLd(c.name, c.coords, firstSentences(c.details, 1))], body,
  }));
}
// Chokepoints hub
{
  const rows = infra.chokepoints.map(c => {
    const st = statusOf(c.id), sc = scenarios.chokepoints?.[c.id], live = pw[c.id];
    return `<tr><td>${link(c.id)}</td><td>${st ? statusChip(st) : '<span class="pill ok">Open</span>'}</td><td>${sc ? `${sc.oil_mbd} mb/d` : '—'}</td><td>${live ? `${n(live.now)} <small>(${signed(pct(live.now, live.base))})</small>` : '—'}</td></tr>`;
  }).join('');
  const closed = infra.chokepoints.filter(c => ['closed', 'disrupted'].includes(statusOf(c.id)?.status)).map(c => c.name);
  const answer = closed.length ? `As of ${fmtDate(statusData.updated)}, ${closed.join(', ')} ${closed.length > 1 ? 'are' : 'is'} closed or disrupted. The table shows the current status, pre-crisis oil flow and latest independent tanker counts for each of the world's main energy chokepoints.` : `As of ${fmtDate(statusData.updated)}, no major energy chokepoint is recorded as closed or disrupted.`;
  write('/chokepoints/', layout({
    path: '/chokepoints/', lastmod: statusData.updated,
    title: 'Oil and gas chokepoints: live status and ship traffic | Strategic Energy Map',
    description: answer.slice(0, 300),
    crumbs: [{ name: 'Chokepoints', url: '/chokepoints/' }],
    body: `<h1>Oil and gas chokepoints: live status and ship traffic</h1>
<div class="answer"><p>${esc(answer)}</p></div>
<table class="data-table"><thead><tr><th>Chokepoint</th><th>Status</th><th>Oil flow (pre-crisis)</th><th>Tankers/day, last 7 days (vs. baseline)</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Tanker counts: <a href="https://portwatch.imf.org/" rel="noopener" target="_blank">IMF PortWatch</a>, baseline ${BASELINE.label}. Status: this map's sourced status log.</p>`,
  }));
}

// ── Facility pages ──
const scenarioRoles = id => Object.entries(scenarios.chokepoints || {}).flatMap(([cid, c]) => [
  ...(c.bypass || []).filter(b => b.asset === id).map(b => `Bypass route if the ${link(cid)} closes${b.spare_mbd ? ` (~${b.spare_mbd} mb/d spare capacity)` : ''}.`),
  ...(c.bypass || []).filter(b => b.outlet === id).map(() => `Export outlet for a bypass route around the ${link(cid)}.`),
  ...(c.stranded || []).includes(id) ? [`Cut off if the ${link(cid)} closes.`] : []]);
let facilityPages = 0;
for (const id of facilityIds) {
  if (!hasPage(id)) continue;
  const a = REG[id], st = statusOf(id), evs = eventsFor(id), roles = scenarioRoles(id);
  const near = facilityIds.filter(x => x !== id).map(x => [x, haversine(a.center, REG[x].center)]).sort((p, q) => p[1] - q[1]).slice(0, 6);
  const lead = st
    ? `${a.name} is currently ${lower(STATUS_LABEL[st.status])}${st.since ? ` (since ${fmtDate(st.since)})` : ''}: ${st.summary}`
    : firstSentences(a.details, 2);
  const lastmod = [st?.updated, evs[0]?.date].filter(Boolean).sort().pop() || null;
  const body = `
<p class="kicker">${esc(a.tag)} ${statusChip(st)}</p>
<h1>${esc(a.name)}</h1>
<div class="answer"><p>${esc(lead)}</p><p class="note">${lastmod ? `Updated ${esc(fmtDate(lastmod))} · ` : ''}<a href="/?focus=${id}">View on the live map →</a></p></div>
${st ? `${sourcesHTML(st.sources)}` : ''}
<section><h2>Overview</h2><p>${esc(a.details)}</p></section>
${a.geo ? `<section><h2>Geopolitical context</h2><p>${esc(a.geo)}</p></section>` : ''}
${roles.length ? `<section><h2>Role in chokepoint scenarios</h2><ul>${roles.map(r => `<li>${r}</li>`).join('')}</ul></section>` : ''}
${evs.length ? `<section><h2>Recent developments</h2>${evs.slice(0, 10).map(e => eventItem(e, false)).join('')}</section>` : ''}
<section><h2>Nearby</h2><ul class="near">${near.map(([x, d]) => `<li>${link(x)} <small>${esc(REG[x].tag)} · ~${Math.round(d)} km</small></li>`).join('')}</ul></section>`;
  write(`/facilities/${id}/`, layout({
    path: `/facilities/${id}/`, lastmod,
    title: `${a.name}${st ? ` (${STATUS_LABEL[st.status].toLowerCase()})` : ''}: ${a.tag.toLowerCase()} status and context | Strategic Energy Map`,
    description: lead.slice(0, 300),
    crumbs: [{ name: 'Facilities', url: '/facilities/' }, { name: a.name, url: `/facilities/${id}/` }],
    jsonld: [placeLd(a.name, a.center, firstSentences(a.details, 1))], body,
  }));
  facilityPages++;
}
// Facilities hub (every facility, including those without their own page)
{
  const groups = {};
  facilityIds.forEach(id => { (groups[REG[id].tag] ||= []).push(REG[id]); });
  const order = ['Oil pipeline', 'Gas pipeline', 'LNG terminal', 'Port / transit hub', 'Refinery', 'Oil field', 'Gas field', 'Production site'];
  const disrupted = facilityIds.filter(id => statusOf(id));
  write('/facilities/', layout({
    path: '/facilities/', lastmod: statusData.updated,
    title: 'Oil and gas infrastructure directory: pipelines, LNG terminals, refineries and fields | Strategic Energy Map',
    description: `Directory of ${facilityIds.length} major oil and gas facilities worldwide, with ${disrupted.length} currently not operating normally as of ${fmtDate(statusData.updated)}.`,
    crumbs: [{ name: 'Facilities', url: '/facilities/' }],
    body: `<h1>Oil and gas infrastructure directory</h1>
<div class="answer"><p>${facilityIds.length} major pipelines, LNG terminals, ports, refineries and oil and gas fields across Europe, the Middle East, Asia and the Americas. As of ${esc(fmtDate(statusData.updated))}, ${disrupted.length} are not operating normally: ${disrupted.map(link).join(', ')}.</p></div>
<nav class="doc-toc">${order.filter(t => groups[t]).map(t => `<a href="#${t.toLowerCase().replace(/[^a-z]+/g, '-')}">${esc(t)}s (${groups[t].length})</a>`).join('')}</nav>
${order.filter(t => groups[t]).map(t => `<section id="${t.toLowerCase().replace(/[^a-z]+/g, '-')}"><h2>${esc(t)}s</h2><ul class="dir">${groups[t].sort((p, q) => p.name.localeCompare(q.name)).map(a =>
  `<li id="${a.id}">${hasPage(a.id) ? `<a href="/facilities/${a.id}/"><b>${esc(a.name)}</b></a>` : `<b>${esc(a.name)}</b>`} ${statusChip(statusOf(a.id))}<br><span>${esc(firstSentences(a.details, 1))}</span></li>`).join('')}</ul></section>`).join('')}`,
  }));
}

// ── Pump price pages ──
const fuelEntries = (fuel.entries || []).filter(e => e.petrol);
const unitWord = e => e.unit === '$/gal' ? 'a gallon' : 'a litre';
const money = (e, v) => e.unit === '$/gal' ? `$${n(v, 2)}` : e.unit === '£/l' ? `£${n(v, 2)}` : e.unit === '€/l' ? `€${n(v, 2)}` : `${n(v, 2)} ${e.unit}`;
const inEU = e => e.feed === 'eu-oil-bulletin' && e.group === 'country';
const euCountries = fuelEntries.filter(inEU);
const euRank = (e, k) => 1 + euCountries.filter(x => (x.usd_per_litre?.[k] ?? 0) > (e.usd_per_litre?.[k] ?? 0)).length;
const PRE = fmtDate(fuel.pre_crisis_date);
for (const e of fuelEntries) {
  const P = e.petrol, D = e.diesel, pWord = e.currency === 'USD' ? 'regular gasoline' : 'petrol';
  const cmp = e.group === 'us-region' ? fuelEntries.find(x => x.id === 'us') : inEU(e) ? fuelEntries.find(x => x.id === 'eu') : null;
  const answer = `In the week of ${fmtDate(e.date)}, ${D ? `diesel averaged ${money(e, D.now)} ${unitWord(e)} in ${e.name}` : ''}${D ? ` and ${pWord} ${money(e, P.now)}` : `${pWord} averaged ${money(e, P.now)} ${unitWord(e)} in ${e.name}`} (US$${n(e.usd_per_litre?.diesel ?? e.usd_per_litre?.petrol, 2)} a litre${D ? ' for diesel' : ''}). ${D && D.pre_crisis ? `Diesel is ${signed(pct(D.now, D.pre_crisis))} and ${pWord} ${signed(pct(P.now, P.pre_crisis))}` : `${pWord[0].toUpperCase() + pWord.slice(1)} is ${signed(pct(P.now, P.pre_crisis))}`} compared with the week of ${PRE}, before the Strait of Hormuz closed.`;
  const qa = [[`How much is diesel in ${e.name}?`, D ? `${money(e, D.now)} ${unitWord(e)} on average in the week of ${fmtDate(e.date)} (US$${n(e.usd_per_litre?.diesel, 2)} a litre), according to the ${e.source.name.replace(/^UK |^US /, m => m)}.` : 'Diesel prices are not reported for this series.'],
    [`How much has fuel risen in ${e.name} since February 2026?`, `${D ? `Diesel: ${signed(pct(D.now, D.pre_crisis))}. ` : ''}${pWord[0].toUpperCase() + pWord.slice(1)}: ${signed(pct(P.now, P.pre_crisis))}. Compared with the week of ${PRE}.`]];
  if (cmp && cmp !== e && D && cmp.diesel) qa.push([`How does ${e.name} compare with the ${cmp.name.replace(/^United States$/, 'US average')}?`, `Diesel in ${e.name} is ${money(e, D.now)} against ${money(cmp, cmp.diesel.now)} for the ${cmp.name}.${inEU(e) ? ` ${e.name} ranks ${euRank(e, 'diesel')} of ${euCountries.length} EU countries for diesel prices in US dollars (1 = most expensive).` : ''}`]);
  const neighbours = inEU(e) ? euCountries.slice().sort((a, b) => (b.usd_per_litre?.diesel ?? 0) - (a.usd_per_litre?.diesel ?? 0)) : fuelEntries.filter(x => x.feed === e.feed);
  const lastmod = e.date;
  const body = `
<p class="kicker">Pump prices · week of ${esc(fmtDate(e.date))}</p>
<h1>Diesel and ${pWord} prices in ${esc(e.name)}</h1>
<div class="answer"><p>${esc(answer)}</p><p class="note">Updated ${esc(fmtDate(e.date))} · Source: ${esc(e.source.name)}</p></div>
<table class="data-table"><thead><tr><th></th><th>This week</th><th>Week ago</th><th>Week of ${esc(PRE)}</th><th>Change since then</th></tr></thead><tbody>
${[[pWord[0].toUpperCase() + pWord.slice(1), P], ['Diesel', D]].filter(([, b]) => b).map(([l, b]) => `<tr><th>${l} (${esc(e.unit)})</th><td>${n(b.now, 3)}</td><td>${n(b.week_ago, 3)}</td><td>${n(b.pre_crisis, 3)}</td><td>${signed(pct(b.now, b.pre_crisis), 1)}</td></tr>`).join('')}
</tbody></table>
<section><h2>Trend</h2>${spark(D?.history || P.history, { ref: (D || P).pre_crisis, refLabel: `dashed: week of ${PRE}`, series2: D ? P.history : null })}
<p class="note">${D ? `<span style="color:#b3261e">■</span> Diesel <span style="color:#1a6bb5">■</span> ${esc(pWord)}` : esc(pWord)}, weekly, in ${esc(e.unit)}.</p></section>
${faqHTML(qa)}
${sourcesHTML([e.source, ...(e.sources || []), fuel.fx?.source])}
<p class="more">${inEU(e) ? 'Other EU countries' : 'Related'}: ${neighbours.filter(x => x.id !== e.id).slice(0, 12).map(x => `<a href="/fuel-prices/${x.id}/">${esc(x.name)}</a>`).join(' · ')} · <a href="/fuel-prices/">All countries</a></p>`;
  write(`/fuel-prices/${e.id}/`, layout({
    path: `/fuel-prices/${e.id}/`, lastmod,
    title: `${e.name} diesel and ${pWord} prices this week${D ? ` (${money(e, D.now)}${e.unit === '$/gal' ? '/gal' : '/L'} diesel)` : ''} | Strategic Energy Map`,
    description: answer.slice(0, 300),
    crumbs: [{ name: 'Pump prices', url: '/fuel-prices/' }, { name: e.name, url: `/fuel-prices/${e.id}/` }],
    jsonld: [faqLd(qa), { '@context': 'https://schema.org', '@type': 'Dataset', name: `Weekly retail fuel prices, ${e.name}`,
      description: `Weekly average retail petrol and diesel prices including taxes in ${e.name}, from ${e.source.name}.`,
      temporalCoverage: `${(D || P).history[0][0]}/${e.date}`, spatialCoverage: e.name, isBasedOn: e.source.url,
      creator: { '@type': 'Person', name: 'Courtney Wilson', url: LINKEDIN },
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/data/fuel.json` }] }],
    body,
  }));
}
// Pump prices hub
{
  const byDiesel = fuelEntries.filter(e => e.group !== 'us-region' && e.diesel).sort((a, b) => (b.usd_per_litre?.diesel ?? 0) - (a.usd_per_litre?.diesel ?? 0));
  const top = byDiesel[0], low = byDiesel[byDiesel.length - 1], us = fuelEntries.find(e => e.id === 'us'), eu = fuelEntries.find(e => e.id === 'eu'), uk = fuelEntries.find(e => e.id === 'uk');
  const answer = `In the week of ${fmtDate(fuel.as_of)}, diesel was most expensive in ${top.name} (US$${n(top.usd_per_litre.diesel, 2)} a litre) and cheapest in ${low.name} (US$${n(low.usd_per_litre.diesel, 2)}). ${us ? `US diesel averaged $${n(us.diesel.now, 2)} a gallon, ${signed(pct(us.diesel.now, us.diesel.pre_crisis))} since the week of ${PRE}. ` : ''}${eu ? `The EU average was €${n(eu.diesel.now, 2)} a litre (${signed(pct(eu.diesel.now, eu.diesel.pre_crisis))}).` : ''}`;
  const row = e => `<tr><td><a href="/fuel-prices/${e.id}/">${esc(e.name)}</a></td><td>${n(e.petrol.now, 2)} <small>${esc(e.unit)}</small></td><td>${e.diesel ? `${n(e.diesel.now, 2)} <small>${esc(e.unit)}</small>` : '—'}</td><td>${n(e.usd_per_litre?.diesel, 2)}</td><td>${signed(pct(e.diesel?.now, e.diesel?.pre_crisis))}</td><td>${signed(pct(e.petrol.now, e.petrol.pre_crisis))}</td></tr>`;
  const qa = [['Where is diesel most expensive?', firstSentences(answer, 1)],
    ['How much have fuel prices risen since the Strait of Hormuz closed?', `Compared with the week of ${PRE}: ${[us && `US diesel ${signed(pct(us.diesel.now, us.diesel.pre_crisis))}, US gasoline ${signed(pct(us.petrol.now, us.petrol.pre_crisis))}`, eu && `EU diesel ${signed(pct(eu.diesel.now, eu.diesel.pre_crisis))}`, uk && `UK diesel ${signed(pct(uk.diesel.now, uk.diesel.pre_crisis))}`].filter(Boolean).join('; ')}.`],
    ['Why do fuel prices differ so much between countries?', 'Mostly taxes. Excise duty and VAT make up a large share of pump prices in Europe and differ widely between countries, while US fuel taxes are much lower. Crude and refining costs are broadly similar everywhere.']];
  write('/fuel-prices/', layout({
    path: '/fuel-prices/', lastmod: fuel.as_of,
    title: `Petrol and diesel prices by country this week (${fmtDate(fuel.as_of)}) | Strategic Energy Map`,
    description: answer.slice(0, 300),
    crumbs: [{ name: 'Pump prices', url: '/fuel-prices/' }],
    jsonld: [faqLd(qa), { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Weekly retail petrol and diesel prices: US, EU and UK',
      description: 'Weekly average retail fuel prices including taxes, from the US EIA, the European Commission Weekly Oil Bulletin and UK DESNZ, with US$ conversions at ECB reference rates.',
      temporalCoverage: `${BASELINE.from}/${fuel.as_of}`, creator: { '@type': 'Person', name: 'Courtney Wilson', url: LINKEDIN },
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/data/fuel.json` }] }],
    body: `<h1>Petrol and diesel prices by country</h1>
<div class="answer"><p>${esc(answer)}</p><p class="note">Week of ${esc(fmtDate(fuel.as_of))} · Updated weekly from official statistics</p></div>
<table class="data-table sortable"><thead><tr><th>Country</th><th>Petrol</th><th>Diesel</th><th>Diesel US$/l</th><th>Diesel since ${esc(PRE)}</th><th>Petrol since ${esc(PRE)}</th></tr></thead><tbody>${byDiesel.map(row).join('')}</tbody></table>
<h2>United States by region</h2>
<table class="data-table"><thead><tr><th>Region</th><th>Gasoline</th><th>Diesel</th><th>Diesel US$/l</th><th>Diesel change</th><th>Gasoline change</th></tr></thead><tbody>${fuelEntries.filter(e => e.feed === 'eia').map(row).join('')}</tbody></table>
<p class="note">${esc(fuel.note || '')} US prices are per gallon; European prices per litre.</p>
${faqHTML(qa)}
${sourcesHTML([...new Map(fuelEntries.map(e => [e.source.url, e.source])).values(), fuel.fx?.source])}`,
  }));
}

// ── Events archive + RSS ──
{
  const byMonth = {};
  events.forEach(e => { (byMonth[e.date.slice(0, 7)] ||= []).push(e); });
  write('/events/', layout({
    path: '/events/', lastmod: eventsData.updated,
    title: 'Energy infrastructure news: strikes, closures and disruptions (sourced log) | Strategic Energy Map',
    description: (eventsData.situation_summary || '').slice(0, 300),
    crumbs: [{ name: 'Events', url: '/events/' }],
    body: `<h1>Energy infrastructure events</h1>
${eventsData.situation_summary ? `<div class="answer"><p class="q">Situation as of ${esc(fmtDate(eventsData.updated))}</p><p>${esc(eventsData.situation_summary)}</p></div>` : ''}
<p>A dated log of developments affecting energy infrastructure, flows and prices. Each entry links its sources and carries a confidence label. <a href="/events.xml">RSS feed</a>.</p>
<nav class="doc-toc">${Object.keys(byMonth).map(m => `<a href="#m-${m}">${esc(fmtMonth(m))} (${byMonth[m].length})</a>`).join('')}</nav>
${Object.entries(byMonth).map(([m, list]) => `<section id="m-${m}"><h2>${esc(fmtMonth(m))}</h2>${list.map(e => eventItem(e)).join('')}</section>`).join('')}`,
  }));
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Strategic Energy Map: energy infrastructure events</title><link>${SITE}/events/</link>
<atom:link href="${SITE}/events.xml" rel="self" type="application/rss+xml"/>
<description>Sourced log of developments affecting global energy infrastructure, chokepoints and flows.</description>
${events.slice(0, 50).map(e => `<item><title>${esc(e.title)}</title><link>${SITE}/events/#${esc(e.id)}</link><guid isPermaLink="false">${esc(e.id)}</guid><pubDate>${new Date(e.date + 'T12:00:00Z').toUTCString()}</pubDate><description>${esc(e.summary)}</description></item>`).join('\n')}
</channel></rss>`;
  writeFileSync(join(DIST, 'events.xml'), rss);
}

// ── Homepage: ship the latest situation and events as real HTML (app.js re-renders the same panel) ──
{
  const latest = events.slice(0, 8).map(e => `<div class="event" data-event="${esc(e.id)}"><div class="ev-meta">${esc(fmtDate(e.date))} · ${esc(e.category)} ${confChip(e.confidence)}</div><div class="ev-title">${esc(e.title)}</div><div class="ev-sum">${esc(e.summary)}</div>${sourcesHTML(e.sources)}</div>`).join('');
  const pre = `${eventsData.situation_summary ? `<details class="situation"><summary><b>Situation · ${esc(fmtDate(eventsData.updated))}</b><span class="clamp">${esc(eventsData.situation_summary)}</span></summary><div class="full">${esc(eventsData.situation_summary)}</div></details>` : ''}${latest}<p class="note"><a href="/events/">All events →</a></p>`;
  let html = indexHtml.replace('<div class="tab-body" id="tab-latest"></div>', `<div class="tab-body" id="tab-latest">${pre}</div>`);
  if (html === indexHtml) throw new Error('index.html: #tab-latest placeholder not found');
  writeFileSync(join(DIST, 'index.html'), html);
  pages.push({ path: '/', lastmod: eventsData.updated }, { path: '/about.html', lastmod: null });
}

// ── Social chart cards (1200×675, rendered to PNG by scripts/social_post.mjs; not indexed) ──
function chartCard({ title, subtitle, rows, source }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><style>
  * { margin: 0; box-sizing: border-box; } body { width: 1200px; height: 675px; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f4f1e8; color: #1a2332; position: relative; overflow: hidden; }
  .head { padding: 40px 56px 18px; } h1 { font-size: 38px; letter-spacing: -0.4px; } .sub { font-size: 20px; color: #4a5568; margin-top: 6px; }
  .rows { padding: 0 56px; height: 470px; display: flex; flex-direction: column; justify-content: center; } .row { display: grid; grid-template-columns: 250px 1fr 210px; align-items: center; height: 44px; font-size: 20px; }
  .name { font-weight: 600; } .track { position: relative; height: 24px; } .bar { position: absolute; top: 0; height: 24px; border-radius: 4px; }
  .zero { position: absolute; top: -6px; bottom: -6px; width: 2px; background: #8a94a6; } .val { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; } .val small { font-weight: 500; color: #4a5568; font-size: 16px; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: 58px; background: #1a2332; color: #c9d3e0; display: flex; align-items: center; justify-content: space-between; padding: 0 56px; font-size: 16px; }
  .foot b { color: #fff; font-size: 18px; }
</style></head><body><div class="head"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></div>
<div class="rows">${rows}</div><div class="foot"><span>${esc(source)}</span><b>strategicenergymap.org</b></div></body></html>`;
}
{
  mkdirSync(join(DIST, 'social'), { recursive: true });
  // Pump prices: diesel change since the pre-crisis week
  const ids = ['us', 'uk', 'eu', 'de', 'fr', 'it', 'es', 'nl', 'pl'];
  const list = ids.map(id => fuelEntries.find(e => e.id === id)).filter(e => e?.diesel?.pre_crisis)
    .map(e => ({ e, p: pct(e.diesel.now, e.diesel.pre_crisis) })).sort((a, b) => b.p - a.p);
  const maxP = Math.max(...list.map(x => x.p), 1);
  const fuelRows = list.map(({ e, p }) => `<div class="row"><span class="name">${esc(e.name)}</span><div class="track"><div class="bar" style="left:0;width:${(p / maxP * 100).toFixed(1)}%;background:#b3261e"></div></div><span class="val">${signed(p)} <small>${esc(money(e, e.diesel.now))}${e.unit === '$/gal' ? '/gal' : '/L'}</small></span></div>`).join('');
  writeFileSync(join(DIST, 'social', 'fuel-weekly.html'), chartCard({
    title: 'Diesel prices since the Strait of Hormuz closed', subtitle: `Change since the week of ${PRE}, as of the week of ${fmtDate(fuel.as_of)}`,
    rows: fuelRows, source: 'Sources: US EIA · EU Weekly Oil Bulletin · UK DESNZ' }));
  // Chokepoints: tanker traffic vs pre-crisis baseline (diverging bars around zero)
  const cps = Object.keys(pw).filter(id => pw[id]).map(id => ({ id, d: pw[id], p: pct(pw[id].now, pw[id].base) })).sort((a, b) => a.p - b.p);
  const span = Math.max(100, ...cps.map(x => Math.abs(x.p)));
  const zero = 70; // % of track width where zero sits (most changes are negative)
  const cpRows = cps.map(({ id, d, p }) => {
    const w = Math.abs(p) / span * (p < 0 ? zero : 100 - zero);
    const left = p < 0 ? zero - w : zero;
    return `<div class="row"><span class="name">${esc(REG[id].name.replace(/ \(.*\)/, ''))}</span><div class="track"><div class="zero" style="left:${zero}%"></div><div class="bar" style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%;background:${p < 0 ? '#b3261e' : '#1e8a4c'}"></div></div><span class="val">${signed(p)} <small>${n(d.now)}/day</small></span></div>`;
  }).join('');
  const last = cps.map(x => x.d.lastDate).sort().pop();
  writeFileSync(join(DIST, 'social', 'chokepoints-weekly.html'), chartCard({
    title: 'Tanker traffic through energy chokepoints', subtitle: `7-day average to ${fmtDate(last)} vs ${BASELINE.label}`,
    rows: cpRows, source: 'Source: IMF PortWatch (satellite AIS). Ships sailing with transponders off are not counted.' }));
}

// ── Pages index for the map, robots.txt, sitemap ──
writeFileSync(join(DIST, 'pages.json'), JSON.stringify({
  facilities: facilityIds.filter(hasPage), chokepoints: chokeIds, fuel: fuelEntries.map(e => e.id) }));
writeFileSync(join(DIST, 'robots.txt'), `# Search engines and AI assistants are welcome to crawl and cite this site.
User-agent: *
Allow: /
Disallow: /social/

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `<url><loc>${SITE}${p.path}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);

console.log(`Built dist/: ${pages.length} pages (${infra.chokepoints.length} chokepoints, ${facilityPages} facilities, ${fuelEntries.length} pump-price pages, hubs, events). PortWatch: ${Object.values(pw).filter(Boolean).length}/${Object.keys(pw).length} chokepoints.`);
