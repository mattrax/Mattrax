import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    } catch {
      return null;
    }
  }

  saveCa(certPem: string, privateKeyJwk: JsonWebKey): void {
    const record: ScepCaRecord = {
      certPem,
      privateKeyJwk,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(this.caPath(), JSON.stringify(record, null, 2));
  }
}
