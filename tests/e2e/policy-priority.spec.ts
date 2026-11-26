import { expect, test } from "@playwright/test";
import { bootstrapSession, gotoHydrated } from "./helpers";

test.describe("policy precedence", () => {
  test("edits priority and explains assignment precedence", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Precedence Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.getByLabel("Name").fill("Precedence policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    const policyUrl = page.url().replace(/\/editor$/, "");

    await gotoHydrated(page, policyUrl);
    await page.getByLabel("Conflict priority").fill("7");
    await page.getByRole("button", { name: /^save changes$/i }).click();
    await expect(page.getByRole("button", { name: /^save changes$/i })).toBeEnabled();

    await gotoHydrated(page, policyUrl);
    await expect(page.getByLabel("Conflict priority")).toHaveValue("7");
    await page.getByRole("link", { name: "Assignments", exact: true }).click();

    await expect(page.getByText("Precedence", { exact: true })).toBeVisible();
    await expect(page.getByText(/This policy has priority 7/)).toBeVisible();
    await expect(page.getByText(/A direct device include beats any group include/)).toBeVisible();
  });

  test("sets a group policy assignment to exclude", async ({ page }) => {
    const { tenant } = await bootstrapSession(page, "Group Mode Tenant");
    await page.goto(`/t/${tenant.id}/policies/new`);
    await page.getByLabel("Name").fill("Mode policy");
    await page.getByRole("button", { name: /^create policy$/i }).click();
    await expect(page).toHaveURL(/\/editor$/);

    await page.goto(`/t/${tenant.id}/groups`);
    await page
      .getByRole("link", { name: /create group/i })
      .first()
      .click();
    await page.locator("form input").first().fill("Mode group");
    await page.getByRole("button", { name: /^create group$/i }).click();
    await expect(page.getByRole("heading", { name: "Mode group" })).toBeVisible();

    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByRole("button", { name: /^policies$/i }).click();
    const row = page.getByRole("row").filter({ hasText: "Mode policy" });
    await row.locator("select").selectOption("exclude");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(
      page.getByRole("row").filter({ hasText: "Mode policy" }).locator("select"),
    ).toHaveValue("exclude");
  });
});
