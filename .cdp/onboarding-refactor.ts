import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createTenant, gotoHydrated, register } from "../tests/e2e/helpers.ts";

const revision = process.env.ONBOARDING_REVISION ?? "after";
const outputDirectory = process.env.ONBOARDING_SCREENSHOT_DIR;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:9050";
const email = `onboarding-${revision}-${Date.now()}@example.com`;

// Two steps done out of five, matching the reference's "2 of 5 complete".
// "Create a group" and "Invite a second administrator" are complete, so the
// first open step is "Create a policy".
const onboarding = {
  dismissedAt: null,
  groups: 1,
  policies: 0,
  assignedPolicies: 0,
  devices: 0,
  administrators: 2,
  pendingInvitations: 0,
  firstPolicyId: null,
};

const save = async (page: import("playwright-core").Page) => {
  if (!outputDirectory) return;

  await mkdir(outputDirectory, { recursive: true });
  const card = page.locator('section[aria-labelledby="onboarding-title"]');

  await card.screenshot({
    path: `${outputDirectory}/onboarding-${revision}.png`,
    animations: "disabled",
  });
  await page.screenshot({
    path: `${outputDirectory}/onboarding-${revision}-page.png`,
    animations: "disabled",
    fullPage: true,
  });
};

export default {
  title: `Onboarding checklist — ${revision}`,
  baseUrl,
  steps: [
    {
      name: "get started checklist on a partly set up tenant",
      run: async (page: import("playwright-core").Page) => {
        // cdp-report resolves page navigations against baseUrl but not the
        // request context used by the auth helpers.
        const get = page.request.get.bind(page.request);
        const post = page.request.post.bind(page.request);
        page.request.get = (url, options) => get(new URL(url, baseUrl).href, options);
        page.request.post = (url, options) => post(new URL(url, baseUrl).href, options);

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
        await page.route("**/api/v1/tenants/*/onboarding", (route) =>
          route.fulfill({ json: onboarding }),
        );

        await register(page, { name: "Onboarding Screenshot", email });
        const tenant = await createTenant(page, "Onboarding Screenshots");
        await gotoHydrated(page, `/t/${tenant.id}`);
        await page.getByRole("heading", { name: "Get started" }).waitFor();
        await page.getByText(/2 of 5/).waitFor();
        assert.match(await page.locator("#onboarding-title").textContent() ?? "", /Get started/);

        await save(page);
      },
    },
    ...(revision === "after"
      ? [
          {
            name: "first open step is highlighted as the next action",
            note: "The active row carries data-state=active and its Start link points at the policy editor.",
            run: async (page: import("playwright-core").Page) => {
              const active = page.locator('[data-state="active"]');
              await active.waitFor();
              assert.match(await active.textContent() ?? "", /Create a policy/);
              assert.match(await active.locator("a").getAttribute("href") ?? "", /\/policies\/new/);
            },
          },
          {
            name: "completed steps collapse behind a count",
            run: async (page: import("playwright-core").Page) => {
              const toggle = page.getByRole("button", { name: /Completed \(2\)/ });
              await toggle.waitFor();
              assert.equal(await toggle.getAttribute("aria-expanded"), "false");
              await toggle.click();
              await page.getByRole("link", { name: /Invite a second administrator/ }).waitFor();
              assert.equal(await toggle.getAttribute("aria-expanded"), "true");
            },
          },
          {
            name: "progress stays clear with reduced motion",
            note: "Emulating prefers-reduced-motion keeps the numeric progress and the ring's label.",
            run: async (page: import("playwright-core").Page) => {
              await page.emulateMedia({ reducedMotion: "reduce" });
              await page.getByText(/2 of 5 complete/).waitFor();
              await page.getByRole("img", { name: "2 of 5 steps complete" }).waitFor();
            },
          },
        ]
      : []),
  ],
};
