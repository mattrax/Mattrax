import { expect, test } from "@playwright/test";
import { bootstrapSession, gotoHydrated } from "./helpers";

test("keeps the beginning of a long policy title visible at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { tenant } = await bootstrapSession(page, "Narrow Policy Tenant");
  const name = "Policy QA Narrow 1795944429098-estg0";

  await page.goto(`/t/${tenant.id}/policies/new`);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /^create policy$/i }).click();
  await expect(page).toHaveURL(/\/editor$/);

  const title = page.getByRole("heading", { level: 1, name, exact: true });
  await expect(title).toBeVisible();

  const layout = await title.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;

    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.trim()) {
        text = walker.currentNode;
        break;
      }
    }

    if (!text) throw new Error("Policy title has no text node");

    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.textContent?.length ?? 0));
    const firstWord = range.getBoundingClientRect();

    return {
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      firstWord: {
        left: firstWord.left,
        right: firstWord.right,
        top: firstWord.top,
        bottom: firstWord.bottom,
      },
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });

  expect(layout.firstWord.left).toBeGreaterThanOrEqual(layout.box.left - 1);
  expect(layout.firstWord.right).toBeLessThanOrEqual(layout.box.right + 1);
  expect(layout.firstWord.top).toBeGreaterThanOrEqual(layout.box.top - 1);
  expect(layout.firstWord.bottom).toBeLessThanOrEqual(layout.box.bottom + 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  const horizontalOverflow = await page.locator("main").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(horizontalOverflow.scrollWidth).toBeLessThanOrEqual(horizontalOverflow.clientWidth + 1);
});

test("renders the new-policy import form on a cold document load", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { tenant } = await bootstrapSession(page, "Cold Import Tenant");

  await gotoHydrated(page, `/t/${tenant.id}/policies/import`);

  await expect(page.getByRole("heading", { name: "Import policy", exact: true })).toBeVisible();
  const source = page.getByRole("region", { name: "Source", exact: true });
  await expect(source.getByLabel("File")).toBeVisible();
  await expect(source.getByLabel("Or paste")).toBeVisible();
  await expect(source.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is imported" })).toBeVisible();
  await expect(page.getByText("Loading policy", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(source).toBeVisible();
  await expect(source.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
});

test("exposes policy and Wi-Fi validation state to assistive technology", async ({ page }) => {
  const { tenant } = await bootstrapSession(page, "Accessible Validation Tenant");

  await page.goto(`/t/${tenant.id}/policies/new`);
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: /^create policy$/i }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");

  await name.fill("Accessible validation");
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await page.getByRole("button", { name: /^create policy$/i }).click();
  await expect(page).toHaveURL(/\/editor$/);

  const policyUrl = page.url().replace(/\/editor$/, "");
  await gotoHydrated(page, policyUrl);
  await page.getByRole("button", { name: "Add configuration", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add a configuration" });
  const ssid = dialog.getByLabel("Network name (SSID)");
  await dialog.getByRole("button", { name: "Add configuration", exact: true }).click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveText("Enter the network name (SSID).");
  await expect(alert).toHaveAttribute("aria-live", "polite");
  await expect(ssid).toBeFocused();
  await expect(ssid).toHaveAttribute("aria-invalid", "true");
  const describedBy = await ssid.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(dialog.locator(`[id="${describedBy}"]`)).toHaveText(
    "Enter the network name (SSID).",
  );

  await ssid.fill("Staff Wi-Fi");
  await expect(alert).toBeEmpty();
  await expect(ssid).not.toHaveAttribute("aria-invalid", "true");
  await expect(ssid).not.toHaveAttribute("aria-describedby", describedBy!);
});
