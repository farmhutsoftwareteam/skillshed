### expo-release (pack: `expo`)

| | pack off | pack on |
| --- | --- | --- |
| Mean score | **81%** | **85%** |
| Per run | 7/9, 8/9, 7/9 | 8/9, 8/9, 7/9 |
| Runs that used a `expo` skill | 0/3 | 3/3 |
| Mean cost | $0.01 | $0.01 |
| Mean time | 31s | 33s |

| Check | pack off | pack on |
| --- | --- | --- |
| app.json and eas.json parse, and a production build profile exists | 3/3 | 3/3 |
| Production Android builds an app bundle, not an APK (Play rejects APKs) | 3/3 | 3/3 |
| Production builds are store builds (no internal distribution or dev client) | 3/3 | 3/3 |
| Production builds bump the build number automatically on both platforms | 3/3 | 3/3 |
| Build numbers live on EAS (cli.appVersionSource "remote"), so CI builds can't reuse one _(practice)_ | 3/3 | 3/3 |
| iOS bundle ID kept as is, and a valid Android package is set | 1/3 | 2/3 |
| submit.production covers iOS (with an ascAppId slot) and Android | 3/3 | 3/3 |
| Key files referenced from eas.json are git-ignored | 3/3 | 3/3 |
| Declares no non-exempt encryption (HTTPS only), so TestFlight builds don't wait on the compliance question _(practice)_ | 0/3 | 0/3 |

### renewal-dates (pack: `matt`)

| | pack off | pack on |
| --- | --- | --- |
| Mean score | **88%** | **92%** |
| Per run | 7/8, 7/8, 7/8 | 7/8, 7/8, 8/8 |
| Runs that used a `matt` skill | 0/3 | 0/3 |
| Mean cost | $0.01 | $0.01 |
| Mean time | 25s | 25s |

| Check | pack off | pack on |
| --- | --- | --- |
| The original tests still pass, unmodified | 3/3 | 3/3 |
| Held-out: renewals in short months fall on the month's last day | 3/3 | 3/3 |
| Held-out: monthly renewals return to the 31st after a short month (no drift) | 3/3 | 3/3 |
| Held-out: a 29 Feb annual start renews on 29 Feb in leap years | 3/3 | 3/3 |
| Held-out: ordinary dates and invoice lines are unchanged | 3/3 | 3/3 |
| Held-out results are the same in Auckland and Los Angeles as in UTC | 3/3 | 3/3 |
| Agent's new or changed tests pass on the fix and fail on the original code | 3/3 | 3/3 |
| A failing test was written before the code was changed (from the transcript) _(practice)_ | 0/3 | 1/3 |

### supabase-rls (pack: `supabase`)

| | pack off | pack on |
| --- | --- | --- |
| Mean score | **85%** | **97%** |
| Per run | 11/13, 11/13, 11/13 | 13/13, 12/13, 13/13 |
| Runs that used a `supabase` skill | 0/3 | 3/3 |
| Mean cost | $0.02 | $0.01 |
| Mean time | 90s | 79s |

| Check | pack off | pack on |
| --- | --- | --- |
| All migrations apply on a Supabase-like Postgres | 3/3 | 3/3 |
| RLS is enabled on teams, team_members and projects | 3/3 | 3/3 |
| A member sees their team, co-members and projects | 3/3 | 3/3 |
| Users outside a team, and signed-out visitors, see none of it | 3/3 | 3/3 |
| A non-admin member cannot create, edit or delete projects | 3/3 | 3/3 |
| An admin can create, edit and delete their team's projects | 3/3 | 3/3 |
| An admin cannot touch another team's projects or move a project out | 3/3 | 3/3 |
| Members cannot add people, join teams or promote themselves | 3/3 | 3/3 |
| An admin can add and remove members of their team | 3/3 | 3/3 |
| The project_overview view does not bypass RLS | 3/3 | 3/3 |
| No SECURITY DEFINER function in the exposed public schema; each pins search_path | 0/3 | 3/3 |
| Policies call auth.uid() as (select auth.uid()), evaluated once per query _(performance)_ | 3/3 | 3/3 |
| team_members has an index led by user_id for policy lookups _(performance)_ | 0/3 | 2/3 |

