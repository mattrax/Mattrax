import { createHmac } from "node:crypto";
import { Deferred, Effect, Fiber } from "effect";
import type { Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { HttpStripeClient, StripeService, verifyStripeSignature } from "../src/index.js";

const json = (body: Schema.Json, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const requestFromFetch = (input: RequestInfo | URL, init: RequestInit | undefined): Request =>
  input instanceof Request ? input.clone() : new Request(input, init);

const signingHeader = (
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) => {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  return `t=${timestamp},v1=${digest}`;
};

const withTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.provide(effect, TestClock.layer());

describe("HttpStripeClient", () => {
  it("creates a customer with form-encoded metadata, bearer auth and an idempotency key", async () => {
    const requests: Request[] = [];

    const client = new HttpStripeClient("sk_test", {
      fetch: async (input, init) => {
        requests.push(requestFromFetch(input, init));

        return json({ id: "cus_1" });
      },
    });

    const customer = await Effect.runPromise(
      client.customers.create({
        name: "Acme",
        email: "billing@acme.test",
        metadata: { organizationId: "org_1" },
      }),
    );

    expect(customer.id).toBe("cus_1");
    expect(requests).toHaveLength(1);

    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer sk_test");
    expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(request.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/i);

    const body = new URLSearchParams(await request.text());
    expect(body.get("name")).toBe("Acme");
    expect(body.get("email")).toBe("billing@acme.test");
    expect(body.get("metadata[organizationId]")).toBe("org_1");
  });

  it("searches customers with query parameters and no body or idempotency key", async () => {
    let request: Request | undefined;

    const client = new HttpStripeClient("sk_test", {
      fetch: async (input, init) => {
        request = requestFromFetch(input, init);

        return json({ data: [{ id: "cus_1" }], has_more: false });
      },
    });

    const result = await Effect.runPromise(
      client.customers.search({
        query: 'metadata["organizationId"]:"org_1"',
        limit: 1,
      }),
    );

    expect(result.data).toHaveLength(1);
    expect(request?.method).toBe("GET");
    expect(await request?.text()).toBe("");
    expect(request?.headers.has("idempotency-key")).toBe(false);

    const url = new URL(request!.url);
    expect(url.pathname).toBe("/v1/customers/search");
    expect(url.searchParams.get("query")).toBe('metadata["organizationId"]:"org_1"');
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("retries a rate-limited request on the Effect clock", async () => {
    let calls = 0;
    const started = Deferred.makeUnsafe<void>();

    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 2,
      fetch: async () => {
        calls += 1;
        Deferred.doneUnsafe(started, Effect.void);

        return calls === 1
          ? json({ error: { type: "rate_limit_error", message: "slow" } }, 429, {
              "retry-after": "0",
            })
          : json({ id: "cus_1" });
      },
    });

    const customer = await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* TestClock.adjust("1 second");
          return yield* Fiber.join(fiber);
        }),
      ),
    );

    expect(customer).toEqual({ id: "cus_1" });
    expect(calls).toBe(2);
  });

  it("reuses one idempotency key across retries and gives separate POSTs separate keys", async () => {
    const keys: Array<string | null> = [];
    let calls = 0;
    const started = Deferred.makeUnsafe<void>();

    const client = new HttpStripeClient("sk_test", {
      fetch: async (input, init) => {
        const request = requestFromFetch(input, init);
        keys.push(request.headers.get("idempotency-key"));
        calls += 1;
        Deferred.doneUnsafe(started, Effect.void);

        return calls === 1
          ? json({ error: { type: "api_error", message: "try again" } }, 503, {
              "stripe-should-retry": "true",
              "retry-after": "0",
            })
          : json({ id: `cus_${calls}` });
      },
    });

    await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* TestClock.adjust("1 second");
          yield* Fiber.join(fiber);
        }),
      ),
    );
    await Effect.runPromise(client.customers.create({ name: "Acme" }));

    expect(keys).toHaveLength(3);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("does not retry when Stripe-Should-Retry is false", async () => {
    let calls = 0;
    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 2,
      fetch: async () => {
        calls += 1;

        return json({ error: { type: "api_error", message: "do not retry" } }, 503, {
          "stripe-should-retry": "false",
        });
      },
    });

    await expect(
      Effect.runPromise(Effect.flip(client.customers.create({ name: "Acme" }))),
    ).resolves.toMatchObject({
      type: "StripeAPIError",
      statusCode: 503,
      retryable: false,
    });
    expect(calls).toBe(1);
  });

  it("retries when Stripe-Should-Retry is true even for an otherwise non-retryable status", async () => {
    let calls = 0;
    const started = Deferred.makeUnsafe<void>();
    const client = new HttpStripeClient("sk_test", {
      fetch: async () => {
        calls += 1;
        Deferred.doneUnsafe(started, Effect.void);

        return calls === 1
          ? json({ error: { type: "api_error", message: "try again" } }, 418, {
              "stripe-should-retry": "true",
              "retry-after": "0",
            })
          : json({ id: "cus_1" });
      },
    });

    await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* TestClock.adjust("1 second");
          yield* Fiber.join(fiber);
        }),
      ),
    );

    expect(calls).toBe(2);
  });

  it("waits for Retry-After before retrying", async () => {
    let calls = 0;
    const started = Deferred.makeUnsafe<void>();
    const client = new HttpStripeClient("sk_test", {
      fetch: async () => {
        calls += 1;
        Deferred.doneUnsafe(started, Effect.void);

        return calls === 1
          ? json({ error: { type: "rate_limit_error", message: "slow" } }, 429, {
              "retry-after": "1",
            })
          : json({ id: "cus_1" });
      },
    });

    await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* TestClock.adjust("999 millis");
          expect(calls).toBe(1);
          yield* TestClock.adjust("1 milli");
          yield* Fiber.join(fiber);
        }),
      ),
    );

    expect(calls).toBe(2);
  });

  it("stops retries and aborts the in-flight request when the parent is interrupted", async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const started = Deferred.makeUnsafe<void>();
    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 2,
      fetch: async (_input, init) => {
        calls += 1;
        signal = init?.signal;
        Deferred.doneUnsafe(started, Effect.void);

        return json({ error: { type: "api_error", message: "try again" } }, 503, {
          "retry-after": "10",
        });
      },
    });

    const exit = await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          yield* TestClock.adjust("1 minute");
          return yield* Fiber.await(fiber);
        }),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });

  it("aborts an in-flight fetch on interruption without starting a retry", async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const started = Deferred.makeUnsafe<void>();
    const client = new HttpStripeClient("sk_test", {
      maxNetworkRetries: 2,
      fetch: async (_input, init) => {
        calls += 1;
        signal = init?.signal;
        Deferred.doneUnsafe(started, Effect.void);

        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason ?? new Error("aborted")), {
            once: true,
          });
        });
      },
    });

    await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          yield* Fiber.await(fiber);
          yield* TestClock.adjust("1 minute");
        }),
      ),
    );

    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });

  it("keeps the injected-client effect escape hatch cancellable", async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const started = Deferred.makeUnsafe<void>();
    const client = StripeService.make("sk_test", {
      maxNetworkRetries: 2,
      fetch: async (_input, init) => {
        calls += 1;
        signal = init?.signal;
        Deferred.doneUnsafe(started, Effect.void);

        return json({ error: { type: "api_error", message: "try again" } }, 503, {
          "retry-after": "10",
        });
      },
    });

    await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(
            client.effect((stripe) => stripe.customers.list({ limit: 1 })),
          );
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          yield* Fiber.await(fiber);
          yield* TestClock.adjust("1 minute");
        }),
      ),
    );

    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });

  it("times out an attempt through the Effect clock and aborts fetch", async () => {
    let signal: AbortSignal | null | undefined;
    const started = Deferred.makeUnsafe<void>();
    const client = StripeService.make("sk_test", {
      timeout: 1_000,
      maxNetworkRetries: 0,
      fetch: async (_input, init) => {
        signal = init?.signal;
        Deferred.doneUnsafe(started, Effect.void);

        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason ?? new Error("aborted")), {
            once: true,
          });
        });
      },
    });

    const error = await Effect.runPromise(
      withTestClock(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client.customers.create({ name: "Acme" }));
          yield* Deferred.await(started);
          yield* TestClock.adjust("1 second");
          return yield* Fiber.join(fiber).pipe(Effect.flip);
        }),
      ),
    );

    expect(error).toMatchObject({
      _tag: "StripeConnectionError",
      message: "Stripe request timed out",
    });
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ["non-JSON", new Response("not json", { status: 200 })],
    ["missing id", json({})],
    ["wrong id type", json({ id: 42 })],
  ])("fails a malformed 200 as a typed Stripe error: %s", async (_name, response) => {
    const client = StripeService.make("sk_test", {
      maxNetworkRetries: 0,
      fetch: async () => response,
    });

    await expect(
      Effect.runPromise(Effect.flip(client.customers.create({ name: "Acme" }))),
    ).resolves.toMatchObject({ _tag: "StripeUnknownError" });
  });

  it("maps API errors to SDK error names", async () => {
    const client = StripeService.make("sk_test", {
      maxNetworkRetries: 0,
      fetch: async () =>
        json({ error: { type: "invalid_request_error", message: "bad", param: "name" } }, 400),
    });

    await expect(
      Effect.runPromise(Effect.flip(client.customers.create({ name: "Acme" }))),
    ).resolves.toMatchObject({
      _tag: "StripeInvalidRequestError",
      param: "name",
      statusCode: 400,
    });
  });
});

