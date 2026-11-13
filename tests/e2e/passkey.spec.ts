import { expect, test } from "@playwright/test";
import { confirmStepUp, gotoHydrated, installVirtualAuthenticator, register } from "./helpers";

// Enrollment, sign-in and removal each include a step-up and a ceremony.
test.describe.configure({ timeout: 180_000 });

test.describe("passkeys", () => {
  test("enrolls a passkey, signs in with it, and removes it", async ({ page }) => {
    await register(page);
    await installVirtualAuthenticator(page);
    await gotoHydrated(page, "/account");

    const card = page.locator("section", { hasText: "Multi-factor authentication" });
    await card.getByPlaceholder(/name this passkey/i).fill("E2E Passkey");
    await card.getByRole("button", { name: /add a passkey/i }).click();
    await confirmStepUp(page);
    await expect(card.getByText("E2E Passkey")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(/last used/i)).toBeVisible();

    // Sign out, then use the passkey instead of a password.
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await page.waitForURL(/\/dashboard|\/t\/|\/tenants\/new/, { timeout: 45_000 });

    // Removing the last passkey needs another step-up and signs this session out.
    await gotoHydrated(page, "/account");
    const enabledCard = page.locator("section", { hasText: "Multi-factor authentication" });
    await enabledCard
      .getByRole("button", { name: /^remove$/i })
      .first()
      .click();
    await confirmStepUp(page);
    await expect(enabledCard.getByRole("button", { name: /sign in again/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
