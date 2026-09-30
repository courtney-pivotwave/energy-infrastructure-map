// Daily "Needs you" check, run by .github/workflows/health.yml.
// Exits 1 when a human is needed, so GitHub sends its failed-run email; the run summary lists what to do.
// Checks: review PRs waiting, the daily update agent not having run, posts that failed for good, invalid data.
// Local: GH_TOKEN=… node scripts/health.mjs   (needs git history and the gh CLI)
import { execSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

const sh = cmd => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return { error: [e.stdout, e.stderr].filter(Boolean).join('\n').trim() || e.message }; } };
const REPO = process.env.GITHUB_REPOSITORY || 'courtney-pivotwave/energy-infrastructure-map';
const MAX_ATTEMPTS = 3; // keep in step with scripts/social_post.mjs
const needs = [], ok = [];

// 1. Review pull requests waiting for a human
const prs = sh(`gh pr list --repo ${REPO} --state open --json number,title,url,createdAt,headRefName`);
if (prs.error) needs.push(`Couldn't list pull requests: ${prs.error}`);
else {
  const open = JSON.parse(prs || '[]');
  open.forEach(p => needs.push(`**Review waiting:** [#${p.number} ${p.title}](${p.url}) — opened ${p.createdAt.slice(0, 10)}. Read it, then merge or close.`));
  if (!open.length) ok.push('No pull requests waiting for review');
}

// 2. The daily update agent ran (it always commits at least a price refresh as "data: update …")
const last = sh(`git log -1 --since="28 hours ago" --grep="^data: update" --format="%cs %s" origin/main`);
if (last.error || !last) needs.push('**Daily update missing:** no `data: update` commit in the past 28 hours. Check the "Energy map daily update" routine in Claude Code on the web (claude.ai/code).');
else ok.push(`Daily update ran: ${last}`);

// 3. Posts that failed on a platform and won't be retried
const log = JSON.parse(readFileSync('data/social-log.json', 'utf8')).posted;
const cutoff = Date.now() - 3 * 864e5;
for (const [id, byPlatform] of Object.entries(log)) {
  for (const [pl, e] of Object.entries(byPlatform)) {
    if (e.id || e.uri || !e.error) continue;
    if (Date.parse(e.last_try || 0) < cutoff) continue;
    if ((e.attempts || 0) >= MAX_ATTEMPTS) needs.push(`**Post failed for good:** ${id} on ${pl} (${e.error.slice(0, 160)}). Check the platform login/credits, then clear its entry in data/social-log.json to retry.`);
    else ok.push(`${id} on ${pl} failed ${e.attempts}× so far; the next posting run retries it`);
  }
}

// 4. Data on main is valid (invalid data also blocks posting)
const v = sh('node scripts/validate.mjs');
if (v.error) needs.push(`**Data doesn't validate on main**, so posting is blocked:\n\n\`\`\`\n${v.error.slice(0, 1500)}\n\`\`\``);
else ok.push('Data validates');

const summary = [
  needs.length ? `## You're needed (${needs.length})\n\n${needs.map(n => `- ${n}`).join('\n')}` : '## All clear — nothing needs you today',
  ok.length ? `\n### Fine\n\n${ok.map(o => `- ${o}`).join('\n')}` : '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
if (needs.length) process.exitCode = 1;
