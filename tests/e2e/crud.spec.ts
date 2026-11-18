import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("groups and policies", () => {
  test("creates, edits, duplicates, and deletes a group", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "CRUD Tenant");
    await page.goto(`/t/${tenant.id}/groups`);
    await page
      .getByRole("link", { name: /create group/i })
      .first()
      .click();
    await page.locator("form input").first().fill("Field Ops");
    await page.getByRole("button", { name: /^create group$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Field Ops" })).toBeVisible();

    // Edit mode renames through the shared save action.
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.locator("form input").first().fill("Field Operations");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("heading", { name: "Field Operations" })).toBeVisible();

    await page.getByRole("button", { name: /duplicate/i }).click();
    await expect(
      page.getByRole("heading", { name: /Field Operations \[duplicated\]/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^delete$/i }).click();
    await page.locator('[data-slot="dialog-content"] input').fill("Field Operations [duplicated]");
    await page
      .locator('[data-slot="dialog-content"]')
      .getByRole("button", { name: /delete group/i })
      .click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups$`));
  });

  test("creates a dynamic group and shows its rule-based membership", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Dynamic Tenant");

    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({
        name: "Apple Laptops",
        kind: "dynamic",
        rules: {
          version: 1,
          all: [
            { field: "platform", op: "eq", value: "apple" },
            { field: "osVersion", op: "gte", value: "14.4" },
          ],
        },
      }),
    });

    // Device assignment is rejected; rules own membership.
    await expect(
      api(page, `/api/v1/tenants/${tenant.id}/groups/${group.id}/members`, {
        method: "PATCH",
        body: JSON.stringify({ assign: { devices: ["not-a-device"] } }),
      }),
    ).rejects.toThrow(/Dynamic group device membership/);

    const preview = await api<{ kind: string; count: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/groups/${group.id}/preview`,
    );

    expect(preview).toEqual(expect.objectContaining({ kind: "dynamic", count: 0 }));

    await gotoHydrated(page, `/t/${tenant.id}/groups/${group.id}`);
    await expect(page.getByRole("heading", { name: "Apple Laptops" })).toBeVisible();
    await expect(page.getByText("Dynamic", { exact: true })).toBeVisible();
    await expect(page.getByText("Live match preview")).toBeVisible();

    await page.getByRole("button", { name: /^edit$/i }).click();
    await expect(page.getByText("Match devices")).toBeVisible();
    await expect(page.getByRole("button", { name: /Platform is Apple/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /OS version at least 14.4/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add filter" })).toBeVisible();

    await page.goto(`/t/${tenant.id}/groups`);
    await expect(page.getByRole("link", { name: "Apple Laptops" })).toBeVisible();
    await expect(page.getByText("Dynamic", { exact: true })).toBeVisible();
  });

  test("creates a policy and configures a device restriction", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Policy Tenant");
    await page.goto(`/t/${tenant.id}/policies`);
    await page
      .getByRole("link", { name: /create policy/i })
      .first()
      .click();
    await page.locator("form input").first().fill("Camera Policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);

    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /^restrictions$/i }).click();
    await page.getByRole("checkbox").first().uncheck();
    await page.getByRole("button", { name: /^save$/i }).click();
    const detailUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, detailUrl);
    await expect(page.getByText("Deployment history")).toBeVisible();
    await expect(page.getByText(/Version 2/)).toBeVisible();

    await page.goto(`/t/${tenant.id}/policies`);
    await expect(page.getByRole("link", { name: "Camera Policy" })).toBeVisible();
  });
});
