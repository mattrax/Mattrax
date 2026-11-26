import { expect, test } from "@playwright/test";
import { bootstrapTenant, confirmStepUp, createTenant, gotoHydrated } from "./helpers";

test.describe("account", () => {
  test("updates the profile and manages API tokens", async ({ page }) => {
    await bootstrapTenant(page, "Account Tenant");
    await gotoHydrated(page, "/account");
    // The section heading, not "No active sessions were found" in the
    // pre-fetch state: `getByText` matches substrings case-insensitively.
    await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
    await expect(page.getByText("This session")).toBeVisible();

    const name = page.locator("#name");
    await name.fill("Renamed User");
    await page
      .getByRole("region", { name: "Display name" })
      .getByRole("button", { name: /^Save$/ })
      .click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const body: { account: { name: string } } = await (await fetch("/api/v1/me")).json();

          return body.account.name;
        }),
      )
      .toBe("Renamed User");

    await page
      .getByRole("button", { name: /create token/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#token-name").fill("E2E token");
    await dialog.getByRole("button", { name: "All access", exact: true }).click();
    await dialog.locator("#token-expiry").selectOption("90");
    await dialog.getByRole("button", { name: /create token/i }).click();
    await confirmStepUp(page);
    await expect(page.getByText("Copy this token now")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("E2E token").first()).toBeVisible();
    await expect(page.getByText(/All permissions · All tenants/)).toBeVisible();

    const tokens = page.getByRole("region", { name: "API tokens" });
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
    await dialog.getByRole("button", { name: "Read", exact: true }).first().click();
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
  const openDeletionPage = async (page: import("@playwright/test").Page, email: string) => {
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete your account?" })).toBeVisible();
    await dialog.getByLabel("Type your email address to continue").fill(email);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/delete$/);
    await expect(
      page.getByRole("heading", { name: "Delete your account and tenant", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Type your email address to confirm").fill(email);
  };

  test("deletes the account and its solo tenant after a client-side confirmation", async ({
    page,
  }) => {
    const { email } = await import("./helpers").then((helpers) =>
      helpers.register(page).then(async (result) => {
        await helpers.createTenant(page, "Delete Me Tenant");

        return result;
      }),
    );

    await gotoHydrated(page, "/account");

    // The confirmation must be a client-side navigation: a full reload would
    // clear this marker, and the old search-only view never re-rendered.
    await page.evaluate(() => {
      (window as any).__deletionMarker = true;
    });
    await openDeletionPage(page, email);
    expect(await page.evaluate(() => (window as any).__deletionMarker)).toBe(true);

    // Back link returns to the account settings without a reload.
    await page.getByRole("link", { name: /Back to account/ }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

    // Browser Back works because the confirmation is a real route.
    await openDeletionPage(page, email);
    await page.goBack();
    await expect(page).toHaveURL(/\/account$/);

    // Cancel on the confirmation page does the same.
    await openDeletionPage(page, email);
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    await openDeletionPage(page, email);
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Delete account and tenant", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    // The deleted session can no longer authenticate.
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).status);
    expect(me).toBe(401);
  });

  test("shows blockers instead of a destructive button for a multi-tenant account", async ({
    page,
  }) => {
    const { email } = await import("./helpers").then((helpers) =>
      helpers.register(page).then(async (result) => {
        await helpers.createTenant(page, "First Deletion Tenant");
        await helpers.createTenant(page, "Second Deletion Tenant");

        return result;
      }),
    );

    await gotoHydrated(page, "/account/delete");

    await expect(
      page.getByRole("heading", { name: "This account cannot be deleted yet" }),
    ).toBeVisible();
    await expect(page.getByText(/You belong to 2 tenants/)).toBeVisible();
    await expect(page.getByText(/Nothing has been changed/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete account and tenant", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View tenants", exact: true })).toBeVisible();

    // The account still exists; the preview is read-only.
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).status);
    expect(me).toBe(200);
    expect(email).toContain("@");
  });
});
