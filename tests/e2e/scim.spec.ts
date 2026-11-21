import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, createScimClient, uniqueEmail } from "./helpers";

type Directory = {
  users: Array<{
    id: string;
    name: string;
    email: string;
    externalId?: string | null;
    disabled: boolean;
    source: string;
  }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
};

type Administrator = { accountId: string; email: string };

test.describe("SCIM provisioning", () => {
  test("provisions directory users and groups with a tenant token", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "SCIM Tenant");
    const { scim } = await createScimClient(page, tenant.id);

    // A new tenant has no directory people: the account that created it is an
    // administrator, not a directory user.
    const list = await scim("/Users");
    const listText = await list.text();
    expect(list.ok(), `${list.status()} ${listText}`).toBe(true);
    const before: { totalResults: number } = JSON.parse(listText);
    expect(before.totalResults).toBe(0);

    const accountsBefore = await api<{ accounts: Administrator[] }>(
      page,
      `/api/v1/tenants/${tenant.id}/accounts`,
    );

    const initialAccountIds = accountsBefore.accounts.map((account) => account.accountId).sort();

    const email = uniqueEmail("scim");

    const create = await scim("/Users", {
      method: "POST",
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: email,
        name: { givenName: "SCIM", familyName: "User" },
        active: true,
        // Directory people have no role; SCIM ignores an IdP-supplied roles
        // array rather than turning it into a tenant membership.
        roles: [{ value: "member" }],
      },
    });

    expect(create.status()).toBe(201);
    const user: { id: string; userName: string; roles?: unknown[] } = await create.json();
    expect(user.userName).toBe(email);
    expect(user.roles).toBeUndefined();

    // The created person is a directory user, visible to policy assignment.
    const directory = await api<Directory>(page, `/api/v1/tenants/${tenant.id}/directory`);
    const provisioned = directory.users.find((item) => item.id === user.id);

    expect(provisioned).toBeDefined();
    expect(provisioned).toMatchObject({
      id: user.id,
      name: "SCIM User",
      email,
      disabled: false,
      source: "scim",
    });
    expect(provisioned).not.toHaveProperty("role");
    expect(directory.users).toHaveLength(1);

    // Provisioning a directory person does not grant dashboard access.
    const accountsAfter = await api<{ accounts: Administrator[] }>(
      page,
      `/api/v1/tenants/${tenant.id}/accounts`,
    );

    expect(accountsAfter.accounts.map((account) => account.accountId).sort()).toEqual(
      initialAccountIds,
    );
    expect(accountsAfter.accounts.map((account) => account.email)).not.toContain(email);

    const groupResponse = await scim("/Groups", {
      method: "POST",
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "SCIM group",
        members: [{ value: user.id }],
      },
    });

    expect(groupResponse.status()).toBe(201);
    const group: { id: string; members: unknown[] } = await groupResponse.json();
    expect(group.members).toHaveLength(1);

    const patch = await scim(`/Groups/${group.id}`, {
      method: "PATCH",
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "members", value: [] }],
      },
    });

    expect(patch.ok()).toBe(true);

    const remove = await scim(`/Users/${user.id}`, { method: "DELETE" });
    expect(remove.status()).toBe(204);

    const after = await scim("/Users");
    const result: { totalResults: number; Resources: Array<{ id: string }> } = await after.json();
    expect(result.Resources.some((resource) => resource.id === user.id)).toBe(false);
    expect(result.totalResults).toBe(0);

    const directoryAfter = await api<Directory>(page, `/api/v1/tenants/${tenant.id}/directory`);

    expect(directoryAfter.users.some((item) => item.id === user.id)).toBe(false);
  });
});
