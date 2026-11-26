import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterprise } from "./enterprise";

type CapturedRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
};

const requestContext = vi.hoisted(() => ({
  server: false,
  url: "https://dashboard.test/settings",
}));

const transport = vi.hoisted(() => ({
  requests: [] as Array<CapturedRequest>,
  responses: [] as Array<unknown>,
}));

vi.mock("@solidjs/web", () => ({
  get isServer() {
    return requestContext.server;
  },
  getRequestEvent: () =>
    requestContext.server
      ? {
          request: new Request(requestContext.url, {
            headers: { cookie: "__Host-mattrax_session=ssr-session" },
          }),
        }
      : undefined,
}));

// Keep the real generated HttpApi client and its request transforms; replace
// only the transport so Node can inspect relative browser URLs without fetch.
vi.mock("~/lib/web-http", async () => {
  const [{ Effect, Layer }, { HttpClient, HttpClientResponse }] = await Promise.all([
    import("effect"),
    import("effect/http"),
  ]);

  return {
    webHttpClientLayer: Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          transport.requests.push({
            method: request.method,
            url: request.url,
            headers: { ...request.headers },
          });

          return HttpClientResponse.fromWeb(
            request,
            Response.json(transport.responses.shift() ?? { status: "ok" }),
          );
        }),
      ),
    ),
  };
});

const installResponses = (...responses: Array<unknown>) => {
  transport.responses.push(...responses);
};

const pathnameOf = (request: CapturedRequest) =>
  new URL(request.url, "https://dashboard.test").pathname;

beforeEach(() => {
  vi.stubGlobal("location", new URL("https://dashboard.test/settings"));
  transport.requests.length = 0;
  transport.responses.length = 0;
  requestContext.server = false;
  requestContext.url = "https://dashboard.test/settings";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enterprise client request security headers", () => {
  it("adds CSRF headers to generated typed mutations", async () => {
    installResponses({ status: "ok" }, { status: "ok", deletedTenants: [] });

    await enterprise.updateMe({ name: "New name" });
    await enterprise.deleteAccount({ confirmEmail: "owner@example.com" });

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.method).toBe("PATCH");
    expect(pathnameOf(transport.requests[0]!)).toBe("/api/v1/me");
    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transport.requests[1]?.method).toBe("DELETE");
    expect(pathnameOf(transport.requests[1]!)).toBe("/api/v1/me");
    expect(transport.requests[1]?.headers["x-effect-auth-csrf"]).toBe("1");
  });

  it("does not add CSRF headers to safe generated requests", async () => {
    installResponses({ tenants: [] });

    await enterprise.listTenants();

    expect(transport.requests[0]?.method).toBe("GET");
    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBeUndefined();
    expect(transport.requests[0]?.headers.origin).toBeUndefined();
  });

  it("forwards cookie and explicit Origin for SSR typed mutations", async () => {
    requestContext.server = true;
    installResponses({ status: "ok" });

    await enterprise.updateMe({ name: "SSR name" });

    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transport.requests[0]?.headers.origin).toBe("https://dashboard.test");
    expect(transport.requests[0]?.headers.cookie).toBe("__Host-mattrax_session=ssr-session");
  });

  it("preserves bearer and custom headers on unsafe downloads", async () => {
    installResponses({ ok: true });

    const response = await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      method: "POST",
      headers: {
        authorization: "Bearer oauth-token",
        "x-custom": "preserved",
      },
      body: { format: "json" },
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(transport.requests[0]?.method).toBe("POST");
    expect(pathnameOf(transport.requests[0]!)).toBe("/api/v1/custom-export");
    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
    expect(transport.requests[0]?.headers["x-custom"]).toBe("preserved");
  });

  it("adds SSR Origin without discarding bearer download headers", async () => {
    requestContext.server = true;
    installResponses({ ok: true });

    await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      method: "DELETE",
      headers: { authorization: "Bearer oauth-token" },
    });

    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBe("1");
    expect(transport.requests[0]?.headers.origin).toBe("https://dashboard.test");
    expect(transport.requests[0]?.headers.cookie).toBe("__Host-mattrax_session=ssr-session");
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
  });

  it("keeps safe downloads header-preserving without CSRF", async () => {
    installResponses({ ok: true });

    await enterprise.request("https://dashboard.test/api/v1/custom-export", {
      headers: { authorization: "Bearer oauth-token" },
    });

    expect(transport.requests[0]?.method).toBe("GET");
    expect(transport.requests[0]?.headers["x-effect-auth-csrf"]).toBeUndefined();
    expect(transport.requests[0]?.headers.authorization).toBe("Bearer oauth-token");
  });
});
