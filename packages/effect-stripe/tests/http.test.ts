import { createHmac } from "node:crypto";
import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { HttpStripeClient, verifyStripeSignature } from "../src/index.js";

const json = (body: Schema.Json, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const signingHeader = (
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) => {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  return `t=${timestamp},v1=${digest}`;
};

describe("HttpStripeClient", () => {
  it("creates a customer with form-encoded metadata and bearer auth", async () => {
    const requests: RequestInit[] = [];

    const client = new HttpStripeClient("sk_test", {
      fetch: async (_url, init) => {
        requests.push(init ?? {});

        return json({ id: "cus_1" });
      },
    });

    const customer = await client.customers.create({
      name: "Acme",
      email: "billing@acme.test",
      metadata: { organizationId: "org_1" },
    });

    expect(customer.id).toBe("cus_1");
    expect(requests).toHaveLength(1);

    const init = requests[0];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk_test");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(String(init.body));
    expect(body.get("name")).toBe("Acme");
    expect(body.get("email")).toBe("billing@acme.test");
    expect(body.get("metadata[organizationId]")).toBe("org_1");
  });

  it("searches customers with query parameters and no body", async () => {
    let url = "";

    const client = new HttpStripeClient("sk_test", {
      fetch: async (input, init) => {
        url = String(input);
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();

        return json({ data: [{ id: "cus_1" }], has_more: false });
      },
    });

    const result = await client.customers.search({
      query: 'metadata["organizationId"]:"org_1"',
      limit: 1,
    });

    expect(result.data).toHaveLength(1);
    expect(url).toContain("/v1/customers/search?");
    expect(decodeURIComponent(url)).toContain('query=metadata["organizationId"]:"org_1"');
    expect(url).toContain("limit=1");
  });

  it("retries a rate-limited request", async () => {
    let calls = 0;

    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 2,
      fetch: async () => {
        calls += 1;

        return calls === 1
          ? new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "slow" } }), {
              status: 429,
              headers: { "retry-after": "0" },
            })
          : json({ id: "cus_1" });
      },
    });

    await expect(client.customers.create({ name: "Acme" })).resolves.toEqual({ id: "cus_1" });
    expect(calls).toBe(2);
  });

  it("maps API errors to SDK error names", async () => {
    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 0,
      fetch: async () =>
        json({ error: { type: "invalid_request_error", message: "bad", param: "name" } }, 400),
    });

    await expect(client.customers.create({ name: "Acme" })).rejects.toMatchObject({
      name: "StripeError",
      type: "StripeInvalidRequestError",
      param: "name",
      statusCode: 400,
    });
  });
});

