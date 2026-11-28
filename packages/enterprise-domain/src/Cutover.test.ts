import { TenantId, DeploymentId } from "@mattrax/crypto";
import { Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import type { CutoverPayload } from "./Cutover.js";
import {
  CUTOVER_FORMAT,
  CUTOVER_KDF_ITERATIONS,
  CUTOVER_MAX_ARCHIVE_BYTES,
  CutoverArchiveError,
  CutoverEnvelope,
  decodeCutoverArchive,
  decodeCutoverEnvelope,
  deriveDeploymentId,
  encodeCutoverArchive,
  normalizeOrigin,
  originHostname,
  selectedCutoverSections,
  sha256Text,
} from "./Cutover.js";

const iterations = 10_000;

const source = {
  tenantId: TenantId.fromParam("tn_tenant-1"),
  slug: "acme",
  name: "Acme",
  origin: "https://mdm.example.com",
  deploymentId: DeploymentId.fromParam("dep_dp_source"),
};

const payload = (): CutoverPayload => ({
  version: 1,
  exportedAt: "2026-11-20T00:00:00.000Z",
  source,
  sections: ["configuration", "members", "devices", "scepCa", "audit"],
  configuration: {
    version: 1,
    exportedAt: "2026-11-20T00:00:00.000Z",
    tenant: { name: "Acme", slug: "acme" },
    members: [],
    groups: [],
    policies: [],
    applications: [],
    preRegistrations: [],
    scepCertificates: [],
  },
  members: [{ email: "owner@example.com", role: "owner" }],
  invitations: [],
  devices: [
    {
      key: "device-1",
      name: "Reception Mac",
      serial: "C02TEST",
      platform: "apple",
      status: "enrolled",
      enrolledAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-11-19T00:00:00.000Z",
      dmIdentifier: "00008030-000000000000000E",
      apple: {
        token: "PUSH-TOKEN-SECRET",
        pushMagic: "PUSH-MAGIC-SECRET",
        topic: "com.apple.mgmt.External.acme",
      },
      secrets: [{ kind: "filevault_recovery_key", value: "RECOVERY-SECRET", format: "plaintext" }],
    },
  ],
  escrowKey: {
    certificatePem: "ESCROW-CERT-SECRET",
    privateKeyPem: "ESCROW-KEY-SECRET",
    certificateFingerprintSha256: "f".repeat(64),
    source: "generated",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  scepCa: {
    certPem: "CA-CERT-SECRET",
    privateKeyPem: "CA-KEY-SECRET",
    source: "generated",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  scepTrustAnchors: [],
  scepCertificates: [
    {
      serial: "cert-1",
      deviceKey: "device-1",
      notAfter: "2027-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  audit: [],
  needsReissue: [],
});

const reason = async <A>(run: () => Promise<A>): Promise<CutoverArchiveError["reason"]> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CutoverArchiveError) return error.reason;

    throw error;
  }

  throw new Error("expected the archive operation to fail");
};

describe("cutover archive", () => {
  // The archive is read only; seal it once for the whole file.
  let archive: Awaited<ReturnType<typeof encodeCutoverArchive>>;

  beforeAll(async () => {
    archive = await encodeCutoverArchive({
      payload: payload(),
      passphrase: "correct horse battery staple",
      iterations,
    });
  });

  it("round-trips an encrypted payload", async () => {
    const encoded = archive;

    const decoded = await decodeCutoverArchive({
      archive: encoded.archive,
      passphrase: "correct horse battery staple",
    });

    expect(decoded.payload).toEqual(payload());
    expect(decoded.manifest.counts.devices).toBe(1);
    expect(decoded.manifest.counts.deviceSecrets).toBe(1);
    expect(decoded.manifest.counts.certificates).toBe(1);
    expect(decoded.manifest.source).toEqual(source);
    expect(encoded.envelope.kdf.iterations).toBe(iterations);
  });

  it("never puts secrets in the plaintext manifest", async () => {
    const encoded = archive;

    // SAFETY: the encoder wrote this envelope; the test reads the plaintext
    // manifest back to prove it carries no secrets.
    const envelope = JSON.parse(encoded.archive) as { manifest: unknown; payload: string };
    const manifest = JSON.stringify(envelope.manifest);

    for (const secret of [
      "PUSH-TOKEN-SECRET",
      "PUSH-MAGIC-SECRET",
      "RECOVERY-SECRET",
      "CA-KEY-SECRET",
      "CA-CERT-SECRET",
      "ESCROW-KEY-SECRET",
      "correct horse battery staple",
    ]) {
      expect(manifest).not.toContain(secret);
      // The ciphertext is base64, so the same check must hold for the file.
      expect(encoded.archive).not.toContain(secret);
    }

    expect(Schema.decodeUnknownSync(CutoverEnvelope)(JSON.parse(encoded.archive))).toBeTruthy();
  });

  it("reports a wrong passphrase without leaking key material", async () => {
    const encoded = archive;

    const failure = await (async () => {
      try {
        await decodeCutoverArchive({ archive: encoded.archive, passphrase: "not the passphrase" });
      } catch (error) {
        // SAFETY: the decoder only throws CutoverArchiveError for a wrong key.
        return error as CutoverArchiveError;
      }
    })();

    expect(failure?.reason).toBe("wrong_passphrase");
    expect(failure?.message).not.toContain("correct horse");
  });

  it("rejects an edited ciphertext", async () => {
    const envelope = JSON.parse(archive.archive) as {
      payload: string;
      manifest: { payloadSha256: string; ciphertextSha256: string };
    };
    const index = Math.floor(envelope.payload.length / 2);
    const flipped =
      envelope.payload.slice(0, index) +
      (envelope.payload[index] === "A" ? "B" : "A") +
      envelope.payload.slice(index + 1);

    expect(
      await reason(() =>
        decodeCutoverArchive({
          archive: JSON.stringify({ ...envelope, payload: flipped }),
          passphrase: "correct horse battery staple",
        }),
      ),
    ).toBe("tampered");
  });

  it("rejects an edited manifest", async () => {
    const envelope = JSON.parse(archive.archive) as {
      manifest: { payloadSha256: string };
    };
    const edited = JSON.stringify({
      ...envelope,
      manifest: { ...envelope.manifest, payloadSha256: "0".repeat(64) },
    });

    expect(
      await reason(() =>
        decodeCutoverArchive({ archive: edited, passphrase: "correct horse battery staple" }),
      ),
    ).toBe("tampered");
  });

  it("rejects an envelope with a different format", async () => {
    const envelope = JSON.parse(archive.archive) as { format: string };

    await expect(
      reason(() =>
        Promise.resolve(decodeCutoverEnvelope(JSON.stringify({ ...envelope, format: "other" }))),
      ),
    ).resolves.toBe("invalid_archive");
  });

  it("rejects an unsupported envelope version", async () => {
    const envelope = JSON.parse(archive.archive) as { version: number };

    await expect(
      reason(() =>
        Promise.resolve(decodeCutoverEnvelope(JSON.stringify({ ...envelope, version: 2 }))),
      ),
    ).resolves.toBe("unsupported_version");
  });

  it("declares the documented archive format", () => {
    expect(CUTOVER_FORMAT).toBe("mattrax.cutover");
  });

  it("refuses a short passphrase", async () => {
    expect(
      await reason(() => encodeCutoverArchive({ payload: payload(), passphrase: "short" })),
    ).toBe("invalid_passphrase");
  });

  it("refuses an unsafe encoding work factor", async () => {
    expect(
      await reason(() =>
        encodeCutoverArchive({
          payload: payload(),
          passphrase: "correct horse battery staple",
          iterations: 1,
        }),
      ),
    ).toBe("invalid_archive");
  });

  it("rejects an envelope that claims an unsafe work factor", async () => {
    const encoded = archive;

    // SAFETY: reading back the envelope this test just encoded.
    const envelope = JSON.parse(encoded.archive) as {
      kdf: { iterations: number };
    };

    expect(
      await reason(() =>
        Promise.resolve(
          decodeCutoverEnvelope(
            JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, iterations: 1 } }),
          ),
        ),
      ),
    ).toBe("invalid_archive");
  });

  it("bounds the archive size", async () => {
    expect(CUTOVER_MAX_ARCHIVE_BYTES).toBe(32 * 1024 * 1024);

    const oversized = "x".repeat(CUTOVER_MAX_ARCHIVE_BYTES + 1);

    expect(await reason(() => Promise.resolve(decodeCutoverEnvelope(oversized)))).toBe("too_large");
  });
});

