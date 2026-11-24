import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import {
  addFilter,
  api,
  bootstrapTenant,
  createTenant,
  gotoHydrated,
  stepUpGrant,
} from "./helpers";

async function decodeQr(
  page: import("@playwright/test").Page,
  qr: import("@playwright/test").Locator,
) {
  const screenshot = await qr.screenshot();
  const image = await page.evaluate(async (base64) => {
    const element = new Image();
    element.src = "data:image/png;base64," + base64;
    await element.decode();

    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.drawImage(element, 0, 0);

    return {
      data: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
      width: canvas.width,
      height: canvas.height,
    };
  }, screenshot.toString("base64"));

  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
}

test.describe("device enrollment", () => {
  test("renders an invalid enrollment state without authentication", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });

    await gotoHydrated(page, "/enroll/not-a-real-enrollment");

    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("heading", { name: "Enroll in Mattrax" })).toBeVisible();
    await expect(page.getByText("This enrollment link is no longer valid.")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(/ask your administrator for a new link/i);
    await expect(
      page.getByRole("alert").getByRole("link", { name: /contact administrator/i }),
    ).toHaveAttribute("href", /^mailto:/);
    await expect(page.getByRole("main")).not.toHaveAttribute("style", /color-scheme/i);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("renders the public enrollment page and explains unavailable platforms", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Enroll Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.locator('[data-slot="card-title"]').first()).toContainText(/enroll in/i);
    await expect(page.getByText("Enroll Tenant", { exact: false }).first()).toBeVisible();

    // Every platform is explained; Windows is available even before APNs is set up.
    for (const platform of ["Apple", "Windows", "Android"]) {
      await expect(page.getByRole("tab", { name: new RegExp(`^${platform}$`) })).toBeVisible();
    }

    await page.getByRole("tab", { name: /^Apple$/ }).click();
    await expect(
      page.getByText(/Apple management is not configured|Apple enrollment is disabled/i),
    ).toBeVisible();

    await page.getByRole("tab", { name: /^Android$/ }).click();
    await expect(page.getByText("Android enrollment is turned off")).toBeVisible();
    await expect(page.getByText(/Android enrollment is disabled/i)).toBeVisible();
  });

  test("explains when Windows enrollment is turned off", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Disabled Windows Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ enabledWindows: false }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await page.getByRole("tab", { name: /^Windows$/ }).click();
    await expect(page.getByText("Windows enrollment is turned off")).toBeVisible();
    await expect(page.getByText(/Windows enrollment is disabled/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy Windows discovery URL" })).toHaveCount(0);
  });

  test("requires the enrollment password when one is configured", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Locked Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByText(/administrator has set an enrollment password/i)).toBeVisible();

    // The reveal control is a real toggle rather than a password field with a
    // decorative icon.
    const password = page.getByLabel("Enrollment password");
    const reveal = page.getByRole("button", { name: "Show password" });
    await expect(password).toHaveAttribute("type", "password");
    await expect(reveal).toHaveAttribute("aria-pressed", "false");
    await reveal.click();
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(password).toHaveAttribute("type", "text");

    await password.fill("wrong");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByRole("alert")).toContainText(/invalid/i);
  });

  test("server-renders the password form so it works without JavaScript", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "No JS Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    // The HTML must already contain the form, not "Verifying enrollment link".
    const html = await page.request.get(`/enroll/${enrollment.id}`).then((r) => r.text());
    expect(html).toContain("Enrollment password");
    expect(html).toMatch(/method="get"/i);
    expect(html).not.toContain("Verifying enrollment link");

    const browser = page.context().browser();
    expect(browser).not.toBeNull();
    const context = await browser!.newContext({ javaScriptEnabled: false });
    const noJs = await context.newPage();

    try {
      // Exercise a real native form submission with scripting disabled.
      await noJs.goto(`/enroll/${enrollment.id}`);
      await expect(noJs.getByLabel("Enrollment password")).toBeVisible();
      await expect(noJs.locator("form")).toHaveAttribute("method", "get");
      await expect(noJs.locator('input[name="code"]')).toHaveCount(1);

      await noJs.getByLabel("Enrollment password").fill("secret-code");
      await noJs.getByLabel("Enrollment password").press("Enter");
      await expect(noJs).toHaveURL(new RegExp(`/enroll/${enrollment.id}\\?code=secret-code$`));
      await expect(noJs.getByRole("tab", { name: /^Apple$/ })).toBeVisible();

      await noJs.goto(`/enroll/${enrollment.id}?code=wrong`);
      await expect(noJs.getByRole("alert")).toContainText(/invalid/i);
    } finally {
      await context.close();
    }
  });

  test("shows a tenant-scoped Windows discovery URL and marks Android unavailable", async ({
    page,
  }) => {
    const tenant = await bootstrapTenant(page, "Windows Tenant");

    const other = await createTenant(
      page,
      `Windows Other ${Math.random().toString(36).slice(2, 8)}`,
    );

    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ enabledAndroid: true }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    const otherEnrollment = await api<{ id: string }>(
      page,
      `/api/v1/tenants/${other.id}/enrollment`,
    );

    const details = await api<{
      windows: { discoveryUrl: string; tenantScoped: boolean; expiresAt?: string };
      android: { error: string } | string;
    }>(page, `/api/v1/enrollment/${enrollment.id}`);

    const otherDetails = await api<{
      windows: { discoveryUrl: string; tenantScoped: boolean };
    }>(page, `/api/v1/enrollment/${otherEnrollment.id}`);

    expect(details.windows.discoveryUrl).toMatch(/\/mdm\/windows\/discovery\?tenant=mttxw1\./);
    expect(details.windows.tenantScoped).toBe(true);
    expect(details.windows.expiresAt).toBeTruthy();
    // The token is tenant-specific: two tenants never share a URL.
    expect(otherDetails.windows.discoveryUrl).not.toBe(details.windows.discoveryUrl);
    expect(details.android).toMatchObject({
      error: expect.stringMatching(/Android Enterprise is not configured/i),
    });

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await page.getByRole("tab", { name: /^Windows$/ }).click();
    await expect(page.locator("#windows-discovery-url")).toHaveText(
      /\/mdm\/windows\/discovery\?tenant=mttxw1\./,
    );
    await expect(page.getByText(/deployment-wide/i)).toHaveCount(0);
    await expect(page.getByText(/scoped to your organization/i)).toBeVisible();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy Windows discovery URL" }).click();
    await expect(page.getByRole("button", { name: "Copy Windows discovery URL" })).toHaveText(
      "Copied",
    );

    await page.getByRole("tab", { name: /^Android$/ }).click();
    await expect(page.getByText(/Android Enterprise is not configured/i)).toBeVisible();
  });

  test("deletes a tenant after its enrollment link has been visited", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Deletable Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    // Visiting the public link writes an enrollment_attempt row. Tenant
    // deletion relies on ON DELETE CASCADE for that table.
    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.locator('[data-slot="card-title"]').first()).toContainText(/enroll in/i);

    const grant = await stepUpGrant(page, "tenant-delete");

    const deletion = await api<{ status: string; reclaimed?: object }>(
      page,
      `/api/v1/tenants/${tenant.id}`,
      {
        method: "DELETE",
        headers: { "x-mattrax-step-up": grant },
      },
    );

    expect(deletion.status).toBe("ok");
    expect(deletion.reclaimed).toBeDefined();
    const removed = await page.request.get(`/api/v1/tenants/${tenant.id}/devices/search`);
    expect(removed.status()).toBe(404);
  });

  test("shows a neutral no-longer-valid state after the link is reset", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Reset Link Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await api(page, `/api/v1/tenants/${tenant.id}/enrollment/reset`, { method: "POST" });

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByText("This enrollment link is no longer valid.")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(/ask your administrator for a new link/i);
    await expect(page.getByRole("alert")).toContainText(/reset or replaced/i);
    await expect(
      page.getByRole("alert").getByRole("link", { name: /contact administrator/i }),
    ).toHaveAttribute("href", /^mailto:/);
    await expect(page.getByRole("link", { name: /reload page/i })).toHaveCount(0);
  });

  test("renders a decodable QR code without the enrollment password", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "QR Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}?code=secret-code`);
    await expect(page.getByText(/scan to open this page/i)).toBeVisible();
    const qr = page.getByRole("img", { name: /qr code for this enrollment link/i });
    await expect(qr).toBeVisible();
    await expect(qr.locator("rect")).toHaveAttribute("fill", "var(--qr-background)");
    await expect(qr.locator("path")).toHaveAttribute("fill", "var(--qr-foreground)");

    const decoded = await decodeQr(page, qr);
    expect(decoded?.data).toBe(new URL(`/enroll/${enrollment.id}`, page.url()).toString());
    expect(decoded?.data).not.toContain("secret-code");
  });

  test("follows light and dark system themes without a forced light island", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Theme Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);
    const card = page.locator("[data-enrollment-card]");

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoHydrated(page, `/enroll/${enrollment.id}`);

      if (scheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

      await expect(card).not.toHaveClass(/theme-light/);
      await expect(page.getByRole("main")).not.toHaveAttribute("style", /color-scheme/i);
      await expect(card).toHaveCSS(
        "background-color",
        scheme === "dark" ? "rgb(23, 23, 22)" : "rgb(255, 255, 255)",
      );

      const qr = page.getByRole("img", { name: /qr code for this enrollment link/i });
      const decoded = await decodeQr(page, qr);
      expect(decoded?.data).toBe(new URL(`/enroll/${enrollment.id}`, page.url()).toString());
    }
  });

  test("keeps device details and platform controls usable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const tenant = await bootstrapTenant(page, "Mobile Details Tenant");
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ enabledAssetTag: true }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByRole("heading", { name: "Tell us about this device" })).toBeVisible();

    for (const label of ["Serial number", "Device name (optional)", "Asset tag (optional)"]) {
      const field = page.getByLabel(label);
      const box = await field.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }

    await page.getByLabel("Serial number").fill("SERIAL-123");
    await page.getByLabel("Device name (optional)").fill("Reception iPad");
    await page.getByLabel("Asset tag (optional)").fill("ASSET-42");
    await page.getByRole("button", { name: "Continue to enrollment" }).click();

    await expect(page.getByText("Device details saved")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What are you setting up?" })).toBeVisible();
    for (const platform of ["Apple", "Windows", "Android"]) {
      const tab = page.getByRole("tab", { name: platform, exact: true });
      const box = await tab.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test("returns a friendly error when the installed profile cannot be built", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Profile Error Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    const response = await page.request.get(
      `/api/v1/enrollment/${enrollment.id}/apple.mobileconfig`,
    );

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      message: "Apple management is not configured! Contact your administrator.",
    });

    const settings = await page.request.get(
      `/api/v1/enrollment/not-a-real-enrollment/apple.mobileconfig`,
    );

    expect(settings.status()).toBe(404);
  });

  test("shows the enrollment QR code in settings", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Settings QR Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await expect(page.getByRole("img", { name: /qr code for the enrollment link/i })).toBeVisible();
    await expect(page.getByText("Pre-registered devices")).toBeVisible();
  });

  test("shows recent enrollment activity with outcome badges", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Activity Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);
    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });

    // A wrong password is recorded as a diagnostic before the page redirects.
    const denied = await api<{ authenticated: boolean }>(
      page,
      `/api/v1/enrollment/${enrollment.id}?code=wrong`,
    );

    expect(denied.authenticated).toBe(false);

    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await expect(page.getByText("Enrollment activity")).toBeVisible();
    await expect(page.getByText("Bad password")).toBeVisible();
  });

  test("the health filter narrows the device list", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Health Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/devices`);
    await addFilter(page, "Health", "Critical");
    await expect(page).toHaveURL(/health=critical/);
    await expect(page.getByRole("button", { name: /Health is Critical/ })).toBeVisible();
  });

  test("saves maxDevices=0 as unlimited", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Unlimited Tenant");
    await gotoHydrated(page, `/t/${tenant.id}/settings/enrollment`);
    await page.getByRole("button", { name: /^edit settings$/i }).click();
    await page.getByLabel("Maximum devices").fill("0");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByLabel("Maximum devices")).toHaveValue("0");
    // Wait for the save to close the editor before reading the stored value;
    // the input keeps its typed value while the PATCH is still in flight.
    await expect(page.getByRole("button", { name: /^save$/i })).toHaveCount(0);

    const enrollment = await api<{ id: string; maxDevices: number }>(
      page,
      `/api/v1/tenants/${tenant.id}/enrollment`,
    );

    expect(enrollment.maxDevices).toBe(0);
  });
});

test.describe("enrollment platform preselection", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });

  test("opens the tab matching the browser's operating system", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Windows Preselect Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);

    await expect(page.getByRole("tablist")).toHaveAttribute("data-enrollment-platform", "windows");
    await expect(page.getByRole("tab", { name: /^Windows$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#windows-discovery-url")).toBeVisible();
    // The other tabs remain reachable; preselecting is not hiding them.
    await expect(page.getByRole("tab", { name: /^Apple$/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Android$/ })).toBeVisible();
  });
});
