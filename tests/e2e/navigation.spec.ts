import { expect, test } from "@playwright/test";
import {
  bootstrapTenant,
  createTenant,
  gotoHydrated,
  installVirtualAuthenticator,
  uniqueEmail,
  verificationCode,
} from "./helpers";

const primaryNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Primary" });

test.describe("top navigation", () => {
  test("navigates between every tenant section", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Nav Tenant");
    const base = `/t/${tenant.slug}`;

    for (const [label, path, heading] of [
      ["Overview", base, "Fleet overview"],
      ["Dashboards", `${base}/dashboards`, "Dashboards"],
      ["Devices", `${base}/devices`, "Devices"],
      ["Groups", `${base}/groups`, "Groups"],
      ["Policies", `${base}/policies`, "Policies"],
      ["Applications", `${base}/applications`, "Applications"],
      ["Settings", `${base}/settings`, "General"],
    ] as const) {
      await primaryNav(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(path.replaceAll(/[/\\^$*+?.()|[\]{}]/g, String.raw`\$&`)),
      );

      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
  });

  test("mounts exactly one application shell", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Shell Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);

    await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);

    await page.reload();
    await expect(page.locator("header")).toHaveCount(1);
  });

  test("sends an unknown tenant back to the dashboard", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Unknown Tenant");
    await gotoHydrated(page, "/t/not-a-tenant/devices");

    // The tenant guard replaces the invalid URL with /dashboard, which then
    // forwards to the remembered tenant. Checking the transient /dashboard URL
    // would race that second redirect, so assert the outcome the user sees:
    // the unknown id is gone and a real tenant (or the dashboard) is shown.
    await expect(page).not.toHaveURL(/not-a-tenant/, { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/dashboard|/t/${tenant.slug}`));

    // A missing tenant is a redirect, not an error state.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("refuses tenant work until the email code is verified", async ({ page }) => {
    const email = uniqueEmail("unverified");

    await installVirtualAuthenticator(page);
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.locator("#name").fill("Unverified User");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.locator("#verification-code")).toBeVisible({ timeout: 20_000 });

    // The account does not exist until the address is proven, so there is no
    // session to do tenant work with.
    const blocked = await page.evaluate(async () => (await fetch("/api/v1/tenants")).status);

    expect(blocked).toBe(401);

    const blockedCreate = await page.evaluate(async () => {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ name: "Blocked", slug: `blocked-${Date.now()}` }),
      });

      return response.status;
    });

    expect(blockedCreate).toBe(401);

    const code = await verificationCode(page, email);

    const registration = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/api/v1/completePasskeyRegistration"),
    );

    // The completed code submits without a button press.
    await page.locator("#verification-code").fill(code);
    expect((await registration).ok()).toBe(true);
    await page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 45_000 });

    // Proving the address is what unlocks the account: the created session is
    // already verified.
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.account.emailVerified).toBe(true);

    const allowed = await page.evaluate(async () => (await fetch("/api/v1/tenants")).status);
    expect(allowed).toBe(200);
  });

  test("opens the tenant switcher from an unscoped page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Switch Tenant");
    const second = await createTenant(page, "Second Tenant");

    await gotoHydrated(page, "/account");
    await page.getByRole("button", { name: "Switch tenant" }).click();
    const item = page.getByRole("menuitemradio", { name: /Second Tenant/i });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/t/${second.slug}`));

    // The URL is the source of truth after a reload.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/t/${second.slug}`));
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.some((entry: { id: string }) => entry.id === tenant.id)).toBe(true);
    expect(me.tenants.some((entry: { id: string }) => entry.id === second.id)).toBe(true);
  });

  test("remembers the last tenant from the switcher", async ({ page }) => {
    const first = await bootstrapTenant(page, "Remember One");
    const second = await createTenant(page, "Remember Two");

    await gotoHydrated(page, `/t/${second.id}/devices`);
    await gotoHydrated(page, "/dashboard");
    await page.getByRole("button", { name: "Switch tenant" }).click();
    await expect(page.getByRole("menuitemradio", { name: /Remember One/i })).toBeVisible();
    await page.getByRole("menuitemradio", { name: /Remember One/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${first.slug}`));
  });
});

test.describe("mobile navigation", () => {
  test("navigates from the mobile sidebar sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const tenant = await bootstrapTenant(page, "Mobile Tenant");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(primaryNav(page)).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups`));
    await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
  });
});
