import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated, register, uniqueEmail } from "./helpers";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

type InvitePayload = { email: string; role?: string; roleId?: string };

const invite = async (page: Page, tenantId: string, body: InvitePayload) =>
  api<{ inviteUrl: string }>(page, `/api/v1/tenants/${tenantId}/invitations`, {
    method: "POST",
    body: JSON.stringify(body),
  });

const acceptInvitation = async (page: Page, inviteUrl: string) => {
  await gotoHydrated(page, inviteUrl);
  await page.getByRole("button", { name: /^Join / }).click();
};

test.describe("RBAC UI gating", () => {
  test("an owner keeps every mutation control", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "RBAC Owner");
    const base = `/t/${tenant.slug}`;

    await gotoHydrated(page, `${base}/devices`);
    await expect(page.getByRole("button", { name: "Import CSV", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Enroll device", exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/groups`);
    await expect(page.getByRole("link", { name: "Create group", exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/policies`);
    await expect(page.getByRole("link", { name: "Create policy", exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/settings`);
    // The save control lives in the shared floating bar, which appears once the
    // profile differs from what the server last returned.
    await page.getByLabel(/^Name/).fill("RBAC Owner Renamed");
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete tenant", exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/settings/migration/export`);
    await expect(page.getByRole("button", { name: "Export tenant", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Import tenant", exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/settings/backups`);
    await expect(page.getByText("Automatic tenant backups")).toBeVisible();

    await expect(
      page
        .getByRole("navigation", { name: "Tenant settings" })
        .getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
  });

  test("a read-only administrator gets read surfaces without mutation controls", async ({
    page,
    context,
  }) => {
    const tenant = await bootstrapTenant(page, "RBAC Member");
    const email = uniqueEmail("rbac-member");
    const invitation = await invite(page, tenant.id, { email, role: "member" });

    // The owner session lives in this context; clear it so registering the
    // invitee actually signs in as that account instead of reusing the owner.
    await context.clearCookies();

    const member = await context.newPage();
    await register(member, { email, name: "Read Only Member" });
    await acceptInvitation(member, invitation.inviteUrl);
    await expect(member).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    // Every read surface remains in the primary navigation.
    for (const label of [
      "Overview",
      "Dashboards",
      "Devices",
      "Groups",
      "Policies",
      "Applications",
    ]) {
      await expect(primaryNav(member).getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await expect(
      member
        .getByRole("navigation", { name: "Tenant settings" })
        .getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();

    await gotoHydrated(member, `/t/${tenant.id}/devices`);
    await expect(member.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "Import CSV", exact: true })).toHaveCount(0);
    await expect(member.getByRole("link", { name: "Enroll device", exact: true })).toHaveCount(0);
    await expect(member.getByLabel("Select all rows")).toHaveCount(0);

    await gotoHydrated(member, `/t/${tenant.id}/groups`);
    await expect(member.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
    await expect(member.getByRole("link", { name: "Create group", exact: true })).toHaveCount(0);
    await expect(member.getByLabel("Select all rows")).toHaveCount(0);

    await gotoHydrated(member, `/t/${tenant.id}/policies`);
    await expect(member.getByRole("heading", { name: "Policies", exact: true })).toBeVisible();
    await expect(member.getByRole("link", { name: "Create policy", exact: true })).toHaveCount(0);

    await gotoHydrated(member, `/t/${tenant.id}/settings`);
    await expect(member.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    await expect(member.getByRole("button", { name: "Delete tenant", exact: true })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);

    await gotoHydrated(member, `/t/${tenant.id}/settings/migration/export`);
    await expect(member.getByText("No tenant transfer access")).toBeVisible();
    await expect(member.getByRole("button", { name: "Import tenant", exact: true })).toHaveCount(0);
    await expect(member.getByRole("button", { name: "Export tenant", exact: true })).toHaveCount(0);

    await gotoHydrated(member, `/t/${tenant.id}/settings/backups`);
    await expect(member.getByText("Your role cannot view tenant backups")).toBeVisible();
    await expect(member.getByText("Automatic tenant backups")).toHaveCount(0);

    // The invitation form belongs to members.write, which a read-only
    // administrator does not have.
    await gotoHydrated(member, `/t/${tenant.id}/settings/administrators`);
    await expect(member.getByRole("button", { name: "Send invitation", exact: true })).toHaveCount(
      0,
    );

    await member.close();
  });

  test("a custom role only sees the sections and controls it can read", async ({
    page,
    context,
  }) => {
    const tenant = await bootstrapTenant(page, "RBAC Custom");
    const email = uniqueEmail("rbac-custom");

    const role = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/roles`, {
      method: "POST",
      body: JSON.stringify({
        name: "Device reviewer",
        description: "Read devices and policies only",
        permissions: ["devices.read", "policies.read"],
      }),
    });

    const policy = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({ name: "Reviewer policy", notes: null }),
    });

    const invitation = await invite(page, tenant.id, { email, roleId: role.id });
    await context.clearCookies();

    const reviewer = await context.newPage();
    await register(reviewer, { email, name: "Custom Reviewer" });
    await acceptInvitation(reviewer, invitation.inviteUrl);
    await expect(reviewer).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    // Only readable sections survive in navigation. Overview requires
    // tenant.read and Settings requires a settings read permission.
    await expect(
      primaryNav(reviewer).getByRole("link", { name: "Devices", exact: true }),
    ).toBeVisible();
    await expect(
      primaryNav(reviewer).getByRole("link", { name: "Policies", exact: true }),
    ).toBeVisible();

    for (const label of ["Overview", "Dashboards", "Groups", "Applications", "Settings"]) {
      await expect(
        primaryNav(reviewer).getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      reviewer.getByRole("navigation", { name: "Tenant settings" }),
    ).toHaveCount(0);

    // Device and policy reads work; their mutation controls are absent.
    await expect(reviewer.getByRole("button", { name: "Import CSV", exact: true })).toHaveCount(0);
    await expect(reviewer.getByLabel("Select all rows")).toHaveCount(0);

    await gotoHydrated(reviewer, `/t/${tenant.id}/policies`);
    await expect(reviewer.getByRole("heading", { name: "Policies", exact: true })).toBeVisible();
    await expect(reviewer.getByRole("link", { name: "Create policy", exact: true })).toHaveCount(0);

    await gotoHydrated(reviewer, `/t/${tenant.id}/policies/${policy.id}`);
    await expect(
      reviewer.getByRole("heading", { name: "Reviewer policy", exact: true }),
    ).toBeVisible();
    await expect(reviewer.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(
      0,
    );
    await expect(reviewer.getByRole("button", { name: "Sync", exact: true })).toHaveCount(0);
    await expect(reviewer.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(reviewer.getByText(/read-only access|but not edit it/i)).toBeVisible();

    // A denied settings path renders the guard instead of the settings UI.
    await gotoHydrated(reviewer, `/t/${tenant.id}/settings`);
    await expect(reviewer.getByRole("heading", { name: /don't have access/i })).toBeVisible();
    await expect(reviewer.getByRole("heading", { name: "General", exact: true })).toHaveCount(0);

    await reviewer.close();
  });
});
