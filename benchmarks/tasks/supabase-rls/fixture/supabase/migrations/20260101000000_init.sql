create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  primary key (team_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index projects_team_id_idx on public.projects (team_id);

-- Used by the dashboard's project list.
create view public.project_overview as
  select p.id, p.name, p.team_id, t.name as team_name, p.created_at
  from public.projects p
  join public.teams t on t.id = p.team_id;
