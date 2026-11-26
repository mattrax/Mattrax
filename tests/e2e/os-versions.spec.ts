import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test("wraps OS-version enforcement copy inside the card at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tenant = await bootstrapTenant(page, "Narrow OS Versions Tenant");

  await page.evaluate(() => localStorage.setItem("mattrax:theme", "dark"));
  await gotoHydrated(page, `/t/${tenant.id}/os-versions`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const macos = page.getByRole("region", { name: /^macOS —/ });
  const paragraphs = [
    macos.getByText(/Enforce delivers Apple's DDM software-update enforcement declaration/),
    macos.getByText(/Apple only installs a target version its servers still publish/),
  ];

  for (const paragraph of paragraphs) {
    await expect(paragraph).toBeVisible();

    const layout = await paragraph.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const card = element.closest('[role="region"]')?.getBoundingClientRect();
      const style = getComputedStyle(element);

      if (!card) throw new Error("OS-version copy is not inside a card");

      return {
        left: box.left,
        right: box.right,
        cardLeft: card.left,
        cardRight: card.right,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
      };
    });

    expect(layout.left).toBeGreaterThanOrEqual(layout.cardLeft);
    expect(layout.right).toBeLessThanOrEqual(layout.cardRight);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.whiteSpace).toBe("normal");
    expect(layout.textOverflow).not.toBe("ellipsis");
  }

  const horizontalOverflow = await page.locator("main").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(horizontalOverflow.scrollWidth).toBeLessThanOrEqual(horizontalOverflow.clientWidth + 1);
});
