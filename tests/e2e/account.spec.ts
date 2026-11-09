import { expect, test } from "@playwright/test";
import { bootstrapTenant } from "./helpers";

test.describe("account", () => {
  test("updates the profile and manages API tokens", async ({ page }) => {
    await bootstrapTenant(page, "Account Tenant");
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByText("Active sessions")).toBeVisible();
    await expect(page.getByText("This session")).toBeVisible();

    const name = page.locator("#name");
    await name.fill("Renamed User");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const body = (await (await fetch("/api/v1/me")).json()) as { user: { name: string } };
          return body.user.name;
        }),
      )
      .toBe("Renamed User");

    await page.locator("#token-name").fill("E2E token");
    await page.getByRole("button", { name: /create token/i }).click();
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await expect(page.getByText("E2E token").first()).toBeVisible();

    const tokens = page.locator("section").filter({ hasText: "API tokens" });
    await tokens
      .getByRole("button", { name: /revoke/i })
      .first()
      .click();
    await expect(tokens.getByText("Revoked").first()).toBeVisible();
  });
});

test.describe("account deletion", () => {
  test("deletes the account and its solo tenant", async ({ page }) => {
    const { email } = await import("./helpers").then((helpers) =>
      helpers.register(page).then(async (result) => {
        await helpers.createTenant(page, "Delete Me Tenant");
        return result;
      }),
    );
    await page.goto("/account", { waitUntil: "networkidle" });
    await page.locator('input[placeholder="' + email + '"]').fill(email);
    await page.getByRole("button", { name: /delete account/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // The deleted session can no longer authenticate.
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).status);
    expect(me).toBe(401);
  });
});
