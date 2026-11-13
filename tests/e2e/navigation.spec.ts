import { expect, test } from "@playwright/test";
import { bootstrapTenant, createTenant, gotoHydrated, PASSWORD, uniqueEmail } from "./helpers";

const primaryNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Primary" });

test.describe("top navigation", () => {
  test("navigates between every tenant section", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Nav Tenant");
    const base = `/t/${tenant.id}`;

    for (const [label, path, heading] of [
      ["Overview", base, /Nav Tenant/],
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

  test("shows one email verification reminder at a time", async ({ page }) => {
    // Register without confirming the email so the reminder is visible.
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.locator("#name").fill("Unverified User");
    await page.locator("#email").fill(uniqueEmail("unverified"));
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirm-password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 45_000 });
    await gotoHydrated(page, "/dashboard");
    await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(1);

    // Dismissing the reminder hides it for the rest of the session.
    await page.getByRole("button", { name: /dismiss email verification reminder/i }).click();
    await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Verify your email", { exact: true })).toHaveCount(0);
  });

  test("opens the workspace switcher from an unscoped page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Switch Tenant");
    const second = await createTenant(page, "Second Tenant");

    await gotoHydrated(page, "/dashboard");
    await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
    await page.getByRole("button", { name: "Switch workspace" }).click();
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

  test("remembers the last workspace from the switcher", async ({ page }) => {
    const first = await bootstrapTenant(page, "Remember One");
    const second = await createTenant(page, "Remember Two");

    await gotoHydrated(page, `/t/${second.id}/devices`);
    await gotoHydrated(page, "/dashboard");
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await expect(page.getByRole("menuitem", { name: /Remember One/i })).toBeVisible();
    await page.getByRole("menuitem", { name: /Remember One/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${first.id}`));
  });
});

test.describe("mobile navigation", () => {
  test("navigates from the scrollable top tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const tenant = await bootstrapTenant(page, "Mobile Tenant");
    await expect(page.getByRole("button", { name: "Switch workspace" })).toBeVisible();
    await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/groups`));
    await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();
  });
});
