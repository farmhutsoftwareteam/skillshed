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
import { mkdtempSync, rmSync, cpSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname, relative } from 'node:path';
import { ROOT, packs, readLock, writeLock, hashDir, frontmatter } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);
const flag = (f) => rest.includes(f);
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--pack', '--ref', '--path', '--name', '--summary'].includes(rest[i - 1]));

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const url = (repo) => `https://github.com/${repo}.git`;

function parseSource(s) {
  let m;
  if ((m = s.match(/^https:\/\/skills\.sh\/([^/]+\/[^/]+)\/([^/?#]+)/))) return { repo: m[1], skill: m[2] };
  if ((m = s.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+?))?\/?$/))) return { repo: m[1], ref: m[2], path: m[3] };
  if ((m = s.match(/^([\w.-]+\/[\w.-]+)(?:@([\w.-]+))?$/))) return { repo: m[1], skill: m[2] };
  throw new Error(`unrecognised source: ${s}`);
}

function defaultBranch(repo) {
  const out = git(['ls-remote', '--symref', url(repo), 'HEAD']);
  return out.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? 'main';
}

function resolveCommit(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const out = git(['ls-remote', url(repo), ref, `refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`]);
  const sha = out.split('\n').filter(Boolean).map((l) => l.split('\t')[0])[0];
  if (!sha) throw new Error(`${repo}: ref "${ref}" not found`);
  return sha;
}

// Shallow, blob-less fetch of one commit; returns the temp repo dir.
function fetchCommit(repo, commit) {
  const dir = mkdtempSync(join(tmpdir(), 'skillshed-'));
  git(['init', '-q'], dir);
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', url(repo), commit], dir);
  return dir;
}

function findSkillPath(tmp, skill) {
  const hits = git(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'], tmp)
    .split('\n')
    .filter((p) => p.endsWith('/SKILL.md') && basename(dirname(p)) === skill)
    .map(dirname)
    .sort((a, b) => a.length - b.length);
  if (!hits.length) {
    // Folder names don't always match the skill name (skills.sh lists by name).
    const all = git(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'], tmp).split('\n').filter((p) => p.endsWith('SKILL.md'));
    for (const p of all) {
      if (frontmatter(git(['show', `FETCH_HEAD:${p}`], tmp))?.name === skill) return dirname(p);
    }
    throw new Error(`no skill named "${skill}" in this repo`);
  }
  if (hits.length > 1) console.warn(`several matches for ${skill}, using ${hits[0]}: ${hits.join(', ')}`);
  return hits[0];
}

// Extracts <path> at FETCH_HEAD into the pack, replacing what was there.
function install(tmp, path, dest) {
  const out = mkdtempSync(join(tmpdir(), 'skillshed-out-'));
  execFileSync('sh', ['-c', 'git archive FETCH_HEAD "$1" | tar -x -C "$2"', 'sh', path, out], { cwd: tmp });
  if (!existsSync(join(out, path, 'SKILL.md'))) throw new Error(`${path}/SKILL.md not found at that commit`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(out, path), dest, { recursive: true, verbatimSymlinks: true });
  rmSync(out, { recursive: true, force: true });
}

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

if (cmd === 'add') {
  const src = parseSource(positional[0] ?? '');
  const pack = opt('--pack');
  if (!packs().includes(pack)) throw new Error(`--pack must be one of: ${packs().join(', ')}`);
  const ref = opt('--ref') ?? src.ref ?? defaultBranch(src.repo);
  const commit = resolveCommit(src.repo, ref);
  const tmp = fetchCommit(src.repo, commit);
  const path = opt('--path') ?? src.path ?? findSkillPath(tmp, src.skill ?? '');
  const name = opt('--name') ?? src.skill ?? basename(path);
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
  lock.skills[name] = { source: src.repo, path, ref, commit, pack, pinned: flag('--pin'), computedHash: hashDir(dest) };
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
    lock.skills[name] = { ...e, commit, computedHash };
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
