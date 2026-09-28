/* Strategic Energy Infrastructure Map
 * All content comes from data/*.json (see agent/SCHEMA.md). This file only renders it.
 */
(async function () {
'use strict';

// ── Constants ──
const PORTWATCH = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const BASELINE = { from: '2025-09-01', to: '2026-02-27', label: 'Sep 2025–Feb 2026 avg' };

const STATUS = {
  closed:    { label: 'Closed',    color: '#b3261e' },
  damaged:   { label: 'Damaged',   color: '#d63031' },
  offline:   { label: 'Offline',   color: '#6c7a89' },
  disrupted: { label: 'Disrupted', color: '#e67e22' },
  reduced:   { label: 'Reduced',   color: '#d4a017' },
};
const SEVERITY = { critical: '#b3261e', high: '#e67e22', medium: '#d4a017', low: '#8a94a6' };
const COLORS = { gas: '#1a6bb5', oil: '#c75000', lng: '#0e9aa7', production: '#2ecc71', refinery: '#9b59b6', hub: '#f1c40f' };
const REGIONS = {
  world:    [[-45, -130], [70, 150]],
  americas: [[-40, -125], [58, -50]],
  europe:   [[34, -12], [66, 45]],
  mideast:  [[10, 30], [42, 64]],
  asia:     [[-8, 60], [60, 145]],
};

// ── Helpers ──
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);
const fmtDate = d => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
const daysAgo = d => (Date.now() - new Date(d + 'T00:00:00Z')) / 86400000;
const fmtN = (n, dp = 1) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(dp);

async function loadJSON(path, fallback) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('Could not load', path, e);
    return fallback;
  }
}

const [infra, statusData, eventsData, market, scenarios, fuel] = await Promise.all([
  loadJSON('data/infrastructure.json', { pipelines: [], sites: [], fields: [], chokepoints: [], routes: [] }),
  loadJSON('data/status.json', { assets: {} }),
  loadJSON('data/events.json', { events: [] }),
  loadJSON('data/market.json', { benchmarks: [] }),
  loadJSON('data/scenarios.json', { chokepoints: {}, globals: {} }),
  loadJSON('data/fuel.json', { entries: [] }),
]);
const pageIndex = await loadJSON('pages.json', { facilities: [], chokepoints: [], fuel: [] });
const pageUrl = id => pageIndex.chokepoints.includes(id) ? `/chokepoints/${id}/` : pageIndex.facilities.includes(id) ? `/facilities/${id}/` : null;
const statusOf = id => statusData.assets?.[id] || null;
const events = (eventsData.events || []).slice().sort((a, b) => b.date.localeCompare(a.date));

// ── Embed mode (?embed=1): map only, for iframes and link-preview images ──
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) {
  document.body.classList.add('embed');
  if (!params.has('bare')) {
    const a = document.createElement('a');
    a.className = 'embed-badge'; a.href = 'https://strategicenergymap.org/'; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = 'Strategic Energy Infrastructure Map <span>↗</span>';
    document.body.appendChild(a);
  }
}

// ── Map ──
const map = L.map('map', { center: [30, 40], zoom: 3, minZoom: 2, maxZoom: 10, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: '&copy; Esri, HERE, Garmin &copy; OpenStreetMap contributors · Transits: IMF PortWatch', maxZoom: 16,
}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);

const LAYERS = [
  { key: 'gas',        label: 'Gas pipelines',         sw: `<span class="sw-line" style="background:${COLORS.gas}"></span>` },
  { key: 'oil',        label: 'Oil pipelines',         sw: `<span class="sw-dash" style="border-color:${COLORS.oil}"></span>` },
  { key: 'routes',     label: 'Tanker & LNG routes',   sw: `<span class="sw-dash" style="border-color:#777;border-top-width:2px"></span>` },
  { key: 'oilfield',   label: 'Oil fields',            sw: `<span class="sw-field" style="border-color:#c0641e;background:rgba(192,100,30,.25)"></span>` },
  { key: 'gasfield',   label: 'Gas fields',            sw: `<span class="sw-field" style="border-color:${COLORS.gas};background:rgba(26,107,181,.2)"></span>` },
  { key: 'production', label: 'Production sites',      sw: `<span class="sw-circle" style="background:${COLORS.production}"></span>` },
  { key: 'refinery',   label: 'Refineries',            sw: `<span class="sw-diamond" style="background:${COLORS.refinery}"></span>` },
  { key: 'lng',        label: 'LNG terminals',         sw: `<span class="sw-hex" style="background:${COLORS.lng}"></span>` },
  { key: 'hub',        label: 'Ports & transit hubs',  sw: `<span class="sw-circle" style="background:${COLORS.hub}"></span>` },
  { key: 'choke',      label: 'Chokepoints',           sw: `<span class="sw-tri"></span>` },
  { key: 'events',     label: 'Recent events',         sw: `<span class="sw-circle pulse" style="background:${SEVERITY.high};--pc:rgba(230,126,34,.6)"></span>` },
  { key: 'fuel',       label: 'Pump prices',           sw: `<span class="sw-circle" style="background:linear-gradient(90deg,#fde0c5,#b3261e)"></span>`, off: true },
  { key: 'status',     label: 'Status overlay',        sw: `<span class="status-dot" style="background:transparent;border:2px solid ${STATUS.disrupted.color}"></span>` },
];
const groups = {};
LAYERS.forEach(l => { groups[l.key] = L.layerGroup(); if (!l.off) groups[l.key].addTo(map); });
const scenarioLayer = L.layerGroup().addTo(map);
const counts = {};

// Registry of every asset by id, so status, events and scenarios can find them
const REG = {};

// ── Geometry helpers ──
function bearing(a, b) {
  const r = d => d * Math.PI / 180;
  const dLon = r(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(r(b[0]));
  const x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function arrows(coords, color, layer, size = 10, every = 1) {
  for (let i = 0; i < coords.length - 1; i += every) {
    const a = coords[i], b = coords[i + 1];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    layer.addLayer(L.marker(mid, {
      interactive: false,
      icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: `<svg width="${size}" height="${size}" viewBox="0 0 10 10" style="transform:rotate(${bearing(a, b)}deg)"><polygon points="5,0 10,10 5,7 0,10" fill="${color}" fill-opacity="0.8"/></svg>` }),
    }));
  }
}
const midpoint = coords => coords[Math.floor(coords.length / 2)];

