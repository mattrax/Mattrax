import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

const settingsNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Tenant settings sections" });

async function expectWebhookView(page: Page, view: "endpoints" | "deliveries") {
  const tablist = page.getByRole("tablist", { name: "Webhook views" });
  const selected = tablist.getByRole("tab", {
    name: view === "deliveries" ? "Deliveries" : "Endpoints",
  });
  const other = tablist.getByRole("tab", {
    name: view === "deliveries" ? "Endpoints" : "Deliveries",
  });
  const panelId = "webhook-panel-" + view;
  const otherPanelId = "webhook-panel-" + (view === "deliveries" ? "endpoints" : "deliveries");

  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(other).toHaveAttribute("aria-selected", "false");
  await expect(selected).toHaveAttribute("tabindex", "0");
  await expect(other).toHaveAttribute("tabindex", "-1");
  await expect(selected).toHaveAttribute("aria-controls", panelId);
  await expect(other).not.toHaveAttribute("aria-controls");
  await expect(page.locator("#" + panelId)).toBeVisible();
  await expect(page.locator("#" + otherPanelId)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("view"))
    .toBe(view === "deliveries" ? "deliveries" : null);
  expect(new URL(page.url()).pathname).toMatch(/\/settings\/integrations$/);
}

test.describe("settings pane scrolling", () => {
  test("resets the content scroll and keeps the masthead fixed", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Scroll");
    const base = `/t/${tenant.slug}`;

    await gotoHydrated(page, `${base}/settings/legal`);
    await expect(page.getByText(/licence texts/)).toBeVisible();

    const pane = page.locator(".settings-sections");
    await pane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect.poll(async () => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const before = await page.getByRole("heading", { name: "Legal", exact: true }).boundingBox();

    await settingsNav(page).getByRole("link", { name: "General", exact: true }).click();
    await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();

    await expect.poll(async () => pane.evaluate((element) => element.scrollTop)).toBe(0);

    const after = await page.getByRole("heading", { name: "General", exact: true }).boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // The masthead lives above the scrollport, so the section change does not
    // move it.
    expect(after!.y).toBeCloseTo(before!.y, 0);
  });
});

test.describe("settings section tabs", () => {
  test("activates Endpoints and Deliveries on click", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tabs");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/integrations`);

    const tablist = page.getByRole("tablist", { name: "Webhook views" });
    const endpoints = tablist.getByRole("tab", { name: "Endpoints" });
    const deliveries = tablist.getByRole("tab", { name: "Deliveries" });

    await deliveries.click();
    await expectWebhookView(page, "deliveries");

    await endpoints.click();
    await expectWebhookView(page, "endpoints");
  });

  test("automatically activates tabs with arrows, Home and End", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tabs Keyboard");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/integrations`);

    const tablist = page.getByRole("tablist", { name: "Webhook views" });
    const endpoints = tablist.getByRole("tab", { name: "Endpoints" });
    const deliveries = tablist.getByRole("tab", { name: "Deliveries" });

    await endpoints.focus();
    await page.keyboard.press("ArrowRight");
    await expect(deliveries).toBeFocused();
    await expectWebhookView(page, "deliveries");

    await page.keyboard.press("ArrowLeft");
    await expect(endpoints).toBeFocused();
    await expectWebhookView(page, "endpoints");

    await page.keyboard.press("End");
    await expect(deliveries).toBeFocused();
    await expectWebhookView(page, "deliveries");

    await page.keyboard.press("Home");
    await expect(endpoints).toBeFocused();
    await expectWebhookView(page, "endpoints");

    await page.keyboard.press("ArrowLeft");
    await expect(deliveries).toBeFocused();
    await expectWebhookView(page, "deliveries");

    await page.keyboard.press("ArrowRight");
    await expect(endpoints).toBeFocused();
    await expectWebhookView(page, "endpoints");
  });

  test("restores the Deliveries view from its URL", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tabs URL");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/integrations?view=deliveries`);

    await expectWebhookView(page, "deliveries");
  });
});
