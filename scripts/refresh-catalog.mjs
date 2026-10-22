#!/usr/bin/env node
// Snapshots the skill-issue.in directory into catalog/skill-issue.json so
// find-skill can search it offline. Entries are untrusted listing data.
//
//   node scripts/refresh-catalog.mjs
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const html = await (await fetch('https://skill-issue.in/')).text();

// The page ships its data as Next.js flight chunks: self.__next_f.push([1,"..."]).
const data = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1])).join('');

const entries = new Map();
for (const m of data.matchAll(/\{"id":"/g)) {
  const obj = parseObjectAt(data, m.index);
  if (obj?.domainSlug && 'installCommand' in obj) entries.set(obj.id, obj);
}
if (entries.size < 100) throw new Error(`only found ${entries.size} entries: page format changed?`);

const out = [...entries.values()]
  .map((e) => {
    let repo = null;
    let skill = null;
    const cmd = (e.installCommand ?? '').match(/npx skills add (\S+)(?:\s+--skill\s+(\S+))?/);
    const link = (e.link ?? '').match(/(?:skillselion\.com\/skills|officialskills\.sh|skills\.sh)\/([^/]+)\/([^/]+)\/([^/?#]+)/);
    const gh = (e.link ?? '').match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/);
    if (cmd) [, repo, skill = null] = cmd;
    else if (link) [repo, skill] = [`${link[1]}/${link[2]}`, link[3]];
    else if (gh) [repo, skill] = [gh[1], gh[2]?.split('/').pop() ?? null];
    return {
      id: e.id,
      name: e.name,
      category: e.domainSlug,
      niche: e.niche,
      useCase: e.useCase,
      creator: e.creator,
      repo,
      skill, // null = the entry is a whole collection
      link: e.link,
      signal: e.signal,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const file = join(ROOT, 'catalog/skill-issue.json');
// Keep the old file (and its date) when nothing changed, so the weekly sync
// doesn't open a PR just for a new timestamp.
if (existsSync(file) && JSON.stringify(JSON.parse(readFileSync(file, 'utf8')).entries) === JSON.stringify(out)) {
  console.log(`${out.length} entries, unchanged`);
  process.exit(0);
}
mkdirSync(join(ROOT, 'catalog'), { recursive: true });
writeFileSync(file, JSON.stringify({ source: 'https://skill-issue.in/', fetched: new Date().toISOString().slice(0, 10), entries: out }, null, 1) + '\n');
console.log(`${out.length} entries -> catalog/skill-issue.json`);

function parseObjectAt(text, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
