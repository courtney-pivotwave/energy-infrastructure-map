#!/usr/bin/env node
// Validates everything in data/ against agent/SCHEMA.md. Exit code 1 on any error.
// Usage: node scripts/validate.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// Source policy (agent/UPDATE_AGENT.md): US government sources must not back conflict-period data
const US_GOV = /^https?:\/\/([a-z0-9-]+\.)*(gov|mil)(\/|$)/i;
function checkSources(where, sources, required = true) {
  if (!Array.isArray(sources) || (required && !sources.length)) { err(`${where}: needs at least one source`); return; }
  const gov = sources.filter(s => US_GOV.test(s?.url || ''));
  if (gov.length && gov.length === sources.length && !/^(fuel\.|interim:)/.test(where)) err(`${where}: backed only by US government sources — see source policy`);
  else if (gov.length && /^interim:/.test(where)) warn(`${where}: interim baseline sourced to US government — replace with an independent source`);
  else if (gov.length && !/^fuel\./.test(where)) warn(`${where}: cites a US government source (${gov.map(s => new URL(s.url).host).join(', ')}) — allowed only for a US announcement of its own action`);
  sources.forEach((s, i) => {
    if (!s?.name) err(`${where}: source ${i} missing name`);
    if (!/^https?:\/\//.test(s?.url || '')) err(`${where}: source ${i} url must be http(s)`);
    if (s?.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s.date)) err(`${where}: source ${i} date "${s.date}" should be YYYY, YYYY-MM or YYYY-MM-DD`);
  });
}

// ── infrastructure ──
const infra = load('infrastructure.json');
const ids = new Set();
if (infra) {
  for (const kind of ['pipelines', 'sites', 'fields', 'chokepoints', 'routes']) {
    if (!Array.isArray(infra[kind])) { err(`infrastructure.json: "${kind}" must be an array`); continue; }
    infra[kind].forEach((a, i) => {
      const w = `infrastructure.${kind}[${i}] (${a.id || a.name})`;
      if (!ID.test(a.id || '')) err(`${w}: bad id`);
      if (ids.has(a.id)) err(`${w}: duplicate id`);
      ids.add(a.id);
      if (!a.name) err(`${w}: missing name`);
      if (kind === 'pipelines' || kind === 'routes') {
        if (!Array.isArray(a.coords) || a.coords.length < 2 || !a.coords.every(isCoord)) err(`${w}: coords must be ≥2 [lat,lng] pairs`);
        if (!['oil', 'gas', 'lng'].includes(a.commodity)) err(`${w}: commodity must be oil|gas|lng`);
      } else if (!isCoord(a.coords)) err(`${w}: coords must be [lat,lng]`);
      if (kind === 'sites' && !['production', 'refinery', 'hub', 'lng'].includes(a.kind)) err(`${w}: kind must be production|refinery|hub|lng`);
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
    checkSources(w, s.sources);
  }
}

// ── events ──
const ev = load('events.json');
if (ev) {
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
    checkSources(w, e.sources);
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
    checkSources(c.baseline_interim ? `interim:${w}` : w, c.sources);
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

warnings.forEach(w => console.warn('warn:', w));
if (errors.length) {
  errors.forEach(e => console.error('ERROR:', e));
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`data/ OK — ${ids.size} assets, ${Object.keys(status?.assets || {}).length} statuses, ${(ev?.events || []).length} events, ${(fuel?.entries || []).length} fuel entries${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
