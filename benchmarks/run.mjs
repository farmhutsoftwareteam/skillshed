#!/usr/bin/env node
// Runs each benchmark task with its Skillshed pack off and on, in a fresh copy
// of the task's fixture, using headless Claude Code. Saves the transcript,
// the diff and the rubric score for every run. See README.md.
//
//   node benchmarks/run.mjs                        # every task, 3 runs per arm
//   node benchmarks/run.mjs --tasks supabase-rls --reps 1
//   node benchmarks/run.mjs --agent reference      # dry run: grade the reference solutions
//
// Options:
//   --tasks a,b       tasks to run (default: all in benchmarks/tasks)
//   --reps N          runs per arm (default 3)
//   --arms off,on     which arms (default both)
//   --model NAME      passed to claude --model (default: Claude Code's default)
//   --parallel N      runs at once (default 3)
//   --out DIR         results directory (default benchmarks/results/<timestamp>)
//   --agent claude|reference
//   --claude PATH     claude binary (default $CLAUDE_BIN or `claude`)
//   --max-usd N       per-run spend cap passed to claude --max-budget-usd (default 3)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { summarize } from "./summarize.mjs";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(BENCH);
const USE_PACK = path.join(REPO, "scripts", "use-pack.sh");
// Packs Skillshed turns on everywhere by default. Both arms keep them, except
// when the pack under test is one of them.
const ALWAYS_ON = ["core", "matt"];

const args = parseArgs(process.argv.slice(2));
const allTasks = fs.readdirSync(path.join(BENCH, "tasks")).filter((t) => fs.existsSync(path.join(BENCH, "tasks", t, "task.json")));
const tasks = args.tasks ? args.tasks.split(",") : allTasks;
const reps = Number(args.reps ?? 3);
const arms = (args.arms ?? "off,on").split(",");
const agent = args.agent ?? "claude";
const claude = args.claude ?? process.env.CLAUDE_BIN ?? "claude";
const parallel = Number(args.parallel ?? 3);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(args.out ?? path.join(BENCH, "results", `${stamp}${agent === "reference" ? "-reference" : ""}`));

for (const t of tasks) if (!allTasks.includes(t)) die(`unknown task: ${t} (have: ${allTasks.join(", ")})`);
if (agent === "claude") {
  const v = spawnSync(claude, ["--version"], { encoding: "utf8" });
  if (v.status !== 0) die(`can't run ${claude}; pass --claude or set CLAUDE_BIN`);
}
if (!fs.existsSync(path.join(BENCH, "node_modules", "@electric-sql", "pglite"))) {
  die("benchmark dependencies missing: run `npm install --prefix benchmarks` first");
}

const jobs = [];
for (const task of tasks) for (const arm of arms) for (let rep = 1; rep <= reps; rep++) jobs.push({ task, arm, rep });

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "run.json"), JSON.stringify({ started: new Date().toISOString(), agent, model: args.model ?? null, tasks, arms, reps, claudeVersion: agent === "claude" ? spawnSync(claude, ["--version"], { encoding: "utf8" }).stdout.trim() : null, repoCommit: git(REPO, "rev-parse", "HEAD") }, null, 2) + "\n");
console.log(`${jobs.length} runs -> ${path.relative(process.cwd(), out)}`);

let next = 0;
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
  while (next < jobs.length) await runJob(jobs[next++]);
}));

const summary = summarize(out);
console.log("\n" + summary);

