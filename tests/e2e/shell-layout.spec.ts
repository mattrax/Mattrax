import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { bootstrapFreshTenant, bootstrapTenant, gotoHydrated } from "./helpers";

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const settingsNav = (page: Page) =>
  page.getByRole("navigation", { name: "Tenant settings", exact: true });

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

const settingsRects = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);

      if (!element) throw new Error(`Missing ${selector}`);

      const rect = element.getBoundingClientRect();

      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };

    return {
      masthead: box('[data-slot="settings-masthead"]'),
      content: box('[data-slot="settings-content"]'),
      title: box('[data-slot="settings-masthead"] h1'),
      firstPanelTitle: box('[data-slot="settings-content"] [role="region"][aria-labelledby] h2'),
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

test.describe("dashboard shell layout", () => {
  // One registration and one tenant back all seven original layout cases.
  test("covers shell geometry, settings stability and density, delayed chunks, preload and mobile shell", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tenant = await bootstrapTenant(page, "Shell Layout Tenant");

    // Original: "fills the window at 1100 and ultrawide widths"
    for (const viewport of [
      { width: 1100, height: 900 },
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

    // Original: "keeps the shell usable from the mobile navigation sheet"
    {
      await page.setViewportSize({ width: 500, height: 900 });
      await gotoHydrated(page, `/t/${tenant.slug}/devices`);

      await expect(page.locator("aside")).toBeHidden();
      await page.getByRole("button", { name: "Open navigation" }).click();

      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Devices", exact: true })).toBeVisible();
      await expect(
        sheet
          .getByRole("navigation", { name: "Tenant settings", exact: true })
          .getByRole("link", { name: "Settings", exact: true }),
      ).toBeVisible();

      await sheet.getByRole("link", { name: "Groups", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups$`));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator('[data-slot="app-header"]')).toHaveCount(1);
    }

    // Original: "keeps the header and sidebar mounted while settings tabs change"
    {
      await page.setViewportSize({ width: 1440, height: 900 });
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
    }

    // Original: "aligns and compacts the settings masthead with its content"
    {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoHydrated(page, `/t/${tenant.slug}/settings/attributes`);

      const masthead = page.locator('[data-slot="settings-masthead"]');
      const firstPanelTitle = page.getByRole("heading", { name: "Device attributes", exact: true });

      await expect(masthead).toBeVisible();
      await expect(firstPanelTitle).toBeVisible();

      const desktop = await settingsRects(page);

      expect(desktop.masthead.x).toBeCloseTo(desktop.content.x, 0);
      expect(desktop.masthead.width).toBeCloseTo(desktop.content.width, 0);
      expect(desktop.title.x).toBeCloseTo(desktop.firstPanelTitle.x, 0);
      expect(desktop.masthead.height).toBeLessThanOrEqual(112);
      expect(desktop.firstPanelTitle.y - desktop.masthead.bottom).toBeLessThanOrEqual(40);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(masthead).toBeVisible();
      await expect(firstPanelTitle).toBeVisible();

      const mobile = await settingsRects(page);

      expect(mobile.title.x).toBeCloseTo(mobile.firstPanelTitle.x, 0);
      expect(mobile.masthead.height).toBeLessThanOrEqual(128);
      expect(mobile.firstPanelTitle.y - mobile.masthead.bottom).toBeLessThanOrEqual(88);
      expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth);
    }

    // Original: "keeps the settings masthead, rail and draft while a child chunk loads"
    {
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoHydrated(page, `/t/${tenant.slug}/settings`);

      await page.getByLabel(/^Name/).fill("Delayed Settings Draft");
      const saveBar = page.getByRole("region", { name: "Tenant settings changes" });
      await expect(saveBar).toContainText("Unsaved tenant changes");

      let releaseExport!: () => void;
      const exportGate = new Promise<void>((resolve) => {
        releaseExport = resolve;
      });

      // The deployment export page is reachable from Migration, not from the
      // settings rail, so its chunk has not been preloaded. Hold it now that the
      // page is hydrated (a held preload can delay hydration itself).
      await page.route(
        (url) =>
          /\/settings\/migration\/export(?:\.tsx)?$/.test(url.pathname) ||
          /\/assets\/export-[^/]+\.js$/.test(url.pathname),
        async (route) => {
          await exportGate;
          await route.continue();
        },
      );

      // A real router click on an unlinked route: injecting the anchor avoids a
      // full document load while bypassing viewport preloading.
      await page.evaluate((href) => {
        const link = document.createElement("a");
        link.id = "delayed-settings-link";
        link.href = href;
        link.textContent = "Open export";
        document.body.append(link);
      }, `/t/${tenant.slug}/settings/migration/export`);

      const tabs = page.locator('nav[aria-label="Tenant settings sections"]');
      await page.locator("#delayed-settings-link").click();

      // The child chunk is still held: the settings layout must keep the rail and
      // the tenant profile draft mounted instead of handing the whole pane to a
      // loading fallback (or the shell boot state).
      await expect(
        page.getByRole("heading", { name: /^(General|Migration)$/ }).first(),
      ).toBeVisible();
      await expect(tabs).toBeVisible();
      await expect(saveBar).toContainText("Unsaved tenant changes");
      await expect(page.locator('[data-slot="app-header"]')).toHaveCount(1);

      releaseExport();
      await expect(page.getByRole("button", { name: "Export tenant", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Migration", exact: true }).first(),
      ).toBeVisible();
      await expect(saveBar).toContainText("Unsaved tenant changes");
    }

    // Original: "revalidates the cold preload once and does not refetch /me on navigation"
    {
      await page.waitForLoadState("networkidle");

      let meRequests = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/v1/me") meRequests += 1;
      });

      // A cold document paints from the SSR preload, then revalidates it exactly
      // once because its permission claims can be minutes old.
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
      expect(meRequests).toBe(1);

      meRequests = 0;
      await primaryNav(page).getByRole("link", { name: "Groups", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Groups", exact: true })).toBeVisible();

      await primaryNav(page).getByRole("link", { name: "Policies", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Policies", exact: true })).toBeVisible();

      await settingsNav(page).getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();

      expect(meRequests).toBe(0);
    }

    // Original: "moves Settings out of primary navigation and into the footer"
    {
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
    }
  });
});

test.describe("help and account menu", () => {
  // Two menu cases plus the /t landing redirect share one registration.
  test("links help, names the account item and routes /t with the query string", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = await bootstrapFreshTenant(page, "Help Menu Tenant");

    // Original: "links help to documentation and the configured support destination"
    await page.getByRole("button", { name: "Help and documentation" }).click();

    const documentation = page.getByRole("menuitem", { name: "Documentation", exact: true });
    await expect(documentation).toHaveAttribute("href", "/docs/");
    await expect(documentation).toHaveAttribute("target", "_self");
    await expect(page.getByRole("menuitem", { name: "Support", exact: true })).toHaveAttribute(
      "href",
      /^(mailto:|https?:)/,
    );
    await page.keyboard.press("Escape");

    // Original: "drops the alpha item and names the account item Account"
    await page.getByRole("button", { name: "Account menu" }).click();

    await expect(page.getByRole("menuitem", { name: "Account", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Account settings", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("menuitem", { name: "What alpha means", exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");

    // Original: "routes /t to the default tenant and keeps the query string"
    await gotoHydrated(page, "/t?from=e2e");

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}\\?from=e2e$`));
  });
});
