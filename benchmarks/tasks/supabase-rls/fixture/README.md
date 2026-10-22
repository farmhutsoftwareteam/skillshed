# Teamboard

Small team project tracker on Supabase. The web client talks to the database
through supabase-js (the Data API), so anything the `anon` and `authenticated`
roles can reach is reachable from the browser.

Schema lives in `supabase/migrations/`. Add new changes as new migration files.
