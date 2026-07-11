# Stratego

Free-to-host, two-player, full-rules online Stratego. See
`docs/superpowers/specs/2026-07-10-stratego-design.md` for the design and
`docs/superpowers/plans/2026-07-10-stratego-implementation.md` for how it
was built.

Repo: https://github.com/AndrewIgdal17/PMStratego.git

## Local development

**Rules engine tests** (no external dependencies):

```bash
npm test
```

**Supabase backend** (requires Docker Desktop running, and the Supabase CLI
via `npx`):

```bash
npx supabase start      # first time: pulls images, prints local API URL/keys
npx supabase db reset   # applies supabase/migrations/
npx supabase functions serve --no-verify-jwt   # serves all Edge Functions locally
```

**Frontend** (any static file server works):

```bash
npx http-server web -p 8080
```

Before the frontend can talk to your local (or deployed) Supabase project,
fill in `web/js/supabaseClient.js` with the `SUPABASE_URL` and anon key
printed by `npx supabase status` (local) or found on the project's API
settings page (production).

## Deploying

**Supabase (one-time project setup, then on every schema/function change):**

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push          # applies migrations/
npx supabase functions deploy # deploys all functions in supabase/functions/
```

**Render (static frontend):**

1. Push this repo to GitHub.
2. In the Render dashboard, create a new Static Site from this repo (or run
   `render blueprint launch` if using the Render CLI) — `render.yaml` already
   specifies `./web` as the publish path with no build step.
3. Every push to the deployed branch auto-redeploys; there is no server
   process to spin down or wake up.

## Known operational note

Supabase free projects pause after 7 consecutive days with zero database
requests. Unpausing is a single click in the Supabase dashboard with no data
loss. If that becomes annoying for infrequent games, add a scheduled GitHub
Actions workflow that pings the REST API every few days — not implemented
here since it wasn't needed during initial build/test.
