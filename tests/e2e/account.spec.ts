import { expect, test } from "@playwright/test";
import { bootstrapTenant, confirmStepUp, createTenant, gotoHydrated } from "./helpers";

test.describe("account", () => {
  test("updates the profile and manages API tokens", async ({ page }) => {
    await bootstrapTenant(page, "Account Tenant");
    await gotoHydrated(page, "/account");
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

    await page
      .getByRole("button", { name: /create token/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#token-name").fill("E2E token");
    await dialog.locator("#token-scope").selectOption("write");
    await dialog.locator("#token-expiry").selectOption("90");
    await dialog.getByRole("button", { name: /create token/i }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await expect(page.getByText("E2E token").first()).toBeVisible();
    await expect(page.getByText(/Read & write · All tenants/)).toBeVisible();

    const tokens = page.locator("section").filter({ hasText: "API tokens" });
    await tokens
      .getByRole("button", { name: /revoke/i })
      .first()
      .click();
    await confirmStepUp(page);
    await expect(tokens.getByText("Revoked").first()).toBeVisible();
  });

  test("creates a read-only tenant-bound token and enforces its limits", async ({
    page,
    request,
  }) => {
    const tenant = await bootstrapTenant(page, "Scoped Token Tenant");
    const other = await createTenant(page, "Scoped Other Tenant");
    await gotoHydrated(page, "/account");

    await page
      .getByRole("button", { name: /create token/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#token-name").fill("Read only tenant token");
    await dialog.locator("#token-scope").selectOption("read");
    await dialog.locator("#token-tenant").selectOption(tenant.id);
    await dialog.locator("#token-expiry").selectOption("never");
    await dialog.getByRole("button", { name: /create token/i }).click();
    await confirmStepUp(page);

    const code = page.locator("code").filter({ hasText: /^mtx_/ }).first();
    const token = (await code.textContent())?.trim();
    expect(token).toMatch(/^mtx_/);
    await expect(page.getByText(/Read only · Scoped Token Tenant/)).toBeVisible();

    const headers = { authorization: `Bearer ${token}` };
    const read = await request.get(`/api/v1/tenants/${tenant.id}/devices`, { headers });
    expect(read.status()).toBe(200);

    const write = await request.post(`/api/v1/tenants/${tenant.id}/policies`, {
      headers: { ...headers, "content-type": "application/json" },
      data: { name: "Should be rejected" },
    });

    expect(write.status()).toBe(403);

    const crossTenant = await request.get(`/api/v1/tenants/${other.id}/devices`, { headers });
    expect(crossTenant.status()).toBe(404);
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

    await gotoHydrated(page, "/account");
    await page.locator('input[placeholder="' + email + '"]').fill(email);
    await page.getByRole("button", { name: /delete account/i }).click();
    await expect(page).toHaveURL(/\/$/);

    // The deleted session can no longer authenticate.
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).status);
    expect(me).toBe(401);
  });
});
