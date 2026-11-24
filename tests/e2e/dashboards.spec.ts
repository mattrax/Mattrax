import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("dashboards", () => {
  test("builds a shared dashboard and uses it for Overview", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Dashboard Tenant");
    const base = `/t/${tenant.slug}`;

    await gotoHydrated(page, base);
    await expect(page.getByRole("heading", { name: "Fleet overview" })).toBeVisible();
    await expect(page.getByText("Built-in preview")).toBeVisible();
    await expect(page.getByText("Managed devices")).toBeVisible();

    await page.getByRole("button", { name: "Customise overview" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboards/[^/?]+\\?edit=1`));
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

  test("pins a dashboard to the sidebar and keeps it there", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Pinned Tenant");
    const dashboard = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/dashboards`, {
      method: "POST",
      body: JSON.stringify({ name: "Fleet ops" }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/dashboards`);
    await expect(page.getByRole("heading", { name: "Fleet ops", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Actions for Fleet ops" }).click();
    await page.getByRole("menuitem", { name: "Pin to sidebar" }).click();

    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Fleet ops", exact: true })).toBeVisible();

    // A full navigation proves the pin comes from browser storage, not the
    // mounted page state.
    await gotoHydrated(page, `/t/${tenant.slug}/devices`);
    const pinnedLink = primary.getByRole("link", { name: "Fleet ops", exact: true });
    await expect(pinnedLink).toBeVisible();
    await pinnedLink.click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${dashboard.id}$`));

    await page.getByRole("button", { name: "Unpin from sidebar: Fleet ops" }).click();
    await expect(primary.getByRole("link", { name: "Fleet ops", exact: true })).toHaveCount(0);
  });

  test("creates a dashboard from the gallery dialog", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Gallery Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/dashboards`);

    await page.getByRole("button", { name: "New dashboard" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Quarterly review");
    await dialog.getByRole("button", { name: "Create dashboard" }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboards/[^/?]+\\?edit=1`));
    await expect(page.getByRole("heading", { name: "Quarterly review" })).toBeVisible();
  });

  test("keeps reports on a subpage and saves compact dashboard details", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Reports Tenant");
    const dashboard = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/dashboards`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Fleet ops" }),
      },
    );

    await gotoHydrated(page, `/t/${tenant.slug}/dashboards/${dashboard.id}?edit=1`);

    // The edit strip is one compact row: the name and description are directly
    // labelled inputs rather than a second panel of form fields.
    const name = page.getByLabel("Dashboard name", { exact: true });
    const description = page.getByLabel("Dashboard description", { exact: true });
    await expect(name).toHaveValue("Fleet ops");
    await name.fill("Fleet operations");
    await description.fill("Shared runbook for the IT team");
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Fleet operations", exact: true }),
    ).toBeVisible();

    // Report controls are not on the dashboard page.
    await expect(page.getByText("No scheduled reports")).toHaveCount(0);

    await gotoHydrated(page, `/t/${tenant.slug}/dashboards/${dashboard.id}`);
    await expect(
      page.getByRole("heading", { name: "Fleet operations", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Shared runbook for the IT team")).toBeVisible();

    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/dashboards/${dashboard.id}/reports$`),
    );
    await expect(
      page.getByRole("heading", { name: "Reports for Fleet operations", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No scheduled reports")).toBeVisible();

    await page.getByRole("link", { name: /Fleet operations/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/dashboards/${dashboard.id}$`),
    );
  });

  test("filters the device table with a shareable query", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Query Tenant");
    const query = "platform is apple and staleDays at least 14";
    await gotoHydrated(page, `/t/${tenant.id}/devices?query=${encodeURIComponent(query)}`);
    await expect(page.getByRole("button", { name: /Query 2 conditions/ })).toBeVisible();
    await expect(page).toHaveURL(/query=platform/);
    await page.getByRole("button", { name: /Query 2 conditions/ }).click();
    await expect(page.getByRole("button", { name: /Platform is Apple/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Days since check-in at least 14/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear advanced query" }).click();
    await expect(page).not.toHaveURL(/query=/);
  });
});
