import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ScepCaKeyError, openCaPrivateKey, sealCaPrivateKey } from "@mattrax/scep";

interface ScepCaRecord {
  certPem: string;
  /**
   * Either the sealed envelope `{ v: 1, sealed }` or, for files written before
   * sealing was introduced, a plaintext JWK. Reads migrate the plaintext form
   * in place; writes always store the sealed form.
   */
  privateKeyJwk: unknown;
  createdAt: string;
}

export type FsDbOptions = {
  /** Application secret used to seal the SCEP CA private key at rest. */
  readonly authSecret?: string;
};

export class FsDb {
  private dataDir: string;
  private authSecret: string | undefined;

  constructor(dataDir: string, options: FsDbOptions = {}) {
    this.dataDir = dataDir;
    this.authSecret = options.authSecret;
    mkdirSync(dataDir, { recursive: true });
  }

  private caPath(): string {
    return join(this.dataDir, "scep-ca.json");
  }

  private writeCaRecord(record: ScepCaRecord): void {
    const path = this.caPath();
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
  }

  async getCa(): Promise<{ certPem: string; privateKeyJwk: JsonWebKey } | null> {
    let record: ScepCaRecord;
    try {
      record = JSON.parse(readFileSync(this.caPath(), "utf-8")) as ScepCaRecord;
    } catch (error) {
      // Only a missing file means "no CA yet". A partial/corrupt file must not
      // silently generate a new CA and invalidate every issued device cert.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (typeof record !== "object" || record === null) {
      throw new ScepCaKeyError({
        message: "Stored SCEP CA state is invalid",
        reason: "invalid",
      });
    }

    // Fails closed (no secret, wrong secret, corrupted/tampered value) rather
    // than handing back something the caller could mistake for a fresh CA.
    const opened = await openCaPrivateKey(record.privateKeyJwk, this.authSecret);
    if (opened.migrated) {
      this.writeCaRecord({
        ...record,
        privateKeyJwk: opened.migrated,
        createdAt: record.createdAt ?? new Date().toISOString(),
      });
    }
    return { certPem: record.certPem, privateKeyJwk: opened.privateKeyJwk };
  }

  async saveCa(certPem: string, privateKeyJwk: JsonWebKey): Promise<void> {
    const record: ScepCaRecord = {
      certPem,
      privateKeyJwk: await sealCaPrivateKey(this.authSecret, privateKeyJwk),
      createdAt: new Date().toISOString(),
    };
    this.writeCaRecord(record);
  }
}
