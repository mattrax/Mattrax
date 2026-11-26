import { expect, test } from "@playwright/test";
import { addTextFilter, api, bootstrapSession, gotoHydrated, removeFilter } from "./helpers";

test.describe("entity table filters", () => {
  test("filters groups from a shareable URL query", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Entity Filter Tenant");
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
    const { tenant } = await bootstrapSession(page, "Header Sort Tenant");

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

  test("searches and selects a large option list with the keyboard", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Virtual Filter Tenant");
    const options = Array.from(
      { length: 100 },
      (_, index) => `env-${String(index).padStart(2, "0")}`,
    );
    await api(page, `/api/v1/tenants/${tenant.id}/attributes`, {
      method: "POST",
      body: JSON.stringify({
        key: "environment",
        label: "Environment",
        type: "select",
        options,
      }),
    });

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const fieldSearch = page.getByLabel("Search filters");
    await fieldSearch.fill("Environment");
    await fieldSearch.press("ArrowDown");
    const fieldList = page.getByRole("listbox", { name: "Filter by" });
    await expect(fieldList).toBeFocused();
    await page.keyboard.press("Enter");

    const valueList = page.getByRole("listbox", { name: "Environment value" });
    await expect(valueList.getByRole("option").first()).toHaveAttribute("aria-setsize", "100");
    expect(await valueList.getByRole("option").count()).toBeLessThan(30);
    await valueList.focus();
    await page.keyboard.press("End");
    await expect(valueList).toHaveAttribute("aria-activedescendant", /option-99$/);
    const activeId = await valueList.getAttribute("aria-activedescendant");
    const activeOption = page.locator(`[id="${activeId}"]`);
    await expect(activeOption).toBeVisible();
    const optionBox = await activeOption.boundingBox();

    if (!optionBox) throw new Error("The active filter option was not measurable.");

    await page.mouse.move(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
    await page.mouse.down();
    await expect(valueList).toBeFocused();
    await page.mouse.up();
    const chip = page.getByRole("button", { name: "Environment is env-99" });
    await expect(chip).toBeVisible();

    await chip.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Remove Environment filter" })).toBeFocused();

    await chip.click();
    const valueSearch = page.getByLabel("Search Environment values");
    await valueSearch.fill("env-42");
    await expect(valueList.getByRole("option")).toHaveCount(1);
    await valueSearch.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Environment is env-42" })).toBeVisible();
  });

  test("adds, edits and removes a filter from the bar", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Filter Bar Tenant");
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
