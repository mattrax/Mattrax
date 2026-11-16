import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as pkijs from "pkijs";
import { generateScepCa, sealCaPrivateKey, describeScepCa } from "@mattrax/scep";
import {
  loadScepCaState,
  loadTrustedScepCaCertificates,
  purgeExpiredScepCaTrust,
  rotateDueScepCas,
  scepCaStateFromRows,
} from "../src/scepLifecycle.js";
import { makeDb, runEffect } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const authSecret = "scep-lifecycle-test-secret";
const now = new Date("2026-11-10T12:00:00.000Z");
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);

const makeCa = async (options: { lifetimeDays?: number; generatedAt?: Date } = {}) => {
  const ca = await Effect.runPromise(
    generateScepCa("org-a", {
      lifetimeDays: options.lifetimeDays ?? 365,
      now: options.generatedAt ?? now,
    }),
  );

  const description = await Effect.runPromise(describeScepCa(ca.certPem));
  const sealed = await sealCaPrivateKey(authSecret, ca.privateKeyJwk);

  return { ca, description, sealed };
};

const caRow = (input: {
  ca: { certPem: string; privateKeyJwk: JsonWebKey };
  sealed: unknown;
  createdAt?: Date;
}) => ({
  id: 1,
  organizationId: "org-a",
  certPem: input.ca.certPem,
  privateKeyJwk: input.sealed,
  source: "generated" as const,
  createdAt: input.createdAt ?? now,
  rotatedAt: null,
});

describe("scepCaStateFromRows", () => {
  const description = {
    commonName: "Mattrax SCEP CA",
    fingerprintSha256: "a".repeat(64),
    serialNumber: "1",
    notBefore: daysFromNow(-1000),
    notAfter: daysFromNow(900),
  };

  it("counts identities per issuing CA and flags untrusted or unattributed rows", () => {
    const state = scepCaStateFromRows({
      current: { source: "generated", createdAt: now, rotatedAt: null },
      description,
      trust: [
        {
          fingerprintSha256: "b".repeat(64),
          source: "generated",
          retiredAt: daysFromNow(-10),
          trustUntil: daysFromNow(200),
        },
      ],
      retiredNotAfter: new Map([["b".repeat(64), daysFromNow(200)]]),
      identities: [
        { notAfter: daysFromNow(100), caFingerprintSha256: "a".repeat(64) },
        { notAfter: daysFromNow(100), caFingerprintSha256: "b".repeat(64) },
        { notAfter: daysFromNow(100), caFingerprintSha256: "b".repeat(64) },
        // Expired and revoked rows are history, not live overlap.
        { notAfter: daysFromNow(-1), caFingerprintSha256: "b".repeat(64) },
        { notAfter: daysFromNow(100), revokedAt: now, caFingerprintSha256: "a".repeat(64) },
        // Legacy row from before issuing-CA attribution existed.
        { notAfter: daysFromNow(100), caFingerprintSha256: null },
        // Issued by a CA that is no longer trusted at all.
        { notAfter: daysFromNow(100), caFingerprintSha256: "c".repeat(64) },
      ],
      now,
    });

    expect(state.configured).toBe(true);
    expect(state.health).toMatchObject({ rotationDue: false, level: "ok" });
    expect(state.retiring).toEqual([
      expect.objectContaining({
        fingerprintSha256: "b".repeat(64),
        identities: 2,
        daysUntilUntrusted: 200,
      }),
    ]);
    expect(state.unattributedIdentities).toBe(1);
    expect(state.untrustedIdentities).toBe(1);
  });

  it("reports a missing CA without guessing", () => {
    expect(
      scepCaStateFromRows({
        current: null,
        description: null,
        trust: [],
        retiredNotAfter: new Map(),
        identities: [],
        now,
      }),
    ).toMatchObject({
      configured: false,
      health: null,
      source: null,
      fingerprintSha256: null,
      retiring: [],
    });
  });
});

