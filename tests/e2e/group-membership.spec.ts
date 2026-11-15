import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("group membership", () => {
  test("filters policies and adds every shown result", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Membership Tenant");

    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Membership Group" }),
    });

    for (const name of ["Alpha Policy", "Beta Policy"])
      await api(page, `/api/v1/tenants/${tenant.id}/policies`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });

    await gotoHydrated(page, `/t/${tenant.slug}/groups/${group.id}`);
    await page.getByRole("button", { name: /^policies$/i }).click();
    await page.getByRole("button", { name: /^Edit$/ }).click();

    // The picker reuses the shared table: a search narrows both the visible
    // rows and the bulk "include all shown" action.
    await page.getByPlaceholder(/search policies/i).fill("Alpha");
    await expect(page.getByRole("link", { name: "Alpha Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Beta Policy" })).toHaveCount(0);

    await page.getByRole("button", { name: /include all shown/i }).click();
    await expect(page.getByText("1 policy assigned.")).toBeVisible();

    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect
      .poll(
        async () => {
          const row = await api<{
            policies: ReadonlyArray<{ name: string; mode?: string }>;
          }>(page, `/api/v1/tenants/${tenant.id}/groups/${group.id}`);

          return row.policies.map((policy) => `${policy.name}:${policy.mode ?? "include"}`);
        },
        { timeout: 15_000 },
      )
      .toEqual(["Alpha Policy:include"]);
  });

  test("pages device membership and searches serial and asset tag", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Membership Devices");

    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Device Membership" }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/groups/${group.id}`);
    await page.getByRole("button", { name: /^devices$/i }).click();

    // The old "first 200" note is gone; the picker always states its page and
    // total.
    await expect(page.getByText(/Page 1 of 1/)).toBeVisible();
    await expect(page.getByPlaceholder(/search name, serial, asset tag/i)).toBeVisible();
    await expect(page.getByText(/No devices assigned/)).toBeVisible();
  });
});
