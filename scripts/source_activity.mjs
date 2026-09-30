// Source activity report for the monthly source review (agent/SOURCE_REVIEW.md).
// Facts only, no judgement: how often each registered source is cited in data/ and when it was last cited,
// cited domains missing from the registry (discovery leads), and registry rules being broken.
// Usage: node scripts/source_activity.mjs [--json]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const reg = load('sources.json').sources;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = d => d ? Math.floor((Date.parse(today) - Date.parse(d)) / 864e5) : Infinity;

// Every cited URL with the best date we can find (its own, else the nearest enclosing record's)
const cites = [];
const walk = (o, ctx) => {
  if (Array.isArray(o)) return o.forEach(x => walk(x, ctx));
  if (!o || typeof o !== 'object') return;
  const date = o.date || o.updated || o.as_of || ctx;
  if (typeof o.url === 'string' && /^https?:\/\//.test(o.url) && (o.name || o.date)) cites.push({ url: o.url, date: typeof date === 'string' ? date.slice(0, 10) : null });
  Object.values(o).forEach(v => walk(v, date));
};
for (const f of ['events', 'status', 'market', 'fuel', 'scenarios', 'infrastructure']) walk(load(`${f}.json`), null);

const host = u => new URL(u).hostname.replace(/^www\./, '');
const owner = h => reg.find(s => s.domains.some(d => h === d || h.endsWith('.' + d)));
const stats = new Map(reg.map(s => [s.id, { total: 0, last90: 0, last: null }]));
const unregistered = new Map();
for (const c of cites) {
  const h = host(c.url), s = owner(h);
  const bucket = s ? stats.get(s.id) : (unregistered.get(h) || unregistered.set(h, { total: 0, last90: 0, last: null }).get(h));
  bucket.total++;
  if (daysAgo(c.date) <= 90) bucket.last90++;
  if (c.date && (!bucket.last || c.date > bucket.last)) bucket.last = c.date;
}

const rows = reg.map(s => ({ ...s, ...stats.get(s.id) }));
const report = {
  date: today,
  citations: cites.length,
  sources: rows.map(({ id, name, status, total, last90, last }) => ({ id, name, status, total, last90, last })),
  unregistered: [...unregistered].map(([domain, v]) => ({ domain, ...v })).sort((a, b) => b.total - a.total),
  quiet: rows.filter(s => ['trusted', 'use-with-care'].includes(s.status) && s.total > 0 && daysAgo(s.last) > 180).map(s => s.id),
  avoidCited: rows.filter(s => s.status === 'avoid' && s.last90 > 0).map(s => s.id),
  candidateCited: rows.filter(s => s.status === 'candidate' && s.total > 0).map(s => s.id),
};

if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }
const line = r => `| ${r.name} | ${r.status} | ${r.total} | ${r.last90} | ${r.last || '—'} |`;
console.log(`# Source activity, ${today}

${report.citations} cited URLs across data/.

## Registered sources, most cited first

| Source | Status | Citations | Last 90 days | Last cited |
|---|---|---|---|---|
${[...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).map(line).join('\n')}

## Cited but not in the registry (review and add)

${report.unregistered.length ? report.unregistered.map(u => `- ${u.domain}: ${u.total} citation(s), last ${u.last || 'undated'}`).join('\n') : '- None'}

## Flags

- Not cited by the map in 180+ days (still publishing? or is the daily agent overlooking it?): ${report.quiet.join(', ') || 'none'}
- "avoid" sources cited in the past 90 days: ${report.avoidCited.join(', ') || 'none'}
- "candidate" sources already cited: ${report.candidateCited.join(', ') || 'none'}
`);
