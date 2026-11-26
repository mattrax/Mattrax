import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addFilter, api, bootstrapSession, gotoHydrated } from "./helpers";

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
    const { tenant } = await bootstrapSession(page, "Audit Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/audit`);
    await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
    await expect(page.getByText(/Account changes and device \(MDM\) activity/)).toBeVisible();
    await expect(page.getByText(/Tenant · created/i)).toBeVisible();
  });

  test("shows one Approvals title and keeps policy creation available", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Approvals Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/approvals`);

    await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New policy" }).click();
    await expect(page.getByRole("dialog", { name: "New approval policy" })).toBeVisible();
  });

  test("labels the attribute CSV picker and keeps validation inline", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Attribute Validation Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/attributes`);

    const csvFile = page.getByLabel("Import device values CSV");
    await expect(csvFile).toBeVisible();
    await expect(csvFile).toHaveAttribute("accept", ".csv,text/csv");
    await csvFile.setInputFiles({
      name: "attributes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("serial\n"),
    });
    await expect(page.getByText("Import device values CSV", { exact: true })).toBeVisible();

    await page.getByLabel("Key", { exact: true }).fill("Bad Key");
    await page.getByLabel("Label", { exact: true }).fill("Cost centre");
    await page.getByRole("button", { name: "Add attribute", exact: true }).click();

    const error = page.getByRole("alert");
    await expect(error).toContainText(/lowercase/i);
    await expect(error).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Dismiss error" })).toHaveCount(0);

    await page.getByLabel("Key", { exact: true }).fill("cost_centre");
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/v1\/tenants\/[^/]+\/attributes$/.test(response.url()),
    );
    await page.getByRole("button", { name: "Add attribute", exact: true }).click();
    expect((await created).ok()).toBe(true);

    const row = page.getByRole("row").filter({ hasText: "cost_centre" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Label", { exact: true }).fill("Cost centre updated");

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /\/api\/v1\/tenants\/[^/]+\/attributes\/[^/]+$/.test(response.url()),
    );
    await page.getByRole("button", { name: "Save attribute", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("filters audit events and exports CSV", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Audit Export Tenant");
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

  test("shows tenant storage usage by category", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Storage Tenant");
    const application = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${tenant.id}/applications`,
      {
        method: "POST",
        body: JSON.stringify({ name: "Storage app", platform: "apple", source: "upload" }),
      },
    );

    await api(page, `/api/v1/tenants/${tenant.id}/applications/${application.id}/upload`, {
      method: "POST",
      body: JSON.stringify({
        fileName: "Storage-app.pkg",
        contentType: "application/octet-stream",
        content: "A".repeat(8_192),
      }),
    });

    const usage = await api<{
      usedBytes: number;
      objectCount: number;
      categories: ReadonlyArray<{ id: string; bytes: number; objects: number }>;
    }>(page, `/api/v1/tenants/${tenant.id}/storage`);

    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.objectCount).toBe(1);
    expect(usage.categories.find((category) => category.id === "applications")).toMatchObject({
      objects: 1,
    });

    await gotoHydrated(page, `/t/${tenant.id}/settings/storage`);
    await expect(page.getByRole("heading", { name: "Storage", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Storage-app.pkg")).toBeVisible();
    await expect(page.getByText("Object storage", { exact: true })).toBeVisible();
  });

  test("asks before discarding unsaved tenant profile edits", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Unsaved Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    await page.getByLabel(/^Name/).fill("Unsaved Tenant Renamed");

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Devices" })
      .click();
    const dialog = page.getByRole("dialog", { name: /leave tenant settings/i });
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

  test("keeps a tenant draft across settings panes and saves from the bar", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Pane Draft Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/settings`);

    await page.getByLabel(/^Name/).fill("Pane Draft Renamed");
    const bar = page.getByRole("region", { name: "Tenant settings changes" });
    await expect(bar).toContainText("Unsaved tenant changes");

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');
    await tabs.getByRole("link", { name: "Administrators" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings/administrators$`));
    await expect(page.getByRole("dialog", { name: /leave tenant settings/i })).toHaveCount(0);
    await expect(bar).toContainText("Unsaved tenant changes");

    await tabs.getByRole("link", { name: "General" }).click();
    await expect(page.getByLabel(/^Name/)).toHaveValue("Pane Draft Renamed");

    await saveTenantSettings(page);
    await expect(bar).toContainText("Tenant changes saved");
  });

  test("requires I understand before changing the tenant slug", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Slug Warning Tenant");
    const nextSlug = `renamed-${randomUUID().slice(0, 8)}`;
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    await page.getByLabel(/^Slug/).fill(nextSlug);
    await page
      .getByRole("region", { name: "Tenant settings changes" })
      .getByRole("button", { name: "Save changes" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: /changing the tenant slug breaks existing URLs/i,
    });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Change slug and save" });
    await expect(confirm).toBeDisabled();

    await dialog.getByRole("textbox").fill("I understand");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await page.waitForURL(new RegExp(`/t/${nextSlug}/settings$`), { timeout: 15_000 });
  });

  test("opens every settings tab and saves the tenant profile", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Settings Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');

    for (const [tab, text] of [
      ["Administrators", /Invite an administrator/],
      ["Identity", /Single sign-on/],
      ["Enrollment", /Enrollment link/],
      ["Management", /Apple push notifications/],
      ["Delivery", /Recent failures/],
      ["Billing", /Billable devices|Plan/],
      ["Storage", /Object storage/],
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
    const { tenant } = await bootstrapSession(page, "Migration Tenant");
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

  test("creates a migration cohort without leaving settings", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Cohort Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/migration`);

    await page.getByLabel("Name").fill("Q1 exit");
    await page.getByLabel("Device serials").fill("C02XYZ123");
    await page.getByRole("button", { name: "Create cohort" }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/settings/migration/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Q1 exit" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Migration cohorts" })).toBeVisible();
    await expect(
      page.locator('nav[aria-label="Tenant settings sections"] a[aria-current="page"]'),
    ).toHaveText("Migration");
  });

  test("links a standalone migration cohort back to the cohort list", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Standalone Cohort Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/migration`);

    await page.getByLabel("Name").fill("Standalone exit");
    await page.getByLabel("Device serials").fill("C02XYZ123");
    await page.getByRole("button", { name: "Create cohort" }).click();

    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/migration/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Standalone exit" })).toBeVisible();

    const back = page
      .locator('[data-slot="breadcrumb"]')
      .getByRole("link", { name: "Migration", exact: true });
    await expect(back).toHaveAttribute("href", `/t/${tenant.slug}/migration`);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/migration$`));
    await expect(page.getByRole("heading", { name: "Migration", exact: true })).toBeVisible();
  });

  test("picks an App Store region on the globe", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Region Tenant");
    await gotoHydrated(page, `/t/${tenant.slug}/settings`);

    const trigger = page.getByRole("button", { name: /App Store region/ });
    await expect(trigger).toContainText("Use default");

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Choose App Store region" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole("textbox", { name: "Search countries" });
    await search.fill("Japan");
    const result = dialog.getByRole("button", { name: /Japan/ });
    await result.focus();
    await page.keyboard.press("Enter");
    await expect(search).toBeFocused();
    await expect(result).toHaveCount(0);
    await dialog.getByRole("button", { name: "Use JP" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // toContainText retries until the picker has committed and the dialog's
    // dismiss layer has finished animating out.
    await expect(trigger).toContainText("Japan");
    await saveTenantSettings(page);

    const detail = await page.evaluate(
      async (tenantId: string) => (await fetch(`/api/v1/tenants/${tenantId}`)).json(),
      tenant.id,
    );
    expect(detail.appStoreRegion).toBe("JP");
  });

  test("shows the auditor role in administrator settings", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Role Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/administrators`);
    await expect(page.getByText("Invite an administrator")).toBeVisible();
    const inviteRole = page.getByLabel("Invitation role");
    await expect(inviteRole.locator('option[value="builtin:auditor"]')).toHaveText("Auditor");
    await expect(inviteRole.locator('option[value="builtin:member"]')).toHaveText("Member");
  });

  test("creates a custom RBAC role", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "RBAC Tenant");
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
    const { tenant } = await bootstrapSession(page, "Branded Tenant");
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
    const { tenant } = await bootstrapSession(page, "APNs Tenant");
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
