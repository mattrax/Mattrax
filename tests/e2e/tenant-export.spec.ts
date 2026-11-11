import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated, stepUpGrant } from "./helpers";

test.describe("tenant export and import", () => {
  test("downloads a bundle and imports it as a new tenant", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Bundle Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);

    const exported = await page.request.get(`/api/v1/tenants/${tenant.id}/export`);
    expect(exported.ok()).toBe(true);
    expect(exported.headers()["cache-control"]).toBe("no-store");
    expect(exported.headers()["content-disposition"]).toContain("attachment");
    expect(exported.headers()["x-tenant-export-version"]).toBe("1");

    const withAudit = await page.request.get(
      `/api/v1/tenants/${tenant.id}/export?includeAudit=true`,
    );
    expect(withAudit.ok()).toBe(true);
    const withAuditBody = (await withAudit.json()) as { auditLog?: unknown[] };
    expect(Array.isArray(withAuditBody.auditLog)).toBe(true);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export tenant" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^tenant-.+-\d{4}-\d{2}-\d{2}\.json$/);

    const path = await download.path();
    expect(path).not.toBeNull();
    const bundle = JSON.parse(await readFile(path!, "utf8")) as {
      version: number;
      tenant: { name: string; slug: string };
    };
    expect(bundle.version).toBe(1);
    expect(bundle.tenant.slug).toBe(tenant.slug);

    const rejected = await page.request.post("/api/v1/tenants/import", {
      data: { ...bundle, version: 2 },
      headers: {
        origin: "http://localhost:9050",
        "x-effect-auth-csrf": "1",
      },
    });
    expect(rejected.status()).toBe(400);

    await page.getByRole("button", { name: "Import tenant" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Import a tenant bundle")).toBeVisible();

    await page.getByLabel("Tenant bundle file").setInputFiles({
      name: "tenant-bundle.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(dialog.getByText(bundle.tenant.name)).toBeVisible();
    await dialog.getByRole("button", { name: "Import tenant" }).click();

    await expect(dialog.getByText(new RegExp(`^Imported ${tenant.slug}-2$`))).toBeVisible();
    await dialog.getByRole("button", { name: "Open imported tenant" }).click();
    await expect(page).toHaveURL(/\/t\/[^/]+\/settings$/);
    await expect(page.getByText("Tenant profile")).toBeVisible();
  });
});

test.describe("tenant backups", () => {
  test("runs a manual backup, lists it and downloads an authenticated bundle", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Backup Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings`);
    await expect(page.getByText("Automatic tenant backups")).toBeVisible();

    await page.getByRole("button", { name: "Back up now" }).click();
    await expect(page.getByText(/Last backup:/)).toBeVisible({ timeout: 30_000 });

    let succeeded: { id: string } | undefined;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/v1/tenants/${tenant.id}/backups`);
          if (!response.ok()) return undefined;
          const body = (await response.json()) as {
            backups: Array<{ id: string; status: string; trigger: string }>;
          };
          succeeded = body.backups.find(
            (run) => run.status === "succeeded" && run.trigger === "manual",
          );
          return succeeded?.id;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    const grant = await stepUpGrant(page, "backup-download");
    const download = await page.request.get(
      `/api/v1/tenants/${tenant.id}/backups/${succeeded!.id}/download`,
      { headers: { "x-mattrax-step-up": grant } },
    );
    expect(download.ok()).toBe(true);
    expect(download.headers()["cache-control"]).toBe("no-store");
    expect(download.headers()["content-disposition"]).toContain("attachment");
    const bundle = (await download.json()) as { version: number; tenant: { slug: string } };
    expect(bundle.version).toBe(1);
    expect(bundle.tenant.slug).toBe(tenant.slug);
  });
});
