import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { EnterpriseService as EnterpriseServiceTag } from "@mattrax/enterprise-domain";
import {
  appleByodBlockers,
  appleByodChallengeProblem,
  appleByodDiscoveryResponse,
  appleByodDiscoveryDocument,
  appleByodDocumentJson,
  appleByodRoutes,
  appleByodTokenProblem,
  createEnterpriseService,
  normalizeAppleByodDomain,
} from "@mattrax/enterprise-api";
import { makeDb, request, runEffect, schema } from "./helpers.js";

const origin = "https://app.test";

const now = new Date("2026-11-24T10:00:00.000Z");

afterEach(() => vi.unstubAllGlobals());

const makeService = (initial: Parameters<typeof makeDb>[0] = {}) => {
  const db = makeDb(initial);
  const user = {
    id: "account-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    disabled: false,
    authRevision: "revision-1",
    defaultTenantId: null,
    createdAt: now,
    updatedAt: now,
  };
  // SAFETY: the discovery/patch paths under test only need these two auth
  // members; no dashboard session is created by this suite.
  const auth = {
    requireUser: () => Effect.succeed({ user }),
    requireStepUp: () => Effect.void,
  } as never;
  const service = createEnterpriseService({
    db,
    schema,
    origin,
    storage: {} as never,
    auth,
    authSecret: "test-secret",
  });

  return { db, service, auth };
};

const organization = (id: string) => ({
  id,
  name: id,
  slug: id,
  createdAt: now,
  updatedAt: now,
});

const byodConfig = (
  overrides: Record<string, string | number | boolean | Date | null | undefined> = {},
) => ({
  organizationId: "org-1",
  enabled: true,
  domain: "school.example",
  validatedAt: now,
  hardwareValidationRequired: false,
  hardwareValidatedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("Apple BYOD discovery document", () => {
  it("has the exact shape and BaseURL Apple requires", () => {
    const document = appleByodDiscoveryDocument({
      organizationId: "org-1",
      domain: "school.example",
    });

    expect(document).toEqual({
      Servers: [
        {
          Version: "mdm-byod",
          BaseURL: "https://school.example/mdm/apple/byod/org-1/enroll",
        },
      ],
    });

    expect(JSON.parse(appleByodDocumentJson({ organizationId: "org-1", domain: "school.example" })))
      .toEqual(document);
  });

  it("normalises domains and rejects schemes, paths and single labels", () => {
    expect(normalizeAppleByodDomain(" School.Example. ")).toBe("school.example");
    expect(normalizeAppleByodDomain("https://school.example")).toBeNull();
    expect(normalizeAppleByodDomain("school.example/path")).toBeNull();
    expect(normalizeAppleByodDomain("localhost")).toBeNull();
  });
});

describe("Apple BYOD token policy", () => {
  const base = {
    organizationId: "org-1",
    storedOrganizationId: "org-1",
    requestHash: "request",
    storedRequestHash: "request",
    managedAppleAccount: "student@school.example",
    tokenExpiresAt: new Date(now.getTime() + 60_000),
    tokenConsumedAt: null,
    now,
  };

  it("accepts a live token bound to the tenant and request", () => {
    expect(appleByodTokenProblem(base)).toBeNull();
  });

  it("rejects tenant, request, account, expiry and replay mismatches", () => {
    expect(appleByodTokenProblem({ ...base, storedOrganizationId: "org-2" })).toBe(
      "tenant_mismatch",
    );
    expect(appleByodTokenProblem({ ...base, storedRequestHash: "other" })).toBe(
      "request_mismatch",
    );
    expect(appleByodTokenProblem({ ...base, managedAppleAccount: null })).toBe("account_missing");
    expect(
      appleByodTokenProblem({ ...base, tokenExpiresAt: new Date(now.getTime() - 1) }),
    ).toBe("expired");
    expect(appleByodTokenProblem({ ...base, tokenConsumedAt: now })).toBe("used");
  });

  it("refuses an expired or already-authorised device challenge", () => {
    expect(
      appleByodChallengeProblem({
        challengeExpiresAt: new Date(now.getTime() + 60_000),
        authorizedAt: null,
        tokenHash: null,
        now,
      }),
    ).toBeNull();
    expect(
      appleByodChallengeProblem({
        challengeExpiresAt: new Date(now.getTime() - 1),
        authorizedAt: null,
        tokenHash: null,
        now,
      }),
    ).toBe("expired");
    expect(
      appleByodChallengeProblem({
        challengeExpiresAt: new Date(now.getTime() + 60_000),
        authorizedAt: now,
        tokenHash: null,
        now,
      }),
    ).toBe("used");
  });
});

describe("Apple BYOD discovery host resolution", () => {
  it("answers the tenant configured for the exact host", async () => {
    const { service } = makeService({
      organization: [organization("org-1")],
      sso_domain: [{ domain: "school.example", organizationId: "org-1", isVerified: true }],
      apple_byod_config: [byodConfig()],
    });

    const result = await runEffect(service.appleByodDiscovery("school.example"));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      Servers: [
        {
          Version: "mdm-byod",
          BaseURL: "https://school.example/mdm/apple/byod/org-1/enroll",
        },
      ],
    });
  });

  it("does not serve another tenant's document for a shared deployment host", async () => {
    const { service } = makeService({
      organization: [organization("org-1"), organization("org-2")],
      apple_byod_config: [
        byodConfig(),
        byodConfig({ organizationId: "org-2", domain: "other.example" }),
      ],
    });

    expect((await runEffect(service.appleByodDiscovery("other.example"))).status).toBe(200);
    expect((await runEffect(service.appleByodDiscovery("app.test"))).status).toBe(404);
  });

  it("explains that a verified domain has no BYOD configuration", async () => {
    const { service } = makeService({
      organization: [organization("org-1")],
      sso_domain: [{ domain: "school.example", organizationId: "org-1", isVerified: true }],
    });

    const result = await runEffect(service.appleByodDiscovery("school.example"));

    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).toContain("not configured");
  });

  it("withholds the document when disabled or awaiting real-device validation", async () => {
    const disabled = makeService({
      organization: [organization("org-1")],
      apple_byod_config: [byodConfig({ enabled: false })],
    });
    const unvalidated = makeService({
      organization: [organization("org-1")],
      apple_byod_config: [
        byodConfig({ hardwareValidationRequired: true, hardwareValidatedAt: null }),
      ],
    });

    expect((await runEffect(disabled.service.appleByodDiscovery("school.example"))).status).toBe(
      403,
    );
    expect((await runEffect(unvalidated.service.appleByodDiscovery("school.example"))).status).toBe(
      403,
    );
  });
});

