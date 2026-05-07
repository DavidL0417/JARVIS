# JARVIS

Production v1 secretary scheduler: authenticated Supabase state, migration-backed schema, DB-mirrored calendar events, durable memory, and a minimal command-deck UI.

## Current Source Of Truth

- Agent instructions: `AGENTS.md`
- Decision docs: `docs/decisions/`
- Database schema: `supabase/migrations/20260505031630_production_reset.sql`
- `sql/schema.sql` is reference-only.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth and Postgres
- OpenAI API for secretary dialogue and scheduling
- Google Calendar sync into the Supabase mirror

## Environment

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
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

Auth is Google OAuth through Supabase SSR cookies. Set Supabase Auth Site URL to the production app URL and allow `/auth/callback` for production, localhost, and any Vercel preview URLs you intend to test.
