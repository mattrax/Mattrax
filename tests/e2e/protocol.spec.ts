import { expect, test } from "@playwright/test";

/**
 * Booted-worker regression tests for the Cloud API's protocol routes.
 *
 * These previously returned `500 Service not found: ScepService /
 * WindowsMdmService` because the service layers were provided without
 * `provideMerge`, so unit tests that build their own layer never caught it.
 */
test.describe("protocol routes", () => {
  test("serves SCEP GetCACaps from the real service layer", async ({ page }) => {
    const response = await page.request.get("/mdm/apple/scep?operation=GetCACaps");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("SCEPStandard");
    expect(body).toContain("POSTPKIOperation");
  });

  test("malformed Apple MDM requests are protocol errors, not 500", async ({ page }) => {
    const response = await page.request.put("/mdm/apple/mdm", {
      headers: { "content-type": "application/x-apple-aspen-mdm" },
      data: "<plist></plist>",
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test("Windows discovery is mounted and reports malformed SOAP as a fault, not 500", async ({
    page,
  }) => {
    const response = await page.request.post("/mdm/windows/discovery", {
      headers: { "content-type": "application/soap+xml" },
      data: "<x/>",
    });
    // The tenant-scoped route is always mounted now; no deployment-wide pin is
    // required. Malformed SOAP is a 200 SOAP fault, never an opaque 500.
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Fault");
  });

  test("debug mailbox is available on localhost", async ({ page }) => {
    const response = await page.request.get("/api/debug/emails");
    expect(response.status()).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  test("dashboard HTML sends security headers", async ({ page }) => {
    const response = await page.request.get("/login");
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
