import type { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { sanitizePostHogCapture } from "./posthog-sanitize";

const capture = (properties: Record<string, Schema.Json>) => ({
  event: "$autocapture",
  properties,
});

describe("PostHog capture sanitisation", () => {
  it("removes query strings and fragments from page context", () => {
    const event = sanitizePostHogCapture(
      capture({
        $current_url: "https://e.mattrax.app/t/acme/devices?token=secret#row",
        $referrer: "https://e.mattrax.app/login?returnTo=%2Ft%2Facme",
      }),
    );

    expect(event.properties?.$current_url).toBe("https://e.mattrax.app/t/acme/devices");
    expect(event.properties?.$referrer).toBe("https://e.mattrax.app/login");
  });

  it("redacts emails and tokens from autocaptured element text", () => {
    const event = sanitizePostHogCapture(
      capture({
        $el_text: "owner@example.com 0123456789abcdef0123456789abcdef",
        $elements: [
          {
            tag_name: "button",
            $el_text: "Remove owner@example.com",
            attr__value: "serial C02ABCDEF123",
          },
        ],
      }),
    );

    expect(event.properties?.$el_text).toBe("[email] [redacted]");
    expect(event.properties?.$elements).toMatchObject([
      {
        tag_name: "button",
        $el_text: "Remove [email]",
        attr__value: "serial C02ABCDEF123",
      },
    ]);
  });

  it("redacts exception payloads but keeps the account's own person properties", () => {
    const event = sanitizePostHogCapture(
      capture({
        $exception_values: ["Error: failed for owner@example.com"],
        $exception_list: [{ value: "Error: failed for owner@example.com" }],
        $set: { email: "owner@example.com" },
      }),
    );

    expect(event.properties?.$exception_values).toEqual(["Error: failed for [email]"]);
    expect(event.properties?.$exception_list).toMatchObject([
      { value: "Error: failed for [email]" },
    ]);
    expect(event.properties?.$set).toEqual({ email: "owner@example.com" });
  });
});
