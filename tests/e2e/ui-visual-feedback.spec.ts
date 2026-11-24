import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { api, bootstrapTenant, confirmStepUp, gotoHydrated, stepUpGrant } from "./helpers";

const CONTRAST_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type GroupDetailFixture = {
  id: string;
  name: string;
  kind: "manual";
  devices?: Array<{ id: string; name: string; source: string }>;
  policies?: Array<{ id: string; name: string; mode: string; priority: number }>;
};

const expectNoContrastViolations = async (page: Page, selector: string) => {
  const results = await new AxeBuilder({ page })
    .withTags(CONTRAST_TAGS)
    .include(selector)
    .analyze();
  const violations = results.violations.filter((violation) => violation.id === "color-contrast");

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
};

const useTheme = async (page: Page, theme: "light" | "dark") => {
  await page.evaluate((value) => localStorage.setItem("mattrax:theme", value), theme);
};

const seedEnabledScript = async (page: Page, tenantId: string) => {
  const grant = await stepUpGrant(page, "script-change");

  await api(page, `/api/v1/tenants/${tenantId}/scripts/settings`, {
    method: "PATCH",
    headers: { "x-mattrax-step-up": grant },
    body: JSON.stringify({ enabled: true }),
  });

  await api(page, `/api/v1/tenants/${tenantId}/scripts`, {
    method: "POST",
    body: JSON.stringify({
      name: "Feedback fixture script",
      language: "bash",
      body: "#!/bin/bash\necho ok",
      runAs: "root",
      timeoutSeconds: 300,
      trigger: { type: "manual" },
      enabled: true,
    }),
  });
};

test.describe("UI visual feedback", () => {
  test.setTimeout(180_000);

  test("success badges meet contrast in light and dark themes", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Badge Contrast Tenant");

    await page.route("**/api/v1/tenants/*/users", (route) =>
      route.fulfill({
        json: {
          rows: [
            {
              id: "contrast-user",
              name: "Contrast User",
              email: "contrast@example.com",
              source: "manual",
              disabled: false,
              linked: false,
              groupCount: 0,
              deviceCount: 0,
            },
          ],
        },
      }),
    );

    for (const theme of ["light", "dark"] as const) {
      await useTheme(page, theme);

      await gotoHydrated(page, "/account");
      await expect(page.locator('[data-success-badge="verified"]').first()).toBeVisible();
      await expectNoContrastViolations(page, '[data-success-badge="verified"]');

      await gotoHydrated(page, `/t/${tenant.id}/users`);
      await expect(page.locator('[data-success-badge="active"]')).toBeVisible();
      await expectNoContrastViolations(page, '[data-success-badge="active"]');

      await gotoHydrated(page, `/t/${tenant.id}/settings/management`);
      await expect(
        page.locator('[data-status-tone="success"]').filter({ hasText: "Enrollment available" }),
      ).toBeVisible();
      await expectNoContrastViolations(page, '[data-status-tone="success"]');
    }
  });

  test("a handled Scripts settings failure announces once without a global banner", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Script Error Tenant");
    await seedEnabledScript(page, tenant.id);

    let patchCount = 0;
    await page.route("**/api/v1/tenants/*/scripts/settings", (route) => {
      if (route.request().method() !== "PATCH") return route.continue();

      patchCount += 1;

      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "Script settings fixture failure" }),
      });
    });

    await gotoHydrated(page, `/t/${tenant.id}/scripts`);
    const failed = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/v1/tenants/") &&
        response.url().endsWith("/scripts/settings"),
    );

    await page.getByRole("button", { name: "Disable scripts for this tenant" }).click();
    await confirmStepUp(page);
    expect((await failed).status()).toBe(500);

    const notifications = page.getByRole("region", { name: "Notifications" });
    await expect(
      notifications.getByText("Could not update script settings", { exact: true }),
    ).toBeVisible();
    await expect(notifications.getByRole("listitem")).toHaveCount(1);
    await expect(
      page.getByRole("status").filter({ hasText: "Could not update script settings" }),
    ).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
    expect(patchCount).toBe(1);
  });

  test("Scripts keeps columns scrollable and shows the mobile swipe hint", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Script Layout Tenant");
    await seedEnabledScript(page, tenant.id);
    await page.setViewportSize({ width: 390, height: 844 });

    await gotoHydrated(page, `/t/${tenant.id}/scripts`);
    const hint = page.getByText("Swipe the table sideways to see more columns.", { exact: true });
    await expect(hint).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Runs as" })).toBeAttached();

    const table = page.getByRole("table", { name: "Scripts" });
    const container = page.locator('[data-slot="table-container"]').filter({ has: table });
    const dimensions = await container.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));

    expect(dimensions.overflowX).toBe("auto");
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);

    await container.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    expect(await container.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(hint).toBeHidden();
  });

  test("group summaries use singular labels for one and plural labels otherwise", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Group Count Tenant");
    const group = await api<{ id: string; name: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/groups`,
      { method: "POST", body: JSON.stringify({ name: "Count grammar" }) },
    );
    const detail = await api<GroupDetailFixture>(
      page,
      `/api/v1/tenants/${tenant.id}/groups/${group.id}`,
    );

    let devices: Array<{ id: string; name: string; source: string }> = [];
    let policies: Array<{ id: string; name: string; mode: string; priority: number }> = [];

    await page.route(`**/api/v1/tenants/*/groups/${group.id}`, (route) => {
      if (route.request().method() !== "GET") return route.continue();

      return route.fulfill({ json: { ...detail, devices, policies } });
    });

    for (const { count, deviceLabel, policyLabel } of [
      { count: 0, deviceLabel: "devices", policyLabel: "policies" },
      { count: 1, deviceLabel: "device", policyLabel: "policy" },
      { count: 2, deviceLabel: "devices", policyLabel: "policies" },
    ]) {
      devices = Array.from({ length: count }, (_, index) => ({
        id: `device-${index}`,
        name: `Device ${index}`,
        source: "manual",
      }));
      policies = Array.from({ length: count }, (_, index) => ({
        id: `policy-${index}`,
        name: `Policy ${index}`,
        mode: "include",
        priority: index,
      }));

      await gotoHydrated(page, `/t/${tenant.id}/groups/${group.id}`);
      const summary = page.getByTestId("group-summary");

      await expect(summary.getByText(deviceLabel, { exact: true })).toBeVisible();
      await expect(summary.getByText(policyLabel, { exact: true })).toBeVisible();
      await expect(summary).toContainText(String(count));
    }
  });

  test("Account keeps one semantic title and preserves breadcrumb context", async ({ page }) => {
    await bootstrapTenant(page, "Account Heading Tenant");
    await gotoHydrated(page, "/account");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 1, name: "Account", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Your account", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Account", { exact: true }),
    ).toBeVisible();
  });
});