// ── Renderers ──
function register(id, entry) { REG[id] = entry; }
function bump(k) { counts[k] = (counts[k] || 0) + 1; }

infra.pipelines.forEach(p => {
  const layer = groups[p.commodity];
  const color = COLORS[p.commodity];
  const glow = L.polyline(p.coords, { color, weight: 10, opacity: 0.16, interactive: false });
  const line = L.polyline(p.coords, { color, weight: 3.5, opacity: 0.92, dashArray: p.commodity === 'oil' ? '8 4' : null });
  line.on('mouseover', () => { line.setStyle({ weight: 6 }); glow.setStyle({ opacity: 0.3 }); });
  line.on('mouseout', () => { line.setStyle({ weight: 3.5 }); glow.setStyle({ opacity: 0.16 }); });
  line.on('click', () => showDetail(p.id));
  line.bindTooltip(p.name, { sticky: true });
  layer.addLayer(glow); layer.addLayer(line);
  arrows(p.coords, p.commodity === 'gas' ? '#0d4a80' : '#8a3800', layer);
  register(p.id, { type: 'pipeline', data: p, center: midpoint(p.coords), coords: p.coords, tag: p.commodity === 'gas' ? 'Gas pipeline' : 'Oil pipeline' });
  bump(p.commodity);
});

infra.routes.forEach(r => {
  const color = r.commodity === 'lng' ? '#0b7f89' : '#666';
  const line = L.polyline(r.coords, { color, weight: 1.6, opacity: r.alternative ? 0.25 : 0.45, dashArray: r.alternative ? '2 8' : '4 8' });
  line.bindTooltip(r.name + (r.note ? ` — ${r.note}` : ''), { sticky: true });
  groups.routes.addLayer(line);
  arrows(r.coords, color, groups.routes, 8, 2);
  register(r.id, { type: 'route', data: r, center: midpoint(r.coords), coords: r.coords, tag: 'Shipping route' });
  bump('routes');
});

const SITE_TAG = { production: 'Production site', refinery: 'Refinery', hub: 'Port / transit hub', lng: 'LNG terminal' };
infra.sites.forEach(s => {
  let m;
  if (s.kind === 'refinery') {
    m = L.marker(s.coords, { icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: `<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1.5" transform="rotate(45 7 7)" fill="${COLORS.refinery}" fill-opacity="0.85" stroke="#333" stroke-opacity="0.4"/></svg>` }) });
  } else if (s.kind === 'lng') {
    m = L.marker(s.coords, { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
      html: `<svg width="16" height="16" viewBox="0 0 16 16"><polygon points="4,1 12,1 15,8 12,15 4,15 1,8" fill="${COLORS.lng}" fill-opacity="0.9" stroke="#fff" stroke-width="1.2"/></svg>` }) });
  } else {
    m = L.circleMarker(s.coords, { radius: s.size || 5, fillColor: COLORS[s.kind] || '#999', color: '#333', weight: 1.5, opacity: 0.5, fillOpacity: 0.8 });
  }
  m.bindTooltip(s.name);
  m.on('click', () => showDetail(s.id));
  groups[s.kind]?.addLayer(m);
  register(s.id, { type: 'site', data: s, center: s.coords, tag: SITE_TAG[s.kind] || 'Site' });
  bump(s.kind);
});

infra.fields.forEach(f => {
  const isOil = f.commodity === 'oil';
  const m = L.circleMarker(f.coords, {
    radius: f.size || 10, color: isOil ? '#c0641e' : COLORS.gas, weight: 1.5, opacity: 0.7, dashArray: '4 3',
    fillColor: isOil ? 'rgba(192,100,30,0.25)' : 'rgba(26,107,181,0.2)', fillOpacity: 1,
  });
  m.bindTooltip(f.name);
  m.on('click', () => showDetail(f.id));
  m.on('mouseover', () => m.setStyle({ weight: 2.5, opacity: 1 }));
  m.on('mouseout', () => m.setStyle({ weight: 1.5, opacity: 0.7 }));
  groups[isOil ? 'oilfield' : 'gasfield'].addLayer(m);
  register(f.id, { type: 'field', data: f, center: f.coords, tag: isOil ? 'Oil field' : 'Gas field' });
  bump(isOil ? 'oilfield' : 'gasfield');
});

infra.chokepoints.forEach(c => {
  const m = L.marker(c.coords, { zIndexOffset: 500, icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 17],
    html: `<svg width="22" height="22" viewBox="0 0 20 20"><polygon points="10,2 18,16 2,16" fill="#c0392b" fill-opacity="0.9" stroke="#333" stroke-opacity="0.4"/></svg>` }) });
  m.bindTooltip(c.name);
  m.on('click', () => showDetail(c.id));
  groups.choke.addLayer(m);
  register(c.id, { type: 'chokepoint', data: c, center: c.coords, tag: 'Chokepoint' });
  bump('choke');
});

