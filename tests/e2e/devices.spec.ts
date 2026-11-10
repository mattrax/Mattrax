import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("device fleet management", () => {
  test("searches, filters and exports the device list", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Fleet Tenant");

    // The filter bar is rendered and paginates even with no devices.
    await expect(page.getByLabel("Filter by status")).toBeVisible();
    await expect(page.getByLabel("Filter by platform")).toBeVisible();
    await expect(page.getByLabel("Filter by group")).toBeVisible();
    await expect(page.getByLabel("Filter by last seen")).toBeVisible();
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
    await expect(page.getByRole("button", { name: /previous/i })).toBeDisabled();

    // The search endpoint is tenant-scoped and returns the agreed shape.
    const found = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?limit=10`,
    );
    expect(found).toEqual({ devices: [], total: 0 });

    // Filtering and sorting compile against MySQL even with no matching rows.
    const filtered = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?status=enrolled&proto=apple&staleDays=30&sort=lastSeenAt&direction=desc&limit=10&offset=0`,
    );
    expect(filtered).toEqual({ devices: [], total: 0 });

    // Group filters use a SQL subquery scoped to the tenant.
    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Field Ops" }),
    });
    const inGroup = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?groupId=${group.id}`,
    );
    expect(inGroup).toEqual({ devices: [], total: 0 });

    // A tenant id the caller cannot see is rejected rather than leaking rows.
    const missing = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/devices/search?limit=10",
    );
    expect(missing.status()).toBe(404);

    // Export responds with an attachment and RFC 4180 CSV.
    const response = await page.request.get(`/api/v1/tenants/${tenant.id}/devices/export`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(await response.text()).toBe(
      "Name,Serial,Model,Platform,Status,OS version,OS build,Last seen,Enrolled at,Asset tag,Model number,FileVault,Battery health,Capabilities,Inventory updated,Groups\r\n",
    );

    // The toolbar action downloads a dated CSV file.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    expect((await download).suggestedFilename()).toMatch(/^devices-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("shows the tenant health rollup and exposes device health", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Health Tenant");

    const summary = await api<{
      counts: {
        total: number;
        healthy: number;
        attention: number;
        critical: number;
        stale: number;
        unknown: number;
      };
    }>(page, `/api/v1/tenants/${tenant.id}/device-health`);
    expect(summary.counts).toEqual({
      total: 0,
      healthy: 0,
      attention: 0,
      critical: 0,
      stale: 0,
      unknown: 0,
    });

    await gotoHydrated(page, `/t/${tenant.id}`);
    await expect(page.getByRole("heading", { name: "Device health", exact: true })).toBeVisible();
    for (const label of ["Healthy", "Attention", "Critical", "Stale (7d)", "Unknown"])
      await expect(page.getByText(label, { exact: true })).toBeVisible();

    // Credential monitoring is tenant-scoped too.
    const credentials = await api<{
      apns: { configured: boolean; level: string };
      scepCa: { configured: boolean; level: string };
      deviceCertificates: { total: number };
    }>(page, `/api/v1/tenants/${tenant.id}/credential-health`);
    expect(credentials.apns).toMatchObject({ configured: false, level: "missing" });
    expect(credentials.scepCa.level).toMatch(/missing|ok/);
    expect(credentials.deviceCertificates.total).toBe(0);
    await expect(page.getByRole("heading", { name: "Credentials", exact: true })).toBeVisible();
    const missingCredentials = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/credential-health",
    );
    expect(missingCredentials.status()).toBe(404);

    // A tenant the caller cannot see is rejected rather than leaking counts.
    const missing = await page.request.get("/api/v1/tenants/not-a-real-tenant/device-health");
    expect(missing.status()).toBe(404);

    // Unknown devices do not expose health or identity actions.
    const unknownHealth = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/health`,
    );
    expect(unknownHealth.status()).toBe(404);
    const unknownRevoke = await page.request.post(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/revoke-identity`,
      { headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" } },
    );
    expect(unknownRevoke.status()).toBe(404);
  });
});
