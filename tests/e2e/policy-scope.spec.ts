import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

/**
 * Delivery scope is authored in the policy editor. The API validates it, so the
 * round trip proves the scope is stored, returned and rendered rather than only
 * living in component state.
 */
test("marks a configuration as user scope and keeps it across reloads", async ({ page }) => {
  const tenant = await bootstrapTenant(page, "User Scope Tenant");

  await page.goto(`/t/${tenant.id}/policies/new`);
  await page.getByLabel("Name").fill("User settings");
  await page.getByRole("button", { name: /^create policy$/i }).click();
  await expect(page).toHaveURL(/\/editor$/);

  const policyUrl = page.url().replace(/\/editor$/, "");

  await page.getByRole("button", { name: /^edit$/i }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();

  // `app.settings` is one of the declaration types Apple documents with a user
  // scope on macOS, so the API accepts it.
  const configurations = {
    "mttx.apple.declaration.usersettings": {
      kind: "com.apple.configuration.app.settings",
      configuration: {},
    },
  };

  const json = page.locator("textarea");
  await json.fill(JSON.stringify(configurations, null, 2));
  await json.blur();

  await page.getByLabel("Scope").selectOption("user");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText("Policy configurations saved"),
  ).toBeVisible();

  await gotoHydrated(page, `${policyUrl}/editor`);
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  await expect(page.getByLabel("Scope")).toHaveValue("user");

  // The list summarises how many kinds are delivered on the user channel.
  await gotoHydrated(page, `/t/${tenant.id}/policies`);
  const row = page.getByRole("row").filter({ hasText: "User settings" });
  await expect(row.getByText("1 user")).toBeVisible();
});

test("rejects a user-scoped setting the platform cannot deliver", async ({ page }) => {
  const tenant = await bootstrapTenant(page, "Scope Validation Tenant");

  await page.goto(`/t/${tenant.id}/policies/new`);
  await page.getByLabel("Name").fill("Invalid scope");
  await page.getByRole("button", { name: /^create policy$/i }).click();
  await expect(page).toHaveURL(/\/editor$/);

  await page.getByRole("button", { name: /^edit$/i }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();

  // Android has no per-user policy: the API must refuse rather than widening
  // the setting to the whole device.
  const json = page.locator("textarea");
  await json.fill(JSON.stringify({ "mttx.android.policy.usersettings": { policy: {} } }, null, 2));
  await json.blur();

  await page.getByLabel("Scope").selectOption("user");
  await page.getByRole("button", { name: /^save$/i }).click();

  await expect(page.getByText(/assigns a policy to a device, not a user/)).toBeVisible();
});
