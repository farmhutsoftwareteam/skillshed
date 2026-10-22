#!/usr/bin/env node
// Builds summary.md and summary.json from the result.json files in a results
// directory. run.mjs calls this at the end; you can rerun it by hand:
//
//   node benchmarks/summarize.mjs benchmarks/results/<run>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function summarize(dir) {
  const results = [];
  for (const task of fs.readdirSync(dir)) {
    const td = path.join(dir, task);
    if (!fs.statSync(td).isDirectory()) continue;
    for (const run of fs.readdirSync(td)) {
      const f = path.join(td, run, "result.json");
      if (fs.existsSync(f)) results.push(JSON.parse(fs.readFileSync(f, "utf8")));
    }
  }

  const byTask = groupBy(results, (r) => r.task);
  const json = {};
  const md = [];
  for (const [task, runs] of Object.entries(byTask).sort()) {
    const arms = groupBy(runs, (r) => r.arm);
    const order = ["off", "on"].filter((a) => arms[a]);
    const pack = runs[0].pack;
    json[task] = { pack, arms: {} };
    md.push(`### ${task} (pack: \`${pack}\`)`, "");
    md.push(`| | ${order.map((a) => `pack ${a}`).join(" | ")} |`, `| --- | ${order.map(() => "---").join(" | ")} |`);

    const stat = {};
    for (const a of order) {
      const rs = arms[a];
      const scores = rs.map((r) => (r.total ? r.passed / r.total : 0));
      stat[a] = {
        runs: rs.length,
        scores: rs.map((r) => `${r.passed}/${r.total}`),
        meanScore: mean(scores),
        packSkillUsedIn: rs.filter((r) => r.packSkillsUsed?.length).length,
        meanCostUsd: mean(rs.map((r) => r.costUsd).filter((x) => x != null)),
        meanSeconds: mean(rs.map((r) => r.seconds)),
        errors: rs.filter((r) => r.isError || r.graderError).length,
        checks: {},
      };
      for (const r of rs) for (const c of r.checks ?? []) {
        const k = (stat[a].checks[c.id] ??= { label: c.label, group: c.group, passed: 0, runs: 0 });
        k.runs++;
        if (c.pass) k.passed++;
      }
      json[task].arms[a] = stat[a];
    }
    const row = (label, f) => md.push(`| ${label} | ${order.map((a) => f(stat[a])).join(" | ")} |`);
    row("Mean score", (s) => `**${pct(s.meanScore)}**`);
    row("Per run", (s) => s.scores.join(", "));
    row(`Runs that used a \`${pack}\` skill`, (s) => `${s.packSkillUsedIn}/${s.runs}`);
    row("Mean cost", (s) => (Number.isNaN(s.meanCostUsd) ? "–" : `$${s.meanCostUsd.toFixed(2)}`));
    row("Mean time", (s) => `${Math.round(s.meanSeconds)}s`);
    if (order.some((a) => stat[a].errors)) row("Errored runs", (s) => String(s.errors));
    md.push("");

    const ids = [...new Set(order.flatMap((a) => Object.keys(stat[a].checks)))];
    md.push(`| Check | ${order.map((a) => `pack ${a}`).join(" | ")} |`, `| --- | ${order.map(() => "---").join(" | ")} |`);
    for (const id of ids) {
      const any = order.map((a) => stat[a].checks[id]).find(Boolean);
      md.push(`| ${any.label}${any.group === "correctness" ? "" : ` _(${any.group})_`} | ${order.map((a) => {
        const c = stat[a].checks[id];
        return c ? `${c.passed}/${c.runs}` : "–";
      }).join(" | ")} |`);
    }
    md.push("");
  }

  const text = md.join("\n");
  fs.writeFileSync(path.join(dir, "summary.md"), text + "\n");
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(json, null, 2) + "\n");
  return text;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x) => (Number.isNaN(x) ? "–" : `${Math.round(x * 100)}%`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("usage: summarize.mjs <results-dir>");
  console.log(summarize(path.resolve(process.argv[2])));
}

// Object.groupBy needs Node 21; the repo supports Node 20.
function groupBy(xs, key) {
  const o = {};
  for (const x of xs) (o[key(x)] ??= []).push(x);
  return o;
}
