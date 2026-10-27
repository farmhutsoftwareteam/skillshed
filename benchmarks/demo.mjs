#!/usr/bin/env node
// Runs one open-ended demo prompt twice in an empty project, using headless
// Claude Code: once as plain Claude Code (no plugins at all) and once with
// Skillshed's defaults plus the demo's packs. There is no rubric; the output
// is kept so people can look at it. Records model, tokens, cost and time.
//
//   node benchmarks/demo.mjs ps5-teardown --model claude-opus-5-5
//
// Options:
//   --arms plain,skillshed   which arms (default both)
//   --model NAME             passed to claude --model
//   --max-usd N              per-run spend cap (default 25)
//   --minutes N              per-run wall-clock cap (default 90)
//   --node DIR               bin directory put first on PATH, e.g. a Node 22 install
//   --out DIR                results directory (default benchmarks/results/demo-<name>-<timestamp>)
//   --claude PATH            claude binary (default $CLAUDE_BIN or `claude`)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(BENCH);
const USE_PACK = path.join(REPO, "scripts", "use-pack.sh");
const ALWAYS_ON = ["core", "matt"];
const EMAILS = [process.env.CLAUDE_CODE_USER_EMAIL, spawnSync("git", ["config", "user.email"], { encoding: "utf8" }).stdout.trim()].filter(Boolean);

const [name, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const demoDir = path.join(BENCH, "demos", name ?? "");
if (!name || !fs.existsSync(path.join(demoDir, "demo.json"))) die(`usage: demo.mjs <name> [options] (have: ${fs.readdirSync(path.join(BENCH, "demos")).join(", ")})`);
const meta = JSON.parse(fs.readFileSync(path.join(demoDir, "demo.json"), "utf8"));
const prompt = fs.readFileSync(path.join(demoDir, "prompt.md"), "utf8");
const arms = (args.arms ?? "plain,skillshed").split(",");
const claude = args.claude ?? process.env.CLAUDE_BIN ?? "claude";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(args.out ?? path.join(BENCH, "results", `demo-${name}-${stamp}`));
const env = runEnv();

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "run.json"), JSON.stringify({
  demo: name, started: new Date().toISOString(), model: args.model ?? null, arms, packs: meta.packs,
  maxUsd: Number(args["max-usd"] ?? 25), minutes: Number(args.minutes ?? 90),
  claudeVersion: spawnSync(claude, ["--version"], { encoding: "utf8", env }).stdout.trim(),
  node: spawnSync("node", ["-v"], { encoding: "utf8", env }).stdout.trim(),
  repoCommit: git(REPO, "rev-parse", "HEAD"),
}, null, 2) + "\n");
console.log(`${arms.length} runs -> ${path.relative(process.cwd(), out)}`);

const results = await Promise.all(arms.map(runArm));
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(results, null, 2) + "\n");
for (const r of results) console.log(`${r.arm}: ${r.wallSeconds}s, $${r.costUsd?.toFixed(2)}, ${r.turns} turns, out ${r.tokens.output}, skills used: ${r.skillsUsed.join(", ") || "none"}${r.exit ? `, exit ${r.exit}` : ""}`);

async function runArm(arm) {
  const runDir = path.join(out, arm);
  fs.mkdirSync(runDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `skillshed-demo-${name}-${arm}-`));
  // plain: no .claude/settings.json, so with --setting-sources project no plugin loads.
  if (arm === "skillshed") execFileSync("bash", [USE_PACK, ...new Set([...ALWAYS_ON, ...meta.packs])], { cwd: work, stdio: "ignore" });
  else if (arm !== "plain") die(`unknown arm: ${arm}`);
  git(work, "init", "-q");
  git(work, "add", "-A");
  git(work, "-c", "user.name=demo", "-c", "user.email=demo@localhost", "commit", "-q", "--allow-empty", "-m", "start");

  const transcript = path.join(runDir, "transcript.jsonl");
  const started = Date.now();
  const exit = await runClaude(work, transcript);
  const wallSeconds = Math.round((Date.now() - started) / 1000);

  // Keep what the agent made, minus installed packages and the run's settings.
  fs.cpSync(work, path.join(runDir, "project"), {
    recursive: true,
    filter: (src) => !/[/\\](node_modules|\.git|\.claude|\.codex)([/\\]|$)/.test(path.relative(work, src) ? "/" + path.relative(work, src) : ""),
  });
  redact(transcript);
  const result = { arm, exit, wallSeconds, ...transcriptStats(transcript), delivered: fs.existsSync(path.join(work, "dist", "index.html")) };
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  fs.rmSync(work, { recursive: true, force: true });
  return result;
}

