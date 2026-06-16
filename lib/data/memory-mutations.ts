import type { MemoryImportance } from "@/types"

export interface MemoryEditPatch {
  insight?: string
  importance?: MemoryImportance
  importanceNote?: string | null
}

export interface MemoryUpdateFields {
  updated_at: string
  content?: string
  source_label?: string
  importance?: MemoryImportance
  importance_note?: string | null
}

// Builds the memory_items column update for an edit. The provenance rule lives here:
// `source_label` is only re-stamped to "user_edit" when the note's text actually
// changes — an importance-only tweak must not relabel where the memory came from.
export function buildMemoryUpdate(patch: MemoryEditPatch, timestamp: string): MemoryUpdateFields {
  const update: MemoryUpdateFields = { updated_at: timestamp }

  if (patch.insight !== undefined) {
    update.content = patch.insight
    update.source_label = "user_edit"
  }
  if (patch.importance !== undefined) {
    update.importance = patch.importance
  }
  if (patch.importanceNote !== undefined) {
    update.importance_note = patch.importanceNote
  }

  return update
}
