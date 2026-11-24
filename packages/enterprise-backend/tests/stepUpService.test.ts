import { Passkey, Totp } from "@yielded/auth";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { StepUpService, StepUpUnavailable } from "@mattrax/enterprise-domain";
import { stepUpServiceLayer } from "../src/Account/stepUp.ts";
import { makeDb } from "./helpers.js";

const unavailable = (message = "unavailable") =>
  Effect.fail(new StepUpUnavailable({ message, reason: "storage", retryable: true }));

const makeLayer = (
  overrides: {
    totpSnapshot?: () => Effect.Effect<any, any>;
    decryptSecret?: () => Effect.Effect<Uint8Array, any>;
    matchCode?: () => Effect.Effect<number | null, any>;
    passkeyList?: () => Effect.Effect<any, any>;
    passkeyContext?: () => Effect.Effect<any, any>;
  } = {},
) => {
  const totpPersistence = Layer.succeed(Totp.TotpPersistence, {
    snapshot:
      overrides.totpSnapshot ??
      (() =>
        Effect.succeed({
          record: {
            secret: "envelope",
            subjectId: "user-1",
            credentialId: "credential-1",
            revision: "revision-1",
          },
        })),
  } as any);
  const totpCryptography = Layer.succeed(Totp.TotpCryptography, {
    decryptSecret: overrides.decryptSecret ?? (() => Effect.succeed(new Uint8Array(32).fill(1))),
    matchCode: overrides.matchCode ?? (() => Effect.succeed(1)),
  } as any);
  const passkeyCredentials = Layer.succeed(Passkey.PasskeyCredentials, {
    listForSubject: overrides.passkeyList ?? (() => Effect.succeed({ credentials: [] })),
    lookup: () => Effect.succeed(undefined),
  } as any);
  const passkeyPersistence = Layer.succeed(Passkey.PasskeyPersistence, {
    context: overrides.passkeyContext ?? (() => Effect.succeed(undefined)),
    issue: () => Effect.die("not used"),
    consume: () => Effect.die("not used"),
  } as any);
  const passkeyProtocol = Layer.succeed(Passkey.PasskeyProtocol, {
    prepareAuthentication: () => Effect.die("not used"),
    verifyAuthentication: () => Effect.die("not used"),
  } as any);

  return stepUpServiceLayer().pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Db, makeDb()),
        totpPersistence,
        totpCryptography,
        passkeyCredentials,
        passkeyPersistence,
        passkeyProtocol,
        Passkey.PasskeyConfig.layer({
          id: "enterprise.test",
          name: "Mattrax test",
          origins: ["https://enterprise.test"],
        }),
      ),
    ),
  );
};

const run = <A, E>(
  layer: Layer.Layer<StepUpService>,
  work: (service: StepUpService["Service"]) => Effect.Effect<A, E>,
) => Effect.runPromise(Effect.flatMap(StepUpService, work).pipe(Effect.provide(layer)));

describe("step-up infrastructure failures", () => {
  it("reports factor discovery outages instead of absent factors", async () => {
    await expect(
      run(makeLayer({ totpSnapshot: () => unavailable() }), (service) => service.methods("user-1")),
    ).rejects.toMatchObject({ _tag: "StepUpUnavailable", reason: "storage", retryable: true });
  });

  it("does not query storage for a malformed authenticator code", async () => {
    await expect(
      run(makeLayer({ totpSnapshot: () => unavailable() }), (service) =>
        service.verifyTotp("user-1", "bad"),
      ),
    ).resolves.toBe(false);
  });

  it("distinguishes a wrong code from a persistence outage", async () => {
    await expect(
      run(makeLayer({ matchCode: () => Effect.succeed(null) }), (service) =>
        service.verifyTotp("user-1", "000000"),
      ),
    ).resolves.toBe(false);

    await expect(
      run(makeLayer({ totpSnapshot: () => unavailable() }), (service) =>
        service.verifyTotp("user-1", "000000"),
      ),
    ).rejects.toBeInstanceOf(StepUpUnavailable);
  });

  it("reports decryption failures instead of a wrong code", async () => {
    await expect(
      run(makeLayer({ decryptSecret: () => unavailable("decrypt") }), (service) =>
        service.verifyTotp("user-1", "000000"),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpUnavailable", reason: "cryptography", retryable: true });
  });

  it("reports passkey discovery and completion outages", async () => {
    await expect(
      run(makeLayer({ passkeyList: () => unavailable("list") }), (service) =>
        service.beginPasskey("user-1"),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpUnavailable", reason: "storage", retryable: true });

    await expect(
      run(makeLayer({ passkeyContext: () => unavailable("context") }), (service) =>
        service.completePasskey({
          subjectId: "user-1",
          flowId: "flow-1",
          requestBindingVerifier: "verifier",
          requestBindingExpiresAtMillis: 1_000,
          response: "{}",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "StepUpUnavailable", reason: "storage", retryable: true });
  });

  it("still returns no credential for an unknown passkey flow", async () => {
    await expect(
      run(makeLayer(), (service) =>
        service.completePasskey({
          subjectId: "user-1",
          flowId: "flow-1",
          requestBindingVerifier: "verifier",
          requestBindingExpiresAtMillis: 1_000,
          response: "{}",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