// ── Status overlay ──
Object.entries(statusData.assets || {}).forEach(([id, st]) => {
  const a = REG[id], s = STATUS[st.status];
  if (!a || !s) return;
  const tip = `${a.data.name}: ${s.label}`;
  if (a.type === 'pipeline') {
    const l = L.polyline(a.coords, { color: s.color, weight: 7, opacity: 0.55, dashArray: '2 10', lineCap: 'round' });
    l.bindTooltip(tip, { sticky: true }); l.on('click', () => showDetail(id));
    groups.status.addLayer(l);
  } else {
    const m = L.marker(a.center, { zIndexOffset: 400, icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="pulse" style="width:26px;height:26px;border:3px solid ${s.color};--pc:${s.color}99"></div>` }) });
    m.bindTooltip(tip); m.on('click', () => showDetail(id));
    groups.status.addLayer(m);
  }
});
$('#statusLegend').innerHTML = Object.values(STATUS).map(s =>
  `<div class="row"><span class="status-dot" style="border:3px solid ${s.color}"></span>${s.label}</div>`).join('') +
  `<div class="note">Ringed assets are not operating normally. Click for sources.</div>`;

// ── Event markers ──
events.filter(e => Array.isArray(e.coords) && daysAgo(e.date) <= 60).forEach(e => {
  const c = SEVERITY[e.severity] || SEVERITY.low;
  const recent = daysAgo(e.date) <= 14;
  const m = L.marker(e.coords, { zIndexOffset: 600, icon: L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    html: `<div class="${recent ? 'pulse' : ''}" style="width:12px;height:12px;border-radius:50%;background:${c};border:2px solid #fff;--pc:${c}aa"></div>` }) });
  m.bindTooltip(`${fmtDate(e.date)} — ${e.title}`);
  m.on('click', () => showEvent(e.id));
  groups.events.addLayer(m);
});
counts.events = groups.events.getLayers().length;
counts.status = Object.keys(statusData.assets || {}).length;

// ── Layer list ──
$('#layerList').innerHTML = LAYERS.map(l => `
  <label class="layer-row"><input type="checkbox" data-layer="${l.key}" ${l.off ? '' : 'checked'}>
  <span class="sw">${l.sw}</span>${l.label}<span class="count">${counts[l.key] || 0}</span></label>`).join('');
$('#layerList').addEventListener('change', e => {
  const g = groups[e.target.dataset.layer];
  if (g) e.target.checked ? map.addLayer(g) : map.removeLayer(g);
});
// ── Collapsible panels: sidebar toggles on desktop (state remembered), bottom sheet on phones ──
const mobileQuery = window.matchMedia('(max-width: 760px)');
const isMobile = () => mobileQuery.matches;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const panels = { left: true, right: true };
function initPanels() {
  if (isMobile()) { panels.left = false; panels.right = false; }
  else { panels.left = store.get('sem.left') !== '0'; panels.right = store.get('sem.right') !== '0'; }
  applyPanels();
}
function applyPanels() {
  document.body.classList.toggle('left-collapsed', !panels.left);
  document.body.classList.toggle('right-collapsed', !panels.right);
  const l = $('#toggleLeft'), r = $('#toggleRight'), h = $('#sheetHandle');
  l.setAttribute('aria-expanded', String(panels.left)); l.title = panels.left ? 'Hide layers' : 'Show layers';
  r.setAttribute('aria-expanded', String(panels.right)); r.title = panels.right ? 'Hide panel' : 'Show panel';
  h.setAttribute('aria-expanded', String(panels.right));
  $('#leftPanel').inert = !panels.left;
  $('#leftPanel').style.top = isMobile() ? `${$('.topbar').getBoundingClientRect().bottom + 8}px` : '';
  $('#rightPanel').inert = !panels.right && !isMobile(); // the phone sheet keeps its tab row usable when minimised
}
function setPanel(side, open) {
  if (panels[side] === open) return;
  panels[side] = open;
  if (!isMobile()) store.set(`sem.${side}`, open ? '1' : '0');
  applyPanels();
}
$('#toggleLeft').addEventListener('click', () => setPanel('left', !panels.left));
$('#toggleRight').addEventListener('click', () => setPanel('right', !panels.right));
$('#sheetHandle').addEventListener('click', () => setPanel('right', !panels.right));
map.on('click', () => { if (isMobile()) setPanel('left', false); });
// Phone sheet: swipe the handle or tab row up to expand, down to minimise
{
  let startY = null;
  const zone = [$('#sheetHandle'), $('.tabs')];
  zone.forEach(el => {
    el.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (startY == null || !isMobile()) return;
      const dy = e.changedTouches[0].clientY - startY; startY = null;
      if (dy > 40) setPanel('right', false); else if (dy < -40) setPanel('right', true);
    }, { passive: true });
  });
}
mobileQuery.addEventListener('change', initPanels);
initPanels();

// Centre a point in the part of the map not covered by panels
function focusMap(latlng, zoom) {
  let dx = 0, dy = 0;
  if (isMobile()) { if (panels.right) dy = $('#rightPanel').offsetHeight / 2; }
  else {
    if (panels.right) dx += ($('#rightPanel').offsetWidth + 10) / 2;
    if (panels.left) dx -= ($('#leftPanel').offsetWidth + 10) / 2;
  }
  const target = map.unproject(map.project(latlng, zoom).add([dx, dy]), zoom);
  map.flyTo(target, zoom, { duration: 0.8 });
}

// ── Regions ──
$('#regions').addEventListener('click', e => {
  const b = REGIONS[e.target.dataset.region];
  if (b) map.flyToBounds(b, { ...panelPadding(), duration: 0.8 });
});
function panelPadding() { // keep regions clear of whichever panels are open
  if (EMBED) return {};
  if (typeof panels === 'undefined' || isMobile()) return { paddingTopLeft: [0, 100], paddingBottomRight: [0, 70] };
  return { paddingTopLeft: [panels.left ? 240 : 0, 70], paddingBottomRight: [panels.right ? 390 : 0, 10] };
}
map.fitBounds(REGIONS[params.get('region')] || REGIONS.world, EMBED ? {} : panelPadding());

// ── Top bar: freshness + market ticker ──
function renderFreshness(pwDate) {
  const bits = [];
  if (statusData.updated) bits.push(`News scan ${fmtDate(statusData.updated)}`);
  if (market.as_of) bits.push(`Prices ${fmtDate(market.as_of)}`);
  if (fuel.as_of) bits.push(`Pump ${fmtDate(fuel.as_of)}`);
  if (pwDate) bits.push(`Ship transits ${fmtDate(pwDate)}`);
  $('#freshness').textContent = bits.length ? bits.join(' · ') : 'Baseline data';
}
renderFreshness();
const pumpTicks = ['us', 'eu', 'uk'].map(id => fuel.entries?.find(e => e.id === id)).filter(Boolean).flatMap(e =>
  [['petrol', e.id === 'us' ? 'gasoline' : 'petrol'], ['diesel', 'diesel']].filter(([k]) => e[k]).map(([k, word]) => ({
    label: `${e.id === 'eu' ? 'EU' : e.id.toUpperCase()} ${word}`, unit: e.unit, value: e[k].now, pre_crisis: e[k].pre_crisis,
    source: { name: e.source.name, date: e[k].date } })));
$('#ticker').innerHTML = [...(market.benchmarks || []), ...pumpTicks].map(b => {
  const ref = b.pre_crisis ?? b.week_ago;
  const pct = ref ? ((b.value - ref) / ref) * 100 : null;
  const cls = pct == null ? '' : pct >= 0 ? 'up' : 'down';
  const refLbl = b.pre_crisis != null ? 'vs pre-crisis' : 'vs week ago';
  const src = b.source?.name ? ` title="${esc(b.source.name)} · ${esc(b.source.date || market.as_of)}"` : '';
  return `<div class="tick"${src}><span class="lbl">${esc(b.label)} <small>${esc(b.unit)}</small></span>
    <span><b>${fmtN(b.value, b.value < 20 ? 2 : 1)}</b> ${pct == null ? '' : `<span class="${cls}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%</span> <span class="lbl">${refLbl}</span>`}</span></div>`;
}).join('');

// ── Right panel tabs ──
let currentTab = 'latest';
function setTab(t) {
  currentTab = t;
  if (typeof panels !== 'undefined') setPanel('right', true); // opening a tab reveals a minimised or hidden panel
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  ['latest', 'chokepoints', 'fuel', 'scenario', 'detail'].forEach(k => $('#tab-' + k).classList.toggle('hidden', k !== t));
}
$('.tabs').addEventListener('click', e => {
  const t = e.target.dataset.tab;
  if (!t) return;
  setTab(t);
  if (t === 'fuel') setLayer('fuel', true);
});
function setLayer(key, on) {
  const cb = document.querySelector(`[data-layer="${key}"]`);
  if (cb) cb.checked = on;
  on ? map.addLayer(groups[key]) : map.removeLayer(groups[key]);
}

function sourcesHTML(sources) {
  if (!sources?.length) return '';
  return `<div class="sources">Sources: ${sources.map(s => {
    const u = safeUrl(s.url);
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name);
  }).join('')}</div>`;
}
function confHTML(c) { return c ? `<span class="conf ${esc(c)}">${esc(c)}</span>` : ''; }

// ── Latest tab ──
const evFilter = { window: 30, category: 'all' };
let situationOpen = false;
function renderLatest() {
  const cats = ['all', ...new Set(events.map(e => e.category))];
  const list = events.filter(e => (evFilter.window === 0 || daysAgo(e.date) <= evFilter.window) && (evFilter.category === 'all' || e.category === evFilter.category));
  const situation = eventsData.situation_summary
    ? `<details class="situation"${situationOpen ? ' open' : ''}><summary><b>Situation${eventsData.updated ? ' · ' + esc(fmtDate(eventsData.updated)) : ''}</b><span class="clamp">${esc(eventsData.situation_summary)}</span></summary><div class="full">${esc(eventsData.situation_summary)}</div></details>` : '';
  $('#tab-latest').innerHTML = situation + `
    <div class="filters">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']].map(([v, l]) =>
      `<button class="chip ${evFilter.window === v ? 'on' : ''}" data-window="${v}">${l}</button>`).join('')}</div>
    <div class="filters">${cats.map(c => `<button class="chip ${evFilter.category === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${list.length ? list.map(eventHTML).join('') : `<div class="empty">${events.length ? 'No events in this window.' : 'No events logged yet. The update agent will populate this feed.'}</div>`}`;
}
function eventHTML(e) {
  return `<div class="event" data-event="${esc(e.id)}">
    <div class="ev-meta"><span class="sev" style="background:${SEVERITY[e.severity] || SEVERITY.low}"></span>${esc(fmtDate(e.date))} · ${esc(e.category)} ${confHTML(e.confidence)}</div>
    <div class="ev-title">${esc(e.title)}</div>
    <div class="ev-sum">${esc(e.summary)}</div>
    ${sourcesHTML(e.sources)}
  </div>`;
}
$('#tab-latest').addEventListener('toggle', e => { if (e.target.matches('.situation')) situationOpen = e.target.open; }, true);
$('#tab-latest').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.window !== undefined) { evFilter.window = +t.dataset.window; renderLatest(); return; }
  if (t.dataset.cat) { evFilter.category = t.dataset.cat; renderLatest(); return; }
  if (t.closest('a')) return;
  const ev = t.closest('[data-event]');
  if (ev) showEvent(ev.dataset.event, false);
});
function showEvent(id, openPanel = true) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  if (e.coords) focusMap(e.coords, Math.max(map.getZoom(), 5));
  else if (e.assets?.[0] && REG[e.assets[0]]) focusMap(REG[e.assets[0]].center, Math.max(map.getZoom(), 5));
  if (openPanel) {
    if (e.assets?.length && REG[e.assets[0]]) showDetail(e.assets[0], false);
    else { evFilter.window = 0; setTab('latest'); renderLatest(); }
  }
}

