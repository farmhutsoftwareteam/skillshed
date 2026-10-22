// Shared helpers for the skillshed scripts. Node 20+, no dependencies.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK_PATH = join(ROOT, 'vendor.lock.json');

export function packs() {
  return readdirSync(join(ROOT, 'plugins'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// Every skill dir in every pack: { pack, name, dir, file }
export function skills() {
  const out = [];
  for (const pack of packs()) {
    const base = join(ROOT, 'plugins', pack, 'skills');
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = join(base, d.name);
      out.push({ pack, name: d.name, dir, file: join(dir, 'SKILL.md') });
    }
  }
  return out;
}

// Minimal YAML frontmatter reader: top-level scalars, quoted strings and
// folded/literal block scalars. Nested maps are kept as raw text.
export function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (/^[>|][-+]?$/.test(raw)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      fm[key] = (raw.startsWith('>') ? block.join(' ') : block.join('\n')).trim();
    } else if (raw === '') {
      const block = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) block.push(lines[++i]);
      fm[key] = block.join('\n');
    } else {
      fm[key] = raw.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    }
  }
  return fm;
}

function walk(dir, base = dir, acc = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p));
  }
  return acc;
}

export function listFiles(dir) {
  return walk(dir).sort();
}

// Same idea as the skills CLI computedHash: sha256 over sorted path + content.
export function hashDir(dir) {
  const h = createHash('sha256');
  for (const rel of listFiles(dir)) {
    const p = join(dir, rel);
    h.update(rel);
    h.update(lstatSync(p).isSymbolicLink() ? 'symlink' : readFileSync(p));
  }
  return h.digest('hex');
}

export function readLock() {
  if (!existsSync(LOCK_PATH)) return { version: 1, skills: {} };
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

export function writeLock(lock) {
  const sorted = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(LOCK_PATH, JSON.stringify({ ...lock, skills: sorted }, null, 2) + '\n');
}
