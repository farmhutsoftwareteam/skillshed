#!/usr/bin/env node
// Vendors third-party skills into a pack and pins them in vendor.lock.json.
// Only copies files: it never runs anything from the fetched repo.
//
//   add <source> --pack <pack> [--ref <branch|tag|sha>] [--name <name>] [--pin] [--accept-risk]
//       source: owner/repo@skill | https://skills.sh/owner/repo/skill
//             | https://github.com/owner/repo/tree/<ref>/<path> | owner/repo --path <dir>
//       --pin keeps it frozen at this commit; otherwise `update` follows --ref.
//   update [name...] [--force] [--summary <file>]
//       Moves tracked skills to the latest commit of their ref. Pinned skills
//       only move when named with --force.
//   remove <name>
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, packs, readLock, writeLock, hashDir } from './lib.mjs';
import { git, resolve, resolveCommit, fetchCommit, install } from './fetch.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);
const flag = (f) => rest.includes(f);
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--pack', '--ref', '--path', '--name', '--summary'].includes(rest[i - 1]));

// Keeps the upstream repo's license next to its skills (MIT and friends
// require the notice to travel with copies).
function saveLicense(tmp, repo) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license.md', 'license', 'LICENCE', 'COPYING']) {
    try {
      const text = git(['show', `FETCH_HEAD:${name}`], tmp);
      mkdirSync(join(ROOT, 'licenses'), { recursive: true });
      writeFileSync(join(ROOT, 'licenses', `${repo.replace('/', '__')}.txt`), text + '\n');
      return;
    } catch {}
  }
  console.warn(`${repo}: no LICENSE file found; check its terms before redistributing`);
}

function scan(dir) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/scan-skills.mjs'), relative(process.cwd(), dir)], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

process.on('uncaughtException', (e) => {
  console.error(`error: ${e.stderr?.toString().trim() || e.message}`);
  process.exit(1);
});

const lock = readLock();
// The date a person-reviewed PR brings new content in; shown on the site.
const today = new Date().toISOString().slice(0, 10);

if (cmd === 'add') {
  const pack = opt('--pack');
  if (!packs().includes(pack)) throw new Error(`--pack must be one of: ${packs().join(', ')}`);
  const { repo, ref, commit, path, name, tmp } = resolve(positional[0] ?? '', { ref: opt('--ref'), path: opt('--path'), name: opt('--name') });
  const src = { repo };
  const owned = existsSync(join(ROOT, 'plugins', pack, 'skills', name)) && !lock.skills[name];
  if (owned) throw new Error(`${name} already exists as an owned skill in ${pack}`);
  const prev = lock.skills[name];
  if (prev && (prev.pack !== pack || prev.source !== src.repo || prev.path !== path)) {
    throw new Error(`${name} is already vendored from ${prev.source}/${prev.path} in ${prev.pack}; pass --name <other-name>`);
  }
  const dest = join(ROOT, 'plugins', pack, 'skills', name);
  install(tmp, path, dest);
  saveLicense(tmp, src.repo);
  rmSync(tmp, { recursive: true, force: true });
  if (!scan(dest) && !flag('--accept-risk')) {
    rmSync(dest, { recursive: true, force: true });
    console.error(`\nRemoved ${name}: high-severity scan findings. Review them; re-run with --accept-risk only if they are false positives.`);
    process.exit(1);
  }
  lock.skills[name] = { source: src.repo, path, ref, commit, pack, pinned: flag('--pin'), computedHash: hashDir(dest), reviewed: today };
  writeLock(lock);
  console.log(`added ${name} -> plugins/${pack}/skills/${name} @ ${commit.slice(0, 7)} (${flag('--pin') ? 'pinned' : `tracks ${ref}`})`);
  console.log('Next: node scripts/check.mjs --write');
} else if (cmd === 'update') {
  const names = positional.length ? positional : Object.keys(lock.skills);
  const lines = [];
  const groups = new Map();
  for (const name of names) {
    const e = lock.skills[name];
    if (!e) throw new Error(`${name} is not in vendor.lock.json`);
    if (e.pinned && !(flag('--force') && positional.includes(name))) { lines.push(`- ${name}: pinned at \`${e.commit.slice(0, 7)}\`, skipped`); continue; }
    const key = `${e.source}#${e.ref}`;
    if (!groups.has(key)) groups.set(key, resolveCommit(e.source, e.ref));
    const commit = groups.get(key);
    if (commit === e.commit) continue;
    const tmp = fetchCommit(e.source, commit);
    const dest = join(ROOT, 'plugins', e.pack, 'skills', name);
    install(tmp, e.path, dest);
    saveLicense(tmp, e.source);
    rmSync(tmp, { recursive: true, force: true });
    const computedHash = hashDir(dest);
    if (computedHash === e.computedHash) { lock.skills[name] = { ...e, commit }; continue; }
    lines.push(`- **${name}** (${e.pack}): [\`${e.commit.slice(0, 7)}...${commit.slice(0, 7)}\`](https://github.com/${e.source}/compare/${e.commit}...${commit}) in \`${e.source}/${e.path}\``);
    lock.skills[name] = { ...e, commit, computedHash, reviewed: today };
  }
  writeLock(lock);
  const summary = lines.length ? lines.join('\n') : 'No upstream changes.';
  console.log(summary);
  if (opt('--summary')) writeFileSync(opt('--summary'), summary + '\n');
} else if (cmd === 'remove') {
  const name = positional[0];
  const e = lock.skills[name];
  if (!e) throw new Error(`${name} is not in vendor.lock.json`);
  rmSync(join(ROOT, 'plugins', e.pack, 'skills', name), { recursive: true, force: true });
  delete lock.skills[name];
  writeLock(lock);
  console.log(`removed ${name}`);
} else {
  console.log('usage: sync-vendor.mjs add <source> --pack <pack> [--ref r] [--path p] [--pin] [--accept-risk]\n       sync-vendor.mjs update [name...] [--force] [--summary file]\n       sync-vendor.mjs remove <name>');
  process.exit(cmd ? 1 : 0);
}