describe("loadScepCaState", () => {
  it("reads the current CA and its retirement overlap for one tenant", async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-a", name: "Acme" }, { id: "org-b", name: "Beta" });

    const current = await makeCa({ lifetimeDays: 1000 });
    const retired = await makeCa({ lifetimeDays: 500 });

    db.store.scep_ca.push(caRow({ ca: current.ca, sealed: current.sealed }));
    db.store.scep_ca.push({
      ...caRow({ ca: retired.ca, sealed: retired.sealed }),
      id: 2,
      organizationId: "org-b",
    });
    db.store.scep_ca_trust.push({
      id: "trust-1",
      organizationId: "org-a",
      certPem: retired.ca.certPem,
      fingerprintSha256: retired.description.fingerprintSha256,
      source: "generated",
      retiredAt: daysFromNow(-180),
      trustUntil: retired.description.notAfter,
      createdAt: daysFromNow(-180),
    });
    db.store.scep_issued_certificate.push(
      {
        serial: "s1",
        organizationId: "org-a",
        deviceId: "d1",
        caFingerprintSha256: retired.description.fingerprintSha256,
        notAfter: daysFromNow(20),
        revokedAt: null,
        createdAt: now,
      },
      {
        serial: "s2",
        organizationId: "org-b",
        deviceId: "d2",
        caFingerprintSha256: current.description.fingerprintSha256,
        notAfter: daysFromNow(20),
        revokedAt: null,
        createdAt: now,
      },
    );

    const state = await runEffect(loadScepCaState(db, "org-a", now));

    expect(state).toMatchObject({
      configured: true,
      fingerprintSha256: current.description.fingerprintSha256,
      untrustedIdentities: 0,
    });
    expect(state.retiring).toHaveLength(1);
    expect(state.retiring[0]).toMatchObject({
      fingerprintSha256: retired.description.fingerprintSha256,
      identities: 1,
    });

    // Tenant scoping: org-b's identity is not counted against org-a.
    expect(state.retiring[0]!.identities).toBe(1);
  });
});

