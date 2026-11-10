// Regression: task-style queries find the right skills on the site, and
// `skillshed find` reports a broken skills.sh instead of "(no matches)".
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { ROOT, skills, frontmatter, readLock } from '../scripts/lib.mjs';
import { rank } from '../site/public/search.js';

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    console.error(`FAIL: ${msg}`);
    failed = 1;
  }
};

// The same fields the site's bands carry.
const marketplace = JSON.parse(readFileSync(`${ROOT}/.claude-plugin/marketplace.json`, 'utf8'));
const lock = readLock();
const docs = skills().map((s) => ({
  name: s.name,
  text: frontmatter(readFileSync(s.file, 'utf8'))?.description ?? '',
  pack: `${s.pack} ${marketplace.plugins.find((p) => p.name === s.pack)?.description ?? ''} ${lock.skills[s.name]?.source ?? 'Skillshed'}`,
}));
const top = (q, n) => rank(q, docs).slice(0, n).map((r) => r.doc.name);

for (const q of ['row level security', 'rls']) check(top(q, 1)[0]?.startsWith('supabase'), `"${q}" ranks ${top(q, 3)} first, not a supabase skill`);
check(top('failing test', 3).some((n) => n === 'tdd' || n === 'diagnosing-bugs'), `"failing test" top 3 is ${top('failing test', 3)}`);
check(top('app store', 3).includes('eas-app-stores'), `"app store" top 3 is ${top('app store', 3)}`);
check(top('a11y', 1)[0] === 'better-accessibility', `"a11y" ranks ${top('a11y', 1)} first`);
check(top('the of and', 5).length === 0, 'a query of only stopwords matches nothing');

// find-skill.mjs against a local stand-in for skills.sh.
const replies = {
  empty: (res) => res.end('{"skills":[]}'),
  ok: (res) => res.end('{"skills":[{"name":"demo","source":"acme/skills","skillId":"demo","installs":3}]}'),
  error: (res) => { res.statusCode = 500; res.end('oops'); },
  garbage: (res) => res.end('<html>not json</html>'),
  shape: (res) => res.end('{"results":[]}'),
  hang: () => {},
};
const server = createServer((req, res) => replies[new URL(req.url, 'http://x').searchParams.get('q').split(' ')[0]](res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const find = (word) =>
  new Promise((resolve) =>
    execFile(process.execPath, [`${ROOT}/scripts/find-skill.mjs`, word, 'test'], { env: { ...process.env, SKILLSHED_SKILLS_SH: base, SKILLSHED_FIND_TIMEOUT_MS: '300' } }, (err, stdout) =>
      resolve({ code: err ? err.code : 0, out: stdout }),
    ),
  );
const cases = [
  ['empty', 0, '(no matches)'],
  ['ok', 0, 'source: acme/skills@demo'],
  ['error', 1, '(search failed: HTTP 500'],
  ['garbage', 1, '(search failed: response was not JSON)'],
  ['shape', 1, '(search failed: response had no skills list)'],
  ['hang', 1, '(search failed: timed out after 0.3s)'],
];
for (const [word, code, line] of cases) {
  const { code: got, out } = await find(word);
  const live = out.slice(out.indexOf('## skills.sh'));
  check(got === code, `find on ${word} reply exited ${got}, want ${code}`);
  check(live.includes(line), `find on ${word} reply printed:\n${live}`);
  check(out.includes('## skill-issue.in'), `find on ${word} reply skipped the snapshot results`);
  if (code) check(!live.includes('(no matches)'), `find on ${word} reply claimed no matches`);
}
server.closeAllConnections();
server.close();

if (failed) process.exit(1);
console.log('search ok');
