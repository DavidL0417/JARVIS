import { z } from "zod"

// Shape the Apple Shortcut POSTs: a full snapshot of incomplete reminders.
// Kept lenient (no per-item rejection) — empty-title items are filtered server-side.
export const appleReminderItemSchema = z.object({
  title: z.string().max(1000).default(""),
  notes: z.string().max(10000).nullish(),
  dueDate: z.string().max(100).nullish(),
  priority: z.union([z.string().max(40), z.number()]).nullish(),
  list: z.string().max(300).nullish(),
  allDay: z.boolean().nullish(),
})

export const appleRemindersIngestRequestSchema = z.object({
  reminders: z.array(appleReminderItemSchema).max(5000),
})

export type AppleReminderItem = z.infer<typeof appleReminderItemSchema>
export type AppleRemindersIngestRequest = z.infer<typeof appleRemindersIngestRequestSchema>
