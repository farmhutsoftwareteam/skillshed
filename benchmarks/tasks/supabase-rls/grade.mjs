// Grades the supabase-rls task by applying the project's migrations to a real
// Postgres (PGlite) set up like a Supabase database, then probing it as
// different users.
//
//   node grade.mjs <workdir>
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { report, checkAsync } from "../../lib/report.mjs";

const work = process.argv[2];
if (!work) throw new Error("usage: grade.mjs <workdir>");

// The parts of a Supabase database the policies depend on: roles, auth.uid(),
// and the default grants that expose every new public table to the Data API.
const SUPABASE_PREAMBLE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const U = {
  alice: "00000000-0000-0000-0000-00000000000a", // admin of red
  bob: "00000000-0000-0000-0000-00000000000b", // member of red
  carol: "00000000-0000-0000-0000-00000000000c", // admin of blue
  dave: "00000000-0000-0000-0000-00000000000d", // in no team
};
const T = { red: "10000000-0000-0000-0000-000000000001", blue: "10000000-0000-0000-0000-000000000002" };
const P = { red: "20000000-0000-0000-0000-000000000001", blue: "20000000-0000-0000-0000-000000000002" };

const SEED = `
insert into auth.users (id, email) values
  ('${U.alice}', 'alice@x.test'), ('${U.bob}', 'bob@x.test'),
  ('${U.carol}', 'carol@x.test'), ('${U.dave}', 'dave@x.test');
insert into public.teams (id, name) values ('${T.red}', 'Red'), ('${T.blue}', 'Blue');
insert into public.team_members (team_id, user_id, role) values
  ('${T.red}', '${U.alice}', 'admin'), ('${T.red}', '${U.bob}', 'member'),
  ('${T.blue}', '${U.carol}', 'admin');
insert into public.projects (id, team_id, name, created_by) values
  ('${P.red}', '${T.red}', 'Red project', '${U.alice}'),
  ('${P.blue}', '${T.blue}', 'Blue project', '${U.carol}');
`;

const db = new PGlite();
await db.exec(SUPABASE_PREAMBLE);

const migDir = path.join(work, "supabase", "migrations");
const files = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort() : [];
let migrationError = null;
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  } catch (e) {
    migrationError = `${f}: ${e.message}`;
    break;
  }
}
if (!migrationError) {
  try {
    await db.exec(SEED);
  } catch (e) {
    migrationError = `seed data: ${e.message}`;
  }
}

// Runs `sql` as a user inside a transaction that is always rolled back, then
// runs `verify` as the superuser before the rollback so writes can be checked.
async function as(user, sql, verify) {
  await db.exec("begin");
  let rows = null, error = null, after = null;
  try {
    await db.exec("savepoint probe");
    const role = user ? "authenticated" : "anon";
    await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [user ?? "", role]);
    await db.exec(`set local role ${role}`);
    try {
      const r = await db.query(sql);
      rows = r.rows;
    } catch (e) {
      error = e.message;
      await db.exec("rollback to savepoint probe");
    }
    await db.exec("reset role");
    if (verify) after = (await db.query(verify)).rows;
  } finally {
    await db.exec("rollback");
  }
  return { rows, error, after };
}

const ids = (rows) => (rows ?? []).map((r) => Object.values(r)[0]).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const checks = [];
const need = () => {
  if (migrationError) throw new Error("migrations did not apply");
};

await checkAsync(checks, "migrations-apply", "correctness", "All migrations apply on a Supabase-like Postgres", async () => [
  !migrationError && files.length > 1,
  migrationError ?? `${files.length} files`,
]);

