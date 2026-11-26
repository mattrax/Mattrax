import { expect, test } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

test.describe("delivery metrics", () => {
  test("keeps all five cards half-width at 390px", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    const tenant = await bootstrapTenant(page, "Delivery Metrics");
    await gotoHydrated(page, `/t/${tenant.slug}/settings/delivery`);

    const panel = page.getByRole("region", { name: "Apple push delivery" });
    const grid = panel.locator(".grid").first();
    const cards = grid.locator(":scope > div");

    await expect(cards).toHaveCount(5);

    const measurements = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          label: element.querySelector(".truncate")?.textContent ?? "",
          x: rect.x,
          width: rect.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      }),
    );

    expect(measurements.map((card) => card.label)).toEqual([
      "Configured",
      "Attempted",
      "Succeeding",
      "Failing",
      "Invalid token",
    ]);

    const widths = measurements.map((card) => card.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    expect(measurements[4]!.width).toBeCloseTo(measurements[0]!.width, 1);
    // The unmatched fifth card stays in the first column instead of becoming
    // a full-width section below its four peers.
    expect(measurements[4]!.x).toBeCloseTo(measurements[0]!.x, 1);
    expect(measurements.every((card) => card.scrollWidth <= card.clientWidth)).toBe(true);

    const columns = await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(2);
    expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});
