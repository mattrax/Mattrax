import { expect, test } from "@playwright/test";
import { bootstrapTenant, createTenant, gotoHydrated, PASSWORD, uniqueEmail } from "./helpers";

const primaryNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Primary" });

test.describe("top navigation", () => {
  test("navigates between every tenant section", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Nav Tenant");
    const base = `/t/${tenant.id}`;

    for (const [label, path, heading] of [
      ["Overview", base, "Device health"],
      ["Devices", `${base}/devices`, "Devices"],
      ["Groups", `${base}/groups`, "Groups"],
      ["Policies", `${base}/policies`, "Policies"],
      ["Applications", `${base}/applications`, "Applications"],
      ["Software", `${base}/software`, "Software"],
      ["Enrollment", `${base}/settings/enrollment`, "Settings"],
      ["Settings", `${base}/settings`, "Settings"],
    ] as const) {
      await primaryNav(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")));
      if (typeof heading === "string") {
        await expect(
          page.getByRole("heading", { name: heading, exact: true }).first(),
        ).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      }
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

  test("keeps unverified accounts out of the dashboard", async ({ page }) => {
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.locator("#name").fill("Unverified User");
    await page.locator("#email").fill(uniqueEmail("unverified"));
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm-password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.locator("#verification-code")).toBeVisible({ timeout: 20_000 });

    // The API refuses tenant work until the address is verified.
    const blocked = await page.evaluate(async () => {
      const response = await fetch("/api/v1/tenants", { method: "GET" });
      return response.status;
    });
    expect(blocked).toBe(403);
    const blockedCreate = await page.evaluate(async () => {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ name: "Blocked", slug: `blocked-${Date.now()}` }),
      });
      return response.status;
    });
    expect(blockedCreate).toBe(403);

    await gotoHydrated(page, "/dashboard");
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  });

  test("opens the tenant switcher from an unscoped page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Switch Tenant");
    const second = await createTenant(page, "Second Tenant");

    await gotoHydrated(page, "/account");
    await page.getByRole("button", { name: "Switch tenant" }).click();
    const item = page.getByRole("menuitem", { name: /Second Tenant/i });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/t/${second.id}`));

    // The URL is the source of truth after a reload.
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/t/${second.id}`));
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
    await expect(page.getByRole("menuitem", { name: /Remember One/i })).toBeVisible();
    await page.getByRole("menuitem", { name: /Remember One/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${first.id}`));
  });
});

test.describe("mobile navigation", () => {
  test("navigates from the scrollable top tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const tenant = await bootstrapTenant(page, "Mobile Tenant");
    await expect(page.getByRole("button", { name: "Switch tenant" })).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/groups`));
    await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
  });
});
