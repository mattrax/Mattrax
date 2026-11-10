import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("identity directory pages", () => {
  test("shows SSO, directory sync and domain subpages", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Identity Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/identity`);
    await expect(page.getByText("Single sign-on", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Directory sync" }).click();
    await expect(page.getByText("Microsoft Entra directory sync")).toBeVisible();
    await expect(page.getByText(/Graph (not )?configured/)).toBeVisible();

    await page.getByRole("button", { name: "Domains" }).click();
    await expect(page.getByText("Verified domains", { exact: true })).toBeVisible();
    await expect(page.getByText(/No verified domains yet/)).toBeVisible();
  });
});
