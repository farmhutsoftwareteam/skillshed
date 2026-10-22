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

const SITE_URL = 'https://skillshed.munyamakosa.com';
const today = new Date().toISOString().slice(0, 10);
const description = `Install ${all.length} vetted agent skills for Claude Code and Codex with one command. Packs switch on per project; upstream skills are pinned and scanned.`;
const shareDescription = 'One install for Claude Code and Codex. Packs switch on per project; upstream skills are pinned to a commit and scanned for prompt injection.';

// Structured data describes only what the page shows: the tool and the site.
const jsonld = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#app`,
      name: 'Skillshed',
      description,
      url: `${SITE_URL}/`,
      image: `${SITE_URL}/og.png`,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux',
      softwareRequirements: 'Claude Code or Codex, git, Node.js 20+',
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      installUrl: `https://raw.githubusercontent.com/${REPO}/main/install.sh`,
      sameAs: [`https://github.com/${REPO}`],
      author: { '@type': 'Person', name: 'Munyaradzi Makosa', url: 'https://munyamakosa.com' },
    },
    { '@type': 'WebSite', '@id': `${SITE_URL}/#site`, name: 'Skillshed', url: `${SITE_URL}/`, about: { '@id': `${SITE_URL}/#app` } },
  ],
}).replace(/</g, '\\u003c');

const html = readFileSync(join(SITE, 'template.html'), 'utf8')
  .replaceAll('{{SITE}}', SITE_URL)
  .replaceAll('{{DESCRIPTION}}', esc(description))
  .replaceAll('{{SHARE_DESCRIPTION}}', esc(shareDescription))
  .replace('{{JSONLD}}', jsonld)
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

writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(
  join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
);
writeFileSync(
  join(out, 'site.webmanifest'),
  JSON.stringify({
    name: 'Skillshed',
    short_name: 'Skillshed',
    start_url: '/',
    display: 'browser',
    background_color: '#1c1c1c',
    theme_color: '#1c1c1c',
    icons: [
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }, null, 2) + '\n',
);

// llms.txt (llmstxt.org): a plain overview for AI assistants, built from the repo.
const byPack = packs.map((p) => {
  const list = all.filter((s) => s.pack === p.name).map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return `### ${p.name} (${p.on ? 'always on' : 'per project'}, ${p.count} skills)\n\n${list}`;
});
writeFileSync(
  join(out, 'llms.txt'),
  `# Skillshed

> Skillshed is a plugin marketplace of vetted agent skills for Claude Code and Codex. One command installs it on macOS or Linux. A small core is always on; stack packs (Next.js/Vercel, Supabase, Expo, Inngest) switch on per project. Third-party skills are pinned to a commit and content hash, scanned for prompt injection, and updated only through reviewed pull requests. MIT licensed.

Install: \`curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash\`

Turn a pack on in the current project: \`skillshed use <pack>\`. Search for new skills: \`skillshed find <keywords>\`. Update: \`skillshed update\`.

## Docs

- [README](https://github.com/${REPO}#readme): install, packs, everyday commands
- [Security model](https://github.com/${REPO}#security-prompt-injection-and-supply-chain): pinning, scanning, reviewed updates
- [vendor.lock.json](https://github.com/${REPO}/blob/main/vendor.lock.json): every third-party skill with its source and commit

## Skills (${all.length})

${byPack.join('\n\n')}
`,
);
console.log(`site/dist: ${all.length} skills in ${packs.length} packs`);
