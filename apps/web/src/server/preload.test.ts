import type { MeResponse, SsrTokenPayload } from "@mattrax/enterprise-domain/client";
import {
  BUILT_IN_ROLE_PERMISSIONS,
  MeResponse as MeResponseSchema,
  PERMISSIONS,
} from "@mattrax/enterprise-domain/client";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  preloadSession,
  redactBootstrapResponse,
  ssrClearCookie,
  ssrSetCookie,
} from "./preload";

const secret = "preload-test-secret";

const me: MeResponse = {
  user: {
    id: "user-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    mfaEnabled: false,
    totpEnabled: false,
    passkeyEnabled: false,
    mfaRequired: false,
  },
  tenants: [
    {
      id: "tenant-1",
      name: "Acme",
      slug: "acme",
      role: "owner",
      roleId: null,
      roleName: "Owner",
      roleKind: "built-in",
      permissions: ["tenant.read", "devices.read", "devices.write"],
      logo: null,
      displayName: null,
      brandColor: null,
    },
  ],
};

const tokenPayload = (overrides: Partial<SsrTokenPayload> = {}): SsrTokenPayload => ({
  purpose: "ssr",
  sub: me.user.id,
  email: me.user.email,
  emailVerified: me.user.emailVerified,
  name: me.user.name,
  sid: "session-1",
  ch: "session-cookie-fingerprint",
  iat: Date.now() - 1_000,
  exp: Date.now() + 240_000,
  ver: "revision-1",
  user: me.user,
  tenants: me.tenants,
  ...overrides,
});

const htmlRequest = (cookies: string[], path = "/dashboard") => {
  const headers = new Headers({ accept: "text/html" });

  if (cookies.length) headers.set("cookie", cookies.join("; "));

  return new Request(`https://app.test${path}`, { headers });
};

/** The API's cold-path verifier: only the freshly minted token verifies. */
const verifyFreshToken =
  (freshToken: string) =>
  async (_secret: string, token: string, _cookie: string | undefined) =>
    token === freshToken ? tokenPayload() : undefined;

const bootstrapResponse = (ssrToken: string | null = "signed-token") =>
  Response.json({
    session: {
      sessionId: "session-1",
      subjectId: "user-1",
      claims: { name: "Owner", email: "owner@example.com", emailVerified: true },
    },
    me,
    ssrToken,
    ssrTokenExpiresAt: ssrToken ? Date.now() + 300_000 : null,
  });

const sessionCookie = "__Host-mattrax_session=opaque-session";
const ssrCookie = "__Host-mattrax_ssr=opaque-token";

