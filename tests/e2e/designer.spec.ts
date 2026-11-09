import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("policy designer", () => {
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
    const contents = await readFile((await file.path())!, "utf8");
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
    expect(draft.platform).toBe("apple");
    expect(draft.selections.length).toBeGreaterThan(0);
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
    await expect(page.getByText(/mttx.apple.custom.designer/)).toBeVisible();

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

  test("warns before replacing advanced-editor configurations", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Guard Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.locator("form input").first().fill("Guarded policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /^device$/i }).click();
    await page.getByRole("checkbox").first().uncheck();
    await page.getByRole("button", { name: /^save$/i }).click();
    const policyUrl = page.url().replace(/\/editor$/, "");

    await gotoHydrated(page, `${policyUrl}/design`);
    await expect(page.getByText("This policy already has settings")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save policy$/ })).toBeDisabled();
    await page.getByRole("button", { name: /security baseline/i }).click();
    await expect(page.getByRole("button", { name: /^Save policy$/ })).toBeDisabled();
    await page.getByLabel("Replace the existing configurations when I save").check();
    await expect(page.getByRole("button", { name: /^Save policy$/ })).toBeEnabled();
  });
});
