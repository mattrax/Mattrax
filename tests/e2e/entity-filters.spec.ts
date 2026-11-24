import { expect, test } from "@playwright/test";
import { addTextFilter, api, bootstrapTenant, gotoHydrated, removeFilter } from "./helpers";

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
    await expect(page.getByRole("button", { name: /Name contains alpha/ })).toBeVisible();

    await gotoHydrated(
      page,
      `/t/${tenant.id}/groups?query=${encodeURIComponent("name contains missing")}`,
    );
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toHaveCount(0);
  });

  test("sorts from a column header", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Header Sort Tenant");

    for (const name of ["Alpha Ops", "Beta Ops"]) {
      await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    }

    await gotoHydrated(page, `/t/${tenant.id}/groups`);

    const header = page.getByRole("columnheader", { name: "Name" });

    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await header.getByRole("button").click();
    await expect(header).not.toHaveAttribute("aria-sort");
  });

  test("adds, edits and removes a filter from the bar", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Filter Bar Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Alpha Ops" }),
    });
    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Beta Ops" }),
    });

    await gotoHydrated(page, `/t/${tenant.id}/groups`);
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toBeVisible();

    await addTextFilter(page, "Name", "alpha");
    await expect(page.getByRole("button", { name: /Name contains alpha/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta Ops" })).toHaveCount(0);
    await expect(page).toHaveURL(/query=name/);

    // Editing the value keeps the same chip and re-filters live.
    await page.getByRole("button", { name: /Name contains alpha/ }).click();
    await page.getByLabel("Name value").fill("beta");
    await expect(page.getByRole("button", { name: /Name contains beta/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Beta Ops" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toHaveCount(0);

    await removeFilter(page, "Name");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/query=/);
    await expect(page.getByRole("link", { name: "Alpha Ops" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta Ops" })).toBeVisible();
  });
});
