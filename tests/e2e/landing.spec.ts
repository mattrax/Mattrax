import { expect, test } from "@playwright/test";

/**
 * The marketing shell is the first page most people meet, and it is the only
 * place where the header is not inside the dashboard app shell. These checks
 * cover the chrome that keyboard and screen-reader users rely on.
 */
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
