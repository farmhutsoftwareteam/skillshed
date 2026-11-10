// Task-style skill search, shared by the landing page and `skillshed find`.
// Plain ES module, no dependencies: the page imports it from ./search.js and
// node imports it from site/public/search.js.
//
//   rank(query, docs) -> [{ doc, score }] best first, near misses dropped, where doc is
//   { name, text, pack? }: text is the description, pack the pack's name,
//   description and source, which count for less.

const STOP = new Set(
  'a an and any are as at be by can do does for from get how i if in into is it its me my need of on or our should so that the their them this to up use used user using want we what when which with you your'.split(' '),
);

// Light stemming: tests/testing -> test, failing/failed -> fail, policies -> policy.
// Both sides of a match go through it, so stems only need to agree, not be words.
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 2 && w.at(-1) === w.at(-2) && !'lsz'.includes(w.at(-1))) w = w.slice(0, -1);
  return w;
}

export const tokens = (s) =>
  String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);

// Abbreviations and other names for the same thing, as the skill descriptions
// in this catalogue use them. Each group matches if any of its phrases does.
const SYNONYMS = [
  ['rls', 'row level security'],
  ['e2e', 'end to end'],
  ['a11y', 'accessibility', 'wcag'],
  ['ci', 'cicd', 'continuous integration'],
  ['db', 'database', 'postgres', 'sql'],
  ['auth', 'authentication', 'login'],
  ['tdd', 'test driven', 'test first'],
  ['ota', 'over the air'],
  ['app store', 'testflight', 'google play', 'play store'],
  ['pr', 'pull request'],
  ['debug', 'diagnose'],
  ['bug', 'fail', 'broken'],
  ['cron', 'schedule'],
  ['rn', 'react native'],
  ['ui', 'interface'],
].map((g) => g.map(tokens));

// A query becomes concepts: each is a list of alternative token runs.
export function concepts(query) {
  const q = tokens(query);
  const out = [];
  for (let i = 0; i < q.length; ) {
    let best = null;
    for (const g of SYNONYMS)
      for (const p of g)
        if (p.length > (best?.len ?? 0) && p.every((t, j) => q[i + j] === t)) best = { len: p.length, alts: g };
    out.push(best ? best.alts : [[q[i]]]);
    i += best ? best.len : 1;
  }
  return out;
}

const has = (list, run) => list.some((_, i) => run.every((t, j) => list[i + j] === t));
const count = (list, run) => list.filter((_, i) => run.every((t, j) => list[i + j] === t)).length;

// Per concept: a name hit counts 3, a description hit 1 plus a little for
// repeats, a pack hit 0.5, weighted so rare words count more than common ones.
export function rank(query, docs) {
  const cs = concepts(query);
  if (!cs.length) return [];
  const idx = docs.map((doc) => ({ doc, name: tokens(doc.name), text: tokens(doc.text), pack: tokens(doc.pack ?? '') }));
  const hit = (d, c) => {
    const n = c.some((r) => has(d.name, r)) ? 3 : 0;
    const t = Math.max(...c.map((r) => count(d.text, r)));
    if (n || t) return n + (t ? 1 + 0.25 * Math.min(t - 1, 2) : 0);
    return c.some((r) => has(d.pack, r)) ? 0.5 : 0;
  };
  // Rarity ignores pack hits, so one pack's blurb can't make a word look common.
  const idf = cs.map((c) => Math.log(1 + idx.length / (1 + idx.filter((d) => hit(d, c) >= 1).length)));
  return idx
    .map((d) => {
      const hits = cs.map((c) => hit(d, c));
      const matched = hits.filter(Boolean).length;
      // Matching every concept beats matching one concept many times.
      const score = hits.reduce((s, h, i) => s + h * idf[i], 0) * (matched / cs.length);
      return { doc: d.doc, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name))
    // Drop the long tail of one stray word, far below the best match.
    .filter((r, _, all) => r.score >= all[0].score / 5);
}
