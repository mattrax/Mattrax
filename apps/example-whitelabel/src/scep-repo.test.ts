import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  ScepRepository,
  exportPrivateKeyJwk,
  generateCaKeyPair,
  isSealedCaPrivateKey,
} from "@mattrax/scep";
import { ScepRepositoryD1 } from "./scep-repo.js";

const authSecret = "d1-ca-test-secret";

type CaRow = { cert_pem: string; private_key_jwk: string };

/** Minimal stand-in for the D1 binding used by {@link ScepRepositoryD1}. */
class FakeD1 {
  row: CaRow | undefined;
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];

  prepare(sql: string) {
    const statement = {
      params: [] as unknown[],
      bind: (...params: unknown[]) => {
        statement.params = params;
        return statement;
      },
      first: async <T>() => {
        this.statements.push({ sql, params: statement.params });
        return (this.row ?? null) as T | null;
      },
      run: async () => {
        this.statements.push({ sql, params: statement.params });
        if (/^INSERT/i.test(sql.trim())) {
          this.row = {
            cert_pem: String(statement.params[0]),
            private_key_jwk: String(statement.params[1]),
          };
        } else if (/^UPDATE/i.test(sql.trim())) {
          if (this.row) this.row.private_key_jwk = String(statement.params[0]);
        }
        return { success: true };
      },
    };
    return statement;
  }
}

const makeJwk = async () => {
  const keyPair = await Effect.runPromise(generateCaKeyPair());
  return Effect.runPromise(exportPrivateKeyJwk(keyPair.privateKey));
};

const getCa = (db: FakeD1, options: { authSecret?: string } = { authSecret }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* ScepRepository;
      return yield* repository.getCa();
    }).pipe(Effect.provide(ScepRepositoryD1(db as unknown as D1Database, options))),
  );

const saveCa = (db: FakeD1, jwk: JsonWebKey, options: { authSecret?: string } = { authSecret }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* ScepRepository;
      return yield* repository.saveCa("PEM", jwk);
    }).pipe(Effect.provide(ScepRepositoryD1(db as unknown as D1Database, options))),
  );

describe("ScepRepositoryD1 CA key protection", () => {
  it("returns null when no CA row exists", async () => {
    await expect(getCa(new FakeD1())).resolves.toBeNull();
  });

  it("stores the CA key sealed", async () => {
    const jwk = await makeJwk();
    const db = new FakeD1();
    await saveCa(db, jwk);

    expect(isSealedCaPrivateKey(JSON.parse(db.row!.private_key_jwk))).toBe(true);
    expect(db.row!.private_key_jwk).not.toContain(jwk.d!);
    await expect(getCa(db)).resolves.toEqual({ certPem: "PEM", privateKeyJwk: jwk });
  });

  it("lazy-migrates a legacy plaintext row", async () => {
    const jwk = await makeJwk();
    const db = new FakeD1();
    db.row = { cert_pem: "PEM", private_key_jwk: JSON.stringify(jwk) };

    await expect(getCa(db)).resolves.toEqual({ certPem: "PEM", privateKeyJwk: jwk });
    expect(db.statements.some(({ sql }) => /^UPDATE/i.test(sql))).toBe(true);
    expect(isSealedCaPrivateKey(JSON.parse(db.row.private_key_jwk))).toBe(true);
    expect(db.row.private_key_jwk).not.toContain(jwk.d!);
  });

  it("fails closed without a secret and does not rewrite the row", async () => {
    const jwk = await makeJwk();
    const db = new FakeD1();
    const plaintext = JSON.stringify(jwk);
    db.row = { cert_pem: "PEM", private_key_jwk: plaintext };

    const error = await getCa(db, {}).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ _tag: "ScepError" });
    expect((error as { message: string }).message).toContain("AUTH_SECRET");
    expect((error as { message: string }).message).not.toContain(jwk.d!);
    expect(db.row.private_key_jwk).toBe(plaintext);
    expect(db.statements.some(({ sql }) => /^UPDATE/i.test(sql))).toBe(false);
  });

  it("fails closed when the sealed value is corrupted", async () => {
    const jwk = await makeJwk();
    const db = new FakeD1();
    await saveCa(db, jwk);
    const sealed = JSON.parse(db.row!.private_key_jwk) as { v: number; sealed: string };
    db.row!.private_key_jwk = JSON.stringify({
      ...sealed,
      v: 1,
      sealed: `${sealed.sealed.slice(0, -4)}AAAA`,
    });

    const error = await getCa(db).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ _tag: "ScepError" });
    expect((error as { message: string }).message).toContain("Failed to decrypt");
    expect((error as { message: string }).message).not.toContain(jwk.d!);
  });

  it("does not have an unsealed storage path", async () => {
    const jwk = await makeJwk();
    const db = new FakeD1();
    const error = await saveCa(db, jwk, {}).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ _tag: "ScepError" });
    expect((error as { message: string }).message).toContain("AUTH_SECRET");
    expect(db.row).toBeUndefined();
    expect(db.statements).toHaveLength(0);
  });
});
