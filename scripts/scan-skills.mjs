#!/usr/bin/env node
// Static prompt-injection and supply-chain scan for skills. It is a tripwire,
// not a proof of safety: anything it flags needs a human (or the vet-skill
// skill) to read the exact lines before the change is merged.
//
//   node scripts/scan-skills.mjs                  # all vendored skills
//   node scripts/scan-skills.mjs --all            # every skill, owned too
//   node scripts/scan-skills.mjs <dir> [<dir>...] # specific skill folders
//   --report <file>   also write a markdown report
//   --no-fail         exit 0 even with high findings
import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT, skills, readLock, listFiles } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const report = opt('--report');
const dirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--report');

const lock = readLock();
const targets = dirs.length
  ? dirs.map((d) => resolve(d))
  : skills().filter((s) => flag('--all') || lock.skills[s.name]).map((s) => s.dir);

// [severity, id, regex, why]
const RULES = [
  ['high', 'hidden-unicode', /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u, 'invisible or bidi characters can hide instructions'],
  ['high', 'override', /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|system|all)\b.{0,20}\b(instructions?|prompts?|rules|guidelines)\b/i, 'tries to override earlier instructions'],
  ['high', 'conceal', /\b(do not|don't|never)\b.{0,20}\b(tell|inform|mention|reveal|show|notify)\b.{0,20}\b(the )?user\b/i, 'asks the agent to hide things from the user'],
  ['high', 'pipe-to-shell', /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/i, 'downloads and runs code'],
  ['high', 'exfil-endpoint', /(webhook\.site|requestbin|pipedream\.net|ngrok\.(io|app)|hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|pastebin\.com|transfer\.sh|interact\.sh|burpcollaborator)/i, 'known data-collection endpoint'],
  ['high', 'base64-blob', /[A-Za-z0-9+/]{200,}={0,2}/, 'long encoded blob can hide content'],
  ['medium', 'skip-confirm', /\b(without|no need to|don't|do not)\b.{0,15}\b(ask|asking|confirm|confirmation|permission|approval)\b/i, 'tells the agent to skip confirmation'],
  ['medium', 'role-hijack', /\b(you are now|new instructions|system prompt|developer mode|jailbreak)\b/i, 'role or prompt manipulation language'],
  ['medium', 'secrets', /(~\/\.ssh|id_rsa|id_ed25519|\.aws\/credentials|\.netrc|security find-(generic|internet)-password|keychain|\b[A-Z_]*(API_KEY|SECRET|TOKEN)\b)/, 'touches credentials or secrets'],
  ['medium', 'network-send', /\b(curl|wget|fetch\(|axios\.|requests\.(post|put)|nc\s+-|scp\s|rsync\s)[^\n]*(https?:\/\/|@)/i, 'sends or fetches over the network'],
  ['medium', 'decode-exec', /(base64\s+(-d|--decode)|atob\(|\beval\s*\(|\bexec\s*\(|child_process|subprocess\.(run|Popen|call)|\bos\.system\s*\()/, 'decodes or executes dynamic code'],
  ['medium', 'html-comment', /<!--(?!\s*index:(start|end)\s*-->)/, 'HTML comments are invisible when rendered'],
  ['medium', 'broad-tools', /^allowed-tools:.*(Bash\(\*\)|Bash(\s|$)|\*)/m, 'asks for broad tool access'],
];

const findings = [];
const add = (severity, rule, file, line, text, why) => findings.push({ severity, rule, file, line, text, why });
const show = (s) => s.replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu, (c) => `\\u{${c.codePointAt(0).toString(16)}}`).trim().slice(0, 160);

for (const dir of targets) {
  for (const rel of listFiles(dir)) {
    const p = join(dir, rel);
    const where = relative(ROOT, p);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) { add('high', 'symlink', where, 0, '', 'symlinks can point outside the skill'); continue; }
    if (/(^|\/)(hooks|\.mcp\.json|\.claude-plugin|\.codex-plugin)/.test(rel)) add('high', 'plugin-surface', where, 0, '', 'hooks, MCP servers or manifests inside a skill');
    if (st.mode & 0o111) add('medium', 'executable', where, 0, '', 'executable file: read it fully');
    const buf = readFileSync(p);
    if (buf.includes(0)) { add('medium', 'binary', where, 0, '', 'binary file cannot be reviewed as text'); continue; }
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((text, i) => {
      for (const [severity, id, re, why] of RULES) if (re.test(text)) add(severity, id, where, i + 1, show(text), why);
    });
  }
}

const cell = (t) => t.replace(/[|`\r\n]/g, "'");
const high = findings.filter((f) => f.severity === 'high').length;
const md = [
  `### Skill scan: ${high} high, ${findings.length - high} medium (${targets.length} skills)`,
  '',
  findings.length ? '| Sev | Rule | Location | Line | Why |\n| --- | --- | --- | --- | --- |' : 'No findings.',
  // Paths and excerpts come from untrusted repos: keep them inside their code spans.
  ...findings.map((f) => `| ${f.severity} | ${f.rule} | \`${cell(f.file)}${f.line ? `:${f.line}` : ''}\` | \`${cell(f.text)}\` | ${f.why} |`),
].join('\n');

for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.rule.padEnd(15)} ${f.file}${f.line ? `:${f.line}` : ''}  ${f.text}`);
console.log(`${high} high, ${findings.length - high} medium across ${targets.length} skills`);
if (report) writeFileSync(report, md + '\n');
process.exit(high && !flag('--no-fail') ? 1 : 0);
