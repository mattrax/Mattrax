import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("tenant outbound webhooks", () => {
  test("creates, edits, rotates and deletes an endpoint", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Webhook Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/integrations`);

    await expect(page.getByText("Outbound webhooks").first()).toBeVisible();
    await expect(page.getByText("No webhook endpoints yet")).toBeVisible();

    await page.getByRole("button", { name: "Add endpoint" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Add webhook endpoint")).toBeVisible();
    await page.getByLabel("Endpoint URL").fill("https://hooks.example.com/e2e");
    await page.getByLabel("Description").fill("E2E receiver");
    await dialog.getByRole("button", { name: "Add endpoint" }).click();

    // The signing secret is shown exactly once.
    const secretDialog = page.getByRole("dialog");
    await expect(secretDialog.getByText("Signing secret")).toBeVisible();
    const secret = await secretDialog.locator("input").inputValue();
    expect(secret).toMatch(/^whsec_/);
    await secretDialog.getByRole("button", { name: "I have copied it" }).click();

    await expect(page.getByText("https://hooks.example.com/e2e")).toBeVisible();
    await expect(page.getByText("E2E receiver")).toBeVisible();

    // Edit the URL.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Endpoint URL").fill("https://hooks.example.com/e2e-updated");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("https://hooks.example.com/e2e-updated")).toBeVisible();

    // Rotate the secret; the new secret is shown once and differs from the old.
    await page.getByRole("button", { name: "Rotate secret" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Rotate secret", exact: true })
      .click();
    const rotatedDialog = page.getByRole("dialog");
    await expect(rotatedDialog.getByText("Signing secret")).toBeVisible();
    const rotated = await rotatedDialog.locator("input").inputValue();
    expect(rotated).toMatch(/^whsec_/);
    expect(rotated).not.toBe(secret);
    await rotatedDialog.getByRole("button", { name: "I have copied it" }).click();

    // Delete.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete endpoint", exact: true })
      .click();
    await expect(page.getByText("No webhook endpoints yet")).toBeVisible();
  });

  test("rejects private webhook URLs", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Webhook Guard Tenant");

    const response = await page.request.post(`/api/v1/tenants/${tenant.id}/webhooks`, {
      data: { url: "https://127.0.0.1/hooks", events: [] },
      headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" },
    });

    expect(response.status()).toBe(400);

    const listed = await page.request.get(`/api/v1/tenants/${tenant.id}/webhooks`);
    expect(listed.ok()).toBe(true);
    expect((await listed.json()).endpoints).toEqual([]);
  });
});
