import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

type Directory = {
  users: Array<{ id: string; name: string; email: string; source: string; disabled: boolean }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
};

type Assignments = {
  devices: Array<{ id: string; mode: string }>;
  users: Array<{ id: string; name: string; email: string; mode: string }>;
  userGroups: Array<{ id: string; name: string; mode: string }>;
};

test.describe("per-user policy assignment", () => {
  test("lists directory users and persists a user assignment from the UI", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "User Policy Tenant");

    const me = await api<{ user: { id: string; email: string; name: string } }>(
      page,
      "/api/v1/me",
    );

    const directory = await api<Directory>(
      page,
      `/api/v1/tenants/${tenant.id}/directory`,
    );

    // A tenant member is a directory user even before an IdP is connected.
    expect(directory.users.map((user) => user.email)).toContain(me.user.email);
    expect(directory.groups).toEqual([]);

    const policy = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({ name: "User scoped policy" }),
    });

    await gotoHydrated(page, `/t/${tenant.id}/policies/${policy.id}/assignments`);

    // The warning explains that a user policy reaches every user of a linked device.
    await expect(
      page.getByText(/applies it to\s+every device linked to that user/i),
    ).toBeVisible();

    const userRow = page.locator("label").filter({ hasText: me.user.email });
    await expect(userRow).toHaveCount(1);
    await userRow.locator("select").selectOption("include");

    await page.getByRole("button", { name: /^save assignments$/i }).click();
    await expect(page.getByText("Assignments saved.")).toBeVisible();

    await expect
      .poll(async () => {
        const assignments = await api<Assignments>(
          page,
          `/api/v1/tenants/${tenant.id}/policies/${policy.id}/assignments`,
        );

        return assignments.users.map((user) => `${user.id}:${user.mode}`);
      })
      .toContain(`${me.user.id}:include`);

    // The assignment survives a reload instead of only existing in local state.
    await gotoHydrated(page, `/t/${tenant.id}/policies/${policy.id}/assignments`);
    await expect(
      page.locator("label").filter({ hasText: me.user.email }).locator("select"),
    ).toHaveValue("include");

    // Switching to exclude updates the stored mode rather than deleting the row.
    await page
      .locator("label")
      .filter({ hasText: me.user.email })
      .locator("select")
      .selectOption("exclude");
    await page.getByRole("button", { name: /^save assignments$/i }).click();
    await expect(page.getByText("Assignments saved.")).toBeVisible();

    await expect
      .poll(async () => {
        const assignments = await api<Assignments>(
          page,
          `/api/v1/tenants/${tenant.id}/policies/${policy.id}/assignments`,
        );

        return assignments.users.map((user) => `${user.id}:${user.mode}`);
      })
      .toContain(`${me.user.id}:exclude`);
  });

  test("rejects directory and device lookups outside the tenant", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Isolation Tenant");

    const missingDevice = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/users`,
    );

    expect(missingDevice.status()).toBe(404);

    const missingDirectory = await page.request.get(
      `/api/v1/tenants/not-a-tenant/directory`,
    );

    expect(missingDirectory.status()).toBe(404);
  });

  test("shows linked directory users on the directory settings page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Directory Tenant");
    const me = await api<{ user: { email: string } }>(page, "/api/v1/me");

    await gotoHydrated(page, `/t/${tenant.id}/settings/identity/directory`);
    await expect(page.getByText("Synced users and groups")).toBeVisible();
    await expect(page.getByText(me.user.email)).toBeVisible();
  });
});
