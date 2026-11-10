// Regression: skillshed update re-runs bootstrap.sh, which must apply the
// default on/off state only to newly installed packs, keep the user's own
// choices (and autoUpdate), and fail when a change silently doesn't stick.
// Runs against fake claude/codex CLIs in a temp HOME; never the real one.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const BOOTSTRAP = join(ROOT, 'scripts/bootstrap.sh');
const PACKS = readdirSync(join(ROOT, 'plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const ON = ['core', 'matt'];

// Fake claude: plugin state in $HOME/fake-claude.json, { "<id>": true|false }.
// Like the real CLI, install enables, and enable/disable exit 1 when the
// plugin is missing or already in that state. FAKE_NOOP=1 makes enable and
// disable exit 0 without changing anything.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'), f = process.env.HOME + '/fake-claude.json';
const a = process.argv.slice(2);
fs.appendFileSync(process.env.HOME + '/fake.log', 'claude ' + a.join(' ') + '\\n');
const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
const save = () => fs.writeFileSync(f, JSON.stringify(s));
const [, cmd, id] = a;
if (a[1] === 'marketplace') process.exit(0);
if (cmd === 'list') { console.log(JSON.stringify(Object.entries(s).map(([id, enabled]) => ({ id, scope: 'user', enabled })))); process.exit(0); }
if (cmd === 'install') { if (!(id in s)) s[id] = true; save(); process.exit(0); }
if (cmd === 'enable' || cmd === 'disable') {
  const v = cmd === 'enable';
  if (!(id in s) || s[id] === v) { console.error(id + ' is already ' + cmd + 'd'); process.exit(1); }
  if (!process.env.FAKE_NOOP) { s[id] = v; save(); }
  process.exit(0);
}
process.exit(2);
`;

// Fake codex: writes $HOME/.codex/config.toml the way plugin add does.
// FAKE_CODEX_NO_ENABLED=1 writes the table with no enabled line, so
// bootstrap's edit has nothing to change.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('fs'), dir = process.env.HOME + '/.codex', f = dir + '/config.toml';
const a = process.argv.slice(2);
fs.appendFileSync(process.env.HOME + '/fake.log', 'codex ' + a.join(' ') + '\\n');
fs.mkdirSync(dir, { recursive: true });
let t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
const [, cmd, id] = a;
if (a[1] === 'marketplace') process.exit(0);
if (cmd === 'add') {
  if (!t.includes('[plugins."' + id + '"]')) {
    t += '\\n[plugins."' + id + '"]\\n' + (process.env.FAKE_CODEX_NO_ENABLED ? 'source = "x"\\n' : 'enabled = true\\n');
    fs.writeFileSync(f, t);
  }
  process.exit(0);
}
if (cmd === 'list') {
  const on = {};
  let cur;
  for (const l of t.split('\\n')) {
    const h = l.match(/^\\[plugins\\."([^"]+)"\\]$/);
    if (h) { cur = h[1]; on[cur] = true; } else if (l.startsWith('[')) cur = null;
    else if (cur && l === 'enabled = false') on[cur] = false;
  }
  for (const [id, v] of Object.entries(on)) console.log(id.padEnd(30), v ? 'installed, enabled' : 'installed, disabled');
  process.exit(0);
}
process.exit(2);
`;

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'skillshed-bootstrap-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  mkdirSync(join(home, '.claude')); // the real claude has made it by now
  for (const [name, src] of [['claude', FAKE_CLAUDE], ['codex', FAKE_CODEX]]) {
    writeFileSync(join(bin, name), src);
    chmodSync(join(bin, name), 0o755);
  }
  return { home, bin };
}

// The default GitHub source, so the autoUpdate path runs; the fakes make no
// network calls. /opt/homebrew/bin goes last so bootstrap doesn't prepend it
// and pick up a real claude or codex ahead of the fakes.
function bootstrap({ home, bin }, env = {}) {
  const PATH = [bin, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin'].join(':');
  const r = spawnSync('bash', [BOOTSTRAP], {
    encoding: 'utf8',
    env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH, ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const claudeState = (home) => JSON.parse(readFileSync(join(home, 'fake-claude.json'), 'utf8'));
const tomlPath = (home) => join(home, '.codex/config.toml');
const codexState = (home) => {
  const t = readFileSync(tomlPath(home), 'utf8'), s = {};
  for (const m of t.matchAll(/^\[plugins\."([^@"]+)@skillshed"\]\nenabled = (\w+)/gm)) s[m[1]] = m[2] === 'true';
  return s;
};
const settingsPath = (home) => join(home, '.claude/settings.json');
const autoUpdate = (home) => JSON.parse(readFileSync(settingsPath(home), 'utf8')).extraKnownMarketplaces.skillshed.autoUpdate;

let failures = 0;
function expect(cond, msg, out) {
  if (cond) return;
  failures++;
  console.error(`FAIL: ${msg}${out ? `\n--- bootstrap output ---\n${out}\n---` : ''}`);
}

// 1. First run applies the defaults.
const a = sandbox();
let r = bootstrap(a);
expect(r.status === 0, `first run exits 0 (got ${r.status})`, r.out);
const log = readFileSync(join(a.home, 'fake.log'), 'utf8');
expect(log.includes('claude plugin list') && log.includes('codex plugin list'), 'bootstrap used the fake claude and codex', r.out);
for (const p of PACKS) {
  const want = ON.includes(p);
  expect(claudeState(a.home)[`${p}@skillshed`] === want, `claude: new ${p} is ${want ? 'on' : 'off'}`, r.out);
  expect(codexState(a.home)[p] === want, `codex: new ${p} is ${want ? 'on' : 'off'}`, r.out);
}
expect(autoUpdate(a.home) === true, 'autoUpdate set on first run', r.out);

// 2. The user's choices survive an update.
const c = claudeState(a.home);
c['supabase@skillshed'] = true;
c['matt@skillshed'] = false;
writeFileSync(join(a.home, 'fake-claude.json'), JSON.stringify(c));
writeFileSync(
  tomlPath(a.home),
  readFileSync(tomlPath(a.home), 'utf8')
    .replace(/(\[plugins\."supabase@skillshed"\]\n)enabled = false/, '$1enabled = true')
    .replace(/(\[plugins\."matt@skillshed"\]\n)enabled = true/, '$1enabled = false'),
);
const s = JSON.parse(readFileSync(settingsPath(a.home), 'utf8'));
s.extraKnownMarketplaces.skillshed.autoUpdate = false;
writeFileSync(settingsPath(a.home), JSON.stringify(s));
writeFileSync(join(a.home, 'fake.log'), '');
r = bootstrap(a);
expect(r.status === 0, `second run exits 0; a changed default is a warning (got ${r.status})`, r.out);
for (const p of PACKS) {
  const want = p === 'supabase' ? true : p === 'matt' ? false : ON.includes(p);
  expect(claudeState(a.home)[`${p}@skillshed`] === want, `claude: ${p} kept ${want ? 'on' : 'off'}`, r.out);
  expect(codexState(a.home)[p] === want, `codex: ${p} kept ${want ? 'on' : 'off'}`, r.out);
}
expect(autoUpdate(a.home) === false, 'autoUpdate false kept', r.out);
expect(!/plugin (enable|disable)/.test(readFileSync(join(a.home, 'fake.log'), 'utf8')), 'second run enables/disables nothing', r.out);
expect(/kept supabase enabled/.test(r.out) && /kept matt disabled/.test(r.out), 'second run says which choices it kept', r.out);
expect(/warn +matt disabled everywhere/.test(r.out) && !/FAIL +matt/.test(r.out), 'doctor warns, not fails, on matt off', r.out);

// 3. A change that silently doesn't take effect fails the run.
const b = sandbox();
r = bootstrap(b, { FAKE_NOOP: '1' });
expect(r.status !== 0, 'claude enable/disable that does nothing fails bootstrap', r.out);
expect(/supabase@skillshed enabled, expected disabled/.test(r.out), 'claude mismatch is reported', r.out);

const d = sandbox();
r = bootstrap(d, { FAKE_CODEX_NO_ENABLED: '1' });
expect(r.status !== 0, 'codex edit that changes nothing fails bootstrap', r.out);
expect(/codex: supabase@skillshed unset, expected disabled/.test(r.out), 'codex mismatch is reported', r.out);

if (failures) process.exit(1);
console.log('bootstrap preserves settings ok');
