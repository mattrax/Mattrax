import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("entity table filters", () => {
  test("filters groups from a shareable URL query", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Entity Filter Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Alpha Ops" }),
    });

    await gotoHydrated(
      page,
      `/t/${tenant.id}/groups?query=${encodeURIComponent("name contains alpha")}`,
    );
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toBeVisible();
    await expect(page.locator('select[aria-label="Filter field"]')).toHaveCount(1);
    await expect(page.locator('input[aria-label="Filter value"]')).toHaveValue("alpha");

    await gotoHydrated(
      page,
      `/t/${tenant.id}/groups?query=${encodeURIComponent("name contains missing")}`,
    );
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toHaveCount(0);
  });
});
