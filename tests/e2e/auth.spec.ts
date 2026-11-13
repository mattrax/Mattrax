import { expect, test } from "@playwright/test";
import { createTenant, register, gotoHydrated } from "./helpers";

test.describe("authentication and onboarding", () => {
  test("registers, lands on the dashboard, and creates a tenant", async ({ page }) => {
    await register(page, { name: "Onboard User" });
    await expect(page).toHaveURL(/\/tenants\/new/);
    await expect(page.getByRole("heading", { name: "Create tenant" })).toBeVisible();
    const suffix = Math.random().toString(36).slice(2, 8);
    await page.locator("input").first().fill("Onboard Tenant");
    await page.locator("input").nth(1).fill(`onboard-tenant-${suffix}`);
    await page
      .getByRole("button", { name: /create tenant/i })
      .last()
      .click();
    await expect(page).toHaveURL(/\/t\/[^/]+\/devices/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`/t/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Onboard Tenant" })).toBeVisible();
  });

  test("signs out and back in", async ({ page }) => {
    const { email } = await register(page);
    const tenant = await createTenant(page, "Session Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#email").fill(email);
    await page.locator("#password").fill("Correct-Horse-Battery-Staple-123!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/dashboard|\/t\//);
  });
});
