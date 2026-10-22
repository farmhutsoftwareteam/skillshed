#!/usr/bin/env node
// Builds the Skillshed landing page into site/dist/ from the repo itself:
// packs from the marketplace, skills from each SKILL.md, sources from the lock.
//
//   node site/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, skills, frontmatter, readLock } from '../scripts/lib.mjs';

const SITE = dirname(fileURLToPath(import.meta.url));
const REPO = 'farmhutsoftwareteam/skillshed';
const ALWAYS_ON = readFileSync(join(ROOT, 'scripts/bootstrap.sh'), 'utf8').match(/^ALWAYS_ON=\(([^)]*)\)/m)[1].split(/\s+/);

const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const lock = readLock();

// Upstream descriptions are untrusted text: everything below is escaped.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// First sentence only, so a band stays one line of reading.
const firstSentence = (d) => (d.match(/^.*?[.!?](\s|$)/)?.[0] ?? d).trim();

const all = skills()
  .map((s) => {
    const fm = frontmatter(readFileSync(s.file, 'utf8')) ?? {};
    const v = lock.skills[s.name];
    return {
      name: s.name,
      pack: s.pack,
      description: firstSentence((fm.description ?? '').replace(/\s+/g, ' ').trim()),
      source: v ? v.source : 'Skillshed',
      commit: v ? v.commit.slice(0, 7) : '',
      url: v
        ? `https://github.com/${v.source}/tree/${v.commit}/${v.path}`
        : `https://github.com/${REPO}/tree/main/plugins/${s.pack}/skills/${s.name}`,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// Packs in display order: always-on first, then by size.
const packs = marketplace.plugins
  .map((p) => ({ name: p.name, on: ALWAYS_ON.includes(p.name), count: all.filter((s) => s.pack === p.name).length }))
  .sort((a, b) => Number(b.on) - Number(a.on) || b.count - a.count);

const tabs = packs
  .map(
    (p, i) => `<button class="tab" role="tab" data-pack="${esc(p.name)}" aria-selected="${i === 0}">
  <span class="tab-name">${esc(p.name)}</span><span class="tab-meta">${p.count} skills, ${p.on ? 'always on' : 'per project'}</span>
</button>`,
  )
  .join('\n');

const bands = all
  .map(
    (s) => `<li class="band" data-pack="${esc(s.pack)}" data-text="${esc(`${s.name} ${s.description} ${s.source}`.toLowerCase())}">
  <a href="${esc(s.url)}" target="_blank" rel="noopener">
    <span class="band-name">${esc(s.name)}</span>
    <span class="band-desc">${esc(s.description)}</span>
    <span class="band-src">${esc(s.source)}${s.commit ? ` at ${esc(s.commit)}` : ''}</span>
  </a>
</li>`,
  )
  .join('\n');

const html = readFileSync(join(SITE, 'template.html'), 'utf8')
  .replaceAll('{{REPO}}', REPO)
  .replaceAll('{{SKILL_COUNT}}', String(all.length))
  .replaceAll('{{PACK_COUNT}}', String(packs.length))
  .replace('{{TABS}}', tabs)
  .replace('{{BANDS}}', bands)
  .replace('{{FIRST_PACK}}', esc(packs[0].name));

const out = join(SITE, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
cpSync(join(SITE, 'public'), out, { recursive: true });
console.log(`site/dist: ${all.length} skills in ${packs.length} packs`);
