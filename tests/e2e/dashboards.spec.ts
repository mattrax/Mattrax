import { expect, test } from "@playwright/test";
import { api, bootstrapSession, gotoHydrated } from "./helpers";

test.describe("dashboards", () => {
  test.setTimeout(180_000);

  test("builds a shared dashboard, creates one from the gallery and filters by query", async ({
    page,
  }) => {
    const { tenant } = await bootstrapSession(page, "Dashboard Tenant");
    const base = `/t/${tenant.slug}`;

    // Original case: "builds a shared dashboard and uses it for Overview".
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

    // Original case: "filters the device table with a shareable query".
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

    // Original case: "creates a dashboard from the gallery dialog".
    await gotoHydrated(page, `/t/${tenant.slug}/dashboards`);

    await page.getByRole("button", { name: "New dashboard" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel("Name").fill("Quarterly review");
    await createDialog.getByRole("button", { name: "Create dashboard" }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/dashboards/[^/?]+\\?edit=1`));
    await expect(page.getByRole("heading", { name: "Quarterly review" })).toBeVisible();
  });

  test("pins a dashboard, saves compact details and persists a drag layout", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Pinned Tenant");

    // Original case: "pins a dashboard to the sidebar and keeps it there".
    const pinnedDashboard = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/dashboards`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Fleet ops" }),
      },
    );

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
    await expect(page).toHaveURL(new RegExp(`/dashboards/${pinnedDashboard.id}$`));

    await page.getByRole("button", { name: "Unpin from sidebar: Fleet ops" }).click();
    await expect(primary.getByRole("link", { name: "Fleet ops", exact: true })).toHaveCount(0);

    // Original case: "keeps reports on a subpage and saves compact dashboard
    // details".
    const reportDashboard = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/dashboards`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Fleet ops" }),
      },
    );

    await gotoHydrated(
      page,
      `/t/${tenant.slug}/dashboards/${reportDashboard.id}?edit=1`,
    );

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

    await gotoHydrated(page, `/t/${tenant.slug}/dashboards/${reportDashboard.id}`);
    await expect(
      page.getByRole("heading", { name: "Fleet operations", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Shared runbook for the IT team")).toBeVisible();

    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/dashboards/${reportDashboard.id}/reports$`),
    );
    await expect(
      page.getByRole("heading", { name: "Reports for Fleet operations", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No scheduled reports")).toBeVisible();

    await page.getByRole("link", { name: /Fleet operations/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/dashboards/${reportDashboard.id}$`),
    );

    // Original case: "coalesces a drag and persists the same non-overlapping
    // layout".
    const dragDashboard = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/dashboards`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Drag layout", template: "overview" }),
      },
    );
    await gotoHydrated(page, `/t/${tenant.id}/dashboards/${dragDashboard.id}?edit=1`);

    const grid = page.locator(".dashboard-grid");
    const handle = page.getByRole("button", { name: "Move Managed devices", exact: true });
    await expect(grid).toBeVisible();
    await expect(handle).toBeVisible();
    await handle.scrollIntoViewIfNeeded();
    await handle.hover();
    const gridBox = await grid.boundingBox();
    const handleBox = await handle.boundingBox();

    if (!gridBox || !handleBox) throw new Error("Dashboard drag handles were not measurable.");

    const column = (gridBox.width - 12 * 11) / 12 + 12;
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const drag = async () => {
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/dashboards/${dragDashboard.id}/layout`),
        { timeout: 30_000 },
      );

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + column * 6, startY, { steps: 20 });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      await page.mouse.up();

      return saved.catch(() => undefined);
    };

    // A dashboard still settling from its first paint can miss the pointer
    // gesture. Retry the same drag before treating the layout as unsaved.
    const saved = (await drag()) ?? (await drag());
    expect(saved?.ok()).toBe(true);

    const layout = await api<{
      widgets: Array<{ id: string; x: number; y: number; w: number; h: number }>;
    }>(page, `/api/v1/tenants/${tenant.id}/dashboards/${dragDashboard.id}`);
    const moved = layout.widgets.find(
      (widget) => widget.x === 6 && widget.y === 0 && widget.w === 3,
    );

    expect(moved).toBeDefined();
    for (let left = 0; left < layout.widgets.length; left++) {
      for (let right = left + 1; right < layout.widgets.length; right++) {
        const a = layout.widgets[left]!;
        const b = layout.widgets[right]!;
        const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});
