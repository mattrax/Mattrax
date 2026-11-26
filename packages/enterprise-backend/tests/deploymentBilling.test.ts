import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import { makeRemoteBillingService } from "@mattrax/enterprise-billing";

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

const service = (responses: ReadonlyArray<unknown>, status = 200) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });

    const body = responses[calls.length - 1];

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  // SAFETY: the fake fetch stands in for the platform fetch service; the
  // shared client layer turns it into the HttpClient the billing client uses.
  const transport: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );

  // SAFETY: the transport layer discharges the HTTP requirement of these
  // effects; the cast keeps the test call sites free of layer plumbing.
  const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
    Effect.runPromise(effect.pipe(Effect.provide(transport)) as Effect.Effect<A, E, never>);

  return {
    calls,
    run,
    billing: makeRemoteBillingService({
      url: "https://e.mattrax.app",
      licenseKey,
      origin,
    }),
  };
};

describe("remote deployment billing", () => {
  it("forwards summary and usage to the cloud licence API", async () => {
    const { billing, calls, run } = service([summary, { status: "ok" }, summary]);

    const first = await run(
      billing.summary({ organizationId: "org-1", accountId: "user-1" } as never),
    );

    expect(first).toMatchObject({ plan: "device", billableDevices: 12, configured: true });

    await run(billing.reportUsage({ deviceCount: 15, tenantCount: 3 }));

    expect(calls[1].url).toBe("https://e.mattrax.app/api/platform/billing/usage");
    expect(calls[1].init.headers).toMatchObject({ authorization: `Bearer ${licenseKey}` });
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      origin,
      deviceCount: 15,
      tenantCount: 3,
    });
  });

  it("returns checkout URLs and quantities", async () => {
    const { billing, calls, run } = service([
      { url: "https://checkout.stripe.test/cs_1", quantity: 12 },
    ]);

    const result = await run(
      billing.checkout({
        tenantId: "tenant-1",
        organization: { id: "org-1", name: "Acme" },
        request: {},
        usage: { deviceCount: 12, tenantCount: 2 },
      }),
    );

    expect(result).toEqual({ url: "https://checkout.stripe.test/cs_1", quantity: 12 });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ tenantId: "tenant-1" });
  });

  it("reports a rejected licence as a billing error", async () => {
    const { billing, run } = service([{ message: "Licence origin does not match." }], 403);

    await expect(
      run(billing.summary({ organizationId: "org-1", accountId: "user-1" } as never)),
    ).rejects.toMatchObject({
      _tag: "EnterpriseStripeError",
      message: "Licence origin does not match.",
    });
  });
});
