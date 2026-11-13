import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, createTenant, gotoHydrated } from "./helpers";

const openPalette = async (page: import("@playwright/test").Page) => {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const input = page.locator('input[role="combobox"]');
  await expect(input).toBeVisible();

  return input;
};

test.describe("command palette", () => {
  test("opens with Cmd+K, navigates, and remembers entities", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Tenant");
    await createTenant(page, "Palette Extra");

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    // The global shortcut is registered from `onSettled`, which runs after the
    // first router transition settles — slightly after the hydration flag.
    await page.waitForTimeout(1000);
    const input = await openPalette(page);

    await input.fill("settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/settings`));

    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Quarterly Ops" }),
    });
    await openPalette(page);
    await input.fill("Quarterly");
    // Entity results come from the server search endpoint after the debounce.
    await expect(page.getByRole("option", { name: /Quarterly Ops/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
  });

  test("finds settings, people and constructs device queries", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Discovery");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    const input = await openPalette(page);
    await input.fill("apns");
    await expect(page.getByRole("option", { name: /Apple push delivery/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Device management/ })).toBeVisible();

    await input.fill("E2E User");
    await expect(page.getByRole("option", { name: /E2E User/ })).toBeVisible();

    await input.fill("devices critical apple");
    await expect(page.getByRole("option", { name: /Show devices: critical apple/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/devices\?health=critical&proto=apple/);
  });

  test("exposes actions with keyboard shortcuts", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Actions");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    const input = await openPalette(page);
    await expect(page.getByRole("option", { name: /Account settings/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Create policy/ })).toBeVisible();

    const shortcut = await page
      .getByRole("option", { name: /Account settings/ })
      .locator("kbd")
      .innerText();

    expect(shortcut).toMatch(/[,]/);
    await page.keyboard.press("Escape");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await expect(page).toHaveURL(/\/account$/);
  });

  test("navigates with sequence shortcuts", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Sequences");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(900);

    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/policies$`));
  });

  test("registers policy designer actions and removes them on unmount", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Palette Designer");

    const policy = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/policies`, {
      method: "POST",
      body: JSON.stringify({ name: "Command Policy" }),
    });

    await gotoHydrated(page, `/t/${tenant.id}/policies/${policy.id}/design`);
    await page.waitForTimeout(1600);

    const input = await openPalette(page);
    await expect(page.getByRole("option", { name: /Save policy/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Export policy/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // The registered shortcut drives the same save action as the header button.
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.waitForTimeout(500);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
    await expect(page).toHaveURL(new RegExp(`/policies/${policy.id}$`), { timeout: 20_000 });

    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await page.waitForTimeout(600);
    await openPalette(page);
    await input.fill("save policy");
    await expect(page.getByRole("option", { name: /Save policy/ })).toHaveCount(0);
  });
});
