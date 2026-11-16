import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeRemoteBillingService } from "../src/remoteBillingService.ts";

const origin = "https://mdm.example.com";
const licenseKey = "mtx_lic_test_key";

const summary = {
  plan: "device",
  status: "active",
  billableDevices: 12,
  deviceLimit: null,
  tenantLimit: null,
  devicesUsed: 12,
  tenantsUsed: 2,
  overDeviceLimit: false,
  overTenantLimit: false,
  limitsConfigured: false,
  subscriptionId: "sub_1",
  periodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  configured: true,
};

const service = (responses: ReadonlyArray<unknown>) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    const body = responses[calls.length - 1];

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  return {
    calls,
    billing: makeRemoteBillingService({
      url: "https://e.mattrax.app",
      licenseKey,
      origin,
      fetch: fetch as typeof globalThis.fetch,
    }),
  };
};

describe("remote deployment billing", () => {
  it("forwards summary and usage to the cloud licence API", async () => {
    const { billing, calls } = service([summary, { status: "ok" }, summary]);

    const first = await Effect.runPromise(
      billing.summary({ organizationId: "org-1", userId: "user-1" }),
    );

    expect(first).toMatchObject({ plan: "device", billableDevices: 12, configured: true });

    await Effect.runPromise(billing.reportUsage({ deviceCount: 15, tenantCount: 3 }));

    expect(calls[1]!.url).toBe("https://e.mattrax.app/api/platform/billing/usage");
    expect(calls[1]!.init.headers).toMatchObject({ authorization: `Bearer ${licenseKey}` });
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      origin,
      deviceCount: 15,
      tenantCount: 3,
    });
  });

  it("returns checkout URLs and quantities", async () => {
    const { billing, calls } = service([
      { url: "https://checkout.stripe.test/cs_1", quantity: 12 },
    ]);

    const result = await Effect.runPromise(
      billing.checkout({
        tenantId: "tenant-1",
        organization: { id: "org-1", name: "Acme", stripeCustomerId: null },
        request: {},
      }),
    );

    expect(result).toEqual({ url: "https://checkout.stripe.test/cs_1", quantity: 12 });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ tenantId: "tenant-1" });
  });

  it("reports a rejected licence as a billing error", async () => {
    const billing = makeRemoteBillingService({
      url: "https://e.mattrax.app",
      licenseKey,
      origin,
      fetch: (async () =>
        new Response(JSON.stringify({ message: "Licence origin does not match." }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })) as typeof globalThis.fetch,
    });

    await expect(
      Effect.runPromise(billing.summary({ organizationId: "org-1", userId: "user-1" })),
    ).rejects.toMatchObject({
      _tag: "EnterpriseStripeError",
      message: "Licence origin does not match.",
    });
  });
});
