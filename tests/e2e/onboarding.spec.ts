import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated, register, uniqueEmail } from "./helpers";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test.describe("onboarding query gating", () => {
  test("an eligible overview keeps one fresh request across remounts and dismissal", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Onboarding Owner");
    const onboardingRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        request.url().includes(`/api/v1/tenants/${tenant.id}/onboarding`)
      )
        onboardingRequests.push(request.url());
    });

    await gotoHydrated(page, `/t/${tenant.id}`);
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    expect(onboardingRequests).toHaveLength(1);

    await primaryNav(page).getByRole("link", { name: "Devices", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    expect(onboardingRequests).toHaveLength(1);

    await page.getByRole("button", { name: "Dismiss the Get started checklist" }).click();
    await expect(page.getByRole("heading", { name: "Get started" })).toHaveCount(0);

    await primaryNav(page).getByRole("link", { name: "Devices", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get started" })).toHaveCount(0);
    expect(onboardingRequests).toHaveLength(1);

    await gotoHydrated(page, `/t/${tenant.id}`);
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get started" })).toHaveCount(0);
    expect(onboardingRequests).toHaveLength(1);
  });

  test("a failed dismissal restores the query and reload cache", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Onboarding Rollback");
    const onboardingRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        request.url().includes(`/api/v1/tenants/${tenant.id}/onboarding`)
      )
        onboardingRequests.push(request.url());
    });

    await gotoHydrated(page, `/t/${tenant.id}`);
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await page.route(`**/api/v1/tenants/${tenant.id}/onboarding`, async (route) => {
      if (route.request().method() === "PATCH") await route.abort("failed");
      else await route.continue();
    });

    await page.getByRole("button", { name: "Dismiss the Get started checklist" }).click();
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();

    await primaryNav(page).getByRole("link", { name: "Devices", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    expect(onboardingRequests).toHaveLength(1);

    await page.unroute(`**/api/v1/tenants/${tenant.id}/onboarding`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    expect(onboardingRequests).toHaveLength(2);
  });

  test("a read-only member makes no onboarding request", async ({ page, context }) => {
    const tenant = await bootstrapTenant(page, "Onboarding Member");
    const email = uniqueEmail("onboarding-member");
    const invitation = await api<{ inviteUrl: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/invitations`,
      { method: "POST", body: JSON.stringify({ email, role: "member" }) },
    );
    await context.clearCookies();

    const member = await context.newPage();
    await register(member, { email, name: "Read Only Member" });
    await gotoHydrated(member, invitation.inviteUrl);
    await member.getByRole("button", { name: /^Join / }).click();
    await expect(member).toHaveURL(new RegExp(`/t/${tenant.slug}/devices`));

    const onboardingRequests: string[] = [];
    member.on("request", (request) => {
      if (
        request.method() === "GET" &&
        request.url().includes(`/api/v1/tenants/${tenant.id}/onboarding`)
      )
        onboardingRequests.push(request.url());
    });

    await gotoHydrated(member, `/t/${tenant.id}`);
    await expect(member.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(member.getByRole("heading", { name: "Get started" })).toHaveCount(0);
    expect(onboardingRequests).toHaveLength(0);

    await member.close();
  });
});
