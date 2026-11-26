import { expect, test } from "@playwright/test";
import { api, bootstrapSession, gotoHydrated } from "./helpers";

const preview = (page: import("@playwright/test").Page) =>
  page.locator('[data-slot="hover-card-content"]:visible');

/**
 * Entity links preview their row on hover and on keyboard focus. The preview is
 * supplemental: everything in it is also on the row or the page it links to, so
 * the card never traps focus or intercepts the click.
 */
test.describe("entity hover cards", () => {
  test("a policy link previews scope, delivery and priority", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Preview Policies");

    await api(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({
        name: "Preview baseline",
        notes: "Security settings for every Mac.",
        priority: 7,
      }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/policies`);
    await page.getByRole("link", { name: "Preview baseline" }).hover();

    const card = preview(page);

    await expect(card).toBeVisible();
    // The card is wired as the link's description, not as a second control.
    await expect(card).toHaveAttribute("role", "tooltip");
    const link = page.getByRole("link", { name: "Preview baseline" });

    await expect(link).toHaveAttribute("aria-describedby", (await card.getAttribute("id")) ?? "");
    await expect(card).toContainText("Preview baseline");
    await expect(card).toContainText("Security settings for every Mac.");
    await expect(card).toContainText("Priority");
    await expect(card).toContainText("7");
  });

  test("a group link previews membership and counts", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Preview Groups");

    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Preview fleet", notes: "Hardware that leaves the office." }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/groups`);
    await page.getByRole("link", { name: "Preview fleet" }).hover();

    const card = preview(page);

    await expect(card).toBeVisible();
    await expect(card).toContainText("Hardware that leaves the office.");
    await expect(card).toContainText("Manual");
    await expect(card).toContainText("Devices");
  });

  test("a person previews role, access and join date", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Preview People");

    await gotoHydrated(page, `/t/${tenant.slug}/settings/administrators`);

    const row = page.locator("li").filter({ hasText: "@example.com" }).first();

    await row.locator('[data-slot="hover-card-trigger"]').hover();

    const card = preview(page);

    await expect(card).toBeVisible();
    await expect(card).toContainText("Access");
    await expect(card).toContainText("Built-in role");
    await expect(card).toContainText("Joined");
  });

  test("keyboard focus opens the preview and Escape closes it without navigating", async ({
    page,
  }) => {
    const { tenant } = await bootstrapSession(page, "Preview Keyboard");

    await api(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({ name: "Keyboard policy" }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/policies`);

    // A real Tab sets the keyboard modality the primitive requires; focusing
    // the link then opens the card without moving focus into it.
    await page.keyboard.press("Tab");
    const link = page.getByRole("link", { name: "Keyboard policy" });

    await link.focus();

    const card = preview(page);

    await expect(card).toBeVisible();
    await expect(link).toBeFocused();

    const before = page.url();

    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    expect(page.url()).toBe(before);

    // The preview never takes the click: following the link still navigates.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/policies/[^/]+$`));
  });
});
