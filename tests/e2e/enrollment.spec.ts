import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("device enrollment", () => {
  test("renders the public enrollment page and hides disabled platforms", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Enroll Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByText(/enroll in mattrax/i).first()).toBeVisible();
    await expect(page.getByText("Enroll Tenant", { exact: false })).toBeVisible();

    // Every platform is explained; Windows is available even before APNs is set up.
    for (const platform of ["Apple", "Windows", "Android"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${platform}$`) })).toBeVisible();
    }
    await page.getByRole("button", { name: /^Apple$/ }).click();
    await expect(
      page.getByText(/Apple management is not configured|Apple enrollment is disabled/i),
    ).toBeVisible();
  });

  test("requires the enrollment password when one is configured", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Locked Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByText(/enrollment password/i)).toBeVisible();
    await page.locator('input[placeholder*="Enrollment password"]').fill("wrong");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
  });

  test("shows the Windows discovery URL and marks Android unavailable", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Windows Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ enabledAndroid: true }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);
    const details = await api<{
      windows: { discoveryUrl: string; tenantScoped: boolean };
      android: string;
    }>(page, `/api/v1/enrollment/${enrollment.id}`);

    expect(details.windows.discoveryUrl).toContain("/mdm/windows/discovery");
    expect(details.windows.tenantScoped).toBe(false);
    expect(details.android).toBe("unavailable");

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await page.getByRole("button", { name: /^Windows$/ }).click();
    await expect(page.locator("input[readonly]")).toHaveValue(/\/mdm\/windows\/discovery/);
    await expect(page.getByText(/deployment-wide/i)).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: /^Copy$/ }).click();
    await expect(page.getByRole("button", { name: /^Copied$/ })).toBeVisible();

    await page.getByRole("button", { name: /^Android$/ }).click();
    await expect(page.getByText(/Android enrollment isn't available yet/i)).toBeVisible();
  });

  test("saves maxDevices=0 as unlimited", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Unlimited Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await page.getByRole("button", { name: /^edit settings$/i }).click();
    await page.getByLabel("Maximum devices").fill("0");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByLabel("Maximum devices")).toHaveValue("0");

    const enrollment = await api<{ id: string; maxDevices: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/enrollment`,
    );
    expect(enrollment.maxDevices).toBe(0);
  });
});
