import { describe, expect, it } from "vitest";
import {
  HttpStripeClient,
  STRIPE_MAX_NETWORK_RETRIES,
  STRIPE_REQUEST_TIMEOUT_MS,
  StripeService,
  makeEffectHttpStripeClient,
  makeEffectStripeClient,
} from "../src/index.js";
import type { HttpEffectStripeClient, StripeClientLike } from "../src/index.js";

const apiField = (client: HttpEffectStripeClient, field: "timeout" | "maxNetworkRetries") => {
  if (!(client.client instanceof HttpStripeClient))
    throw new Error("expected the built-in HTTP Stripe client");

  return client.client.getApiField(field);
};

describe("Stripe client outbound bounds", () => {
  it("configures a deadline and bounded network retries by default", () => {
    const client = StripeService.make("sk_test_123");
    expect(apiField(client, "timeout")).toBe(STRIPE_REQUEST_TIMEOUT_MS);
    expect(apiField(client, "maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);
  });

  it("lets callers override the defaults without losing the other bound", () => {
    const client = StripeService.make("sk_test_123", { timeout: 1_000 });
    expect(apiField(client, "timeout")).toBe(1_000);
    expect(apiField(client, "maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);

    const noRetries = StripeService.make("sk_test_123", { maxNetworkRetries: 0 });
    expect(apiField(noRetries, "maxNetworkRetries")).toBe(0);
    expect(apiField(noRetries, "timeout")).toBe(STRIPE_REQUEST_TIMEOUT_MS);
  });

  it("leaves injected test clients untouched", () => {
    // SAFETY: this test only checks that the wrapper retains the injected
    // client; it never calls any Stripe method.
    const raw = {} as StripeClientLike;
    const client = makeEffectStripeClient(raw);
    expect(client.client).toBe(raw);
  });

  it("preserves an injected HTTP client's configuration", () => {
    const raw = new HttpStripeClient("sk_test_123", { maxNetworkRetries: 0, timeout: 999 });
    const client = makeEffectHttpStripeClient(raw);
    expect(client.client).toBe(raw);
    expect(apiField(client, "maxNetworkRetries")).toBe(0);
    expect(apiField(client, "timeout")).toBe(999);
  });
});
