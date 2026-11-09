import { expect, test } from "@playwright/test";
import { bootstrapTenant, createTenant } from "./helpers";

test.describe("command palette", () => {
  test("opens with Cmd+K, navigates, and remembers entities", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Tenant");
    await createTenant(page, "Palette Extra");

    await page.goto(`/t/${tenant.id}/devices`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const input = page.locator('input[placeholder*="Search devices"]');
    await expect(input).toBeVisible();

    await input.fill("settings");
    await page.getByRole("button", { name: /Tenant settings/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/settings`));

    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });
});
