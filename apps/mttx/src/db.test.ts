import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportPrivateKeyJwk, generateCaKeyPair } from "@mattrax/crypto";
import { ScepCaKeyError, isSealedCaPrivateKey } from "@mattrax/scep";
import { FsDb } from "./db.js";

const authSecret = "mttx-ca-test-secret";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mattrax-mttx-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const makeJwk = async () => {
  const keyPair = await generateCaKeyPair();
  return exportPrivateKeyJwk(keyPair.privateKey);
};

const caPath = () => join(dataDir, "scep-ca.json");

const readRecord = () => JSON.parse(readFileSync(caPath(), "utf-8"));

describe("FsDb SCEP CA storage", () => {
  it("returns null before any CA exists", async () => {
    await expect(new FsDb(dataDir, { authSecret }).getCa()).resolves.toBeNull();
  });

  it("stores the CA private key sealed and never as plaintext", async () => {
    const jwk = await makeJwk();
    const db = new FsDb(dataDir, { authSecret });
    await db.saveCa("-----BEGIN CERTIFICATE-----ca", jwk);

    const record = readRecord();
    expect(record.certPem).toBe("-----BEGIN CERTIFICATE-----ca");
    expect(isSealedCaPrivateKey(record.privateKeyJwk)).toBe(true);
    expect(readFileSync(caPath(), "utf-8")).not.toContain(jwk.d!);

    const loaded = await new FsDb(dataDir, { authSecret }).getCa();
    expect(loaded).toEqual({
      certPem: "-----BEGIN CERTIFICATE-----ca",
      privateKeyJwk: jwk,
    });
  });

  it("migrates a legacy plaintext file on read", async () => {
    const jwk = await makeJwk();
    writeFileSync(
      caPath(),
      JSON.stringify(
        { certPem: "PEM", privateKeyJwk: jwk, createdAt: "2024-01-01T00:00:00.000Z" },
        null,
        2,
      ),
    );

    const loaded = await new FsDb(dataDir, { authSecret }).getCa();
    expect(loaded?.privateKeyJwk).toEqual(jwk);

    const record = readRecord();
    expect(isSealedCaPrivateKey(record.privateKeyJwk)).toBe(true);
    expect(record.certPem).toBe("PEM");
    expect(record.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(readFileSync(caPath(), "utf-8")).not.toContain(jwk.d!);
  });

  it("fails closed without a secret and leaves the file untouched", async () => {
    const jwk = await makeJwk();
    const plaintext = JSON.stringify({ certPem: "PEM", privateKeyJwk: jwk, createdAt: "x" });
    writeFileSync(caPath(), plaintext);

    const error = await new FsDb(dataDir).getCa().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ScepCaKeyError);
    expect((error as ScepCaKeyError).message).toContain("AUTH_SECRET");
    expect(readFileSync(caPath(), "utf-8")).toBe(plaintext);
    expect((error as ScepCaKeyError).message).not.toContain(jwk.d!);
  });

  it("refuses to save without a secret", async () => {
    const jwk = await makeJwk();
    const error = await new FsDb(dataDir).saveCa("PEM", jwk).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ScepCaKeyError);
    expect(() => readFileSync(caPath(), "utf-8")).toThrow();
  });

  it("fails closed when the sealed file was written with another secret", async () => {
    const jwk = await makeJwk();
    await new FsDb(dataDir, { authSecret: "old-secret" }).saveCa("PEM", jwk);

    const error = await new FsDb(dataDir, { authSecret }).getCa().catch((cause) => cause);
    expect(error).toBeInstanceOf(ScepCaKeyError);
    expect((error as ScepCaKeyError).reason).toBe("decrypt_failed");
  });

  it("does not treat a corrupt file as a missing CA", async () => {
    writeFileSync(caPath(), "{ not json");
    await expect(new FsDb(dataDir, { authSecret }).getCa()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects a structurally invalid CA file", async () => {
    writeFileSync(caPath(), "null");
    await expect(new FsDb(dataDir, { authSecret }).getCa()).rejects.toBeInstanceOf(ScepCaKeyError);
  });
});
