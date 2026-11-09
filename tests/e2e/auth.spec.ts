import { expect, test } from "@playwright/test";
import { createTenant, register } from "./helpers";

test.describe("authentication and onboarding", () => {
  test("registers, lands on the dashboard, and creates a tenant", async ({ page }) => {
    const { email } = await register(page, { name: "Onboard User" });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("No tenant yet")).toBeVisible();

    await page
      .getByRole("button", { name: /create tenant/i })
      .first()
      .click();
    await page.waitForURL(/\/tenants\/new/);
    const suffix = Math.random().toString(36).slice(2, 8);
    await page.locator("input").first().fill("Onboard Tenant");
    await page.locator("input").nth(1).fill(`onboard-tenant-${suffix}`);
    await page
      .getByRole("button", { name: /create tenant/i })
      .last()
      .click();
    await expect(page).toHaveURL(/\/t\/[^/]+\/devices/);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Onboard Tenant/ })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("signs out and back in", async ({ page }) => {
    const { email } = await register(page);
    const tenant = await createTenant(page, "Session Tenant");
    await page.goto(`/t/${tenant.id}/devices`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    await page.locator("[data-slot=sidebar-footer] [data-slot=dropdown-menu-trigger]").click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill("Correct-Horse-Battery-Staple-123!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/dashboard|\/t\//);
  });
});
