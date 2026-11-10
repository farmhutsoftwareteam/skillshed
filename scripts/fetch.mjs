// Fetching skills from GitHub: parse a source, resolve it to a commit, and
// copy one skill folder out. Only copies files; never runs fetched code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { frontmatter } from './lib.mjs';

export const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const url = (repo) => `${process.env.SKILLSHED_GIT_BASE ?? 'https://github.com'}/${repo}.git`;

// owner/repo@skill | https://skills.sh/owner/repo/skill
// | https://github.com/owner/repo[/tree/<ref>/<path> | /blob/<ref>/<path>/SKILL.md]
// A GitHub URL comes back as { repo, tree: '<ref>/<path>' }: branch names can
// contain slashes, so only the repo's real refs can say where the ref ends.
export function parseSource(s) {
  let m;
  if ((m = s.match(/^https:\/\/(?:www\.)?skills\.sh\/([^/]+\/[^/]+)\/([^/?#]+)/))) return { repo: m[1], skill: m[2] };
  if ((m = s.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)\/blob\/(.+)\/SKILL\.md$/))) return { repo: m[1], tree: m[2] };
  if ((m = s.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/(.+?))?\/?$/))) return { repo: m[1], tree: m[2] };
  if ((m = s.match(/^([\w.-]+\/[\w.-]+)(?:@([\w.-]+))?$/))) return { repo: m[1], skill: m[2] };
  throw new Error(`unrecognised source: ${s} (use owner/repo@skill, a skills.sh URL or a GitHub tree URL)`);
}

// Splits '<ref>/<path>' at the longest branch or tag that ends on a '/'.
function splitTree(repo, tree) {
  const first = tree.split('/')[0];
  if (/^[0-9a-f]{40}$/.test(first)) return { ref: first, path: tree.slice(41) || undefined };
  const refs = git(['ls-remote', '--heads', '--tags', url(repo)]).split('\n')
    .map((l) => l.split('\t')[1]?.replace(/^refs\/(heads|tags)\//, '').replace(/\^\{\}$/, ''))
    .filter(Boolean);
  const ref = refs.filter((r) => tree === r || tree.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  if (!ref) throw new Error(`${repo}: no branch or tag matches the start of "${tree}"`);
  return { ref, path: tree.slice(ref.length + 1) || undefined };
}

export function defaultBranch(repo) {
  const out = git(['ls-remote', '--symref', url(repo), 'HEAD']);
  return out.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? 'main';
}

export function resolveCommit(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const out = git(['ls-remote', url(repo), ref, `refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`]);
  const sha = out.split('\n').filter(Boolean).map((l) => l.split('\t')[0])[0];
  if (!sha) throw new Error(`${repo}: ref "${ref}" not found`);
  return sha;
}

// Shallow, blob-less fetch of one commit; returns the temp repo dir.
export function fetchCommit(repo, commit) {
  const dir = mkdtempSync(join(tmpdir(), 'skillshed-'));
  git(['init', '-q'], dir);
  git(['remote', 'add', 'origin', url(repo)], dir);
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', '--no-tags', 'origin', commit], dir);
  return dir;
}

// Contents of every SKILL.md at FETCH_HEAD, keyed by path. The fetch was
// blob-less, so pull all of them in one round trip rather than one each.
function readSkillFiles(tmp) {
  const entries = git(['ls-tree', '-r', 'FETCH_HEAD'], tmp).split('\n')
    .map((l) => l.match(/^\d+ blob ([0-9a-f]+)\t(.+\/SKILL\.md)$/))
    .filter(Boolean);
  if (!entries.length) return new Map();
  const oids = [...new Set(entries.map((e) => e[1]))];
  git(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', ...oids], tmp);
  // GIT_NO_LAZY_FETCH: if a blob is still missing, fail rather than fetch it alone.
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: tmp, input: oids.join('\n') + '\n', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
  const blobs = new Map();
  for (let i = 0; i < out.length;) {
    const nl = out.indexOf(10, i);
    const [oid, type, size] = out.subarray(i, nl).toString().split(' ');
    if (type !== 'blob') throw new Error(`could not fetch SKILL.md blob ${oid}`);
    blobs.set(oid, out.subarray(nl + 1, nl + 1 + Number(size)).toString('utf8'));
    i = nl + 2 + Number(size);
  }
  return new Map(entries.map(([, oid, p]) => [p, blobs.get(oid)]));
}

// Every folder named <skill>, plus every SKILL.md whose frontmatter name is
// <skill> (skills.sh lists by name, which doesn't always match the folder).
// Anything but exactly one match throws: a guess could vendor the wrong skill.
export function findSkillPath(tmp, skill) {
  const files = readSkillFiles(tmp);
  const hits = new Set();
  for (const [p, text] of files) {
    if (basename(dirname(p)) === skill || frontmatter(text)?.name === skill) hits.add(dirname(p));
  }
  if (!hits.size) throw new Error(`no skill named "${skill}" in this repo`);
  if (hits.size > 1) throw new Error(`several skills match "${skill}":\n${[...hits].sort().map((h) => `  ${h}`).join('\n')}\nchoose one with --path <dir>`);
  return [...hits][0];
}

// Extracts <path> at FETCH_HEAD into dest, replacing what was there.
export function install(tmp, path, dest) {
  const out = mkdtempSync(join(tmpdir(), 'skillshed-out-'));
  execFileSync('sh', ['-c', 'git archive FETCH_HEAD "$1" | tar -x -C "$2"', 'sh', path, out], { cwd: tmp });
  if (!existsSync(join(out, path, 'SKILL.md'))) throw new Error(`${path}/SKILL.md not found at that commit`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(out, path), dest, { recursive: true, verbatimSymlinks: true });
  rmSync(out, { recursive: true, force: true });
}

// Resolves a source to { repo, ref, commit, path, name } with the repo fetched at tmp.
export function resolve(source, { ref, path, name } = {}) {
  const src = parseSource(source);
  if (src.tree) {
    // An explicit --ref that starts the tree wins; otherwise ask the repo.
    if (ref && (src.tree === ref || src.tree.startsWith(`${ref}/`))) src.path = src.tree.slice(ref.length + 1) || undefined;
    else Object.assign(src, splitTree(src.repo, src.tree));
  }
  const r = ref ?? src.ref ?? defaultBranch(src.repo);
  const commit = resolveCommit(src.repo, r);
  const tmp = fetchCommit(src.repo, commit);
  const p = path ?? src.path ?? findSkillPath(tmp, src.skill ?? '');
  return { repo: src.repo, ref: r, commit, path: p, name: name ?? src.skill ?? basename(p), tmp };
}
