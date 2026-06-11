# JARVIS

Production v1 secretary scheduler: authenticated Supabase state, migration-backed schema, DB-mirrored calendar events, layered durable memory, source refresh gates, approval-backed external writes, and a minimal command-deck UI.

## Current Source Of Truth

- Agent instructions: `AGENTS.md`
- Decision docs: `docs/decisions/`
- Database schema: `supabase/migrations/` (production reset plus follow-up migrations)
- `sql/schema.sql` is reference-only.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth and Postgres
- Claude API for secretary dialogue and schedule planning
- OpenAI API for source extraction and helper classification
- Google Calendar sync into the Supabase mirror
- Hourly Vercel Cron source refresh through `/api/cron/source-refresh`

## Environment

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_DIALOGUE_MODEL=claude-sonnet-4-6
CRON_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
```

## Development

```bash
pnpm install
pnpm dev
```

Verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Supabase

The public schema uses RLS on every public table. OAuth tokens live in `app_private.integration_tokens`, not public integration metadata.

Apply migrations through Supabase CLI or the connected Supabase project tooling. Do not hand-edit production schema outside migrations.

Auth is Google OAuth through Supabase SSR cookies. Set Supabase Auth Site URL to the production app URL and allow `/auth/callback` for production, localhost, and any Vercel preview URLs you intend to test. The sign-in client builds `redirectTo` from `window.location.origin`, so a browser that starts on `http://localhost:3001` must be allowed to return to `http://localhost:3001/auth/callback`, while production returns to `https://mydearestjarvis.vercel.app/auth/callback`.

Recommended Supabase Auth URL Configuration:

- Site URL: `https://mydearestjarvis.vercel.app`
- Redirect URLs: `https://mydearestjarvis.vercel.app/auth/callback`, `http://localhost:3000/**`, `http://localhost:3001/**`, `http://localhost:3002/**`, `http://localhost:3003/**`

For Vercel previews, Supabase supports wildcard allow-list entries such as `https://*-<team-or-account-slug>.vercel.app/**`; the callback must return to the same browser origin that started the PKCE flow.
Enable both Google Calendar API and Gmail API on the Google Cloud project behind `GOOGLE_CLIENT_ID`; OAuth can succeed even while Gmail API calls are blocked at the project level.

Notion source intake uses a public Notion connection. Add `http://localhost:3000/api/integrations/notion/callback` as a redirect URI for local development, add the production equivalent for deploys, then copy the connection's OAuth client ID and secret into `.env.local`.

Set `CRON_SECRET` in Vercel and locally before using the hourly source refresh route. Vercel sends it as `Authorization: Bearer <CRON_SECRET>` for the configured cron path.
