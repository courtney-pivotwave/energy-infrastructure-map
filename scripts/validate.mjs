#!/usr/bin/env node
// Validates everything in data/ against agent/SCHEMA.md. Exit code 1 on any error.
// Usage: node scripts/validate.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composeText, TAG_LIMIT } from './social_post.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);

function load(f) {
  const p = join(root, 'data', f);
  if (!existsSync(p)) { err(`${f}: missing`); return null; }
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { err(`${f}: invalid JSON — ${e.message}`); return null; }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS = ['normal', 'reduced', 'disrupted', 'offline', 'closed', 'damaged'];
const CONF = ['confirmed', 'reported', 'unverified'];
const CATS = ['military', 'shipping', 'infrastructure', 'policy', 'market', 'diplomatic'];
const SEV = ['low', 'medium', 'high', 'critical'];
const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // allow timezone slack

const isDate = d => typeof d === 'string' && DATE.test(d) && !isNaN(Date.parse(d));
const isCoord = c => Array.isArray(c) && c.length === 2 && c.every(n => typeof n === 'number') && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 360;

// Source policy (agent/UPDATE_AGENT.md): a claim resting only on belligerent-government sources (detectable here:
// US .gov/.mil) must be labelled unverified. Statistical series (fuel, scenario baselines) are exempt.
const US_GOV = /^https?:\/\/([a-z0-9-]+\.)*(gov|mil)(\/|$)/i;
function checkSources(where, sources, required = true, confidence = null) {
  if (!Array.isArray(sources) || (required && !sources.length)) { err(`${where}: needs at least one source`); return; }
  if (confidence && confidence !== 'unverified' && sources.every(s => US_GOV.test(s?.url || '')))
    err(`${where}: rests only on US government sources — needs independent verification or confidence "unverified"`);
  sources.forEach((s, i) => {
    if (!s?.name) err(`${where}: source ${i} missing name`);
    if (!/^https?:\/\//.test(s?.url || '')) err(`${where}: source ${i} url must be http(s)`);
    if (s?.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s.date)) err(`${where}: source ${i} date "${s.date}" should be YYYY, YYYY-MM or YYYY-MM-DD`);
  });
}

// ── infrastructure ──
const infra = load('infrastructure.json');
const ids = new Set();
const assetsById = new Map();
if (infra) {
  for (const kind of ['pipelines', 'sites', 'fields', 'chokepoints', 'routes']) {
    if (!Array.isArray(infra[kind])) { err(`infrastructure.json: "${kind}" must be an array`); continue; }
    infra[kind].forEach((a, i) => {
      const w = `infrastructure.${kind}[${i}] (${a.id || a.name})`;
      if (!ID.test(a.id || '')) err(`${w}: bad id`);
      if (ids.has(a.id)) err(`${w}: duplicate id`);
      ids.add(a.id);
      assetsById.set(a.id, a);
      if (!a.name) err(`${w}: missing name`);
      if (kind === 'pipelines' || kind === 'routes') {
        if (!Array.isArray(a.coords) || a.coords.length < 2 || !a.coords.every(isCoord)) err(`${w}: coords must be ≥2 [lat,lng] pairs`);
        if (!['oil', 'gas', 'lng'].includes(a.commodity)) err(`${w}: commodity must be oil|gas|lng`);
      } else if (!isCoord(a.coords)) err(`${w}: coords must be [lat,lng]`);
      if (kind === 'sites' && !['production', 'refinery', 'hub', 'lng'].includes(a.kind)) err(`${w}: kind must be production|refinery|hub|lng`);
      // Reference figures: one governing source, a stated basis and an as-of date (see "Governing sources" in UPDATE_AGENT.md)
      if (a.capacity !== undefined) {
        const c = a.capacity || {};
        if (typeof c.value !== 'number' || c.value <= 0) err(`${w}: capacity.value must be a positive number`);
        if (!['mb/d', 'kb/d', 'bcm/y', 'mtpa'].includes(c.unit)) err(`${w}: capacity.unit must be mb/d|kb/d|bcm/y|mtpa`);
        if (!['nameplate', 'effective'].includes(c.basis)) err(`${w}: capacity.basis must be nameplate|effective`);
        if (!c.source?.name || !/^https?:\/\//.test(c.source?.url || '')) err(`${w}: capacity.source needs a name and url`);
        if (!isDate(c.as_of) || c.as_of > today) err(`${w}: capacity.as_of must be a past YYYY-MM-DD`);
        else if ((Date.parse(today) - Date.parse(c.as_of)) / 864e5 > 730) warn(`${w}: capacity figure is over 2 years old; recheck it before using it in a post`);
      }
      if (a.verified !== undefined && (!isDate(a.verified) || a.verified > today)) err(`${w}: verified must be a past YYYY-MM-DD`);
      if (kind !== 'routes' && !a.details) err(`${w}: missing details`);
    });
  }
  infra.routes?.forEach(r => (r.via || []).forEach(v => { if (!ids.has(v)) err(`route ${r.id}: via "${v}" is not a known id`); }));
}

// ── status ──
const status = load('status.json');
if (status) {
  if (status.updated !== null && !isDate(status.updated)) err('status.json: "updated" must be YYYY-MM-DD');
  for (const [id, s] of Object.entries(status.assets || {})) {
    const w = `status.${id}`;
    if (!ids.has(id)) err(`${w}: unknown asset id`);
    if (!STATUS.includes(s.status)) err(`${w}: status must be one of ${STATUS.join('|')}`);
    if (s.status === 'normal') warn(`${w}: status "normal" — delete the entry instead`);
    if (!s.summary) err(`${w}: missing summary`);
    if (s.since && !isDate(s.since)) err(`${w}: since must be YYYY-MM-DD`);
    if (!isDate(s.updated)) err(`${w}: updated must be YYYY-MM-DD`);
    if (!CONF.includes(s.confidence)) err(`${w}: confidence must be ${CONF.join('|')}`);
    checkSources(w, s.sources, true, s.confidence);
  }
}

// ── events ──
const ev = load('events.json');
if (ev) {
  if (ev.situation_headline !== undefined) {
    if (typeof ev.situation_headline !== 'string' || !ev.situation_headline.trim()) err('events.json: situation_headline must be non-empty text');
    else if (ev.situation_headline.length > 320) err('events.json: situation_headline over 320 characters; keep it to 1–2 sentences');
  } else warn('events.json: no situation_headline; the map will lead with the background summary');
  const seen = new Set();
  (ev.events || []).forEach((e, i) => {
    const w = `events[${i}] (${e.id})`;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(e.id || '')) err(`${w}: id must be YYYY-MM-DD-slug`);
    if (seen.has(e.id)) err(`${w}: duplicate id`);
    seen.add(e.id);
    if (!isDate(e.date)) err(`${w}: bad date`);
    else if (e.date > today) err(`${w}: date is in the future`);
    if (!e.title) err(`${w}: missing title`); else if (e.title.length > 120) warn(`${w}: title over 120 chars`);
    if (!e.summary) err(`${w}: missing summary`);
    if (!CATS.includes(e.category)) err(`${w}: category must be ${CATS.join('|')}`);
    if (!SEV.includes(e.severity)) err(`${w}: severity must be ${SEV.join('|')}`);
    if (e.coords !== null && e.coords !== undefined && !isCoord(e.coords)) err(`${w}: coords must be [lat,lng] or null`);
    (e.assets || []).forEach(a => { if (!ids.has(a)) err(`${w}: unknown asset "${a}"`); });
    if (!CONF.includes(e.confidence)) err(`${w}: confidence must be ${CONF.join('|')}`);
    checkSources(w, e.sources, true, e.confidence);
  });
}

// ── market ──
const mk = load('market.json');
if (mk && mk.as_of !== null) {
  if (!isDate(mk.as_of)) err('market.json: as_of must be YYYY-MM-DD');
  (mk.benchmarks || []).forEach((b, i) => {
    const w = `market.benchmarks[${i}] (${b.id})`;
    if (typeof b.value !== 'number') err(`${w}: value must be a number`);
    ['week_ago', 'pre_crisis'].forEach(k => { if (b[k] != null && typeof b[k] !== 'number') err(`${w}: ${k} must be a number or null`); });
    if (!b.label || !b.unit) err(`${w}: needs label and unit`);
    if (b.source) checkSources(w, [b.source]); else err(`${w}: missing source`);
  });
}

// ── scenarios ──
const sc = load('scenarios.json');
if (sc) {
  for (const [id, c] of Object.entries(sc.chokepoints || {})) {
    const w = `scenarios.${id}`;
    if (!ids.has(id)) err(`${w}: unknown chokepoint id`);
    if (typeof c.oil_mbd !== 'number') err(`${w}: oil_mbd must be a number`);
    if (!['none', 'cape', 'lombok'].includes(c.reroute)) err(`${w}: reroute must be none|cape|lombok`);
    (c.bypass || []).forEach(b => {
      if (!ids.has(b.asset)) err(`${w}: bypass asset "${b.asset}" unknown`);
      if (b.outlet && !ids.has(b.outlet)) err(`${w}: bypass outlet "${b.outlet}" unknown`);
    });
    (c.stranded || []).forEach(a => { if (!ids.has(a)) err(`${w}: stranded asset "${a}" unknown`); });
    checkSources(w, c.sources);
  }
}

// ── fuel ──
const fuel = load('fuel.json');
if (fuel) {
  const fids = new Set();
  (fuel.entries || []).forEach((e, i) => {
    const w = `fuel.entries[${i}] (${e.id})`;
    if (fids.has(e.id)) err(`${w}: duplicate id`);
    fids.add(e.id);
    if (!isCoord(e.coords)) err(`${w}: coords must be [lat,lng]`);
    if (!e.unit || !e.currency) err(`${w}: needs unit and currency`);
    for (const k of ['petrol', 'diesel']) {
      const b = e[k];
      if (!b) { if (k === 'petrol') err(`${w}: missing petrol`); continue; }
      if (typeof b.now !== 'number' || b.now <= 0) err(`${w}.${k}: now must be a positive number`);
      if (b.pre_crisis != null && Math.abs(b.now / b.pre_crisis - 1) > 1.5) warn(`${w}.${k}: >150% change vs pre-crisis — check units`);
      if (!isDate(b.date)) err(`${w}.${k}: bad date`);
    }
    if (e.feed === 'agent') checkSources(w, e.sources || [e.source]);
    else if (!e.source?.url) err(`${w}: missing source`);
  });
}

// ── changelog ──
const log = load('changelog.json');
if (log) {
  (log.entries || []).forEach((e, i) => {
    const w = `changelog[${i}]`;
    if (!isDate(e.date)) err(`${w}: bad date`);
    if (!['data', 'site', 'policy'].includes(e.kind)) err(`${w}: kind must be data|site|policy`);
    if (!e.headline) err(`${w}: missing headline`);
    if (!Array.isArray(e.changes) || !e.changes.length) err(`${w}: changes must be a non-empty array`);
  });
  const dates = (log.entries || []).map(e => e.date);
  if (dates.some((d, i) => i && d > dates[i - 1])) err('changelog: entries must be newest first');
}

// ── social queue (data/social.json) — rules the posting Action relies on ──
const social = load('social.json');
if (social) {
  if (typeof social.enabled !== 'boolean' || typeof social.dry_run !== 'boolean') err('social.json: enabled and dry_run must be booleans');
  if (!Number.isInteger(social.max_per_day) || social.max_per_day < 1 || social.max_per_day > 10) err('social.json: max_per_day must be 1–10');
  if (social.max_per_run !== undefined && (!Number.isInteger(social.max_per_run) || social.max_per_run < 1)) err('social.json: max_per_run must be a positive integer');
  const TYPES = ['event', 'digest', 'explainer', 'chart', 'correction', 'announcement'];
  const xLinks = social.x_links ?? ['announcement', 'digest', 'correction'];
  if (!Array.isArray(xLinks) || xLinks.some(t => !TYPES.includes(t))) err(`social.json: x_links must list post types from ${TYPES.join('|')}`);
  const eventsById = new Map((ev?.events || []).map(e => [e.id, e]));
  const seen = new Set();
  const seenIds = new Set(Object.keys((existsSync(join(root, 'data', 'social-log.json')) ? JSON.parse(readFileSync(join(root, 'data', 'social-log.json'), 'utf8')) : { posted: {} }).posted));
  const graphemes = t => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(t)].length;
  (social.posts || []).forEach((p, i) => {
    const w = `social.posts[${i}] (${p.id})`;
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(p.id || '')) err(`${w}: id must be YYYY-MM-DD-slug`);
    if (seen.has(p.id)) err(`${w}: duplicate id`);
    if (!isDate(p.created) || p.created > today) err(`${w}: created must be a past or current YYYY-MM-DD`);
    if (!TYPES.includes(p.type)) err(`${w}: type must be ${TYPES.join('|')}`);
    if (!p.text?.trim()) err(`${w}: missing text`);
    if (!/^https:\/\/strategicenergymap\.org\//.test(p.url || '')) err(`${w}: url must be a strategicenergymap.org page`);
    const text = p.text || '';
    // Lengths are checked on the text as actually posted (hashtags appended; X counts any link as 23 characters)
    const xLink = xLinks.includes(p.type);
    if ([...composeText(p, 'x', false)].length + (xLink ? 2 + 23 : 0) > 280) err(`${w}: too long for X once hashtags${xLink ? ' and link' : ''} are added (280)`);
    if (graphemes(composeText(p, 'bluesky', true)) > 300) err(`${w}: too long for Bluesky once hashtags and link are added (300)`);
    const allowed = social.hashtags || [];
    if (p.tags !== undefined && !Array.isArray(p.tags)) err(`${w}: tags must be an array`);
    const tags = p.tags || [];
    if (tags.length > TAG_LIMIT.bluesky) err(`${w}: at most ${TAG_LIMIT.bluesky} tags (X uses the first ${TAG_LIMIT.x})`);
    tags.forEach(t => { if (!allowed.includes(t)) err(`${w}: tag "${t}" is not in social.json → hashtags`); });
    if (new Set(tags).size !== tags.length) err(`${w}: duplicate tags`);
    if (['event', 'digest', 'explainer', 'chart'].includes(p.type) && !tags.length && !seenIds.has(p.id)) warn(`${w}: no hashtags; posts are hard to discover without one`);
    if (/(^|\s)@\w/.test(text)) err(`${w}: no @mentions in automated posts`);
    if (/(^|\s)#\w/.test(text)) err(`${w}: put hashtags in "tags", not in the text`);
    if (/https?:\/\//.test(text)) err(`${w}: put the link in "url", not in the text`);
    if (p.image && !['fuel-weekly', 'chokepoints-weekly', 'chokepoint-oil-flows', 'hormuz-bypass'].includes(p.image)) err(`${w}: unknown image "${p.image}"`);
    if (p.not_before !== undefined && (isNaN(Date.parse(p.not_before)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(p.not_before))) err(`${w}: not_before must be a UTC time like 2026-09-30T15:00Z`);
    if (p.image && !p.alt) err(`${w}: images need alt text`);
    // Posts that go to X without a link must read as complete, and bare domains would be auto-linked (and charged)
    if (!xLinks.includes(p.type)) {
      if (/[:→]\s*$/.test(text)) err(`${w}: posted to X without a link, so the text must not end with ':' or an arrow`);
      if (/\b[\w-]+\.(org|com|net|io|gov|info)\b/i.test(text)) err(`${w}: no domain names in text (X would auto-link and charge for them)`);
    }
    if (p.event_id) {
      const e = eventsById.get(p.event_id);
      if (!e) err(`${w}: event_id "${p.event_id}" not found in events.json`);
      else if (e.confidence === 'unverified') err(`${w}: never post unverified events`);
    }
    if (p.type === 'event' && !p.event_id) err(`${w}: event posts need an event_id`);
    if (p.type === 'explainer') {
      const m = (p.url || '').match(/^https:\/\/strategicenergymap\.org\/(chokepoints|facilities)\/([a-z0-9-]+)\/$/);
      if (!m || !ids.has(m[2])) err(`${w}: explainers must link to an existing /chokepoints/<id>/ or /facilities/<id>/ page`);
      // The daily explainer doubles as an audit: its asset must have been checked against its governing source recently
      else if (!seenIds.has(p.id)) {
        const v = assetsById.get(m[2])?.verified;
        if (!v || (Date.parse(p.created) - Date.parse(v)) / 864e5 > 14) err(`${w}: check ${m[2]}'s figures against its governing source and set its "verified" date (within 14 days) before explaining it`);
      }
    }
    if (p.type === 'correction' && !seen.has(p.reply_to)) err(`${w}: corrections must reply_to an earlier post id`);
    if (p.reply_to && !seen.has(p.reply_to)) err(`${w}: reply_to must reference an earlier post`);
    seen.add(p.id);
  });
}

// ── source registry (data/sources.json) — changed only via the monthly source review PR ──
const sourcesReg = load('sources.json');
if (sourcesReg) {
  const SRC_TYPES = ['intergovernmental', 'government-agency', 'tracker', 'exchange', 'wire', 'media', 'trade-press', 'think-tank', 'nonprofit', 'nonprofit-investigative', 'company', 'aggregator', 'reference'];
  const SRC_STATUS = ['trusted', 'use-with-care', 'candidate', 'avoid', 'retired'];
  const srcIds = new Set(), srcDomains = new Map();
  (sourcesReg.sources || []).forEach((s, i) => {
    const w = `sources[${i}] (${s.id || s.name})`;
    if (!ID.test(s.id || '')) err(`${w}: bad id`);
    if (srcIds.has(s.id)) err(`${w}: duplicate id`);
    srcIds.add(s.id);
    if (!s.name) err(`${w}: missing name`);
    if (!SRC_TYPES.includes(s.type)) err(`${w}: type must be ${SRC_TYPES.join('|')}`);
    if (!SRC_STATUS.includes(s.status)) err(`${w}: status must be ${SRC_STATUS.join('|')}`);
    if (!Array.isArray(s.domains) || !s.domains.length) err(`${w}: needs at least one domain`);
    (s.domains || []).forEach(d => {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) err(`${w}: domain "${d}" must be a bare hostname`);
      if (srcDomains.has(d)) err(`${w}: domain ${d} already belongs to ${srcDomains.get(d)}`);
      srcDomains.set(d, s.id);
    });
    if (!isDate(s.added)) err(`${w}: added must be YYYY-MM-DD`);
    if (s.last_reviewed !== null && !isDate(s.last_reviewed)) err(`${w}: last_reviewed must be YYYY-MM-DD or null`);
    if (['avoid', 'retired'].includes(s.status) && !s.notes) err(`${w}: say why in notes when a source is ${s.status}`);
  });
  // New citations of "avoid" sources: warn (existing ones are cleaned up through the review)
  const avoid = (sourcesReg.sources || []).filter(s => s.status === 'avoid').flatMap(s => s.domains);
  const recent = d => d && (Date.parse(today) - Date.parse(d)) / 864e5 <= 30;
  for (const e of ev?.events || []) if (recent(e.date)) for (const src of e.sources || []) {
    try { const h = new URL(src.url).hostname.replace(/^www\./, ''); if (avoid.some(d => h === d || h.endsWith('.' + d))) warn(`events ${e.id}: cites ${h}, which the source registry marks "avoid"`); } catch {}
  }
}

warnings.forEach(w => console.warn('warn:', w));
if (errors.length) {
  errors.forEach(e => console.error('ERROR:', e));
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`data/ OK — ${ids.size} assets, ${Object.keys(status?.assets || {}).length} statuses, ${(ev?.events || []).length} events, ${(fuel?.entries || []).length} fuel entries${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
