#!/usr/bin/env node
// Lints every skill, checks vendored skills against vendor.lock.json, checks
// both marketplaces list every pack, and (with --write) regenerates the
// router index. Exits 1 on any error.
//
//   node scripts/check.mjs           # check only (CI)
//   node scripts/check.mjs --write   # also rewrite the skill-router index
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, packs, skills, frontmatter, hashDir, readLock } from './lib.mjs';

const WRITE = process.argv.includes('--write');
const OWNED_DESC_MAX = 300; // keep the always-loaded listing small
const SPEC_DESC_MAX = 1024; // agentskills.io limit
const errors = [];
const warnings = [];
const lock = readLock();

const rows = [];
const seen = new Map();
for (const s of skills()) {
  const where = relative(ROOT, s.file);
  if (!existsSync(s.file)) { errors.push(`${where}: missing SKILL.md`); continue; }
  const fm = frontmatter(readFileSync(s.file, 'utf8'));
  if (!fm) { errors.push(`${where}: no frontmatter`); continue; }
  const vendored = Boolean(lock.skills[s.name]);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? '') || fm.name.length > 64) errors.push(`${where}: invalid name "${fm.name}"`);
  if (fm.name !== s.name) errors.push(`${where}: name "${fm.name}" must match folder "${s.name}"`);
  const desc = fm.description ?? '';
  if (!desc) errors.push(`${where}: missing description`);
  if (desc.length > SPEC_DESC_MAX) errors.push(`${where}: description ${desc.length} chars > ${SPEC_DESC_MAX}`);
  else if (desc.length > OWNED_DESC_MAX) (vendored ? warnings : errors).push(`${where}: description ${desc.length} chars > ${OWNED_DESC_MAX}`);
  if (!vendored && !/^use when/i.test(desc)) errors.push(`${where}: owned skill descriptions start with "Use when"`);
  if (seen.has(s.name)) errors.push(`${where}: duplicate skill name (also in ${seen.get(s.name)})`);
  seen.set(s.name, s.pack);
  rows.push({ ...s, desc, vendored });
}

// Vendored skills must match the lock exactly: no silent hand edits.
for (const [name, e] of Object.entries(lock.skills)) {
  const dir = join(ROOT, 'plugins', e.pack, 'skills', name);
  if (!existsSync(dir)) { errors.push(`vendor.lock.json: ${name} not found in plugins/${e.pack}/skills`); continue; }
  if (hashDir(dir) !== e.computedHash) errors.push(`plugins/${e.pack}/skills/${name}: content differs from vendor.lock.json (edit upstream or re-sync)`);
}

// Both marketplaces list exactly the packs on disk.
const want = packs().join(',');
const claude = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const codex = JSON.parse(readFileSync(join(ROOT, '.agents/plugins/marketplace.json'), 'utf8'));
for (const [label, m] of [['.claude-plugin/marketplace.json', claude], ['.agents/plugins/marketplace.json', codex]]) {
  const got = m.plugins.map((p) => p.name).sort().join(',');
  if (got !== want) errors.push(`${label}: lists [${got}] but plugins/ has [${want}]`);
}

// Router index.
const routerFile = join(ROOT, 'plugins/core/skills/skill-router/SKILL.md');
const cell = (t) => t.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const table = [
  '| Skill | Pack | Use when | Path |',
  '| --- | --- | --- | --- |',
  ...rows
    .filter((r) => r.name !== 'skill-router')
    .sort((a, b) => a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name))
    .map((r) => `| ${r.name} | ${r.pack} | ${cell(r.desc)} | \`${relative(ROOT, r.file)}\` |`),
].join('\n');
const router = readFileSync(routerFile, 'utf8');
const next = router.replace(/<!-- index:start -->[\s\S]*<!-- index:end -->/, `<!-- index:start -->\n${table}\n<!-- index:end -->`);
if (next !== router) {
  if (WRITE) writeFileSync(routerFile, next);
  else errors.push('skill-router index is stale: run node scripts/check.mjs --write');
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`${rows.length} skills in ${packs().length} packs, ${Object.keys(lock.skills).length} vendored: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
