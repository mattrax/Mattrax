import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import {
  EnterpriseAuth,
  StepUpRequired,
  StepUpService,
  StepUpUnavailable,
} from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "../src/Identity/enterpriseAuth.ts";
import {
  signStepUpFlow,
  signStepUpGrant,
  verifyAnyStepUpFlow,
  verifyStepUpGrant,
} from "../src/Account/stepUp.ts";
import { makeDb, runEffect } from "./helpers.js";

const origin = "https://enterprise.test";

const authSecret = "step-up-test-secret";

const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const seed = () => {
  const now = new Date();

  return {
    account: [
      {
        id: "user-1",
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
        disabled: false,
        totpEnabled: true,
        passkeyEnabled: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    account_api_token: [],
  };
};

const makeContext = (verifyTotp = true) => {
  const db = makeDb(seed());

  const appAuth = {
    verifySession: () => Effect.succeed({ subjectId: "user-1", sessionId: "session-1" }),
  };

  const stepUp = Layer.succeed(StepUpService, {
    methods: () => Effect.succeed({ totp: true, passkey: false }),
    verifyTotp: () => Effect.succeed(verifyTotp),
    beginPasskey: () => Effect.fail(new StepUpUnavailable({ message: "No passkey" })),
    completePasskey: () => Effect.succeed(undefined),
  });

  const Live = makeEnterpriseAuthLive({
    // SAFETY: the fake exposes only `verifySession`, the one app-auth member the
    // step-up grant path reads.
    appAuth: Effect.succeed(appAuth) as any,
    origin,
    authSecret,
  }).pipe(Layer.provide(Layer.succeed(Db, db)), Layer.provide(stepUp));

  const run = <A>(work: (auth: any) => Effect.Effect<A, any, any>): Promise<A> =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* EnterpriseAuth;

        return yield* work(auth);
      }).pipe(Effect.provide(Live)),
    );

  return { db, run };
};

const session = (grant?: string) => {
  const headers = new Headers({
    cookie: "__Host-mattrax_session=test",
    origin,
    "x-effect-auth-csrf": "1",
  });

  if (grant !== undefined) headers.set("x-mattrax-step-up", grant);

  return new Request(`${origin}/api/v1/tenants/tenant-1`, { method: "DELETE", headers });
};

const grant = (
  input: {
    action?: any;
    sessionId?: string;
    subjectId?: string;
    expiresAtMillis?: number;
  } = {},
) =>
  Effect.runPromise(
    signStepUpGrant(authSecret, {
      subjectId: input.subjectId ?? "user-1",
      email: "owner@example.com",
      sessionId: input.sessionId ?? "session-1",
      action: input.action ?? "tenant-delete",
      method: "passkey" as const,
      credentialId: "passkey-1",
      expiresAtMillis: input.expiresAtMillis ?? Date.now() + 60_000,
    }),
  );

describe("step-up clock boundaries", () => {
  it("expires grants and flow bindings on the Effect clock", async () => {
    const grantToken = await grant({ expiresAtMillis: 1_000 });
    const flowToken = await Effect.runPromise(
      signStepUpFlow(authSecret, {
        subjectId: "user-1",
        email: "owner@example.com",
        sessionId: "session-1",
        action: "tenant-delete",
        flowId: "flow-1",
        requestBindingVerifier: "verifier",
        requestBindingExpiresAtMillis: 1_000,
      }),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        expect(
          yield* verifyStepUpGrant(authSecret, grantToken, {
            subjectId: "user-1",
            sessionId: "session-1",
            action: "tenant-delete",
          }),
        ).toBe(true);
        expect(
          yield* verifyAnyStepUpFlow(authSecret, flowToken, {
            subjectId: "user-1",
            sessionId: "session-1",
          }),
        ).toBeDefined();

        yield* TestClock.adjust(1_000);

        expect(
          yield* verifyStepUpGrant(authSecret, grantToken, {
            subjectId: "user-1",
            sessionId: "session-1",
            action: "tenant-delete",
          }),
        ).toBe(false);
        expect(
          yield* verifyAnyStepUpFlow(authSecret, flowToken, {
            subjectId: "user-1",
            sessionId: "session-1",
          }),
        ).toBeUndefined();
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });
});

describe("step-up enforcement", () => {
  it("rejects a sensitive action without a grant and reports usable factors", async () => {
    const { run } = makeContext();
    const attempt = run((auth) => auth.requireStepUp(session(), "tenant-delete"));
    await expect(attempt).rejects.toBeInstanceOf(StepUpRequired);
    await expect(attempt).rejects.toMatchObject({
      action: "tenant-delete",
      methods: ["totp"],
    });
  });

  it("allows a grant bound to the account, session and action", async () => {
    const { run } = makeContext();
    const valid = await grant();
    await expect(
      run((auth) => auth.requireStepUp(session(valid), "tenant-delete")),
    ).resolves.toMatchObject({ user: { id: "user-1" } });
  });

  it("rejects an expired grant", async () => {
    const { run } = makeContext();
    const expired = await grant({ expiresAtMillis: Date.now() - 1_000 });
    await expect(
      run((auth) => auth.requireStepUp(session(expired), "tenant-delete")),
    ).rejects.toBeInstanceOf(StepUpRequired);
  });

  it("rejects a grant issued for another action, session or account", async () => {
    const { run } = makeContext();
    const otherAction = await grant({ action: "billing-portal" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherAction), "tenant-delete")),
    ).rejects.toBeInstanceOf(StepUpRequired);

    const otherSession = await grant({ sessionId: "session-other" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherSession), "tenant-delete")),
    ).rejects.toBeInstanceOf(StepUpRequired);

    const otherSubject = await grant({ subjectId: "user-2" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherSubject), "tenant-delete")),
    ).rejects.toBeInstanceOf(StepUpRequired);
  });

  it("exempts a valid bearer token because it is already a scoped credential", async () => {
    const { run, db } = makeContext();
    const raw = "mtx_step_up_test_token";
    db.store.account_api_token.push({
      id: "token-1",
      accountId: "user-1",
      name: "CLI",
      tokenPrefix: raw.slice(0, 12),
      tokenHash: await sha256(raw),
      scopes: ["read", "write"],
      tenantId: null,
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const bearer = new Request(`${origin}/api/v1/tenants/tenant-1`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${raw}` },
    });

    await expect(run((auth) => auth.requireStepUp(bearer, "tenant-delete"))).resolves.toMatchObject(
      { apiToken: { id: "token-1" } },
    );
  });

  it("issues a grant from a verified authenticator code and rejects a wrong one", async () => {
    const { run } = makeContext(true);

    // SAFETY: the fake auth's step-up succeeds with the documented grant
    // shape; the assertions below read exactly those fields.
    const issued = (await run((auth) =>
      auth.stepUpTotp(session(), {
        code: "123456",
        action: "tenant-delete",
      }),
    )) as { method: string; expiresAtMillis: number; grant: string };

    expect(issued.method).toBe("totp");
    expect(issued.expiresAtMillis).toBeGreaterThan(Date.now());
    await expect(
      run((auth) => auth.requireStepUp(session(issued.grant), "tenant-delete")),
    ).resolves.toBeDefined();

    const rejecting = makeContext(false);
    await expect(
      rejecting.run((auth) =>
        auth.stepUpTotp(session(), { code: "000000", action: "tenant-delete" }),
      ),
    ).rejects.toBeInstanceOf(StepUpRequired);
  });
});
