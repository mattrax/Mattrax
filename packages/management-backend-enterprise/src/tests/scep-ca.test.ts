import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { exportPrivateKeyJwk, generateCaKeyPair, sealSecret } from "@mattrax/crypto";
import { schema } from "@mattrax/enterprise-core";
import { isSealedCaPrivateKey, sealCaPrivateKey, type SealedCaPrivateKey } from "@mattrax/scep";
import { ScepRepositoryLive } from "../scep.js";
import { dbRows, makeDb, tableName, jsonValue, type Store } from "./fake-db.js";

const authSecret = "scep-ca-test-secret";

const scope = { organizationId: "tenant-1" };

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
    [tableName(schema.organization)]: [{ id: scope.organizationId, name: "Tenant" }],
    [tableName(schema.scepCa)]: [
      {
        id: 1,
        organizationId: scope.organizationId,
        certPem: "-----BEGIN CERTIFICATE-----ca",
        privateKeyJwk: jwk,
        source: "generated",
        createdAt: new Date(),
        rotatedAt: null,
      },
    ],
  });

  return db;
};

const withOrganization = (jwk: JsonWebKey | null, sealed?: SealedCaPrivateKey) => {
  const initial: Store = {
    [tableName(schema.organization)]: [{ id: scope.organizationId, name: "Tenant" }],
  };

  if (jwk || sealed) {
    initial[tableName(schema.scepCa)] = [
      {
        id: 1,
        organizationId: scope.organizationId,
        certPem: "PEM",
        privateKeyJwk: sealed ?? jwk,
        source: "generated",
        createdAt: new Date(),
        rotatedAt: null,
      },
    ];
  }

  return makeDb(initial);
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

    const ca = await Effect.runPromise(repository.getCa(scope));
    expect(ca?.privateKeyJwk).toEqual(jwk);

    const [row] = dbRows(db, tableName(schema.scepCa));
    expect(row!.organizationId).toBe(scope.organizationId);
    expect(isSealedCaPrivateKey(jsonValue(row!.privateKeyJwk))).toBe(true);
    expect(JSON.stringify(row!.privateKeyJwk)).not.toContain(jwk.d!);
    // The certificate is untouched by migration.
    expect(row!.certPem).toBe("-----BEGIN CERTIFICATE-----ca");
  });

  it("opens an already sealed key", async () => {
    const jwk = await makeJwk();
    const sealed = await sealCaPrivateKey(authSecret, jwk);
    const db = withOrganization(null, sealed);
    const repository = makeRepository(db);

    const ca = await Effect.runPromise(repository.getCa(scope));
    expect(ca?.privateKeyJwk).toEqual(jwk);
    expect(dbRows(db, tableName(schema.scepCa))[0]!.privateKeyJwk).toEqual(sealed);
  });

  it("fails closed without a secret and never regenerates the CA", async () => {
    await withoutSecret(async () => {
      const jwk = await makeJwk();
      const db = await seedPlaintextCa(jwk);
      const repository = makeRepository(db, {});

      const error = await Effect.runPromise(
        Effect.flip(repository.getCa(scope)).pipe(Effect.map((cause) => cause)),
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
    const db = withOrganization(null, tampered);
    const repository = makeRepository(db);

    const error = await Effect.runPromise(Effect.flip(repository.getCa(scope)));
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
    const db = withOrganization(null, sealed);
    const repository = makeRepository(db);

    await expect(Effect.runPromise(repository.getCa(scope))).resolves.toMatchObject({
      privateKeyJwk: { kty: "RSA", n: jwk.n },
    });
  });

  it("returns null when the tenant has no CA but exists", async () => {
    const db = withOrganization(null);
    const repository = makeRepository(db);

    await expect(Effect.runPromise(repository.getCa(scope))).resolves.toBeNull();
  });

  it("reports an unknown tenant instead of bootstrapping a CA", async () => {
    const repository = makeRepository(makeDb());

    const error = await Effect.runPromise(Effect.flip(repository.getCa(scope)));

    expect(error._tag).toBe("ScepError");
    expect(error.reason).toBe("unknown_tenant");
  });

  it("writes only the sealed envelope on saveCa and reads back the stored CA", async () => {
    const jwk = await makeJwk();
    const db = withOrganization(null);
    const repository = makeRepository(db);

    const saved = await Effect.runPromise(
      repository.saveCa(scope, { certPem: "PEM", privateKeyJwk: jwk }),
    );

    expect(saved.privateKeyJwk).toEqual(jwk);

    const [row] = dbRows(db, tableName(schema.scepCa));
    expect(row!.certPem).toBe("PEM");
    expect(row!.organizationId).toBe(scope.organizationId);
    expect(isSealedCaPrivateKey(jsonValue(row!.privateKeyJwk))).toBe(true);
    expect(JSON.stringify(row!.privateKeyJwk)).not.toContain(jwk.d!);

    // And the repository can read its own write back.
    const ca = await Effect.runPromise(repository.getCa(scope));
    expect(ca?.privateKeyJwk).toEqual(jwk);
  });

  it("refuses to save without a secret", async () => {
    await withoutSecret(async () => {
      const jwk = await makeJwk();
      const db = withOrganization(null);
      const repository = makeRepository(db, {});

      const error = await Effect.runPromise(
        Effect.flip(repository.saveCa(scope, { certPem: "PEM", privateKeyJwk: jwk })),
      );

      expect(error).toMatchObject({ _tag: "ScepError" as const });
      expect(error.message).toContain("AUTH_SECRET");
      expect(dbRows(db, tableName(schema.scepCa))).toHaveLength(0);
    });
  });

  it("replaces only the named tenant's CA", async () => {
    const jwk = await makeJwk();
    const replacement = await makeJwk();

    const db = makeDb({
      [tableName(schema.organization)]: [
        { id: "tenant-1", name: "One" },
        { id: "tenant-2", name: "Two" },
      ],
      [tableName(schema.scepCa)]: [
        {
          id: 1,
          organizationId: "tenant-1",
          certPem: "PEM-1",
          privateKeyJwk: await sealCaPrivateKey(authSecret, jwk),
          source: "generated",
          createdAt: new Date(),
          rotatedAt: null,
        },
        {
          id: 2,
          organizationId: "tenant-2",
          certPem: "PEM-2",
          privateKeyJwk: await sealCaPrivateKey(authSecret, replacement),
          source: "generated",
          createdAt: new Date(),
          rotatedAt: null,
        },
      ],
    });

    const repository = makeRepository(db);

    const rotated = await Effect.runPromise(
      repository.replaceCa(scope, {
        certPem: "PEM-new",
        privateKeyJwk: replacement,
        source: "imported",
      }),
    );

    expect(rotated).toMatchObject({ certPem: "PEM-new" });
    const rows = dbRows(db, tableName(schema.scepCa));
    const tenantOne = rows.find((row) => row.organizationId === "tenant-1")!;
    const tenantTwo = rows.find((row) => row.organizationId === "tenant-2")!;

    expect(tenantOne.certPem).toBe("PEM-new");
    expect(tenantOne.source).toBe("imported");
    expect(tenantOne.rotatedAt).toBeInstanceOf(Date);
    // The other tenant's CA is untouched.
    expect(tenantTwo.certPem).toBe("PEM-2");
  });
});
