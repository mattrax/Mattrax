import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ScepCaRecord {
  certPem: string;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
}

export class FsDb {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
  }

  private caPath(): string {
    return join(this.dataDir, "scep-ca.json");
  }

  getCa(): { certPem: string; privateKeyJwk: JsonWebKey } | null {
    try {
      const data = readFileSync(this.caPath(), "utf-8");
      const record = JSON.parse(data) as ScepCaRecord;
      return { certPem: record.certPem, privateKeyJwk: record.privateKeyJwk };
    } catch (error) {
      // Only a missing file means "no CA yet". A partial/corrupt file must not
      // silently generate a new CA and invalidate every issued device cert.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  saveCa(certPem: string, privateKeyJwk: JsonWebKey): void {
    const record: ScepCaRecord = {
      certPem,
      privateKeyJwk,
      createdAt: new Date().toISOString(),
    };
    const path = this.caPath();
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
  }
}
