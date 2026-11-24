import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";

export default {
  title: "Mattrax landing redesign",
  baseUrl: "http://localhost:9055",
  steps: [
    {
      name: "Desktop hero and fleet console",
      note: "Light mode, 1440×1000. The entrance sequence has settled before capture.",
      run: async (page) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
        await page.route("**/api/v1/getSession", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ session: null, user: null }),
          }),
        );
        await page.goto("/?cdp=landing-redesign", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
        await page.getByRole("heading", { name: /Every device/ }).waitFor();
        const stageAnimation = await page
          .locator(".lr-stage")
          .evaluate((element) => getComputedStyle(element).animationName);
        assert.equal(stageAnimation, "lr-stage-enter");
        await page.waitForTimeout(1100);
        assert.match(await page.title(), /Mattrax/);
      },
    },
    {
      name: "Fleet filter shows only devices needing attention",
      note: "The pressed filter removes healthy rows and keeps the sample console interactive.",
      run: async (page) => {
        const attention = page.getByRole("button", { name: /Needs attention/ });
        await attention.click();
        await page.getByText("Field Tablet", { exact: true }).waitFor();
        assert.equal(await attention.getAttribute("aria-pressed"), "true");
        assert.equal(await page.getByText("Reception Mac", { exact: true }).count(), 0);
        await page.waitForTimeout(350);
      },
    },
    {
      name: "Policy trace switches to audit evidence",
      note: "The trace control changes the explanation panel without navigating away.",
      run: async (page) => {
        await page
          .locator(".lr-trace")
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(650);
        const audit = page.getByRole("button", { name: "Audit trail", exact: true });
        await audit.click();
        await page.getByRole("heading", { name: "Every change leaves a receipt." }).waitFor();
        assert.equal(await audit.getAttribute("aria-pressed"), "true");
        await page
          .locator(".lr-trace__body")
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(300);
      },
    },
    {
      name: "Capability cards and product visuals",
      note: "Scroll reveals have settled; the card visuals remain static sample data.",
      run: async (page) => {
        await page
          .locator(".lr-cap-grid")
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(800);
      },
    },
    {
      name: "Deployment switch explains self-hosting",
      note: "The cloud and self-hosted views share one accessible pressed-state control.",
      run: async (page) => {
        await page
          .locator(".lr-deploy")
          .evaluate((element) => element.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(650);
        const selfHost = page.getByRole("button", { name: "Self-host", exact: true });
        await selfHost.click();
        await page.getByRole("heading", { name: "Self-host on one Node container" }).waitFor();
        assert.equal(await selfHost.getAttribute("aria-pressed"), "true");
        await page.waitForTimeout(300);
      },
    },
    {
      name: "Pricing and FAQ preserve the conversion flow",
      note: "The existing auth-aware pricing and native FAQ disclosures remain intact.",
      run: async (page) => {
        await page
          .locator("#pricing")
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(700);
      },
    },
    {
      name: "Mobile hero reflows without horizontal overflow",
      note: "390×844 in light mode. The console stacks below the copy and keeps its filter controls.",
      run: async (page) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/?cdp=landing-redesign", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
        await page.getByRole("heading", { name: /Every device/ }).waitFor();
        await page.waitForTimeout(1100);
        const sizes = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        assert.ok(sizes.document <= sizes.viewport, JSON.stringify(sizes));
      },
    },
    {
      name: "Mobile navigation opens with the native popover",
      note: "Keyboard and touch users keep the same labelled navigation landmark.",
      run: async (page) => {
        await page.getByRole("button", { name: "Open navigation menu" }).click();
        await page.getByRole("navigation", { name: "Site" }).waitFor();
        await page.waitForTimeout(250);
      },
    },
    {
      name: "Reduced motion keeps every section readable",
      note: "No entrance or spatial animation runs; content is visible immediately.",
      run: async (page) => {
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        await page.goto("/?cdp=landing-redesign", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
        await page.getByRole("heading", { name: /Every device/ }).waitFor();
        const animationName = await page
          .locator(".lr-hero__title")
          .evaluate((element) => getComputedStyle(element).animationName);
        assert.equal(animationName, "none");
      },
    },
    {
      name: "Automated accessibility scan passes",
      note: "axe-core reports no violations in the reduced-motion landing document.",
      run: async (page) => {
        const results = await new AxeBuilder({ page }).analyze();
        assert.equal(
          results.violations.length,
          0,
          JSON.stringify(
            results.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              nodes: violation.nodes.map((node) => node.target),
            })),
            null,
            2,
          ),
        );
      },
    },
  ],
};
