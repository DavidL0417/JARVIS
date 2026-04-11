import { z } from "zod"

import { userPreferencesSchema } from "@/schemas/common"

export const onboardingRequestSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  preferences: userPreferencesSchema.optional(),
})

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>
