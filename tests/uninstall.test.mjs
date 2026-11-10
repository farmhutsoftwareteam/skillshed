// Regression: `skillshed uninstall` previews by default, removes only what
// Skillshed put there, and keeps personal skills unless asked. Runs against
// a fake home and fake claude/codex CLIs; never touches the real home.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, symlinkSync, lstatSync, readlinkSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (ok, msg) => {
  if (!ok) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
};

const fakeClaude = `#!/bin/sh
echo "claude $*" >> "$CLI_LOG"
case "$*" in
  "plugin list --json") echo '[{"id":"core@skillshed","scope":"user"},{"id":"matt@skillshed","scope":"user"},{"id":"core@skillshed","scope":"project","projectPath":"/work/proj"},{"id":"x@other","scope":"user"}]' ;;
  "plugin marketplace list --json") printf '[\\n  {\\n    "name": "skillshed"\\n  },\\n  {\\n    "name": "other"\\n  }\\n]\\n' ;;
esac
exit 0
`;
const fakeCodex = `#!/bin/sh
echo "codex $*" >> "$CLI_LOG"
case "$*" in
  "plugin list") printf 'core@skillshed   installed, enabled   local /x\\nexpo@skillshed   installed, disabled  local /x\\nsupabase@skillshed   not installed\\nx@other   installed, enabled\\n' ;;
  "plugin marketplace list") printf 'MARKETPLACE  ROOT\\nskillshed    /x\\nother        /y\\n' ;;
esac
exit 0
`;

function setup() {
  const t = mkdtempSync(join(tmpdir(), 'skillshed-uninstall-'));
  const home = join(t, 'home'), bin = join(t, 'bin'), xdg = join(home, '.config'), shed = join(home, '.skillshed');
  for (const f of ['bin/skillshed', 'scripts/uninstall.sh', 'scripts/bootstrap.sh']) cpSync(join(REPO, f), join(shed, f));
  for (const p of ['core', 'matt']) mkdirSync(join(shed, 'plugins', p), { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(t, 'proj'));
  writeFileSync(join(bin, 'claude'), fakeClaude.replace('/work/proj', join(t, 'proj')));
  writeFileSync(join(bin, 'codex'), fakeCodex);
  chmodSync(join(bin, 'claude'), 0o755);
  chmodSync(join(bin, 'codex'), 0o755);

  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ theme: 'dark', enabledPlugins: { 'core@skillshed': true, 'x@other': true }, extraKnownMarketplaces: { skillshed: { autoUpdate: true }, other: { autoUpdate: true } } }, null, 2) + '\n');
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/config.toml'), 'model = "o3"\n\n[marketplaces.skillshed]\nsource_type = "git"\n\n[plugins."core@skillshed"]\nenabled = true\n\n[plugins."x@other"]\nenabled = true\n');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  symlinkSync(join(shed, 'bin/skillshed'), join(home, '.local/bin/skillshed'));
  mkdirSync(join(home, 'bin'));
  symlinkSync('/elsewhere/bin/skillshed', join(home, 'bin/skillshed'));

  // A personal skill, plus things in the same folders that aren't Skillshed's.
  mkdirSync(join(home, '.agents/skills/mine'), { recursive: true });
  writeFileSync(join(home, '.agents/skills/mine/SKILL.md'), 'mine\n');
  symlinkSync(join(home, '.agents/skills/mine'), join(home, '.claude/skills/mine'));
  mkdirSync(join(home, '.agents/skills/notours'));
  mkdirSync(join(home, '.claude/skills/theirs'));
  writeFileSync(join(home, '.claude/skills/theirs/SKILL.md'), 'theirs\n');
  symlinkSync('/somewhere/else', join(home, '.claude/skills/linkother'));
  mkdirSync(join(xdg, 'skillshed'), { recursive: true });
  writeFileSync(join(xdg, 'skillshed/personal.lock.json'), JSON.stringify({ version: 1, skills: { mine: { kind: 'own' } } }));

  const log = join(t, 'cli.log');
  writeFileSync(log, '');
  const run = (...args) => {
    const r = spawnSync('bash', [join(shed, 'scripts/uninstall.sh'), ...args], {
      cwd: home,
      encoding: 'utf8',
      env: { HOME: home, XDG_CONFIG_HOME: xdg, SKILLSHED_HOME: shed, CLI_LOG: log, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':') },
    });
    return { ...r, out: r.stdout + r.stderr, log: readFileSync(log, 'utf8') };
  };
  return { t, home, shed, xdg, run };
}

