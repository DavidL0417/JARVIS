import { fetchNotionJson, type NotionPageResult, type NotionPropertyValue } from "@/lib/notion"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import type { TaskRow } from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

export interface NotionExternalWriteResult {
  source: "notion"
  status: "completed" | "reopened" | "failed" | "skipped"
  summary: string
  error?: string | null
}

// The completion checkbox the read-side (isCompletedPage) keys off — match by the
// same name heuristic so write-back targets the property the user actually uses.
function findCompletionCheckbox(properties: Record<string, NotionPropertyValue> | undefined): string | null {
  if (!properties) {
    return null
  }
  for (const [name, property] of Object.entries(properties)) {
    if (property.type === "checkbox" && /(done|complete|completed|finished)/i.test(name)) {
      return name
    }
  }
  return null
}

/**
 * Write-back (JARVIS -> Notion): when a Notion-linked task is completed or
 * reopened in JARVIS, flip its Notion page's completion checkbox so Notion stays
 * in sync. Best-effort — it never throws into the task update, and records the
 * outcome in change_logs for the audit trail (the task-mutation response's
 * externalWrite contract is Canvas-shaped, so this stays a side effect).
 */
export async function syncNotionTaskCompletion(input: {
  adminClient: AdminClient
  userId: string
  task: TaskRow
  completed: boolean
}): Promise<NotionExternalWriteResult | null> {
  const { task } = input

  if (task.last_synced_from !== "notion" || !task.external_task_id) {
    return null
  }

  const pageId = task.external_task_id

  try {
    const token = await getStoredIntegrationToken(input.userId, "notion")

    if (!token?.access_token) {
      return { source: "notion", status: "skipped", summary: "Notion is not connected." }
    }

    const page = await fetchNotionJson<NotionPageResult>(
      token.access_token,
      `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
    )
    const checkboxName = findCompletionCheckbox(page.properties)

    if (!checkboxName) {
      return { source: "notion", status: "skipped", summary: "No completion checkbox on the Notion page." }
    }

    await fetchNotionJson(token.access_token, `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: { [checkboxName]: { checkbox: input.completed } } }),
    })

    await input.adminClient.from("change_logs").insert({
      user_id: input.userId,
      actor: "assistant",
      action: input.completed ? "external.notion.complete" : "external.notion.reopen",
      target_table: "tasks",
      target_id: task.id,
      summary: `${input.completed ? "Checked" : "Unchecked"} "${checkboxName}" in Notion for ${task.title}.`,
      before_value: null,
      after_value: { notionPageId: pageId, checkbox: checkboxName, value: input.completed },
      source_label: "notion",
    })

    return {
      source: "notion",
      status: input.completed ? "completed" : "reopened",
      summary: `Notion page ${input.completed ? "marked complete" : "reopened"}.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notion completion sync failed."

    await input.adminClient.from("change_logs").insert({
      user_id: input.userId,
      actor: "assistant",
      action: "external.notion.complete_failed",
      target_table: "tasks",
      target_id: task.id,
      summary: `Notion completion sync failed for ${task.title}: ${message}`,
      before_value: null,
      after_value: { notionPageId: pageId, error: message },
      source_label: "notion",
    })

    return { source: "notion", status: "failed", summary: "Notion completion sync failed.", error: message }
  }
}
