import { expect, test } from "@playwright/test";
import { bootstrapTenant, uniqueEmail } from "./helpers";

test.describe("SCIM provisioning", () => {
  test("provisions users and groups with a tenant token", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "SCIM Tenant");

    const created = await page.evaluate(async (tenantId) => {
      const response = await fetch(`/api/v1/tenants/${tenantId}/scim-tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ name: "Browser test" }),
      });

      if (!response.ok) throw new Error(await response.text());

      const body: { token: string; baseUrl: string } = await response.json();

      return body;
    }, tenant.id);

    const scim = async (path: string, init?: RequestInit) => {
      const extraHeaders = init?.headers ? Object.fromEntries(new Headers(init.headers)) : {};

      const response = await page.request.fetch(`${created.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${created.token}`,
          "content-type": "application/scim+json",
          ...extraHeaders,
        },
      });

      return response;
    };

    const list = await scim("/Users");
    const listText = await list.text();
    expect(list.ok(), `${list.status()} ${listText}`).toBe(true);
    const before: { totalResults: number } = JSON.parse(listText);
    expect(before.totalResults).toBeGreaterThanOrEqual(1);

    const email = uniqueEmail("scim");

    const create = await scim("/Users", {
      method: "POST",
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: email,
        name: { givenName: "SCIM", familyName: "User" },
        active: true,
        roles: [{ value: "member" }],
      },
    });

    expect(create.status()).toBe(201);
    const user: { id: string; userName: string } = await create.json();
    expect(user.userName).toBe(email);

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
    const result: { Resources: Array<{ id: string }> } = await after.json();
    expect(result.Resources.some((resource) => resource.id === user.id)).toBe(false);
  });
});
