import { expect, test } from "@playwright/test";
import { gotoHydrated, register } from "./helpers";

test.describe("passwordless sign-in", () => {
  test("requests an email code and signs in with it", async ({ page }) => {
    const { email } = await register(page, { name: "Passwordless User" });
    await page.context().clearCookies();

    await gotoHydrated(page, "/login");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /email me a sign-in code instead/i }).click();
    await page.getByRole("button", { name: /email me a sign-in code$/i }).click();

    await expect(page.locator("#code")).toBeVisible({ timeout: 20_000 });

    let code = "";
    await expect
      .poll(
        async () => {
          const response = await page.request.get("/api/debug/emails");
          if (!response.ok()) return "";
          const messages = (await response.json()) as Array<{ to: string; text: string }>;
          const latest = messages.find((message) => message.to === email);
          code = latest?.text.match(/code is (\d+)/)?.[1] ?? "";
          return code;
        },
        { timeout: 20_000 },
      )
      .not.toBe("");

    await page.locator("#code").fill(code);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /tenant|create tenant|devices/i })).toBeVisible({
      timeout: 20_000,
    });
  });
});
