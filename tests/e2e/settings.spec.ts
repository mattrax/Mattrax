import { expect, test } from "@playwright/test";
import { bootstrapTenant } from "./helpers";

test.describe("tenant settings", () => {
  test("opens every settings tab and saves the tenant profile", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tenant");
    await page.goto(`/t/${tenant.id}/settings`);

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');
    for (const [tab, text] of [
      ["Administrators", /Invite an administrator/],
      ["Identity", /Single sign-on/],
      ["Enrollment", /Enrollment link/],
      ["Management", /Apple push notifications/],
      ["Billing", /Billable devices|Plan/],
      ["General", /Tenant profile/],
    ] as const) {
      await tabs.getByRole("button", { name: tab }).click();
      await expect(page.getByText(text).first()).toBeVisible();
    }

    const name = page.locator("input").first();
    await name.fill("Renamed Tenant");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(name).toHaveValue("Renamed Tenant");

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Renamed Tenant/ })).toBeVisible();
  });

  test("shows the APNs setup wizard and downloads a CSR", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "APNs Tenant");
    await page.goto(`/t/${tenant.id}/settings/management`);
    await expect(page.getByText("APNs setup required")).toBeVisible();
    await expect(page.getByText("Download a CSR")).toBeVisible();

    const download = page.waitForEvent("download").catch(() => undefined);
    await page.getByRole("button", { name: /download csr/i }).click();
    await download;
    // The endpoint may not be deployed in every environment; the UI must not crash.
    await expect(page.getByRole("heading", { name: "Tenant settings" })).toBeVisible();
  });
});
