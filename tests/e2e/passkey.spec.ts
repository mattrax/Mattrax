import { expect, test } from "@playwright/test";
import {
  addVirtualAuthenticator,
  confirmStepUp,
  gotoHydrated,
  installVirtualAuthenticator,
  register,
  setVirtualAuthenticatorPresence,
  signIn,
  signOut,
} from "./helpers";

// Enrollment, sign-in and removal each include a step-up and a ceremony.
test.describe.configure({ timeout: 180_000 });

test.describe("passkeys", () => {
  test("enrolls a passkey, signs in with it, and removes it", async ({ page }) => {
    const { email } = await register(page);
    await gotoHydrated(page, "/account");
    // The registration passkey lives on the first virtual authenticator; a
    // second USB authenticator simulates a different device.
    const internal = await installVirtualAuthenticator(page);
    const usb = await addVirtualAuthenticator(page);
    await setVirtualAuthenticatorPresence(usb, false);

    // Step-up uses the original key; the enrollment itself is routed to the
    // new device once the request has left the browser.
    await page.route("**/api/v1/beginPasskeyEnrollment", async (route) => {
      await setVirtualAuthenticatorPresence(internal, false);
      await setVirtualAuthenticatorPresence(usb, true);
      await route.continue();
    });

    const card = page.locator("section", { hasText: "Passkeys" });
    await card.getByPlaceholder(/name this passkey/i).fill("E2E Passkey");
    // A concurrent auth write can make the server's credential persistence
    // fail transiently. That leaves the existing passkeys untouched and the
    // button in place, so retry the visible action instead of hanging on a
    // response that will never be ok.
    let enrolled = false;

    for (let attempt = 0; attempt < 3 && !enrolled; attempt++) {
      const completion = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/api/v1/completePasskeyEnrollment"),
      );

      await card.getByRole("button", { name: /add a passkey/i }).click();
      await confirmStepUp(page);

      const response = await completion;

      enrolled = response.ok();

      if (!enrolled && attempt === 2)
        throw new Error(`Passkey enrollment failed (${response.status()}): ${await response.text()}`);
    }

    await expect(card.getByText("E2E Passkey")).toBeVisible({ timeout: 30_000 });
    // The enrollment route disabled the original authenticator. Re-enable both
    // so sign-in works whichever eligible credential the browser selects.
    await setVirtualAuthenticatorPresence(internal, true);
    await setVirtualAuthenticatorPresence(usb, true);

    // Sign out, then use the passkey.
    await signOut(page);
    // Conditional UI would sign in silently from the login page before the
    // explicit email → passkey path can run, so use the helper that opts out
    // of it and exercises the visible flow.
    await signIn(page, email);
    await expect(page).toHaveURL(/\/dashboard|\/t\/|\/tenants\/new/);

    // Removing the last passkey needs another step-up and signs this session out.
    await gotoHydrated(page, "/account");
    const enabledCard = page.locator("section", { hasText: "Passkeys" });
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
