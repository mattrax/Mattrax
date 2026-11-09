import { expect, test } from "@playwright/test";
import { api, bootstrapTenant } from "./helpers";

test.describe("device enrollment", () => {
  test("renders the public enrollment page and hides disabled platforms", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Enroll Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await page.goto(`/enroll/${enrollment.id}`);
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

    await page.goto(`/enroll/${enrollment.id}`);
    await expect(page.getByText(/enrollment password/i)).toBeVisible();
    await page.locator('input[placeholder*="Enrollment password"]').fill("wrong");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByText(/invalid/i)).toBeVisible();
  });
});
