import { expect, test } from "@playwright/test";
import { createTenant, gotoHydrated, register, signIn } from "./helpers";

test.describe("authentication and onboarding", () => {
  test("registers, lands on the dashboard, and creates a tenant", async ({ page }) => {
    await register(page, { name: "Onboard User" });
    await expect(page).toHaveURL(/\/tenants\/new/);
    await expect(page.getByRole("heading", { name: "Create tenant" })).toBeVisible();
    const suffix = Math.random().toString(36).slice(2, 8);
    await page.locator("input").first().fill("Onboard Tenant");
    await page.locator("input").nth(1).fill(`onboard-tenant-${suffix}`);
    await page
      .getByRole("button", { name: /create tenant/i })
      .last()
      .click();
    await expect(page).toHaveURL(/\/t\/[^/]+\/devices/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`/t/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Fleet overview", exact: true })).toBeVisible();
  });

  test("offers passkey sign-in without any password fields", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");

    await expect(page.getByRole("button", { name: /sign in with a passkey/i })).toBeVisible();
    await expect(page.locator("#password")).toHaveCount(0);
    await expect(page.locator("#email")).toHaveCount(0);

    await page.getByRole("button", { name: /sign in with your organisation/i }).click();
    const email = page.locator("#email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await email.fill("person@example.com");
    await expect(email).toHaveValue("person@example.com");
  });

  test("registration has no password fields", async ({ page }) => {
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");

    await expect(page.getByRole("button", { name: /create account with a passkey/i })).toBeVisible();
    await expect(page.locator("#password")).toHaveCount(0);
    await expect(page.locator("#confirm-password")).toHaveCount(0);
  });

  test("branches to organisation sign-in", async ({ page }) => {
    await page.route("**/api/v1/sso/azure/start*", async (route) => {
      const url = new URL(route.request().url());

      // The redirect must keep the requested return target.
      expect(url.searchParams.get("returnTo")).toBe("/t/example/devices");
      await route.fulfill({
        json: {
          url: "/login?sso=started",
          organization: { name: "Acme Corp" },
        },
      });
    });

    await page.goto("/login?returnTo=%2Ft%2Fexample%2Fdevices", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.getByRole("button", { name: /sign in with your organisation/i }).click();
    await page.locator("#email").fill("person@acme.com");
    await page.getByRole("button", { name: /continue with sso/i }).click();
    await expect(page).toHaveURL(/sso=started/);
  });

  test("signs out and back in with a passkey", async ({ page }) => {
    const { email } = await register(page);
    const tenant = await createTenant(page, "Session Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/dashboard|\/t\//);
  });
});
