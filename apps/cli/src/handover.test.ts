import { describe, expect, it } from "vitest";
import { sealWithPassphrase } from "@mattrax/crypto";
import { decodeMattraxArchive } from "./handover.ts";

/**
 * Fixed vector documented in docs/manage/devices.md. The envelope uses the
 * production work factor and a random salt/nonce generated once; it is a file
 * fixture, not a deterministic KDF vector, but it proves the shipped command
 * opens what the server writes.
 */
const TEST_VECTOR_PASSPHRASE = "mattrax-test-vector-passphrase";

const TEST_VECTOR = JSON.stringify({
  version: 1,
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600000,
    salt: "FDBLTH8GFKKKV96LErlAxA==",
  },
  cipher: { name: "AES-GCM", iv: "TmbgporKfT9oXc4x" },
  ciphertext:
    "eLaH9yyGPJizYHlwXgvEa2I8Jx6pKlsUe2aMopY/8FCKwwepgplhFqDswBpysIFvHEcc0P56R5YgHyVTX/hI0++4yvIVOuGI4z8LeVc=",
});

describe("handover archive CLI decoding", () => {
  it("opens the documented test vector", async () => {
    const decoded = await decodeMattraxArchive(TEST_VECTOR, TEST_VECTOR_PASSPHRASE);

    expect(decoded).toEqual({
      kind: "handover",
      document: { format: "mattrax.device-handover", version: 1, devices: [] },
    });
  });

  it("rejects a wrong passphrase and a malformed envelope", async () => {
    await expect(decodeMattraxArchive(TEST_VECTOR, "wrong")).rejects.toThrow(
      "The passphrase is incorrect or the archive has been modified",
    );
    await expect(decodeMattraxArchive("not json", TEST_VECTOR_PASSPHRASE)).rejects.toThrow(
      "The file is not a Mattrax JSON archive.",
    );
  });

  it("round-trips a freshly sealed handover document", async () => {
    const document = {
      format: "mattrax.device-handover",
      version: 1,
      devices: [{ serial: "C02XYZ", secretKinds: ["bootstrap_token"] }],
    };
    const envelope = await sealWithPassphrase(TEST_VECTOR_PASSPHRASE, JSON.stringify(document), {
      iterations: 100_000,
    });

    await expect(
      decodeMattraxArchive(JSON.stringify(envelope), TEST_VECTOR_PASSPHRASE),
    ).resolves.toEqual({ kind: "handover", document });
  });
});
