import { expect, test } from "@playwright/test";
import { bootstrapTenant } from "./helpers";

test.describe("account", () => {
  test("updates the profile and manages API tokens", async ({ page }) => {
    await bootstrapTenant(page, "Account Tenant");
    await page.goto("/account", { waitUntil: "networkidle" });

    const name = page.locator("#name");
    await name.fill("Renamed User");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Name updated successfully.")).toBeVisible();

    await page.locator("#token-name").fill("E2E token");
    await page.getByRole("button", { name: /create token/i }).click();
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await expect(page.getByText("E2E token").first()).toBeVisible();

    await page.getByRole("button", { name: /revoke/i }).first().click();
    await expect(page.getByText("Revoked").first()).toBeVisible();
  });
});
