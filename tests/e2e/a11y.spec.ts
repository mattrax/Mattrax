import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { api, bootstrapTenant, gotoHydrated } from "./helpers";

/**
 * WCAG 2.0/2.1/2.2 A+AA plus axe's best-practice rules. The audit covers the
 * public and authentication surfaces only; dashboard routes are covered by the
 * feature specs that own them.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"];

const summarize = (violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) =>
  violations
    .map(
      (violation) =>
        `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}\n` +
        violation.nodes.map((node) => `  ${node.target.join(" ")}`).join("\n"),
    )
    .join("\n\n");

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  expect(results.violations, `${label}\n\n${summarize(results.violations)}`).toEqual([]);
}

test.describe("accessibility audit", () => {
  test("public and authentication pages have no axe violations", async ({ page }) => {
    const pages = [
      { path: "/", ready: page.getByRole("heading", { level: 1 }) },
      { path: "/login", ready: page.locator("#email") },
      { path: "/register", ready: page.locator("#name") },
    ];

    for (const entry of pages) {
      await gotoHydrated(page, entry.path);
      await expect(entry.ready).toBeVisible();
      await expectNoViolations(page, entry.path);
    }
  });

  test("the public enrollment page has no axe violations", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "A11y Enroll Tenant");
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);
    await expect(page.getByRole("tablist", { name: /enrollment platform/i })).toBeVisible();
    await expectNoViolations(page, `/enroll/${enrollment.id}`);
  });
});

test.describe("enrollment semantics", () => {
  test("labels the password, links its error, and exposes platform tabs", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "A11y Password Tenant");

    await api(page, `/api/v1/tenants/${tenant.id}/enrollment`, {
      method: "PATCH",
      body: JSON.stringify({ code: "secret-code" }),
    });
    const enrollment = await api<{ id: string }>(page, `/api/v1/tenants/${tenant.id}/enrollment`);

    await gotoHydrated(page, `/enroll/${enrollment.id}`);

    const password = page.getByLabel("Enrollment password");
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("autocomplete", "off");

    await password.fill("wrong");
    await page.getByRole("button", { name: /^continue$/i }).click();

    const error = page.getByRole("alert");
    await expect(error).toContainText(/invalid/i);
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute("aria-describedby", /enrollment-password-error/);

    await password.fill("secret-code");
    await page.getByRole("button", { name: /^continue$/i }).click();

    const tablist = page.getByRole("tablist", { name: /enrollment platform/i });
    await expect(tablist).toBeVisible();

    const apple = page.getByRole("tab", { name: "Apple" });
    const windows = page.getByRole("tab", { name: "Windows" });

    await apple.click();
    await expect(apple).toHaveAttribute("aria-selected", "true");
    await expect(windows).toHaveAttribute("aria-selected", "false");

    // Automatic activation: arrow keys move selection and focus together.
    await apple.focus();
    await page.keyboard.press("ArrowRight");
    await expect(windows).toBeFocused();
    await expect(windows).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "enrollment-tab-windows",
    );

    // Read-only tokens are labelled rather than described only by nearby copy.
    await expect(page.locator("#windows-discovery-url")).toHaveText(/discovery/);
  });
});
