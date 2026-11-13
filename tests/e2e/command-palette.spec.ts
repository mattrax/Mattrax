import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, createTenant, gotoHydrated } from "./helpers";

test.describe("command palette", () => {
  test("opens with Cmd+K, navigates, and remembers entities", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Tenant");
    await createTenant(page, "Palette Extra");

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    // The global shortcut is registered from `onSettled`, which runs after the
    // first router transition settles — slightly after the hydration flag.
    await page.waitForTimeout(1000);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const input = page.locator('input[placeholder*="Search devices"]');
    await expect(input).toBeVisible();

    await input.fill("settings");
    await page.getByRole("option", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/settings`));

    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Quarterly Ops" }),
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(input).toBeVisible();
    await input.fill("Quarterly");
    // Entity results come from the server search endpoint after the debounce.
    await expect(page.getByRole("option", { name: /Quarterly Ops/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });
});
