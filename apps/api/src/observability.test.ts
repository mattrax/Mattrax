import { describe, expect, it } from "vitest";
import {
  REQUEST_ID_HEADER,
  errorTagFromBody,
  formatRequestLog,
  readErrorTag,
  resolveRequestId,
  shouldLogRequest,
  tenantIdFromPath,
  withRequestId,
} from "./observability.js";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://e.mattrax.app/api/v1/tenants/acme/devices?token=secret", { headers });

describe("request ids", () => {
  it("propagates a caller-supplied id", () => {
    const id = "0193f0b2-6f2a-7c3e-8b1d-2c4a5e6f7a8b";
    expect(resolveRequestId(request({ [REQUEST_ID_HEADER]: id }), () => "generated")).toBe(id);
  });

  it("replaces ids that could inject log lines or are too short", () => {
    for (const supplied of ["short", "bad id with spaces", "x".repeat(200)])
      expect(resolveRequestId(request({ [REQUEST_ID_HEADER]: supplied }), () => "generated")).toBe(
        "generated",
      );
  });

  it("generates an id when the header is absent", () => {
    expect(resolveRequestId(request(), () => "generated")).toBe("generated");
  });

  it("attaches the id to a response without dropping existing headers", () => {
    const response = withRequestId(
      new Response("ok", { status: 201, headers: { "content-type": "text/plain" } }),
      "req-12345678",
    );

    expect(response.status).toBe(201);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe("req-12345678");
    expect(response.headers.get("content-type")).toBe("text/plain");
  });
});

describe("request logging", () => {
  it("extracts the tenant from the canonical tenant path only", () => {
    expect(tenantIdFromPath("/api/v1/tenants/org-1/devices")).toBe("org-1");
    expect(tenantIdFromPath("/api/v1/tenants/org-1")).toBe("org-1");
    expect(tenantIdFromPath("/api/v1/tenants")).toBeUndefined();
    expect(tenantIdFromPath("/api/v1/enrollment/id")).toBeUndefined();
  });

  it("logs the request line without query strings or bodies", () => {
    const line = formatRequestLog({
      requestId: "req-12345678",
      method: "POST",
      path: "/api/v1/tenants/org-1/devices",
      status: 500,
      durationMs: 42,
      tenantId: "org-1",
      errorTag: "EnterpriseDbError",
    });

    expect(JSON.parse(line)).toMatchObject({
      event: "http.request",
      requestId: "req-12345678",
      method: "POST",
      path: "/api/v1/tenants/org-1/devices",
      status: 500,
      outcome: "server_error",
      durationMs: 42,
      tenantId: "org-1",
      errorTag: "EnterpriseDbError",
    });
    expect(line).not.toContain("token");
    expect(line).not.toContain("secret");
  });

  it("marks rate limits distinctly from other client errors", () => {
    const base = {
      requestId: "req-12345678",
      method: "POST",
      path: "/api/v1/signIn",
      durationMs: 1,
    };

    expect(JSON.parse(formatRequestLog({ ...base, status: 429 })).outcome).toBe("rate_limited");
    expect(JSON.parse(formatRequestLog({ ...base, status: 401 })).outcome).toBe("client_error");
    expect(JSON.parse(formatRequestLog({ ...base, status: 204 })).outcome).toBe("ok");
  });

  it("does not log successful health or readiness probes", () => {
    expect(shouldLogRequest("/api/health", 200)).toBe(false);
    expect(shouldLogRequest("/health", 200)).toBe(false);
    expect(shouldLogRequest("/api/ready", 200)).toBe(false);
    expect(shouldLogRequest("/api/ready", 503)).toBe(true);
    expect(shouldLogRequest("/api/v1/me", 200)).toBe(true);
  });
});

describe("error tags", () => {
  it("reads only the Effect error tag", () => {
    expect(errorTagFromBody({ _tag: "EnterpriseBadRequest", message: "no" })).toBe(
      "EnterpriseBadRequest",
    );
    expect(errorTagFromBody({ message: "no tag" })).toBeUndefined();
    expect(errorTagFromBody("text")).toBeUndefined();
  });

  it("ignores non-JSON and success responses", async () => {
    expect(await readErrorTag(new Response("ok", { status: 200 }))).toBeUndefined();
    expect(await readErrorTag(new Response("bad", { status: 400 }))).toBeUndefined();
    expect(
      await readErrorTag(
        new Response(JSON.stringify({ _tag: "EnterpriseNotFound" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    ).toBe("EnterpriseNotFound");
  });
});