describe("Apple BYOD setup blockers", () => {
  it("requires a domain, SSO and APNs", () => {
    expect(
      appleByodBlockers({
        domain: null,
        domains: [],
        ssoEnabled: false,
        apnsConfigured: false,
      }),
    ).toHaveLength(3);
  });

  it("rejects a domain that is not verified for the tenant", () => {
    expect(
      appleByodBlockers({
        domain: "unverified.example",
        domains: [{ domain: "school.example" }],
        ssoEnabled: true,
        apnsConfigured: true,
      }),
    ).toEqual([
      "unverified.example is not a verified domain for this tenant. Refresh Entra domains.",
    ]);
  });

  it("blocks a tenant-hosted domain on Mattrax Cloud", () => {
    expect(
      appleByodBlockers({
        domain: "school.example",
        domains: [{ domain: "school.example" }],
        ssoEnabled: true,
        apnsConfigured: true,
        hosted: true,
        deploymentHost: "e.mattrax.app",
      }),
    ).toHaveLength(1);
  });

  it("refuses to enable without a domain or with an unverified domain", async () => {
    const { service } = makeService({
      account: [
        {
          id: "account-1",
          name: "Owner",
          email: "owner@example.com",
          emailVerified: true,
          disabled: false,
          authRevision: "revision-1",
          createdAt: now,
          updatedAt: now,
        },
      ],
      organization: [organization("org-1")],
      member: [
        {
          id: "member-1",
          organizationId: "org-1",
          accountId: "account-1",
          role: "owner",
          customRoleId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      sso_config: [
        {
          organizationId: "org-1",
          enabled: true,
          azureTenantId: "entra-tenant",
          autoProvision: true,
          requireMfa: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      apple_push_certificate: [
        {
          organizationId: "org-1",
          topic: "com.apple.mgmt.External.org-1",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    await expect(
      runEffect(service.patchAppleByodConfig(request(), "org-1", { enabled: true })),
    ).rejects.toThrow(/verified domain/i);

    await expect(
      runEffect(
        service.patchAppleByodConfig(request(), "org-1", {
          enabled: true,
          domain: "unverified.example",
        }),
      ),
    ).rejects.toThrow(/not a verified domain/i);

    const info = await runEffect(service.getAppleByodConfig(request(), "org-1"));

    expect(info.domains).toEqual([]);
    expect(info.blockers.length).toBeGreaterThan(0);
  });

  it("tests the selected domain before it is saved", async () => {
    const saved = new Date("2026-11-20T10:00:00.000Z");
    const { service, db } = makeService({
      account: [
        {
          id: "account-1",
          name: "Owner",
          email: "owner@example.com",
          emailVerified: true,
          disabled: false,
          authRevision: "revision-1",
          createdAt: now,
          updatedAt: now,
        },
      ],
      organization: [organization("org-1")],
      member: [
        {
          id: "member-1",
          organizationId: "org-1",
          accountId: "account-1",
          role: "owner",
          customRoleId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      sso_config: [
        {
          organizationId: "org-1",
          enabled: true,
          azureTenantId: "entra-tenant",
          autoProvision: true,
          requireMfa: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      apple_push_certificate: [
        {
          organizationId: "org-1",
          topic: "com.apple.mgmt.External.org-1",
          createdAt: now,
          updatedAt: now,
        },
      ],
      sso_domain: [
        { domain: "a.example", organizationId: "org-1", isVerified: true },
        { domain: "b.example", organizationId: "org-1", isVerified: true },
      ],
      apple_byod_config: [
        byodConfig({ domain: "a.example", validatedAt: saved }),
      ],
    });
    let requested = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        requested = url.toString();

        return new Response(
          appleByodDocumentJson({ organizationId: "org-1", domain: "b.example" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = await runEffect(
      service.testAppleByodConfig(request(), "org-1", { domain: "b.example" }),
    );

    expect(result.ok).toBe(true);
    expect(requested).toContain("https://b.example/");
    // Testing an unsaved selection must not stamp the saved domain.
    expect(db.store.apple_byod_config[0]?.validatedAt).toBe(saved);
  });
});

describe("Apple BYOD discovery route", () => {
  it("returns JSON with the correct content type and cache policy", async () => {
    const response = HttpServerResponse.toWeb(
      appleByodDiscoveryResponse({
        status: 200,
        body: appleByodDiscoveryDocument({ organizationId: "org-1", domain: "school.example" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      Servers: [{ Version: "mdm-byod" }],
    });
  });
});

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

type RouteService = {
  readonly appleByodDiscovery?: (host: string) => Effect.Effect<{ status: number; body: unknown }>;
  readonly getAppleByodEnrollmentProfile?: (input: {
    readonly organizationId: string;
    readonly managedAppleAccount: string;
    readonly byodEnrollmentId: string;
  }) => Effect.Effect<{ profile: Uint8Array; filename: string }>;
};

const makeRouteHandler = (
  db: ReturnType<typeof makeDb>,
  service: RouteService,
) =>
  HttpRouter.toWebHandler(
    appleByodRoutes.pipe(
      Layer.provideMerge(Layer.succeed(EnterpriseServiceTag, service as never)),
      Layer.provideMerge(Layer.succeed(Db, db as never)),
      Layer.provide(HttpServer.layerServices),
    ) as never,
    { disableLogger: true },
  );

const byodConfigRow = (
  overrides: Record<string, string | number | boolean | Date | null | undefined> = {},
) => ({
  organizationId: "org-1",
  enabled: true,
  domain: "school.example",
  validatedAt: now,
  hardwareValidationRequired: false,
  hardwareValidatedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const enrollmentRow = (
  overrides: Record<string, string | number | boolean | Date | null | undefined> = {},
) => ({
  id: "byod-1",
  organizationId: "org-1",
  managedAppleAccount: "student@school.example",
  requestHash: "request-hash",
  accountId: "account-1",
  directoryUserId: "dir-1",
  tokenHash: "token-hash",
  tokenExpiresAt: new Date(Date.now() + 60_000),
  tokenConsumedAt: null,
  challengeExpiresAt: new Date(Date.now() + 60_000),
  authorizedAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const profileService = () => ({
  getAppleByodEnrollmentProfile: () =>
    Effect.succeed({ profile: new Uint8Array([1, 2, 3]), filename: "school-byod.mobileconfig" }),
});

describe("Apple BYOD route host and token security", () => {
  it("uses the incoming Host header when no trusted public header is present", async () => {
    const hosts: string[] = [];
    const service = {
      appleByodDiscovery: (host: string) => {
        hosts.push(host);

        return Effect.succeed({
          status: 200,
          body: appleByodDiscoveryDocument({ organizationId: "org-1", domain: host }),
        });
      },
    };
    const { handler, dispose } = makeRouteHandler(makeDb(), service);

    try {
      const response = await handler(
        new Request("http://127.0.0.1:8787/.well-known/com.apple.remotemanagement", {
          headers: { host: "school.example" },
        }),
      );

      expect(response.status).toBe(200);
      expect(hosts).toEqual(["school.example"]);
    } finally {
      await dispose();
    }
  });

  it("redeems a bound token once, then rejects the replay", async () => {
    const token = "a".repeat(43);
    const tokenHash = await sha256Hex(token);
    const requestHash = await sha256Hex("request-body");
    const db = makeDb({
      apple_byod_config: [byodConfigRow()],
      apple_byod_enrollment: [enrollmentRow({ tokenHash, requestHash })],
    });
    const { handler, dispose } = makeRouteHandler(db, profileService());
    const request = () =>
      new Request("https://school.example/mdm/apple/byod/org-1/enroll", {
        method: "POST",
        body: "request-body",
        headers: {
          host: "school.example",
          authorization: "Bearer " + token,
        },
      });

    try {
      const response = await handler(
        new Request("https://school.example/mdm/apple/byod/org-1/enroll", {
          method: "POST",
          body: "request-body",
          headers: {
            host: "school.example",
            authorization: "Bearer " + token,
          },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-apple-aspen-config");

      expect((await handler(request())).status).toBe(401);
    } finally {
      await dispose();
    }
  });

  it("rejects an expired, consumed, wrong-tenant or wrong-body token", async () => {
    const token = "b".repeat(43);
    const tokenHash = await sha256Hex(token);
    const requestHash = await sha256Hex("request-body");
    const cases: Array<{
      name: string;
      rows: Record<string, string | number | boolean | Date | null | undefined>;
      org?: string;
      body?: string;
    }> = [
      {
        name: "expired",
        rows: { tokenExpiresAt: new Date(Date.now() - 1) },
      },
      { name: "consumed", rows: { tokenConsumedAt: now } },
      {
        name: "wrong tenant",
        rows: {},
        org: "org-2",
      },
      { name: "wrong body", rows: {}, body: "other-body" },
    ];

    for (const testCase of cases) {
      const db = makeDb({
        apple_byod_config: [byodConfigRow(), byodConfigRow({ organizationId: "org-2" })],
        apple_byod_enrollment: [enrollmentRow({ tokenHash, requestHash, ...testCase.rows })],
      });
      const { handler, dispose } = makeRouteHandler(db, profileService());

      try {
        const response = await handler(
          new Request(
            "https://school.example/mdm/apple/byod/" + (testCase.org ?? "org-1") + "/enroll",
            {
              method: "POST",
              body: testCase.body ?? "request-body",
              headers: { host: "school.example", authorization: "Bearer " + token },
            },
          ),
        );

        expect(response.status, testCase.name).toBe(401);
      } finally {
        await dispose();
      }
    }
  });

  it("returns a device challenge with the authorize URL on first use", async () => {
    const db = makeDb({ apple_byod_config: [byodConfigRow()] });
    const { handler, dispose } = makeRouteHandler(db, profileService());

    try {
      const response = await handler(
        new Request("https://school.example/mdm/apple/byod/org-1/enroll", {
          method: "POST",
          body: "request-body",
          headers: { host: "school.example" },
        }),
      );
      const challenge = response.headers.get("www-authenticate") ?? "";

      expect(response.status).toBe(401);
      expect(challenge).toContain('method="apple-as-web"');
      expect(challenge).toContain("school.example/mdm/apple/byod/authorize");
      expect(db.store.apple_byod_enrollment).toHaveLength(1);
    } finally {
      await dispose();
    }
  });

  it("enforces the body limit while reading the stream", async () => {
    const db = makeDb({ apple_byod_config: [byodConfigRow()] });
    const { handler, dispose } = makeRouteHandler(db, profileService());

    try {
      const response = await handler(
        new Request("https://school.example/mdm/apple/byod/org-1/enroll", {
          method: "POST",
          body: "x".repeat(70 * 1024),
          headers: { host: "school.example" },
        }),
      );

      expect(response.status).toBe(413);
    } finally {
      await dispose();
    }
  });
});