describe("cutover sections", () => {
  it("always includes configuration and defaults credentials on", () => {
    expect(selectedCutoverSections(undefined)).toEqual([
      "configuration",
      "members",
      "devices",
      "scepCa",
    ]);
  });

  it("honours explicit toggles", () => {
    expect(
      selectedCutoverSections({
        members: false,
        devices: false,
        scepCa: false,
        audit: true,
      }),
    ).toEqual(["configuration", "audit"]);
  });
});

describe("deployment identity", () => {
  it("is stable for an origin and different for another hostname", async () => {
    const first = await deriveDeploymentId({ origin: "https://a.example.com" });

    const again = await deriveDeploymentId({ origin: "https://a.example.com/" });

    const other = await deriveDeploymentId({ origin: "https://b.example.com" });

    expect(first).toBe(again);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^dp_[0-9a-f]{64}$/);
    expect(first).toBe(
      `dp_${await sha256Text("mattrax.deployment.v1\u0000https://a.example.com")}`,
    );
  });

  it("prefers an explicit id and normalises origins", async () => {
    expect(await deriveDeploymentId({ configured: "self-hosted-eu", origin: "https://x" })).toBe(
      "self-hosted-eu",
    );
    expect(normalizeOrigin("https://MDM.example.com/")).toBe("https://mdm.example.com");
    expect(originHostname("https://MDM.example.com/path")).toBe("mdm.example.com");
  });
});

describe("cutover archive defaults", () => {
  it("uses the production work factor by default", async () => {
    // Kept as a constant assertion: actually running 600k iterations in every
    // test would slow the suite without testing more logic than the 1k case.
    expect(CUTOVER_KDF_ITERATIONS).toBe(600_000);
  });
});
