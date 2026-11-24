import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

const settingsNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Tenant settings sections" });

test.describe("settings pane scrolling", () => {
  test("resets the content scroll and keeps the masthead fixed", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Scroll");
    const base = `/t/${tenant.slug}`;

    await gotoHydrated(page, `${base}/settings/legal`);
    await expect(page.getByText(/licence texts/)).toBeVisible();

    const pane = page.locator(".settings-sections");
    await pane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect
      .poll(async () => pane.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const before = await page
      .getByRole("heading", { name: "Legal", exact: true })
      .boundingBox();

    await settingsNav(page).getByRole("link", { name: "General", exact: true }).click();
    await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();

    await expect.poll(async () => pane.evaluate((element) => element.scrollTop)).toBe(0);

    const after = await page
      .getByRole("heading", { name: "General", exact: true })
      .boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // The masthead lives above the scrollport, so the section change does not
    // move it.
    expect(after!.y).toBeCloseTo(before!.y, 0);
  });
});

test.describe("settings section tabs", () => {
  test("follows the WAI-ARIA tabs keyboard pattern", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tabs");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/integrations`);

    const tablist = page.getByRole("tablist", { name: "Webhook views" });
    const endpoints = tablist.getByRole("tab", { name: "Endpoints" });
    const deliveries = tablist.getByRole("tab", { name: "Deliveries" });

    await endpoints.focus();
    await page.keyboard.press("ArrowRight");
    await expect(deliveries).toBeFocused();
    await expect(deliveries).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(endpoints).toBeFocused();

    await page.keyboard.press("End");
    await expect(deliveries).toBeFocused();

    await page.keyboard.press("Home");
    await expect(endpoints).toBeFocused();
    await expect(endpoints).toHaveAttribute("aria-selected", "true");
    await expect(endpoints).toHaveAttribute("tabindex", "0");
    await expect(deliveries).toHaveAttribute("tabindex", "-1");

    // Only the mounted panel is referenced by aria-controls.
    expect(await endpoints.getAttribute("aria-controls")).toBe("webhook-panel-endpoints");
    expect(await deliveries.getAttribute("aria-controls")).toBeNull();
  });
});
