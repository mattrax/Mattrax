import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("identity directory pages", () => {
  test("shows SSO, directory sync and domain subpages", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Identity Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/identity`);
    await expect(page.getByText("Single sign-on", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Directory sync" }).click();
    await expect(page.getByText("Microsoft Entra directory sync")).toBeVisible();
    await expect(page.getByText("Connect Microsoft Graph")).toBeVisible();
    await expect(page.getByText("Connect Google Workspace")).toBeVisible();
    // This deployment has no Graph app or Google credentials, so the schedule
    // and manual sync controls stay hidden until setup is complete.
    await expect(page.getByLabel("Automatic sync")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Configure credentials" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Google Admin" })).toBeVisible();

    await page.getByRole("link", { name: "Domains" }).click();
    await expect(page.getByText("Verified domains", { exact: true })).toBeVisible();
    await expect(page.getByText(/No verified domains yet/)).toBeVisible();
  });
});
