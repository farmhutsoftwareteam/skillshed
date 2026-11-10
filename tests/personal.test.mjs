// Regression: personal skills never lose a user's files, and `new` writes
// frontmatter that reads back exactly. Runs against a temp HOME and a local
// git repo; never touches the real home directory or the network.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { frontmatter, skills } from '../scripts/lib.mjs';

const T = mkdtempSync(join(tmpdir(), 'skillshed-personal-'));
const HOME = join(T, 'home');
const CONFIG = join(T, 'config');
const AGENTS = join(HOME, '.agents/skills');
const CLAUDE = join(HOME, '.claude/skills');
const BACKUPS = join(CONFIG, 'skillshed/backups');
mkdirSync(HOME);

const env = { ...process.env, HOME, XDG_CONFIG_HOME: CONFIG, SKILLSHED_GIT_BASE: `file://${join(T, 'git')}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const script = new URL('../scripts/personal.mjs', import.meta.url).pathname;
const run = (...args) => {
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};

let failures = 0;
const check = (cond, msg, out = '') => {
  if (cond) return;
  failures++;
  console.error(`FAIL: ${msg}${out ? `\n${out.replace(/^/gm, '    ')}` : ''}`);
};

// A bare repo owner/repo.git with skills/demo, plus a work tree to push from.
const git = (args, cwd) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const bare = join(T, 'git/owner/repo.git');
mkdirSync(bare, { recursive: true });
git(['init', '-q', '--bare', '-b', 'main'], bare);
const work = join(T, 'work');
mkdirSync(join(work, 'skills/demo'), { recursive: true });
mkdirSync(join(work, 'skills/broken'), { recursive: true });
git(['init', '-q', '-b', 'main'], work);
const commit = (body) => {
  writeFileSync(join(work, 'skills/demo/SKILL.md'), `---\nname: demo\ndescription: Use when testing Skillshed.\n---\n\n${body}\n`);
  writeFileSync(join(work, 'skills/broken/SKILL.md'), '# no frontmatter here\n');
  git(['add', '-A'], work);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', body], work);
  git(['push', '-q', bare, 'main'], work);
};
commit('Version one.');

const demo = join(AGENTS, 'demo', 'SKILL.md');
let r = run('add', 'owner/repo@demo');
check(r.ok && readFileSync(demo, 'utf8').includes('Version one.') && lstatSync(join(CLAUDE, 'demo')).isSymbolicLink(), 'add installs and links', r.out);

r = run('add', 'owner/repo@broken');
check(!r.ok && /no frontmatter/.test(r.out) && !existsSync(join(AGENTS, 'broken')), 'add refuses a SKILL.md without frontmatter', r.out);

// A real folder in ~/.claude/skills blocks add before the ~/.agents copy changes.
commit('Version two.');
rmSync(join(CLAUDE, 'demo'));
mkdirSync(join(CLAUDE, 'demo'));
writeFileSync(join(CLAUDE, 'demo', 'mine.txt'), 'keep me\n');
r = run('add', 'owner/repo@demo');
check(!r.ok && /not Skillshed's link/.test(r.out), 'add refuses a collision in ~/.claude/skills', r.out);
check(readFileSync(demo, 'utf8').includes('Version one.'), 'collision leaves the old ~/.agents copy untouched');
check(readFileSync(join(CLAUDE, 'demo', 'mine.txt'), 'utf8') === 'keep me\n', 'collision leaves the ~/.claude folder untouched');
rmSync(join(CLAUDE, 'demo'), { recursive: true });

// A local edit blocks update; --force backs it up and replaces it.
writeFileSync(demo, readFileSync(demo, 'utf8') + 'My local note.\n');
r = run('update', 'demo');
check(!r.ok && /local changes \(SKILL\.md\)/.test(r.out) && readFileSync(demo, 'utf8').includes('My local note.'), 'local edit blocks update', r.out);
r = run('update', 'demo', '--force');
const backedUp = r.out.match(/previous copy: (.+)/)?.[1];
check(r.ok && readFileSync(demo, 'utf8').includes('Version two.'), 'update --force installs the new version', r.out);
check(backedUp && readFileSync(join(backedUp, 'SKILL.md'), 'utf8').includes('My local note.'), 'update --force backs up the edited copy', r.out);

// remove backs up, and the printed command restores it.
r = run('remove', 'demo');
const saved = r.out.match(/Your copy is in (.+?)\. /)?.[1];
check(r.ok && !existsSync(join(AGENTS, 'demo')) && saved?.startsWith(BACKUPS) && existsSync(join(saved, 'SKILL.md')), 'remove moves the skill to a backup', r.out);
const restore = r.out.match(/^ {2}(mv .+)$/m)?.[1];
if (restore) execFileSync('sh', ['-c', restore]);
check(restore && readFileSync(demo, 'utf8').includes('Version two.') && existsSync(join(CLAUDE, 'demo', 'SKILL.md')), 'remove prints a working restore command', r.out);

// new: descriptions that would break plain YAML read back exactly.
for (const [name, description] of [
  ['tricky-one', `Use when parsing: # "quotes" --- and 'apostrophes'`],
  ['tricky-two', `'Use when' a leading quote: # --- \\back`],
  ['tricky-three', 'Use when it has a colon: and a # hash and ---'],
]) {
  r = run('new', name, description);
  const text = existsSync(join(AGENTS, name, 'SKILL.md')) ? readFileSync(join(AGENTS, name, 'SKILL.md'), 'utf8') : '';
  const fm = frontmatter(text);
  check(r.ok && fm?.name === name && fm?.description === description, `new round-trips ${JSON.stringify(description)}`, r.out + JSON.stringify(fm));
  // lib.mjs's reader is lenient, so also check real YAML would see one string:
  // a double-quoted scalar with no escapes, or a folded block.
  check(/^description: ("[^"\\]*"|>-\n {2}.*)$/m.test(text), `new quotes ${JSON.stringify(description)} as YAML`, text);
}
r = run('new', 'no-use-when', 'Formats things');
check(r.ok && /warning: .*Use when/.test(r.out), 'new warns when the description does not start with "Use when"', r.out);

// Own skills are never overwritten by update.
const own = join(AGENTS, 'tricky-one', 'SKILL.md');
const before = readFileSync(own, 'utf8');
r = run('update', 'tricky-one', '--force');
check(r.ok && readFileSync(own, 'utf8') === before, 'update leaves own skills alone', r.out);

// Rejected names and descriptions write nothing.
const shipped = skills()[0].name;
for (const [args, why] of [
  [['claude-helper', 'Use when x'], 'reserved'],
  [['my-anthropic-tool', 'Use when x'], 'reserved'],
  [[shipped, 'Use when x'], 'pack'],
  [['a'.repeat(65), 'Use when x'], 'longer than 64'],
  [['empty-desc', '   '], 'empty'],
  [['long-desc', 'Use when ' + 'x'.repeat(1020)], 'limit is 1024'],
]) {
  const listed = readdirSync(AGENTS).sort().join();
  r = run('new', ...args);
  check(!r.ok && r.out.includes(why) && readdirSync(AGENTS).sort().join() === listed, `new rejects ${args[0].slice(0, 20)} (${why})`, r.out);
}

rmSync(T, { recursive: true, force: true });
if (failures) process.exit(1);
console.log('personal skills ok');
