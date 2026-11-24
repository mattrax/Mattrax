import { expect, test } from "@playwright/test";
import { gotoHydrated, register } from "./helpers";

/** The landing page is a cacheable shell; bust the local/edge cache per test. */
const landingUrl = () => `/?e2e=${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * The marketing shell is the first page most people meet, and it is the only
 * place where the header is not inside the dashboard app shell. These checks
 * cover the chrome that keyboard and screen-reader users rely on.
 */
test.describe("landing without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("renders a real signed-out primary CTA in the server HTML", async ({ page }) => {
    await page.goto(landingUrl(), { waitUntil: "domcontentloaded" });

    const cta = page.getByRole("link", { name: "Start free", exact: true }).first();

    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/register");
  });
});

test.describe("landing auth state", () => {
  test("keeps the mobile menu neutral while the session is pending", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route("**/api/v1/getSession", async (route) => {
      await gate;
      await route.continue();
    });

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(landingUrl(), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");

      await page.getByRole("button", { name: "Open navigation menu" }).click();
      const menu = page.locator("#landing-site-menu");
      await expect(menu).toBeVisible();

      // No wrong destination is offered before the session is known.
      await expect(
        menu.getByRole("link", { name: "Create an account", exact: true }),
      ).toHaveCount(0);
      await expect(
        menu.getByRole("link", { name: "Open dashboard", exact: true }),
      ).toHaveCount(0);
      await expect(menu.getByRole("link", { name: "Start free", exact: true })).toHaveCount(0);

      release();
      await expect(menu.getByRole("link", { name: "Start free", exact: true })).toBeVisible();
    } finally {
      release();
      await page.unroute("**/api/v1/getSession");
    }
  });

  test("shows the registration CTA to a signed-out visitor", async ({ page }) => {
    await page.context().clearCookies();
    await gotoHydrated(page, landingUrl());

    await expect(page.getByRole("link", { name: "Start free", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open dashboard", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign up", exact: true })).toHaveCount(0);
  });

  test("swaps marketing and auth CTAs for a signed-in visitor", async ({ page }) => {
    await register(page);
    await gotoHydrated(page, landingUrl());

    await expect(
      page.getByRole("link", { name: "Open dashboard", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Start free", exact: true })).toHaveCount(0);

    await gotoHydrated(page, "/login");
    await expect(page.getByText("Already signed in.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign up", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open dashboard", exact: true }).first()).toBeVisible();

    await gotoHydrated(page, "/register");
    await expect(
      page.getByText(/You're already signed in as/, { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open dashboard", exact: true }).first()).toBeVisible();
  });
});

test.describe("landing chrome", () => {
  test("offers a skip link that moves focus past the header", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const skip = page.getByRole("link", { name: "Skip to content" });

    // Visually hidden until focused.
    await skip.focus();
    await expect(skip).toBeVisible();
    await expect(skip).toBeFocused();

    await skip.click();
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("labels the primary navigation", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const primary = page.getByRole("navigation", { name: "Primary" });

    await expect(primary).toBeVisible();
    await expect(primary.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
  });

  test("opens the mobile menu and closes it with Escape", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });

    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    const menu = page.getByRole("navigation", { name: "Site" });

    await expect(trigger).toBeVisible();
    await expect(menu).toBeHidden();

    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();

    // Native popover light dismiss: Escape closes without a JS listener.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});
