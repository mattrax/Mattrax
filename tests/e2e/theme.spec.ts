import { expect, test } from "@playwright/test";

/**
 * Theme resolution.
 *
 * The preference is stored in `localStorage` and resolved by an inline script
 * before the first paint, so these assertions run against the state the browser
 * claims at `commit` — not after hydration could have fixed it up.
 */
for (const theme of ["light", "dark"] as const) {
  test(`resolves ${theme} before paint`, async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.evaluate((value) => localStorage.setItem("mattrax:theme", value), theme);
    await page.reload({ waitUntil: "commit" });

    const early = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      dark: document.documentElement.classList.contains("dark"),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    }));

    expect(early.theme).toBe(theme);
    expect(early.dark).toBe(theme === "dark");
    expect(early.colorScheme).toBe(theme);
    expect(early.meta).toBe(theme === "dark" ? "#08080a" : "#ffffff");

    await page.waitForTimeout(600);

    const settled = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
    }));

    expect(settled.theme).toBe(theme);
    // The page canvas is the `--background` token: gray-1 in light, #08080a in dark.
    expect(settled.body).toBe(theme === "dark" ? "rgb(8, 8, 10)" : "rgb(252, 252, 252)");
  });
}

test("system follows the OS preference without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login", { waitUntil: "load" });
  await page.evaluate(() => localStorage.setItem("mattrax:theme", "system"));
  await page.reload({ waitUntil: "commit" });

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("light");
});

test("the brand logo swaps with the theme", async ({ page }) => {
  await page.goto("/login", { waitUntil: "load" });

  const visibleLogo = () =>
    page.evaluate(() => {
      const images = [...document.querySelectorAll("main a img")];

      return images.flatMap((image) =>
        image.getBoundingClientRect().width > 0 ? [image.getAttribute("src")] : [],
      );
    });

  await page.evaluate(() => localStorage.setItem("mattrax:theme", "light"));
  await page.reload({ waitUntil: "load" });
  expect(await visibleLogo()).toEqual(["/assets/brand/mattrax.png"]);

  await page.evaluate(() => localStorage.setItem("mattrax:theme", "dark"));
  await page.reload({ waitUntil: "load" });
  expect(await visibleLogo()).toEqual(["/assets/brand/mattrax-white-208.png"]);

  await page.evaluate(() => localStorage.removeItem("mattrax:theme"));
});
