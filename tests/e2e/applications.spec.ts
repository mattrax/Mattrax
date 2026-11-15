import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("application catalogue", () => {
  test("creates, edits and deletes an Apple application", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Apps Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/applications`);
    await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: /Add application/ })
      .first()
      .click();

    await page.getByLabel("Name", { exact: true }).fill("Example app");
    await page.getByLabel("Bundle / package ID").fill("com.example.app");
    await page.getByLabel("Version").fill("1.0.0");
    await page
      .getByPlaceholder("https://example.com/app/manifest.plist")
      .fill("https://example.com/app/manifest.plist");
    await page.getByRole("button", { name: "Add application" }).click();

    await expect(page).toHaveURL(/\/applications\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Example app" })).toBeVisible();
    await expect(page.getByLabel("Bundle / package ID")).toHaveValue("com.example.app");

    await page.getByLabel("Name", { exact: true }).fill("Example app renamed");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Application and assignments saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Example app renamed" })).toBeVisible();

    await page.getByRole("link", { name: "Back to applications" }).click();
    await expect(page.getByRole("link", { name: "Example app renamed" })).toBeVisible();
    await page.getByRole("link", { name: "Example app renamed" }).click();
    await page.getByRole("button", { name: "Delete application" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByText("No applications")).toBeVisible();
  });

  test("shows direct policy assignments", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Assignments Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Direct policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, policyUrl);
    await page.getByRole("link", { name: "Assignments", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Assignments — Direct policy/ })).toBeVisible();
    await expect(page.getByText("Direct devices")).toBeVisible();
    await expect(page.getByText("No devices enrolled yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save assignments" })).toBeVisible();
  });
});
