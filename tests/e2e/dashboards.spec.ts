import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("dashboards", () => {
  test("builds a shared dashboard and uses it for Overview", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Dashboard Tenant");
    const base = `/t/${tenant.id}`;

    await gotoHydrated(page, base);
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("Built-in preview")).toBeVisible();
    await expect(page.getByText("Managed devices")).toBeVisible();

    await page.getByRole("button", { name: "Customise overview" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.id}/dashboards/[^/?]+\\?edit=1`));
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Managed devices")).toBeVisible();

    await page.getByRole("button", { name: "Add widget" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Type").selectOption("markdown");
    await dialog.getByLabel("Title").fill("Team runbook");
    await dialog.locator("textarea").fill("## Runbook\n\n- [Docs](/docs/)\n- Escalate to **IT**");
    await dialog.getByRole("button", { name: "Add widget" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Team runbook")).toBeVisible();
    await expect(page.getByText("Runbook", { exact: true })).toBeVisible();

    await gotoHydrated(page, `${base}/dashboards`);
    await expect(page.getByRole("heading", { name: "Dashboards" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByText("8 widgets")).toBeVisible();

    await gotoHydrated(page, base);
    await expect(page.getByText("Team runbook")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runbook", exact: true })).toBeVisible();
  });

  test("filters the device table with a shareable query", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Query Tenant");
    const query = "platform is apple and staleDays at least 14";
    await gotoHydrated(page, `/t/${tenant.id}/devices?query=${encodeURIComponent(query)}`);
    await expect(page.getByRole("button", { name: /Advanced query/ })).toContainText("2");
    await expect(page).toHaveURL(/query=platform/);
    await page.getByRole("button", { name: /Advanced query/ }).click();
    await expect(page.locator('select[aria-label="Condition field"]')).toHaveCount(2);
    await expect(page.locator('select[aria-label="Condition field"]').first()).toHaveValue(
      "platform",
    );
    await page.getByRole("button", { name: "Clear query" }).click();
    await expect(page).not.toHaveURL(/query=/);
  });
});
