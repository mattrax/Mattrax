import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  bootstrapFreshTenant,
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
  // Four cases share one registration, tenant and shell session.
  test("navigates tenant sections, keeps one shell, collapses the sidebar and guards unknown tenants", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tenant = await bootstrapFreshTenant(page, "Nav Tenant");
    const base = `/t/${tenant.slug}`;

    // Original: "navigates between every tenant section"
    for (const [label, path, heading] of [
      ["Overview", base, "Fleet overview"],
      ["Dashboards", `${base}/dashboards`, "Dashboards"],
      ["Devices", `${base}/devices`, "Devices"],
      ["Groups", `${base}/groups`, "Groups"],
      ["Policies", `${base}/policies`, "Policies"],
      ["Applications", `${base}/applications`, "Applications"],
    ] as const) {
      await primaryNav(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(path.replaceAll(/[/\\^$*+?.()|[\]{}]/g, String.raw`\$&`)),
      );

      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }

    // Settings sits in the sidebar footer above the account row, not among the
    // daily sections.
    await expect(primaryNav(page).getByRole("link", { name: "Settings", exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("navigation", { name: "Tenant settings", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${base}/settings$`));
    await expect(page.getByRole("heading", { name: "General", exact: true }).first()).toBeVisible();

    // Original: "mounts exactly one application shell"
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);

    await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);

    await page.reload();
    await expect(page.locator("header")).toHaveCount(1);

    // Original: "collapses the sidebar to icons and remembers the choice"
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);

    const aside = page.locator("aside");
    await expect(aside).toHaveCSS("width", "244px");

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(aside).toHaveCSS("width", "64px");
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(
      primaryNav(page).getByRole("link", { name: "Devices", exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(aside).toHaveCSS("width", "64px");

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(aside).toHaveCSS("width", "244px");

    // Original: "sends an unknown tenant back to the dashboard". The shared
    // tenant is the remembered one, so the guard redirects back to it.
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

  // Verification is a distinct identity flow, so it keeps the original setup.
  test("refuses tenant work until the email code is verified", async ({ page }) => {
    const email = uniqueEmail("unverified");

    await installVirtualAuthenticator(page);
    await gotoHydrated(page, "/register");
    await page.locator("#name").fill("Unverified User");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.locator("#verification-code")).toBeVisible({ timeout: 20_000 });

    // The account does not exist until the address is proven, so there is no
    // session to do tenant work with.
    const blocked = await page.evaluate(async () => (await fetch("/api/v1/tenants")).status);

    expect(blocked).toBe(401);

    const slug = `blocked-${randomUUID().slice(0, 8)}`;
    const blockedCreate = await page.evaluate(async (slug) => {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ name: "Blocked", slug }),
      });

      return response.status;
    }, slug);

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

  // Both switcher cases use the same session and two tenants.
  test("opens the tenant switcher and remembers the last tenant", async ({ page }) => {
    test.setTimeout(120_000);
    const tenant = await bootstrapTenant(page, "Switch Tenant");
    const second = await createTenant(page, "Second Tenant");

    // Original: "opens the tenant switcher from an unscoped page"
    await gotoHydrated(page, "/account");
    await page.getByRole("button", { name: "Switch tenant" }).click();
    const item = page.getByRole("menuitemradio", { name: /Second Tenant/i });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/t/${second.slug}`));
    await expect(page.locator("#main")).toBeFocused();

    // The URL is the source of truth after a reload.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/t/${second.slug}`));
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.some((entry: { id: string }) => entry.id === tenant.id)).toBe(true);
    expect(me.tenants.some((entry: { id: string }) => entry.id === second.id)).toBe(true);

    // Original: "remembers the last tenant from the switcher"
    await gotoHydrated(page, `/t/${second.id}/devices`);
    await gotoHydrated(page, "/dashboard");
    await page.getByRole("button", { name: "Switch tenant" }).click();
    await expect(page.getByRole("menuitemradio", { name: /Switch Tenant/i })).toBeVisible();
    await page.getByRole("menuitemradio", { name: /Switch Tenant/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}`));
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
    await expect(page.locator("#main")).toBeFocused();
  });

  test("keeps the mobile tenant menu in the viewport and scrolls to lower tenants", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootstrapFreshTenant(page, "Menu Tenant");

    const tenants = [];
    const targetName = `Tenant 23 ${randomUUID().slice(0, 8)}`;

    for (let index = 0; index < 24; index++) {
      tenants.push(
        await createTenant(
          page,
          index === 23 ? targetName : `Tenant ${String(index).padStart(2, "0")}`,
        ),
      );
    }

    // `createTenant` calls the API directly rather than going through the
    // dashboard's mutation, so the already-fetched account cache still knows
    // only the first tenant. Reload to read the switcher from a fresh cache.
    await gotoHydrated(page, "/dashboard");

    // The dashboard redirect can still be settling when the first press lands.
    // Wait for the redirect to finish, then open the sheet exactly once.
    await page.waitForLoadState("networkidle");
    const switchTenant = page.getByRole("button", { name: /Switch tenant/ });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(switchTenant).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              ).length,
        ),
      )
      .toBe(0);
    await switchTenant.click();

    const menu = page.locator('[data-slot="menu-content"]');
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();

    expect(box).not.toBeNull();
    if (!box) throw new Error("Tenant menu did not render");

    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await expect
      .poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    const target = menu.getByRole("menuitemradio", { name: new RegExp(targetName) });
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    await target.click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenants[23].slug}`));
    await expect(page.locator("#main")).toBeFocused();
  });
});