function runClaude(cwd, transcript) {
  const cmd = [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--setting-sources", "project",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
    "--max-budget-usd", String(args["max-usd"] ?? 25),
    ...(args.model ? ["--model", args.model] : []),
  ];
  return new Promise((resolve) => {
    const fd = fs.openSync(transcript, "w");
    const child = spawn(claude, cmd, { cwd, env, stdio: ["ignore", fd, fd] });
    const timer = setTimeout(() => child.kill("SIGTERM"), Number(args.minutes ?? 90) * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      resolve(code ?? 1);
    });
  });
}

// Same as run.mjs: a nested claude must behave like a fresh terminal invocation.
function runEnv() {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SIMPLE|SESSION_ID|CHILD_SESSION|HOST_SESSION_ID|MESSAGING_.*|SDK_.*|SESSION_ATTENDED|EMIT_.*)|CLAUDE_AGENT_SDK_.*|CLAUDE_PID)$/.test(k)));
  if (args.node) e.PATH = `${path.resolve(args.node)}${path.delimiter}${e.PATH}`;
  return e;
}

// Model, tokens per model, cost, time, turns, tools and skills, from stream-json.
function transcriptStats(file) {
  const s = { model: null, skillsLoaded: [], skillsUsed: [], tools: {}, costUsd: null, turns: null, durationMs: null, apiMs: null, isError: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "system" && m.subtype === "init") {
      s.model = m.model;
      s.skillsLoaded = (m.skills ?? []).filter((x) => x.includes(":"));
    } else if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        s.tools[c.name] = (s.tools[c.name] ?? 0) + 1;
        if (c.name === "Skill" && c.input?.skill) s.skillsUsed.push(c.input.skill);
        const read = c.name === "Read" && /\/skillshed\/([^/]+)\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/.exec(c.input?.file_path ?? "");
        if (read) s.skillsUsed.push(`${read[1]}:${read[2]}`);
      }
    } else if (m.type === "result") {
      s.costUsd = m.total_cost_usd;
      s.turns = m.num_turns;
      s.durationMs = m.duration_ms;
      s.apiMs = m.duration_api_ms;
      s.isError = m.is_error;
      if (m.is_error) s.errorText = String(m.result ?? "").slice(0, 300);
      for (const [model, u] of Object.entries(m.modelUsage ?? {})) {
        s.byModel[model] = { input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadInputTokens, cacheWrite: u.cacheCreationInputTokens, thinking: u.thinkingTokens ?? null, costUsd: u.costUSD };
        s.tokens.input += u.inputTokens ?? 0;
        s.tokens.output += u.outputTokens ?? 0;
        s.tokens.cacheRead += u.cacheReadInputTokens ?? 0;
        s.tokens.cacheWrite += u.cacheCreationInputTokens ?? 0;
      }
    }
  }
  s.skillsUsed = [...new Set(s.skillsUsed)];
  return s;
}

// Also drops the base64 of images the agent looked at: a demo's agent reads its
// own renders back, which made one transcript 9 MB. The text stays.
function redact(file) {
  let t = fs.readFileSync(file, "utf8");
  for (const e of EMAILS) t = t.split(e).join("you@example.com");
  t = t.split(os.homedir()).join("~");
  t = t.split("\n").map((line) => {
    if (!line.startsWith("{")) return line;
    try {
      return JSON.stringify(JSON.parse(line), (k, v) => {
        if (v?.type === "image" && v.source?.data) return { ...v, source: { ...v.source, data: "[image omitted]" } };
        if (k === "base64" && typeof v === "string") return "[image omitted]";
        return v;
      });
    } catch {
      return line;
    }
  }).join("\n");
  fs.writeFileSync(file, t);
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
