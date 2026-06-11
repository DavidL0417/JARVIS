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
const canvasAccessTokenMigration = readFileSync(
  "supabase/migrations/20260516032701_canvas_access_token_integration.sql",
  "utf8",
)
const canvasExtensionMigration = readFileSync(
  "supabase/migrations/20260518033729_canvas_extension_reader.sql",
  "utf8",
)
const canvasExtensionControlPlaneMigration = readFileSync(
  "supabase/migrations/20260518191000_canvas_extension_control_plane.sql",
  "utf8",
)
const canvasExtensionCommandEventsMigration = readFileSync(
  "supabase/migrations/20260519180734_canvas_extension_command_events.sql",
  "utf8",
)
const caldavProviderContractMigration = readFileSync(
  "supabase/migrations/20260528012138_caldav_provider_contract.sql",
  "utf8",
)
const canvasExtensionPagePreviewsMigration = readFileSync(
  "supabase/migrations/20260528062929_canvas_extension_page_previews.sql",
  "utf8",
)
const canvasExtensionPageContentMigration = readFileSync(
  "supabase/migrations/20260528120000_canvas_extension_page_content.sql",
  "utf8",
)
const canvasExtensionSyncCourseMigration = readFileSync(
  "supabase/migrations/20260528130000_canvas_extension_sync_course.sql",
  "utf8",
)
const caldavConnectorSettingsMigration = readFileSync(
  "supabase/migrations/20260518034200_caldav_connector_settings.sql",
  "utf8",
)
const repairIntegrationProviderChecksMigration = readFileSync(
  "supabase/migrations/20260518194828_repair_integration_provider_checks.sql",
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

    expect(caldavConnectorSettingsMigration).toContain("alter table public.connector_settings enable row level security;")
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

  it("allows Canvas as a private token-backed source without exposing tokens", () => {
    expect(canvasAccessTokenMigration).toContain("check (provider in ('google', 'notion', 'canvas'))")
    expect(canvasAccessTokenMigration).toContain("'manual', 'system', 'canvas'")
    expect(canvasAccessTokenMigration).toContain("token_provider in ('google', 'notion', 'canvas')")
    expect(canvasAccessTokenMigration).toContain("revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;")
    expect(canvasAccessTokenMigration).not.toContain("disable row level security")
  })

  it("allows CalDAV integration metadata without exposing private tokens", () => {
    expect(caldavProviderContractMigration).toContain("check (provider in ('google', 'notion', 'canvas', 'caldav'))")
    expect(caldavProviderContractMigration).toContain("token_provider in ('google', 'notion', 'canvas', 'caldav')")
    expect(caldavProviderContractMigration).toContain("revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;")
    expect(caldavProviderContractMigration).not.toContain("disable row level security")
  })

  it("adds CalDAV and connector enablement without exposing private tokens", () => {
    expect(caldavConnectorSettingsMigration).toContain("check (provider in ('google', 'notion', 'canvas', 'caldav'))")
    expect(caldavConnectorSettingsMigration).toContain("source in ('local', 'google', 'caldav', 'imported', 'task')")
    expect(caldavConnectorSettingsMigration).toContain("last_synced_from in ('local', 'gcal', 'caldav')")
    expect(caldavConnectorSettingsMigration).toContain("create table public.connector_settings")
    expect(caldavConnectorSettingsMigration).toContain("alter table public.connector_settings enable row level security;")
    expect(caldavConnectorSettingsMigration).toContain("revoke all on public.connector_settings from anon, authenticated;")
    expect(caldavConnectorSettingsMigration).toContain("token_provider in ('google', 'notion', 'canvas', 'caldav')")
    expect(caldavConnectorSettingsMigration).toContain("revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;")
    expect(caldavConnectorSettingsMigration).not.toContain("disable row level security")
  })

  it("repairs stale provider checks for CalDAV without reopening token access", () => {
    expect(repairIntegrationProviderChecksMigration).toContain("'public.integrations'::regclass")
    expect(repairIntegrationProviderChecksMigration).toContain("'app_private.integration_tokens'::regclass")
    expect(repairIntegrationProviderChecksMigration).toContain("pg_get_constraintdef(c.oid) ilike '%provider%'")
    expect(repairIntegrationProviderChecksMigration).toContain("check (provider in ('google', 'notion', 'canvas', 'caldav'))")
    expect(repairIntegrationProviderChecksMigration).toContain("token_provider in ('google', 'notion', 'canvas', 'caldav')")
    expect(repairIntegrationProviderChecksMigration).toContain("revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;")
    expect(repairIntegrationProviderChecksMigration).not.toContain("disable row level security")
  })

  it("stores Canvas extension pairing data in private service-role-only tables", () => {
    expect(canvasExtensionMigration).toContain("create table if not exists app_private.canvas_extension_pairing_codes")
    expect(canvasExtensionMigration).toContain("create table if not exists app_private.canvas_extension_tokens")
    expect(canvasExtensionMigration).toContain("alter table app_private.canvas_extension_tokens enable row level security")
    expect(canvasExtensionMigration).toContain("revoke all on app_private.canvas_extension_tokens from public, anon, authenticated")
    expect(canvasExtensionMigration).toContain("grant select, insert, update, delete on app_private.canvas_extension_tokens to service_role")
    expect(canvasExtensionMigration).toContain("create or replace function public.consume_canvas_extension_pairing_code")
    expect(canvasExtensionMigration).toContain("grant execute on function public.get_canvas_extension_token(text) to service_role")
  })

  it("stores Canvas extension control-plane metadata with RLS and no credentials", () => {
    expect(canvasExtensionControlPlaneMigration).toContain("create table public.canvas_extension_sessions")
    expect(canvasExtensionControlPlaneMigration).toContain("create table public.canvas_extension_commands")
    expect(canvasExtensionControlPlaneMigration).toContain("create table public.canvas_extension_nodes")
    expect(canvasExtensionControlPlaneMigration).toContain("create table public.canvas_extension_command_events")
    expect(canvasExtensionCommandEventsMigration).toContain("create table if not exists public.canvas_extension_command_events")
    expect(canvasExtensionControlPlaneMigration).toContain("alter table public.canvas_extension_sessions enable row level security")
    expect(canvasExtensionControlPlaneMigration).toContain("alter table public.canvas_extension_commands enable row level security")
    expect(canvasExtensionControlPlaneMigration).toContain("alter table public.canvas_extension_nodes enable row level security")
    expect(canvasExtensionControlPlaneMigration).toContain("alter table public.canvas_extension_command_events enable row level security")
    expect(canvasExtensionCommandEventsMigration).toContain("alter table public.canvas_extension_command_events enable row level security")
    expect(canvasExtensionControlPlaneMigration).toContain("canvas_extension_nodes_select_own")
    expect(canvasExtensionControlPlaneMigration).toContain("canvas_extension_command_events_select_own")
    expect(canvasExtensionCommandEventsMigration).toContain("canvas_extension_command_events_select_own")
    expect(canvasExtensionControlPlaneMigration).not.toContain("access_token")
    expect(canvasExtensionControlPlaneMigration).not.toContain("refresh_token")
    expect(canvasExtensionCommandEventsMigration).not.toContain("access_token")
    expect(canvasExtensionCommandEventsMigration).not.toContain("refresh_token")
  })

  it("allows Canvas preview-link capture commands without storing executable page archives", () => {
    expect(canvasExtensionPagePreviewsMigration).toContain("'capture_url'")
    expect(canvasExtensionPagePreviewsMigration).toContain("sanitized inert page previews")
    expect(canvasExtensionPagePreviewsMigration).toContain("must never contain credentials")
    expect(canvasExtensionPagePreviewsMigration).not.toContain("disable row level security")
    expect(canvasExtensionPagePreviewsMigration).not.toContain("raw MHTML")
    expect(canvasExtensionPagePreviewsMigration).not.toContain("access_token")
    expect(canvasExtensionPagePreviewsMigration).not.toContain("refresh_token")
  })

  it("allows the sync_course command type for full-course content pulls", () => {
    expect(canvasExtensionSyncCourseMigration).toContain("'sync_course'")
    expect(canvasExtensionSyncCourseMigration).toContain("canvas_extension_commands_type_check")
    expect(canvasExtensionSyncCourseMigration).not.toContain("disable row level security")
  })

  it("stores Canvas extension page markdown content with RLS and no credentials", () => {
    expect(canvasExtensionPageContentMigration).toContain("create table public.canvas_extension_page_content")
    expect(canvasExtensionPageContentMigration).toContain("content_markdown text not null")
    expect(canvasExtensionPageContentMigration).toContain(
      "alter table public.canvas_extension_page_content enable row level security",
    )
    expect(canvasExtensionPageContentMigration).toContain("canvas_extension_page_content_select_own")
    expect(canvasExtensionPageContentMigration).toContain("must never contain credentials")
    expect(canvasExtensionPageContentMigration).not.toContain("disable row level security")
    expect(canvasExtensionPageContentMigration).not.toContain("access_token")
    expect(canvasExtensionPageContentMigration).not.toContain("refresh_token")
  })
})
