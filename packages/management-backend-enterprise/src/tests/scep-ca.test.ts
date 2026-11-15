import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { exportPrivateKeyJwk, generateCaKeyPair, sealSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { isSealedCaPrivateKey, sealCaPrivateKey } from "@mattrax/scep";
import { ScepRepositoryLive } from "../scep.js";
import {  dbRows, makeDb, tableName, jsonValue } from "./fake-db.js";

const authSecret = "scep-ca-test-secret";

// SAFETY: The fake store implements only the query chains these tests exercise;
// it is not assignable to the full `Db["Service"]` surface.
const makeRepository = (
  db: ReturnType<typeof makeDb>,
  options: { authSecret?: string } = { authSecret },
) => ScepRepositoryLive.make(db as never, options);

const makeJwk = async () => {
  const keyPair = await generateCaKeyPair();

  return exportPrivateKeyJwk(keyPair.privateKey);
};

const seedPlaintextCa = async (jwk: JsonWebKey) => {
  const db = makeDb({
    [tableName(schema.scepCa)]: [
      {
        id: 1,
        certPem: "-----BEGIN CERTIFICATE-----ca",
        privateKeyJwk: jwk,
        createdAt: new Date(),
      },
    ],
  });

  return db;
};

const withoutSecret = async (run: () => Promise<void>) => {
  const previous = process.env.AUTH_SECRET;
  const previousLocal = process.env.MATTRAX_AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  delete process.env.MATTRAX_AUTH_SECRET;

  try {
    await run();
  } finally {
    if (previous !== undefined) process.env.AUTH_SECRET = previous;

    if (previousLocal !== undefined) process.env.MATTRAX_AUTH_SECRET = previousLocal;
  }
};

describe("ScepRepositoryLive CA key protection", () => {
  it("seals a legacy plaintext CA key on read and persists the envelope", async () => {
    const jwk = await makeJwk();
    const db = await seedPlaintextCa(jwk);
    const repository = makeRepository(db);

    const ca = await Effect.runPromise(repository.getCa());
    expect(ca?.privateKeyJwk).toEqual(jwk);

    const [row] = dbRows(db, tableName(schema.scepCa));
    expect(isSealedCaPrivateKey(jsonValue(row!.privateKeyJwk))).toBe(true);
    expect(JSON.stringify(row!.privateKeyJwk)).not.toContain(jwk.d!);
    // The certificate is untouched by migration.
    expect(row!.certPem).toBe("-----BEGIN CERTIFICATE-----ca");
  });

  it("opens an already sealed key", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(authSecret, jwk);

    const db = makeDb({
      [tableName(schema.scepCa)]: [
        { id: 1, certPem: "PEM", privateKeyJwk: sealed, createdAt: new Date() },
      ],
    });

    const repository = makeRepository(db);

    const ca = await Effect.runPromise(repository.getCa());
    expect(ca?.privateKeyJwk).toEqual(jwk);
    expect(dbRows(db, tableName(schema.scepCa))[0]!.privateKeyJwk).toEqual(sealed);
  });

  it("fails closed without a secret and never regenerates the CA", async () => {
    await withoutSecret(async () => {
      const jwk = await makeJwk();
      const db = await seedPlaintextCa(jwk);
      const repository = makeRepository(db, {});

      const error = await Effect.runPromise(
        Effect.flip(repository.getCa()).pipe(Effect.map((cause) => cause)),
      );

      expect(error).toMatchObject({ _tag: "ScepError" as const });
      expect(error.message).toContain("AUTH_SECRET");
      expect(error.message).not.toContain(jwk.d!);

      // The plaintext row is left as-is rather than being overwritten.
      const [row] = dbRows(db, tableName(schema.scepCa));
      expect(row!.privateKeyJwk).toEqual(jwk);
    });
  });

  it("fails closed on a tampered sealed value", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(authSecret, jwk);
    const tampered = { v: 1 as const, sealed: `${sealed.sealed.slice(0, -4)}AAAA` };

    const db = makeDb({
      [tableName(schema.scepCa)]: [
        { id: 1, certPem: "PEM", privateKeyJwk: tampered, createdAt: new Date() },
      ],
    });

    const repository = makeRepository(db);

    const error = await Effect.runPromise(Effect.flip(repository.getCa()));
    expect(error).toMatchObject({ _tag: "ScepError" as const });
    expect(error.message).toContain("Failed to decrypt");
    expect(error.message).not.toContain(jwk.d!);
    expect(dbRows(db, tableName(schema.scepCa))[0]!.privateKeyJwk).toEqual(tampered);
  });

  it("accepts a plaintext value sealed by @mattrax/crypto directly", async () => {
    // Guards against a future change of the envelope payload format: the
    // envelope must still be openable by the shared primitive.
    const jwk = await makeJwk();
    const sealed = { v: 1 as const, sealed: await sealSecret(authSecret, JSON.stringify(jwk)) };

    const db = makeDb({
      [tableName(schema.scepCa)]: [
        { id: 1, certPem: "PEM", privateKeyJwk: sealed, createdAt: new Date() },
      ],
    });

    const repository = makeRepository(db);
    await expect(Effect.runPromise(repository.getCa())).resolves.toMatchObject({
      privateKeyJwk: { kty: "RSA", n: jwk.n },
    });
  });

  it("writes only the sealed envelope on saveCa", async () => {
    const jwk = await makeJwk();
    const db = makeDb();
    const repository = makeRepository(db);

    await Effect.runPromise(repository.saveCa("PEM", jwk));

    const [row] = dbRows(db, tableName(schema.scepCa));
    expect(row!.certPem).toBe("PEM");
    expect(isSealedCaPrivateKey(jsonValue(row!.privateKeyJwk))).toBe(true);
    expect(JSON.stringify(row!.privateKeyJwk)).not.toContain(jwk.d!);

    // And the repository can read its own write back.
    const ca = await Effect.runPromise(repository.getCa());
    expect(ca?.privateKeyJwk).toEqual(jwk);
  });

  it("refuses to save without a secret", async () => {
    await withoutSecret(async () => {
      const jwk = await makeJwk();
      const db = makeDb();
      const repository = makeRepository(db, {});
      const error = await Effect.runPromise(Effect.flip(repository.saveCa("PEM", jwk)));
      expect(error).toMatchObject({ _tag: "ScepError" as const });
      expect(error.message).toContain("AUTH_SECRET");
      expect(dbRows(db, tableName(schema.scepCa))).toHaveLength(0);
    });
  });
});
