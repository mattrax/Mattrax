import { expect, test } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("device fleet management", () => {
  test("searches, filters and exports the device list", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Fleet Tenant");

    // The filter bar is rendered and paginates even with no devices.
    await expect(page.getByLabel("Filter by status")).toBeVisible();
    await expect(page.getByLabel("Filter by platform")).toBeVisible();
    await expect(page.getByLabel("Filter by group")).toBeVisible();
    await expect(page.getByLabel("Filter by last seen")).toBeVisible();
    await expect(page.getByText("Page 1 of 1")).toBeVisible();
    await expect(page.getByRole("button", { name: /previous/i })).toBeDisabled();

    // The search endpoint is tenant-scoped and returns the agreed shape.
    const found = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?limit=10`,
    );

    expect(found).toEqual({ devices: [], total: 0 });

    // Filtering and sorting compile against MySQL even with no matching rows.
    const filtered = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?status=enrolled&proto=apple&staleDays=30&sort=lastSeenAt&direction=desc&limit=10&offset=0`,
    );

    expect(filtered).toEqual({ devices: [], total: 0 });

    // Group filters use a SQL subquery scoped to the tenant.
    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Field Ops" }),
    });

    const inGroup = await api<{ devices: unknown[]; total: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/devices/search?groupId=${group.id}`,
    );

    expect(inGroup).toEqual({ devices: [], total: 0 });

    // A tenant id the caller cannot see is rejected rather than leaking rows.
    const missing = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/devices/search?limit=10",
    );

    expect(missing.status()).toBe(404);

    // Export responds with an attachment and RFC 4180 CSV.
    const response = await page.request.get(`/api/v1/tenants/${tenant.id}/devices/export`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(await response.text()).toBe(
      "Name,Serial,Model,Platform,Status,OS version,OS build,Last seen,Enrolled at,Asset tag,Model number,FileVault,Battery health,Capabilities,Inventory updated,Notes,Groups\r\n",
    );

    // The toolbar action downloads a dated CSV file.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    expect((await download).suggestedFilename()).toMatch(/^devices-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("drives the table from the keyboard and advertises the shortcuts", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Keyboard Tenant");

    const alpha = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Keyboard Alpha" }),
    });

    const beta = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Keyboard Beta" }),
    });

    await gotoHydrated(page, `/t/${tenant.slug}/groups`);
    const search = page.getByLabel("Search table");

    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await search.fill("Keyboard");
    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");

    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+f`);
    await expect(search).toBeFocused();

    // Arrow keys move a roving tabindex between rows; Enter opens the row.
    const activeText = () => page.evaluate(() => document.activeElement?.textContent ?? "");
    await page.getByRole("link", { name: "Keyboard Alpha" }).focus();
    const start = await activeText();
    await page.keyboard.press("ArrowDown");
    let moved = await activeText();

    if (moved === start) {
      await page.keyboard.press("ArrowUp");
      moved = await activeText();
    }

    expect(moved).not.toBe(start);
    expect(moved).toContain("Keyboard");
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TR");

    // Select every row on the page, then Escape clears the selection.
    await page.keyboard.press(`${mod}+a`);
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("2 selected");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/groups/(${alpha.id}|${beta.id})$`));
  });

  test("keeps typed device search and sends it to the search endpoint", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Search Tenant");
    const search = page.getByPlaceholder(/search name/i);

    const request = page.waitForResponse((response) => {
      if (!response.url().includes(`/api/v1/tenants/${tenant.id}/devices/search`)) return false;

      return new URL(response.url()).searchParams.get("q") === "abc";
    });

    await search.fill("abc");
    await expect(search).toHaveValue("abc");
    expect((await request).ok()).toBe(true);
    // The URL mirror only writes after the debounce, but the input must still
    // hold the typed value before and after that write.
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("abc");
    await expect(search).toHaveValue("abc");

    // Additional keystrokes are not reverted to the last URL value.
    const extended = page.waitForResponse((response) => {
      if (!response.url().includes(`/api/v1/tenants/${tenant.id}/devices/search`)) return false;

      return new URL(response.url()).searchParams.get("q") === "abcd";
    });

    await search.fill("abcd");
    await expect(search).toHaveValue("abcd");
    expect((await extended).ok()).toBe(true);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("abcd");

    // Other controls still round-trip through the URL.
    await page.getByLabel("Filter by status").selectOption("enrolled");
    await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("enrolled");
    await page.getByLabel("Filter by platform").selectOption("apple");
    await expect.poll(() => new URL(page.url()).searchParams.get("proto")).toBe("apple");
    await page.getByLabel("Sort devices").selectOption("lastSeenAt");
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("lastSeenAt");

    // A group created after mount only appears in the select after a reload.
    const group = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Field Ops" }),
    });

    await gotoHydrated(page, page.url());
    await page.getByLabel("Filter by group").selectOption(group.id);
    await expect.poll(() => new URL(page.url()).searchParams.get("groupId")).toBe(group.id);
    await page.getByLabel("Filter by health").selectOption("critical");
    await expect.poll(() => new URL(page.url()).searchParams.get("health")).toBe("critical");
    await page.getByLabel("Filter by push delivery").selectOption("failing");
    await expect.poll(() => new URL(page.url()).searchParams.get("push")).toBe("failing");
    await page.getByLabel("Filter by last seen").selectOption("7");
    await expect.poll(() => new URL(page.url()).searchParams.get("staleDays")).toBe("7");

    // The URL is the source of truth after a reload.
    await gotoHydrated(page, page.url());
    await expect(search).toHaveValue("abcd");
    await expect(page.getByLabel("Filter by status")).toHaveValue("enrolled");
    await expect(page.getByLabel("Filter by platform")).toHaveValue("apple");
    await expect(page.getByLabel("Filter by group")).toHaveValue(group.id);
    await expect(page.getByLabel("Filter by health")).toHaveValue("critical");
    await expect(page.getByLabel("Filter by push delivery")).toHaveValue("failing");
    await expect(page.getByLabel("Filter by last seen")).toHaveValue("7");
    await expect(page.getByLabel("Sort devices")).toHaveValue("lastSeenAt");

    // Clearing filters clears both the controls and the URL.
    await page
      .getByRole("button", { name: /clear filters/i })
      .first()
      .click();
    await expect(search).toHaveValue("");
    await expect(page.getByLabel("Filter by status")).toHaveValue("");
    await expect(page.getByLabel("Filter by group")).toHaveValue("");
    await expect(page.getByLabel("Filter by health")).toHaveValue("");
    await expect(page.getByLabel("Filter by push delivery")).toHaveValue("");
    await expect(page.getByLabel("Filter by last seen")).toHaveValue("");
    await expect.poll(() => new URL(page.url()).searchParams.toString()).toBe("");
  });

  test("shows the tenant health rollup and exposes device health", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Health Tenant");

    const summary = await api<{
      counts: {
        total: number;
        healthy: number;
        attention: number;
        critical: number;
        stale: number;
        unknown: number;
      };
      reasons: unknown[];
      devices: unknown[];
    }>(page, `/api/v1/tenants/${tenant.id}/device-health`);

    expect(summary.counts).toEqual({
      total: 0,
      healthy: 0,
      attention: 0,
      critical: 0,
      stale: 0,
      unknown: 0,
    });
    expect(summary.reasons).toEqual([]);
    expect(summary.devices).toEqual([]);

    await gotoHydrated(page, `/t/${tenant.slug}`);
    await expect(page.getByRole("heading", { name: "Fleet overview", exact: true })).toBeVisible();

    for (const label of [
      "Managed devices",
      "Devices needing attention",
      "Critical devices",
      "Stale devices",
    ])
      await expect(page.getByRole("heading", { name: label, exact: true }).first()).toBeVisible();

    // Credential monitoring is tenant-scoped too.
    const credentials = await api<{
      apns: { configured: boolean; level: string };
      scepCa: { configured: boolean; level: string };
      deviceCertificates: { total: number };
    }>(page, `/api/v1/tenants/${tenant.id}/credential-health`);

    expect(credentials.apns).toMatchObject({ configured: false, level: "missing" });
    expect(credentials.scepCa.level).toMatch(/missing|ok/);
    expect(credentials.deviceCertificates.total).toBe(0);

    // APNs delivery health is a settings diagnostic, not overview content.
    const pushHealth = await api<{
      counts: {
        configured: number;
        attempted: number;
        succeeded: number;
        failing: number;
        invalidToken: number;
      };
      recentFailures: unknown[];
    }>(page, `/api/v1/tenants/${tenant.id}/push-health`);

    expect(pushHealth.counts).toEqual({
      configured: 0,
      attempted: 0,
      succeeded: 0,
      failing: 0,
      invalidToken: 0,
    });
    expect(pushHealth.recentFailures).toEqual([]);
    await expect(page.getByText("No data to chart.")).toBeVisible();
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await expect(page.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();
    await gotoHydrated(page, `/t/${tenant.id}/settings/delivery`);
    await expect(
      page.getByRole("heading", { name: "Apple push delivery", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent failures", exact: true })).toBeVisible();

    // Device activity is tenant-scoped and missing devices are a 404.
    const missingActivity = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/activity`,
    );

    expect(missingActivity.status()).toBe(404);

    const missingPushHealth = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/push-health",
    );

    expect(missingPushHealth.status()).toBe(404);

    const missingCredentials = await page.request.get(
      "/api/v1/tenants/not-a-real-tenant/credential-health",
    );

    expect(missingCredentials.status()).toBe(404);

    // A tenant the caller cannot see is rejected rather than leaking counts.
    const missing = await page.request.get("/api/v1/tenants/not-a-real-tenant/device-health");
    expect(missing.status()).toBe(404);

    // Unknown devices do not expose health or identity actions.
    const unknownHealth = await page.request.get(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/health`,
    );

    expect(unknownHealth.status()).toBe(404);

    const unknownRevoke = await page.request.post(
      `/api/v1/tenants/${tenant.id}/devices/not-a-device/revoke-identity`,
      { headers: { origin: "http://localhost:9050", "x-effect-auth-csrf": "1" } },
    );

    expect(unknownRevoke.status()).toBe(404);
  });

  test("imports pre-registered devices from a CSV with preview validation", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Import Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Staff" }),
    });
    await gotoHydrated(page, `/t/${tenant.id}/devices`);

    await page.getByRole("button", { name: /import csv/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Import pre-registered devices")).toBeVisible();
    const input = page.locator('input[type="file"]');

    // A row without a serial is surfaced before anything is sent.
    await input.setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("serial,name\n,Missing serial\n"),
    });
    await expect(dialog.getByText(/serial is required/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^import 0 devices$/i })).toBeDisabled();

    await input.setInputFiles({
      name: "devices.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "serial,name,asset_tag,group,notes\r\nC02IMPORT,Campus Mac,AT-900,Staff,Imported by e2e\r\n",
      ),
    });
    await expect(dialog.getByText(/1\s+row ready/i)).toBeVisible();
    await expect(dialog.getByText("C02IMPORT")).toBeVisible();
    await dialog.getByRole("button", { name: /^import 1 device$/i }).click();
    await expect(dialog.getByText("Created")).toBeVisible();
    await dialog.getByRole("button", { name: /^done$/i }).click();

    const registrations = await api<{
      rows: Array<{ serial: string; name: string; assetTag: string; groupName: string }>;
    }>(page, `/api/v1/tenants/${tenant.id}/device-pre-registrations`);

    expect(registrations.rows).toEqual([
      expect.objectContaining({
        serial: "C02IMPORT",
        name: "Campus Mac",
        assetTag: "AT-900",
        groupName: "Staff",
      }),
    ]);
  });
});
