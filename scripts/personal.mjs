#!/usr/bin/env node
// Personal skills: your own, or third-party ones only you want. They live in
// the tools' user skill folders, not in this repo, with the same scan and
// pinning as shared skills. Codex reads ~/.agents/skills; Claude Code reads
// ~/.claude/skills, which gets a symlink to the same folder.
//
//   add <source> [--ref r] [--path p] [--name n] [--pin] [--accept-risk] [--force]
//   new <name> "<Use when ...>"     scaffold your own skill
//   list                             personal skills and where they come from
//   update [name...] [--force]       move tracked third-party skills to their ref
//   remove <name>                    moves it to a backup and says how to restore it
//   vet <source | folder> [--report file]   scan without installing
//
// Nothing is deleted: a replaced or removed skill moves to
// ~/.config/skillshed/backups/<name>-<time>/. add and update refuse a skill
// whose installed files you have edited, unless you pass --force.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, lstatSync, mkdtempSync, renameSync, cpSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { ROOT, hashDir, listFiles, frontmatter, skills } from './lib.mjs';
import { resolve, resolveCommit, fetchCommit, install } from './fetch.mjs';

const HOME = homedir();
const AGENTS = join(HOME, '.agents/skills');
const CLAUDE = join(HOME, '.claude/skills');
const LOCK = join(process.env.XDG_CONFIG_HOME ?? join(HOME, '.config'), 'skillshed/personal.lock.json');
const BACKUPS = join(dirname(LOCK), 'backups');

const [cmd, ...rest] = process.argv.slice(2);
const opt = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);
const flag = (f) => rest.includes(f);
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--ref', '--path', '--name', '--report'].includes(rest[i - 1]));

const readLock = () => (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { version: 1, skills: {} });
const writeLock = (l) => {
  mkdirSync(dirname(LOCK), { recursive: true });
  writeFileSync(LOCK, JSON.stringify(l, null, 2) + '\n');
};

function scan(dirs, report) {
  const args = [join(ROOT, 'scripts/scan-skills.mjs'), ...dirs, ...(report ? ['--report', report] : [])];
  try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const present = (p) => existsSync(p) || isLink(p);
// Is ~/.claude/skills/<name> our symlink to ~/.agents/skills/<name>?
const ourLink = (name) => isLink(join(CLAUDE, name)) && resolvePath(CLAUDE, readlinkSync(join(CLAUDE, name))) === join(AGENTS, name);

// Claude Code sees the same folder through a symlink. checkLink runs before
// anything is written, so link() never meets someone else's folder.
function checkLink(name) {
  const target = join(CLAUDE, name);
  if (present(target) && !ourLink(name)) throw new Error(`${target} already exists and is not Skillshed's link; move it or pick another --name`);
}
function link(name) {
  mkdirSync(CLAUDE, { recursive: true });
  if (!ourLink(name)) symlinkSync(join(AGENTS, name), join(CLAUDE, name));
}

function guardName(name, lock) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`"${name}" is not a valid skill name (lowercase letters, digits and hyphens)`);
  if (name.length > 64) throw new Error(`"${name}" is longer than 64 characters`);
  if (present(join(AGENTS, name)) && !lock.skills[name]) throw new Error(`${join(AGENTS, name)} already exists and is not managed by Skillshed`);
  checkLink(name);
}

// Per-file hashes, so a refusal can say which files you changed.
function fileHashes(dir) {
  const out = {};
  for (const rel of listFiles(dir)) {
    const p = join(dir, rel);
    out[rel] = createHash('sha256').update(isLink(p) ? `symlink:${readlinkSync(p)}` : readFileSync(p)).digest('hex');
  }
  return out;
}
const record = (dir) => ({ computedHash: hashDir(dir), files: fileHashes(dir) });

// What changed in the installed copy since Skillshed put it there; null if nothing.
function localEdits(name, e) {
  const dest = join(AGENTS, name);
  if (!present(dest)) return null;
  if (e.kind === 'own') return ['it is your own skill'];
  if (hashDir(dest) === e.computedHash) return null;
  if (!e.files) return ['contents changed since install'];
  const now = fileHashes(dest);
  return [...new Set([...Object.keys(now), ...Object.keys(e.files)])]
    .sort()
    .filter((f) => now[f] !== e.files[f])
    .map((f) => (!(f in now) ? `${f} (deleted)` : !(f in e.files) ? `${f} (added)` : f));
}
const editError = (name, edits) =>
  `${name}: ${join(AGENTS, name)} has local changes (${edits.join(', ')}). Re-run with --force to replace it; your copy moves to ${BACKUPS}.`;

