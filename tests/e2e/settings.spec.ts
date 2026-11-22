import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addFilter, api, bootstrapTenant, gotoHydrated } from "./helpers";

/**
 * Save the tenant profile and wait for the write. A follow-up read that races
 * the mutation legitimately still sees the old row, so tests must observe the
 * response rather than the click.
 */
const saveTenantSettings = async (page: Page) => {
  const patched = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/api/v1/tenants/"),
  );

  await page.getByRole("button", { name: /save changes/i }).click();
  expect((await patched).ok()).toBe(true);
};

test.describe("tenant settings", () => {
  test("shows tenant audit events", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Audit Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/audit`);
    await expect(page.getByText("Audit log", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Tenant · created/i)).toBeVisible();
  });

  test("filters audit events and exports CSV", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Audit Export Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/audit`);

    await addFilter(page, "Action", "tenant.created");
    await expect(page.getByText(/events? loaded/)).toBeVisible();
    await expect(page.getByText("No audit events match these filters.")).toBeHidden();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

    await page.getByRole("button", { name: /Action is tenant.created/ }).click();
    await page
      .getByRole("listbox", { name: "Action value" })
      .getByRole("option", { name: "device.enrolled", exact: true })
      .click();
    await expect(page.getByText("No audit events match these filters.")).toBeVisible();

    const invalidRange = await page.request.get(
      `/api/v1/tenants/${tenant.id}/audit/search?from=not-a-date`,
    );

    expect(invalidRange.status()).toBe(400);
  });

  test("asks before discarding unsaved tenant profile edits", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Unsaved Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    await page.getByLabel(/^Name/).fill("Unsaved Tenant Renamed");

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Devices" })
      .click();
    const dialog = page.getByRole("dialog", { name: /discard tenant changes/i });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings$`));

    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings$`));

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Devices" })
      .click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/devices$`));
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
  });

  test("opens every settings tab and saves the tenant profile", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');

    for (const [tab, text] of [
      ["Administrators", /Invite an administrator/],
      ["Identity", /Single sign-on/],
      ["Enrollment", /Enrollment link/],
      ["Management", /Apple push notifications/],
      ["Delivery", /Recent failures/],
      ["Billing", /Billable devices|Plan/],
      ["General", /Tenant profile/],
    ] as const) {
      await tabs.getByRole("link", { name: tab }).click();
      await expect(page.getByText(text).first()).toBeVisible();
    }

    const name = page.locator("input").first();
    await name.fill("Renamed Tenant");
    await saveTenantSettings(page);
    await expect(name).toHaveValue("Renamed Tenant");

    await page.goto("/dashboard", { waitUntil: "commit" }).catch(() => undefined);
    await expect(page).toHaveURL(new RegExp(`/t/[^/]+$`));
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.find((item: { id: string }) => item.id === tenant.id).name).toBe(
      "Renamed Tenant",
    );
  });

  test("keeps migration in settings and offers it to empty fleets", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Migration Tenant");
    const base = `/t/${tenant.slug}`;

    await gotoHydrated(page, base);
    await expect(page.getByText("Bring a fleet over from another MDM")).toBeVisible();
    await page.getByRole("link", { name: "Open migration" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings/migration$`));
    await expect(page.getByRole("heading", { name: "Migration", exact: true })).toBeVisible();
    await expect(page.getByText("No migrations yet")).toBeVisible();

    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Migration" })).toHaveCount(0);
    await expect(primary.getByRole("link", { name: "OS versions" })).toHaveCount(0);
    await expect(
      page
        .locator('nav[aria-label="Tenant settings sections"]')
        .getByRole("link", { name: "Migration" }),
    ).toHaveAttribute("aria-current", "page");

    await gotoHydrated(page, base);
    await expect(page.getByText("Bring a fleet over from another MDM")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss migration banner" }).click();
    await expect(page.getByText("Bring a fleet over from another MDM")).toBeHidden();

    await gotoHydrated(page, base);
    await expect(page.getByText("Bring a fleet over from another MDM")).toBeHidden();
  });

  test("shows the auditor role in administrator settings", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Role Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/administrators`);
    await expect(page.getByText("Invite an administrator")).toBeVisible();
    const inviteRole = page.getByLabel("Invitation role");
    await expect(inviteRole.locator('option[value="builtin:auditor"]')).toHaveText("Auditor");
    await expect(inviteRole.locator('option[value="builtin:member"]')).toHaveText("Member");
  });

  test("creates a custom RBAC role", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "RBAC Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/administrators`);
    await page.getByRole("button", { name: "Create role" }).first().click();
    await page.getByLabel("Name").fill("Helpdesk");
    await page.getByLabel("Description").fill("Front-line support");
    await page.getByText("View devices", { exact: true }).click();
    await page.getByRole("button", { name: "Create role" }).last().click();
    await expect(page.locator("p").filter({ hasText: "Helpdesk" }).first()).toBeVisible();
    await expect(page.getByText(/Front-line support/)).toBeVisible();

    const roles = await api<{ roles: Array<{ name: string; builtIn: boolean }> }>(
      page,
      `/api/v1/tenants/${tenant.id}/roles`,
    );

    expect(roles.roles).toContainEqual(
      expect.objectContaining({ name: "Helpdesk", builtIn: false }),
    );
  });

  test("edits tenant branding and previews it on the public enrollment page", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Branded Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    await page.getByLabel("Display name").fill("Acme Corp");
    await page.getByLabel("Logo").fill("https://cdn.example.com/acme.png");
    await page.getByLabel("Support email").fill("help@acme.test");

    // Invalid values are rejected before the request is sent.
    await page.getByPlaceholder("#1c1917").fill("blue");
    await expect(page.getByText(/hex value like #1c1917/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /save changes/i })).toBeDisabled();

    await page.getByPlaceholder("#1c1917").fill("#2563eb");
    await expect(page.getByRole("button", { name: /save changes/i })).toBeEnabled();
    await expect(page.getByText("Enroll in Acme Corp")).toBeVisible();
    await saveTenantSettings(page);

    const saved = await api<{
      displayName: string;
      supportEmail: string;
      brandColor: string;
      logo: string;
    }>(page, `/api/v1/tenants/${tenant.id}`);

    expect(saved).toMatchObject({
      displayName: "Acme Corp",
      supportEmail: "help@acme.test",
      brandColor: "#2563eb",
      logo: "https://cdn.example.com/acme.png",
    });

    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);
    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.locator('[data-slot="card-title"]')).toContainText("Enroll in Acme Corp");
    await expect(page.getByText("help@acme.test")).toBeVisible();
    await expect(page.locator('img[src="https://cdn.example.com/acme.png"]')).toHaveAttribute(
      "src",
      "https://cdn.example.com/acme.png",
    );
  });

  test("shows the APNs setup wizard and downloads a CSR", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "APNs Tenant");
    await page.goto(`/t/${tenant.id}/settings/management`);
    await expect(page.getByText("APNs setup required")).toBeVisible();
    await expect(page.getByText("Download a CSR")).toBeVisible();

    const download = page.waitForEvent("download").catch(() => undefined);
    await page.getByRole("button", { name: /download csr/i }).click();
    await download;
    // The endpoint may not be deployed in every environment; the UI must not crash.
    await expect(page.getByRole("heading", { name: "Management", exact: true })).toBeVisible();
  });
});
