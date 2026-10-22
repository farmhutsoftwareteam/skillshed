This Supabase project has no row-level security yet. Add a migration that locks the data down:

- A signed-in user can see the teams they belong to, the members of those teams, and those teams' projects.
- Only a team's admins can create, edit or delete that team's projects, and add or remove team members.
- Nobody can see or change anything belonging to a team they are not in. Signed-out visitors see nothing.

Put the change in a new file in supabase/migrations/. You can't reach a hosted Supabase project from here.