async function runJob({ task, arm, rep }) {
  const taskDir = path.join(BENCH, "tasks", task);
  const meta = JSON.parse(fs.readFileSync(path.join(taskDir, "task.json"), "utf8"));
  const runDir = path.join(out, task, `${arm}-${rep}`);
  fs.mkdirSync(runDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `skillshed-bench-${task}-${arm}-${rep}-`));
  const started = Date.now();

  // Fresh copy of the fixture, with packs set the way `skillshed use` would.
  fs.cpSync(path.join(taskDir, "fixture"), work, { recursive: true });
  const on = [...new Set([...ALWAYS_ON, ...(arm === "on" ? [meta.pack] : [])])];
  const off = arm === "off" ? [meta.pack] : [];
  execFileSync("bash", [USE_PACK, ...on], { cwd: work, stdio: "ignore" });
  if (off.length) execFileSync("bash", [USE_PACK, "--off", ...off], { cwd: work, stdio: "ignore" });
  git(work, "init", "-q");
  git(work, "add", "-A");
  git(work, "-c", "user.name=bench", "-c", "user.email=bench@localhost", "commit", "-qm", "fixture");

  const transcript = path.join(runDir, "transcript.jsonl");
  let exit = 0;
  if (agent === "reference") {
    fs.cpSync(path.join(taskDir, "reference"), work, { recursive: true });
    fs.writeFileSync(transcript, "");
  } else {
    exit = await runClaude(work, fs.readFileSync(path.join(taskDir, "prompt.md"), "utf8"), transcript);
  }

  git(work, "add", "-A");
  fs.writeFileSync(path.join(runDir, "diff.patch"), git(work, "diff", "--cached", "HEAD", "--", ".", ":(exclude).claude", ":(exclude).codex"));
  const grade = spawnSync(process.execPath, [path.join(taskDir, "grade.mjs"), work, transcript], { cwd: BENCH, encoding: "utf8", timeout: 300_000 });
  let score;
  try {
    score = JSON.parse(grade.stdout);
  } catch {
    score = { task, checks: [], passed: 0, total: 0, graderError: (grade.stderr || grade.stdout).slice(-2000) };
  }
  const stats = transcriptStats(transcript, meta.pack);
  const result = { task, arm, rep, pack: meta.pack, packsOn: on, packsOff: off, exit, seconds: Math.round((Date.now() - started) / 1000), ...stats, ...score };
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`${task} ${arm}#${rep}: ${score.passed}/${score.total}${stats.packSkillsUsed?.length ? ` (used ${stats.packSkillsUsed.join(", ")})` : ""}${exit ? ` exit ${exit}` : ""}`);
}

function runClaude(cwd, prompt, transcript) {
  // Strip the variables that tell a nested claude it is running inside another
  // session, so each run behaves like a fresh terminal invocation.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SIMPLE|SESSION_ID|CHILD_SESSION|HOST_SESSION_ID|MESSAGING_.*|SDK_.*|SESSION_ATTENDED|EMIT_.*)|CLAUDE_AGENT_SDK_.*|CLAUDE_PID)$/.test(k)));
  const cmd = [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    // Only the fixture's .claude/settings.json decides which plugins load, so
    // the runner's own user settings can't leak into either arm.
    "--setting-sources", "project",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
    "--max-budget-usd", String(args["max-usd"] ?? 3),
    ...(args.model ? ["--model", args.model] : []),
  ];
  return new Promise((resolve) => {
    const fd = fs.openSync(transcript, "w");
    const child = spawn(claude, cmd, { cwd, env, stdio: ["ignore", fd, fd] });
    const timer = setTimeout(() => child.kill("SIGTERM"), 20 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      resolve(code ?? 1);
    });
  });
}

// Which skills were loaded and invoked, plus cost and turns, from stream-json.
function transcriptStats(file, pack) {
  const s = { model: null, skillsLoaded: [], skillsUsed: [], packSkillsUsed: [], costUsd: null, turns: null, isError: null };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "system" && m.subtype === "init") {
      s.model = m.model;
      s.skillsLoaded = (m.skills ?? []).filter((x) => x.includes(":"));
    } else if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type === "tool_use" && c.name === "Skill" && c.input?.skill) s.skillsUsed.push(c.input.skill);
        // Skills can also be read straight from disk instead of via the Skill tool.
        const read = c.type === "tool_use" && c.name === "Read" && /\/skillshed\/([^/]+)\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/.exec(c.input?.file_path ?? "");
        if (read) s.skillsUsed.push(`${read[1]}:${read[2]}`);
      }
    } else if (m.type === "result") {
      s.costUsd = m.total_cost_usd;
      s.turns = m.num_turns;
      s.isError = m.is_error;
      if (m.is_error) s.errorText = String(m.result ?? "").slice(0, 300);
    }
  }
  s.packSkillsUsed = s.skillsUsed.filter((x) => x.startsWith(`${pack}:`));
  return s;
}

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) die(`unexpected argument: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? "true" : argv[++i];
  }
  return o;
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}
