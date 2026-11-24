import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createTenant, gotoHydrated, register } from "./helpers";

const settingsNav = (page: Page) =>
  page.getByRole("navigation", { name: "Tenant settings sections" });

test.describe("settings breadcrumbs", () => {
  test("labels cold fresh-tenant deep links without waiting for tenant data", async ({ page }) => {
    test.setTimeout(120_000);

    await register(page);
    const tenant = await createTenant(page, "Settings Breadcrumb Tenant");
    const base = `/t/${tenant.slug}/settings`;
    const sections = [
      ["billing", "Billing"],
      ["administrators", "Administrators"],
      ["identity", "Identity"],
      ["enrollment", "Enrollment"],
      ["migration", "Migration"],
      ["audit", "Audit log"],
      ["integrations", "Integrations"],
    ] as const;

    // Keep the signed-in claims, but remove the SSR/cached tenant snapshot.
    // The breadcrumb must come from the route while the tenant guard waits.
    await page.addInitScript(() => {
      let session: unknown;

      Object.defineProperty(window, "__MATTRAX_SESSION__", {
        configurable: true,
        enumerable: true,
        get: () => session,
        set: (value: unknown) => {
          if (value !== null && typeof value === "object") Reflect.deleteProperty(value, "me");
          session = value;
        },
      });
    });
    await page.evaluate(() => localStorage.clear());

    let releaseMe!: () => void;
    const meGate = new Promise<void>((resolve) => {
      releaseMe = resolve;
    });
    const mePath = /\/api\/v1\/me(?:\?|$)/;
    await page.route(mePath, async (route) => {
      await meGate;
      await route.continue();
    });

    try {
      const meRequest = page.waitForRequest(mePath);
      await page.goto(`${base}/billing`, { waitUntil: "domcontentloaded" });
      await meRequest;

      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Settings · Billing");
      await expect(breadcrumb.getByRole("link")).toHaveCount(0);
    } finally {
      releaseMe();
      await page.unroute(mePath);
    }

    for (const [segment, label] of sections) {
      await gotoHydrated(page, `${base}/${segment}`);

      const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
      await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(`Settings · ${label}`);
      await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();
      await expect(
        settingsNav(page).getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("aria-current", "page");
    }
  });
});
