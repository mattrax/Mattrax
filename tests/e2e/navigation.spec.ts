import { expect, test } from "@playwright/test";
import { bootstrapTenant, createTenant } from "./helpers";

test.describe("sidebar navigation", () => {
  test("navigates between every tenant section", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Nav Tenant");
    const base = `/t/${tenant.id}`;

    for (const [label, path, heading] of [
      ["Dashboard", "/dashboard", tenant.id ? /Nav Tenant/ : /Dashboard/],
      ["Devices", `${base}/devices`, "Devices"],
      ["Groups", `${base}/groups`, "Groups"],
      ["Policies", `${base}/policies`, "Policies"],
      ["Enrollment", `${base}/settings/enrollment`, "Tenant settings"],
      ["Tenant settings", `${base}/settings`, "Tenant settings"],
    ] as const) {
      await page
        .locator("[data-slot=sidebar-content]")
        .getByRole("link", { name: label })
        .click();
      await expect(page).toHaveURL(new RegExp(path.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")));
      if (typeof heading === "string") {
        await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      }
    }
  });

  test("persists the collapsed sidebar across reloads", async ({ page }) => {
    await bootstrapTenant(page, "Collapse Tenant");
    const width = () =>
      page.locator("[data-slot=sidebar-container]").evaluate((el) => getComputedStyle(el).width);

    await page.locator("[data-slot=sidebar-trigger]").click();
    await expect.poll(width).toBe("48px");

    // Labels are hidden in icon mode.
    await expect(page.locator("[data-slot=sidebar-content] a span").first()).toBeHidden();

    await page.reload();
    await expect.poll(width).toBe("48px");

    // Tooltips still explain the icon-only navigation.
    await page.locator("[data-slot=sidebar-content] a").nth(1).hover();
    await expect(page.locator("[data-slot=tooltip-content]").first()).toBeVisible();
  });

  test("switches tenants and remembers the selection", async ({ page }) => {
    await bootstrapTenant(page, "First Tenant");
    const second = await createTenant(page, "Second Tenant");

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const trigger = page.locator("[data-slot=sidebar-header] [data-slot=dropdown-menu-trigger]");
    await trigger.click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /Second Tenant/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${second.id}/devices`));

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Second Tenant/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /Second Tenant/ })).toBeVisible();

    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.activeTenant.id).toBe(second.id);
  });
});
