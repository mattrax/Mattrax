import { describe, expect, it, vi } from "vitest";
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
  type AnalyticsClient,
} from "./analytics.js";

const sessionId = "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b";

type Captured = Parameters<AnalyticsClient["capture"]>[0];

const fakeClient = () => {
  const events: Captured[] = [];

  const exceptions: Array<{
    error: unknown;
    distinctId?: string;
    properties?: Record<string, unknown>;
  }> = [];

  const client: AnalyticsClient = {
    capture: (message) => {
      events.push(message);
    },
    captureException: (error, distinctId, properties) => {
      exceptions.push({ error, distinctId, properties });
    },
    flush: vi.fn(async () => {}),
  };

  return { client, events, exceptions };
};

const analytics = (client: AnalyticsClient, overrides: Record<string, unknown> = {}) =>
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
    expect((captured!.error as Error).message).toContain("[email]");
    expect((captured!.error as Error).message).toContain("[redacted]");
    expect(captured?.distinctId).toBe("anon-1");
    expect(captured?.properties).toMatchObject({
      $session_id: sessionId,
      status: 500,
      error_tag: "EnterpriseInternal",
    });
  });

  it("flushes the request-scoped client and swallows provider errors", async () => {
    const fake = fakeClient();
    const session = analytics(fake.client);
    session.capture("test_event");
    await session.flush();
    expect(fake.client.flush).toHaveBeenCalledTimes(1);

    const failing = fakeClient();
    failing.client.flush = vi.fn(async () => {
      throw new Error("network down");
    });
    const warnings: string[] = [];

    const failingSession = analytics(failing.client, {
      warn: (message: string) => warnings.push(message),
    });

    failingSession.capture("test_event");
    await failingSession.flush();
    expect(warnings[0]).toContain("PostHog flush failed");
  });

  it("validates headers and only reports server failures", () => {
    const headers = new Headers({
      "x-posthog-distinct-id": "anon-1",
      "x-posthog-session-id": sessionId,
    });

    expect(readClientDistinctId(headers)).toBe("anon-1");
    expect(readClientSessionId(headers)).toBe(sessionId);
    expect(
      readClientDistinctId(new Headers({ "x-posthog-distinct-id": "bad id" })),
    ).toBeUndefined();
    expect(readClientSessionId(new Headers({ "x-posthog-session-id": "nope" }))).toBeUndefined();

    expect(shouldReportError(500, false)).toBe(true);
    expect(shouldReportError(503, false)).toBe(true);
    expect(shouldReportError(undefined, true)).toBe(true);
    expect(shouldReportError(404, false)).toBe(false);
    expect(shouldReportError(429, false)).toBe(false);
    expect(shouldReportError(200, false)).toBe(false);
  });

  it("maps auth conversions and skips non-product traffic", () => {
    expect(authEventForRequest("/api/v1/signIn", "POST", 200)).toBe("auth_signed_in");
    expect(authEventForRequest("/api/v1/register", "POST", 200)).toBe("auth_register_submitted");
    expect(authEventForRequest("/api/v1/signIn", "POST", 401)).toBeUndefined();
    expect(authEventForRequest("/api/v1/signIn", "GET", 200)).toBeUndefined();
    expect(authEventForRequest("/api/v1/tenants/1/policies", "POST", 200)).toBeUndefined();

    expect(shouldTrackApiRequest("/api/v1/me", "GET")).toBe(true);
    expect(shouldTrackApiRequest("/api/health", "GET")).toBe(false);
    expect(shouldTrackApiRequest("/api/ready", "GET")).toBe(false);
    expect(shouldTrackApiRequest("/api/openapi.json", "GET")).toBe(false);
    expect(shouldTrackApiRequest("/api/v1/getSession", "POST")).toBe(false);
    expect(shouldTrackApiRequest("/api/docs", "GET")).toBe(false);
    expect(shouldTrackApiRequest("/api/v1/me", "OPTIONS")).toBe(false);
  });

  it("distinguishes a completed sign-in from an MFA challenge", async () => {
    const authenticated = new Response(
      JSON.stringify({ _tag: "Success", value: { _tag: "Authenticated" } }),
      { headers: { "content-type": "application/json" } },
    );

    const pending = new Response(
      JSON.stringify({ _tag: "Success", value: { _tag: "PendingAuthentication" } }),
      { headers: { "content-type": "application/json" } },
    );

    await expect(authOutcomeFromResponse(authenticated)).resolves.toBe("authenticated");
    await expect(authOutcomeFromResponse(pending)).resolves.toBe("pending");
    await expect(authOutcomeFromResponse(new Response("no"))).resolves.toBeUndefined();
  });

  it("treats query strings as non-analytics data", () => {
    expect(safeAnalyticsPath("/api/v1/tenants/acme/devices?token=secret")).toBe(
      "/api/v1/tenants/acme/devices",
    );
    expect(redactAnalyticsText("owner@example.com")).toBe("[email]");
  });
});
