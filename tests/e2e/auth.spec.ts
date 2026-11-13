import { expect, test } from "@playwright/test";
import { createTenant, register, gotoHydrated } from "./helpers";

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

  test("asks for email first and keeps password-manager fields", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    const email = page.locator("#email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    await expect(page.locator("#password")).toHaveCount(0);

    await email.fill("person@example.com");
    // Changing steps is local state, so the password screen appears at once.
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#password")).toHaveAttribute("autocomplete", "current-password");
    // The hidden username keeps the password paired with the account in
    // browser password managers.
    await expect(page.locator("#login-email")).toHaveAttribute("autocomplete", "username");
    await expect(page.getByText("person@example.com", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /use a different email/i }).click();
    await expect(page.locator("#email")).toHaveValue("person@example.com");
  });

  test("starts on the password step when an email is supplied", async ({ page }) => {
    await page.goto("/login?email=person%40example.com", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByText("person@example.com", { exact: true })).toBeVisible();
  });

  test("branches to organisation sign-in when the domain has SSO", async ({ page }) => {
    await page.route("**/api/v1/sso/azure/start*", async (route) => {
      const url = new URL(route.request().url());

      if (url.searchParams.get("discover") === "1") {
        await route.fulfill({
          json: { available: true, organization: { name: "Acme Corp" } },
        });

        return;
      }

      // The redirect must carry the same return target as password sign-in.
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
    await page.locator("#email").fill("person@acme.com");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByRole("button", { name: /Continue with Acme Corp/ })).toBeVisible();
    await page.getByRole("button", { name: /Continue with Acme Corp/ }).click();
    await expect(page).toHaveURL(/sso=started/);
  });

  test("signs out and back in", async ({ page }) => {
    const { email } = await register(page);
    const tenant = await createTenant(page, "Session Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("#password").fill("Correct-Horse-Battery-Staple-123!");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/dashboard|\/t\//);
  });
});
