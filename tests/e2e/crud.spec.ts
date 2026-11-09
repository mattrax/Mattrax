import { expect, test } from "@playwright/test";
import { bootstrapTenant } from "./helpers";

test.describe("groups and policies", () => {
  test("creates, edits, duplicates, and deletes a group", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "CRUD Tenant");
    await page.goto(`/t/${tenant.id}/groups`);
    await page
      .getByRole("link", { name: /create group/i })
      .first()
      .click();
    await page.locator("form input").first().fill("Field Ops");
    await page.getByRole("button", { name: /^create group$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/groups/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Field Ops" })).toBeVisible();

    // Edit mode renames through the shared save action.
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.locator("form input").first().fill("Field Operations");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("heading", { name: "Field Operations" })).toBeVisible();

    await page.getByRole("button", { name: /duplicate/i }).click();
    await expect(
      page.getByRole("heading", { name: /Field Operations \[duplicated\]/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^delete$/i }).click();
    await page.locator('[data-slot="dialog-content"] input').fill("Field Operations [duplicated]");
    await page
      .locator('[data-slot="dialog-content"]')
      .getByRole("button", { name: /delete group/i })
      .click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/groups$`));
  });

  test("creates a policy and configures a device restriction", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Policy Tenant");
    await page.goto(`/t/${tenant.id}/policies`);
    await page
      .getByRole("link", { name: /create policy/i })
      .first()
      .click();
    await page.locator("form input").first().fill("Camera Policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);

    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /^device$/i }).click();
    await page.getByRole("checkbox").first().uncheck();
    await page.getByRole("button", { name: /^save$/i }).click();

    await page.goto(`/t/${tenant.id}/policies`);
    await expect(page.getByRole("link", { name: "Camera Policy" })).toBeVisible();
  });
});