// ── Detail view ──
function statusBox(st) {
  if (!st) return '';
  const s = STATUS[st.status] || { label: st.status, color: '#999' };
  return `<div class="statusbox" style="border-color:${s.color}">
    <b style="color:${s.color}">${esc(s.label)}${st.since ? ' since ' + esc(fmtDate(st.since)) : ''} ${confHTML(st.confidence)}</b>
    ${esc(st.summary)}<div class="note">Verified ${esc(fmtDate(st.updated))}</div>${sourcesHTML(st.sources)}</div>`;
}
function showDetail(id, fly = false) {
  const a = REG[id];
  if (!a) return;
  if (fly) focusMap(a.center, Math.max(map.getZoom(), 5));
  const d = a.data;
  const related = events.filter(e => e.assets?.includes(id));
  const sc = scenarios.chokepoints?.[id];
  $('#tab-detail').innerHTML = `
    <button class="back" data-back>← Back</button>
    <div class="detail">
      <span class="tag">${esc(a.tag)}</span>
      <h3>${esc(d.name)}</h3>
      ${pageUrl(id) ? `<p class="note" style="margin:0 0 6px"><a href="${pageUrl(id)}">Full page with sources and FAQ →</a></p>` : ''}
      ${statusBox(statusOf(id))}
      ${a.type === 'chokepoint' ? `<div id="cpLive"></div>` : ''}
      ${sc ? `<div class="btn-row"><button class="btn primary" data-simulate="${esc(id)}">${closed.has(id) ? 'Remove from scenario' : 'Simulate closure'}</button></div>` : ''}
      <div class="body">${esc(d.details)}</div>
      ${d.geo ? `<div class="geo"><b>Geopolitical context</b>${esc(d.geo)}</div>` : ''}
      ${related.length ? `<div class="geo"><b>Related developments</b>${related.slice(0, 8).map(eventHTML).join('')}</div>` : ''}
    </div>`;
  setTab('detail');
  if (a.type === 'chokepoint' && sc?.portwatch) renderLiveBlock(id, $('#cpLive'));
}
$('#tab-detail').addEventListener('click', e => {
  if (e.target.dataset.back !== undefined) { setTab(lastListTab); return; }
  if (e.target.dataset.simulate) { toggleClosure(e.target.dataset.simulate); showDetail(e.target.dataset.simulate); return; }
  const ev = e.target.closest('[data-event]');
  if (ev && !e.target.closest('a')) showEvent(ev.dataset.event, false);
});
let lastListTab = 'latest';
document.querySelector('.tabs').addEventListener('click', e => { if (e.target.dataset.tab && e.target.dataset.tab !== 'detail') lastListTab = e.target.dataset.tab; });

