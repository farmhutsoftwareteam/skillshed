// Regression: imports must not guess. A branch with a slash in its name keeps
// its whole name, and several skills sharing a name is an error, not a pick.
// Serves bare repos over file:// through SKILLSHED_GIT_BASE; no network.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const base = mkdtempSync(join(tmpdir(), 'skillshed-test-'));
process.env.SKILLSHED_GIT_BASE = `file://${base}`;
// Keep git away from the real home dir and its config.
process.env.HOME = base;
process.env.GIT_CONFIG_NOSYSTEM = '1';
const { resolve, parseSource, resolveCommit, fetchCommit, findSkillPath } = await import('../scripts/fetch.mjs');

const sh = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const skill = (name) => `---\nname: ${name}\ndescription: Use when testing.\n---\n`;

// Builds <base>/owner/<repo>.git from { branch: { path: content } }.
function repo(name, branches) {
  const bare = join(base, 'owner', `${name}.git`);
  mkdirSync(bare, { recursive: true });
  sh(['init', '-q', '--bare', '-b', 'main'], bare);
  sh(['config', 'uploadpack.allowFilter', 'true'], bare);
  const work = mkdtempSync(join(base, 'work-'));
  sh(['init', '-q', '-b', 'main'], work);
  for (const [branch, files] of Object.entries(branches)) {
    sh(['checkout', '-q', '-B', branch], work);
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(join(work, dirname(p)), { recursive: true });
      // The path in the body keeps every blob distinct, so each is fetched on its own.
      writeFileSync(join(work, p), `${body}\n${p}\n`);
    }
    sh(['add', '-A'], work);
    sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', branch], work);
    sh(['push', '-q', bare, `${branch}:${branch}`], work);
  }
  return `owner/${name}`;
}

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`ok   ${label}`);
  } catch (e) {
    failed = 1;
    console.error(`FAIL ${label}\n     ${e.message.replace(/\n/g, '\n     ')}`);
  }
}
const eq = (a, b) => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function throwsListing(fn, paths) {
  let err;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error('expected an error, got a match');
  for (const p of paths) if (!err.message.includes(p)) throw new Error(`error doesn't list ${p}: ${err.message}`);
  if (!err.message.includes('--path')) throw new Error(`error doesn't mention --path: ${err.message}`);
}

const slashed = repo('slashed', {
  main: { 'README.md': 'hi\n' },
  'feature/new-skill': { 'skills/foo/SKILL.md': skill('foo') },
});
// A decoy tag "feature" (a branch can't share the name): the longer ref must win.
sh(['tag', 'feature', 'main'], join(base, 'owner', 'slashed.git'));
const twins = repo('twins', { main: { 'a/foo/SKILL.md': skill('foo'), 'b/foo/SKILL.md': skill('foo') } });
const named = repo('named', { main: { 'x/one/SKILL.md': skill('foo'), 'y/two/SKILL.md': skill('foo'), 'z/bar/SKILL.md': skill('bar') } });
const single = repo('single', { main: { 'skills/foo/SKILL.md': skill('foo'), 'skills/renamed/SKILL.md': skill('baz') } });

check('tree URL with a slashed branch keeps the whole branch name', () => {
  const r = resolve(`https://github.com/${slashed}/tree/feature/new-skill/skills/foo`);
  eq(r.ref, 'feature/new-skill');
  eq(r.path, 'skills/foo');
  eq(r.name, 'foo');
});
check('blob URL to a SKILL.md trims to its folder', () => {
  const r = resolve(`https://github.com/${slashed}/blob/feature/new-skill/skills/foo/SKILL.md`);
  eq(r.ref, 'feature/new-skill');
  eq(r.path, 'skills/foo');
});
check('tree URL with an unknown ref fails clearly', () => {
  let msg = '';
  try { resolve(`https://github.com/${slashed}/tree/nope/skills/foo`); } catch (e) { msg = e.message; }
  if (!msg.includes('no branch or tag')) throw new Error(`unexpected: ${msg || 'no error'}`);
});
check('tree URL with a commit sha', () => {
  const sha = sh(['rev-parse', 'feature/new-skill'], join(base, 'owner', 'slashed.git'));
  const r = resolve(`https://github.com/${slashed}/tree/${sha}/skills/foo`);
  eq(r.commit, sha);
  eq(r.path, 'skills/foo');
});
check('two folders named foo is an error listing both', () => throwsListing(() => resolve(`${twins}@foo`), ['a/foo', 'b/foo']));
check('two frontmatter names foo is an error listing both', () => throwsListing(() => resolve(`${named}@foo`), ['x/one', 'y/two']));
check('path picks one of several', () => eq(resolve(`${twins}@foo`, { path: 'b/foo' }).path, 'b/foo'));
check('a single folder match still works', () => eq(resolve(`${single}@foo`).path, 'skills/foo'));
check('a single frontmatter match still works', () => eq(resolve(`${single}@baz`).path, 'skills/renamed'));
check('owner/repo@skill still parses', () => eq(parseSource('owner/repo@foo').skill, 'foo'));
check('SKILL.md blobs arrive in one fetch, not one each', () => {
  const tmp = fetchCommit(named, resolveCommit(named, 'main'));
  const oid = sh(['rev-parse', 'FETCH_HEAD:z/bar/SKILL.md'], tmp);
  try {
    execFileSync('git', ['cat-file', '-e', oid], { cwd: tmp, stdio: 'ignore', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
    throw new Error('blob was fetched up front; the blob-less fetch is not being exercised');
  } catch (e) { if (e.message.startsWith('blob was')) throw e; }
  const trace = join(base, 'trace.json');
  process.env.GIT_TRACE2_EVENT = trace;
  try { eq(findSkillPath(tmp, 'bar'), 'z/bar'); } finally { delete process.env.GIT_TRACE2_EVENT; }
  const fetches = readFileSync(trace, 'utf8').split('\n').filter((l) => l.includes('"event":"start"') && l.includes('"fetch"'));
  eq(fetches.length, 1);
});

rmSync(base, { recursive: true, force: true });
process.exit(failed);
