// Regression: "reviewed <date>" must mean a person recorded a review of that
// exact content. Fetching new content (add/update) never counts as a review.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reviewLabel, withContent, migrateEntry, hashDir } from '../scripts/lib.mjs';

let failed = 0;
const expect = (what, got, want) => {
  if (got !== want) { console.error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failed = 1; }
};

// A fake repo: the real scripts, one pack, one vendored skill.
const root = mkdtempSync(join(tmpdir(), 'skillshed-test-'));
cpSync(new URL('../scripts', import.meta.url).pathname, join(root, 'scripts'), { recursive: true });
const dir = join(root, 'plugins/demo/skills/demo-skill');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Use when testing.\n---\nv1\n');
const lockPath = join(root, 'vendor.lock.json');
const base = { source: 'o/r', path: 'demo-skill', ref: 'main', commit: 'a'.repeat(40), pack: 'demo', pinned: false };
const writeLockFile = (e) => writeFileSync(lockPath, JSON.stringify({ version: 1, skills: { 'demo-skill': e } }, null, 2) + '\n');
const entry = () => JSON.parse(readFileSync(lockPath, 'utf8')).skills['demo-skill'];
const review = (...args) => execFileSync(process.execPath, [join(root, 'scripts/sync-vendor.mjs'), 'review', ...args], { encoding: 'utf8', stdio: 'pipe' });
const today = new Date().toISOString().slice(0, 10);

// Freshly fetched content has no review.
writeLockFile(withContent(base, base.commit, hashDir(dir), '2026-11-01'));
expect('after add', reviewLabel(entry()), 'fetched 2026-11-01, review pending');

// The review command records the current hash.
let threw = false;
try { review('demo-skill'); } catch { threw = true; }
expect('review without --by fails', threw, true);
review('demo-skill', '--by', 'tester');
expect('after review', reviewLabel(entry()), `reviewed ${today}`);
expect('review.by', entry().review.by, 'tester');
expect('review.hash', entry().review.hash, hashDir(dir));

// An update brings new content: the old review no longer counts.
writeFileSync(join(dir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Use when testing.\n---\nv2\n');
writeLockFile(withContent(entry(), 'b'.repeat(40), hashDir(dir), '2026-11-09'));
expect('after update', reviewLabel(entry()), 'fetched 2026-11-09, review pending');
expect('update keeps old review record', entry().review.by, 'tester');

// --all-changed picks it up again.
review('--all-changed', '--by', 'tester2');
expect('after re-review', reviewLabel(entry()), `reviewed ${today}`);
expect('re-review.by', entry().review.by, 'tester2');

// Content edited on disk without a re-sync can't be reviewed into the lock.
writeFileSync(join(dir, 'SKILL.md'), 'tampered\n');
threw = false;
try { review('demo-skill', '--by', 'tester'); } catch { threw = true; }
expect('review of content not in the lock fails', threw, true);

// Migration of an old-style entry.
const old = { ...base, computedHash: 'c'.repeat(64), reviewed: '2026-10-22' };
const m = migrateEntry(old);
expect('migrated drops reviewed', 'reviewed' in m, false);
expect('migrated fetched', m.fetched, '2026-10-22');
expect('migrated review', JSON.stringify(m.review), JSON.stringify({ date: '2026-10-22', by: 'migrated', hash: 'c'.repeat(64) }));
expect('migrated label', reviewLabel(m), 'reviewed 2026-10-22');
expect('migrate is idempotent', JSON.stringify(migrateEntry(m)), JSON.stringify(m));
// An old-style entry that was never migrated is not treated as reviewed.
expect('unmigrated label', reviewLabel(old), 'review pending');

if (failed) process.exit(1);
console.log('review labels ok');
