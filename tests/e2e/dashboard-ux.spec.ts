import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test("keeps the dashboard stable and animates the active nav indicator", async ({ page }) => {
  const tenant = await bootstrapTenant(page, "UX Tenant");
  await gotoHydrated(page, `/t/${tenant.id}/devices`);

  const gutter = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollbarGutter,
  );
  expect(gutter).toContain("stable");

  const indicator = page.locator('nav[aria-label="Primary"] span[aria-hidden="true"]');
  await expect(indicator).toBeVisible();
  const before = await indicator.getAttribute("style");

  await page.getByRole("link", { name: "Groups", exact: true }).click();
  await page.waitForURL(`**/t/${tenant.id}/groups`);

  await expect.poll(() => indicator.getAttribute("style"), { timeout: 2_000 }).not.toBe(before);
});

test("writes a readable session presence cookie and the me shell cache", async ({ page }) => {
  const tenant = await bootstrapTenant(page, "Cache Tenant");
  await gotoHydrated(page, `/t/${tenant.id}/devices`);

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "mattrax_session_presence")?.value).toMatch(
    /^v1\./,
  );

  const cache = await page.evaluate(() => window.localStorage.getItem("mattrax:me-cache:v1"));
  expect(cache).toBeTruthy();
  expect(JSON.parse(cache!)).toMatchObject({
    userId: expect.any(String),
    data: { tenants: expect.arrayContaining([expect.objectContaining({ id: tenant.id })]) },
  });
});
