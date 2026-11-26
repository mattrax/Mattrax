import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createTenant, gotoHydrated, register } from "../tests/e2e/helpers.ts";

const outputDirectory = process.env.BILLING_SCREENSHOT_DIR;
const revision = process.env.BILLING_REVISION ?? "before";
const email = `billing-${revision}-${Date.now()}@example.com`;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:9050";

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
  subscriptionId: "sub_billing_screenshot",
  periodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  configured: true,
};

const invoices = {
  invoices: [
    {
      id: "in_screenshot_1042",
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
    {
      id: "in_screenshot_1031",
      number: "1031",
      status: "paid",
      total: 2500,
      amountDue: 0,
      amountPaid: 2500,
      currency: "usd",
      createdAt: "2026-10-01T00:00:00.000Z",
      periodStart: "2026-10-01T00:00:00.000Z",
      periodEnd: "2026-11-01T00:00:00.000Z",
      hostedInvoiceUrl: "https://example.com/invoices/1031",
      pdfUrl: "https://example.com/invoices/1031.pdf",
    },
    {
      id: "in_screenshot_1019",
      number: "1019",
      status: "paid",
      total: 1840,
      amountDue: 0,
      amountPaid: 1840,
      currency: "usd",
      createdAt: "2026-09-14T00:00:00.000Z",
      periodStart: "2026-09-14T00:00:00.000Z",
      periodEnd: "2026-10-14T00:00:00.000Z",
      hostedInvoiceUrl: "https://example.com/invoices/1019",
      pdfUrl: "https://example.com/invoices/1019.pdf",
    },
  ],
};

export default {
  title: `Billing redesign — ${revision}`,
  baseUrl,
  steps: [
    {
      name: "billing usage in light mode",
      run: async (page) => {
        // cdp-report resolves page navigations against baseUrl but does not set
        // Playwright's request-context base URL, which the auth helpers use.
        const get = page.request.get.bind(page.request);
        const post = page.request.post.bind(page.request);
        page.request.get = (url, options) => get(new URL(url, baseUrl).href, options);
        page.request.post = (url, options) => post(new URL(url, baseUrl).href, options);
        await page.emulateMedia({ colorScheme: "light" });
        await page.route("**/api/v1/tenants/*/billing/invoices", (route) =>
          route.fulfill({ json: invoices }),
        );
        await page.route("**/api/v1/tenants/*/billing/portal", (route) => route.abort());
        await page.route("**/api/v1/tenants/*/billing/checkout", (route) => route.abort());
        await page.route("**/api/v1/tenants/*/billing", (route) =>
          route.fulfill({ json: summary }),
        );

        await register(page, { name: "Billing Screenshot", email });
        const tenant = await createTenant(page, "Billing Screenshots");
        await gotoHydrated(page, `/t/${tenant.id}/settings/billing`);
        await page.getByRole("heading", { name: "Billing", exact: true }).waitFor();
        await page.getByText("1042", { exact: true }).waitFor();
        assert.equal(await page.locator("html").getAttribute("data-theme"), "light");

        if (outputDirectory) {
          await mkdir(outputDirectory, { recursive: true });
          await page.screenshot({
            path: `${outputDirectory}/billing-${revision}-light.png`,
            fullPage: true,
            animations: "disabled",
          });
        }
      },
    },
    {
      name: "billing usage in dark mode",
      run: async (page) => {
        await page.evaluate(() => {
          localStorage.setItem("mattrax:theme", "dark");
          document.documentElement.classList.add("dark");
          document.documentElement.dataset.theme = "dark";
          document.documentElement.style.colorScheme = "dark";
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText("1042", { exact: true }).waitFor();
        assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");

        if (outputDirectory)
          await page.screenshot({
            path: `${outputDirectory}/billing-${revision}-dark.png`,
            fullPage: true,
            animations: "disabled",
          });
      },
    },
  ],
};
