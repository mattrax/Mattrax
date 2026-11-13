import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("software inventory and device security", () => {
  test("shows the tenant software inventory and scopes API results", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Software Tenant");

    // The old Software destination now points at dashboards; inventory is a
    // projection an administrator can render as a table widget.
    await gotoHydrated(page, `/t/${tenant.id}/software`);
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/dashboards$`));
    await expect(page.getByRole("heading", { name: "Dashboards", exact: true })).toBeVisible();

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