await checkAsync(checks, "rls-enabled", "correctness", "RLS is enabled on teams, team_members and projects", async () => {
  need();
  const r = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace
    and relname in ('teams','team_members','projects') and relrowsecurity`);
  return [r.rows.length === 3, ids(r.rows).join(", ")];
});

await checkAsync(checks, "member-reads-own", "correctness", "A member sees their team, co-members and projects", async () => {
  need();
  const p = await as(U.bob, "select id from public.projects");
  const t = await as(U.bob, "select id from public.teams");
  const m = await as(U.bob, "select user_id from public.team_members");
  const ok = same(ids(p.rows), [P.red]) && same(ids(t.rows), [T.red]) && same(ids(m.rows), [U.alice, U.bob]);
  return [ok, JSON.stringify({ projects: p.error ?? ids(p.rows).length, teams: t.error ?? ids(t.rows).length, members: m.error ?? ids(m.rows).length })];
});

await checkAsync(checks, "isolation", "correctness", "Users outside a team, and signed-out visitors, see none of it", async () => {
  need();
  const leaks = [];
  for (const [who, user, allowed] of [["carol", U.carol, [T.blue, P.blue, U.carol]], ["dave", U.dave, []], ["anon", null, []]]) {
    for (const q of ["select id from public.projects", "select id from public.teams", "select user_id from public.team_members"]) {
      const r = await as(user, q);
      const extra = ids(r.rows).filter((x) => !allowed.includes(x));
      if (extra.length) leaks.push(`${who}: ${q} -> ${extra.length} rows`);
    }
  }
  return [leaks.length === 0, leaks.join("; ")];
});

await checkAsync(checks, "member-cannot-write-projects", "correctness", "A non-admin member cannot create, edit or delete projects", async () => {
  need();
  const ins = await as(U.bob, `insert into public.projects (team_id, name) values ('${T.red}', 'sneaky')`, "select count(*)::int as n from public.projects");
  const upd = await as(U.bob, `update public.projects set name = 'renamed' where id = '${P.red}'`, `select name from public.projects where id = '${P.red}'`);
  const del = await as(U.bob, `delete from public.projects where id = '${P.red}'`, `select count(*)::int as n from public.projects where id = '${P.red}'`);
  const ok = ins.after[0].n === 2 && upd.after[0].name === "Red project" && del.after[0].n === 1;
  return [ok, JSON.stringify({ insert: ins.after[0].n, update: upd.after[0].name, delete: del.after[0].n })];
});

await checkAsync(checks, "admin-can-write-projects", "correctness", "An admin can create, edit and delete their team's projects", async () => {
  need();
  const ins = await as(U.alice, `insert into public.projects (team_id, name, created_by) values ('${T.red}', 'new', '${U.alice}')`, "select count(*)::int as n from public.projects");
  const upd = await as(U.alice, `update public.projects set name = 'renamed' where id = '${P.red}'`, `select name from public.projects where id = '${P.red}'`);
  const del = await as(U.alice, `delete from public.projects where id = '${P.red}'`, `select count(*)::int as n from public.projects where id = '${P.red}'`);
  const ok = ins.after[0].n === 3 && upd.after[0].name === "renamed" && del.after[0].n === 0;
  return [ok, JSON.stringify({ insert: ins.error ?? ins.after[0].n, update: upd.error ?? upd.after[0].name, delete: del.error ?? del.after[0].n })];
});

await checkAsync(checks, "admin-confined", "correctness", "An admin cannot touch another team's projects or move a project out", async () => {
  need();
  const ins = await as(U.alice, `insert into public.projects (team_id, name) values ('${T.blue}', 'x')`, "select count(*)::int as n from public.projects");
  const move = await as(U.alice, `update public.projects set team_id = '${T.blue}' where id = '${P.red}'`, `select team_id from public.projects where id = '${P.red}'`);
  const other = await as(U.alice, `update public.projects set name = 'x' where id = '${P.blue}'`, `select name from public.projects where id = '${P.blue}'`);
  const ok = ins.after[0].n === 2 && move.after[0].team_id === T.red && other.after[0].name === "Blue project";
  return [ok, JSON.stringify({ insertOther: ins.after[0].n, moved: move.after[0].team_id !== T.red, editedOther: other.after[0].name !== "Blue project" })];
});

await checkAsync(checks, "no-self-escalation", "correctness", "Members cannot add people, join teams or promote themselves", async () => {
  need();
  const count = "select count(*)::int as n from public.team_members";
  const add = await as(U.bob, `insert into public.team_members (team_id, user_id, role) values ('${T.red}', '${U.dave}', 'member')`, count);
  const join = await as(U.dave, `insert into public.team_members (team_id, user_id, role) values ('${T.red}', '${U.dave}', 'admin')`, count);
  const promote = await as(U.bob, `update public.team_members set role = 'admin' where user_id = '${U.bob}'`, `select role from public.team_members where user_id = '${U.bob}'`);
  const kick = await as(U.bob, `delete from public.team_members where user_id = '${U.alice}'`, count);
  const cross = await as(U.alice, `insert into public.team_members (team_id, user_id, role) values ('${T.blue}', '${U.alice}', 'admin')`, count);
  const ok = add.after[0].n === 3 && join.after[0].n === 3 && promote.after[0].role === "member" && kick.after[0].n === 3 && cross.after[0].n === 3;
  return [ok, JSON.stringify({ memberAdds: add.after[0].n > 3, outsiderJoins: join.after[0].n > 3, selfPromote: promote.after[0].role, memberKicks: kick.after[0].n < 3, adminJoinsOtherTeam: cross.after[0].n > 3 })];
});

await checkAsync(checks, "admin-manages-members", "correctness", "An admin can add and remove members of their team", async () => {
  need();
  const count = "select count(*)::int as n from public.team_members";
  const add = await as(U.alice, `insert into public.team_members (team_id, user_id, role) values ('${T.red}', '${U.dave}', 'member')`, count);
  const del = await as(U.alice, `delete from public.team_members where team_id = '${T.red}' and user_id = '${U.bob}'`, count);
  return [add.after[0].n === 4 && del.after[0].n === 2, JSON.stringify({ add: add.error ?? add.after[0].n, remove: del.error ?? del.after[0].n })];
});

await checkAsync(checks, "view-no-leak", "correctness", "The project_overview view does not bypass RLS", async () => {
  need();
  const b = await as(U.bob, "select id from public.project_overview");
  const d = await as(U.dave, "select id from public.project_overview");
  const a = await as(null, "select id from public.project_overview");
  const bobOk = b.error ? true : same(ids(b.rows), [P.red]);
  const ok = bobOk && ids(d.rows).length === 0 && ids(a.rows).length === 0;
  return [ok, JSON.stringify({ bob: b.error ? "error" : ids(b.rows).length, dave: d.error ? "error" : ids(d.rows).length, anon: a.error ? "error" : ids(a.rows).length })];
});

await checkAsync(checks, "definer-functions-safe", "correctness", "No SECURITY DEFINER function in the exposed public schema; each pins search_path", async () => {
  need();
  const r = await db.query(`select n.nspname || '.' || p.proname as fn, n.nspname = 'public' as exposed,
      coalesce(array_to_string(p.proconfig, ','), '') like '%search_path%' as pinned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'extensions')`);
  const bad = r.rows.filter((x) => x.exposed || !x.pinned).map((x) => `${x.fn}${x.exposed ? " (public)" : ""}${x.pinned ? "" : " (no search_path)"}`);
  return [bad.length === 0, bad.join(", ") || `${r.rows.length} definer functions, all fine`];
});

await checkAsync(checks, "uid-wrapped", "performance", "Policies call auth.uid() as (select auth.uid()), evaluated once per query", async () => {
  need();
  const r = await db.query(`select coalesce(qual, '') || ' ' || coalesce(with_check, '') as t from pg_policies where schemaname = 'public'`);
  const text = r.rows.map((x) => x.t).join("\n");
  const bare = (text.match(/auth\.uid\(\)/g) ?? []).length - (text.match(/SELECT auth\.uid\(\)/g) ?? []).length;
  return [r.rows.length > 0 && bare === 0, `${bare} bare auth.uid() calls in ${r.rows.length} policies`];
});

await checkAsync(checks, "member-lookup-index", "performance", "team_members has an index led by user_id for policy lookups", async () => {
  need();
  const r = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'team_members'`);
  const ok = r.rows.some((x) => /\(\s*user_id\b/.test(x.indexdef));
  return [ok, r.rows.map((x) => x.indexdef.replace(/^.* USING /, "")).join("; ")];
});

report("supabase-rls", checks);