describe("SSR preload", () => {
  it("answers a warm token with zero service-binding calls", async () => {
    let bootstrapCalls = 0;
    let boundCookie: string | undefined;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: async (_secret, _token, cookie) => {
        boundCookie = cookie;

        return tokenPayload();
      },
      fetchBootstrap: async () => {
        bootstrapCalls++;

        throw new Error("warm token must not call bootstrap");
      },
    });

    expect(bootstrapCalls).toBe(0);
    expect(boundCookie).toBe("opaque-session");
    expect(outcome.setSsrCookie).toBeUndefined();
    expect(outcome.session?.sessionId).toBe("session-1");
    expect(outcome.session?.me?.tenants[0]?.permissions).toContain("devices.write");
  });

  it("calls bootstrap once on a miss and sets the five-minute HttpOnly cookie", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: verifyFreshToken("signed-token"),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(1);
    expect(outcome.session?.me).toEqual(me);
    expect(outcome.setSsrCookie).toBeDefined();
    expect(outcome.setSsrCookie).toContain("HttpOnly");
    expect(outcome.setSsrCookie).toContain("Secure");
    expect(outcome.setSsrCookie).toContain("SameSite=Lax");
    expect(outcome.setSsrCookie).toContain("Path=/");
    expect(outcome.setSsrCookie).toContain("Max-Age=300");
  });

  it("treats a token without tenants as a miss", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: async (_secret, token) =>
        token === "signed-token" ? tokenPayload() : tokenPayload({ tenants: undefined }),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(1);
    expect(outcome.session?.me?.tenants).toHaveLength(1);
  });

  it("ignores a warm token minted before email verification", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: async (_secret, token) =>
        token === "fresh-verified-token"
          ? tokenPayload()
          : tokenPayload({
              emailVerified: false,
              user: { ...me.user, emailVerified: false },
            }),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse("fresh-verified-token");
      },
    });

    // The stale unverified token must not pin the just-verified user to
    // /verify-email for the rest of its five-minute life.
    expect(bootstrapCalls).toBe(1);
    expect(outcome.session?.me?.user.emailVerified).toBe(true);
    expect(outcome.setSsrCookie).toBeDefined();
    expect(outcome.ssrTokenRejected).toBeUndefined();
  });

  it("flags a warm token that fails verification so the edge can report it", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: verifyFreshToken("signed-token"),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(1);
    expect(outcome.ssrTokenRejected).toBe(true);
    expect(outcome.session?.me).toEqual(me);
  });

  it("makes no call and sets nothing for a signed-out visitor", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([]), {
      secret,
      verifyToken: async () => tokenPayload(),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(0);
    expect(outcome).toEqual({});
  });

  it("expires a leftover token once the session cookie is gone", async () => {
    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([ssrCookie]), {
      secret,
      verifyToken: async () => tokenPayload(),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(0);
    expect(outcome.session).toBeNull();
    expect(outcome.clearSsrCookie).toBe(true);
  });

  it("renders signed out when bootstrap fails or throws", async () => {
    for (const fetchBootstrap of [
      async () => new Response("unavailable", { status: 503 }),
      async () => {
        throw new Error("network down");
      },
    ]) {
      const outcome = await preloadSession(htmlRequest([sessionCookie]), {
        secret,
        verifyToken: async () => undefined,
        fetchBootstrap,
      });

      expect(outcome).toEqual({});
    }
  });

  it("does not set a token cookie when the API returned none", async () => {
    const outcome = await preloadSession(htmlRequest([sessionCookie]), {
      secret,
      verifyToken: async () => undefined,
      fetchBootstrap: async () => bootstrapResponse(null),
    });

    expect(outcome.session).toBeDefined();
    expect(outcome.setSsrCookie).toBeUndefined();
  });

  it("does not store a fresh token that the API issued without tenants", async () => {
    const outcome = await preloadSession(htmlRequest([sessionCookie]), {
      secret,
      verifyToken: async () => tokenPayload({ tenants: undefined }),
      fetchBootstrap: async () => bootstrapResponse("tenant-less-token"),
    });

    // The shell was already loaded, but a tenant-less cookie would be a miss on
    // every navigation and would be reissued forever.
    expect(outcome.session).toBeDefined();
    expect(outcome.setSsrCookie).toBeUndefined();
    expect(outcome.ssrTokenRejected).toBeUndefined();
  });

  it("does not store a fresh token that fails edge verification", async () => {
    const outcome = await preloadSession(htmlRequest([sessionCookie]), {
      secret,
      verifyToken: async () => undefined,
      fetchBootstrap: async () => bootstrapResponse("signed-with-another-secret"),
    });

    expect(outcome.session).toBeDefined();
    expect(outcome.setSsrCookie).toBeUndefined();
    expect(outcome.ssrTokenRejected).toBe(true);
  });

  it("reconstructs built-in permissions omitted from a warm token", async () => {
    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: async () =>
        tokenPayload({
          tenants: [{ ...me.tenants[0]!, permissions: undefined }],
        }),
      fetchBootstrap: async () => {
        throw new Error("a warm built-in token must not call bootstrap");
      },
    });

    expect(outcome.session?.me?.tenants[0]?.permissions).toEqual([
      ...BUILT_IN_ROLE_PERMISSIONS.owner,
    ]);
  });

  it("keeps three owner tenants warm after built-in permission compression", async () => {
    const tenants = Array.from({ length: 3 }, (_, index) => ({
      ...me.tenants[0]!,
      id: `tenant-${index}`,
      name: `Tenant ${index}`,
      slug: `tenant-${index}`,
      permissions: undefined,
    }));

    let bootstrapCalls = 0;

    const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie]), {
      secret,
      verifyToken: async () => tokenPayload({ tenants }),
      fetchBootstrap: async () => {
        bootstrapCalls++;

        return bootstrapResponse();
      },
    });

    expect(bootstrapCalls).toBe(0);
    expect(outcome.setSsrCookie).toBeUndefined();
    expect(outcome.session?.me?.tenants).toHaveLength(3);

    for (const tenant of outcome.session?.me?.tenants ?? [])
      expect(tenant.permissions).toHaveLength(PERMISSIONS.length);
  });

  it("skips bootstrap for passthrough prefixes even with an HTML Accept header", async () => {
    for (const path of [
      "/api",
      "/api/v1/bootstrap",
      "/api/v1/bootstrap/",
      "/mdm/apple/enroll",
      "/scim/v2/Users",
      "/mcp",
      "/cdn-cgi/trace",
      "/.well-known/oauth-authorization-server",
    ]) {
      let bootstrapCalls = 0;

      const outcome = await preloadSession(htmlRequest([sessionCookie, ssrCookie], path), {
        secret,
        verifyToken: async () => tokenPayload(),
        fetchBootstrap: async () => {
          bootstrapCalls++;

          return bootstrapResponse();
        },
      });

      // No API call, no Set-Cookie, no clear: the owning handler answers it.
      expect(bootstrapCalls, path).toBe(0);
      expect(outcome, path).toEqual({});
    }
  });

  it("builds matching set and clear cookies", () => {
    expect(ssrSetCookie("abc")).toBe(
      "__Host-mattrax_ssr=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300",
    );
    expect(ssrClearCookie()).toContain("Max-Age=0");
    expect(ssrClearCookie()).toContain("Path=/");
  });
});

