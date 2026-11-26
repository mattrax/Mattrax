import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeEntitlementSync } from "./entitlementSync.ts";

describe("entitlement sync", () => {
  it("sends the billing revision with the authenticated entitlement snapshot", async () => {
    let request: Request | undefined;
    const sync = makeEntitlementSync({
      url: "https://app.example.com",
      token: "services-token",
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(null, { status: 204 });
      },
    });

    await Effect.runPromise(
      sync({
        organizationId: "org-1",
        plan: "device",
        status: "canceled",
        revision: 7,
      }),
    );

    expect(request?.url).toBe("https://app.example.com/api/internal/billing/entitlement");
    expect(request?.headers.get("authorization")).toBe("Bearer services-token");
    await expect(request?.json()).resolves.toEqual({
      organizationId: "org-1",
      plan: "device",
      status: "canceled",
      revision: 7,
    });
  });

  it("surfaces a receiver rejection so Stripe can retry the event", async () => {
    const sync = makeEntitlementSync({
      url: "https://app.example.com",
      token: "services-token",
      fetch: async () => new Response("rejected", { status: 400 }),
    });

    await expect(
      Effect.runPromise(sync({ organizationId: "org-1", plan: "free", status: null, revision: 1 })),
    ).rejects.toThrow("rejected");
  });
});
