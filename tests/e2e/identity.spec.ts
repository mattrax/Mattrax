import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("identity directory pages", () => {
  test("shows SSO, directory sync and domain subpages", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Identity Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/identity`);
    await expect(page.getByText("Single sign-on", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Directory sync" }).click();
    await expect(page.getByText("Microsoft Entra directory sync")).toBeVisible();
    await expect(page.getByText(/Graph (not )?configured/)).toBeVisible();
    // The directory-sync page has an Entra panel and a Google Workspace panel,
    // each with its own automatic-sync control and Sync now button. Entra is
    // first; the Google panel is covered by its own settings tests.
    await expect(page.getByLabel("Automatic sync").first()).toBeVisible();
    await expect(page.getByLabel("Automatic sync").first()).toHaveValue("0");
    await expect(page.getByRole("button", { name: "Sync now" }).first()).toBeVisible();

    await page.getByRole("link", { name: "Domains" }).click();
    await expect(page.getByText("Verified domains", { exact: true })).toBeVisible();
    await expect(page.getByText(/No verified domains yet/)).toBeVisible();
  });
});