// ── Live chokepoint transits (IMF PortWatch) ──
const pwCache = {};
function pwFetch(name) {
  if (pwCache[name]) return pwCache[name];
  const params = new URLSearchParams({
    where: `portname='${name.replace(/'/g, "''")}' AND date >= DATE '${BASELINE.from}'`,
    outFields: 'date,n_tanker,n_total', orderByFields: 'date', returnGeometry: 'false', resultRecordCount: '2000', f: 'json',
  });
  pwCache[name] = fetch(`${PORTWATCH}?${params}`).then(r => r.json()).then(j => {
    const rows = (j.features || []).map(f => f.attributes).map(a => ({ date: String(a.date).slice(0, 10), tankers: a.n_tanker, total: a.n_total }));
    if (!rows.length) throw new Error('no data');
    const base = rows.filter(r => r.date >= BASELINE.from && r.date <= BASELINE.to);
    const avg = (arr, k) => arr.reduce((s, r) => s + r[k], 0) / (arr.length || 1);
    const last7 = rows.slice(-7);
    const roll = rows.map((r, i) => ({ date: r.date, v: avg(rows.slice(Math.max(0, i - 6), i + 1), 'tankers') }));
    return { rows, roll, lastDate: rows[rows.length - 1].date, now: avg(last7, 'tankers'), nowTotal: avg(last7, 'total'), base: avg(base, 'tankers'), baseTotal: avg(base, 'total') };
  });
  pwCache[name].catch(() => delete pwCache[name]);
  return pwCache[name];
}
function sparkline(roll, base) {
  const W = 300, H = 42, pts = roll;
  const max = Math.max(base, ...pts.map(p => p.v)) * 1.1 || 1;
  const x = i => (i / (pts.length - 1)) * W, y = v => H - (v / max) * H;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tanker transits, 7-day average">
    <line x1="0" x2="${W}" y1="${y(base)}" y2="${y(base)}" stroke="#8a94a6" stroke-dasharray="3 3" stroke-width="1"/>
    <path d="${path}" fill="none" stroke="#1a6bb5" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>
    <div class="note" style="margin-top:0;display:flex;justify-content:space-between"><span>${esc(fmtDate(pts[0].date))}</span><span>dashed = ${BASELINE.label}</span><span>${esc(fmtDate(pts[pts.length - 1].date))}</span></div>`;
}
function liveStatsHTML(d) {
  const pct = d.base ? ((d.now - d.base) / d.base) * 100 : 0;
  return `<div class="cp-stats"><span>Tankers/day <b>${fmtN(d.now)}</b></span><span>Baseline <b>${fmtN(d.base)}</b></span>
    <span class="${pct < -10 ? 'delta-down' : pct > 10 ? 'delta-up' : ''}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span><span>All ships <b>${fmtN(d.nowTotal, 0)}</b>/day</span></div>`;
}
async function renderLiveBlock(id, el) {
  if (!el) return;
  const name = scenarios.chokepoints[id].portwatch;
  el.innerHTML = `<div class="note">Loading live transits…</div>`;
  try {
    const d = await pwFetch(name);
    el.innerHTML = `<div class="geo" style="border:none;margin-top:0;padding-top:0"><b>Live ship transits (7-day avg)</b>${liveStatsHTML(d)}${sparkline(d.roll, d.base)}</div>`;
    renderFreshness(d.lastDate);
  } catch (e) { el.innerHTML = `<div class="note">Live transit data unavailable right now.</div>`; }
}

// ── Chokepoints tab ──
async function renderChokepoints() {
  const ids = Object.keys(scenarios.chokepoints || {}).filter(id => REG[id]);
  $('#tab-chokepoints').innerHTML = ids.map(id => {
    const st = statusOf(id), s = st && STATUS[st.status];
    return `<div class="cp" data-cp="${id}"><div class="cp-head"><span class="cp-name">${esc(REG[id].data.name)}</span>
      ${s ? `<span class="pill" style="background:${s.color}">${s.label}</span>` : ''}</div><div class="cp-live"><div class="note">Loading…</div></div></div>`;
  }).join('') + `<div class="note">Daily transit counts from <a href="https://portwatch.imf.org/" target="_blank" rel="noopener">IMF PortWatch</a> (AIS satellite data, typically ~1 week lag). Tankers include crude, product and gas carriers.</div>`;
  let latest = null;
  await Promise.all(ids.map(async id => {
    const el = $(`[data-cp="${id}"] .cp-live`);
    try {
      const d = await pwFetch(scenarios.chokepoints[id].portwatch);
      el.innerHTML = liveStatsHTML(d) + sparkline(d.roll, d.base);
      if (!latest || d.lastDate > latest) latest = d.lastDate;
    } catch { el.innerHTML = `<div class="note">Live data unavailable.</div>`; }
  }));
  if (latest) renderFreshness(latest);
}
$('#tab-chokepoints').addEventListener('click', e => {
  const cp = e.target.closest('[data-cp]');
  if (cp && !e.target.closest('a')) showDetail(cp.dataset.cp, true);
});

// ── What-if scenario engine ──
const closed = new Set();
function toggleClosure(id) { closed.has(id) ? closed.delete(id) : closed.add(id); applyScenario(); }

