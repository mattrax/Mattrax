import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { generateCaKeyPair, pemEncode } from "@mattrax/crypto";
import { Db } from "@mattrax/enterprise-core";
import {
  CREDENTIAL_CRITICAL_DAYS,
  CREDENTIAL_WARNING_DAYS,
  credentialLevel,
  daysUntilExpiry,
  loadCredentialHealth,
  parseCertificateNotAfter,
  summarizeDeviceCertificates,
} from "../src/credentialHealth.js";
import { runMaintenance } from "../src/maintenance.js";
import { makeDb, runEffect } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto as unknown as Crypto, crypto.subtle);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-10T12:00:00.000Z");
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);

const makeCertificate = async (notAfter: Date) => {
  const keys = await generateCaKeyPair();
  const attribute = (type: string, value: string) =>
    new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [attribute("2.5.4.3", "Test certificate")],
  });
  certificate.issuer = name;
  certificate.subject = name;
  certificate.notBefore.value = new Date(notAfter.getTime() - 365 * DAY);
  certificate.notAfter.value = notAfter;
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, "SHA-256");
  return pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false));
};

describe("daysUntilExpiry", () => {
  it("rounds up whole days and keeps the 30/7/0 boundaries", () => {
    expect(daysUntilExpiry(daysFromNow(CREDENTIAL_WARNING_DAYS), now)).toBe(30);
    expect(daysUntilExpiry(new Date(daysFromNow(30).getTime() + 1), now)).toBe(31);
    expect(daysUntilExpiry(daysFromNow(CREDENTIAL_CRITICAL_DAYS), now)).toBe(7);
    expect(daysUntilExpiry(new Date(daysFromNow(7).getTime() - 1), now)).toBe(7);
    expect(daysUntilExpiry(daysFromNow(0), now)).toBe(0);
    expect(daysUntilExpiry(daysFromNow(-1), now)).toBe(-1);
  });
});

describe("credentialLevel", () => {
  it("classifies configured credentials by days left", () => {
    expect(credentialLevel(false, null, now)).toBe("missing");
    expect(credentialLevel(true, null, now)).toBe("unknown");
    expect(credentialLevel(true, daysFromNow(31), now)).toBe("ok");
    expect(credentialLevel(true, daysFromNow(30), now)).toBe("warning");
    expect(credentialLevel(true, daysFromNow(8), now)).toBe("warning");
    expect(credentialLevel(true, daysFromNow(7), now)).toBe("critical");
    expect(credentialLevel(true, daysFromNow(0.5), now)).toBe("critical");
    expect(credentialLevel(true, daysFromNow(0), now)).toBe("expired");
    expect(credentialLevel(true, daysFromNow(-5), now)).toBe("expired");
  });
});

describe("parseCertificateNotAfter", () => {
  it("reads notAfter from a PEM certificate", async () => {
    const notAfter = new Date("2027-04-01T00:00:00.000Z");
    const parsed = parseCertificateNotAfter(await makeCertificate(notAfter));
    expect(parsed?.toISOString()).toBe(notAfter.toISOString());
  });

  it("returns null instead of throwing for unparseable input", () => {
    expect(parseCertificateNotAfter(undefined)).toBeNull();
    expect(parseCertificateNotAfter("")).toBeNull();
    expect(parseCertificateNotAfter("not a pem")).toBeNull();
    expect(
      parseCertificateNotAfter("-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----"),
    ).toBeNull();
  });
});

describe("summarizeDeviceCertificates", () => {
  it("separates expiring, expired and revoked identities", () => {
    expect(
      summarizeDeviceCertificates(
        [
          { notAfter: daysFromNow(30) },
          { notAfter: daysFromNow(31) },
          { notAfter: daysFromNow(-1) },
          { notAfter: daysFromNow(5), revokedAt: daysFromNow(-2) },
        ],
        now,
      ),
    ).toEqual({ total: 4, expiringSoon: 1, expired: 1, revoked: 1 });
  });
});

describe("loadCredentialHealth", () => {
  const build = async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-a" }, { id: "org-b" });
    db.store.apple_push_certificate.push({
      organizationId: "org-a",
      email: "a@example.com",
      topic: "com.apple.mgmt.External.a",
      certPem: await makeCertificate(daysFromNow(10)),
      updatedAt: now,
    });
    db.store.apple_push_certificate.push({
      organizationId: "org-b",
      email: "b@example.com",
      topic: "com.apple.mgmt.External.b",
      certPem: await makeCertificate(daysFromNow(90)),
      updatedAt: now,
    });
    db.store.scep_ca.push({
      id: 1,
      certPem: await makeCertificate(daysFromNow(5)),
      createdAt: now,
    });
    db.store.scep_issued_certificate.push(
      { serial: "a-1", organizationId: "org-a", notAfter: daysFromNow(20), createdAt: now },
      { serial: "a-2", organizationId: "org-a", notAfter: daysFromNow(-1), createdAt: now },
      { serial: "b-1", organizationId: "org-b", notAfter: daysFromNow(200), createdAt: now },
    );
    return db;
  };

  it("scopes APNs and identity counts to the tenant", async () => {
    const db = await build();
    const a = await runEffect(loadCredentialHealth(db as any, "org-a", now));
    expect(a.apns.level).toBe("warning");
    expect(a.apns.daysLeft).toBe(10);
    expect(a.deviceCertificates).toEqual({
      total: 2,
      expiringSoon: 1,
      expired: 1,
      revoked: 0,
    });

    const b = await runEffect(loadCredentialHealth(db as any, "org-b", now));
    expect(b.apns.level).toBe("ok");
    expect(b.apns.daysLeft).toBe(90);
    expect(b.deviceCertificates).toEqual({
      total: 1,
      expiringSoon: 0,
      expired: 0,
      revoked: 0,
    });
  });

  it("reports missing and unparseable credentials without throwing", async () => {
    const db = makeDb();
    const missing = await runEffect(loadCredentialHealth(db as any, "org-a", now));
    expect(missing.apns).toEqual({
      configured: false,
      expiresAt: null,
      daysLeft: null,
      level: "missing",
    });
    expect(missing.scepCa.level).toBe("missing");

    db.store.apple_push_certificate.push({
      organizationId: "org-a",
      email: "a@example.com",
      topic: "topic",
      certPem: "garbage",
      updatedAt: now,
    });
    const broken = await runEffect(loadCredentialHealth(db as any, "org-a", now));
    expect(broken.apns.configured).toBe(true);
    expect(broken.apns.level).toBe("unknown");
    expect(broken.apns.daysLeft).toBeNull();
  });

  it("writes one credential alert per threshold per day", async () => {
    const db = await build();
    const run = (at: Date) =>
      runEffect(
        // Retention is disabled so the fake database's `lt` predicate cannot
        // interfere with the audit-dedupe assertions.
        runMaintenance({ now: at, auditRetentionDays: 0 }).pipe(
          Effect.provideService(Db, db as unknown as Db["Service"]),
        ),
      );

    const first = await run(now);
    expect(first.credentialAlerts).toBe(2);
    expect(
      db.store.audit_log.filter((row) => row.action === "credentials.expiry_warning"),
    ).toHaveLength(2);

    // Same thresholds on the same day: deduped.
    const second = await run(new Date(now.getTime() + 60 * 60 * 1000));
    expect(second.credentialAlerts).toBe(0);

    // Next day: the 7d threshold is reported again once.
    const third = await run(new Date(now.getTime() + DAY + 60 * 60 * 1000));
    expect(third.credentialAlerts).toBe(2);
  });
});