const RedactedBootstrap = Schema.Struct({
  ssrToken: Schema.NullOr(Schema.String),
  ssrTokenExpiresAt: Schema.NullOr(Schema.Number),
  session: Schema.Unknown,
  me: MeResponseSchema,
});

describe("bootstrap proxy redaction", () => {
  it("strips the SSR token from a browser-visible response", async () => {
    const response = await redactBootstrapResponse(bootstrapResponse("must-not-leak"));
    const body = Schema.decodeUnknownSync(RedactedBootstrap)(await response.json());

    expect(body.ssrToken).toBeNull();
    expect(body.ssrTokenExpiresAt).toBeNull();
    expect(body.session).toBeDefined();
    expect(body.me).toEqual(me);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("cookie");
  });

  it("drops validators and content encoding that no longer describe the body", async () => {
    const response = await redactBootstrapResponse(
      new Response(JSON.stringify({ ssrToken: "must-not-leak", ssrTokenExpiresAt: 1 }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          etag: '"original-body"',
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
          "content-length": "51",
        },
      }),
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();

    const body: { ssrToken?: unknown } = await response.json();

    expect(body.ssrToken).toBeNull();
  });

  it("leaves unrelated responses untouched", async () => {
    const response = Response.json({ ok: true });
    const redacted = await redactBootstrapResponse(response);

    expect(await redacted.json()).toEqual({ ok: true });
  });

  it("fails closed when the bootstrap body cannot be decoded", async () => {
    for (const body of ["not json", '["not-an-object"]']) {
      const response = new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const redacted = await redactBootstrapResponse(response);
      const json = await redacted.json();

      // An unreadable body cannot be proven token-free, so it must never be
      // forwarded verbatim.
      expect(redacted.status).toBe(502);
      expect(json).not.toHaveProperty("ssrToken");
      expect(json).not.toHaveProperty("ssrTokenExpiresAt");
      expect(redacted.headers.get("cache-control")).toBe("no-store");
    }
  });
});