describe("HttpStripeClient billing operations", () => {
  const recordingClient = () => {
    const calls: Array<{ request: Request; body: string }> = [];

    const client = new HttpStripeClient("sk_test", {
      host: "https://stripe.test",
      fetch: async (input, init) => {
        const request = requestFromFetch(input, init);
        calls.push({ request, body: await request.text() });

        return json({ id: "obj_1" });
      },
    });

    return { client, calls };
  };

  it("renames and retrieves a customer", async () => {
    const { client, calls } = recordingClient();

    await Effect.runPromise(client.customers.update("cus_1", { name: "Acme Holdings" }));
    await Effect.runPromise(client.customers.retrieve("cus_1"));

    expect(calls[0]?.request.method).toBe("POST");
    expect(calls[0]?.request.url).toBe("https://stripe.test/v1/customers/cus_1");
    expect(new URLSearchParams(calls[0]?.body).get("name")).toBe("Acme Holdings");
    expect(calls[1]?.request.method).toBe("GET");
  });

  it("creates a subscription Checkout Session with metadata and a trial", async () => {
    const { client, calls } = recordingClient();

    await Effect.runPromise(
      client.checkout.sessions.create({
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
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.url).toBe("https://stripe.test/v1/checkout/sessions");

    const body = new URLSearchParams(calls[0]?.body);

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

    await Effect.runPromise(
      client.subscriptions.update("sub_1", {
        items: [{ id: "si_1", quantity: 7 }],
        proration_behavior: "none",
      }),
    );

    expect(calls[0]?.request.url).toBe("https://stripe.test/v1/subscriptions/sub_1");

    const body = new URLSearchParams(calls[0]?.body);

    expect(body.get("items[0][id]")).toBe("si_1");
    expect(body.get("items[0][quantity]")).toBe("7");
    expect(body.get("proration_behavior")).toBe("none");
    expect(body.has("cancel_at_period_end")).toBe(false);
  });

  it("lists a customer's invoices with filters", async () => {
    let request: Request | undefined;
    const client = new HttpStripeClient("sk_test", {
      host: "https://stripe.test",
      fetch: async (input, init) => {
        request = requestFromFetch(input, init);

        return json({ data: [{ id: "in_1", status: "paid", total: 100 }], has_more: false });
      },
    });

    const page = await Effect.runPromise(
      client.invoices.list({
        customer: "cus_1",
        limit: 24,
        status: "paid",
        starting_after: "in_0",
      }),
    );

    expect(page.data[0]).toMatchObject({ id: "in_1", status: "paid" });

    const params = new URL(request!.url).searchParams;

    expect(params.get("customer")).toBe("cus_1");
    expect(params.get("limit")).toBe("24");
    expect(params.get("status")).toBe("paid");
    expect(params.get("starting_after")).toBe("in_0");
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "customer.created", data: { object: {} } });
  const nowMs = 1_700_000_000_000;
  const nowSeconds = nowMs / 1000;

  const verifyAt = (body: string, header: string, signingSecret = secret) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(nowMs);
      return yield* verifyStripeSignature(body, header, signingSecret);
    }).pipe(withTestClock);

  it("accepts a valid signature using the injected clock", async () => {
    const event = await Effect.runPromise(
      verifyAt(payload, signingHeader(payload, secret, nowSeconds)),
    );

    expect(event.id).toBe("evt_1");
  });

  it("rejects a wrong secret", async () => {
    await expect(
      Effect.runPromise(
        Effect.flip(verifyAt(payload, signingHeader(payload, "whsec_other", nowSeconds))),
      ),
    ).resolves.toMatchObject({ type: "StripeInvalidRequestError" });
  });

  it("enforces the replay window with TestClock", async () => {
    const header = signingHeader(payload, secret, nowSeconds - 300);

    await expect(Effect.runPromise(verifyAt(payload, header))).resolves.toMatchObject({
      id: "evt_1",
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMs);
        yield* TestClock.adjust("1 second");
        return yield* Effect.flip(verifyStripeSignature(payload, header, secret));
      }).pipe(withTestClock),
    );

    expect(error).toMatchObject({ message: "Timestamp outside the tolerance zone" });
  });

  it.each([
    "not json",
    JSON.stringify(null),
    JSON.stringify({ id: "evt_1", type: "customer.created" }),
    JSON.stringify({ id: "evt_1", type: "customer.created", data: { object: null } }),
  ])("rejects an authenticated malformed event payload: %s", async (body) => {
    await expect(
      Effect.runPromise(Effect.flip(verifyAt(body, signingHeader(body, secret, nowSeconds)))),
    ).resolves.toMatchObject({
      type: "StripeInvalidRequestError",
      message: "Invalid Stripe event payload",
    });
  });

  describe("header and clock matrix", () => {
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
        expected: "Invalid signature",
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
      const verification = verifyAt(payload, header, signingSecret ?? secret);

      if (expected === "accept") {
        await expect(Effect.runPromise(verification)).resolves.toMatchObject({ id: "evt_1" });
      } else {
        await expect(Effect.runPromise(Effect.flip(verification))).resolves.toMatchObject({
          type: "StripeInvalidRequestError",
          message: expected,
        });
      }
    });
  });
});
