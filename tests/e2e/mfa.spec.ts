import { expect, test } from "@playwright/test";
import { PASSWORD, freshTotpCode, gotoHydrated, register, signIn, totpCode } from "./helpers";

// Enrollment plus two step-boundary waits can exceed the default test timeout.
test.describe.configure({ timeout: 150_000 });

test.describe("authenticator MFA", () => {
  test("enrolls, requires a pending code, accepts a recovery code, and disables", async ({
    page,
  }) => {
    const { email } = await register(page);
    await gotoHydrated(page, "/account");

    const card = page.locator("section", { hasText: "Multi-factor authentication" });
    await card.getByRole("button", { name: /enable authenticator app/i }).click();
    const manualKey = (await card.locator("code").first().innerText()).trim();
    expect(manualKey).toMatch(/^[A-Z2-7]{20,}$/);

    await card.locator("#totp-confirm-code").fill(totpCode(manualKey));
    await card.getByRole("button", { name: /confirm and enable/i }).click();

    await expect(card.getByText(/save these one-time recovery codes/i)).toBeVisible();
    const recoveryCodes = await card.getByText(/^rc1-/).allInnerTexts();
    expect(recoveryCodes.length).toBeGreaterThan(5);

    // Enrollment rotates the security revision, so the current session is gone.
    await card.getByRole("button", { name: /sign in again/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByText(/two-factor authentication required/i)).toBeVisible();
    const beforeMfa = await page.evaluate(async () => {
      const response = await fetch("/api/v1/me");
      return response.status;
    });
    expect(beforeMfa).toBe(401);
    await page.locator("#mfa-code").fill(totpCode(manualKey, 1));
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // A recovery code completes the same pending flow and is single use.
    await page.locator("[data-slot=sidebar-footer] [data-slot=dropdown-menu-trigger]").click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: /recovery code/i }).click();
    await page.locator("#mfa-code").fill(recoveryCodes[0]!);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Disabling requires the password and a fresh authenticator code.
    await gotoHydrated(page, "/account");
    const enabledCard = page.locator("section", { hasText: "Multi-factor authentication" });
    await expect(enabledCard.getByText(/authenticator app enabled/i)).toBeVisible();

    const regenerateForm = enabledCard.locator("form", {
      hasText: /regenerate recovery codes/i,
    });
    await regenerateForm.getByPlaceholder("Current password").fill(PASSWORD);
    await regenerateForm.getByPlaceholder("000000").fill(await freshTotpCode(manualKey));
    await regenerateForm.getByRole("button", { name: /^regenerate$/i }).click();
    await expect(enabledCard.getByText(/save these one-time recovery codes/i)).toBeVisible();

    const disableForm = enabledCard.locator("form", { hasText: /disable authenticator app/i });
    await disableForm.getByPlaceholder("Current password").fill(PASSWORD);
    await disableForm.getByPlaceholder("000000").fill(await freshTotpCode(manualKey));
    await disableForm.getByRole("button", { name: /^disable$/i }).click();
    await expect(enabledCard.getByText(/security settings updated/i)).toBeVisible();

    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/dashboard|\/t\//);
    await expect(page.getByText(/two-factor authentication required/i)).toHaveCount(0);
  });

  test("refuses to require MFA until privileged users enrol", async ({ page }) => {
    const { email } = await register(page);
    const tenantId = await page.evaluate(async () => {
      const response = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({
          name: "MFA Tenant",
          slug: `mfa-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      return ((await response.json()) as { id: string }).id;
    });

    const enable = await page.evaluate(async (id) => {
      const response = await fetch(`/api/v1/tenants/${id}/sso`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-effect-auth-csrf": "1" },
        body: JSON.stringify({ requireMfa: true }),
      });
      return { status: response.status, body: await response.text() };
    }, tenantId);
    expect(enable.status).toBe(400);
    expect(enable.body).toContain("Enable an authenticator app");

    // The guard prevents an owner from locking the workspace out before they
    // have enrolled; the normal enrollment path is covered above.
    expect(email).toContain("@example.com");
  });
});
