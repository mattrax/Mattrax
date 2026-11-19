import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEnterpriseService } from "@mattrax/enterprise-api";
import { EnterpriseUnauthorized } from "@mattrax/enterprise-domain";
import { makeDb, makeStripeClient, request, runEffect, schema } from "./helpers.js";

const origin = "https://enterprise.test";

const makeContext = (db = makeDb()) => {
  const now = new Date();

  const user = {
    id: "account-1",
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  };

  db.store.account.push(user);

  const auth = {
    requireUser: (input: any) => {
      const headers = input instanceof Request ? Object.fromEntries(input.headers) : input.headers;

      return headers.cookie
        ? Effect.succeed({ user })
        : Effect.fail(new EnterpriseUnauthorized({ message: "Unauthenticated" }));
    },
  };

  const service = createEnterpriseService({
    db,
    schema,
    origin,
    stripeClient: makeStripeClient(),
    // SAFETY: this test never reaches R2; the service only stores the binding.
    storage: {} as any,
    // SAFETY: the fake implements the only auth method under test.
    auth: auth as any,
    authSecret: "enterprise-test-secret",
  });

  return { db, service, headers: { cookie: "mattrax_session=test" } };
};

const attempt = (input: {
  id: string;
  accountId: string;
  createdAt: Date;
  success: boolean;
  method?: string;
  failureReason?: string | null;
}) => ({
  id: input.id,
  accountId: input.accountId,
  email: "owner@example.com",
  success: input.success,
  method: input.method ?? "passkey",
  failureReason: input.failureReason ?? null,
  ip: "203.0.113.0/24",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  createdAt: input.createdAt,
});

describe("account login attempts endpoint", () => {
  it("returns only the signed-in account's attempts, newest first", async () => {
    const db = makeDb({
      login_attempt: [
        attempt({
          id: "older",
          accountId: "account-1",
          createdAt: new Date(2026, 0, 1),
          success: true,
        }),
        attempt({
          id: "newer",
          accountId: "account-1",
          createdAt: new Date(2026, 0, 2),
          success: false,
          failureReason: "mfa_failed",
        }),
        attempt({
          id: "other-account",
          accountId: "account-2",
          createdAt: new Date(2026, 0, 3),
          success: true,
        }),
      ],
    });

    const { service, headers } = makeContext(db);
    const result = await runEffect(service.listLoginAttempts(request(headers)));

    expect(result.attempts.map((row: { id: string }) => row.id)).toEqual(["newer", "older"]);
    expect(result.attempts[0]).toMatchObject({
      success: false,
      method: "passkey",
      failureReason: "mfa_failed",
      ip: "203.0.113.0/24",
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
    });
    expect(result.attempts[0].createdAt).toBe(new Date(2026, 0, 2).toISOString());
  });

  it("has a stable empty shape", async () => {
    const { service, headers } = makeContext();

    await expect(runEffect(service.listLoginAttempts(request(headers)))).resolves.toEqual({
      attempts: [],
    });
  });

  it("requires authentication", async () => {
    const { service } = makeContext();

    await expect(runEffect(service.listLoginAttempts(request()))).rejects.toBeInstanceOf(
      EnterpriseUnauthorized,
    );
  });
});