describe("HttpStripeClient billing operations", () => {
  const recordingClient = () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];

    const client = new HttpStripeClient("sk_test", {
      host: "https://stripe.test",
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: String(init?.body ?? ""),
        });

        return json({ id: "obj_1" });
      },
    });

    return { client, calls };
  };

  it("renames and retrieves a customer", async () => {
    const { client, calls } = recordingClient();

    await client.customers.update("cus_1", { name: "Acme Holdings" });
    await client.customers.retrieve("cus_1");

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://stripe.test/v1/customers/cus_1",
    });
    expect(new URLSearchParams(calls[0].body).get("name")).toBe("Acme Holdings");
    expect(calls[1]).toMatchObject({
      method: "GET",
      url: "https://stripe.test/v1/customers/cus_1",
    });
  });

  it("creates a subscription Checkout Session with metadata and a trial", async () => {
    const { client, calls } = recordingClient();

    await client.checkout.sessions.create({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "org-1",
      success_url: "https://app.test/success",
      cancel_url: "https://app.test/cancel",
      line_items: [{ price: "price_device", quantity: 3 }],
      metadata: { organizationId: "org-1", plan: "device" },
      subscription_data: {
        trial_period_days: 14,
        metadata: { organizationId: "org-1" },
      },
      allow_promotion_codes: true,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://stripe.test/v1/checkout/sessions",
    });

    const body = new URLSearchParams(calls[0].body);

    expect(body.get("mode")).toBe("subscription");
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("client_reference_id")).toBe("org-1");
    expect(body.get("success_url")).toBe("https://app.test/success");
    expect(body.get("cancel_url")).toBe("https://app.test/cancel");
    expect(body.get("line_items[0][price]")).toBe("price_device");
    expect(body.get("line_items[0][quantity]")).toBe("3");
    expect(body.get("metadata[organizationId]")).toBe("org-1");
    expect(body.get("metadata[plan]")).toBe("device");
    expect(body.get("subscription_data[trial_period_days]")).toBe("14");
    expect(body.get("subscription_data[metadata][organizationId]")).toBe("org-1");
    expect(body.get("allow_promotion_codes")).toBe("true");
  });

  it("updates an existing subscription item's quantity without proration", async () => {
    const { client, calls } = recordingClient();

    await client.subscriptions.update("sub_1", {
      items: [{ id: "si_1", quantity: 7 }],
      proration_behavior: "none",
    });

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://stripe.test/v1/subscriptions/sub_1",
    });

    const body = new URLSearchParams(calls[0].body);

    expect(body.get("items[0][id]")).toBe("si_1");
    expect(body.get("items[0][quantity]")).toBe("7");
    expect(body.get("proration_behavior")).toBe("none");
    expect(body.has("cancel_at_period_end")).toBe(false);
  });

  it("lists a customer's invoices with filters", async () => {
    let url = "";

    const client = new HttpStripeClient("sk_test", {
      host: "https://stripe.test",
      fetch: async (input) => {
        url = String(input);

        return json({ data: [{ id: "in_1", status: "paid", total: 100 }], has_more: false });
      },
    });

    const page = await client.invoices.list({
      customer: "cus_1",
      limit: 24,
      status: "paid",
      starting_after: "in_0",
    });

    expect(page.data[0]).toMatchObject({ id: "in_1", status: "paid" });

    const params = new URL(url).searchParams;

    expect(params.get("customer")).toBe("cus_1");
    expect(params.get("limit")).toBe("24");
    expect(params.get("status")).toBe("paid");
    expect(params.get("starting_after")).toBe("in_0");
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "customer.created", data: { object: {} } });

  it("accepts a valid signature", async () => {
    const event = await verifyStripeSignature(payload, signingHeader(payload, secret), secret);

    expect(event.id).toBe("evt_1");
  });

  it("rejects a wrong secret", async () => {
    await expect(
      verifyStripeSignature(payload, signingHeader(payload, "whsec_other"), secret),
    ).rejects.toMatchObject({ type: "StripeInvalidRequestError" });
  });

  it("rejects a stale timestamp", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3_600;

    await expect(
      verifyStripeSignature(payload, signingHeader(payload, secret, stale), secret),
    ).rejects.toMatchObject({ message: "Timestamp outside the tolerance zone" });
  });

  describe("header and clock matrix", () => {
    // A fixed clock keeps the boundary cases deterministic. `verify` uses a
    // symmetric window (`|now - t| > 300`), so both directions are checked.
    const nowSeconds = 1_700_000_000;
    const nowMs = nowSeconds * 1000;

    const digestFor = (timestamp: number, signingSecret = secret) =>
      createHmac("sha256", signingSecret).update(`${timestamp}.${payload}`).digest("hex");

    type Case = {
      readonly name: string;
      readonly header: string;
      readonly secret?: string;
      /** `"accept"` or the expected rejection message. */
      readonly expected: "accept" | string;
    };

    const cases: Case[] = [
      {
        name: "accepts a valid signature at the exact clock",
        header: `t=${nowSeconds},v1=${digestFor(nowSeconds)}`,
        expected: "accept",
      },
      {
        name: "rejects a header with no timestamp",
        header: `v1=${digestFor(nowSeconds)}`,
        expected: "Invalid signature",
      },
      {
        name: "rejects a non-numeric timestamp",
        header: `t=not-a-number,v1=${digestFor(nowSeconds)}`,
        expected: "Timestamp outside the tolerance zone",
      },
      {
        name: "rejects the epoch timestamp (t=0)",
        header: `t=0,v1=${digestFor(0)}`,
        expected: "Timestamp outside the tolerance zone",
      },
      {
        name: "rejects a timestamp 301 seconds old",
        header: `t=${nowSeconds - 301},v1=${digestFor(nowSeconds - 301)}`,
        expected: "Timestamp outside the tolerance zone",
      },
      {
        name: "accepts a timestamp exactly 300 seconds old",
        header: `t=${nowSeconds - 300},v1=${digestFor(nowSeconds - 300)}`,
        expected: "accept",
      },
      {
        name: "rejects a timestamp 301 seconds in the future",
        header: `t=${nowSeconds + 301},v1=${digestFor(nowSeconds + 301)}`,
        expected: "Timestamp outside the tolerance zone",
      },
      {
        name: "accepts when one of several v1 values matches",
        header: `t=${nowSeconds},v1=${"0".repeat(64)},v1=${digestFor(nowSeconds)}`,
        expected: "accept",
      },
      {
        name: "rejects an empty v1 value",
        header: `t=${nowSeconds},v1=`,
        expected: "No matching signature",
      },
      {
        name: "rejects an empty signing secret",
        header: `t=${nowSeconds},v1=${digestFor(nowSeconds, "")}`,
        secret: "",
        expected: "Invalid signature",
      },
    ];

    it.each(cases)("$name", async ({ header, secret: signingSecret, expected }) => {
      const verification = verifyStripeSignature(payload, header, signingSecret ?? secret, nowMs);

      if (expected === "accept") {
        await expect(verification).resolves.toMatchObject({ id: "evt_1" });
      } else {
        await expect(verification).rejects.toMatchObject({
          type: "StripeInvalidRequestError",
          message: expected,
        });
      }
    });
  });
});
