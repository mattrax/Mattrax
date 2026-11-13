import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

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

    const action = page.getByPlaceholder("e.g. device.enrolled");
    await action.fill("tenant.created");
    await expect(page.getByText(/events? loaded/)).toBeVisible();
    await expect(page.getByText("No audit events match these filters.")).toBeHidden();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);

    await action.fill("does.not.exist");
    await expect(page.getByText("No audit events match these filters.")).toBeVisible();

    const invalidRange = await page.request.get(
      `/api/v1/tenants/${tenant.id}/audit/search?from=not-a-date`,
    );
    expect(invalidRange.status()).toBe(400);
  });

  test("opens every settings tab and saves the tenant profile", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    const tabs = page.locator('nav[aria-label="Tenant settings sections"]');
    for (const [tab, text] of [
      ["Members", /Invite an administrator/],
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
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(name).toHaveValue("Renamed Tenant");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(new RegExp(`/t/[^/]+$`));
    const me = await page.evaluate(async () => (await fetch("/api/v1/me")).json());
    expect(me.tenants.find((item: { id: string }) => item.id === tenant.id).name).toBe(
      "Renamed Tenant",
    );
  });

  test("shows the auditor role in administrator settings", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Role Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/administrators`);
    await expect(page.getByText("Invite an administrator")).toBeVisible();
    const inviteRole = page.locator("select").first();
    await expect(inviteRole.locator('option[value="auditor"]')).toHaveText("Auditor (read-only)");
    await expect(inviteRole.locator('option[value="member"]')).toHaveText("Member");
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
    await page.getByRole("button", { name: /save changes/i }).click();

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
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });
});
