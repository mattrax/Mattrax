import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, createTenant, gotoHydrated, stepUpGrant } from "./helpers";

test.describe("device enrollment", () => {
  test("renders the public enrollment page and hides disabled platforms", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Enroll Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.locator('[data-slot="card-title"]').first()).toContainText(/enroll in/i);
    await expect(page.getByText("Enroll Tenant", { exact: false }).first()).toBeVisible();

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

  test("shows a tenant-scoped Windows discovery URL and marks Android unavailable", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Windows Tenant");

    const other = await createTenant(
      page,
      `Windows Other ${Math.random().toString(36).slice(2, 8)}`,
    );

    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ enabledAndroid: true }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    const otherEnrollment = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${other.id}/enrollment`,
    );

    const details = await api<{
      windows: { discoveryUrl: string; tenantScoped: boolean; expiresAt?: string };
      android: { error: string } | string;
    }>(page, `/api/v1/enrollment/${enrollment.id}`);

    const otherDetails = await api<{
      windows: { discoveryUrl: string; tenantScoped: boolean };
    }>(page, `/api/v1/enrollment/${otherEnrollment.id}`);

    expect(details.windows.discoveryUrl).toMatch(/\/mdm\/windows\/discovery\?tenant=mttxw1\./);
    expect(details.windows.tenantScoped).toBe(true);
    expect(details.windows.expiresAt).toBeTruthy();
    // The token is tenant-specific: two tenants never share a URL.
    expect(otherDetails.windows.discoveryUrl).not.toBe(details.windows.discoveryUrl);
    expect(details.android).toMatchObject({
      error: expect.stringMatching(/Android Enterprise is not configured/i),
    });

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await page.getByRole("button", { name: /^Windows$/ }).click();
    await expect(page.locator("input[readonly]")).toHaveValue(
      /\/mdm\/windows\/discovery\?tenant=mttxw1\./,
    );
    await expect(page.getByText(/deployment-wide/i)).toHaveCount(0);
    await expect(page.getByText(/scoped to this tenant/i)).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: /^Copy$/ }).click();
    await expect(page.getByRole("button", { name: /^Copied$/ })).toBeVisible();

    await page.getByRole("button", { name: /^Android$/ }).click();
    await expect(page.getByText(/Android Enterprise is not configured/i)).toBeVisible();
  });

  test("deletes a tenant after its enrollment link has been visited", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Deletable Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    // Visiting the public link writes an enrollment_attempt row. Tenant
    // deletion relies on ON DELETE CASCADE for that table.
    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.locator('[data-slot="card-title"]').first()).toContainText(/enroll in/i);

    const grant = await stepUpGrant(page, "tenant-delete");
    await expect(
      api<{ status: string }>(page, `/api/v1/tenants/${tenant.id}`, {
        method: "DELETE",
        headers: { "x-mattrax-step-up": grant },
      }),
    ).resolves.toEqual({ status: "ok" });
    const removed = await page.request.get(`/api/v1/tenants/${tenant.id}/devices/search`);
    expect(removed.status()).toBe(404);
  });

  test("shows a QR code for the public enrollment link", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "QR Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByText(/scan to open this page/i)).toBeVisible();
    const qr = page.getByRole("img", { name: /qr code for this enrollment link/i });
    await expect(qr).toBeVisible();
    await expect(qr.locator("path")).toHaveAttribute("d", /^M\d+ \d+h1v1h-1z/);
  });

  test("returns a friendly error when the installed profile cannot be built", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Profile Error Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    const response = await page.request.get(
      `/api/v1/enrollment/${enrollment.id}/apple.mobileconfig`,
    );

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      message: "Apple management is not configured! Contact your administrator.",
    });

    const settings = await page.request.get(
      `/api/v1/enrollment/not-a-real-enrollment/apple.mobileconfig`,
    );

    expect(settings.status()).toBe(404);
  });

  test("shows the enrollment QR code in settings", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings QR Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await expect(page.getByRole("img", { name: /qr code for the enrollment link/i })).toBeVisible();
    await expect(page.getByText("Pre-registered devices")).toBeVisible();
  });

  test("shows recent enrollment activity with outcome badges", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Activity Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });

    // A wrong password is recorded as a diagnostic before the page redirects.
    const denied = await api<{ authenticated: boolean }>(
      page,
      `/api/v1/enrollment/${enrollment.id}?code=wrong`,
    );

    expect(denied.authenticated).toBe(false);

    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await expect(page.getByText("Enrollment activity")).toBeVisible();
    await expect(page.getByText("Bad password")).toBeVisible();
  });

  test("health cards open the matching device filter", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Health Tenant");
    await gotoHydrated(page, `/t/${tenant.id}`);
    await page.getByRole("button", { name: /Critical/ }).click();
    await expect(page).toHaveURL(/health=critical/);
    await expect(page.getByLabel("Filter by health")).toHaveValue("critical");
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
