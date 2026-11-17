import { expect, test } from "@playwright/test";

test.describe("skew protection", () => {
  test("publishes the deployment serving this tab", async ({ request }) => {
    const version = await request.get("/version");

    expect(version.ok()).toBe(true);
    expect(version.headers()["cache-control"]).toBe("no-store");

    const body: { build?: string } = await version.json();
    const build = body.build;

    expect(build).toBeTruthy();
    expect(version.headers()["x-mattrax-build"]).toBe(build);

    // The client compares this document's build with `/version`; keep both
    // sources in agreement so a deploy is never reported spuriously.
    const html = await (await request.get("/login")).text();

    expect(html).toContain(`<meta name="mattrax-build" content="${build}"`);
  });

  test("rejects methods other than GET and HEAD", async ({ request }) => {
    const response = await request.post("/version");

    expect(response.status()).toBe(405);
    expect(response.headers()["allow"]).toBe("GET, HEAD");
  });

  test("reloads once when storage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      // Browser policy can make every session-storage access throw; the URL
      // marker is the only guard left, so it must still stop a reload loop.
      // Leave localStorage alone: the app's theme bootstrap uses it and an
      // unrelated failure would muddy this test.
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      const removeItem = Storage.prototype.removeItem;

      Storage.prototype.getItem = function (key: string) {
        if (this === sessionStorage) throw new DOMException("blocked", "SecurityError");

        return getItem.call(this, key);
      };

      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === sessionStorage) throw new DOMException("blocked", "SecurityError");

        setItem.call(this, key, value);
      };

      Storage.prototype.removeItem = function (key: string) {
        if (this === sessionStorage) throw new DOMException("blocked", "SecurityError");

        removeItem.call(this, key);
      };

      // `name` survives same-tab navigation, so it counts documents loaded.
      window.name = String(Number(window.name || "0") + 1);
    });

    await page.goto("/login");
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");

    expect(await page.evaluate(() => window.name)).toBe("1");

    const failChunk = () =>
      page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent("vite:preloadError", {
            cancelable: true,
            detail: new Error(
              `Failed to fetch dynamically imported module: ${location.origin}/assets/missing-chunk.js`,
            ),
          }),
        );
      });

    await failChunk();
    await page.waitForFunction(() => window.name === "2", undefined, { timeout: 10_000 });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await expect.poll(() => page.url()).not.toContain("__chunk_reload");

    // The reloaded document saw the marker, so a repeat failure must fail
    // closed instead of refreshing again.
    await failChunk();
    await page.waitForTimeout(2_000);

    expect(await page.evaluate(() => window.name)).toBe("2");
  });
});
