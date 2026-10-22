#!/usr/bin/env node
// Creates an empty, off-by-default pack and registers it in both marketplaces.
//
//   node scripts/new-pack.mjs <name> "<one-line description>"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const [name, description] = process.argv.slice(2);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? '') || !description) {
  console.log('usage: new-pack.mjs <kebab-name> "<description>"');
  process.exit(1);
}
const dir = join(ROOT, 'plugins', name);
if (existsSync(dir)) throw new Error(`plugins/${name} already exists`);

const json = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const manifest = {
  name,
  description,
  author: { name: 'Munyaradzi Makosa', url: 'https://github.com/farmhutsoftwareteam' },
  repository: 'https://github.com/farmhutsoftwareteam/munya-skills',
  license: 'UNLICENSED',
};
for (const d of ['.claude-plugin', '.codex-plugin']) {
  mkdirSync(join(dir, d), { recursive: true });
  json(join(dir, d, 'plugin.json'), manifest);
}
mkdirSync(join(dir, 'skills'));
writeFileSync(join(dir, 'skills/.gitkeep'), '');

const claudeFile = join(ROOT, '.claude-plugin/marketplace.json');
const claude = JSON.parse(readFileSync(claudeFile, 'utf8'));
claude.plugins.push({ name, source: `./plugins/${name}`, description, category: 'coding' });
json(claudeFile, claude);

const codexFile = join(ROOT, '.agents/plugins/marketplace.json');
const codex = JSON.parse(readFileSync(codexFile, 'utf8'));
codex.plugins.push({ name, source: { source: 'local', path: `./plugins/${name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Coding' });
json(codexFile, codex);

console.log(`created pack ${name}. After pushing, re-run scripts/bootstrap.sh on each Mac to install it (disabled).`);
