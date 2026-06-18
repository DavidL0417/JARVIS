import { z } from "zod"

// accept → write the inferred by-when to the task's real deadline (and clear the
// suggestion). dismiss → "Keep undated": clear the suggestion and stop suggesting.
export const inferredDeadlineDecisionSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
})

export type InferredDeadlineDecision = z.infer<typeof inferredDeadlineDecisionSchema>
