import { expect, test } from "@playwright/test";
import { api, bootstrapSession, gotoHydrated } from "./helpers";

const contrastRatio = (foreground: string, background: string) => {
  const luminance = (colour: string) => {
    const match = /rgba?\(([^)]+)\)/.exec(colour);

    if (!match) throw new Error(`Unsupported computed colour: ${colour}`);

    const [red = 0, green = 0, blue = 0] = match[1]!.split(",").map(Number);
    const linear = [red, green, blue].map((channel) => {
      const value = channel / 255;

      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };

  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));

  return (light + 0.05) / (dark + 0.05);
};

const nextTimestamp = (value: string) => new Date(new Date(value).getTime() + 1_000).toISOString();

type StorefrontRow = {
  region: string;
  storeId: string | null;
  available: boolean;
  source: "manual" | "lookup";
  checkedAt: string;
};

type StorefrontApplication = {
  id: string;
  name: string;
  notes: string | null;
  updatedAt: string;
  availability: string;
  storefronts: StorefrontRow[];
};

type ApplicationMetadataPatch = {
  expectedUpdatedAt?: string;
  name?: string;
  notes?: string | null;
  removeOnUnassign?: boolean;
  installers?: unknown;
};

test.describe("application catalogue", () => {
  test("creates, edits and deletes an Apple application", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Apps Tenant");
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

    await expect(page.getByText("Installer 1")).toBeVisible();
    await page.getByRole("button", { name: "Add installer" }).click();
    await expect(page.getByText("Installer 2")).toBeVisible();
    await page.getByLabel("Version").nth(1).fill("2.0.0");
    await page
      .getByLabel("Manifest / installer URL")
      .nth(1)
      .fill("https://example.com/app/manifest-2.plist");
    await page.getByLabel("Minimum OS").nth(1).fill("14.0");

    await page.getByLabel("Name", { exact: true }).fill("Example app renamed");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Application and assignments saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Example app renamed" })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Installer 2")).toBeVisible();
    // Installers are listed by priority and version, so the newer one leads.
    await expect(page.getByLabel("Version").nth(0)).toHaveValue("2.0.0");
    await expect(page.getByLabel("Version").nth(1)).toHaveValue("1.0.0");

    await page.getByRole("link", { name: "Back to applications" }).click();
    await expect(page.getByRole("link", { name: "Example app renamed" })).toBeVisible();
    await page.getByRole("link", { name: "Example app renamed" }).click();
    await page.getByRole("button", { name: "Delete application" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByText("No applications")).toBeVisible();
  });

  test("persists a new group assignment and keeps uninstall readable in light mode", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const { tenant } = await bootstrapSession(page, "Assignment Integrity Tenant");
    await page.evaluate(() => localStorage.setItem("mattrax:theme", "light"));

    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Deployment group" }),
    });
    const application = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/applications`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Assigned app",
          platform: "apple",
          source: "manifest",
          bundleId: "com.example.assigned",
          version: "1.0.0",
          manifestUrl: "https://example.com/assigned.plist",
        }),
      },
    );

    await gotoHydrated(page, `/t/${tenant.id}/applications/${application.id}`);

    const assignmentRequests: unknown[] = [];
    await page.route(
      `**/api/v1/tenants/${tenant.id}/applications/${application.id}/assignments`,
      async (route) => {
        assignmentRequests.push(route.request().postDataJSON());
        await route.continue();
      },
    );

    const assignment = page.getByRole("checkbox", { name: "Deployment group", exact: true });
    await assignment.check();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Application and assignments saved.")).toBeVisible();
    expect(assignmentRequests).toEqual([
      {
        assign: { groups: [group.id], userGroups: [], devices: [] },
        unassign: { groups: [], userGroups: [], devices: [] },
      },
    ]);

    await page.reload();
    await expect(assignment).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Install on assigned devices", exact: true }),
    ).toBeEnabled();

    const uninstall = page.getByRole("button", { name: "Uninstall from devices", exact: true });
    await expect(uninstall).toBeEnabled();
    const colours = await uninstall.evaluate((element) => {
      const style = getComputedStyle(element);

      return { colour: style.color, background: style.backgroundColor };
    });

    expect(contrastRatio(colours.colour, colours.background)).toBeGreaterThanOrEqual(4.5);
  });

  test("advances the stale-write base after an acknowledged storefront refresh", async ({
    page,
  }) => {
    const { tenant } = await bootstrapSession(page, "Storefront Integrity Tenant");
    const created = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/applications`, {
      method: "POST",
      body: JSON.stringify({
        name: "Storefront app",
        platform: "apple",
        source: "store",
        storeId: "361309726",
      }),
    });
    const applicationPath = `/api/v1/tenants/${tenant.id}/applications/${created.id}`;

    await gotoHydrated(page, `/t/${tenant.id}/applications/${created.id}`);
    const storefronts = page.getByRole("region", { name: "App Store regions", exact: true });
    await storefronts.getByRole("button", { name: "Add region" }).click();
    await storefronts.getByLabel("Region", { exact: true }).last().fill("GB");
    await storefronts.getByLabel("App Store ID", { exact: true }).last().fill("361309726");
    await storefronts.getByRole("button", { name: "Save regions" }).click();
    await expect(page.getByText("Storefront mapping saved.")).toBeVisible();

    let application = await api<StorefrontApplication>(page, applicationPath);

    await page.route(`**${applicationPath}`, async (route) => {
      const request = route.request();

      if (request.method() === "GET") {
        await route.fulfill({ json: application });

        return;
      }

      if (request.method() === "PATCH") {
        const payload = request.postDataJSON() as ApplicationMetadataPatch;

        if (payload.expectedUpdatedAt !== application.updatedAt) {
          await route.fulfill({
            status: 412,
            contentType: "application/json",
            body: JSON.stringify({
              _tag: "Failure",
              error: {
                _tag: "EnterprisePreconditionFailed",
                message: "This application changed since you loaded it.",
              },
            }),
          });

          return;
        }

        const changes = { ...payload };
        delete changes.expectedUpdatedAt;
        application = {
          ...application,
          ...changes,
          updatedAt: nextTimestamp(application.updatedAt),
        };
        await route.fulfill({ json: { status: "ok" } });

        return;
      }

      await route.continue();
    });
    await page.route(`**${applicationPath}/storefronts/refresh`, async (route) => {
      const checkedAt = new Date().toISOString();
      const refreshedStorefronts = application.storefronts.map((storefront) => ({
        ...storefront,
        available: true,
        storeId: storefront.storeId ?? "361309726",
        source: "lookup" as const,
        checkedAt,
      }));

      application = {
        ...application,
        updatedAt: nextTimestamp(application.updatedAt),
        availability: "available",
        storefronts: refreshedStorefronts,
      };
      await route.fulfill({
        json: { availability: "available", storefronts: refreshedStorefronts, errors: [] },
      });
    });

    await storefronts.getByRole("button", { name: "Refresh availability" }).click();
    await expect(
      page.getByText(/Checked \d+ storefront\(s\); the app is available\./),
    ).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Storefront app renamed");
    await page.getByLabel("Notes", { exact: true }).fill("Draft survives the refresh");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Application and assignments saved.")).toBeVisible();
    await expect(
      page.getByText("Someone else changed this; reloading the latest version"),
    ).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Storefront app renamed");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
      "Draft survives the refresh",
    );

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Storefront app renamed");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
      "Draft survives the refresh",
    );
  });

  test("shows direct policy assignments", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Assignments Tenant");
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
