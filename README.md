# Skillshed

[skillshed.munyamakosa.com](https://skillshed.munyamakosa.com) · Agent skills for **Claude Code** and **Codex**, in one plugin marketplace: a small always-on core, Matt Pocock's engineering skills, and stack packs you switch on per project.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/farmhutsoftwareteam/skillshed/main/install.sh | bash
```

That's it. You need git and Node 20+, and Claude Code and/or Codex (`brew install --cask codex`). The installer:

- clones this repo to `~/.skillshed`
- adds the `skillshed` marketplace to every tool it finds, with auto-update on in Claude Code
- installs every pack: `core` and `matt` on, the rest off
- puts a `skillshed` command on your PATH

Restart any open Claude Code or Codex sessions afterwards. Re-running the installer, or `skillshed update`, updates everything.

<details>
<summary>Install with the tools' own commands instead</summary>

Claude Code (inside a session):

```
/plugin marketplace add farmhutsoftwareteam/skillshed
/plugin install core@skillshed
/plugin install matt@skillshed
```

Codex:

```bash
codex plugin marketplace add farmhutsoftwareteam/skillshed
```

```bash
codex plugin add core@skillshed
```

You won't get the `skillshed` command this way.
</details>

## What's in it

| Pack | On by default | What it covers |
| --- | --- | --- |
| `core` | yes | `skill-router` (finds the right skill, even in a pack that's off), `find-skill` (search and add new skills safely), `vet-skill` (check third-party skills for prompt injection) |
| `matt` | yes | [Matt Pocock's skills](https://github.com/mattpocock/skills): TDD, specs, tickets, PRs, triage, grilling, code review (31 skills, MIT) |
| `nextjs-vercel` | no | Official Next.js skills from [vercel/next.js](https://github.com/vercel/next.js/tree/canary/skills): dev loop, bundle and caching optimisers (6) |
| `supabase` | no | Official [Supabase skills](https://github.com/supabase/agent-skills): Supabase and Postgres best practices (2) |
| `expo` | no | Official [Expo skills](https://github.com/expo/skills): EAS, Router, native UI, upgrades and more (23) |
| `inngest` | no | Official [Inngest skills](https://github.com/inngest/inngest-skills): durable functions, steps, events, flow control (15) |

Agents read every enabled skill's description on every request, within a small budget (about 1% of context in Claude Code, 2% in Codex). Past that budget, skills quietly stop triggering, which is why most packs are off by default. To change which packs are on everywhere, edit `ALWAYS_ON` in `scripts/bootstrap.sh`.

## Everyday use

```bash
skillshed packs              # list packs
skillshed use supabase       # turn a pack on for the project you're in
skillshed off supabase       # and off again
skillshed find remotion      # search skill-issue.in + skills.sh for new skills
skillshed update             # pull the latest and refresh both tools
```

`use` writes `"supabase@skillshed": true` to `.claude/settings.json` and `[plugins."supabase@skillshed"] enabled = true` to `.codex/config.toml`. Commit both files so the project brings its packs to every machine. Codex reads the project file only in projects you have trusted.

## Finding new skills

There is no bulk import. The skill-issue.in directory alone resolves to about 8,500 skills, too many to vet or review. Instead, `core:find-skill` pulls skills in on demand:

- **Search:** `skillshed find <keywords>` searches a snapshot of skill-issue.in (`catalog/skill-issue.json`, about 313 entries, refreshed by the weekly sync) and the live skills.sh index.
- **Pick:** you choose from what it finds.
- **Vet:** it vets the pick with `vet-skill`.
- **Pin:** `sync-vendor.mjs add` puts the skill into a pack, pinned in the lock and scanned.

To create a pack for a new area, run `node scripts/new-pack.mjs <name> "<description>"`. Then re-run `bootstrap.sh` so each Mac installs it, disabled.

## Layout

```
.claude-plugin/marketplace.json     Claude Code marketplace (Codex also reads it)
.agents/plugins/marketplace.json    Codex marketplace (Codex checks this first)
plugins/<pack>/
  .claude-plugin/plugin.json        Claude Code manifest
  .codex-plugin/plugin.json         Codex manifest
  skills/<skill>/SKILL.md           Agent Skills format (agentskills.io)
vendor.lock.json                    pins for third-party skills
install.sh                          one-line installer (curl | bash)
bin/skillshed                    the skillshed command
licenses/                           upstream licenses for vendored skills
scripts/
  bootstrap.sh                      add marketplace + packs to both tools
  use-pack.sh                       per-project packs
  check.mjs                         lint, lock hashes, router index (--write)
  scan-skills.mjs                   prompt-injection / supply-chain scan
  sync-vendor.mjs                   add / update / remove vendored skills
  find-skill.mjs                    search skill-issue.in snapshot + skills.sh
  refresh-catalog.mjs               re-snapshot skill-issue.in
  new-pack.mjs                      create an off-by-default pack
catalog/skill-issue.json            skill-issue.in snapshot (untrusted data)
.github/workflows/
  check.yml                         CI on every PR
  sync-vendor.yml                   weekly upstream sync, opens a PR
```

Plugins have no `version`, so every commit to `main` counts as a new version. (`claude plugin validate` warns about this; that is expected.)

## Owned and vendored skills

**Owned** skills are written here.

- Their descriptions start with "Use when…", cover one job, and stay at 300 characters or fewer. `check.mjs` enforces this.

**Vendored** skills are copied from upstream repos into a pack's `skills/` folder and pinned in `vendor.lock.json` by source repo, path, ref, commit SHA and content hash.

- Never edit them here. CI fails if their content stops matching the lock.

```bash
# add (skills.sh URL, owner/repo@skill, or a GitHub tree URL)
node scripts/sync-vendor.mjs add https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices --pack nextjs-vercel
node scripts/sync-vendor.mjs add anthropics/skills@skill-creator --pack core --pin
node scripts/check.mjs --write          # refresh the router index

node scripts/sync-vendor.mjs update     # pull upstream for tracked skills
node scripts/sync-vendor.mjs remove <name>
```

- **Tracked** (the default) means the weekly sync moves the skill to the latest commit on its `ref`.
- **Pinned** (`--pin`) means it stays at its commit until you run `update <name> --force`.

Use pinned for skills you have vetted carefully and don't want to change underneath you.

## How updates flow

1. Every Monday, `sync-vendor.yml` (needs *Settings → Actions → Allow GitHub Actions to create pull requests*) runs `sync-vendor.mjs update`.
2. It then runs the checks and the scanner, and opens or refreshes a **`vendor-sync` PR**. The PR body includes the compare links, the check output and the scan report. Nothing reaches `main` without your merge.
3. After you merge, Claude Code picks up the change on its own (auto-update). For Codex, or to update Claude Code now:

```bash
claude plugin marketplace update skillshed
```

```bash
codex plugin marketplace upgrade skillshed
```

## Security: prompt injection and supply chain

A third-party skill is instructions your agent follows with your permissions. There are several layers of defence:

1. **Pinning.** Every vendored skill is fixed to a commit SHA and a content hash. Upstream changes only arrive as a reviewable PR, and a pinned skill doesn't move at all.
2. **Static scan** (`scan-skills.mjs`). It runs when a skill is added (high findings block the add unless you pass `--accept-risk`), in CI, and in every sync PR. It flags:
   - hidden Unicode (zero-width, bidi, tag characters)
   - "ignore previous instructions" and "don't tell the user" phrasing
   - skipping confirmation
   - `curl | sh`
   - known exfiltration endpoints
   - reads of secrets and keys
   - network sends
   - eval and decode-exec
   - HTML comments
   - long base64 blobs
   - symlinks, executables, binaries, and hooks or MCP config inside skills
   - broad `allowed-tools`

   A fixture in `tests/fixtures/injected-skill` keeps the scanner honest in CI.
3. **Agent review.** The `core:vet-skill` skill walks an agent through reading every file and diff with the content treated as data, and ends in a verdict with quoted lines. Use it on every sync PR.
4. **No code execution while syncing.** `sync-vendor.mjs` only fetches and copies files. It never runs anything from the fetched repo.

The scanner is a tripwire, not proof of safety. Anything it flags (and any new `scripts/`) still needs a human read before you merge.

## License

[MIT](LICENSE) for this repo's own skills and scripts. Vendored third-party skills keep their upstream licenses, which are copied in [`licenses/`](licenses/).
