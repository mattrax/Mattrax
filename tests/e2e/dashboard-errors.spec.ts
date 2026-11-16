import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("dashboard query failures", () => {
  test("a failed device search shows an error instead of a blank page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const tenant = await bootstrapTenant(page, "Error Tenant");
    await page.route("**/api/v1/tenants/*/devices/search*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }),
    );
    await gotoHydrated(page, `/t/${tenant.id}/devices`);

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Devices", exact: true })).toBeVisible();
    expect(errors).not.toContain("NotReadyError");
  });

  test("a failed policy list shows an error instead of a blank page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Policy Error Tenant");
    await page.route("**/api/v1/tenants/*/policies", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }),
    );
    await gotoHydrated(page, `/t/${tenant.id}/policies`);

    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Policies", exact: true })).toBeVisible();
  });
});
