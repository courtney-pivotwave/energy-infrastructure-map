#!/usr/bin/env node
// Static site build: copies the map and generates crawlable answer pages from data/*.json into dist/.
// Runs on every Vercel deploy (vercel.json → buildCommand). No dependencies.
// Usage: node scripts/build.mjs        (then serve dist/: python3 -m http.server 8765 -d dist)
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
const capLine = c => c ? `<p class="note"><b>Capacity:</b> ${esc(c.value)} ${esc(c.unit)} (${esc(c.basis)})${c.note ? `; ${esc(c.note)}` : ''}. Source: ${safeUrl(c.source?.url) ? `<a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.name)}</a>` : esc(c.source?.name)}, as of ${esc(fmtDate(c.as_of))}.</p>` : '';
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
// Pages use styles.css unless they pass their own stylesheets (`css`) and scripts (`scripts`), as /dashboard/ does.
function layout({ path, title, description, crumbs = [], body, jsonld = [], lastmod = null, type = 'article', css = [`/${CSS}`], scripts = [], bodyClass = 'doc', mainClass = 'doc-wrap' }) {
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
${css.map(h => `<link rel="stylesheet" href="${h}">`).join('\n')}
${scripts.map(h => `<script defer src="${h}"></script>`).join('\n')}
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
// Owner opt-out: visit any page with ?notrack=1 to stop counting this browser (?notrack=0 undoes it).
try { const n = new URLSearchParams(location.search).get('notrack'); if (n === '1') localStorage.setItem('va-disable', '1'); if (n === '0') localStorage.removeItem('va-disable'); } catch (e) {}
window.va('beforeSend', ev => { try { if (localStorage.getItem('va-disable')) return null; } catch (e) {} return ev; });</script>
<script defer src="/_vercel/insights/script.js"></script>
${ld}
</head>
<body class="${bodyClass}">
<header class="site-nav"><a class="brand" href="/">Strategic Energy Map</a>
<nav aria-label="Site">${[['/', 'Live map'], ['/dashboard/', 'Dashboard'], ['/chokepoints/', 'Chokepoints'], ['/fuel-prices/', 'Pump prices'], ['/facilities/', 'Facilities'], ['/events/', 'Events'], ['/charts/', 'Charts'], ['/about.html', 'About']].map(([h, l]) => `<a href="${h}"${h === path ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav></header>
<main class="${mainClass}">
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
    return { lastDate: rows[rows.length - 1].date, now: avg(last7, 't'), nowAll: avg(last7, 'all'), base: avg(base, 't'), roll, rows };
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
// Walkthrough videos (web versions written by tools/video/publish.mjs)
if (existsSync(join(ROOT, 'media'))) cpSync(join(ROOT, 'media'), join(DIST, 'media'), { recursive: true });
// Local only: the link-preview card template (tools/ is excluded from Vercel uploads via .vercelignore).
// tools/video is left out: it holds the video recorder, its node_modules and full-size renders.
if (existsSync(join(ROOT, 'tools'))) cpSync(join(ROOT, 'tools'), join(DIST, 'tools'), { recursive: true, filter: s => !s.includes(join('tools', 'video')) });

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
<section><h2>Overview</h2><p>${esc(a.details)}</p>${capLine(a.capacity)}</section>
${a.geo ? `<section><h2>Geopolitical context</h2><p>${esc(a.geo)}</p></section>` : ''}
${roles.length ? `<section><h2>Role in chokepoint scenarios</h2><ul>${roles.map(r => `<li>${r}</li>`).join('')}</ul></section>` : ''}
${evs.length ? `<section><h2>Recent developments</h2>${evs.slice(0, 10).map(e => eventItem(e, false)).join('')}</section>` : ''}
<section><h2>Nearby</h2><ul class="near">${near.map(([x, d]) => `<li>${link(x)} <small>${esc(REG[x].tag)} · ~${Math.round(d)} km</small></li>`).join('')}</ul></section>`;
  write(`/facilities/${id}/`, layout({
    path: `/facilities/${id}/`, lastmod,
    title: `${a.name}${st ? ` (${STATUS_LABEL[st.status].toLowerCase()})` : ''}: ${a.tag === 'LNG terminal' ? a.tag : a.tag.toLowerCase()} status and context | Strategic Energy Map`,
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
    description: (eventsData.situation_headline || eventsData.situation_summary || '').slice(0, 300),
    crumbs: [{ name: 'Events', url: '/events/' }],
    body: `<h1>Energy infrastructure events</h1>
${eventsData.situation_headline ? `<div class="answer"><p class="q">Latest, ${esc(fmtDate(eventsData.updated))}</p><p>${esc(eventsData.situation_headline)}</p></div>` : ''}
${eventsData.situation_summary ? `<details class="doc-bg"><summary>Background: how we got here</summary><p>${esc(eventsData.situation_summary)}</p></details>` : ''}
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
  const d = eventsData;
  const card = (d.situation_headline || d.situation_summary) ? `<div class="situation"><b>Latest · ${esc(fmtDate(d.updated))}</b>${d.situation_headline ? `<p class="lead">${esc(d.situation_headline)}</p>` : ''}${d.situation_summary ? `<details class="bg"><summary>Background: how we got here</summary><p>${esc(d.situation_summary)}</p></details>` : ''}</div>` : '';
  const pre = `${card}${latest}<p class="note"><a href="/events/">All events →</a></p>`;
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
// Chart data shared by the social cards and the /charts/ pages
const dieselChange = ['us', 'uk', 'eu', 'de', 'fr', 'it', 'es', 'nl', 'pl'].map(id => fuelEntries.find(e => e.id === id))
  .filter(e => e?.diesel?.pre_crisis).map(e => ({ e, p: pct(e.diesel.now, e.diesel.pre_crisis) })).sort((a, b) => b.p - a.p);
const tankerChange = Object.keys(pw).filter(id => pw[id]).map(id => ({ id, d: pw[id], p: pct(pw[id].now, pw[id].base) })).sort((a, b) => a.p - b.p);
const flowRows = Object.entries(scenarios.chokepoints || {}).filter(([id, c]) => REG[id] && c.oil_mbd).map(([id, c]) => ({ id, c })).sort((a, b) => b.c.oil_mbd - a.c.oil_mbd);
const hormuz = closure('strait-of-hormuz');
const DEMAND = scenarios.globals?.world_oil_demand_mbd || 104;
const shortName = id => REG[id].name.replace(/ \(.*\)/, '');
{
  mkdirSync(join(DIST, 'social'), { recursive: true });
  // Pump prices: diesel change since the pre-crisis week
  const list = dieselChange;
  const maxP = Math.max(...list.map(x => x.p), 1);
  const fuelRows = list.map(({ e, p }) => `<div class="row"><span class="name">${esc(e.name)}</span><div class="track"><div class="bar" style="left:0;width:${(p / maxP * 100).toFixed(1)}%;background:#b3261e"></div></div><span class="val">${signed(p)} <small>${esc(money(e, e.diesel.now))}${e.unit === '$/gal' ? '/gal' : '/L'}</small></span></div>`).join('');
  writeFileSync(join(DIST, 'social', 'fuel-weekly.html'), chartCard({
    title: 'Diesel prices since the Strait of Hormuz closed', subtitle: `Change since the week of ${PRE}, as of the week of ${fmtDate(fuel.as_of)}`,
    rows: fuelRows, source: 'Sources: US EIA · EU Weekly Oil Bulletin · UK DESNZ' }));
  // Chokepoints: tanker traffic vs pre-crisis baseline (diverging bars around zero)
  const cps = tankerChange;
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
  // Oil flow through each chokepoint before the crisis
  const maxF = Math.max(...flowRows.map(x => x.c.oil_mbd));
  writeFileSync(join(DIST, 'social', 'chokepoint-oil-flows.html'), chartCard({
    title: 'How much oil passes through each chokepoint', subtitle: 'Crude and oil products before the 2026 crisis, million barrels a day',
    rows: flowRows.map(({ id, c }) => `<div class="row"><span class="name">${esc(shortName(id))}</span><div class="track"><div class="bar" style="left:0;width:${(c.oil_mbd / maxF * 100).toFixed(1)}%;background:#1a6bb5"></div></div><span class="val">${n(c.oil_mbd)} <small>mb/d</small></span></div>`).join(''),
    source: 'Sources: IEA (Kpler) for Hormuz; EIA (Vortexa, 1H 2025) for the others. Shared flows count at each chokepoint.' }));
  // Hormuz: flow vs bypass capacity
  if (hormuz) {
    const hr = [['Oil through Hormuz before the war', hormuz.stranded, '#1a2332'], ['Spare pipeline capacity around it', hormuz.bypass, '#1e8a4c'], ['No alternative route', hormuz.shortfall, '#b3261e']];
    writeFileSync(join(DIST, 'social', 'hormuz-bypass.html'), chartCard({
      title: 'How much Hormuz oil can be rerouted?', subtitle: 'Million barrels a day. Pipelines around the strait can carry only a fraction of its flow.',
      rows: hr.map(([l, v, col]) => `<div class="row" style="grid-template-columns:430px 1fr 170px;height:92px;font-size:25px"><span class="name">${esc(l)}</span><div class="track" style="height:44px"><div class="bar" style="left:0;height:44px;width:${(v / hormuz.stranded * 100).toFixed(1)}%;background:${col}"></div></div><span class="val" style="font-size:28px">${n(v)} <small style="font-size:18px">mb/d</small></span></div>`).join(''),
      source: 'Sources: IEA Strait of Hormuz factsheet (Kpler); spare capacity per IEA, low end. Model: strategicenergymap.org' }));
  }
}

// ── Social data cards (dark dashboard look): the daily board for digests and one fact card per asset page for
// explainers. scripts/social_post.mjs picks the card by post type and takes its alt text from cards.json, so every
// figure on a card comes from data/ at posting time, never from a draft ──
{
  const fmtShort = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const clip = (t, k) => { const s = String(t || '').trim(); return s.length > k ? s.slice(0, k).replace(/\s+\S*$/, '').replace(/[,;:]$/, '') + '…' : s; };
  // Sentences, without splitting decimals ("~1.5 million bpd")
  const sents = t => String(t || '').trim().split(/(?<=[.!?])\s+(?=[A-Z~("'])/).filter(Boolean);
  // As many whole sentences as fit in k characters; a first sentence longer than that is cut at a word
  const fit = (list, k) => { let out = ''; for (const x of list) { if ((out + ' ' + x).trim().length > k) break; out = (out + ' ' + x).trim(); } return out || clip(list[0], k); };
  // Stored summaries still carry some day-first dates ("28 Feb"); cards go to a US audience, month first
  const usDates = t => String(t || '').replace(/(?<![\d–-])\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)([a-z]*)\b/g, '$2$3 $1');
  const LOGO = '<svg viewBox="0 0 32 32" width="34" height="34"><rect width="32" height="32" rx="7" fill="#2e2940"/><path d="M5 22 C11 12, 17 24, 27 10" fill="none" stroke="#3b8fd9" stroke-width="3" stroke-linecap="round"/><polygon points="16,6 22,17 10,17" fill="#e0493a"/></svg>';
  // Palette: the dashboard's "Aubergine" (dashboard.css)
  const darkCard = (body, css = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><style>
  :root { --bg:#120f1c; --surface:#1a1628; --surface-2:#2e2940; --ink:#fefeff; --ink-2:#d7d3e1; --ink-3:#b0adbb; --line-2:rgba(254,254,255,.13); --accent:#a98bff; --oil:#ffae5c; --gas:#6fb4ff; --lng:#4fd8d0; --ok:#67d99a;
    --closed:#ff6680; --damaged:#ff8a7a; --disrupted:#ff9e5c; --reduced:#ffd56b; --offline:#9a95ad; }
  * { margin:0; box-sizing:border-box; } body { width:1200px; height:675px; position:relative; overflow:hidden; background:var(--bg); color:var(--ink); font-family:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif; padding:40px 44px 0; }
  .top { display:flex; justify-content:space-between; align-items:center; } .brand { display:flex; align-items:center; gap:12px; font-weight:700; font-size:19px; }
  .kick { font-weight:600; font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); }
  .foot { position:absolute; left:44px; right:44px; bottom:0; height:52px; border-top:1px solid var(--line-2); display:flex; justify-content:space-between; align-items:center; font-size:15px; color:var(--ink-3); } .foot b { color:var(--ink); font-weight:600; }
  ${css}</style></head><body>${body}</body></html>`;
  const cards = {}; // key → { alt }, read by the poster
  mkdirSync(join(DIST, 'social', 'asset'), { recursive: true });

  // 1. Daily board: benchmarks against the pre-crisis week, Hormuz tanker traffic, assets not operating normally
  {
    const day = statusData.updated;
    const hz = statusOf('strait-of-hormuz'), hzPw = pw['strait-of-hormuz'];
    const dayN = hz?.status === 'closed' && hz.since ? Math.round((Date.parse(day) - Date.parse(hz.since)) / 864e5) : null;
    const headline = dayN != null ? `Hormuz closed: <em>day ${dayN}</em>` : hz ? `Strait of Hormuz: <em>${esc(lower(STATUS_LABEL[hz.status] || hz.status))}</em>` : 'Energy markets today';
    const cur = u => (u.match(/^[$€£]/) || [''])[0];
    const bms = (market.benchmarks || []).filter(b => b.value != null && b.pre_crisis).slice(0, 4);
    const tiles = bms.map(b => { const wk = pct(b.value, b.week_ago);
      return `<div class="tile"><div class="t-l">${esc(b.label)}<span>${esc(b.unit)}</span></div><div class="t-v">${cur(b.unit)}${n(b.value, 2)}</div><div class="t-d"><b>${signed(pct(b.value, b.pre_crisis))}</b> since Feb</div>${wk == null ? '' : `<div class="t-w ${wk >= 0 ? 'up' : 'dn'}">${wk >= 0 ? '▲' : '▼'} ${Math.abs(wk).toFixed(1)}% this week</div>`}</div>`; }).join('');
    let chart = '';
    if (hzPw) {
      const W = 664, H = 172, roll = hzPw.roll, max = Math.ceil(Math.max(...roll.map(r => r[1]), hzPw.base) / 10) * 10 || 10;
      const X = i => i / (roll.length - 1) * W, Y = v => H - v / max * H;
      const line = roll.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[1]).toFixed(1)}`).join('');
      const ci = hz?.since ? roll.findIndex(r => r[0] >= hz.since) : -1;
      chart = `<div class="pan"><h2>Strait of Hormuz: tankers per day <b>${n(hzPw.now)} <i>vs ${n(hzPw.base, 0)} before</i></b></h2>
      <svg width="${W}" height="${H + 22}" viewBox="0 0 ${W} ${H + 22}">
        <line x1="0" x2="${W}" y1="${Y(hzPw.base)}" y2="${Y(hzPw.base)}" stroke="#b0adbb" stroke-width="1.5" stroke-dasharray="5 5"/>
        <text x="${W}" y="${Y(hzPw.base) - 8}" fill="#b0adbb" font-size="13.5" text-anchor="end">${esc(BASELINE.label)}</text>
        ${ci > 0 ? `<line x1="${X(ci)}" x2="${X(ci)}" y1="0" y2="${H}" stroke="#ff6680" stroke-width="1.5"/><text x="${X(ci) + 8}" y="13" fill="#ff6680" font-size="14" font-weight="600">${esc(STATUS_LABEL[hz.status] || 'Disrupted')} ${esc(fmtShort(hz.since))}</text>` : ''}
        <path d="${line}L${W},${H}L0,${H}Z" fill="rgba(111,180,255,.14)"/><path d="${line}" fill="none" stroke="#6fb4ff" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="${W}" cy="${Y(roll[roll.length - 1][1])}" r="5" fill="#6fb4ff" stroke="#1a1628" stroke-width="2"/>
        <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="rgba(254,254,255,.26)"/>
        <text x="0" y="${H + 18}" fill="#b0adbb" font-size="13.5">${esc(fmtMonth(roll[0][0].slice(0, 7)))}</text><text x="${W}" y="${H + 18}" fill="#b0adbb" font-size="13.5" text-anchor="end">${esc(fmtShort(hzPw.lastDate))}</text>
      </svg></div>`;
    }
    const counts = {}; Object.values(statusData.assets || {}).forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
    const order = Object.keys(STATUS_LABEL).filter(k => counts[k]), total = order.reduce((s, k) => s + counts[k], 0);
    const pricesAsOf = bms.map(b => b.source?.date).filter(Boolean).sort().pop() || market.as_of;
    writeFileSync(join(DIST, 'social', 'daily-board.html'), darkCard(`
  <div class="top"><div class="brand">${LOGO}Strategic Energy Map</div><div class="kick">Daily board · ${esc(fmtShort(day))}, ${day.slice(0, 4)}</div></div>
  <div class="day"><h1>${headline}</h1><p>Prices against the week before the crisis</p></div>
  <div class="tiles">${tiles}</div>
  <div class="row2${chart ? '' : ' solo'}">${chart}
    <div class="pan"><h2>Assets not operating normally</h2><div class="stat-n">${total}</div><div class="stat-s">pipelines, terminals, refineries and straits</div>
      <div class="bars">${order.map(k => `<i style="flex:${counts[k]};background:var(--${k})"></i>`).join('')}</div>
      <div class="leg">${order.map(k => `<span><i style="background:var(--${k})"></i><b>${counts[k]}</b> ${esc(lower(STATUS_LABEL[k]))}</span>`).join('')}</div></div>
  </div>
  <div class="foot"><span>Prices: close of ${esc(fmtShort(pricesAsOf))}${chart ? ' · Tankers: IMF PortWatch (ships broadcasting position), 7-day average' : ''}</span><b>strategicenergymap.org</b></div>`, `
  .day { margin-top:26px; display:flex; align-items:baseline; gap:18px; } .day h1 { font-size:46px; line-height:1; font-weight:700; letter-spacing:-.015em; } .day h1 em { font-style:normal; color:var(--closed); } .day p { font-size:19px; color:var(--ink-2); }
  .tiles { margin-top:26px; display:grid; grid-template-columns:repeat(${bms.length || 1},1fr); gap:14px; } .tile, .pan { background:var(--surface); border:1px solid var(--line-2); border-radius:10px; padding:16px 18px; }
  .t-l { font-size:17px; font-weight:600; color:var(--ink-2); display:flex; justify-content:space-between; align-items:baseline; } .t-l span { font:400 13px ui-monospace,Menlo,Consolas,monospace; color:var(--ink-3); }
  .t-v { font-size:44px; font-weight:700; letter-spacing:-.02em; line-height:1.15; margin-top:4px; font-variant-numeric:tabular-nums; } .t-d { font-size:17px; color:var(--ink-2); } .t-d b { color:var(--oil); }
  .t-w { font-size:14.5px; margin-top:3px; font-variant-numeric:tabular-nums; } .up { color:var(--disrupted); } .dn { color:var(--ok); }
  .row2 { margin-top:14px; display:grid; grid-template-columns:1fr 372px; gap:14px; } .row2.solo { grid-template-columns:1fr; }
  .pan h2 { font-size:17px; font-weight:600; color:var(--ink-2); display:flex; justify-content:space-between; align-items:baseline; } .pan h2 b { color:var(--ink); font-size:19px; font-variant-numeric:tabular-nums; } .pan h2 b i { font-style:normal; color:var(--ink-3); font-weight:400; font-size:15px; }
  .pan svg { display:block; margin-top:10px; overflow:visible; } .stat-n { font-size:58px; font-weight:700; line-height:1; letter-spacing:-.02em; margin-top:8px; font-variant-numeric:tabular-nums; } .stat-s { font-size:16px; color:var(--ink-2); margin-top:2px; }
  .bars { display:flex; height:12px; border-radius:6px; overflow:hidden; margin-top:16px; gap:2px; } .leg { display:grid; grid-template-columns:1fr 1fr; gap:5px 10px; margin-top:13px; font-size:15.5px; color:var(--ink-2); } .leg i { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:7px; } .leg b { color:var(--ink); }`));
    cards['daily-board'] = { alt: clip(`Daily board for ${fmtDate(day)}. ${dayN != null ? `Strait of Hormuz closed, day ${dayN}. ` : ''}${bms.map(b => `${b.label} ${cur(b.unit)}${n(b.value, 2)}, ${signed(pct(b.value, b.pre_crisis))} since the week before the crisis`).join('; ')}. ${hzPw ? `Tankers through Hormuz average ${n(hzPw.now)} a day against ${n(hzPw.base, 0)} before. ` : ''}${total} mapped assets are not operating normally.`, 950) };
  }

  // 2. Asset fact cards: one per chokepoint or facility page. Headline figures come from structured data, or from
  // the description only where it states exactly one such figure (two capacities or dates are ambiguous: show none).
  const one = list => { const u = [...new Set(list)]; return u.length === 1 ? u[0] : null; };
  const assetFacts = a => {
    const t = String(a.details || ''), out = [], num = s => parseFloat(s.replace(/,/g, '')), trim = v => String(+v.toFixed(2));
    const sc = scenarios.chokepoints?.[a.id];
    if (a.type === 'chokepoint') {
      if (sc?.oil_mbd) out.push({ v: n(sc.oil_mbd), u: 'mb/d', l: 'Oil before the crisis' }, { v: n(sc.oil_mbd / DEMAND * 100, 0), u: '%', l: 'Of world oil demand' });
      if (sc?.lng_share_pct) out.push({ v: n(sc.lng_share_pct, 0), u: '%', l: 'Of world LNG trade' });
      return out;
    }
    if (a.capacity) out.push({ v: String(a.capacity.value), u: a.capacity.unit, l: 'Capacity' });
    else {
      const c = one([...t.matchAll(/capacity\s+(?:of\s+|is\s+)?~?\s?(\d[\d.,]*)\s*(million bpd|million b\/d|mb\/d|kb\/d|bpd|b\/d|bcm\/yr|bcm\/year|bcm\/y|mtpa)(?![\w/])/gi)].map(m => {
        const v = num(m[1]), u = m[2].toLowerCase();
        if (u.startsWith('million b') || u === 'mb/d') return `${trim(v)}|mb/d`;
        if (u === 'kb/d') return `${trim(v)}|kb/d`;
        if (u === 'bpd' || u === 'b/d') return v >= 1e6 ? `${trim(v / 1e6)}|mb/d` : v >= 1000 ? `${trim(v / 1000)}|kb/d` : `${trim(v)}|b/d`;
        return `${trim(v)}|${u.startsWith('bcm') ? 'bcm/y' : 'mtpa'}`; }));
      if (c) out.push({ v: c.split('|')[0], u: c.split('|')[1], l: 'Capacity' });
    }
    if (a.tag.endsWith('pipeline')) {
      const km = one([...t.matchAll(/(\d[\d,]{1,6})\s*km\b/g)].map(m => m[1]));
      if (km) out.push({ v: km, u: 'km', l: 'Length' });
      const yr = one([...t.matchAll(/(?:commissioned|opened|completed|operational since|in service since)\s+(?:in\s+)?(?:[A-Z][a-z]{2,8}\s+)?((?:19|20)\d{2})(?!\s*[-–])/gi)].map(m => m[1]));
      if (yr) out.push({ v: yr, u: '', l: 'In service' });
    }
    return out;
  };
  const KICK = { 'Oil pipeline': 'oil', 'Oil field': 'oil', Refinery: 'oil', 'Gas pipeline': 'gas', 'Gas field': 'gas', 'LNG terminal': 'lng', Chokepoint: 'accent' };
  let assetCards = 0;
  for (const id of Object.keys(REG)) {
    if (!hasPage(id)) continue;
    const a = REG[id], st = statusOf(id), facts = assetFacts(a).slice(0, 3);
    const name = a.name.replace(/ \(.*\)/, '');
    // The description minus what the figures row already says. For chokepoints that also drops flow figures in
    // the text, so the card gives one number for a flow: the governed one from scenarios.json.
    const shown = new Set(facts.map(f => f.l));
    const dup = x => a.type === 'chokepoint' ? facts.length && /\b(bpd|b\/d|mb\/d)\b/i.test(x)
      : x.length < 60 && ((shown.has('Length') && /^~?[\d,]+\s*km\b/.test(x)) || (shown.has('Capacity') && /^(combined )?capacity\b/i.test(x)) || (shown.has('In service') && /^commissioned\b/i.test(x)));
    const lede = fit(sents(usDates(a.details)).filter(x => !dup(x)), facts.length ? 215 : 300);
    const stNote = st ? `<p class="why st"><b style="color:var(--${st.status})">${esc(STATUS_LABEL[st.status] || st.status)}${st.since ? ` since ${esc(fmtShort(st.since))}${st.since.slice(0, 4) === TODAY.slice(0, 4) ? '' : `, ${st.since.slice(0, 4)}`}` : ''}:</b> ${esc(fit(sents(usDates(st.summary)), 190))}</p>` : '';
    const why = a.geo ? `<p class="why"><b>Why it matters:</b> ${esc(fit(sents(usDates(a.geo)), 215))}</p>` : '';
    // Room for both the live status and the context only when there is no figures row; otherwise the status wins
    const note = facts.length ? (stNote || why) : stNote + why;
    writeFileSync(join(DIST, 'social', 'asset', `${id}.html`), darkCard(`
  <div class="top"><div class="brand">${LOGO}Strategic Energy Map</div><div class="kick" style="color:var(--${KICK[a.tag] || 'ink-3'})">Explainer · ${esc(a.tag)}</div></div>
  <h1${name.length > 24 ? ' class="long"' : ''}>${esc(name)}</h1>
  <p class="lede">${esc(lede)}</p>
  ${facts.length ? `<div class="facts">${facts.map(f => `<div><b>${esc(f.v)}${f.u ? `<small>${esc(f.u)}</small>` : ''}</b><span>${esc(f.l)}</span></div>`).join('')}</div>` : ''}
  ${note}
  <div class="foot">${st ? `<span class="chip" style="color:var(--${st.status});border-color:var(--${st.status})"><i style="background:var(--${st.status})"></i>${esc(STATUS_LABEL[st.status] || st.status)}</span>` : `<span>${a.verified ? `Figures checked ${esc(fmtShort(a.verified))}` : ''}</span>`}<span>${st && a.verified ? `Figures checked ${esc(fmtShort(a.verified))} · ` : ''}<b>strategicenergymap.org</b></span></div>
  <div class="map"><iframe src="/?embed=1&amp;bare&amp;card=${id}" title="" scrolling="no"></iframe><span>Map: Esri, HERE, Garmin, OpenStreetMap</span></div>`, `
  body { padding-right:514px; } .foot { right:514px; }
  .map { position:absolute; right:0; top:0; width:470px; height:675px; background:#f1ede3; } .map iframe { width:470px; height:675px; border:0; display:block; }
  .map::before { content:""; position:absolute; inset:0; pointer-events:none; box-shadow:inset 14px 0 24px -12px rgba(18,15,28,.55); z-index:1; }
  .map span { position:absolute; right:8px; bottom:8px; z-index:2; font-size:11.5px; color:#4a5568; background:rgba(255,255,255,.78); padding:2px 6px; border-radius:3px; }
  h1 { font-size:54px; line-height:1.05; font-weight:700; letter-spacing:-.02em; margin-top:30px; text-wrap:balance; } h1.long { font-size:44px; }
  .lede { font-size:${facts.length ? 21 : 24}px; line-height:1.4; color:var(--ink-2); margin-top:14px; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${facts.length ? 4 : 6}; overflow:hidden; }
  .facts { display:flex; gap:38px; margin-top:26px; } .facts b { display:block; font-size:46px; font-weight:700; letter-spacing:-.02em; line-height:1.1; font-variant-numeric:tabular-nums; white-space:nowrap; } .facts small { font-size:20px; font-weight:600; color:var(--ink-2); margin-left:4px; } .facts span { font-size:14px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.09em; font-weight:600; white-space:nowrap; }
  .why { margin-top:26px; padding-left:16px; border-left:3px solid var(--accent); font-size:18.5px; line-height:1.42; color:var(--ink-2); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:4; overflow:hidden; } .why b { color:var(--ink); } .why.st { border-color:var(--ink-3); }
  .chip { display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:600; border:1px solid; border-radius:20px; padding:6px 13px; } .chip i { width:9px; height:9px; border-radius:50%; }`));
    cards[`asset/${id}`] = { alt: clip(`${a.name}, ${lower(a.tag)}. ${st ? `Status: ${lower(STATUS_LABEL[st.status] || st.status)}. ` : ''}${facts.map(f => `${f.l}: ${f.v}${f.u === '%' ? '%' : f.u ? ` ${f.u}` : ''}`).join('; ')}${facts.length ? '. ' : ''}${firstSentences(a.details, 1)} With a map of its location.`, 950) };
    assetCards++;
  }

  // 3. Locator cards (light map look): one per event that can be posted and placed. The live map zoomed to where it
  // happened, with the headline, confidence label and sources. No card for a headline that reports a claim
  // ("X claims…", or "X says…" unless confirmed): those posts go out as text, like events with no location.
  mkdirSync(join(DIST, 'social', 'event'), { recursive: true });
  const claimTitle = e => /\bclaim(s|ed)?\b/i.test(e.title) || (e.confidence !== 'confirmed' && /\b(says?|said)\b/i.test(e.title));
  const publishers = e => [...new Set((e.sources || []).map(s => String(s.name || '').split(/\s[—–-]\s/)[0].trim()).filter(Boolean))].slice(0, 3);
  const LOGO_LIGHT = LOGO.replace('#2e2940', '#1a2332');
  let eventCards = 0;
  for (const e of events) {
    if (!['confirmed', 'reported'].includes(e.confidence) || claimTitle(e)) continue;
    // No coords: a physical event can be pinned at its first asset; a price or policy story has no "where", so no card
    if (!Array.isArray(e.coords) && !(REG[e.assets?.[0]] && ['shipping', 'military', 'infrastructure'].includes(e.category))) continue;
    const title = usDates(e.title), src = publishers(e);
    const related = (e.assets || []).filter(id => REG[id]).slice(0, 2);
    writeFileSync(join(DIST, 'social', 'event', `${e.id}.html`), `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><style>
  * { margin:0; box-sizing:border-box; } body { width:1200px; height:675px; position:relative; overflow:hidden; background:#f1ede3; color:#1a2332; font-family:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif; }
  iframe { width:1200px; height:675px; border:0; display:block; }
  .panel { position:absolute; left:36px; top:36px; bottom:36px; width:452px; background:#fff; border-radius:14px; box-shadow:0 6px 28px rgba(26,35,50,.22); padding:30px 32px; display:flex; flex-direction:column; }
  .kick { font-weight:600; font-size:15px; letter-spacing:.14em; text-transform:uppercase; color:#c0392b; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .conf { font-size:12.5px; letter-spacing:.08em; padding:6px 9px; border-radius:5px; background:#fdf0d9; color:#8a5a00; border:1px solid #f0d49a; } .conf.confirmed { background:#e3f3ea; color:#17603a; border-color:#b4dcc4; }
  h1 { font-size:${title.length <= 48 ? 42 : title.length <= 80 ? 35 : 29}px; line-height:1.1; font-weight:700; letter-spacing:-.015em; margin-top:20px; text-wrap:balance; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:7; overflow:hidden; }
  .rel { margin-top:22px; display:grid; gap:9px; font-size:18px; } .rel small { display:block; font-size:13px; letter-spacing:.1em; text-transform:uppercase; color:#6b7686; font-weight:600; } .rel div { display:flex; align-items:center; gap:10px; font-weight:600; }
  .pill { font-size:12.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#fff; padding:4px 8px; border-radius:4px; }
  .src { margin-top:auto; font-size:15px; color:#6b7686; border-top:1px solid rgba(0,0,0,.1); padding-top:14px; } .src b { color:#1a2332; font-weight:600; }
  .brand { margin-top:14px; display:flex; align-items:center; gap:10px; font-weight:700; font-size:16px; white-space:nowrap; } .brand span { margin-left:auto; font-weight:500; font-size:13px; color:#6b7686; }
  .credit { position:absolute; right:10px; bottom:8px; font-size:11.5px; color:#4a5568; background:rgba(255,255,255,.75); padding:2px 6px; border-radius:3px; }
</style></head><body><iframe src="/?embed=1&amp;bare&amp;card=${esc(e.id)}&amp;shift=230" title="" scrolling="no"></iframe>
<div class="panel"><div class="kick">${esc(e.category)} · ${esc(fmtShort(e.date))} <span class="conf ${esc(e.confidence)}">${esc(e.confidence)}</span></div>
  <h1>${esc(title)}</h1>
  ${related.length ? `<div class="rel"><small>On the map</small>${related.map(id => { const st = statusOf(id); return `<div>${esc(REG[id].name.replace(/ \(.*\)/, ''))}${st ? `<span class="pill" style="background:${STATUS_COLOR[st.status] || '#777'}">${esc(STATUS_LABEL[st.status] || st.status)}</span>` : ''}</div>`; }).join('')}</div>` : ''}
  ${src.length ? `<div class="src">Source${src.length > 1 ? 's' : ''}: <b>${esc(src.join(', '))}</b></div>` : ''}
  <div class="brand"${src.length ? '' : ' style="margin-top:auto"'}>${LOGO_LIGHT}Strategic Energy Map<span>strategicenergymap.org</span></div></div>
<div class="credit">Map: Esri, HERE, Garmin, OpenStreetMap contributors</div></body></html>`);
    cards[`event/${e.id}`] = { alt: clip(`Map showing where this happened, marked with a pin. ${title}. ${fmtDate(e.date)}. Confidence: ${e.confidence}.${src.length ? ` Sources: ${src.join(', ')}.` : ''}`, 950) };
    eventCards++;
  }

  // 4. Dashboard images (dark look), for chart posts: what is not operating normally, who depends on Hormuz, and
  // where diesel costs the most. Each mirrors a /dashboard/ panel.
  const dashCard = (title, sub, body, source, css) => darkCard(`
  <div class="top"><div class="brand">${LOGO}Strategic Energy Map</div><div class="kick">Dashboard · ${esc(fmtShort(statusData.updated))}, ${statusData.updated.slice(0, 4)}</div></div>
  <h1>${title}</h1><p class="sub">${esc(sub)}</p>${body}
  <div class="foot"><span>${esc(source)}</span><b>strategicenergymap.org/dashboard</b></div>`, `
  h1 { font-size:42px; line-height:1.05; font-weight:700; letter-spacing:-.015em; margin-top:24px; } h1 em { font-style:normal; color:var(--disrupted); } .sub { font-size:19px; color:var(--ink-2); margin-top:8px; } ${css}`);
  {
    const ORDER = Object.keys(STATUS_LABEL);
    const list = Object.entries(statusData.assets || {}).filter(([id]) => REG[id]).sort((a, b) => ORDER.indexOf(a[1].status) - ORDER.indexOf(b[1].status) || String(a[1].since || '').localeCompare(String(b[1].since || '')));
    const shownRows = list.slice(0, 20);
    writeFileSync(join(DIST, 'social', 'status-board.html'), dashCard(`<em>${list.length}</em> assets not operating normally`, 'Pipelines, terminals, refineries, fields and straits with a live disruption, and when each began',
      `<div class="grid">${shownRows.map(([id, st]) => `<div class="r"><i style="background:var(--${st.status})"></i><b>${esc(REG[id].name.replace(/ \(.*\)/, ''))}</b><span style="color:var(--${st.status})">${esc(STATUS_LABEL[st.status] || st.status)}</span><small>${st.since ? esc(fmtShort(st.since)) : ''}</small></div>`).join('')}</div>${list.length > shownRows.length ? `<p class="more">+ ${list.length - shownRows.length} more on the dashboard</p>` : ''}`,
      'Status: sourced per asset on each asset page', `
  .grid { margin-top:22px; display:grid; grid-template-columns:1fr 1fr; grid-auto-flow:column; grid-template-rows:repeat(${Math.ceil(shownRows.length / 2)}, auto); gap:0 34px; }
  .r { display:grid; grid-template-columns:12px 1fr auto 58px; align-items:center; gap:10px; height:${shownRows.length > 16 ? 38 : 44}px; border-bottom:1px solid var(--line-2); font-size:17px; }
  .r i { width:10px; height:10px; border-radius:50%; } .r b { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .r span { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; } .r small { font-size:14px; color:var(--ink-3); text-align:right; font-variant-numeric:tabular-nums; }
  .more { margin-top:10px; font-size:15px; color:var(--ink-3); }`));
    const cnt = {}; list.forEach(([, st]) => { cnt[st.status] = (cnt[st.status] || 0) + 1; });
    cards['status-board'] = { alt: clip(`${list.length} mapped assets are not operating normally as of ${fmtDate(statusData.updated)}: ${ORDER.filter(k => cnt[k]).map(k => `${cnt[k]} ${lower(STATUS_LABEL[k])}`).join(', ')}. They include ${shownRows.slice(0, 8).map(([id, st]) => `${REG[id].name.replace(/ \(.*\)/, '')} (${lower(STATUS_LABEL[st.status] || st.status)})`).join(', ')}.`, 950) };
  }
  {
    const hzSc = scenarios.chokepoints?.['strait-of-hormuz'], ex = (hzSc?.exposed || []).slice(0, 5);
    if (ex.length) {
      writeFileSync(join(DIST, 'social', 'importer-exposure.html'), dashCard('Who depends most on the Strait of Hormuz', `${n(hzSc.oil_mbd)} million barrels a day of oil passed through before the crisis${hzSc.lng_share_pct ? `, and ${n(hzSc.lng_share_pct, 0)}% of world LNG trade` : ''}`,
        `<div class="ex">${ex.map((x, i) => `<div class="x"><span>${i + 1}</span><b>${esc(x.country)}</b><p>${esc(clip(x.note, 120))}</p></div>`).join('')}</div>`,
        `Source: ${publishers(hzSc)[0] || 'IEA'}`, `
  .ex { margin-top:22px; } .x { display:grid; grid-template-columns:34px 250px 1fr; align-items:baseline; gap:10px; padding:13px 0; border-bottom:1px solid var(--line-2); }
  .x span { font-size:17px; color:var(--ink-3); font-variant-numeric:tabular-nums; } .x b { font-size:25px; font-weight:700; letter-spacing:-.01em; } .x p { font-size:17.5px; line-height:1.35; color:var(--ink-2); }`));
      cards['importer-exposure'] = { alt: clip(`Who depends most on the Strait of Hormuz. ${ex.map(x => `${x.country}: ${x.note}`).join(' ')}`, 950) };
    }
  }
  {
    const rows = fuelEntries.filter(e => e.group !== 'us-region' && e.id !== 'eu' && e.usd_per_litre?.diesel && e.diesel?.pre_crisis).sort((a, b) => b.usd_per_litre.diesel - a.usd_per_litre.diesel).slice(0, 10);
    if (rows.length) {
      const max = rows[0].usd_per_litre.diesel;
      writeFileSync(join(DIST, 'social', 'pump-price-ranking.html'), dashCard('Where diesel costs the most', `US dollars a litre in the week of ${fmtShort(fuel.as_of)}, with the change since the week before the crisis`,
        `<div class="pp">${rows.map(e => `<div class="p"><b>${esc(e.name)}</b><div class="t"><i style="width:${(e.usd_per_litre.diesel / max * 100).toFixed(1)}%"></i></div><span>$${n(e.usd_per_litre.diesel, 2)}</span><small>${signed(pct(e.diesel.now, e.diesel.pre_crisis))}</small></div>`).join('')}</div>`,
        'Sources: US EIA · EU Weekly Oil Bulletin · UK DESNZ · ECB exchange rates', `
  .pp { margin-top:20px; } .p { display:grid; grid-template-columns:210px 1fr 86px 70px; align-items:center; gap:14px; height:40px; font-size:19px; }
  .p b { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .t { height:20px; background:var(--surface-2); border-radius:4px; overflow:hidden; } .t i { display:block; height:100%; background:var(--oil); border-radius:4px; }
  .p span { font-weight:700; text-align:right; font-variant-numeric:tabular-nums; } .p small { font-size:16px; color:var(--oil); text-align:right; font-variant-numeric:tabular-nums; }`));
      cards['pump-price-ranking'] = { alt: clip(`Diesel prices in US dollars a litre, week of ${fmtDate(fuel.as_of)}, highest first: ${rows.map(e => `${e.name} $${n(e.usd_per_litre.diesel, 2)} (${signed(pct(e.diesel.now, e.diesel.pre_crisis))} since the week before the crisis)`).join('; ')}.`, 950) };
    }
  }
  writeFileSync(join(DIST, 'social', 'cards.json'), JSON.stringify(cards));
  console.log(`Social cards: daily board, ${assetCards} asset cards, ${eventCards} locator cards, 3 dashboard images.`);
}

// ── Charts: one page per chart, each with a dated takeaway, the chart, its data and sources ──
{
  const bars = (rows, { unit = '', zero = 0, max = null } = {}) => {
    const span = max ?? Math.max(...rows.map(r => Math.abs(r.v)), 1);
    return `<table class="data-table bar-table"><tbody>${rows.map(r => {
      const w = Math.abs(r.v) / span * (zero ? (r.v < 0 ? zero : 100 - zero) : 100);
      const left = zero ? (r.v < 0 ? zero - w : zero) : 0;
      return `<tr><th>${r.label}</th><td class="bar-cell"><span class="bar-track">${zero ? `<i class="bar-zero" style="left:${zero}%"></i>` : ''}<span class="bar" style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%;background:${r.color}"></span></span></td><td class="bar-val">${r.display}${r.extra ? ` <small>${r.extra}</small>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  };
  const charts = [];
  // 1. Oil flows through chokepoints
  const [top1, top2] = flowRows;
  charts.push({
    id: 'chokepoint-oil-flows', image: 'chokepoint-oil-flows',
    title: 'How much oil passes through each chokepoint?',
    seo: 'How much oil passes through the Strait of Hormuz, Malacca and other chokepoints (chart)',
    answer: `Before the 2026 crisis, the ${shortName(top1.id)} carried the most oil, about ${n(top1.c.oil_mbd)} million barrels a day, followed by the ${shortName(top2.id)} at ${n(top2.c.oil_mbd)} mb/d. Each is roughly a fifth of world oil demand (${DEMAND} mb/d). Much of the oil through Hormuz then passes Malacca too.`,
    lastmod: scenarios.chokepoints?.['strait-of-hormuz']?.sources?.[0]?.date?.length === 10 ? scenarios.chokepoints['strait-of-hormuz'].sources[0].date : null,
    chart: bars(flowRows.map(({ id, c }) => ({ label: link(id), v: c.oil_mbd, color: '#1a6bb5', display: `${n(c.oil_mbd)} mb/d`, extra: c.lng_share_pct ? `~${c.lng_share_pct}% of LNG trade` : '' }))),
    note: `${scenarios.globals?.note || ''} LNG shares are of global LNG trade.`,
    sources: [...new Map(flowRows.flatMap(({ c }) => c.sources || []).concat(scenarios.globals?.sources || []).map(s => [s.url, s])).values()],
    data: '/data/scenarios.json',
  });
  // 2. Hormuz bypass
  if (hormuz) {
    const sc = hormuz.c;
    charts.push({
      id: 'hormuz-bypass', image: 'hormuz-bypass',
      title: 'How much Hormuz oil can be rerouted?',
      seo: 'Can oil bypass the Strait of Hormuz? Pipeline capacity vs flow (chart)',
      answer: `Only a fraction. About ${n(hormuz.stranded)} million barrels a day of oil crossed the Strait of Hormuz before the 2026 crisis, but pipelines around it had only about ${n(hormuz.bypass)} mb/d of spare capacity (IEA, low estimate). That leaves roughly ${n(hormuz.shortfall)} mb/d with no alternative route, about ${n(hormuz.pctDemand, 0)}% of world oil demand.`,
      lastmod: statusData.updated,
      chart: bars([
        { label: 'Oil through Hormuz before the war', v: hormuz.stranded, color: '#1a2332', display: `${n(hormuz.stranded)} mb/d` },
        ...hormuz.usable.map(b => ({ label: `Spare capacity: ${link(b.asset)}`, v: b.spare_mbd, color: '#1e8a4c', display: `${n(b.spare_mbd)} mb/d` })),
        { label: '<b>No alternative route</b>', v: hormuz.shortfall, color: '#b3261e', display: `<b>${n(hormuz.shortfall)} mb/d</b>` },
      ], { max: hormuz.stranded }),
      note: `${sc.bypass_note || ''}${hormuz.impaired.length ? ` Not counted because an asset is out of service: ${hormuz.impaired.map(b => REG[b.asset]?.name).join(', ')}.` : ''} Bypass capacity reflects the current status of each pipeline and its export terminal on this map.`,
      sources: [...(sc.sources || []), ...(scenarios.globals?.sources || [])],
      data: '/data/scenarios.json',
    });
  }
  // 3. Tanker traffic vs baseline (IMF PortWatch, refreshed every build)
  if (tankerChange.length) {
    const worst = tankerChange[0], last = tankerChange.map(x => x.d.lastDate).sort().pop();
    charts.push({
      id: 'chokepoint-tanker-traffic', image: 'chokepoints-weekly',
      title: 'Tanker traffic through energy chokepoints',
      seo: 'Tanker traffic through Hormuz, Suez and other chokepoints this week vs before the crisis (chart)',
      answer: `In the week to ${fmtDate(last)}, tanker transits through the ${shortName(worst.id)} averaged ${n(worst.d.now)} a day, ${Math.abs(worst.p).toFixed(0)}% ${worst.p < 0 ? 'below' : 'above'} the ${BASELINE.label}, the largest change of any chokepoint tracked. IMF PortWatch counts ships from satellite AIS signals; ships with transponders off are missed.`,
      lastmod: last,
      chart: bars(tankerChange.map(({ id, d, p }) => ({ label: link(id), v: p, color: p < 0 ? '#b3261e' : '#1e8a4c', display: signed(p), extra: `${n(d.now)}/day` })), { zero: 70, max: Math.max(100, ...tankerChange.map(x => Math.abs(x.p))) }),
      note: `7-day average of daily tanker transits vs the ${BASELINE.label}. Data has about a week's lag.`,
      sources: [{ name: 'IMF PortWatch', url: 'https://portwatch.imf.org/' }],
      data: null,
    });
  }
  // 4. Diesel prices since the crisis
  if (dieselChange.length) {
    const hi = dieselChange[0], lo = dieselChange[dieselChange.length - 1];
    charts.push({
      id: 'diesel-prices-since-hormuz', image: 'fuel-weekly',
      title: 'Diesel prices since the Strait of Hormuz closed',
      seo: 'How much have diesel prices risen since the Hormuz closure? US, EU and UK (chart)',
      answer: `Since the week of ${PRE}, before the Strait of Hormuz closed, diesel has risen ${signed(hi.p)} in ${hi.e.name} and ${signed(lo.p)} in ${lo.e.name}, the largest and smallest rises among the markets shown. Figures are for the week of ${fmtDate(fuel.as_of)}, from official weekly price statistics.`,
      lastmod: fuel.as_of,
      chart: bars(dieselChange.map(({ e, p }) => ({ label: `<a href="/fuel-prices/${e.id}/">${esc(e.name)}</a>`, v: p, color: '#b3261e', display: signed(p), extra: `${esc(money(e, e.diesel.now))}${e.unit === '$/gal' ? '/gal' : '/L'}` }))),
      note: `Change in the weekly average retail diesel price, including taxes, since the week of ${PRE}.`,
      sources: [...new Map(dieselChange.map(({ e }) => [e.source.url, e.source])).values()],
      data: '/data/fuel.json',
    });
  }
  for (const c of charts) {
    write(`/charts/${c.id}/`, layout({
      path: `/charts/${c.id}/`, lastmod: c.lastmod,
      title: `${c.seo} | Strategic Energy Map`, description: c.answer.slice(0, 300),
      crumbs: [{ name: 'Charts', url: '/charts/' }, { name: c.title, url: `/charts/${c.id}/` }],
      jsonld: [{ '@context': 'https://schema.org', '@type': 'Dataset', name: c.title, description: c.answer,
        creator: { '@type': 'Person', name: 'Courtney Wilson', url: LINKEDIN }, license: 'https://creativecommons.org/licenses/by/4.0/',
        isBasedOn: c.sources.map(s => s.url).filter(safeUrl),
        ...(c.data ? { distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: SITE + c.data }] } : {}) }],
      body: `<p class="kicker">Chart</p>
<h1>${esc(c.title)}</h1>
<div class="answer"><p>${esc(c.answer)}</p><p class="note">${c.lastmod ? `Updated ${esc(fmtDate(c.lastmod))} · ` : ''}<a href="/">Explore the live map →</a></p></div>
<figure class="bar-chart">${c.chart}</figure>
<p class="note">${esc(c.note)}</p>
${sourcesHTML(c.sources)}
<p class="note">Free to reuse with credit to strategicenergymap.org (CC BY 4.0).${c.data ? ` <a href="${c.data}">Download the data (JSON)</a>.` : ''}</p>
<p class="more">More charts: ${charts.filter(x => x !== c).map(x => `<a href="/charts/${x.id}/">${esc(x.title)}</a>`).join(' · ')}</p>`,
    }));
  }
  write('/charts/', layout({
    path: '/charts/', lastmod: [...charts.map(c => c.lastmod)].filter(Boolean).sort().pop(),
    title: 'Energy crisis charts: oil flows, chokepoints and fuel prices | Strategic Energy Map',
    description: 'Charts on oil flows through chokepoints, how much Hormuz oil can be rerouted, live tanker traffic and diesel prices since the 2026 crisis, each with its data and sources.',
    crumbs: [{ name: 'Charts', url: '/charts/' }],
    body: `<h1>Charts</h1>
<div class="answer"><p>Charts on the 2026 energy crisis: how much oil moves through each chokepoint, how much of it can be rerouted, live tanker traffic and pump prices. Each chart comes with its data, method and sources, and is free to reuse with credit.</p></div>
${charts.map(c => `<section class="chart-card"><h2><a href="/charts/${c.id}/">${esc(c.title)}</a></h2><p>${esc(c.answer)}</p></section>`).join('')}`,
  }));
}

// ── Data dashboard (/dashboard/) and open data (/data/v1/: CSV + JSON per dataset, plus the dashboard bundle) ──
{
  const V1 = join(DIST, 'data', 'v1');
  mkdirSync(V1, { recursive: true });
  const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
  const cut = (t, k) => { const s = String(t || ''); return s.length > k ? s.slice(0, k).replace(/\s+\S*$/, '') + '…' : s; };
  const round = (v, dp = 1) => v == null || isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;
  // Spreadsheet-safe CSV: quote when needed, and neutralise text that a spreadsheet would run as a formula
  const csvCell = v => { if (v == null) return ''; if (typeof v === 'number') return String(v); let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const ASSET_TYPES = [['chokepoints', 'chokepoint'], ['pipelines', 'pipeline'], ['fields', 'field'], ['sites', 'site'], ['routes', 'route']];
  const register = ASSET_TYPES.flatMap(([k, type]) => (infra[k] || []).map(a => ({ a, type })));
  const assetUrl = (id, type) => type === 'route' ? '/' : urlFor(id);
  const centre = a => Array.isArray(a.coords?.[0]) ? a.coords[Math.floor(a.coords.length / 2)] : a.coords;
  const srcNames = list => (list || []).map(x => x.name).join(' | ');
  const srcUrls = list => (list || []).map(x => safeUrl(x.url)).filter(Boolean).join(' | ');
  const hz = statusOf('strait-of-hormuz');

  const sets = [
    { k: 'chokepoint-transits', name: 'Chokepoint transits', desc: 'Daily tanker and vessel transits through each chokepoint IMF PortWatch tracks, since September 2025.', freq: 'Daily, about a week behind', source: 'IMF PortWatch (satellite AIS)',
      cols: ['date', 'chokepoint_id', 'chokepoint', 'tankers', 'all_vessels'],
      rows: Object.entries(pw).filter(([, d]) => d?.rows).flatMap(([id, d]) => d.rows.map(r => ({ date: r.date, chokepoint_id: id, chokepoint: REG[id]?.name || id, tankers: r.t, all_vessels: r.all }))),
      updated: Object.values(pw).filter(Boolean).map(d => d.lastDate).sort().pop() },
    { k: 'pump-prices', name: 'Pump prices', desc: 'Weekly retail petrol and diesel prices, including taxes, for the US and its regions, every EU country, the EU average and the UK.', freq: 'Weekly', source: 'US EIA, EU Weekly Oil Bulletin, UK DESNZ',
      cols: ['week', 'area_id', 'area', 'group', 'fuel', 'price', 'unit', 'currency', 'change_since_pre_crisis_pct'],
      rows: fuelEntries.flatMap(e => ['petrol', 'diesel'].filter(f => e[f]?.history).flatMap(f => e[f].history.map(([d, v]) => ({ week: d, area_id: e.id, area: e.name, group: e.group, fuel: f, price: v, unit: e.unit, currency: e.currency, change_since_pre_crisis_pct: round(pct(v, e[f].pre_crisis)) })))),
      updated: fuel.as_of },
    { k: 'market-benchmarks', name: 'Market benchmarks', desc: 'Brent, WTI, TTF, JKM and Henry Hub: latest close, a week earlier, the pre-crisis reference and the wartime peak.', freq: 'Daily', source: 'Exchange and market data, cited per row',
      cols: ['benchmark', 'label', 'unit', 'value', 'as_of', 'week_ago', 'pre_crisis', 'peak', 'peak_date', 'source', 'source_url'],
      rows: (market.benchmarks || []).map(b => ({ benchmark: b.id, label: b.label, unit: b.unit, value: b.value, as_of: b.source?.date || market.as_of, week_ago: b.week_ago, pre_crisis: b.pre_crisis, peak: b.peak?.value ?? null, peak_date: b.peak?.date || null, source: b.source?.name, source_url: safeUrl(b.source?.url) })),
      updated: market.as_of },
    { k: 'infrastructure-status', name: 'Infrastructure status', desc: 'Every mapped asset with a live disruption: status, start date, confidence, summary and sources.', freq: 'Daily', source: 'Sourced per asset',
      cols: ['asset_id', 'asset', 'status', 'since', 'updated', 'confidence', 'summary', 'sources', 'source_urls'],
      rows: Object.entries(statusData.assets || {}).map(([id, st]) => ({ asset_id: id, asset: REG[id]?.name || id, status: st.status, since: st.since || null, updated: st.updated || null, confidence: st.confidence || null, summary: st.summary, sources: srcNames(st.sources), source_urls: srcUrls(st.sources) })),
      updated: statusData.updated },
    { k: 'asset-register', name: 'Asset register', desc: 'Every pipeline, field, terminal, refinery, chokepoint and tanker route on the map.', freq: 'As assets are added', source: 'Global Energy Monitor, EIA, operators',
      cols: ['id', 'name', 'type', 'kind', 'lat', 'lon', 'capacity', 'capacity_unit', 'status', 'url', 'description'],
      rows: register.map(({ a, type }) => { const c = centre(a) || []; return { id: a.id, name: a.name, type, kind: a.commodity || a.kind || null, lat: c[0] ?? null, lon: c[1] ?? null, capacity: a.capacity?.value ?? (a.volume_mbd ?? null), capacity_unit: a.capacity?.unit || (a.volume_mbd != null ? 'mb/d' : null), status: statusOf(a.id)?.status || null, url: SITE + assetUrl(a.id, type), description: a.details || null }; }),
      updated: statusData.updated },
    { k: 'events', name: 'Event log', desc: 'Dated, sourced events since 28 February 2026, with category, severity and confidence.', freq: 'Daily', source: 'Sourced per event',
      cols: ['date', 'id', 'title', 'summary', 'category', 'severity', 'confidence', 'assets', 'sources', 'source_urls'],
      rows: events.map(e => ({ date: e.date, id: e.id, title: e.title, summary: e.summary, category: e.category, severity: e.severity, confidence: e.confidence, assets: (e.assets || []).join(' '), sources: srcNames(e.sources), source_urls: srcUrls(e.sources) })),
      updated: eventsData.updated },
  ].filter(d => d.rows.length);
  for (const d of sets) {
    writeFileSync(join(V1, `${d.k}.csv`), [d.cols.join(','), ...d.rows.map(r => d.cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n');
    writeFileSync(join(V1, `${d.k}.json`), JSON.stringify({ name: d.name, description: d.desc, source: d.source, updated: d.updated || null, license: LICENSE, attribution: 'Strategic Energy Infrastructure Map (strategicenergymap.org)', columns: d.cols, rows: d.rows }));
  }
  const downloads = Object.fromEntries(sets.map(d => [d.k, `/data/v1/${d.k}.csv`]));

  // Bundle the interactive panels read (dashboard.js)
  const ser = (e, s) => s && { now: s.now, wk: s.week_ago, pre: s.pre_crisis, date: s.date || e.date, h: (s.history || []).filter(x => x[0] >= '2025-12-01') };
  writeFileSync(join(V1, 'dashboard.json'), JSON.stringify({
    updated: statusData.updated, fuel_as_of: fuel.as_of, market_as_of: market.as_of, pre_crisis: fuel.pre_crisis_date,
    fx: { eur: fuel.fx?.usd_per_eur, gbp: fuel.fx?.usd_per_gbp, date: fuel.fx?.date }, world_demand: DEMAND, downloads,
    reg: register.map(({ a, type }) => ({ id: a.id, name: a.name, type, sub: a.commodity || a.kind || '', d: cut(firstSentences(a.details, 1), 170), vol: a.volume_mbd, u: assetUrl(a.id, type) })),
    status: Object.entries(statusData.assets || {}).map(([id, st]) => ({ id, status: st.status, since: st.since || null, updated: st.updated || null, conf: st.confidence || null, summary: cut(st.summary, 320),
      src: (st.sources || []).slice(0, 3).map(x => ({ n: x.name, u: x.url })), nsrc: (st.sources || []).length })),
    cps: infra.chokepoints.map(c => { const sc = scenarios.chokepoints?.[c.id], cl = closure(c.id); return { id: c.id, name: c.name, oil: sc?.oil_mbd ?? null, bypass: cl ? round(cl.bypass) : 0, pw: pw[c.id]?.rows ? pw[c.id].rows.map(r => [r.date, r.t, r.all]) : null }; }),
    fuel: fuelEntries.map(e => ({ id: e.id, name: e.name, group: e.group, cur: e.currency, unit: e.unit, petrol: ser(e, e.petrol), diesel: ser(e, e.diesel) })),
    events: events.map(e => ({ id: e.id, date: e.date, t: e.title, s: cut(e.summary, 260), cat: e.category, sev: e.severity, conf: e.confidence, assets: e.assets || [], src: e.sources?.[0] ? { n: e.sources[0].name, u: e.sources[0].url } : null, nsrc: (e.sources || []).length })),
    market: (market.benchmarks || []).map(b => ({ id: b.id, label: b.label, unit: b.unit, v: b.value, wk: b.week_ago, pre: b.pre_crisis, peak: b.peak ? { v: b.peak.value ?? null, d: b.peak.date || null } : null, src: b.source ? { n: b.source.name, u: b.source.url, d: b.source.date } : null })),
  }));

  // Static, crawlable parts of the page; dashboard.js adds the interactive panels
  const bm = id => (market.benchmarks || []).find(b => b.id === id);
  const brent = bm('brent'), us = fuelEntries.find(e => e.id === 'us'), eu = fuelEntries.find(e => e.id === 'eu');
  const hzLive = pw['strait-of-hormuz'];
  const disrupted = Object.keys(statusData.assets || {}).length;
  const hzLine = !hz ? 'the Strait of Hormuz has no recorded disruption' : hz.status === 'closed' ? `the Strait of Hormuz has been effectively closed to normal traffic since ${fmtDate(hz.since || '2026-02-28')}` : `traffic through the Strait of Hormuz is ${lower(STATUS_LABEL[hz.status] || hz.status)}`;
  const answer = `As of ${fmtDate(statusData.updated)}, ${hzLine}. ${disrupted} mapped energy assets are closed, damaged, disrupted or running reduced, and ${events.length} sourced events have been logged since the war began. ${brent ? `Brent closed at $${n(brent.value, 2)} a barrel, ${signed(pct(brent.value, brent.pre_crisis))} on the week of ${PRE}.` : ''}`;
  const tile = (href, label, date, value, unit, delta) => `<a class="kpi" href="${href}"><div class="kpi-l">${esc(label)} <small>${esc(date)}</small></div><div class="kpi-v">${value}<small>${esc(unit)}</small></div><div class="kpi-d">${delta}</div></a>`;
  const short = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  const deltaSpan = p => `<span class="${p == null ? '' : p > 0.5 ? 'up' : p < -0.5 ? 'down' : ''}">${signed(p)}</span> since 23 Feb`;
  const kpiTiles = [
    ...['brent', 'ttf', 'jkm'].map(bm).filter(Boolean).map(b => tile('#prices', b.label, short(b.source?.date || market.as_of), n(b.value, 2), b.unit, deltaSpan(pct(b.value, b.pre_crisis)))),
    hzLive ? tile('#chokepoints', 'Hormuz tankers per day', `7-day avg to ${short(hzLive.lastDate)}`, n(hzLive.now), `vs ${n(hzLive.base, 0)} before`, `${signed(pct(hzLive.now, hzLive.base))} against the Sep–Feb average`) : '',
    us?.diesel ? tile('#prices', 'US diesel, national average', short(us.diesel.date || us.date), n(us.diesel.now, 2), us.unit, deltaSpan(pct(us.diesel.now, us.diesel.pre_crisis))) : '',
    eu?.diesel ? tile('#prices', 'EU diesel, weighted average', short(eu.diesel.date || eu.date), n(eu.diesel.now, 2), eu.unit, deltaSpan(pct(eu.diesel.now, eu.diesel.pre_crisis))) : '',
    tile('#infrastructure', 'Assets with a live disruption', short(statusData.updated), String(disrupted), `of ${register.length} mapped`, 'closed, damaged, disrupted or reduced'),
    tile('#events', 'Sourced events logged', 'since 28 Feb', String(events.length), '', `${events.filter(e => e.severity === 'critical').length} critical`),
  ].join('');
  const mktRows = (market.benchmarks || []).map(b => { const p = pct(b.value, b.pre_crisis); return `<tr><td><b>${esc(b.label)}</b><span class="sub">${esc(b.unit)}</span></td><td class="n"><b>${n(b.value, 2)}</b></td><td class="n">${n(b.week_ago, 2)}</td><td class="n">${n(b.pre_crisis, 2)}</td><td class="n">${b.peak?.value != null ? `${n(b.peak.value, 2)}<span class="sub">${esc(fmtDate(b.peak.date))}</span>` : '—'}</td><td class="n"><span class="${p > 0.5 ? 'up' : p < -0.5 ? 'down' : ''}">${signed(p)}</span></td><td>${safeUrl(b.source?.url) ? `<a href="${esc(b.source.url)}" target="_blank" rel="noopener">${esc(String(b.source.name).split(' — ')[0])}</a>` : esc(b.source?.name)}<span class="sub">${esc(fmtDate(b.source?.date))}</span></td></tr>`; }).join('');
  const dsCards = sets.map(d => `<article class="ds"><h3>${esc(d.name)}<span>${d.rows.length.toLocaleString('en-US')} rows</span></h3><p>${esc(d.desc)}</p>
    <dl><dt>Updated</dt><dd>${esc(fmtDate(d.updated))} · ${esc(d.freq)}</dd><dt>Source</dt><dd>${esc(d.source)}</dd><dt>Columns</dt><dd>${esc(d.cols.join(', '))}</dd></dl>
    <div class="tools"><a class="tool" href="/data/v1/${d.k}.csv" download>CSV</a><a class="tool" href="/data/v1/${d.k}.json">JSON</a></div></article>`).join('');
  const cite = `Strategic Energy Infrastructure Map. "The 2026 energy crisis in numbers." Data as of ${fmtDate(statusData.updated)}. ${SITE}/dashboard/. Licensed CC BY 4.0.`;
  const sourceTypes = (() => { try { const S = read('sources.json'); return { n: (S.sources || []).length, updated: S.updated }; } catch (e) { return null; } })();
  const qa = [
    ['Where can I download data on the 2026 energy crisis?', `This page offers ${sets.length} free datasets as CSV and JSON: ${sets.map(d => d.name.toLowerCase()).join(', ')}. They are rebuilt from the site's sourced data on every update and licensed CC BY 4.0, so you can reuse them with credit to strategicenergymap.org.`],
    ['How much have fuel prices risen since the Strait of Hormuz closed?', `Compared with the week of ${PRE}: ${[us?.diesel && `US diesel ${signed(pct(us.diesel.now, us.diesel.pre_crisis))}`, eu?.diesel && `EU average diesel ${signed(pct(eu.diesel.now, eu.diesel.pre_crisis))}`, brent && `Brent crude ${signed(pct(brent.value, brent.pre_crisis))}`].filter(Boolean).join(', ')}, as of the latest weekly figures (week of ${fmtDate(fuel.as_of)}).`],
    ...(hzLive ? [['How many tankers are crossing the Strait of Hormuz?', `IMF PortWatch satellite tracking recorded an average of ${n(hzLive.now)} tankers a day in the week to ${fmtDate(hzLive.lastDate)}, against ${n(hzLive.base)} a day in the ${BASELINE.label}. Ships sailing with transponders off are not counted.`]] : []),
  ];
  const body = `
<div class="head">
  <div class="eyebrow">Data dashboard</div>
  <h1>The 2026 energy crisis in numbers</h1>
  <p class="answer">${esc(answer)}</p>
  <div class="dateline"><span>Updated <b>${esc(fmtDate(statusData.updated))}</b></span><span>Pump prices: week of <b>${esc(fmtDate(fuel.as_of))}</b></span><span>Benchmarks as of <b>${esc(fmtDate(market.as_of))}</b></span><span>Baseline week <b>${esc(PRE)}</b></span></div>
  ${eventsData.situation_headline ? `<div class="headline"><span>Latest</span>${esc(eventsData.situation_headline)}</div>` : ''}
</div>
<nav class="index" aria-label="Sections"><div class="idx">
  <a href="#overview">Overview</a><a href="#chokepoints">Chokepoints</a><a href="#prices">Prices</a><a href="#infrastructure">Infrastructure</a><a href="#events">Events</a><a href="#exposure">Exposure</a><a href="#data">Data &amp; sources</a>
  <span class="grow"></span><a class="dl" href="#data">Download the data</a>
</div></nav>
<div class="dash-main" id="dash" data-src="/data/v1/dashboard.json?v=${createHash('sha256').update(readFileSync(join(V1, 'dashboard.json'))).digest('hex').slice(0, 10)}">

<section class="panel" id="overview">
  <div class="ph"><div><h2>Overview</h2><p>Headline figures, each compared with the pre-crisis reference week of ${esc(PRE)}.</p></div><div class="tools" data-tools="market-benchmarks"></div></div>
  <div class="kpis" id="kpis">${kpiTiles}</div>
</section>

<section class="panel" id="chokepoints">
  <div class="ph"><div><h2>Chokepoint traffic</h2><p>Tankers per day (7-day average) against the ${esc(BASELINE.label)}. Select a row to chart it.</p></div><div class="tools" data-tools="chokepoint-transits"></div></div>
  <div class="split">
    <div>
      <div class="cardhead"><h3 id="cpTitle">Strait of Hormuz: tankers per day</h3><div class="seg" id="cpMetric"><button type="button" data-v="1" aria-pressed="true">Tankers</button><button type="button" data-v="2" aria-pressed="false">All vessels</button></div></div>
      <div class="callout" id="cpCallout"></div>
      <div class="chart" id="cpChart"><p class="loading">Loading the chart…</p></div>
    </div>
    <div class="tablewrap"><table id="cpTable"><thead><tr><th>Chokepoint</th><th class="n">Oil flow</th><th class="n">Now</th><th class="n">vs baseline</th><th>Trend</th></tr></thead><tbody></tbody></table></div>
  </div>
  <p class="src">Transits: <a href="https://portwatch.imf.org/" target="_blank" rel="noopener">IMF PortWatch</a> (satellite AIS, about a week behind)${hzLive ? `, latest day ${esc(fmtDate(hzLive.lastDate))}` : ''}. Ships sailing with transponders off are not counted. Oil flows: EIA and IEA (<a href="/about.html#whatif">method</a>).</p>
</section>

<section class="panel" id="prices">
  <div class="ph"><div><h2>Prices</h2><p>Official weekly pump prices for the US, the EU and the UK (${fuelEntries.length} series), plus oil and gas benchmarks. Asia isn't covered yet; see the Asia tab.</p></div><div class="tools" data-tools="pump-prices"></div></div>
  <div class="controls">
    <span><span class="ctl-label">Fuel</span><span class="seg" id="fuelSeg"><button type="button" data-v="diesel" aria-pressed="true">Diesel</button><button type="button" data-v="petrol" aria-pressed="false">Petrol</button></span></span>
    <span><span class="ctl-label">Show</span><span class="seg" id="measureSeg"><button type="button" data-v="pct" aria-pressed="true">% since 23 Feb</button><button type="button" data-v="usd" aria-pressed="false">US$ per litre</button><button type="button" data-v="local" aria-pressed="false">Local price</button></span></span>
  </div>
  <div class="picker">
    <div class="controls" style="margin-bottom:0"><span class="ctl-label">Compare</span><span class="seg" id="presetSeg"><button type="button" data-v="economies" aria-pressed="true">Largest economies</button><button type="button" data-v="rises" aria-pressed="false">Biggest rises</button><button type="button" data-v="falls" aria-pressed="false">Smallest rises</button><button type="button" data-v="usregions" aria-pressed="false">US regions</button></span></div>
    <p class="pick-help" id="pickHelp"></p>
    <div class="controls" style="margin-bottom:0"><div class="chips" id="selChips"></div><select id="addSel" aria-label="Add an area to the chart"></select></div>
  </div>
  <div class="split">
    <div><div class="chart" id="priceChart"><p class="loading">Loading the chart…</p></div><p class="src" id="priceNote"></p></div>
    <div>
      <div class="controls" style="margin-bottom:8px"><span class="seg" id="groupSeg"><button type="button" data-v="country" aria-pressed="true">Countries</button><button type="button" data-v="us-region" aria-pressed="false">US regions</button><button type="button" data-v="asia" aria-pressed="false">Asia <span class="gap-dot" aria-label="not covered yet"></span></button></span><input type="search" id="priceSearch" placeholder="Filter countries" aria-label="Filter countries"></div>
      <div class="tablewrap" id="priceWrap" style="max-height:430px;overflow-y:auto"><table id="priceTable"><thead><tr><th class="cb"><span class="vh">Chart</span></th><th><button type="button" data-k="name">Country</button></th><th class="n"><button type="button" data-k="now">Price</button></th><th class="n"><button type="button" data-k="usd">US$/l</button></th><th><button type="button" data-k="chg" data-dir="desc">Since 23 Feb</button></th></tr></thead><tbody></tbody></table></div>
      <div id="asiaGap" hidden><div class="gap-box"><b>Not covered yet.</b> The EIA estimates that 84% of the crude oil moving through the Strait of Hormuz in 2024 went to Asian markets, so Asian pump prices are a gap we plan to fill. Many Asian governments set or subsidise fuel prices, which means the strain often shows up as sudden official price changes rather than weekly drift. <a href="https://www.eia.gov/todayinenergy/detail.php?id=65504" target="_blank" rel="noopener">EIA, June 2025</a></div></div>
    </div>
  </div>
  <h3 class="sub-h">Benchmarks</h3>
  <div class="tablewrap"><table id="mktTable"><thead><tr><th>Benchmark</th><th class="n">Latest</th><th class="n">Week ago</th><th class="n">Pre-crisis</th><th class="n">Wartime peak</th><th class="n">Since 23 Feb</th><th>Source</th></tr></thead><tbody>${mktRows}</tbody></table></div>
  <p class="src">Pump prices: US EIA, EU Weekly Oil Bulletin, UK DESNZ, including taxes. US$ conversions use ECB reference rates of ${esc(fmtDate(fuel.fx?.date))} for every week.</p>
</section>

<section class="panel" id="infrastructure">
  <div class="ph"><div><h2>Infrastructure status</h2><p>Every asset with a live disruption, and the full register of mapped infrastructure.</p></div><div class="tools" data-tools="infrastructure-status"></div></div>
  <div class="statusbar" id="statusBar"></div>
  <div class="legend" id="statusLegend"></div>
  <div class="assets" id="assetCards"><p class="loading">Loading…</p></div>
  <h3 class="sub-h">Asset register <span class="controls" style="margin:0"><input type="search" id="regSearch" placeholder="Search ${register.length} assets" aria-label="Search assets"><select id="regType" aria-label="Asset type"><option value="">All types</option><option value="chokepoint">Chokepoints</option><option value="pipeline">Pipelines</option><option value="field">Fields</option><option value="site">Sites</option><option value="route">Routes</option></select></span></h3>
  <div class="tablewrap"><table id="regTable"><thead><tr><th>Asset</th><th>Type</th><th>Status</th><th>Key fact</th></tr></thead><tbody></tbody></table></div>
  <button class="more" id="regMore" type="button" hidden></button>
</section>

<section class="panel" id="events">
  <div class="ph"><div><h2>Event log</h2><p>Every sourced event since the war began, by week and severity. Select a bar to filter to that week.</p></div><div class="tools" data-tools="events"></div></div>
  <div class="chart" id="evChart"><p class="loading">Loading the chart…</p></div>
  <div class="legend" id="evLegend" style="margin-top:6px"></div>
  <div class="controls" style="margin-top:14px"><span class="ctl-label">Category</span><div class="chips" id="catChips"></div></div>
  <div class="controls"><input type="search" id="evSearch" placeholder="Search events" aria-label="Search events"><span id="evCount" class="kpi-d"></span><span class="chips" id="evActive"></span></div>
  <div class="evlist" id="evList"></div>
  <button class="more" id="evMore" type="button" hidden></button>
  <p class="src">Full archive with every source: <a href="/events/">events</a> · <a href="/events.xml">RSS feed</a>.</p>
</section>

<section class="panel" id="exposure">
  <div class="ph"><div><h2>Exposure</h2><p>Oil normally moving through each chokepoint, and how much spare pipeline capacity could route around it.</p></div></div>
  <div class="legend" style="margin-bottom:12px"><span><i style="background:var(--oil)"></i>Oil flow, mb/d</span><span><i style="background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 2px,var(--oil) 2px,var(--oil) 4px)"></i>Usable bypass capacity</span></div>
  <div class="expo" id="expo"><p class="loading">Loading…</p></div>
  <p class="src">World oil demand ${DEMAND} mb/d. ${esc(scenarios.globals?.note || '')} Bypass excludes pipelines whose route or export terminal is currently out of service. <a href="/about.html#whatif">How the model works</a>.</p>
</section>

<section class="panel" id="data">
  <div class="ph"><div><h2>Data &amp; sources</h2><p>Every dataset behind this page, free to download and reuse. Files are rebuilt on every update at stable URLs, so tools and newsrooms can pull them directly.</p></div></div>
  <div class="datasets">${dsCards}</div>
  <p class="licence">Licensed <a href="${LICENSE}" target="_blank" rel="noopener">CC BY 4.0</a>: reuse freely, with credit to strategicenergymap.org. Underlying figures come from the sources named in each file. ${sourceTypes ? `${sourceTypes.n} registered sources, reviewed monthly.` : ''} <a href="/about.html#rule">Sourcing rule</a>.</p>
  <div class="codebox"><div class="row"><h3>Cite this page</h3><button class="tool" type="button" data-copy="citeText" data-label="Citation">Copy</button></div><pre id="citeText">${esc(cite)}</pre></div>
</section>

<section class="panel faq-panel">${faqHTML(qa)}</section>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  const ver = f => createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 10);
  for (const f of ['dashboard.css', 'dashboard.js']) cpSync(join(ROOT, f), join(DIST, f));
  write('/dashboard/', layout({
    path: '/dashboard/', lastmod: statusData.updated, type: 'website',
    title: '2026 energy crisis dashboard: shipping, fuel prices, infrastructure and events data | Strategic Energy Map',
    description: answer.slice(0, 300),
    crumbs: [{ name: 'Dashboard', url: '/dashboard/' }],
    css: [`/dashboard.css?v=${ver('dashboard.css')}`], scripts: [`/dashboard.js?v=${ver('dashboard.js')}`], bodyClass: 'dash', mainClass: 'dash-wrap',
    jsonld: [faqLd(qa), { '@context': 'https://schema.org', '@type': 'Dataset', name: '2026 energy crisis data: shipping, fuel prices, infrastructure status and events',
      description: `Open data behind the Strategic Energy Map dashboard: ${sets.map(d => d.name.toLowerCase()).join(', ')}.`, url: `${SITE}/dashboard/`, license: LICENSE,
      creator: { '@type': 'Person', name: 'Courtney Wilson', url: LINKEDIN }, temporalCoverage: `${BASELINE.from}/${statusData.updated}`, dateModified: statusData.updated,
      isBasedOn: ['https://portwatch.imf.org/', 'https://www.eia.gov/petroleum/gasdiesel/', 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en'],
      distribution: sets.flatMap(d => [{ '@type': 'DataDownload', name: d.name, encodingFormat: 'text/csv', contentUrl: `${SITE}/data/v1/${d.k}.csv` }, { '@type': 'DataDownload', name: d.name, encodingFormat: 'application/json', contentUrl: `${SITE}/data/v1/${d.k}.json` }]) }],
    body,
  }));
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
