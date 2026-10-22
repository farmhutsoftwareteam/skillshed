# Results

Run on 22 October 2026 with Claude Code 2.1.304. The packs are from Skillshed
commit `6f0218a`. Three models, three tasks, two arms (task pack off / on),
three runs each: 54 runs, $6.95 in total. What each task asks and how it's
graded is in [README.md](README.md). The raw transcripts, diffs and scores are
in [`results/`](results/).

## Short version

- **Supabase RLS is where the pack helped.** With Haiku 5.5, the score went from 85% to 97%.
  Without the pack, all three runs put their `SECURITY DEFINER` helper functions in
  the `public` schema. Supabase's Data API can call anything in `public`, so any
  visitor could call them. With the pack, none of the runs did. Opus 5.5 went from
  95% to 100%, and Sonnet 5.5 was the same in both arms.
- **The Expo pack made no measurable difference.** Opus scored 100% with and
  without it. Sonnet scored 78% with and without it, and missed the same two
  things every time, even though it opened the Expo skill in every run with the
  pack on. Haiku moved 81% → 85%, which is one run's difference.
- **The `matt` pack never triggered.** It was on in 45 of the 54 runs, and no
  run invoked any of its skills. That includes the nine bug-fix runs, where the
  prompt was a support ticket and `diagnosing-bugs` and `tdd` were the obvious
  fit. Every model fixed the bug fully anyway, including a drift case the ticket
  doesn't mention. Only 1 of the 18 bug-fix runs wrote its test before changing
  the code.
- **Stronger models need the packs less.** Opus got nearly everything right
  without any pack, so these tasks can't show a gain for it.

## Scores

Mean share of rubric checks passed, over three runs per arm.

| Task | Model | Pack off | Pack on | Pack skill used (on arm) |
| --- | --- | --- | --- | --- |
| `supabase-rls` | Haiku 5.5 | 85% | **97%** | 3/3 |
| | Sonnet 5.5 | 92% | 92% | 3/3 |
| | Opus 5.5 | 95% | 100% | 0/3 |
| `expo-release` | Haiku 5.5 | 81% | 85% | 3/3 |
| | Sonnet 5.5 | 78% | 78% | 3/3 |
| | Opus 5.5 | 100% | 100% | 3/3 |
| `renewal-dates` | Haiku 5.5 | 88% | 92% | 0/3 |
| | Sonnet 5.5 | 88% | 88% | 0/3 |
| | Opus 5.5 | 88% | 88% | 0/3 |

Full per-check tables: [Opus](results/2026-10-22-opus-5.5/summary.md),
[Sonnet](results/2026-10-22-sonnet-5.5/summary.md),
[Haiku](results/2026-10-22-haiku-5.5/summary.md).

## What changed between arms

**Supabase, Haiku.** Every run in both arms got the access rules right. The
other eleven checks passed in all six runs, including the one for the view that
would otherwise bypass RLS. The arms differed only in these two:

| Check | Off | On |
| --- | --- | --- |
| No `SECURITY DEFINER` function in `public` | 0/3 | 3/3 |
| Index on `team_members` led by `user_id` | 0/3 | 2/3 |

Both come straight from `supabase-postgres-best-practices`. The first one is a
real hole: Postgres lets every role execute a new function by default, so
`public.is_team_member()` could be called through the Data API by anyone.

**Supabase, Opus.** The only difference was the `user_id` index (1/3 off, 3/3
on). Opus never invoked a Supabase skill in the on arm, so the skill text can't
take the credit. With three runs, this is as likely to be noise.

**Supabase, Sonnet.** Sonnet invoked the `supabase` skill in every on-arm run.
It scored the same as without it, and both arms missed the `user_id` index
every time.

**Expo, Sonnet and Haiku.** Both arms missed two things. One is setting
`android.package`, without which a non-interactive EAS build fails. Sonnet
missed it in 6/6 runs, Haiku in 3 of 6. The other is declaring
`usesNonExemptEncryption`, without which every TestFlight build waits on the
export-compliance question. Every Sonnet and Haiku run missed it, in both
arms. The skill covers export compliance only in
`references/ios-app-store.md`, which no run opened, and it doesn't call out
the Android package at all. Two concrete fixes, worth sending upstream to
`expo/skills`.

**Bug fix (`renewal-dates`).** All nine on-arm runs had the `matt` skills
loaded, and none invoked one. The prompt is a support ticket asking to "find the cause
and fix it", which is what `diagnosing-bugs` is for. Every run got the fix
right without it. The one test-first pass (Haiku, on arm) came with no `matt`
skill invoked, so it says nothing about the pack.

## Something to know about "off"

`core:skill-router` is on in both arms, as it is in a real install. In one
Sonnet run with the expo pack off, the router found `eas-app-stores` in the
disabled pack and the agent read it from disk. So the off arm is "pack not
enabled", not "pack unavailable". That run scored the same as the other two.

## Limits

- Three runs per arm. A one-run difference (for example 81% → 85%) is within noise.
- One small fixture per task. Real projects are messier, and the gap may be larger or smaller.
- I wrote the rubrics after reading the skills, so some checks (export compliance,
  the `user_id` index, definer functions) are things the skills mention. Each one
  is also a real failure or a documented Supabase/Expo recommendation. The
  behaviour checks, the held-out tests and the AAB/APK check don't depend on any
  skill.
- Codex wasn't tested. The CLI wasn't logged in on this machine, and Codex only
  reads `.codex/config.toml` in trusted projects, so the harness would need a
  separate setup for it.
- Costs are as reported by Claude Code.

## Proposed site copy

For the owner to decide on. Nothing on the site has changed.

> **Do the packs help?** We test them. On a Supabase row-level-security task,
> Haiku 5.5 with the `supabase` pack scored 97% against 85% without it. Without
> the pack, every run left its security-definer helpers in the `public` schema,
> where any visitor can call them. On the same task Opus 5.5 scored 100% with the
> pack and 95% without. On our Expo release and bug-fix tasks the packs made no
> measurable difference. [Results and the harness](https://github.com/farmhutsoftwareteam/skillshed/blob/main/benchmarks/RESULTS.md).

A shorter line, if the homepage only has room for one:

> Measured, not just listed: [with and without each pack, on real tasks](https://github.com/farmhutsoftwareteam/skillshed/blob/main/benchmarks/RESULTS.md).

## Rerun

```bash
npm install --prefix benchmarks
```

```bash
node benchmarks/run.mjs --model haiku
```
