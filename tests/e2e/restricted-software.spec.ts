import { expect, test } from "@playwright/test";
import { api, bootstrapFreshTenant, gotoHydrated, register, stepUpGrant, uniqueEmail } from "./helpers";

type InvitePayload = { email: string; role?: string; roleId?: string };

const invite = (page: import("@playwright/test").Page, tenantId: string, body: InvitePayload) =>
  api<{ inviteUrl: string }>(page, `/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

test.describe("restricted software query gating", () => {
  test("a read-only member never loads writer-only target inventories", async ({
    page,
    context,
  }) => {
    const tenant = await bootstrapFreshTenant(page, "Restricted Reader");
    // Writing a rule is a sensitive action: the API requires a fresh step-up
    // grant, so the owner completes the ceremony before seeding the rule.
    const grant = await stepUpGrant(page, "restricted-software-change");
    const rule = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/restricted-software`,
      {
        method: "POST",
        headers: { "x-mattrax-step-up": grant },
        body: JSON.stringify({
          name: "Blocked suite",
          platform: "apple",
          matchType: "bundle-id",
          matchValue: "com.example.blocked",
          action: "kill-process",
          enabled: true,
        }),
      },
    );
    const email = uniqueEmail("restricted-reader");
    const invitation = await invite(page, tenant.id, { email, role: "member" });
    await context.clearCookies();

    const member = await context.newPage();
    await register(member, { email, name: "Restricted Reader" });
    await gotoHydrated(member, invitation.inviteUrl);
    await member.getByRole("button", { name: /^Join / }).click();
    await expect(member).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    const requests: string[] = [];
    member.on("request", (request) => requests.push(new URL(request.url()).pathname));

    await gotoHydrated(member, `/t/${tenant.id}/restricted-software`);
    await expect(member.getByRole("heading", { name: "Restricted software" })).toBeVisible();
    await expect(member.getByRole("link", { name: "New rule" })).toHaveCount(0);
    expect(requests.some((path) => path.includes("/restricted-software/violations"))).toBe(false);

    await gotoHydrated(member, `/t/${tenant.id}/restricted-software/${rule.id}`);
    await expect(member.getByRole("heading", { name: "Blocked suite" })).toBeVisible();
    await expect(member.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    expect(requests).not.toContain(`/api/v1/tenants/${tenant.id}/devices`);
    expect(requests).not.toContain(`/api/v1/tenants/${tenant.id}/groups`);

    await member.close();
  });

  test("a denied visitor makes no restricted-software request", async ({ page, context }) => {
    const tenant = await bootstrapFreshTenant(page, "Restricted Denied");
    const email = uniqueEmail("restricted-denied");
    const role = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/roles`, {
      method: "POST",
      body: JSON.stringify({
        name: "Device reader",
        permissions: ["tenant.read", "devices.read"],
      }),
    });
    const invitation = await invite(page, tenant.id, { email, roleId: role.id });
    await context.clearCookies();

    const denied = await context.newPage();
    await register(denied, { email, name: "Restricted Denied" });
    await gotoHydrated(denied, invitation.inviteUrl);
    await denied.getByRole("button", { name: /^Join / }).click();
    await expect(denied).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    const restrictedRequests: string[] = [];
    denied.on("request", (request) => {
      const path = new URL(request.url()).pathname;

      if (path.startsWith("/api/v1/") && path.includes("/restricted-software"))
        restrictedRequests.push(request.url());
    });

    await gotoHydrated(denied, `/t/${tenant.id}/restricted-software`);
    await expect(denied.getByRole("heading", { name: /don't have access/i })).toBeVisible();
    await gotoHydrated(denied, `/t/${tenant.id}/restricted-software/new`);
    await expect(denied.getByRole("heading", { name: /don't have access/i })).toBeVisible();
    expect(restrictedRequests).toHaveLength(0);

    await denied.close();
  });
});
