import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("policy designer", () => {
  test("switches platforms without a hydration or console error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await gotoHydrated(page, "/designer");
    await page.getByTitle("Edit Windows settings").click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // A selection gives the editor a live subtree; switching platforms then
    // changes the active selection identity, which used to desync hydration.
    await page
      .getByRole("button", { name: /BitLocker/ })
      .first()
      .click();
    await page.getByRole("button", { name: /^Add to policy$/ }).click();
    await expect(
      page.getByRole("button", { name: "Remove BitLocker from policy", exact: true }),
    ).toBeVisible();

    await page.getByTitle("Edit Android settings").click();
    await expect(page.getByRole("button", { name: /Android baseline/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTitle("Edit Apple settings").click();
    await page.getByTitle("Edit Windows settings").click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "Remove BitLocker from policy", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    expect(errors).toEqual([]);
  });

  test("browses the catalogue, applies a template and exports a SyncML artifact", async ({
    page,
  }) => {
    await gotoHydrated(page, "/designer");
    await expect(page.getByText("Build a policy in minutes")).toBeVisible();
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /security baseline/i }).click();
    await expect(page.getByRole("button", { name: "Remove Firewall from policy" })).toBeVisible();
    await page.locator('input[placeholder="Policy name"]').fill("Windows baseline");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export$/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain("Windows-baseline.syncml.xml");
    const contents = await readFile(await file.path(), "utf8");
    // Numeric and boolean settings keep their SyncML type instead of being
    // stringified by the catalogue's enum values.
    expect(contents).toContain('<Format xmlns="syncml:metinf">int</Format>');
    expect(contents).toContain("<Data>1</Data>");
  });

  test("hands a public draft to the dashboard", async ({ page }) => {
    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.getByRole("button", { name: /Deploy in Mattrax/ }).click();
    await page.waitForURL(/\/login\?returnTo=/);
    expect(page.url()).toContain(encodeURIComponent("/dashboard?designerDraft=1"));

    const draft = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mattrax:designer-draft") ?? "null"),
    );

    expect(draft.version).toBe(2);
    expect(draft.platforms.apple.length).toBeGreaterThan(0);
  });

  test("saves the same designer draft into a tenant policy", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Designer Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Designed policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, `${policyUrl}/design`);
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).toHaveURL(policyUrl, { timeout: 20_000 });
    await expect(page.getByText("Deployment history")).toBeVisible();
    await expect(page.getByText("Apple configuration").first()).toBeVisible();

    // The draft is stored with the policy, so it survives clearing browser
    // storage and opens in the same editor on another device.
    await page.evaluate(() => localStorage.clear());
    await gotoHydrated(page, `${policyUrl}/design`);
    await expect(page.getByRole("button", { name: "Remove Firewall", exact: true })).toBeVisible();
  });

  test("deploys a public draft into a workspace in one flow", async ({ page }) => {
    await bootstrapTenant(page, "Handoff Tenant");
    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.getByRole("button", { name: /Deploy in Mattrax/ }).click();
    await expect(page).toHaveURL(/\/dashboard\?designerDraft=1/);
    await expect(page.getByText("Policy draft ready")).toBeVisible();
    await page.getByRole("button", { name: /Create policy & continue/ }).click();
    await expect(page).toHaveURL(/\/design$/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Remove Firewall", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).not.toHaveURL(/\/design$/);
    await expect(page.getByText("Deployment history")).toBeVisible();
  });

  test("saves an Android policy from the dashboard designer", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Android Designer Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Android policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, `${policyUrl}/design`);
    await page.getByRole("button", { name: "Android", exact: true }).click();
    await page.getByRole("button", { name: /Android baseline/i }).click();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).toHaveURL(policyUrl, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Android policy", exact: true })).toBeVisible();
  });

  test("warns before replacing advanced-editor configurations", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Guard Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Guarded policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /^restrictions$/i }).click();
    await page.getByRole("checkbox").first().uncheck();
    await page.getByRole("button", { name: /^save$/i }).click();
    const policyUrl = page.url().replace(/\/editor$/, "");

    await gotoHydrated(page, `${policyUrl}/design`);
    await expect(
      page.getByText("This policy also has settings from the policy editor"),
    ).toBeVisible();
    await page.getByRole("button", { name: /security baseline/i }).click();
    await expect(page.getByRole("button", { name: /^Save policy$/ })).toBeEnabled();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).toHaveURL(policyUrl, { timeout: 20_000 });
    await expect(page.getByText("Apple configuration").first()).toBeVisible();
    // Designer saves leave configurations created in the policy editor alone.
    await expect(page.getByText("Device restrictions")).toBeVisible();
  });

  test("exports Android array enums as arrays", async ({ page }) => {
    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: "Android", exact: true }).click();
    await expect(
      page.getByText("Android Management API policy", { exact: false }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Android baseline/i }).click();
    await page
      .getByRole("checkbox", { name: /Disable the camera on secure keyguard screens/ })
      .check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export$/ }).click();
    const file = await download;
    const policy = JSON.parse(await readFile(await file.path(), "utf8"));
    expect(policy.keyguardDisabledFeatures).toContain("CAMERA");
  });

  test("loads the Windows catalogue incrementally", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());

      if (url.pathname.startsWith("/catalog/")) requested.push(url.pathname);
    });

    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // Browse only needs the small index; the old single file is gone and the
    // property search text is not fetched until the user searches.
    expect(requested).toContain("/catalog/windows/index.json");
    expect(requested).not.toContain("/catalog/windows.json");
    expect(requested).not.toContain("/catalog/windows/search.json");

    await page.getByPlaceholder("Search settings…").fill("cortana");
    await expect(page.getByText(/matching setting/).first()).toBeVisible({ timeout: 20_000 });
    expect(requested).toContain("/catalog/windows/search.json");
  });

  test("opens a Windows collection from a property search result", async ({ page }) => {
    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.getByPlaceholder("Search settings…").fill("AllowCortanaAboveLock");
    const result = page.getByRole("button", { name: /Above Lock/ }).first();
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("1 matching setting", { exact: true }).first()).toBeVisible();
    await result.click();

    // The collection file loads on demand and its settings become editable.
    await expect(page.getByRole("heading", { name: "Above Lock", exact: true })).toBeVisible();
    await expect(page.getByText("Add it to the policy to configure 3 settings.")).toBeVisible();
    await page.getByRole("button", { name: /^Add to policy$/ }).click();
    await expect(
      page.getByRole("button", { name: "Remove Above Lock from policy", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Allow Cortana Above Lock").first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("filters Android settings with the property search index", async ({ page }) => {
    await gotoHydrated(page, "/designer");
    await page.getByRole("button", { name: "Android", exact: true }).click();
    await page.getByRole("button", { name: /Android baseline/i }).click();
    await expect(page.getByRole("button", { name: "Remove Policy from policy" })).toBeVisible();

    await page.getByPlaceholder("Search settings…").fill("camera");
    await expect(page.getByText(/Showing \d+ settings? matching/)).toBeVisible({
      timeout: 20_000,
    });
    // The search index stores property keys on Android (not OMA addresses), so
    // matched settings must still render.
    await expect(page.getByRole("group", { name: "Camera Disabled" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Camera Access" })).toBeVisible();
    await expect(page.getByText("No settings match this filter.")).toHaveCount(0);
  });

  test("saves a Windows baseline with only applicable OMA-URIs", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Windows Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Windows policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, `${policyUrl}/design`);
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page.getByText("BitLocker", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /security baseline/i }).click();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).toHaveURL(policyUrl, { timeout: 20_000 });
    await expect(page.getByText("Windows configuration").first()).toBeVisible();
  });

  test("saves and rehydrates an Apple DDM declaration", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Declaration Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Declaration policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");
    await gotoHydrated(page, `${policyUrl}/design`);
    await page.getByPlaceholder("Search settings…").fill("Activation:Simple");
    await page.getByRole("button", { name: /Activation:Simple/ }).click();
    await page.getByRole("button", { name: /^Add to policy$/ }).click();
    await page.getByRole("button", { name: /^Save policy$/ }).click();
    await expect(page).toHaveURL(policyUrl, { timeout: 20_000 });
    await expect(page.getByText("Declaration").first()).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await gotoHydrated(page, `${policyUrl}/design`);
    await expect(
      page.getByRole("button", { name: "Remove Activation:Simple", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("This policy already has settings")).toHaveCount(0);
  });
});
