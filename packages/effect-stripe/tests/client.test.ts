import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { OUTBOUND_TIMEOUTS, STRIPE_MAX_NETWORK_RETRIES } from "@mattrax/net";
import { StripeService, makeEffectStripeClient } from "../src/index.js";

describe("Stripe client outbound bounds", () => {
  it("configures a deadline and bounded network retries by default", () => {
    const client = StripeService.make("sk_test_123");
    expect(client.client.getApiField("timeout")).toBe(OUTBOUND_TIMEOUTS.stripe);
    expect(client.client.getApiField("maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);
  });

  it("lets callers override the defaults without losing the other bound", () => {
    const client = StripeService.make("sk_test_123", { timeout: 1_000 });
    expect(client.client.getApiField("timeout")).toBe(1_000);
    expect(client.client.getApiField("maxNetworkRetries")).toBe(STRIPE_MAX_NETWORK_RETRIES);

    const noRetries = StripeService.make("sk_test_123", { maxNetworkRetries: 0 });
    expect(noRetries.client.getApiField("maxNetworkRetries")).toBe(0);
    expect(noRetries.client.getApiField("timeout")).toBe(OUTBOUND_TIMEOUTS.stripe);
  });

  it("leaves injected test clients untouched", () => {
    const raw = new Stripe("sk_test_123", { maxNetworkRetries: 0, timeout: 999 });
    const client = makeEffectStripeClient(raw);
    expect(client.client).toBe(raw);
    expect(client.client.getApiField("maxNetworkRetries")).toBe(0);
    expect(client.client.getApiField("timeout")).toBe(999);
  });

  it("does not reconfigure an unpreconfigured client", () => {
    const raw = new Stripe("sk_test_123");
    const client = makeEffectStripeClient(raw);
    expect(client.client).toBe(raw);
    expect(client.client.getApiField("maxNetworkRetries")).toBe(
      new Stripe("sk_test_123").getApiField("maxNetworkRetries"),
    );
  });
});
