import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync("supabase/migrations/20260505031630_production_reset.sql", "utf8")
const accessBoundaryMigration = readFileSync(
  "supabase/migrations/20260506031946_restrict_public_data_api_grants.sql",
  "utf8",
)
const googleTokenRpcMigration = readFileSync(
  "supabase/migrations/20260506042431_service_role_google_token_rpc.sql",
  "utf8",
)
const dailyCommandDeckMigration = readFileSync(
  "supabase/migrations/20260508011003_daily_command_deck_context.sql",
  "utf8",
)
const notionAuthoritativeSourceMigration = readFileSync(
  "supabase/migrations/20260508231116_notion_authoritative_source.sql",
  "utf8",
)
const explicitDenyPoliciesMigration = readFileSync(
  "supabase/migrations/20260509170508_explicit_waitlist_deny_policies.sql",
  "utf8",
)
const universalAssistantMigration = readFileSync(
  "supabase/migrations/20260514183328_universal_assistant_orchestrator.sql",
  "utf8",
)

describe("production Supabase migration", () => {
  it("keeps OAuth tokens outside public tables", () => {
    expect(migration).toContain("create schema if not exists app_private")
    expect(migration).toContain("create table app_private.integration_tokens")
    expect(migration).toContain("revoke all on schema app_private from anon, authenticated")
  })

  it("enables RLS on every public production table", () => {
    for (const table of [
      "profiles",
      "preferences",
      "calendars",
      "tasks",
      "schedule_events",
      "checkins",
      "integrations",
      "assistant_threads",
      "assistant_messages",
      "assistant_tool_runs",
      "memory_items",
      "source_snapshots",
      "change_logs",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`)
    }

    for (const table of ["source_files", "source_candidates", "daily_plans"]) {
      expect(dailyCommandDeckMigration).toContain(`alter table public.${table} enable row level security;`)
    }
  })

  it("keeps browser clients behind backend routes instead of direct table grants", () => {
    expect(accessBoundaryMigration).toContain("revoke all privileges on all tables in schema public from anon;")
    expect(accessBoundaryMigration).toContain("revoke all privileges on all tables in schema public from authenticated;")
  })

  it("keeps private Google tokens behind service-role-only RPC wrappers", () => {
    expect(googleTokenRpcMigration).toContain("app_private.integration_tokens")
    expect(googleTokenRpcMigration).not.toContain("security definer")
    expect(googleTokenRpcMigration).toContain(
      "revoke all on function public.get_google_integration_token(uuid) from public, anon, authenticated;",
    )
    expect(googleTokenRpcMigration).toContain(
      "grant execute on function public.upsert_google_integration_token(uuid, text, text, timestamptz, text) to service_role;",
    )
  })

  it("stores source originals privately and exposes only user-owned metadata", () => {
    expect(dailyCommandDeckMigration).toContain("insert into storage.buckets")
    expect(dailyCommandDeckMigration).toContain("'source-originals'")
    expect(dailyCommandDeckMigration).toContain("public = false")
    expect(dailyCommandDeckMigration).toContain("create policy source_originals_select_own on storage.objects")
    expect(dailyCommandDeckMigration).toContain("create table public.source_candidates")
    expect(dailyCommandDeckMigration).toContain("create table public.daily_plans")
  })

  it("allows Notion tokens without exposing the private token table", () => {
    expect(dailyCommandDeckMigration).toContain("check (provider in ('google', 'notion'))")
    expect(dailyCommandDeckMigration).toContain("revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;")
    expect(dailyCommandDeckMigration).toContain("grant execute on function public.upsert_integration_token(uuid, text, text, text, timestamptz, text) to service_role;")
  })

  it("stores the authoritative Notion source without exposing tokens", () => {
    expect(notionAuthoritativeSourceMigration).toContain("add column if not exists selected_source_id text")
    expect(notionAuthoritativeSourceMigration).toContain("add column if not exists selected_source_name text")
    expect(notionAuthoritativeSourceMigration).not.toContain("access_token")
    expect(notionAuthoritativeSourceMigration).not.toContain("refresh_token")
  })

  it("keeps public waitlist and private token tables explicitly closed to browser roles", () => {
    expect(explicitDenyPoliciesMigration).toContain("create policy waitlist_deny_anon_authenticated")
    expect(explicitDenyPoliciesMigration).toContain("on public.waitlist")
    expect(explicitDenyPoliciesMigration).toContain("to anon, authenticated")
    expect(explicitDenyPoliciesMigration).toContain("create policy integration_tokens_deny_anon_authenticated")
    expect(explicitDenyPoliciesMigration).toContain("on app_private.integration_tokens")
  })

  it("adds layered memory fields without weakening RLS or private token boundaries", () => {
    expect(universalAssistantMigration).toContain("alter table public.memory_items")
    expect(universalAssistantMigration).toContain("add column if not exists layer text")
    expect(universalAssistantMigration).toContain("add column if not exists payload jsonb")
    expect(universalAssistantMigration).toContain("memory_items_layer_check")
    expect(universalAssistantMigration).toContain("'operating_rules'")
    expect(universalAssistantMigration).toContain("'candidate_memories'")
    expect(universalAssistantMigration).not.toContain("disable row level security")
    expect(universalAssistantMigration).not.toContain("app_private.integration_tokens")
  })

  it("extends assistant approvals for resumable execution and cancellation", () => {
    expect(universalAssistantMigration).toContain("add column if not exists approved_at timestamptz")
    expect(universalAssistantMigration).toContain("add column if not exists executed_at timestamptz")
    expect(universalAssistantMigration).toContain("add column if not exists cancelled_at timestamptz")
    expect(universalAssistantMigration).toContain("add column if not exists error_message text")
    expect(universalAssistantMigration).toContain("'cancelled'")
    expect(universalAssistantMigration).toContain("Pending approvals store the executable action plan")
  })
})
