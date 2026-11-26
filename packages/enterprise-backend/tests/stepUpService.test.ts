import { Passkey, Totp } from "@yielded/auth";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { StepUpService, StepUpUnavailable } from "@mattrax/enterprise-domain";
import { stepUpServiceLayer } from "../src/Account/stepUp.ts";
import { schema } from "../src/schema.ts";
import { makeDb } from "./helpers.js";

const NOW = Date.parse("2026-11-01T00:00:00Z");

const unavailable = (message = "unavailable") =>
  Effect.fail(new StepUpUnavailable({ message, reason: "storage", retryable: true }));

/** The production upsert is a no-op when the subject row already exists. */
const makeStepUpDb = () => {
  const db = makeDb();
  const insert = db.insert.bind(db);

  db.insert = ((table: any) => {
    const builder: any = insert(table);

    if (table !== schema.stepUpTotpState) return builder;

    let pending: any;
    const values = builder.values.bind(builder);

    builder.values = (row: any) => {
      pending = row;
      return builder;
    };
    builder.onDuplicateKeyUpdate = () =>
      Effect.sync(() => {
        if (
          db.store.step_up_totp_state.some(
            (existing: any) => existing.subjectId === pending.subjectId,
          )
        )
          return { affectedRows: 0 };

        values(pending);

        return { affectedRows: 1 };
      });

    return builder;
  }) as typeof db.insert;

  return db;
};

const makeLayer = (
  overrides: {
    db?: ReturnType<typeof makeDb>;
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
        Layer.succeed(Db, overrides.db ?? makeStepUpDb()),
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
    Layer.orDie,
  );
};

const run = <A, E>(
  layer: Layer.Layer<StepUpService>,
  work: (service: StepUpService["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      return yield* work(yield* StepUpService);
    }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
  );

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

describe("step-up TOTP failure admission", () => {
  it("locks the subject row inside the transaction before matching a code", async () => {
    const db = makeStepUpDb();
    const select = db.select.bind(db);
    const transaction = db.transaction.bind(db);
    const locks: string[] = [];
    let transactions = 0;
    let matched = false;

    db.select = ((fields?: any) => {
      const builder: any = select(fields);
      const lock = builder.for.bind(builder);

      builder.for = (strength: string) => {
        locks.push(strength);
        return lock(strength);
      };

      return builder;
    }) as typeof db.select;
    db.transaction = ((work: any) => {
      transactions++;
      return transaction(work);
    }) as typeof db.transaction;

    await run(
      makeLayer({
        db,
        matchCode: () =>
          Effect.sync(() => {
            matched = true;
            return null;
          }),
      }),
      (service) => service.verifyTotp("user-1", "000000"),
    );

    expect(transactions).toBe(1);
    expect(locks).toEqual(["update"]);
    expect(matched).toBe(true);
    expect(db.store.step_up_totp_state[0]).toMatchObject({ failures: 1, lockedUntil: null });
  });

  it("stops admitting guesses after five failures", async () => {
    let matches = 0;
    const db = makeStepUpDb();
    const layer = makeLayer({
      db,
      matchCode: () =>
        Effect.sync(() => {
          matches++;
          return null;
        }),
    });

    for (let attempt = 0; attempt < 5; attempt++)
      await expect(run(layer, (service) => service.verifyTotp("user-1", "000000"))).resolves.toBe(
        false,
      );

    await expect(run(layer, (service) => service.verifyTotp("user-1", "000000"))).resolves.toBe(
      false,
    );

    expect(matches).toBe(5);
    expect(db.store.step_up_totp_state[0]).toMatchObject({ failures: 5 });
    expect(db.store.step_up_totp_state[0]!.lockedUntil.getTime()).toBe(NOW + 15 * 60_000);
  });

  it("does not decrypt or match a code while the subject is locked", async () => {
    const db = makeStepUpDb();
    let matches = 0;
    let decryptions = 0;

    db.store.step_up_totp_state.push({
      subjectId: "user-1",
      lastAcceptedStep: 0,
      failures: 5,
      lockedUntil: new Date(NOW + 60_000),
      updatedAt: new Date(NOW),
    });

    await expect(
      run(
        makeLayer({
          db,
          decryptSecret: () =>
            Effect.sync(() => {
              decryptions++;
              return new Uint8Array(32);
            }),
          matchCode: () =>
            Effect.sync(() => {
              matches++;
              return null;
            }),
        }),
        (service) => service.verifyTotp("user-1", "000000"),
      ),
    ).resolves.toBe(false);

    expect({ decryptions, matches }).toEqual({ decryptions: 0, matches: 0 });
    expect(db.store.step_up_totp_state[0]).toMatchObject({ failures: 5 });
  });

  it("resets failures on a correct code and still rejects replay of that step", async () => {
    const db = makeStepUpDb();
    let correct = false;
    const layer = makeLayer({
      db,
      matchCode: () => Effect.succeed(correct ? 1 : null),
    });

    for (let attempt = 0; attempt < 4; attempt++)
      await expect(run(layer, (service) => service.verifyTotp("user-1", "000000"))).resolves.toBe(
        false,
      );

    correct = true;
    await expect(run(layer, (service) => service.verifyTotp("user-1", "123456"))).resolves.toBe(
      true,
    );
    expect(db.store.step_up_totp_state[0]).toMatchObject({
      lastAcceptedStep: 1,
      failures: 0,
      lockedUntil: null,
    });

    await expect(run(layer, (service) => service.verifyTotp("user-1", "123456"))).resolves.toBe(
      false,
    );
    expect(db.store.step_up_totp_state[0]).toMatchObject({ lastAcceptedStep: 1, failures: 0 });
  });
});
