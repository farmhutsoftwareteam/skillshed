// Regression: use-pack.sh writes both tools' configs, and --exclude records the
// pack in .skillshed.json, which the skill router reads before borrowing a skill.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const script = new URL('../scripts/use-pack.sh', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'skillshed-test-'));
const env = { ...process.env, HOME: dir };
const run = (...args) => execFileSync('bash', [script, ...args], { cwd: dir, env, encoding: 'utf8' });
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);

let failed = 0;
const check = (label, cond, got) => {
  if (!cond) { console.error(`FAIL ${label}: ${got}`); failed = 1; }
};
const state = () => ({
  claude: JSON.parse(read('.claude/settings.json')).enabledPlugins,
  toml: read('.codex/config.toml'),
  excl: read('.skillshed.json'),
});
const expect = (label, on, excl) => {
  const s = state();
  check(`${label}: settings.json`, s.claude['expo@skillshed'] === on, JSON.stringify(s.claude));
  check(`${label}: config.toml`, s.toml === `[plugins."expo@skillshed"]\nenabled = ${on}\n`, JSON.stringify(s.toml));
  const want = excl === null ? null : JSON.stringify({ exclude: excl }, null, 2) + '\n';
  check(`${label}: .skillshed.json`, s.excl === want, JSON.stringify(s.excl));
};

run('expo');
expect('use', true, null);
const offOut = run('--off', 'expo');
expect('off', false, null);
check('off: mentions borrowing', /borrow/.test(offOut), offOut);
run('--exclude', 'expo');
expect('exclude', false, ['expo']);
run('--off', 'expo');
expect('off after exclude', false, ['expo']);
run('expo');
expect('use after exclude', true, null);

if (failed) process.exit(1);
console.log('use-pack ok');
