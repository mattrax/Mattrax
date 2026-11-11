import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { EnterpriseAuth, StepUpService, StepUpUnavailable } from "@mattrax/enterprise-domain";
import { makeEnterpriseAuthLive } from "../src/enterpriseAuth.js";
import { signStepUpGrant } from "../src/stepUp.js";
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
    user: [
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

const makeContext = (verifyPassword = true) => {
  const db = makeDb(seed());
  const appAuth = {
    verifySession: () => Effect.succeed({ subjectId: "user-1", sessionId: "session-1" }),
  };
  const stepUp = Layer.succeed(StepUpService, {
    methods: () => Effect.succeed({ password: true, totp: true, passkey: false }),
    verifyPassword: () => Effect.succeed(verifyPassword),
    verifyTotp: () => Effect.succeed(false),
    beginPasskey: () => Effect.fail(new StepUpUnavailable({ message: "No passkey" })),
    completePasskey: () => Effect.succeed(false),
  });
  const Live = makeEnterpriseAuthLive({
    appAuth: Effect.succeed(appAuth) as any,
    origin,
    authSecret,
  }).pipe(Layer.provide(Layer.succeed(Db, db as any)), Layer.provide(stepUp));

  const run = <A>(work: (auth: any) => Effect.Effect<A, any, any>) =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* EnterpriseAuth;
        return yield* work(auth);
      }).pipe(Effect.provide(Live)),
    );

  return { db, run };
};

const session = (grant?: string) =>
  new Request(`${origin}/api/v1/tenants/tenant-1`, {
    method: "DELETE",
    headers: {
      cookie: "__Host-mattrax_session=test",
      ...(grant ? { "x-mattrax-step-up": grant } : {}),
    },
  });

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
      expiresAtMillis: input.expiresAtMillis ?? Date.now() + 60_000,
    }),
  );

describe("step-up enforcement", () => {
  it("rejects a sensitive action without a grant and reports usable factors", async () => {
    const { run } = makeContext();
    await expect(
      run((auth) => auth.requireStepUp(session(), "tenant-delete")),
    ).rejects.toMatchObject({
      _tag: "StepUpRequired",
      action: "tenant-delete",
      methods: ["password", "totp"],
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
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });
  });

  it("rejects a grant issued for another action, session or account", async () => {
    const { run } = makeContext();
    const otherAction = await grant({ action: "billing-portal" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherAction), "tenant-delete")),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });

    const otherSession = await grant({ sessionId: "session-other" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherSession), "tenant-delete")),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });

    const otherSubject = await grant({ subjectId: "user-2" });
    await expect(
      run((auth) => auth.requireStepUp(session(otherSubject), "tenant-delete")),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });
  });

  it("exempts a valid bearer token because it is already a scoped credential", async () => {
    const { run, db } = makeContext();
    const raw = "mtx_step_up_test_token";
    db.store.account_api_token.push({
      id: "token-1",
      userId: "user-1",
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

  it("issues a grant from a verified password and rejects a wrong one", async () => {
    const { run } = makeContext(true);
    const issued = await run((auth) =>
      auth.stepUpPassword(session(), {
        password: "correct horse battery",
        action: "tenant-delete",
      }),
    );
    expect(issued.method).toBe("password");
    expect(issued.expiresAtMillis).toBeGreaterThan(Date.now());
    await expect(
      run((auth) => auth.requireStepUp(session(issued.grant), "tenant-delete")),
    ).resolves.toBeDefined();

    const rejecting = makeContext(false);
    await expect(
      rejecting.run((auth) =>
        auth.stepUpPassword(session(), { password: "wrong", action: "tenant-delete" }),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpRequired" });
  });
});
