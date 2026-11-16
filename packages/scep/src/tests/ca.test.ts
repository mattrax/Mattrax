import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as pkijs from "pkijs";
import {
  SCEP_CA_CRITICAL_DAYS,
  SCEP_CA_LIFETIME_DAYS,
  SCEP_CA_ROTATION_LEAD_DAYS,
  SCEP_CA_WARNING_DAYS,
  caDaysUntilExpiry,
  describeScepCa,
  generateScepCa,
  openScepCa,
  rotateScepCa,
  scepCaHealth,
} from "../ca.js";
import { pemToCert } from "../pkcs7.js";
import { ScepRepository, type ScepCaScope, type ScepStoredCa } from "../repository.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const scope: ScepCaScope = { organizationId: "tenant-ca" };

// SAFETY: tests provide every requirement before running, so no requirements
// remain at the boundary.
const run = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(effect as Effect.Effect<A, never>);

const repositoryFrom = (
  overrides: Partial<Parameters<typeof ScepRepository.of>[0]>,
): ScepRepository["Service"] =>
  ScepRepository.of({
    getCa: () => Effect.succeed(null),
    saveCa: (_scope, ca) => Effect.succeed(ca),
    replaceCa: (_scope, ca) => Effect.succeed(ca),
    rotateCa: (_scope, ca) => Effect.succeed(ca),
    trustedCaCertificates: () => Effect.succeed([]),
    listRetiredCa: () => Effect.succeed([]),
    authenticatePkcsReq: () => Effect.void,
    ...overrides,
  });

describe("SCEP CA lifetime", () => {
  it("mints a five-year CA, long enough to avoid churn but far from perpetual", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const stored = await run(generateScepCa(scope.organizationId, { now }));
    const description = await run(describeScepCa(stored.certPem));

    expect(SCEP_CA_LIFETIME_DAYS).toBe(5 * 365);
    expect(description.notBefore.toISOString()).toBe(now.toISOString());
    expect(description.notAfter.getTime()).toBe(now.getTime() + SCEP_CA_LIFETIME_DAYS * DAY);
    // The certificate is self-describing: the tenant id is in the OU.
    const certificate = pemToCert(stored.certPem);
    const ou = certificate.subject.typesAndValues.find(
      (attribute) => attribute.type === "2.5.4.11",
    );
    expect(ou).toBeDefined();
    expect(description.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(description.serialNumber).toBe("1");
  });

  it("accepts an injected lifetime for tests and operators", async () => {
    const stored = await run(generateScepCa(scope.organizationId, { lifetimeDays: 30 }));
    const description = await run(describeScepCa(stored.certPem));

    expect(caDaysUntilExpiry(description.notAfter, new Date())).toBe(30);
  });
});

describe("scepCaHealth", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("classifies expiry and the rotation window", () => {
    const healthy = scepCaHealth(new Date(now.getTime() + 4 * 365 * DAY), now);
    expect(healthy).toMatchObject({ rotationDue: false, level: "ok" });
    expect(healthy.rotationDueAt.getTime()).toBe(
      now.getTime() + (4 * 365 - SCEP_CA_ROTATION_LEAD_DAYS) * DAY,
    );

    const due = scepCaHealth(new Date(now.getTime() + 200 * DAY), now);
    expect(due.rotationDue).toBe(true);
    expect(due.level).toBe("ok");

    expect(scepCaHealth(new Date(now.getTime() + SCEP_CA_WARNING_DAYS * DAY), now).level).toBe(
      "warning",
    );
    expect(scepCaHealth(new Date(now.getTime() + SCEP_CA_CRITICAL_DAYS * DAY), now).level).toBe(
      "critical",
    );
    expect(scepCaHealth(new Date(now.getTime() - DAY), now)).toMatchObject({
      level: "expired",
      rotationDue: true,
    });
  });

  it("rounds days up so a partial day is never reported as zero", () => {
    expect(caDaysUntilExpiry(new Date(now.getTime() + DAY + 1), now)).toBe(2);
    expect(caDaysUntilExpiry(new Date(now.getTime() + DAY), now)).toBe(1);
    expect(caDaysUntilExpiry(new Date(now.getTime() - 1), now)).toBe(0);
  });
});

describe("rotateScepCa", () => {
  it("retains the previous CA as a trust anchor until it expires", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const previous = await run(generateScepCa(scope.organizationId, { now, lifetimeDays: 500 }));
    const previousDescription = await run(describeScepCa(previous.certPem));

    let rotated: { candidate: ScepStoredCa; retiredAt: Date; trustUntil: Date } | undefined;

    const repository = repositoryFrom({
      getCa: () => Effect.succeed(previous),
      rotateCa: (_scope, candidate, options) =>
        Effect.sync(() => {
          rotated = { candidate, ...options };

          return candidate;
        }),
    });

    const loaded = await run(rotateScepCa(repository, scope, { now }));

    expect(rotated).toBeDefined();
    expect(rotated!.retiredAt.toISOString()).toBe(now.toISOString());
    expect(rotated!.trustUntil.toISOString()).toBe(previousDescription.notAfter.toISOString());
    // The successor is a genuinely new key pair and certificate.
    expect(rotated!.candidate.certPem).not.toBe(previous.certPem);
    expect(loaded.certPem).toBe(rotated!.candidate.certPem);
    expect(loaded.source).toBe("generated");
  });

  it("bootstraps rather than rotating when the tenant has no CA yet", async () => {
    const saved: ScepStoredCa[] = [];
    let rotated = 0;

    const repository = repositoryFrom({
      getCa: () => Effect.succeed(null),
      saveCa: (_scope, ca) =>
        Effect.sync(() => {
          saved.push(ca);

          return ca;
        }),
      rotateCa: (_scope, ca) =>
        Effect.sync(() => {
          rotated += 1;

          return ca;
        }),
    });

    const loaded = await run(rotateScepCa(repository, scope));

    expect(saved).toHaveLength(1);
    expect(rotated).toBe(0);
    expect(loaded.certPem).toBe(saved[0]!.certPem);
  });

  it("refuses to open an expired CA for issuance", async () => {
    const stored = await run(
      generateScepCa(scope.organizationId, {
        now: new Date(Date.now() - 10 * 365 * DAY),
        lifetimeDays: 1,
      }),
    );

    await expect(run(openScepCa(stored))).rejects.toMatchObject({
      message: expect.stringContaining("expired"),
    });
  });
});
