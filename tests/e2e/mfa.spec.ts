import { expect, test } from "@playwright/test";
import {
  confirmStepUp,
  freshTotpCode,
  gotoHydrated,
  register,
  signIn,
  stepUpGrant,
  totpCode,
} from "./helpers";

// Enrollment plus two step-boundary waits can exceed the default test timeout.
test.describe.configure({ timeout: 150_000 });

test.describe("authenticator MFA", () => {
  test("enrolls, requires a pending code, accepts a recovery code, and disables", async ({
    page,
  }) => {
    await register(page);
    await gotoHydrated(page, "/account");

    const card = page.locator("section", { hasText: "Authenticator app" });
    await card.getByRole("button", { name: /enable authenticator app/i }).click();
    await confirmStepUp(page);

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
    await signIn(page);

    await expect(page.getByText(/two-factor authentication required/i)).toBeVisible();

    const beforeMfa = await page.evaluate(async () => {
      const response = await fetch("/api/v1/me");

      return response.status;
    });

    expect(beforeMfa).toBe(401);
    await page.locator("#mfa-code").fill(await freshTotpCode(manualKey));
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(600);

    // A code can land on a replay-protected step boundary; retry once the way
    // a real user would.
    if (page.url().includes("/login")) {
      await page.locator("#mfa-code").fill(await freshTotpCode(manualKey));
      await page.getByRole("button", { name: /^continue$/i }).click();
    }

    await expect(page).toHaveURL(/\/dashboard|\/t\/|\/tenants\/new/);

    // A recovery code completes the same pending flow and is single use.
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page);
    await page.getByRole("button", { name: /recovery code/i }).click();
    await page.locator("#mfa-code").fill(recoveryCodes[0]!);
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForTimeout(600);

    if (page.url().includes("/login")) {
      await page.locator("#mfa-code").fill(recoveryCodes[1]!);
      await page.getByRole("button", { name: /^continue$/i }).click();
    }

    await expect(page).toHaveURL(/\/dashboard|\/t\/|\/tenants\/new/);

    // Regenerating and disabling confirm with a passkey and a fresh code.
    await gotoHydrated(page, "/account");
    const enabledCard = page.locator("section", { hasText: "Authenticator app" });
    await expect(enabledCard.getByText(/regenerate recovery codes/i)).toBeVisible();

    const regenerateForm = enabledCard.locator("form", {
      hasText: /regenerate recovery codes/i,
    });

    await regenerateForm.getByPlaceholder("000000").fill(await freshTotpCode(manualKey));
    await regenerateForm.getByRole("button", { name: /^regenerate$/i }).click();
    await confirmStepUp(page);
    await expect(enabledCard.getByText(/save these one-time recovery codes/i)).toBeVisible();

    const disableCard = page.locator("section", { hasText: "Authenticator app" });
    const disableForm = disableCard.locator("form", { hasText: /disable authenticator app/i });
    await disableForm.getByPlaceholder("000000").fill(await freshTotpCode(manualKey));
    await disableForm.getByRole("button", { name: /^disable$/i }).click();
    await confirmStepUp(page);
    await expect(disableCard.getByText(/security settings updated/i)).toBeVisible();

    await page.goto("/login", { waitUntil: "networkidle" });
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard|\/t\/|\/tenants\/new/);
    await expect(page.getByText(/two-factor authentication required/i)).toHaveCount(0);
  });

  test("allows requiring MFA once a passkey is enrolled", async ({ page }) => {
    await register(page);

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

      const body: { id: string } = await response.json();

      return body.id;
    });

    const grant = await stepUpGrant(page, "sso-policy");

    const enable = await page.evaluate(
      async ({ id, grant }) => {
        const response = await fetch(`/api/v1/tenants/${id}/sso`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-effect-auth-csrf": "1",
            "x-mattrax-step-up": grant,
          },
          body: JSON.stringify({ requireMfa: true }),
        });

        return { status: response.status, body: await response.text() };
      },
      { id: tenantId, grant },
    );

    expect(enable.status).toBe(200);
  });
});
