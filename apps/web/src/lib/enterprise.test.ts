import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGlobal } from "../../../../packages/config/testing/globals.ts";
import { enterprise } from "./enterprise";
import type { EnterpriseRequestContext } from "./enterprise";

type CapturedRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
};

const transportState = {
  requests: [] as Array<CapturedRequest>,
  responses: [] as Array<unknown>,
};

/** A recording HttpClient layer: the transport is injected per call, not mocked globally. */
const recordingTransport = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      transportState.requests.push({
        method: request.method,
        url: request.url,
        headers: { ...request.headers },
      });

      return HttpClientResponse.fromWeb(
        request,
        Response.json(transportState.responses.shift() ?? { status: "ok" }),
      );
    }),
  ),
);

const context: EnterpriseRequestContext = { transport: recordingTransport };

const installResponses = (...responses: Array<unknown>) => {
  transportState.responses.push(...responses);
};

const ssrContext = (): EnterpriseRequestContext => ({
  transport: recordingTransport,
  event: {
    request: new Request("https://dashboard.test/settings", {
      headers: { cookie: "__Host-mattrax_session=ssr-session" },
    }),
  },
});

const pathnameOf = (request: CapturedRequest) =>
  new URL(request.url, "https://dashboard.test").pathname;

let restoreLocation: () => void;

beforeEach(() => {
  restoreLocation = installGlobal("location", new URL("https://dashboard.test/settings"));
  transportState.requests.length = 0;
  transportState.responses.length = 0;
});

afterEach(() => {
  restoreLocation();
});

describe("enterprise client request security headers", () => {
  it("adds CSRF headers to generated typed mutations", async () => {
    installResponses({ status: "ok" }, { status: "ok", deletedTenants: [] });

    await enterprise.updateMe({ name: "New name" }, context);
    await enterprise.deleteAccount({ confirmEmail: "owner@example.com" }, context);

    expect(transportState.requests).toHaveLength(2);
    expect(transportState.requests[0]?.method).toBe("PATCH");
    expect(pathnameOf(transportState.requests[0]!)).toBe("/api/v1/me");
    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transportState.requests[1]?.method).toBe("DELETE");
    expect(pathnameOf(transportState.requests[1]!)).toBe("/api/v1/me");
    expect(transportState.requests[1]?.headers["x-effect-auth-csrf"]).toBe("1");
  });

  it("does not add CSRF headers to safe generated requests", async () => {
    installResponses({ tenants: [] });

    await enterprise.listTenants(context);

    expect(transportState.requests[0]?.method).toBe("GET");
    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBeUndefined();
    expect(transportState.requests[0]?.headers.origin).toBeUndefined();
  });

  it("forwards cookie and explicit Origin for SSR typed mutations", async () => {
    installResponses({ status: "ok" });

    await enterprise.updateMe({ name: "SSR name" }, ssrContext());

    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transportState.requests[0]?.headers.origin).toBe("https://dashboard.test");
    expect(transportState.requests[0]?.headers.cookie).toBe("__Host-mattrax_session=ssr-session");
  });

  it("preserves bearer and custom headers on unsafe downloads", async () => {
    installResponses({ ok: true });

    const response = await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      ...context,
      method: "POST",
      headers: {
        authorization: "Bearer oauth-token",
        "x-custom": "preserved",
      },
      body: { format: "json" },
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(transportState.requests[0]?.method).toBe("POST");
    expect(pathnameOf(transportState.requests[0]!)).toBe("/api/v1/custom-export");
    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transportState.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
    expect(transportState.requests[0]?.headers["x-custom"]).toBe("preserved");
  });

  it("adds SSR Origin without discarding bearer download headers", async () => {
    installResponses({ ok: true });

    await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      ...ssrContext(),
      method: "DELETE",
      headers: { authorization: "Bearer oauth-token" },
    });

    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transportState.requests[0]?.headers.origin).toBe("https://dashboard.test");
    expect(transportState.requests[0]?.headers.cookie).toBe("__Host-mattrax_session=ssr-session");
    expect(transportState.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
  });

  it("keeps safe downloads header-preserving without CSRF", async () => {
    installResponses({ ok: true });

    await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      ...context,
      headers: { authorization: "Bearer oauth-token" },
    });

    expect(transportState.requests[0]?.method).toBe("GET");
    expect(transportState.requests[0]?.headers["x-effect-auth-csrf"]).toBeUndefined();
    expect(transportState.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
  });
});