// Every path under dir with its link target or file contents.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e), s = lstatSync(p);
      if (s.isSymbolicLink()) out[p] = `-> ${readlinkSync(p)}`;
      else if (s.isDirectory()) (out[p] = 'dir'), walk(p);
      else out[p] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return JSON.stringify(out);
}
const exists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const mutating = (log) => log.split('\n').filter((l) => / (uninstall|remove|rm) /.test(l + ' '));

// 1. Preview changes nothing.
{
  const { home, run } = setup();
  const before = snapshot(home);
  const r = run();
  check(r.status === 0, `preview exits 0 (got ${r.status}):\n${r.out}`);
  check(snapshot(home) === before, 'preview changed files');
  check(mutating(r.log).length === 0, `preview ran CLI changes:\n${mutating(r.log).join('\n')}`);
  check(r.out.includes('Nothing changed'), 'preview says nothing changed');
  check(r.out.includes('personal skills: mine'), 'preview lists kept personal skills');
}

// 2. --yes removes Skillshed and keeps personal skills.
{
  const { t, home, shed, xdg, run } = setup();
  const r = run('--yes');
  check(r.status === 0, `--yes exits 0 (got ${r.status}):\n${r.out}`);
  for (const c of [
    'claude plugin uninstall core@skillshed --scope user',
    'claude plugin uninstall matt@skillshed --scope user',
    'claude plugin marketplace remove skillshed --scope user',
    'codex plugin remove core@skillshed',
    'codex plugin remove expo@skillshed',
    'codex plugin marketplace remove skillshed',
  ])
    check(r.log.includes(c + '\n'), `--yes ran: ${c}`);
  check(!/other|supabase/.test(mutating(r.log).join('\n')), `--yes touched another plugin:\n${r.log}`);
  const s = JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'));
  check(!s.extraKnownMarketplaces.skillshed && s.extraKnownMarketplaces.other, 'settings.json: skillshed marketplace gone, other kept');
  check(!('core@skillshed' in s.enabledPlugins) && s.enabledPlugins['x@other'] && s.theme === 'dark', 'settings.json: only skillshed plugins removed');
  const toml = readFileSync(join(home, '.codex/config.toml'), 'utf8');
  check(!toml.includes('skillshed') && toml.includes('[plugins."x@other"]') && toml.includes('model = "o3"'), `config.toml: only skillshed tables removed:\n${toml}`);
  check(!exists(join(home, '.local/bin/skillshed')), 'CLI link into the checkout removed');
  check(exists(join(home, 'bin/skillshed')), 'CLI link elsewhere kept');
  check(!existsSync(shed), 'checkout removed');
  check(existsSync(join(home, '.agents/skills/mine/SKILL.md')) && exists(join(home, '.claude/skills/mine')), 'personal skill kept');
  check(existsSync(join(xdg, 'skillshed/personal.lock.json')), 'personal lock kept');
  check(r.out.includes("git grep -l '@skillshed' -- .claude .codex") && r.out.includes(join(t, 'proj')), 'lists project entries left behind');
}

// 3. --personal also removes personal skills, and nothing that isn't Skillshed's.
{
  const { home, xdg, run } = setup();
  const r = run('--yes', '--personal');
  check(r.status === 0, `--personal exits 0 (got ${r.status}):\n${r.out}`);
  check(!exists(join(home, '.agents/skills/mine')) && !exists(join(home, '.claude/skills/mine')), 'personal skill and link removed');
  check(!existsSync(join(xdg, 'skillshed/personal.lock.json')), 'personal lock removed');
  check(readFileSync(join(home, '.claude/skills/theirs/SKILL.md'), 'utf8') === 'theirs\n', 'non-Skillshed folder in ~/.claude/skills kept');
  check(exists(join(home, '.claude/skills/linkother')) && exists(join(home, '.agents/skills/notours')), 'unlisted skills kept');
}

if (failures) process.exit(1);
console.log('uninstall ok');
