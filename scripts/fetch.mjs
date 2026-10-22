// Fetching skills from GitHub: parse a source, resolve it to a commit, and
// copy one skill folder out. Only copies files; never runs fetched code.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { frontmatter } from './lib.mjs';

export const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const url = (repo) => `https://github.com/${repo}.git`;

// owner/repo@skill | https://skills.sh/owner/repo/skill | https://github.com/owner/repo[/tree/<ref>/<path>]
export function parseSource(s) {
  let m;
  if ((m = s.match(/^https:\/\/(?:www\.)?skills\.sh\/([^/]+\/[^/]+)\/([^/?#]+)/))) return { repo: m[1], skill: m[2] };
  if ((m = s.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+?))?\/?$/))) return { repo: m[1], ref: m[2], path: m[3] };
  if ((m = s.match(/^([\w.-]+\/[\w.-]+)(?:@([\w.-]+))?$/))) return { repo: m[1], skill: m[2] };
  throw new Error(`unrecognised source: ${s} (use owner/repo@skill, a skills.sh URL or a GitHub tree URL)`);
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
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', url(repo), commit], dir);
  return dir;
}

export function findSkillPath(tmp, skill) {
  const files = git(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'], tmp).split('\n');
  const hits = files
    .filter((p) => p.endsWith('/SKILL.md') && basename(dirname(p)) === skill)
    .map(dirname)
    .sort((a, b) => a.length - b.length);
  if (!hits.length) {
    // Folder names don't always match the skill name (skills.sh lists by name).
    for (const p of files.filter((f) => f.endsWith('SKILL.md'))) {
      if (frontmatter(git(['show', `FETCH_HEAD:${p}`], tmp))?.name === skill) return dirname(p);
    }
    throw new Error(`no skill named "${skill}" in this repo`);
  }
  if (hits.length > 1) console.warn(`several matches for ${skill}, using ${hits[0]}: ${hits.join(', ')}`);
  return hits[0];
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
  const r = ref ?? src.ref ?? defaultBranch(src.repo);
  const commit = resolveCommit(src.repo, r);
  const tmp = fetchCommit(src.repo, commit);
  const p = path ?? src.path ?? findSkillPath(tmp, src.skill ?? '');
  return { repo: src.repo, ref: r, commit, path: p, name: name ?? src.skill ?? basename(p), tmp };
}
