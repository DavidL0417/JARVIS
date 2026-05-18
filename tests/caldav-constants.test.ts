import { describe, expect, it } from "vitest"

import {
  APPLE_CALDAV_SERVER_URL,
  getCalDavServerDisplayName,
  isAppleCalDavServerUrl,
} from "@/lib/caldav/constants"

describe("CalDAV provider defaults", () => {
  it("recognizes Apple Calendar as the default CalDAV server", () => {
    expect(APPLE_CALDAV_SERVER_URL).toBe("https://caldav.icloud.com")
    expect(isAppleCalDavServerUrl("https://caldav.icloud.com")).toBe(true)
    expect(isAppleCalDavServerUrl("https://caldav.icloud.com/")).toBe(true)
    expect(getCalDavServerDisplayName("https://caldav.icloud.com/")).toBe("Apple Calendar")
  })

  it("keeps custom CalDAV servers visible by host", () => {
    expect(isAppleCalDavServerUrl("https://caldav.example.com")).toBe(false)
    expect(getCalDavServerDisplayName("https://caldav.example.com/users/david")).toBe("caldav.example.com")
  })
})