describe("rotateDueScepCas", () => {
  const seedDueCa = async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-a", name: "Acme" });

    // Written 300 days ago with a 500-day lifetime: inside the 400-day
    // rotation window, but not yet expired.
    const previous = await makeCa({
      generatedAt: new Date(now.getTime() - 300 * DAY),
      lifetimeDays: 500,
    });

    db.store.scep_ca.push(
      caRow({
        ca: previous.ca,
        sealed: previous.sealed,
        createdAt: new Date(now.getTime() - 300 * DAY),
      }),
    );
    db.store.scep_issued_certificate.push({
      serial: "s1",
      organizationId: "org-a",
      deviceId: "d1",
      caFingerprintSha256: previous.description.fingerprintSha256,
      notAfter: daysFromNow(30),
      revokedAt: null,
      createdAt: now,
    });

    return { db, previous };
  };

  it("rotates a due CA, keeps the old anchor and never revokes identities", async () => {
    const { db, previous } = await seedDueCa();

    const result = await runEffect(rotateDueScepCas(db, { now, authSecret, lifetimeDays: 1000 }));

    expect(result).toEqual({ checked: 1, rotated: 1, failed: 0 });

    expect(db.store.scep_ca).toHaveLength(1);

    // SAFETY: the row was seeded by this test with a string certificate.
    const currentCert = db.store.scep_ca[0]!.certPem as string;
    expect(currentCert).not.toBe(previous.ca.certPem);

    const currentDescription = await runEffect(describeScepCa(currentCert));

    expect(db.store.scep_ca_trust).toHaveLength(1);
    expect(db.store.scep_ca_trust[0]).toMatchObject({
      organizationId: "org-a",
      certPem: previous.ca.certPem,
      fingerprintSha256: previous.description.fingerprintSha256,
      retiredAt: now,
      // The overlap runs until the retired CA's own expiry.
      trustUntil: previous.description.notAfter,
    });

    // Identity is untouched: rotation is not revocation.
    expect(db.store.scep_issued_certificate[0]!.revokedAt).toBeNull();

    const audit = db.store.audit_log.find((row: any) => row.action === "scep_ca.auto_rotated");

    expect(audit).toMatchObject({
      organizationId: "org-a",
      actorEmail: "system",
      targetType: "scep_ca",
      metadata: {
        reason: "rotation_due",
        previousFingerprintSha256: previous.description.fingerprintSha256,
        fingerprintSha256: currentDescription.fingerprintSha256,
        overlapUntil: previous.description.notAfter.toISOString(),
      },
    });

    // Both CAs verify identities throughout the overlap; the new one signs.
    await expect(runEffect(loadTrustedScepCaCertificates(db, "org-a", now))).resolves.toEqual([
      currentCert,
      previous.ca.certPem,
    ]);

    const state = await runEffect(loadScepCaState(db, "org-a", now));
    expect(state.retiring[0]).toMatchObject({
      fingerprintSha256: previous.description.fingerprintSha256,
      identities: 1,
    });

    // A second sweep on the same day has nothing to rotate.
    await expect(
      runEffect(rotateDueScepCas(db, { now, authSecret, lifetimeDays: 1000 })),
    ).resolves.toEqual({ checked: 1, rotated: 0, failed: 0 });

    // The previous CA stays an anchor until it expires.
    await expect(
      runEffect(
        loadTrustedScepCaCertificates(
          db,
          "org-a",
          new Date(previous.description.notAfter.getTime() + 1),
        ),
      ),
    ).resolves.toEqual([currentCert]);
  });

  it("leaves a CA alone while it is outside the rotation window", async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-a", name: "Acme" });
    const fresh = await makeCa({ lifetimeDays: 1000 });
    db.store.scep_ca.push(caRow({ ca: fresh.ca, sealed: fresh.sealed }));

    await expect(runEffect(rotateDueScepCas(db, { now, authSecret }))).resolves.toEqual({
      checked: 1,
      rotated: 0,
      failed: 0,
    });
    expect(db.store.scep_ca[0]!.certPem).toBe(fresh.ca.certPem);
    expect(db.store.scep_ca_trust).toHaveLength(0);
  });

  it("reports a failed rotation without touching the CA", async () => {
    const { db, previous } = await seedDueCa();

    await expect(
      // No secret: the sealed key cannot be opened, so rotation must fail
      // loudly rather than replacing a CA it could not read.
      runEffect(rotateDueScepCas(db, { now, authSecret: undefined })),
    ).resolves.toEqual({ checked: 1, rotated: 0, failed: 1 });

    expect(db.store.scep_ca[0]!.certPem).toBe(previous.ca.certPem);
    expect(db.store.scep_ca_trust).toHaveLength(0);

    // The failure is auditable once per day, not just a log line.
    const failures = db.store.audit_log.filter(
      (row: any) => row.action === "scep_ca.rotation_failed",
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      organizationId: "org-a",
      actorEmail: "system",
      metadata: { reason: "auth_secret_missing" },
    });

    // A second sweep on the same day does not duplicate the record.
    await runEffect(rotateDueScepCas(db, { now, authSecret: undefined }));
    expect(
      db.store.audit_log.filter((row: any) => row.action === "scep_ca.rotation_failed"),
    ).toHaveLength(1);
  });
});

describe("purgeExpiredScepCaTrust", () => {
  it("drops anchors whose trust window has closed and keeps live ones", async () => {
    const db = makeDb();
    const expired = await makeCa({ lifetimeDays: 10 });
    const live = await makeCa({ lifetimeDays: 300 });

    db.store.scep_ca_trust.push(
      {
        id: "old",
        organizationId: "org-a",
        certPem: expired.ca.certPem,
        fingerprintSha256: expired.description.fingerprintSha256,
        source: "generated",
        retiredAt: daysFromNow(-400),
        trustUntil: daysFromNow(-1),
        createdAt: daysFromNow(-400),
      },
      {
        id: "live",
        organizationId: "org-a",
        certPem: live.ca.certPem,
        fingerprintSha256: live.description.fingerprintSha256,
        source: "generated",
        retiredAt: daysFromNow(-10),
        trustUntil: daysFromNow(100),
        createdAt: daysFromNow(-10),
      },
    );

    await expect(runEffect(purgeExpiredScepCaTrust(db, now))).resolves.toBe(1);
    expect(db.store.scep_ca_trust.map((row: any) => row.id)).toEqual(["live"]);
  });
});
