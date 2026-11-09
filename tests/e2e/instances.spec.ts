import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("platform instances", () => {
  test("creates, edits, and revokes a product key", async ({ page }) => {
    await bootstrapTenant(page, "Instance Tenant");
    await gotoHydrated(page, "/instances");
    await expect(page.getByRole("heading", { name: "Instances", exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: /register instance/i })
      .first()
      .click();
    await page.locator('[data-slot="dialog-content"] input').fill("Production EU");
    await page.getByRole("button", { name: /create key/i }).click();
    await expect(page.getByText("Copy this product key now")).toBeVisible();
    const key = await page.locator("code").first().innerText();
    expect(key).toMatch(/^MTLX-/);

    // Licence monitors sign a count report with the product key.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", key).update(`${timestamp}.5:10`).digest("hex");
    const verified = await page.evaluate(
      async ({ key, timestamp, signature }) => {
        const response = await fetch("/api/platform/instances/verify", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-mattrax-key": key,
            "x-mattrax-timestamp": String(timestamp),
            "x-mattrax-signature": signature,
          },
          body: JSON.stringify({ userCount: 5, deviceCount: 10 }),
        });
        return response.json();
      },
      { key, timestamp, signature },
    );
    expect(verified.valid).toBe(true);

    await expect(page.getByText("Production EU")).toBeVisible();
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.locator('[data-slot="dialog-content"] input').fill("Production EU (rotated)");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Production EU (rotated)")).toBeVisible();

    await page
      .getByRole("button", { name: /^revoke$/i })
      .first()
      .click();
    await page
      .locator('[data-slot="dialog-content"]')
      .getByRole("button", { name: /^revoke$/i })
      .click();
    await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  });
});
