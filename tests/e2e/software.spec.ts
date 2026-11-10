import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("software inventory and device security", () => {
  test("shows the tenant software inventory and scopes API results", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Software Tenant");

    await gotoHydrated(page, `/t/${tenant.id}/software`);
    await expect(page.getByRole("heading", { name: "Software", exact: true })).toBeVisible();
    await expect(page.getByText("No software reported")).toBeVisible();
    await expect(page.getByRole("button", { name: "Managed", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Updates available" })).toBeVisible();

    const inventory = await api<{ applications: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/applications/inventory`,
    );
    expect(inventory).toEqual({ applications: [], total: 0 });

    // A search with no matches is still tenant-scoped and well-formed.
    const search = await api<{ applications: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/applications/inventory?q=safari&managed=managed`,
    );
    expect(search).toEqual({ applications: [], total: 0 });

    // Security endpoints reject unknown devices rather than leaking existence.
    const missing = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/recovery-key`,
    );
    expect(missing.status()).toBe(404);
  });
});
