-- Reference solution, used only to check the grader. Not shown to the agent.
create schema if not exists private;

create function private.is_team_member(_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where team_id = _team_id and user_id = (select auth.uid())
  );
$$;

create function private.is_team_admin(_team_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where team_id = _team_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function private.is_team_member(uuid), private.is_team_admin(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_team_member(uuid), private.is_team_admin(uuid) to authenticated;

create index team_members_user_id_idx on public.team_members (user_id, team_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.projects enable row level security;

create policy "members read their teams" on public.teams for select to authenticated
  using ((select private.is_team_member(id)));

create policy "members read co-members" on public.team_members for select to authenticated
  using ((select private.is_team_member(team_id)));
create policy "admins add members" on public.team_members for insert to authenticated
  with check ((select private.is_team_admin(team_id)));
create policy "admins update members" on public.team_members for update to authenticated
  using ((select private.is_team_admin(team_id))) with check ((select private.is_team_admin(team_id)));
create policy "admins remove members" on public.team_members for delete to authenticated
  using ((select private.is_team_admin(team_id)));

create policy "members read projects" on public.projects for select to authenticated
  using ((select private.is_team_member(team_id)));
create policy "admins create projects" on public.projects for insert to authenticated
  with check ((select private.is_team_admin(team_id)));
create policy "admins update projects" on public.projects for update to authenticated
  using ((select private.is_team_admin(team_id))) with check ((select private.is_team_admin(team_id)));
create policy "admins delete projects" on public.projects for delete to authenticated
  using ((select private.is_team_admin(team_id)));

alter view public.project_overview set (security_invoker = true);
