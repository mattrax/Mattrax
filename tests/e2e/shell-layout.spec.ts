import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const settingsNav = (page: Page) => page.getByRole("navigation", { name: "Tenant settings" });

const shellRects = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);

      if (!element) throw new Error(`Missing ${selector}`);

      const box = element.getBoundingClientRect();

      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };

    return {
      shell: rect('[data-slot="app-shell"]'),
      frame: rect('[data-slot="app-frame"]'),
      width: document.body.getBoundingClientRect().width,
      height: window.innerHeight,
    };
  });

test.describe("dashboard shell layout", () => {
  test("fills the window at 1024 and ultrawide widths", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Frame Tenant");

    for (const viewport of [
      { width: 1024, height: 900 },
      { width: 2200, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoHydrated(page, `/t/${tenant.slug}/devices`);

      const rects = await shellRects(page);
      const expected = {
        x: 0,
        y: 0,
        width: rects.width,
        height: rects.height,
      };

      // The document reserves a stable scrollbar gutter, so "the window edge"
      // is the document's content width rather than the raw viewport. The shell
      // must not add any inset of its own (no outer padding or max-width frame).
      expect(rects.shell).toEqual(expected);
      expect(rects.frame).toEqual(expected);
      expect(rects.width).toBeLessThanOrEqual(viewport.width);
      await expect(page.locator("aside")).toBeVisible();
      await expect(page.locator('[data-slot="app-header"]')).toHaveCount(1);
    }
  });

  test("keeps the header and sidebar mounted while settings tabs change", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Stable Shell Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/settings`);

    await page.evaluate(() => {
      const state = { removed: 0 };
      (window as Window & { __shellRemovals?: { removed: number } }).__shellRemovals = state;

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (
              node instanceof Element &&
              (node.matches('[data-slot="app-header"]') ||
                node.querySelector('[data-slot="app-header"]') !== null)
            )
              state.removed += 1;
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');

    for (const [tab, heading, segment] of [
      ["Administrators", "Administrators", "administrators"],
      ["Identity", "Identity", "identity"],
      ["Audit log", "Audit log", "audit"],
      ["General", "General", ""],
    ] as const) {
      await tabs.getByRole("link", { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/settings(?:/${segment})?$`));
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await expect(primaryNav(page)).toBeVisible();
      await expect(page.locator('[data-slot="app-header"]')).toHaveCount(1);
    }

    const removed = await page.evaluate(
      () => (window as Window & { __shellRemovals?: { removed: number } }).__shellRemovals?.removed,
    );

    expect(removed).toBe(0);
  });

  test("keeps the shell usable from the mobile navigation sheet", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Mobile Shell Tenant");
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);

    await expect(page.locator("aside")).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Devices", exact: true })).toBeVisible();
    await expect(
      sheet
        .getByRole("navigation", { name: "Tenant settings" })
        .getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();

    await sheet.getByRole("link", { name: "Groups", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-slot="app-header"]')).toHaveCount(1);
  });

  test("moves Settings out of primary navigation and into the footer", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Placement Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);

    await expect(primaryNav(page).getByRole("link", { name: "Settings", exact: true })).toHaveCount(
      0,
    );
    await expect(
      settingsNav(page).getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(primaryNav(page).getByText("Tenant", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(
      settingsNav(page).getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
  });
});

test.describe("help and account menu", () => {
  test("links help to documentation and the configured support destination", async ({ page }) => {
    await bootstrapTenant(page, "Help Tenant");

    await page.getByRole("button", { name: "Help and documentation" }).click();

    const documentation = page.getByRole("menuitem", { name: "Documentation", exact: true });
    await expect(documentation).toHaveAttribute("href", "/docs/");
    await expect(documentation).toHaveAttribute("target", "_self");
    await expect(page.getByRole("menuitem", { name: "Support", exact: true })).toHaveAttribute(
      "href",
      /^(mailto:|https?:)/,
    );
  });

  test("drops the alpha item and names the account item Account", async ({ page }) => {
    await bootstrapTenant(page, "Menu Copy Tenant");

    await page.getByRole("button", { name: "Account menu" }).click();

    await expect(page.getByRole("menuitem", { name: "Account", exact: true })).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Account settings", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "What alpha means", exact: true }),
    ).toHaveCount(0);
  });
});

test("routes /t to the default tenant and keeps the query string", async ({ page }) => {
  const tenant = await bootstrapTenant(page, "Landing Tenant");

  await gotoHydrated(page, "/t?from=e2e");

  await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}\\?from=e2e$`));
});
