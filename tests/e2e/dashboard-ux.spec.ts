import { expect, test } from "@playwright/test";
import { bootstrapSession, gotoHydrated } from "./helpers";

test("keeps the dashboard stable and tracks the active nav item", async ({ page }) => {
  const { tenant } = await bootstrapSession(page, "UX Tenant");
  await gotoHydrated(page, `/t/${tenant.id}/devices`);

  const gutter = await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollbarGutter,
  );

  expect(gutter).toContain("stable");

  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.getByRole("link", { name: "Devices", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await primary.getByRole("link", { name: "Groups", exact: true }).click();
  // Navigation starts from an id or slug URL; the tenant layout settles on the
  // canonical slug after hydration.
  await page.waitForURL(new RegExp(`/t/(${tenant.id}|${tenant.slug})/groups$`));
  await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/groups$`));

  await expect(primary.getByRole("link", { name: "Groups", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(primary.getByRole("link", { name: "Devices", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("writes a readable session presence cookie and the me shell cache", async ({ page }) => {
  const { tenant } = await bootstrapSession(page, "Cache Tenant");
  await gotoHydrated(page, `/t/${tenant.id}/devices`);

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "mattrax_session_presence")?.value).toMatch(
    /^v1\./,
  );

  const me: { account: { id: string } } = await (await page.request.get("/api/v1/me")).json();
  const cache = await page.evaluate(() => window.localStorage.getItem("mattrax:me-cache:v1"));
  expect(cache).toBeTruthy();
  const cached: { userId: string; updatedAt: number; data: unknown } = JSON.parse(cache!);

  expect(cached.userId).toBe(me.account.id);
  // The cache stamps the time it was written; the browser owns that clock.
  expect(cached.updatedAt).toEqual(expect.any(Number));
  expect(cached.data).toEqual(
    expect.objectContaining({
      tenants: expect.arrayContaining([expect.objectContaining({ id: tenant.id })]),
    }),
  );
});