function scenarioResult() {
  const g = scenarios.globals || {};
  let stranded = 0, rerouted = 0, bypass = 0, lng = 0, maxDays = 0;
  const bypassUsed = [], bypassImpaired = [], exposed = new Map(), strandedAssets = new Set();
  closed.forEach(id => {
    const c = scenarios.chokepoints[id];
    if (!c) return;
    if (c.reroute === 'none') { stranded += c.oil_mbd || 0; lng += c.lng_share_pct || 0; }
    else { rerouted += c.oil_mbd || 0; maxDays = Math.max(maxDays, c.reroute_days || 0); }
    (c.bypass || []).forEach(b => {
      // A bypass is only as good as the pipeline and the terminal it exports through
      const checks = [[b.asset, statusOf(b.asset)], [b.outlet, b.outlet && statusOf(b.outlet)]].filter(([, st]) => st);
      const down = checks.find(([, st]) => ['offline', 'damaged', 'closed'].includes(st.status));
      if (down) bypassImpaired.push({ ...b, where: down[0], st: down[1] });
      else if (b.spare_mbd) { bypass += b.spare_mbd; bypassUsed.push({ ...b, degraded: checks.map(([id, st]) => ({ id, st })) }); }
    });
    (c.exposed || []).forEach(x => { if (!exposed.has(x.country)) exposed.set(x.country, x.note); });
    (c.stranded || []).forEach(a => strandedAssets.add(a));
  });
  const shortfall = Math.max(0, stranded - bypass);
  return { stranded, rerouted, bypass, shortfall, lng: Math.min(lng, 100), maxDays, bypassUsed, bypassImpaired, exposed, strandedAssets,
    pctDemand: g.world_oil_demand_mbd ? shortfall / g.world_oil_demand_mbd * 100 : null,
    stockDays: shortfall > 0 && g.iea_emergency_stocks_mb ? g.iea_emergency_stocks_mb / shortfall : null };
}

function applyScenario() {
  scenarioLayer.clearLayers();
  const r = scenarioResult();
  if (closed.size) {
    // Closed chokepoints
    closed.forEach(id => {
      const a = REG[id]; if (!a) return;
      scenarioLayer.addLayer(L.marker(a.center, { zIndexOffset: 1000, interactive: false, icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
        html: `<div class="pulse" style="width:34px;height:34px;background:rgba(179,38,30,.85);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px">✕</div>` }) }));
    });
    // Routes: cut vs. diversion
    const anyCape = [...closed].some(id => scenarios.chokepoints[id]?.reroute === 'cape');
    infra.routes.forEach(rt => {
      const cut = rt.via.some(v => closed.has(v));
      if (cut) scenarioLayer.addLayer(L.polyline(rt.coords, { color: '#b3261e', weight: 4, opacity: 0.8, dashArray: '6 8', interactive: false }));
      else if (rt.alternative && anyCape) scenarioLayer.addLayer(L.polyline(rt.coords, { color: '#1e8a4c', weight: 4, opacity: 0.75, dashArray: '10 6', interactive: false }));
    });
    // Stranded assets and bypass infrastructure
    r.strandedAssets.forEach(id => {
      const a = REG[id]; if (!a) return;
      if (a.type === 'pipeline') scenarioLayer.addLayer(L.polyline(a.coords, { color: '#555', weight: 8, opacity: 0.35, interactive: false }));
      else scenarioLayer.addLayer(L.circleMarker(a.center, { radius: 11, color: '#b3261e', weight: 2, fillColor: '#333', fillOpacity: 0.35, interactive: false }));
    });
    r.bypassUsed.forEach(b => {
      const a = REG[b.asset]; if (!a) return;
      scenarioLayer.addLayer(L.polyline(a.coords, { color: '#1e8a4c', weight: 9, opacity: 0.45, interactive: false }));
    });
    $('#scenarioBar').innerHTML = `<span><b>What-if:</b> ${[...closed].map(id => esc(REG[id]?.data.name)).join(' + ')} closed — net shortfall ${fmtN(r.shortfall)} mb/d</span>
      <button data-sc-open>Details</button><button data-sc-reset>Reset</button>`;
    $('#scenarioBar').classList.remove('hidden');
  } else {
    $('#scenarioBar').classList.add('hidden');
  }
  renderScenario();
}
$('#scenarioBar').addEventListener('click', e => {
  if (e.target.dataset.scReset !== undefined) { closed.clear(); applyScenario(); }
  if (e.target.dataset.scOpen !== undefined) setTab('scenario');
});

