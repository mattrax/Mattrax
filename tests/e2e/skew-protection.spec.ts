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
});
