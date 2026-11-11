import { describe, expect, it, vi } from "vitest";
import {
  buildSentryEnvelope,
  createErrorTracker,
  parseSentryDsn,
  redactErrorText,
  safeEventPath,
  shouldReportError,
} from "./errorTracking.js";

const dsn = "https://public-key@o123.ingest.sentry.io/456";

describe("Sentry DSN", () => {
  it("builds an envelope endpoint and disables invalid DSNs", () => {
    expect(parseSentryDsn(dsn)).toEqual({
      endpoint:
        "https://o123.ingest.sentry.io/api/456/envelope/?sentry_key=public-key&sentry_version=7",
      publicKey: "public-key",
      projectId: "456",
    });
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn("not a dsn")).toBeNull();
    expect(parseSentryDsn("ftp://key@example.com/1")).toBeNull();
    expect(parseSentryDsn("https://example.com/")).toBeNull();
  });
});

describe("Sentry payload redaction", () => {
  it("removes emails, long tokens and query strings", () => {
    expect(redactErrorText(new Error("reset for owner@example.com failed"))).toBe(
      "Error: reset for [email] failed",
    );
    expect(redactErrorText(`token ${"z".repeat(40)}`)).toContain("[redacted]");
    expect(safeEventPath("/api/v1/tenants/acme/devices?token=secret&email=a@b.test")).toBe(
      "/api/v1/tenants/acme/devices",
    );
  });

  it("only reports uncaught errors and 5xx responses", () => {
    expect(shouldReportError(500, false)).toBe(true);
    expect(shouldReportError(503, false)).toBe(true);
    expect(shouldReportError(undefined, true)).toBe(true);
    expect(shouldReportError(404, false)).toBe(false);
    expect(shouldReportError(429, false)).toBe(false);
    expect(shouldReportError(200, false)).toBe(false);
  });

  it("builds a minimal envelope without bodies or secrets", () => {
    const envelope = buildSentryEnvelope(
      {
        requestId: "req-12345678",
        method: "POST",
        path: "/api/v1/tenants/acme/devices?token=secret",
        status: 500,
        errorTag: "EnterpriseDbError",
        error: new Error("database rejected owner@example.com"),
      },
      {
        eventId: "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b",
        timestamp: new Date("2026-11-11T03:17:00.000Z"),
        environment: "production",
        release: "1.2.3",
        deploymentId: "deploy-1",
      },
    );
    const [header, item, event] = envelope.split("\n").map((line) => JSON.parse(line));
    expect(header.event_id).toBe("0193f0b26f2a7c3e8b1d2c4a5e6f7a8b");
    expect(item).toEqual({ type: "event", content_type: "application/json" });
    expect(event.message.formatted).toBe("Error: database rejected [email]");
    expect(event.tags).toMatchObject({
      request_id: "req-12345678",
      path: "/api/v1/tenants/acme/devices",
      method: "POST",
      status: "500",
      error_tag: "EnterpriseDbError",
      deployment_id: "deploy-1",
    });
    expect(event.release).toBe("1.2.3");
    expect(event.environment).toBe("production");
    expect(envelope).not.toContain("token=secret");
    expect(envelope).not.toContain("owner@example.com");
    expect(envelope).not.toContain("body");
  });
});

describe("error tracker", () => {
  it("is disabled without a DSN and never calls fetch", async () => {
    const fetch = vi.fn();
    const tracker = createErrorTracker({ fetch });
    expect(tracker.enabled).toBe(false);
    expect(
      await tracker.capture({ requestId: "req-1", method: "GET", path: "/", status: 500 }),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts one envelope for an eligible error", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    let clock = 1_000;
    const tracker = createErrorTracker({
      dsn,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
      random: () => 0,
      environment: "test",
      release: "0.0.0",
    });
    expect(tracker.enabled).toBe(true);
    expect(
      await tracker.capture({
        requestId: "req-1",
        method: "GET",
        path: "/api/v1/me",
        status: 500,
      }),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/456/envelope/");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("GET /api/v1/me responded 500");
    clock += 1_000;
  });

  it("samples and rate limits to avoid floods", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    let clock = 1_000;
    const tracker = createErrorTracker({
      dsn,
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
      random: () => 0,
      maxEventsPerMinute: 2,
    });
    const capture = () =>
      tracker.capture({ requestId: "req", method: "GET", path: "/api/v1/me", status: 500 });
    expect(await capture()).toBe(true);
    clock += 1;
    expect(await capture()).toBe(true);
    clock += 1;
    expect(await capture()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);

    // A fresh minute restores the budget.
    clock += 60_000;
    expect(await capture()).toBe(true);
  });

  it("can sample a fraction of events", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const tracker = createErrorTracker({
      dsn,
      fetch: fetch as unknown as typeof globalThis.fetch,
      sampleRate: 0.25,
      random: () => 0.9,
    });
    expect(await tracker.capture({ requestId: "req", method: "GET", path: "/", status: 500 })).toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swallows provider failures", async () => {
    const warnings: string[] = [];
    const tracker = createErrorTracker({
      dsn,
      fetch: (async () => {
        throw new Error("network down");
      }) as unknown as typeof globalThis.fetch,
      warn: (message) => warnings.push(message),
    });
    expect(await tracker.capture({ requestId: "req", method: "GET", path: "/", status: 500 })).toBe(
      false,
    );
    expect(warnings).toEqual(["Sentry error event delivery failed"]);
  });
});
