# Benchmarks

Do Skillshed's packs make Claude Code do real tasks better? Each task here runs
twice in a clean copy of a small project: once with the relevant pack off and
once with it on. Nothing else changes between the two. A rubric scores every
run, and every check in it runs code or reads config. Nothing is graded by eye.

Results: [RESULTS.md](RESULTS.md).

## Tasks

| Task | Pack | What the agent is asked | How it's graded |
| --- | --- | --- | --- |
| `supabase-rls` | `supabase` | Add row-level security to a three-table team schema | The migrations are applied to a Supabase-like Postgres ([PGlite](https://pglite.dev)), which is then queried as four different users plus a signed-out visitor: reads, writes, privilege escalation, the existing view, definer functions, policy performance (13 checks) |
| `expo-release` | `expo` | Get an Expo app's EAS config ready for its first store release | Reads `app.json`, `eas.json` and `.gitignore`. Checks: AAB vs APK, build-number auto-increment, identifiers, submit profiles, key files kept out of git, export compliance (9 checks) |
| `renewal-dates` | `matt` | Fix a subscription renewal-date bug from a support ticket | Held-out tests (including a drift case the ticket doesn't mention), the original tests, the tests in two other time zones, a regression test that fails on the old code, and whether the test came first (8 checks) |

Each task folder has `prompt.md` (exactly what the agent sees), `fixture/` (the
starting project), `grade.mjs` (the rubric) and `reference/` (a known-good
answer used to check the grader, never shown to the agent).

Checks are marked `correctness` (it breaks, leaks or gets rejected without
this) or `practice` (a documented recommendation, like wrapping `auth.uid()` in
a `select`). The results report both.

## Arms

Both arms use the fixture's `.claude/settings.json`, written by
`scripts/use-pack.sh` exactly as `skillshed use` writes it. Claude Code runs
with `--setting-sources project`, so your own user settings and plugins don't
leak into either arm.

- **off:** Skillshed's defaults, `core` and `matt`, with the task's pack off.
  For `renewal-dates` the pack under test is `matt`, so this arm has `core` only.
- **on:** the same, plus the task's pack.

Both arms have `core:skill-router`, which can point at a pack that's switched
off. That's deliberate, because it's what a real install looks like.

## Running

You need Node 20+, a logged-in Claude Code (`claude auth login`, or
`ANTHROPIC_API_KEY`), and the Skillshed marketplace installed so the packs can
be enabled (`curl -fsSL https://skillshed.munyamakosa.com/install/github | bash`).

```bash
npm install --prefix benchmarks
```

```bash
node benchmarks/run.mjs
```

That runs every task three times per arm (18 runs, three at a time, each
capped at $3) and writes to `benchmarks/results/<timestamp>/`:

- `<task>/<arm>-<n>/transcript.jsonl`: the full `stream-json` transcript
- `<task>/<arm>-<n>/diff.patch`: what the agent changed
- `<task>/<arm>-<n>/result.json`: the score for each check, skills loaded and used, cost, time
- `summary.md` and `summary.json`: per-arm tables

Transcripts and diffs are committed, so the runner replaces your home
directory with `~` and your email with `you@example.com` before saving them.

Useful flags: `--tasks supabase-rls`, `--reps 1`, `--model sonnet`,
`--parallel 1`, `--claude /path/to/claude`. To check the runner and graders
without spending anything, `--agent reference` grades the reference solutions
instead of calling Claude. Every check should pass except `test-first`, which
needs a transcript.

The packs load from your installed marketplace copy (`~/.claude/plugins`), not
from this checkout. Run `skillshed update` first so they match the commit
you're testing. `run.json` records the commit and the Claude Code version.

## Adding a task

Make `benchmarks/tasks/<id>/` with `task.json` (`{ "id", "pack", "title" }`),
`prompt.md`, `fixture/`, `reference/` and `grade.mjs`. The grader takes the
work directory (and the transcript path) and prints
`{ task, checks: [{ id, group, label, pass, detail }], passed, total }`; see
`lib/report.mjs`. Before you run it for real, check that the untouched fixture
scores low and the reference scores full marks.

## Demos

Some results can't be scored by a script, such as a drawing. `demo.mjs` runs
an open-ended prompt in an empty folder as plain Claude Code (no plugins at
all) and as Skillshed's defaults plus the demo's packs. It keeps what each run
made and records the model, tokens per model, cost, time, turns, tool calls and
skills used. Each demo is `benchmarks/demos/<id>/` with `prompt.md` and
`demo.json` (`{ "packs" }`).

```bash
node benchmarks/demo.mjs ps5-teardown --model claude-opus-5-5 --node ~/.local/share/fnm/node-versions/v22.23.4/installation/bin
```

One run per arm is a demonstration, not a measurement. The
[PS5 teardown post](https://skillshed.munyamakosa.com/blog/ps5-teardown/) shows
the first one, from `results/demo-ps5-teardown-opus-5.5/`. Transcripts are
kept without the base64 of images the agent read back, which would otherwise
make each one several megabytes.
