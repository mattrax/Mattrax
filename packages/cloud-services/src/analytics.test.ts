import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  authEventForRequest,
  authOutcomeFromResponse,
  createRequestAnalytics,
  readClientDistinctId,
  readClientSessionId,
  redactAnalyticsText,
  safeAnalyticsPath,
  shouldReportError,
  shouldTrackApiRequest,
} from "./analytics.js";
import type { AnalyticsClient, AnalyticsConfig, AnalyticsProperties } from "./analytics.js";

const sessionId = "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b";

type Captured = Parameters<AnalyticsClient["capture"]>[0];

const fakeClient = () => {
  const events: Captured[] = [];

  const exceptions: Array<{
    cause: unknown;
    distinctId?: string;
    properties?: AnalyticsProperties;
  }> = [];

  let flushes = 0;
  const client: AnalyticsClient = {
    capture: (message) => {
      events.push(message);
    },
    captureException: (cause, distinctId, properties) => {
      exceptions.push({ cause, distinctId, properties });
    },
    flush: async () => {
      flushes++;
    },
  };

  return { client, events, exceptions, flushes: () => flushes };
};

const analytics = (client: AnalyticsClient, overrides: Partial<AnalyticsConfig> = {}) =>
  createRequestAnalytics({
    key: "phc_test",
    client,
    requestId: "req-12345678",
    method: "POST",
    path: "/api/v1/tenants/tenant-1/policies?token=secret",
    headers: {
      "x-posthog-distinct-id": "anon-1",
      "x-posthog-session-id": sessionId,
    },
    environment: "test",
    release: "1.2.3",
    deploymentId: "deploy-1",
    random: () => 0,
    now: () => Date.parse("2026-11-11T03:17:00.000Z"),
    ...overrides,
  });