function renderScenario() {
  const ids = Object.keys(scenarios.chokepoints || {}).filter(id => REG[id]);
  const liveClosed = ids.filter(id => ['closed', 'disrupted'].includes(statusOf(id)?.status));
  const r = scenarioResult();
  const g = scenarios.globals || {};
  let html = `<p style="margin-bottom:8px">Close one or more chokepoints to see which flows are cut, what can be rerouted or bypassed, and who is most exposed.</p>
    <div class="sc-list">${ids.map(id => {
      const c = scenarios.chokepoints[id];
      return `<label><input type="checkbox" data-close="${id}" ${closed.has(id) ? 'checked' : ''}>
        ${esc(REG[id].data.name)} <span class="note" style="margin:0">${c.oil_mbd} mb/d</span>
        ${liveClosed.includes(id) ? '<span class="live">● live</span>' : ''}</label>`;
    }).join('')}</div>
    <div class="btn-row">
      ${liveClosed.length ? `<button class="btn primary" data-sc-live>Load current real-world disruptions</button>` : ''}
      ${closed.size ? `<button class="btn" data-sc-reset>Reset</button>` : ''}
    </div>`;
  if (closed.size) {
    html += `<div class="impact">
      <div class="kpi bad"><div class="v">${fmtN(r.shortfall)}</div><div class="k">mb/d net oil shortfall${r.pctDemand != null ? ` (${fmtN(r.pctDemand)}% of world demand)` : ''}</div></div>
      <div class="kpi"><div class="v">${fmtN(r.bypass)}</div><div class="k">mb/d pipeline bypass available</div></div>
      <div class="kpi"><div class="v">${fmtN(r.rerouted)}</div><div class="k">mb/d rerouted${r.maxDays ? `, +${r.maxDays} days voyage` : ''}</div></div>
      <div class="kpi ${r.lng ? 'bad' : ''}"><div class="v">${r.lng}%</div><div class="k">of global LNG trade stranded</div></div>
    </div>`;
    if (r.stockDays) html += `<p class="note">IEA emergency stocks (~${(g.iea_emergency_stocks_mb / 1000).toFixed(1)} bn bbl) would cover this gap for roughly <b>${Math.round(r.stockDays)} days</b>, if they could be released that fast. In practice, maximum release rates are well below most Hormuz-scale gaps.</p>`;
    if (r.bypassUsed.length || r.bypassImpaired.length) html += `<div class="sc-section"><h5>Bypass infrastructure</h5><ul>
      ${r.bypassUsed.map(b => `<li><a href="#" data-asset="${esc(b.asset)}">${esc(REG[b.asset]?.data.name || b.asset)}</a> — ~${b.spare_mbd} mb/d spare. ${esc(b.note)}
        ${b.degraded.map(d => `<div class="warn">⚠ ${esc(REG[d.id]?.data.name || d.id)} is currently <b>${esc(STATUS[d.st.status]?.label.toLowerCase())}</b> — real bypass capacity is likely lower.</div>`).join('')}</li>`).join('')}
      ${r.bypassImpaired.map(b => `<li class="warn"><a href="#" data-asset="${esc(b.asset)}">${esc(REG[b.asset]?.data.name || b.asset)}</a> — not counted: ${esc(REG[b.where]?.data.name || b.where)} is currently <b>${esc(STATUS[b.st.status]?.label.toLowerCase())}</b>. ${esc(b.st.summary)}</li>`).join('')}
    </ul></div>`;
    closed.forEach(id => { const n = scenarios.chokepoints[id].bypass_note; if (n) html += `<p class="note">${esc(REG[id].data.name)}: ${esc(n)}</p>`; });
    html += `<div class="sc-section"><h5>Most exposed</h5><ul>${[...r.exposed].map(([c, n]) => `<li><b>${esc(c)}</b> — ${esc(n)}</li>`).join('')}</ul></div>`;
    const stranded = [...r.strandedAssets].filter(id => REG[id]);
    if (stranded.length) html += `<div class="sc-section"><h5>Assets cut off (${stranded.length})</h5><div>${stranded.map(id => `<a href="#" data-asset="${id}">${esc(REG[id].data.name)}</a>`).join(', ')}</div></div>`;
    html += `<div class="sc-section note">Map: <span style="color:#b3261e">red dashes</span> = cut routes, <span style="color:#1e8a4c">green</span> = bypass pipelines and diversion routes, dark rings = stranded assets. ${esc(g.note || '')}</div>`;
    const srcs = [...closed].flatMap(id => scenarios.chokepoints[id].sources || []);
    html += sourcesHTML(srcs.filter((s, i) => srcs.findIndex(t => t.url === s.url) === i));
  }
  $('#tab-scenario').innerHTML = html;
}
$('#tab-scenario').addEventListener('change', e => { if (e.target.dataset.close) toggleClosure(e.target.dataset.close); });
$('#tab-scenario').addEventListener('click', e => {
  if (e.target.dataset.scReset !== undefined) { closed.clear(); applyScenario(); }
  if (e.target.dataset.scLive !== undefined) {
    closed.clear();
    Object.keys(scenarios.chokepoints).forEach(id => { if (['closed', 'disrupted'].includes(statusOf(id)?.status)) closed.add(id); });
    applyScenario();
  }
  if (e.target.dataset.asset) { e.preventDefault(); showDetail(e.target.dataset.asset, true); }
});

