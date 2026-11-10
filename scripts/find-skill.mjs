#!/usr/bin/env node
// Searches for skills to vendor: the skill-issue.in snapshot in catalog/ and
// the live skills.sh index. Prints candidates with the source string that
// `sync-vendor.mjs add` accepts. Read-only: it installs nothing.
//
//   node scripts/find-skill.mjs <query words...> [--limit 10]
//
// Exits 1 if skills.sh could not be searched (timeout, HTTP error, bad
// response), after printing the snapshot results. SKILLSHED_SKILLS_SH
// overrides the skills.sh base URL.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readLock } from './lib.mjs';
import { rank } from '../site/public/search.js';

const args = process.argv.slice(2);
const limit = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 10);
const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit');
if (!words.length) {
  console.log('usage: find-skill.mjs <query words...> [--limit n]');
  process.exit(1);
}
const lock = readLock();
const have = new Set(Object.values(lock.skills).map((e) => `${e.source}@${e.path.split('/').pop()}`.toLowerCase()));
const tag = (source) => (have.has(source.toLowerCase()) ? '  [already vendored]' : '');

// 1. skill-issue.in snapshot, ranked the same way as the site's search.
const catFile = join(ROOT, 'catalog/skill-issue.json');
if (existsSync(catFile)) {
  const { entries, fetched } = JSON.parse(readFileSync(catFile, 'utf8'));
  const docs = entries
    .filter((e) => e.repo)
    .map((e) => ({ e, name: e.name, text: `${e.niche} ${e.useCase}`, pack: `${e.category} ${e.creator} ${e.repo}` }));
  const hits = rank(words.join(' '), docs).slice(0, limit).map((r) => r.doc);
  console.log(`## skill-issue.in (snapshot ${fetched})`);
  for (const { e } of hits) {
    const source = e.skill ? `${e.repo}@${e.skill}` : e.repo;
    console.log(`- ${e.name} [${e.category}] ${e.signal ?? ''}\n  ${e.useCase}\n  source: ${source}${e.skill ? '' : '  (whole collection: pick one skill inside)'}${tag(source)}`);
  }
  if (!hits.length) console.log('(no matches)');
}

// 2. skills.sh live search. A failure is reported, never shown as no matches.
const base = (process.env.SKILLSHED_SKILLS_SH ?? 'https://skills.sh').replace(/\/$/, '');
const timeout = Number(process.env.SKILLSHED_FIND_TIMEOUT_MS) || 10000;
console.log('\n## skills.sh');
const skills = await (async () => {
  const failed = (e) => (e.name === 'TimeoutError' ? `timed out after ${timeout / 1000}s` : `request failed: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  let res, text, body;
  try {
    res = await fetch(`${base}/api/search?q=${encodeURIComponent(words.join(' '))}&limit=${limit}`, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    text = await res.text();
  } catch (e) {
    return failed(e);
  }
  try {
    body = JSON.parse(text);
  } catch {
    return 'response was not JSON';
  }
  return Array.isArray(body?.skills) ? body.skills : 'response had no skills list';
})();
if (typeof skills === 'string') {
  console.log(`(search failed: ${skills})`);
  process.exit(1);
}
for (const s of skills.slice(0, limit)) {
  // Non-GitHub sources (e.g. a docs domain) can't be vendored by sync-vendor.
  const source = /^[\w.-]+\/[\w.-]+$/.test(s.source) ? `${s.source}@${s.skillId}` : null;
  console.log(`- ${s.name} (${s.installs ?? 0} installs)\n  source: ${source ?? `${s.source} (not a GitHub repo)`}${source ? tag(source) : ''}`);
}
if (!skills.length) console.log('(no matches)');
