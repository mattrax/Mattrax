import { expect, test, type Page } from "@playwright/test";
import { api, bootstrapTenant, createScimClient, gotoHydrated, uniqueEmail } from "./helpers";

type Directory = {
  users: Array<{
    id: string;
    name: string;
    email: string;
    externalId?: string | null;
    source: string;
    disabled: boolean;
  }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
};

type Assignments = {
  devices: Array<{ id: string; mode: string }>;
  users: Array<{ id: string; name: string; email: string; mode: string }>;
  userGroups: Array<{ id: string; name: string; mode: string }>;
};

/** Provision a directory person through SCIM; it never becomes an account. */
const provisionDirectoryUser = async (page: Page, tenantId: string) => {
  const { scim } = await createScimClient(page, tenantId);
  const name = "Directory Person";
  const email = uniqueEmail("directory");

  const response = await scim("/Users", {
    method: "POST",
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: email,
      name: { formatted: name },
      active: true,
    },
  });

  expect(response.status()).toBe(201);

  const created: { id: string } = await response.json();

  return { id: created.id, name, email };
};

test.describe("per-user policy assignment", () => {
  test("a fresh tenant's directory is empty and accounts are not directory users", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Empty Directory Tenant");

    const me = await api<{ account: { id: string; email: string; name: string } }>(
      page,
      "/api/v1/me",
    );

    const directory = await api<Directory>(page, `/api/v1/tenants/${tenant.id}/directory`);

    // Signing up and creating a tenant only made an account and a membership;
    // the directory stays empty until a person is provisioned.
    expect(directory.users).toEqual([]);
    expect(directory.groups).toEqual([]);

    const accounts = await api<{ accounts: Array<{ accountId: string; email: string }> }>(
      page,
      `/api/v1/tenants/${tenant.id}/accounts`,
    );

    // The signed-in account is an administrator, not a directory person.
    expect(accounts.accounts.map((account) => account.accountId)).toContain(me.account.id);
    expect(accounts.accounts.map((account) => account.email)).toContain(me.account.email);
    expect(directory.users.map((user) => user.email)).not.toContain(me.account.email);
  });

  test("lists SCIM directory users and persists a user assignment from the UI", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "User Policy Tenant");
    const directoryUser = await provisionDirectoryUser(page, tenant.id);

    const directory = await api<Directory>(page, `/api/v1/tenants/${tenant.id}/directory`);

    const listed = directory.users.find((user) => user.id === directoryUser.id);

    expect(listed).toMatchObject({
      id: directoryUser.id,
      name: directoryUser.name,
      email: directoryUser.email,
      source: "scim",
      disabled: false,
    });
    expect(listed).not.toHaveProperty("role");
    expect(listed).not.toHaveProperty("emailVerified");
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

    const userRow = page.locator("label").filter({ hasText: directoryUser.email });
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
      .toContain(`${directoryUser.id}:include`);

    // The assignment survives a reload instead of only existing in local state.
    await gotoHydrated(page, `/t/${tenant.id}/policies/${policy.id}/assignments`);
    await expect(
      page.locator("label").filter({ hasText: directoryUser.email }).locator("select"),
    ).toHaveValue("include");

    // Switching to exclude updates the stored mode rather than deleting the row.
    await page
      .locator("label")
      .filter({ hasText: directoryUser.email })
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
      .toContain(`${directoryUser.id}:exclude`);

    // The directory settings page lists the provisioned person, not accounts.
    await gotoHydrated(page, `/t/${tenant.id}/settings/identity/directory`);
    await expect(page.getByText("Synced users and groups")).toBeVisible();
    await expect(page.locator("#main").getByText(directoryUser.email)).toBeVisible();
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
});
