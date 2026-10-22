#!/usr/bin/env node
// Personal skills: your own, or third-party ones only you want. They live in
// the tools' user skill folders, not in this repo, with the same scan and
// pinning as shared skills. Codex reads ~/.agents/skills; Claude Code reads
// ~/.claude/skills, which gets a symlink to the same folder.
//
//   add <source> [--ref r] [--path p] [--name n] [--pin] [--accept-risk]
//   new <name> "<Use when ...>"     scaffold your own skill
//   list                             personal skills and where they come from
//   update [name...]                 move tracked third-party skills to their ref
//   remove <name>
//   vet <source | folder> [--report file]   scan without installing
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, lstatSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { ROOT, hashDir } from './lib.mjs';
import { resolve, resolveCommit, fetchCommit, install } from './fetch.mjs';

const HOME = homedir();
const AGENTS = join(HOME, '.agents/skills');
const CLAUDE = join(HOME, '.claude/skills');
const LOCK = join(process.env.XDG_CONFIG_HOME ?? join(HOME, '.config'), 'skillshed/personal.lock.json');

const [cmd, ...rest] = process.argv.slice(2);
const opt = (f) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);
const flag = (f) => rest.includes(f);
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--ref', '--path', '--name', '--report'].includes(rest[i - 1]));

const readLock = () => (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { version: 1, skills: {} });
const writeLock = (l) => {
  mkdirSync(join(LOCK, '..'), { recursive: true });
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

// Claude Code sees the same folder through a symlink.
function link(name) {
  mkdirSync(CLAUDE, { recursive: true });
  const target = join(CLAUDE, name);
  if (existsSync(target) || isLink(target)) {
    if (!isLink(target)) throw new Error(`${target} already exists and is not Skillshed's; remove it or pick another --name`);
    rmSync(target);
  }
  symlinkSync(join(AGENTS, name), target);
}
const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

function guardName(name, lock) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`"${name}" is not a valid skill name (lowercase letters, digits and hyphens)`);
  if (existsSync(join(AGENTS, name)) && !lock.skills[name]) throw new Error(`${join(AGENTS, name)} already exists and is not managed by Skillshed`);
}

process.on('uncaughtException', (e) => {
  console.error(`error: ${e.stderr?.toString().trim() || e.message}`);
  process.exit(1);
});

const lock = readLock();

if (cmd === 'add') {
  const r = resolve(positional[0] ?? '', { ref: opt('--ref'), path: opt('--path'), name: opt('--name') });
  guardName(r.name, lock);
  // Stage and scan before anything lands in a folder an agent reads.
  const staged = join(mkdtempSync(join(tmpdir(), 'skillshed-stage-')), r.name);
  install(r.tmp, r.path, staged);
  rmSync(r.tmp, { recursive: true, force: true });
  if (!scan([staged]) && !flag('--accept-risk')) {
    console.error(`\nNot installed: high-severity findings in ${r.name}. Read them; re-run with --accept-risk only if they are false positives.`);
    process.exit(1);
  }
  const dest = join(AGENTS, r.name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(AGENTS, { recursive: true });
  execFileSync('cp', ['-R', staged, dest]);
  link(r.name);
  lock.skills[r.name] = { kind: 'vendored', source: r.repo, path: r.path, ref: r.ref, commit: r.commit, pinned: flag('--pin'), computedHash: hashDir(dest) };
  writeLock(lock);
  console.log(`added ${r.name} @ ${r.commit.slice(0, 7)} to ~/.agents/skills (Codex) and ~/.claude/skills (Claude Code). Restart sessions to load it.`);
} else if (cmd === 'new') {
  const [name, description] = positional;
  if (!name || !description) throw new Error('usage: skillshed new <name> "<Use when ... one job, one sentence>"');
  guardName(name, lock);
  if (lock.skills[name]) throw new Error(`${name} already exists`);
  const dir = join(AGENTS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n\n# ${name}\n\nWrite the steps an agent should follow here. Keep it under 500 lines; put long reference material in references/ and link to it.\n\n## Steps\n\n1. \n`,
  );
  link(name);
  lock.skills[name] = { kind: 'own' };
  writeLock(lock);
  console.log(`created ${join(dir, 'SKILL.md')} (linked into ~/.claude/skills). Edit it, then restart sessions.`);
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
    if (!e || e.kind !== 'vendored' || e.pinned) continue;
    const commit = resolveCommit(e.source, e.ref);
    if (commit === e.commit) continue;
    const tmp = fetchCommit(e.source, commit);
    const staged = join(mkdtempSync(join(tmpdir(), 'skillshed-stage-')), name);
    install(tmp, e.path, staged);
    rmSync(tmp, { recursive: true, force: true });
    if (!scan([staged])) {
      console.error(`${name}: upstream ${commit.slice(0, 7)} has high-severity findings; kept ${e.commit.slice(0, 7)}`);
      continue;
    }
    const dest = join(AGENTS, name);
    rmSync(dest, { recursive: true, force: true });
    execFileSync('cp', ['-R', staged, dest]);
    lock.skills[name] = { ...e, commit, computedHash: hashDir(dest) };
    console.log(`${name}: ${e.commit.slice(0, 7)} -> ${commit.slice(0, 7)} (https://github.com/${e.source}/compare/${e.commit}...${commit})`);
  }
  writeLock(lock);
} else if (cmd === 'remove') {
  const name = positional[0];
  if (!lock.skills[name]) throw new Error(`${name} is not a personal Skillshed skill`);
  rmSync(join(AGENTS, name), { recursive: true, force: true });
  if (isLink(join(CLAUDE, name))) rmSync(join(CLAUDE, name));
  delete lock.skills[name];
  writeLock(lock);
  console.log(`removed ${name}`);
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
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(cmd ? 1 : 0);
}
