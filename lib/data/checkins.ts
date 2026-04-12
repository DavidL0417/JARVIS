// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { CheckInApprovalListResponse } from "@/types"

export async function getPendingCheckInApprovals() {
  try {
    const response = await fetch("/api/checkin", { cache: "no-store" })

    if (response.status === 401) {
      return null
    }

    if (!response.ok) {
      console.warn(`Check-in approval request failed with status ${response.status}`)
      return null
    }

    const data = (await response.json()) as CheckInApprovalListResponse
    return data.items
  } catch (error) {
    console.warn("Failed to load check-in approvals", error)
    return null
  }
}

// ##### END BACKEND #####
