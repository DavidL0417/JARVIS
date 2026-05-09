import { expect, test } from "@playwright/test"

test("first paint is honest about auth or backend state", async ({ page }) => {
  await page.goto("/")

  await expect(
    page.getByText(/JARVIS|Sign in|Backend unavailable|Loading/).first(),
  ).toBeVisible()

  await expect(page.getByText(/demo task|API Hook|fake workspace/i)).toHaveCount(0)
})

test("waitlist form submits and renders the success state", async ({ page }) => {
  await page.route("**/api/waitlist", async (route) => {
    const request = route.request()
    expect(request.method()).toBe("POST")
    expect(request.postDataJSON()).toMatchObject({ email: "new.user@example.edu" })

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: "added" }),
    })
  })

  await page.goto("/")
  await page.getByLabel("School email").first().fill("New.User@Example.edu")
  await page.getByRole("button", { name: "Join waitlist" }).first().click()

  await expect(page.getByRole("status")).toContainText("You're on the list")
})
