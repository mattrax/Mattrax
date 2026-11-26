import { Passkey, Totp } from "@yielded/auth";
import { Effect, Layer, ManagedRuntime } from "effect";
import { MysqlClient } from "@effect/sql-mysql2";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { StepUpService } from "@mattrax/enterprise-domain";
import { stepUpServiceLayer } from "../src/Account/stepUp.ts";
import { effectMysqlOptions, startMysqlFixture } from "./mysql.ts";
import type { MysqlFixture } from "./mysql.ts";

describe.skipIf(!process.env.TEST_MYSQL_URL)("step-up TOTP lockout on disposable MySQL", () => {
  let fixture: MysqlFixture;
  let runtime: ManagedRuntime.ManagedRuntime<StepUpService, never>;
  let matches = 0;

  beforeAll(async () => {
    fixture = (await startMysqlFixture())!;
    const database = MysqlClient.layer(effectMysqlOptions(fixture.connection));
    const db = Db.layer.pipe(Layer.provide(database));
    const totpPersistence = Layer.succeed(Totp.TotpPersistence, {
      snapshot: () =>
        Effect.succeed({
          record: {
            secret: "envelope",
            subjectId: "user-1",
            credentialId: "credential-1",
            revision: "revision-1",
          },
        }),
    } as any);
    const totpCryptography = Layer.succeed(Totp.TotpCryptography, {
      decryptSecret: () => Effect.succeed(new Uint8Array(32).fill(1)),
      matchCode: () =>
        Effect.promise(async () => {
          matches++;
          // Keep every concurrent request inside the admission window. The
          // old read-compute-overwrite implementation loses these increments.
          await new Promise((resolve) => {
            setTimeout(resolve, 25);
          });
          return null;
        }),
    } as any);
    const passkeyCredentials = Layer.succeed(Passkey.PasskeyCredentials, {
      listForSubject: () => Effect.succeed({ credentials: [] }),
    } as any);
    const passkeyPersistence = Layer.succeed(Passkey.PasskeyPersistence, {
      context: () => Effect.succeed(undefined),
    } as any);
    const passkeyProtocol = Layer.succeed(Passkey.PasskeyProtocol, {} as any);

    runtime = ManagedRuntime.make(
      stepUpServiceLayer().pipe(
        Layer.provide(
          Layer.mergeAll(
            db,
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
      ),
    );
  });

  beforeEach(async () => {
    matches = 0;
    await fixture.query("DELETE FROM step_up_totp_state");
  });

  afterAll(async () => {
    await runtime?.dispose();
    await fixture?.dispose();
  });

  it("admits at most five concurrent failures and locks the sixth", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        runtime.runPromise(
          Effect.flatMap(StepUpService, (service) => service.verifyTotp("user-1", "000000")),
        ),
      ),
    );

    expect(results).toEqual([false, false, false, false, false, false]);
    expect(matches).toBe(5);

    const [row] = await fixture.query<RowDataPacket[]>(
      "SELECT failures, locked_until FROM step_up_totp_state WHERE subject_id = ?",
      ["user-1"],
    );
    expect(row.failures).toBe(5);
    expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now());

    await expect(
      runtime.runPromise(
        Effect.flatMap(StepUpService, (service) => service.verifyTotp("user-1", "000000")),
      ),
    ).resolves.toBe(false);
    expect(matches).toBe(5);
  });
});
