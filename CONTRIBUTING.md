# Contributing to Skillshed

There are two ways to add a skill, depending on who it's for.

## Just for you

Personal skills live on your machine, not in this repo. They are scanned and pinned like shared ones and are always on.

```bash
skillshed add owner/repo@skill-name     # a third-party skill, scanned and pinned
skillshed new my-skill "Use when ..."   # start your own
skillshed mine                          # list them
skillshed remove my-skill
```

They go into `~/.agents/skills` (Codex) with a link from `~/.claude/skills` (Claude Code). `skillshed update` moves tracked third-party ones forward, re-scanning each change.

## For everyone

1. Put the skill in a public GitHub repo: a folder with a `SKILL.md` that follows the [Agent Skills format](https://agentskills.io/specification). The repo needs a licence that allows redistribution.
2. Check it: `skillshed vet owner/repo@skill-name`. Fix any high-severity findings.
3. [Open a submission](https://github.com/farmhutsoftwareteam/skillshed/issues/new?template=submit-skill.yml). A workflow scans it again and comments the result on the issue.
4. A maintainer reads every file, picks the pack, and adds it with `sync-vendor.mjs add`, which pins it to a commit in `vendor.lock.json`. From then on, upstream changes arrive as reviewed weekly PRs.

### What gets accepted

- **One job, said plainly.** The description starts with "Use when", names the trigger case in its first sentence, and stays under about 300 characters. Every enabled skill's description costs context on every request.
- **Does what it says.** No hidden instructions, no sending data anywhere it doesn't need to, no reading secrets, no `curl | sh`.
- **Fits a pack,** or is broadly useful enough for a new one.

### Changing Skillshed itself

Owned skills live in `plugins/<pack>/skills/`. Run `node scripts/check.mjs --write` and `node scripts/scan-skills.mjs --all` before opening a PR. Never edit vendored skills (those in `vendor.lock.json`) here: change them upstream.
