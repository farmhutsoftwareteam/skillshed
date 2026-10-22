#!/usr/bin/env node
// Searches for skills to vendor: the skill-issue.in snapshot in catalog/ and
// the live skills.sh index. Prints candidates with the source string that
// `sync-vendor.mjs add` accepts. Read-only: it installs nothing.
//
//   node scripts/find-skill.mjs <query words...> [--limit 10]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readLock } from './lib.mjs';

const args = process.argv.slice(2);
const limit = Number(args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 10);
const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--limit');
if (!words.length) {
  console.log('usage: find-skill.mjs <query words...> [--limit n]');
  process.exit(1);
}
const terms = words.map((w) => w.toLowerCase());
const lock = readLock();
const have = new Set(Object.values(lock.skills).map((e) => `${e.source}@${e.path.split('/').pop()}`.toLowerCase()));
const tag = (source) => (have.has(source.toLowerCase()) ? '  [already vendored]' : '');

// 1. skill-issue.in snapshot: score by how many terms appear in the entry text.
const catFile = join(ROOT, 'catalog/skill-issue.json');
if (existsSync(catFile)) {
  const { entries, fetched } = JSON.parse(readFileSync(catFile, 'utf8'));
  const hits = entries
    .map((e) => {
      const text = [e.name, e.category, e.niche, e.useCase, e.creator, e.repo].join(' ').toLowerCase();
      return { e, score: terms.filter((t) => text.includes(t)).length };
    })
    .filter((h) => h.score > 0 && h.e.repo)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  console.log(`## skill-issue.in (snapshot ${fetched})`);
  for (const { e } of hits) {
    const source = e.skill ? `${e.repo}@${e.skill}` : e.repo;
    console.log(`- ${e.name} [${e.category}] ${e.signal ?? ''}\n  ${e.useCase}\n  source: ${source}${e.skill ? '' : '  (whole collection: pick one skill inside)'}${tag(source)}`);
  }
  if (!hits.length) console.log('(no matches)');
}

// 2. skills.sh live search.
try {
  const res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(words.join(' '))}&limit=${limit}`);
  const { skills = [] } = await res.json();
  console.log('\n## skills.sh');
  for (const s of skills.slice(0, limit)) {
    // Non-GitHub sources (e.g. a docs domain) can't be vendored by sync-vendor.
    const source = /^[\w.-]+\/[\w.-]+$/.test(s.source) ? `${s.source}@${s.skillId}` : null;
    console.log(`- ${s.name} (${s.installs ?? 0} installs)\n  source: ${source ?? `${s.source} (not a GitHub repo)`}${source ? tag(source) : ''}`);
  }
  if (!skills.length) console.log('(no matches)');
} catch (e) {
  console.log(`\n## skills.sh\n(search failed: ${e.message})`);
}
