// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { DashboardResponse } from "@/types"

export async function getDashboardData(): Promise<DashboardResponse | null> {
  try {
    // TODO: If this moves to a server-only call path, switch to an absolute URL or direct data access.
    const response = await fetch("/api/dashboard")

    if (!response.ok) {
      console.error(`Dashboard request failed with status ${response.status}`)
      return null
    }

    const data: DashboardResponse = await response.json()
    return data
  } catch (error) {
    console.error("Failed to load dashboard data", error)
    return null
  }
}

// ##### END BACKEND #####
