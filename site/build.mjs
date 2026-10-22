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

const all = skills()
  .map((s) => {
    const fm = frontmatter(readFileSync(s.file, 'utf8')) ?? {};
    const v = lock.skills[s.name];
    return {
      name: s.name,
      pack: s.pack,
      description: (fm.description ?? '').replace(/\s+/g, ' ').trim(),
      source: v ? v.source : REPO,
      url: v
        ? `https://github.com/${v.source}/tree/${v.commit}/${v.path}`
        : `https://github.com/${REPO}/tree/main/plugins/${s.pack}/skills/${s.name}`,
      vendored: Boolean(v),
    };
  })
  .sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name));

const packs = marketplace.plugins.map((p) => ({
  name: p.name,
  description: p.description.replace(/^(Stack pack|Pack): /, '').replace(/\s*(Enable per project|On by default)\.$/, ''),
  on: ALWAYS_ON.includes(p.name),
  count: all.filter((s) => s.pack === p.name).length,
  sources: [...new Set(all.filter((s) => s.pack === p.name).map((s) => s.source))],
}));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const packCards = packs
  .sort((a, b) => Number(b.on) - Number(a.on) || b.count - a.count)
  .map(
    (p) => `<article class="pack">
  <header><h3>${esc(p.name)}</h3><span class="badge ${p.on ? 'on' : 'off'}">${p.on ? 'always on' : 'per project'}</span></header>
  <p>${esc(p.description)}</p>
  <footer><span>${p.count} skills</span><span class="src">${p.sources.map(esc).join(' · ')}</span></footer>
  ${p.on ? '' : `<code class="mini">skillshed use ${esc(p.name)}</code>`}
</article>`,
  )
  .join('\n');

// Upstream descriptions are untrusted: embed as JSON (with < escaped) and
// render with textContent on the client, never innerHTML.
const data = JSON.stringify({ skills: all, packs: packs.map((p) => p.name) }).replace(/</g, '\\u003c');

const html = readFileSync(join(SITE, 'template.html'), 'utf8')
  .replaceAll('{{REPO}}', REPO)
  .replaceAll('{{SKILL_COUNT}}', String(all.length))
  .replaceAll('{{PACK_COUNT}}', String(packs.length))
  .replaceAll('{{VENDORED_COUNT}}', String(all.filter((s) => s.vendored).length))
  .replace('{{PACK_CARDS}}', packCards)
  .replace('{{DATA}}', data);

const out = join(SITE, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);
cpSync(join(SITE, 'public'), out, { recursive: true });
console.log(`site/dist: ${all.length} skills in ${packs.length} packs`);
