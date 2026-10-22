// Grades the renewal-dates task: held-out tests, the original tests, whether
// the agent left a regression test that would have caught the bug, and (from
// the transcript) whether it wrote that test before touching the code.
//
//   node grade.mjs <workdir> [transcript.jsonl]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { report, check } from "../../lib/report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixture");
const [work, transcript] = process.argv.slice(2);
if (!work) throw new Error("usage: grade.mjs <workdir> [transcript.jsonl]");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "renewal-grade-"));
function copyOf(name, srcDir = path.join(work, "src")) {
  const dir = path.join(scratch, name);
  fs.cpSync(work, dir, { recursive: true, filter: (p) => !/\/(node_modules|\.git)(\/|$)/.test(p) });
  if (srcDir !== path.join(work, "src")) {
    fs.rmSync(path.join(dir, "src"), { recursive: true, force: true });
    fs.cpSync(srcDir, path.join(dir, "src"), { recursive: true });
  }
  return dir;
}

// Runs node's test runner and returns { ok, tests: { name: pass } } from TAP.
function runTests(cwd, files, tz = "UTC") {
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
    cwd,
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
    timeout: 60_000,
  });
  const tests = {};
  for (const line of r.stdout.split("\n")) {
    const m = /^ {0,4}(not )?ok \d+ - (.*?)(?: #.*)?$/.exec(line);
    if (m && !m[2].endsWith(".js")) tests[m[2]] = !m[1];
  }
  return { ok: r.status === 0, tests, out: (r.stdout + r.stderr).slice(-600) };
}

const testFiles = (dir) =>
  fs.readdirSync(dir, { recursive: true })
    .filter((f) => /\.test\.(m?js|cjs)$|(^|\/)test\/.*\.(m?js|cjs)$/.test(f) && !f.includes("node_modules"));

const checks = [];

// The fixture's own tests, unmodified, against the agent's code.
check(checks, "original-tests", "correctness", "The original tests still pass, unmodified", () => {
  const dir = copyOf("orig");
  fs.rmSync(path.join(dir, "test"), { recursive: true, force: true });
  fs.cpSync(path.join(fixture, "test"), path.join(dir, "test"), { recursive: true });
  // Pass files, not the directory: Node 24 treats a directory argument as a file.
  const r = runTests(dir, testFiles(fixture));
  return [r.ok, r.ok ? "" : r.out];
});

const hiddenDir = copyOf("hidden");
fs.mkdirSync(path.join(hiddenDir, "test"), { recursive: true });
fs.cpSync(path.join(here, "hidden", "renewals.hidden.test.js"), path.join(hiddenDir, "test", "zz.hidden.test.js"));
const hidden = { UTC: runTests(hiddenDir, ["test/zz.hidden.test.js"]) };
const result = (prefix) => {
  const name = Object.keys(hidden.UTC.tests).find((n) => n.startsWith(prefix));
  return [Boolean(name && hidden.UTC.tests[name]), name ? "" : hidden.UTC.out];
};

check(checks, "clamp", "correctness", "Held-out: renewals in short months fall on the month's last day", () => result("clamp:"));
check(checks, "anchor-monthly", "correctness", "Held-out: monthly renewals return to the 31st after a short month (no drift)", () => result("anchor-monthly:"));
check(checks, "anchor-annual", "correctness", "Held-out: a 29 Feb annual start renews on 29 Feb in leap years", () => result("anchor-annual:"));
check(checks, "ordinary-dates", "correctness", "Held-out: ordinary dates and invoice lines are unchanged", () => result("ordinary dates"));

check(checks, "timezone-stable", "correctness", "Held-out results are the same in Auckland and Los Angeles as in UTC", () => {
  const diffs = [];
  for (const tz of ["Pacific/Auckland", "America/Los_Angeles"]) {
    const r = runTests(hiddenDir, ["test/zz.hidden.test.js"], tz);
    for (const [name, pass] of Object.entries(hidden.UTC.tests)) if (r.tests[name] !== pass) diffs.push(`${tz}: ${name}`);
  }
  return [diffs.length === 0, diffs.join("; ")];
});

// Test files the agent added or changed.
const fixtureTests = new Map(testFiles(fixture).map((f) => [f, fs.readFileSync(path.join(fixture, f), "utf8")]));
const agentTests = testFiles(work).filter((f) => fixtureTests.get(f) !== fs.readFileSync(path.join(work, f), "utf8"));

check(checks, "regression-test", "correctness", "Agent's new or changed tests pass on the fix and fail on the original code", () => {
  if (agentTests.length === 0) return [false, "no new or changed test files"];
  const onFix = runTests(copyOf("agent-fix"), agentTests);
  const onOld = runTests(copyOf("agent-old", path.join(fixture, "src")), agentTests);
  return [onFix.ok && !onOld.ok, `${agentTests.join(", ")}: fix ${onFix.ok ? "passes" : "fails"}, original ${onOld.ok ? "passes" : "fails"}`];
});

const WRITES = /open\([^)]*['"][wa]['"]|writeFileSync|sed -i|perl -[a-z]*i|\btee\b|>\s*\S|apply_patch|git apply/;
const kind = (rel) => (/(^|\/)test\/|\.test\./.test(rel) ? "test" : rel.startsWith("src/") ? "src" : "other");

check(checks, "test-first", "practice", "A failing test was written before the code was changed (from the transcript)", () => {
  if (!transcript || !fs.existsSync(transcript)) return [false, "no transcript"];
  const edits = [];
  for (const line of fs.readFileSync(transcript, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    const msg = JSON.parse(line);
    if (msg.type !== "assistant") continue;
    for (const c of msg.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      if (["Write", "Edit", "MultiEdit"].includes(c.name) && c.input?.file_path) {
        edits.push(kind(path.relative(fs.realpathSync(work), fs.existsSync(c.input.file_path) ? fs.realpathSync(c.input.file_path) : c.input.file_path)));
      } else if (c.name === "Bash" && WRITES.test(c.input?.command ?? "")) {
        // A shell edit (heredoc script, sed -i, redirect): count the files it
        // names, in the order it names them.
        for (const m of (c.input.command.match(/(?:^|[\s'"(=])((?:src|test)\/[\w./-]+\.m?js)/g) ?? [])) edits.push(kind(m.trim().replace(/^['"(=]/, "")));
      }
    }
  }
  const t = edits.indexOf("test"), s = edits.indexOf("src");
  return [t !== -1 && s !== -1 && t < s, `edit order: ${edits.join(" > ") || "none"}`];
});

fs.rmSync(scratch, { recursive: true, force: true });
report("renewal-dates", checks);
