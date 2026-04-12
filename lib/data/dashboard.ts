// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { DashboardResponse } from "@/types"

export async function getDashboardData(): Promise<DashboardResponse | null> {
  try {
    // TODO: If this moves to a server-only call path, switch to an absolute URL or direct data access.
    const response = await fetch("/api/dashboard", { cache: "no-store" })

    if (response.status === 401) {
      return null
    }

    if (!response.ok) {
      console.warn(`Dashboard request failed with status ${response.status}`)
      return null
    }

    const data: DashboardResponse = await response.json()
    return data
  } catch (error) {
    console.warn("Failed to load dashboard data", error)
    return null
  }
}

// ##### END BACKEND #####