describe("PostHog analytics", () => {
  it("is disabled without a key and never touches the client", async () => {
    const fake = fakeClient();

    const session = createRequestAnalytics({
      client: undefined,
      requestId: "req-1",
      method: "GET",
      path: "/api/v1/me",
      headers: {},
    });

    expect(session.enabled).toBe(false);
    session.identify({ userId: "user-1" });
    session.capture("should_not_send");
    session.captureError(new Error("no"));
    await session.flush();
    expect(fake.events).toHaveLength(0);
  });

  it("identifies the authenticated user and links the browser session", () => {
    const fake = fakeClient();
    const session = analytics(fake.client);
    session.identify({
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      tenantId: "tenant-1",
      tenantName: "Acme",
      roleName: "Owner",
      roleKind: "built-in",
    });
    session.capture("policy_created", { target_id: "policy-1" });

    const identify = fake.events.find((event) => event.event === "$identify");
    expect(identify?.distinctId).toBe("user-1");
    expect(identify?.properties).toMatchObject({
      $session_id: sessionId,
      path: "/api/v1/tenants/tenant-1/policies",
      request_id: "req-12345678",
      $set: { email: "owner@example.com", name: "Owner" },
      $anon_distinct_id: "anon-1",
    });
    expect(identify?.groups).toEqual({ tenant: "tenant-1" });

    const group = fake.events.find((event) => event.event === "$groupidentify");
    expect(group?.properties).toMatchObject({
      $group_type: "tenant",
      $group_key: "tenant-1",
      $group_set: { name: "Acme" },
    });

    const product = fake.events.find((event) => event.event === "policy_created");
    expect(product?.distinctId).toBe("user-1");
    expect(product?.groups).toEqual({ tenant: "tenant-1" });
    expect(product?.properties).toMatchObject({
      $session_id: sessionId,
      request_id: "req-12345678",
      tenant_id: "tenant-1",
      role_name: "Owner",
      role_kind: "built-in",
      target_id: "policy-1",
    });
    expect(JSON.stringify(product?.properties)).not.toContain("token=secret");
    expect(JSON.stringify(product?.properties)).not.toContain("owner@example.com");
  });

  it("does not emit an identify event when the browser is already the user", () => {
    const fake = fakeClient();

    const session = analytics(fake.client, {
      headers: {
        "x-posthog-distinct-id": "user-1",
        "x-posthog-session-id": sessionId,
      },
    });

    session.identify({
      userId: "user-1",
      email: "owner@example.com",
      tenantId: "tenant-1",
      tenantName: "Acme",
    });
    session.capture("api_request");

    // The browser owns `$identify`; a per-request copy would create one event
    // for every authenticated API call.
    expect(fake.events.find((event) => event.event === "$identify")).toBeUndefined();
    expect(fake.events.find((event) => event.event === "$groupidentify")).toBeUndefined();

    const request = fake.events.find((event) => event.event === "api_request");
    expect(request?.distinctId).toBe("user-1");
    expect(request?.groups).toEqual({ tenant: "tenant-1" });

    // Mutations still describe the tenant, once.
    session.capture("policy_created");
    session.capture("group_created");
    const groups = fake.events.filter((event) => event.event === "$groupidentify");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.properties).toMatchObject({
      $group_key: "tenant-1",
      $group_set: { name: "Acme" },
    });
  });

  it("sets person properties once for a caller without a browser SDK", () => {
    const fake = fakeClient();
    const session = analytics(fake.client, { headers: {} });

    session.identify({
      userId: "user-1",
      email: "owner@example.com",
      name: "Owner",
      tenantId: "tenant-1",
    });
    session.capture("api_request");
    session.capture("api_operation");

    expect(fake.events.find((event) => event.event === "$identify")).toBeUndefined();
    const [first, second] = fake.events;
    expect(first?.distinctId).toBe("user-1");
    expect(first?.properties?.$set).toEqual({
      email: "owner@example.com",
      name: "Owner",
    });
    expect(second?.properties?.$set).toBeUndefined();
  });

  it("redacts error messages and caps error events per isolate", () => {
    const fake = fakeClient();
    let clock = Date.parse("2026-11-11T03:17:00.000Z");

    const session = analytics(fake.client, {
      now: () => clock,
      maxErrorsPerMinute: 1,
    });

    session.captureError(new Error(`failed for owner@example.com token ${"z".repeat(40)}`), {
      status: 500,
      error_tag: "EnterpriseInternal",
    });
    clock += 1_000;
    session.captureError(new Error("second"), { status: 500 });

    expect(fake.exceptions).toHaveLength(1);
    const [captured] = fake.exceptions;
    expect(captured.cause).toBeInstanceOf(Error);

    if (captured.cause instanceof Error) {
      expect(captured.cause.message).toContain("[email]");
      expect(captured.cause.message).toContain("[redacted]");
    }

    expect(captured?.distinctId).toBe("anon-1");
    expect(captured?.properties).toMatchObject({
      $session_id: sessionId,
      status: 500,
      error_tag: "EnterpriseInternal",
    });
  });

  it("flushes the request-scoped client", async () => {
    const fake = fakeClient();
    const session = analytics(fake.client);
    session.capture("test_event");
    await session.flush();

    expect(fake.flushes()).toBe(1);
  });

  it("swallows provider flush errors with a warning", async () => {
    const warnings: string[] = [];
    const client: AnalyticsClient = {
      capture: () => {},
      captureException: () => {},
      flush: async () => {
        throw new Error("network down");
      },
    };
    const session = analytics(client, { warn: (message: string) => warnings.push(message) });
    session.capture("test_event");
    await session.flush();

    expect(warnings[0]).toContain("PostHog flush failed");
  });

  it("accepts a valid client distinct id", () => {
    const headers = new Headers({
      "x-posthog-distinct-id": "anon-1",
      "x-posthog-session-id": sessionId,
    });

    expect(readClientDistinctId(headers)).toBe("anon-1");
  });

  it("accepts a valid browser session id", () => {
    const headers = new Headers({
      "x-posthog-distinct-id": "anon-1",
      "x-posthog-session-id": sessionId,
    });

    expect(readClientSessionId(headers)).toBe(sessionId);
  });

  it("rejects a malformed distinct id", () => {
    expect(
      readClientDistinctId(new Headers({ "x-posthog-distinct-id": "bad id" })),
    ).toBeUndefined();
  });

  it("rejects a malformed session id", () => {
    expect(readClientSessionId(new Headers({ "x-posthog-session-id": "nope" }))).toBeUndefined();
  });

  it("reports a 500 failure", () => {
    expect(shouldReportError(500, false)).toBe(true);
  });

  it("reports a 503 failure", () => {
    expect(shouldReportError(503, false)).toBe(true);
  });

  it("reports an explicitly forced failure", () => {
    expect(shouldReportError(undefined, true)).toBe(true);
  });

  it("ignores a 404", () => {
    expect(shouldReportError(404, false)).toBe(false);
  });

  it("ignores a 429", () => {
    expect(shouldReportError(429, false)).toBe(false);
  });

  it("ignores a success status", () => {
    expect(shouldReportError(200, false)).toBe(false);
  });

  it("maps a completed sign-in to auth_signed_in", () => {
    expect(authEventForRequest("/api/v1/completePasskeySignIn", "POST", 200)).toBe(
      "auth_signed_in",
    );
  });

  it("maps a completed registration to auth_register_submitted", () => {
    expect(authEventForRequest("/api/v1/completePasskeyRegistration", "POST", 200)).toBe(
      "auth_register_submitted",
    );
  });

  it("ignores a failed sign-in", () => {
    expect(authEventForRequest("/api/v1/completePasskeySignIn", "POST", 401)).toBeUndefined();
  });

  it("ignores a GET sign-in", () => {
    expect(authEventForRequest("/api/v1/completePasskeySignIn", "GET", 200)).toBeUndefined();
  });

  it("ignores a policy mutation", () => {
    expect(authEventForRequest("/api/v1/tenants/1/policies", "POST", 200)).toBeUndefined();
  });

  it("tracks an authenticated read", () => {
    expect(shouldTrackApiRequest("/api/v1/me", "GET")).toBe(true);
  });

  it("ignores the health probe", () => {
    expect(shouldTrackApiRequest("/api/health", "GET")).toBe(false);
  });

  it("ignores the readiness probe", () => {
    expect(shouldTrackApiRequest("/api/ready", "GET")).toBe(false);
  });

  it("ignores the metrics route", () => {
    expect(shouldTrackApiRequest("/api/metrics", "GET")).toBe(false);
  });

  it("ignores the OpenAPI document", () => {
    expect(shouldTrackApiRequest("/api/openapi.json", "GET")).toBe(false);
  });

  it("ignores webhook OpenAPI docs", () => {
    expect(shouldTrackApiRequest("/api/webhooks/openapi.json", "GET")).toBe(false);
  });

  it("ignores the session lookup", () => {
    expect(shouldTrackApiRequest("/api/v1/getSession", "POST")).toBe(false);
  });

  it("ignores the bootstrap read", () => {
    expect(shouldTrackApiRequest("/api/v1/bootstrap", "GET")).toBe(false);
  });

  it("ignores the MCP context lookup", () => {
    expect(shouldTrackApiRequest("/api/v1/mcp/context", "GET")).toBe(false);
  });

  it("ignores API docs", () => {
    expect(shouldTrackApiRequest("/api/docs", "GET")).toBe(false);
  });

  it("ignores a CORS preflight", () => {
    expect(shouldTrackApiRequest("/api/v1/me", "OPTIONS")).toBe(false);
  });

  it("distinguishes a completed sign-in from an MFA challenge", async () => {
    const Authenticated = Schema.TaggedStruct("Authenticated", {});
    const PendingAuthentication = Schema.TaggedStruct("PendingAuthentication", {});

    const SuccessResponse = Schema.TaggedStruct("Success", {
      value: Schema.Union([Authenticated, PendingAuthentication]),
    });

    const authenticated = new Response(
      JSON.stringify(SuccessResponse.make({ value: Authenticated.make({}) })),
      { headers: { "content-type": "application/json" } },
    );

    const pending = new Response(
      JSON.stringify(SuccessResponse.make({ value: PendingAuthentication.make({}) })),
      { headers: { "content-type": "application/json" } },
    );

    await expect(authOutcomeFromResponse(authenticated)).resolves.toBe("authenticated");
    await expect(authOutcomeFromResponse(pending)).resolves.toBe("pending");
    await expect(authOutcomeFromResponse(new Response("no"))).resolves.toBeUndefined();
  });

  it("strips query strings from analytics paths", () => {
    expect(safeAnalyticsPath("/api/v1/tenants/acme/devices?token=secret")).toBe(
      "/api/v1/tenants/acme/devices",
    );
  });

  it("redacts email addresses from analytics text", () => {
    expect(redactAnalyticsText("owner@example.com")).toBe("[email]");
  });
});
