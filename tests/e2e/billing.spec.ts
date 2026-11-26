import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { bootstrapTenant, gotoHydrated } from "./helpers";

const summary = {
  plan: "pro",
  status: "active",
  billableDevices: 8,
  deviceLimit: 10,
  tenantLimit: 3,
  devicesUsed: 8,
  tenantsUsed: 1,
  overDeviceLimit: false,
  overTenantLimit: false,
  limitsConfigured: true,
  subscriptionId: "sub_billing_test",
  periodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  configured: true,
};

const mockBilling = async (page: Page) => {
  await page.route("**/api/v1/tenants/*/billing/invoices", (route) =>
    route.fulfill({
      json: {
        invoices: [
          {
            id: "in_billing_test",
            number: "1042",
            status: "paid",
            total: 2500,
            amountDue: 0,
            amountPaid: 2500,
            currency: "usd",
            createdAt: "2026-11-01T00:00:00.000Z",
            periodStart: "2026-11-01T00:00:00.000Z",
            periodEnd: "2026-12-01T00:00:00.000Z",
            hostedInvoiceUrl: "https://example.com/invoices/1042",
            pdfUrl: "https://example.com/invoices/1042.pdf",
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/tenants/*/billing/portal", (route) => route.abort());
  await page.route("**/api/v1/tenants/*/billing/checkout", (route) => route.abort());
  await page.route("**/api/v1/tenants/*/billing", (route) => route.fulfill({ json: summary }));
};

test.describe("billing settings", () => {
  test("makes device and tenant limits visible and accessible", async ({ page }) => {
    const tenant = await bootstrapTenant(page, "Billing Tenant");
    await mockBilling(page);
    await gotoHydrated(page, `/t/${tenant.id}/settings/billing`);

    await expect(page.getByRole("heading", { name: "Usage & limits", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current plan", exact: true })).toBeVisible();

    const devices = page.getByRole("progressbar", { name: "Device usage: 8 / 10" });
    await expect(devices).toHaveAttribute("max", "10");
    await expect(devices).toHaveAttribute("value", "8");
    await expect(devices).toHaveAttribute("aria-valuetext", "8 / 10");

    const tenants = page.getByRole("progressbar", { name: "Tenant usage: 1 / 3" });
    await expect(tenants).toHaveAttribute("max", "3");
    await expect(tenants).toHaveAttribute("value", "1");
    await expect(tenants).toHaveAttribute("aria-valuetext", "1 / 3");

    await expect(page.getByText("2 remaining", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Manage plan in Stripe" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View invoice 1042" })).toHaveAttribute(
      "target",
      "_blank",
    );

    const accessibility = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });
});