// ── Pump prices ──
const fuelState = { product: 'diesel', unit: 'local' };
const fuelEntries = (fuel.entries || []).filter(e => e.petrol);
const pctChange = (b) => b && b.pre_crisis ? (b.now - b.pre_crisis) / b.pre_crisis * 100 : null;
function heat(pct) { // 0% → pale, ≥80% → deep red
  const t = Math.max(0, Math.min(1, (pct ?? 0) / 80));
  const a = [253, 224, 197], b = [179, 38, 30];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
}
const fuelPrice = (e, k) => fuelState.unit === 'usd' ? e.usd_per_litre?.[k] : e[k]?.now;
const fuelUnit = e => fuelState.unit === 'usd' ? 'US$/l' : e.unit;
const fuelDp = e => fuelState.unit === 'usd' || e.unit !== '$/gal' ? 2 : 2;
function miniSpark(hist, w = 70, h = 18) {
  if (!hist || hist.length < 2) return '';
  const vs = hist.map(p => p[1]), min = Math.min(...vs), max = Math.max(...vs), rng = max - min || 1;
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${(i / (vs.length - 1) * w).toFixed(1)},${(h - 1 - (v - min) / rng * (h - 2)).toFixed(1)}`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="#b3261e" stroke-width="1.4"/></svg>`;
}
function renderFuelLayer() {
  groups.fuel.clearLayers();
  fuelEntries.filter(e => e.group !== 'us-region' && e.coords).forEach(e => {
    const b = e[fuelState.product]; if (!b) return;
    const pct = pctChange(b);
    const m = L.circleMarker(e.coords, { radius: e.id === 'us' || e.id === 'eu' ? 13 : 9, color: '#fff', weight: 1.5, fillColor: heat(pct), fillOpacity: 0.95 });
    m.bindTooltip(`<b>${esc(e.name)}</b> ${fuelState.product}: ${fmtN(fuelPrice(e, fuelState.product), 2)} ${esc(fuelUnit(e))}${pct != null ? ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% since Feb` : ''}`);
    m.on('click', () => showFuel(e.id));
    groups.fuel.addLayer(m);
  });
}
function fuelRow(e) {
  const b = e[fuelState.product]; if (!b) return '';
  const pct = pctChange(b);
  return `<tr data-fuel="${esc(e.id)}"><td>${esc(e.name)}${e.feed === 'agent' ? ' <span class="conf">' + esc(e.confidence || 'reported') + '</span>' : ''}</td>
    <td class="num">${fmtN(fuelPrice(e, fuelState.product), 2)} <small>${esc(fuelUnit(e))}</small></td>
    <td class="num"><span class="heat" style="background:${heat(pct)}">${pct == null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%'}</span></td>
    <td>${miniSpark(b.history)}</td></tr>`;
}
function renderFuel() {
  const el = $('#tab-fuel');
  if (!fuelEntries.length) { el.innerHTML = `<div class="empty">No pump price data yet. Run scripts/update_fuel.py.</div>`; return; }
  const us = fuelEntries.find(e => e.id === 'us'), eu = fuelEntries.find(e => e.id === 'eu'), uk = fuelEntries.find(e => e.id === 'uk');
  const card = (e, k, word) => {
    if (!e?.[k]) return '';
    const pct = pctChange(e[k]);
    return `<div class="kpi"><div class="v">${fmtN(e[k].now, 2)} <small style="font-size:11px;font-weight:500">${esc(e.unit)}</small></div>
      <div class="k">${esc(e.name)} ${word}${pct != null ? ` · <b style="color:#b3261e">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</b> since Feb` : ''}</div></div>`;
  };
  const byCountry = fuelEntries.filter(e => e.group === 'country' || e.group === 'eu-average')
    .sort((a, b) => (pctChange(b[fuelState.product]) ?? -1) - (pctChange(a[fuelState.product]) ?? -1));
  const usRegions = fuelEntries.filter(e => e.group === 'us-region');
  el.innerHTML = `
    <div class="impact">${card(us, 'petrol', 'gasoline')}${card(us, 'diesel', 'diesel')}${card(eu, 'petrol', 'petrol')}${card(uk, 'diesel', 'diesel')}</div>
    <div class="filters">
      <button class="chip ${fuelState.product === 'petrol' ? 'on' : ''}" data-product="petrol">Petrol / gasoline</button>
      <button class="chip ${fuelState.product === 'diesel' ? 'on' : ''}" data-product="diesel">Diesel</button>
      <span style="flex:1"></span>
      <button class="chip ${fuelState.unit === 'local' ? 'on' : ''}" data-unit="local">Local</button>
      <button class="chip ${fuelState.unit === 'usd' ? 'on' : ''}" data-unit="usd">US$/litre</button>
    </div>
    <table class="fuel-table"><thead><tr><th>Country</th><th class="num">Price</th><th class="num">vs Feb</th><th>Trend</th></tr></thead>
    <tbody>${byCountry.map(fuelRow).join('')}</tbody></table>
    ${usRegions.length ? `<details class="sc-section"><summary><b>US regions</b></summary><table class="fuel-table"><tbody>${usRegions.map(fuelRow).join('')}</tbody></table></details>` : ''}
    <p class="note">Weekly retail prices including taxes, compared with the week of ${esc(fmtDate(fuel.pre_crisis_date))}. Trend shows the last ~12 months. Much of the gap between countries comes from taxes, not crude costs. US$ conversions use ECB rates of ${esc(fmtDate(fuel.fx?.date))}.</p>
    ${sourcesHTML([...new Map(fuelEntries.map(e => [e.source.url, e.source])).values()])}`;
}
$('#tab-fuel').addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.product) { fuelState.product = t.dataset.product; renderFuel(); renderFuelLayer(); return; }
  if (t.dataset.unit) { fuelState.unit = t.dataset.unit; renderFuel(); renderFuelLayer(); return; }
  const row = t.closest('[data-fuel]');
  if (row) showFuel(row.dataset.fuel, true);
});
function showFuel(id, fly = false) {
  const e = fuelEntries.find(x => x.id === id); if (!e) return;
  if (fly && e.coords) focusMap(e.coords, Math.max(map.getZoom(), 4));
  const row = (k, word) => {
    const b = e[k]; if (!b) return '';
    const pct = pctChange(b), wk = b.week_ago ? (b.now - b.week_ago) / b.week_ago * 100 : null;
    return `<div class="geo"><b>${word}</b>
      <div class="cp-stats"><span>Now <b>${fmtN(b.now, 3)}</b> ${esc(e.unit)}</span><span>Week ago <b>${fmtN(b.week_ago, 3)}</b></span><span>Feb <b>${fmtN(b.pre_crisis, 3)}</b></span></div>
      <div class="cp-stats"><span class="delta-down">${pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '% since Feb' : ''}</span><span>${wk != null ? (wk >= 0 ? '+' : '') + wk.toFixed(1) + '% on the week' : ''}</span>
      ${e.usd_per_litre?.[k] ? `<span>US$ ${fmtN(e.usd_per_litre[k], 2)}/l</span>` : ''}</div>
      ${b.history?.length > 2 ? priceChart(b.history, b.pre_crisis) : ''}</div>`;
  };
  $('#tab-detail').innerHTML = `<button class="back" data-back>← Back</button><div class="detail">
    <span class="tag">Pump prices</span><h3>${esc(e.name)}</h3>
    ${pageIndex.fuel.includes(e.id) ? `<p class="note" style="margin:0 0 6px"><a href="/fuel-prices/${esc(e.id)}/">Full page with history →</a></p>` : ''}
    ${row('petrol', e.currency === 'USD' ? 'Regular gasoline' : 'Petrol (Euro-super 95)')}${row('diesel', 'Diesel')}
    <p class="note">Week of ${esc(fmtDate(e.date))}.</p>${sourcesHTML(e.sources || [e.source])}</div>`;
  lastListTab = 'fuel';
  setTab('detail');
}
function priceChart(hist, ref) {
  const W = 300, H = 60, vs = hist.map(p => p[1]);
  const min = Math.min(...vs, ref ?? Infinity) * 0.97, max = Math.max(...vs) * 1.02;
  const x = i => i / (hist.length - 1) * W, y = v => H - (v - min) / (max - min) * H;
  const d = hist.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<svg class="spark" style="height:60px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${ref ? `<line x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" stroke="#8a94a6" stroke-dasharray="3 3"/>` : ''}
    <path d="${d}" fill="none" stroke="#b3261e" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>
    <div class="note" style="margin-top:0;display:flex;justify-content:space-between"><span>${esc(fmtDate(hist[0][0]))}</span><span>dashed = Feb reference</span><span>${esc(fmtDate(hist[hist.length - 1][0]))}</span></div>`;
}

// ── Init ──
if (params.get('focus') && REG[params.get('focus')]) showDetail(params.get('focus'), true);
renderFuel();
renderFuelLayer();
const fuelCount = document.querySelector('[data-layer="fuel"]')?.closest('.layer-row')?.querySelector('.count');
if (fuelCount) fuelCount.textContent = groups.fuel.getLayers().length;
renderLatest();
renderScenario();
renderChokepoints();
})();