// The fetched SKILL.md must have frontmatter with a description.
function checkFetched(dir, name) {
  const fm = frontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  if (!fm) throw new Error(`${name}: SKILL.md has no frontmatter`);
  if (!fm.description?.trim()) throw new Error(`${name}: SKILL.md frontmatter has no description`);
  if (fm.name && fm.name !== name) console.log(`note: upstream names this skill "${fm.name}"; installing it as "${name}"`);
}

// Rename, or copy then delete when the backups dir is on another disk.
function move(from, to) {
  try {
    renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

// Moves ~/.agents/skills/<name> into the backups dir and returns where it went.
function backup(name) {
  mkdirSync(BACKUPS, { recursive: true });
  const base = join(BACKUPS, `${name}-${new Date().toISOString().replace(/:/g, '-')}`);
  let to = base;
  for (let i = 1; present(to); i++) to = `${base}-${i}`;
  move(join(AGENTS, name), to);
  return to;
}

// Copies the new version next to the old one, then swaps with renames, so a
// failure midway leaves the old copy or its backup intact. Returns the backup.
function place(name, staged) {
  const dest = join(AGENTS, name);
  mkdirSync(AGENTS, { recursive: true });
  const tmp = mkdtempSync(join(AGENTS, `.${name}.new-`));
  try {
    cpSync(staged, join(tmp, name), { recursive: true, verbatimSymlinks: true });
    const saved = present(dest) ? backup(name) : undefined;
    try {
      renameSync(join(tmp, name), dest);
    } catch (e) {
      if (saved) move(saved, dest);
      throw e;
    }
    return saved;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const stage = (name) => join(mkdtempSync(join(tmpdir(), 'skillshed-stage-')), name);

process.on('uncaughtException', (e) => {
  console.error(`error: ${e.stderr?.toString().trim() || e.message}`);
  process.exit(1);
});

const lock = readLock();

if (cmd === 'add') {
  const r = resolve(positional[0] ?? '', { ref: opt('--ref'), path: opt('--path'), name: opt('--name') });
  const staged = stage(r.name);
  // Every check runs before anything lands in a folder an agent reads.
  try {
    guardName(r.name, lock);
    const e = lock.skills[r.name];
    const edits = e && localEdits(r.name, e);
    if (edits && !flag('--force')) throw new Error(editError(r.name, edits));
    install(r.tmp, r.path, staged);
    checkFetched(staged, r.name);
  } finally {
    rmSync(r.tmp, { recursive: true, force: true });
  }
  if (!scan([staged]) && !flag('--accept-risk')) {
    console.error(`\nNot installed: high-severity findings in ${r.name}. Read them; re-run with --accept-risk only if they are false positives.`);
    process.exit(1);
  }
  const saved = place(r.name, staged);
  rmSync(dirname(staged), { recursive: true, force: true });
  link(r.name);
  const dest = join(AGENTS, r.name);
  lock.skills[r.name] = { kind: 'vendored', source: r.repo, path: r.path, ref: r.ref, commit: r.commit, pinned: flag('--pin'), ...record(dest) };
  writeLock(lock);
  console.log(`added ${r.name} @ ${r.commit.slice(0, 7)} to ~/.agents/skills (Codex) and ~/.claude/skills (Claude Code). Restart sessions to load it.`);
  if (saved) console.log(`previous copy: ${saved}`);
} else if (cmd === 'new') {
  const [name, raw] = positional;
  if (!name || raw === undefined) throw new Error('usage: skillshed new <name> "<Use when ... one job, one sentence>"');
  const description = raw.replace(/[\r\n\t]+/g, ' ').trim();
  guardName(name, lock);
  if (lock.skills[name]) throw new Error(`${name} already exists`);
  if (/anthropic|claude/.test(name)) throw new Error(`"${name}" is reserved: skill names can't contain "anthropic" or "claude"`);
  const shipped = skills().find((s) => s.name === name);
  if (shipped) throw new Error(`"${name}" is already a Skillshed skill in the ${shipped.pack} pack; pick another name`);
  if (!description) throw new Error('the description is empty');
  if (description.length > 1024) throw new Error(`the description is ${description.length} characters; the limit is 1024`);
  if (/[\u0000-\u001f\u007f]/.test(description)) throw new Error('the description contains control characters');
  if (!description.startsWith('Use when')) console.warn('warning: descriptions work best when they start with "Use when"');
  // A YAML double-quoted string when it needs no escapes (lib.mjs's reader
  // doesn't unescape), else a folded block, which has no escapes at all.
  const quoted = JSON.stringify(description);
  const yaml = quoted === `"${description}"` ? quoted : `>-\n  ${description}`;
  mkdirSync(AGENTS, { recursive: true });
  const tmp = mkdtempSync(join(AGENTS, `.${name}.new-`));
  try {
    const file = join(tmp, name, 'SKILL.md');
    mkdirSync(dirname(file));
    writeFileSync(
      file,
      `---\nname: ${JSON.stringify(name)}\ndescription: ${yaml}\n---\n\n# ${name}\n\nWrite the steps an agent should follow here. Keep it under 500 lines; put long reference material in references/ and link to it.\n\n## Steps\n\n1. \n`,
    );
    const fm = frontmatter(readFileSync(file, 'utf8'));
    if (fm?.name !== name || fm?.description !== description) throw new Error('the name or description did not read back exactly from SKILL.md; nothing was created');
    renameSync(dirname(file), join(AGENTS, name));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  link(name);
  lock.skills[name] = { kind: 'own' };
  writeLock(lock);
  console.log(`created ${join(AGENTS, name, 'SKILL.md')} (linked into ~/.claude/skills). Edit it, then restart sessions.`);
} else if (cmd === 'list') {
  const names = Object.keys(lock.skills).sort();
  if (!names.length) console.log('No personal skills yet. Try: skillshed add owner/repo@skill  or  skillshed new my-skill "Use when ..."');
  for (const n of names) {
    const e = lock.skills[n];
    console.log(e.kind === 'own' ? `${n}  (yours)` : `${n}  ${e.source} @ ${e.commit.slice(0, 7)} ${e.pinned ? 'pinned' : `tracks ${e.ref}`}`);
  }
} else if (cmd === 'update') {
  for (const name of positional.length ? positional : Object.keys(lock.skills)) {
    const e = lock.skills[name];
    if (!e) {
      console.error(`${name}: not a personal Skillshed skill`);
      process.exitCode = 1;
      continue;
    }
    if (e.kind === 'own') {
      if (positional.length) console.log(`${name}: your own skill; update never touches it`);
      continue;
    }
    if (e.kind !== 'vendored' || e.pinned) continue;
    try {
      const commit = resolveCommit(e.source, e.ref);
      if (commit === e.commit) continue;
      const edits = localEdits(name, e);
      if (edits && !flag('--force')) throw new Error(editError(name, edits));
      const tmp = fetchCommit(e.source, commit);
      const staged = stage(name);
      try {
        install(tmp, e.path, staged);
        checkFetched(staged, name);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
      if (!scan([staged])) {
        console.error(`${name}: upstream ${commit.slice(0, 7)} has high-severity findings; kept ${e.commit.slice(0, 7)}`);
        continue;
      }
      const saved = place(name, staged);
      rmSync(dirname(staged), { recursive: true, force: true });
      lock.skills[name] = { ...e, commit, ...record(join(AGENTS, name)) };
      writeLock(lock);
      console.log(`${name}: ${e.commit.slice(0, 7)} -> ${commit.slice(0, 7)} (https://github.com/${e.source}/compare/${e.commit}...${commit})`);
      if (saved) console.log(`  previous copy: ${saved}`);
    } catch (err) {
      console.error(`error: ${err.stderr?.toString().trim() || err.message}`);
      process.exitCode = 1;
    }
  }
} else if (cmd === 'remove') {
  const name = positional[0];
  const e = lock.skills[name];
  if (!e) throw new Error(`${name} is not a personal Skillshed skill`);
  const dest = join(AGENTS, name);
  const saved = present(dest) ? backup(name) : undefined;
  if (ourLink(name)) rmSync(join(CLAUDE, name));
  delete lock.skills[name];
  writeLock(lock);
  console.log(`removed ${name}`);
  if (saved) {
    console.log(`Your copy is in ${saved}. To restore it (Skillshed won't track it):\n  mv "${saved}" "${dest}" && ln -s "${dest}" "${join(CLAUDE, name)}"`);
    if (e.kind === 'vendored') console.log(`Or install it fresh and tracked: skillshed add ${e.source} --ref ${e.ref} --path ${e.path} --name ${name}`);
  }
} else if (cmd === 'vet') {
  const target = positional[0] ?? '';
  let dir = resolvePath(target);
  if (!existsSync(join(dir, 'SKILL.md'))) {
    const r = resolve(target);
    dir = join(mkdtempSync(join(tmpdir(), 'skillshed-vet-')), r.name);
    install(r.tmp, r.path, dir);
    rmSync(r.tmp, { recursive: true, force: true });
    console.log(`${r.repo}/${r.path} @ ${r.commit.slice(0, 7)}`);
  }
  const ok = scan([dir], opt('--report'));
  console.log(ok ? 'No high-severity findings. Still read every file before trusting it.' : 'High-severity findings: do not install without reading them.');
  process.exit(ok ? 0 : 1);
} else {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
