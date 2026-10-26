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
// "2026-10-22" -> "22 Oct 2026"
const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
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
      reviewed: v?.reviewed ?? '',
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
    (p, i) => `<button class="tab" type="button" data-pack="${esc(p.name)}" aria-pressed="${i === 0}" aria-controls="bands">
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
    <span class="band-src">${esc(s.source)}${s.commit ? ` at ${esc(s.commit)}` : ''}${s.reviewed ? `, reviewed ${esc(day(s.reviewed))}` : ''}</span>
  </a>
</li>`,
  )
  .join('\n');

const SITE_URL = 'https://skillshed.munyamakosa.com';
const today = new Date().toISOString().slice(0, 10);
const description = `Install ${all.length} vetted agent skills for Claude Code and Codex with one command. Packs switch on per project; upstream skills are pinned and scanned.`;
const shareDescription = 'One install for Claude Code and Codex. Packs switch on per project; upstream skills are pinned to a commit and scanned for prompt injection.';

// Questions shown on the page; the FAQPage data below repeats them exactly.
// Answers are plain text with `code` spans.
const faq = [
  ['What is an agent skill?', 'A skill is a folder with a SKILL.md file: instructions, and sometimes scripts, that an AI coding agent loads when a task matches the skill\'s description. Claude Code and Codex both read the open Agent Skills format, so the same skill works in both.'],
  ['What does Skillshed add?', 'It gathers vetted skills into one plugin marketplace that Claude Code and Codex both understand, installs it with one command, keeps the always-on list short so skills keep triggering, and pins every third-party skill to a commit after scanning it for prompt injection.'],
  ['Why are most packs off?', `Agents read every enabled skill's description on every request, within a budget of about 1 to 2% of context. Past that, skills quietly stop triggering. Core and Matt Pocock's skills stay on; stack packs switch on only in projects that use them, with \`skillshed use supabase\`.`],
  ['Can I add my own skills?', 'Yes. `skillshed new my-skill "Use when ..."` starts one, and `skillshed add owner/repo@skill` adds any skill from GitHub or skills.sh for you only. Both go into your own skill folders for Claude Code and Codex. Added skills are scanned before they install, but no person reviews them; see the next question.'],
  ['What does vetted mean?', 'It depends on where a skill comes from. Skills in the shared packs are scanned, read file by file by a person before they are pinned, and only change through a pull request a person merges. Each one on the wall shows its source commit and the date that version was reviewed. Skills you add for yourself with `skillshed add` get the same automated scan, but no person reads them. They follow upstream by default, and `skillshed update` moves them forward whenever a new version passes the scan. Add `--pin` to keep one at the commit you checked.'],
  ['How do I share a skill with everyone?', 'Check it with `skillshed vet owner/repo@skill`, then submit it on GitHub. A workflow scans it and replies on the issue; a person reads every file before pinning it into a pack.'],
  ['Is it safe?', 'No scanner can prove a skill is safe. Skillshed narrows the risk: every upstream skill is pinned to a commit and content hash, scanned for hidden text, override phrasing and data exfiltration, and only updated through pull requests a person merges.'],
  ['How do I update or remove it?', '`skillshed update` pulls the latest skills into both tools. To remove it, run `claude plugin marketplace remove skillshed` and `codex plugin marketplace remove skillshed`, then delete `~/.skillshed`.'],
  ['What does it cost?', 'Nothing. Skillshed is MIT licensed, and the skills it carries keep their own open-source licences.'],
];
const codeSpans = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
const faqHtml = faq
  .map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p class="a">${codeSpans(a)}</p></details>`)
  .join('\n');

// Structured data describes only what the page shows: the tool, the site and its questions.
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
      installUrl: `${SITE_URL}/install`,
      sameAs: [`https://github.com/${REPO}`],
      author: { '@type': 'Person', name: 'Munyaradzi Makosa', url: 'https://munyamakosa.com' },
    },
    { '@type': 'WebSite', '@id': `${SITE_URL}/#site`, name: 'Skillshed', url: `${SITE_URL}/`, about: { '@id': `${SITE_URL}/#app` } },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/`/g, '') } })),
    },
  ],
}).replace(/</g, '\\u003c');

const html = readFileSync(join(SITE, 'template.html'), 'utf8')
  .replaceAll('{{SITE}}', SITE_URL)
  .replaceAll('{{DESCRIPTION}}', esc(description))
  .replaceAll('{{SHARE_DESCRIPTION}}', esc(shareDescription))
  .replace('{{JSONLD}}', jsonld)
  .replace('{{FAQ}}', faqHtml)
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

Install: \`curl -fsSL ${SITE_URL}/install/llms | bash\`

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
