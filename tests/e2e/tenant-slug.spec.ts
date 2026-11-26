import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("tenant URL slugs", () => {
  test("opens a tenant by slug and rewrites an id URL to the canonical slug", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Slug Tenant");

    await gotoHydrated(page, `/t/${tenant.slug}/devices`);
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/devices$`));
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();

    // An id link from a bookmark or an older integration still opens the same
    // tenant, then settles on the slug.
    await gotoHydrated(page, `/t/${tenant.id}/groups`);
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups$`));
    await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
  });

  test("does not resolve a slug that names no membership", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Wrong Slug Tenant");

    await gotoHydrated(page, "/t/not-this-tenant/devices");

    await expect(page).not.toHaveURL(/not-this-tenant/, { timeout: 20_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}|/dashboard`));
  });

  test("moves the settings page to a newly saved slug", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Slug Tenant");
    const renamed = `${tenant.slug}-renamed`;

    await gotoHydrated(page, `/t/${tenant.slug}/settings`);
    await page.getByLabel(/^Slug/).fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();

    const dialog = page.getByRole("dialog", {
      name: /changing the tenant slug breaks existing URLs/i,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill("I understand");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tenants/") &&
        response.ok(),
    );
    await dialog.getByRole("button", { name: "Change slug and save" }).click();
    await saved;

    await expect(page).toHaveURL(new RegExp(`/t/${renamed}/settings$`), { timeout: 20_000 });
    await gotoHydrated(page, `/t/${renamed}/devices`);
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
  });

  test("uses the new slug in links after a rename", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Renamed Slug Tenant");
    const renamed = `${tenant.slug}-renamed`;

    await page.evaluate(
      async ({ id, slug }) => {
        const response = await fetch(`/api/v1/tenants/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
          body: JSON.stringify({ slug }),
        });

        if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      },
      { id: tenant.id, slug: renamed },
    );

    await gotoHydrated(page, `/t/${renamed}/devices`);
    await expect(page).toHaveURL(new RegExp(`/t/${renamed}/devices$`));

    // The old slug is no longer a membership, so it must not render the
    // tenant under a stale address.
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);
    await expect(page).not.toHaveURL(new RegExp(`/t/${tenant.slug}/devices$`), {
      timeout: 20_000,
    });
  });
});
