import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { exportPrivateKeyJwk, generateCaKeyPair, pemEncode, sealSecret } from "@mattrax/crypto";
import { Db } from "@mattrax/enterprise-core";
import {
  APNS_RENEWAL_URL,
  CREDENTIAL_CRITICAL_DAYS,
  CREDENTIAL_WARNING_DAYS,
  apnsCredentialHealth,
  credentialLevel,
  daysUntilExpiry,
  loadCredentialHealth,
  parseCertificateNotAfter,
  summarizeDeviceCertificates,
} from "../src/credentialHealth.js";
import { runMaintenance, type CredentialExpiryNotifier } from "../src/maintenance.js";
import { makeDb, runEffect } from "./helpers.js";

if (typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined") {
  try {
    pkijs.getEngine();
  } catch {
    pkijs.setEngine("WebCrypto", crypto, crypto.subtle);
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

  it("counts only the latest identity per device", () => {
    const history = [
      // Old renewal history would otherwise show as dozens of expired rows.
      { deviceId: "device-a", notAfter: daysFromNow(-300), createdAt: daysFromNow(-330) },
      { deviceId: "device-a", notAfter: daysFromNow(-200), createdAt: daysFromNow(-230) },
      { deviceId: "device-a", notAfter: daysFromNow(90), createdAt: daysFromNow(-1) },
      { deviceId: "device-b", notAfter: daysFromNow(-5), createdAt: daysFromNow(-6) },
    ];

    expect(summarizeDeviceCertificates(history, now)).toEqual({
      total: 2,
      expiringSoon: 0,
      expired: 1,
      revoked: 0,
    });
  });

  it("keeps a revoked latest identity visible as revoked", () => {
    expect(
      summarizeDeviceCertificates(
        [
          { deviceId: "device-a", notAfter: daysFromNow(90), createdAt: daysFromNow(-10) },
          {
            deviceId: "device-a",
            notAfter: daysFromNow(90),
            revokedAt: daysFromNow(-1),
            createdAt: daysFromNow(-1),
          },
        ],
        now,
      ),
    ).toEqual({ total: 1, expiringSoon: 0, expired: 0, revoked: 1 });
  });

  it("drops legacy device-unscoped certificates that expired long ago", () => {
    expect(
      summarizeDeviceCertificates(
        [
          { notAfter: daysFromNow(-365) },
          { notAfter: daysFromNow(-1) },
          { notAfter: daysFromNow(90) },
        ],
        now,
      ),
    ).toEqual({ total: 2, expiringSoon: 0, expired: 1, revoked: 0 });
  });
});

const build = async () => {
  const db = makeDb();
  db.store.organization.push({ id: "org-a", name: "Acme A" }, { id: "org-b", name: "Acme B" });
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
  db.store.scep_ca.push(
    {
      id: 1,
      organizationId: "org-a",
      certPem: await makeCertificate(daysFromNow(5)),
      privateKeyJwk: {},
      source: "generated",
      createdAt: now,
      rotatedAt: null,
    },
    {
      id: 2,
      organizationId: "org-b",
      certPem: await makeCertificate(daysFromNow(5)),
      privateKeyJwk: {},
      source: "generated",
      createdAt: now,
      rotatedAt: null,
    },
  );
  db.store.scep_issued_certificate.push(
    { serial: "a-1", organizationId: "org-a", notAfter: daysFromNow(20), createdAt: now },
    { serial: "a-2", organizationId: "org-a", notAfter: daysFromNow(-1), createdAt: now },
    { serial: "b-1", organizationId: "org-b", notAfter: daysFromNow(200), createdAt: now },
  );

  return db;
};

describe("loadCredentialHealth", () => {
  it("scopes APNs and identity counts to the tenant", async () => {
    const db = await build();
    const a = await runEffect(loadCredentialHealth(db, "org-a", now));
    expect(a.apns.level).toBe("warning");
    expect(a.apns.daysLeft).toBe(10);
    expect(a.deviceCertificates).toEqual({
      total: 2,
      expiringSoon: 1,
      expired: 1,
      revoked: 0,
    });

    const b = await runEffect(loadCredentialHealth(db, "org-b", now));
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
    const missing = await runEffect(loadCredentialHealth(db, "org-a", now));
    expect(missing.apns).toEqual({
      configured: false,
      expiresAt: null,
      daysLeft: null,
      level: "missing",
      commonName: null,
      topic: null,
      keyConfigured: false,
      keyMatchesCertificate: null,
      topicMatchesCertificate: null,
      renewalUrl: "https://identity.apple.com/pushcert/",
    });
    expect(missing.scepCa.level).toBe("missing");
    expect(missing.serverCertificate).toMatchObject({
      configured: false,
      level: "missing",
      origin: null,
    });

    db.store.apple_push_certificate.push({
      organizationId: "org-a",
      email: "a@example.com",
      topic: "topic",
      certPem: "garbage",
      updatedAt: now,
    });
    const broken = await runEffect(loadCredentialHealth(db, "org-a", now));
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
        runMaintenance({ now: at, auditRetentionDays: 0 }).pipe(Effect.provideService(Db, db)),
      );

    const first = await run(now);
    expect(first.credentialAlerts).toBe(2);
    expect(
      db.store.audit_log.filter(
        (row: { action: string }) => row.action === "credentials.expiry_warning",
      ),
    ).toHaveLength(2);

    // Same thresholds on the same day: deduped.
    const second = await run(new Date(now.getTime() + 60 * 60 * 1000));
    expect(second.credentialAlerts).toBe(0);

    // Next day: the 7d threshold is reported again once.
    const third = await run(new Date(now.getTime() + DAY + 60 * 60 * 1000));
    expect(third.credentialAlerts).toBe(2);
  });

  it("reports again just after UTC midnight instead of skipping a day", async () => {
    const db = await build();

    const run = (at: Date) =>
      runEffect(
        runMaintenance({ now: at, auditRetentionDays: 0 }).pipe(Effect.provideService(Db, db)),
      );

    // 23:30 UTC: alerts are written for the 30d and 7d thresholds.
    const lateNight = new Date("2026-11-10T23:30:00.000Z");
    expect((await run(lateNight)).credentialAlerts).toBe(2);

    // 00:30 UTC the next day is only an hour later, but it is a new date
    // bucket. A rolling 24h window would (incorrectly) suppress both alerts.
    const justAfterMidnight = new Date("2026-11-11T00:30:00.000Z");
    const alerts = await run(justAfterMidnight);
    expect(alerts.credentialAlerts).toBe(2);
    expect(
      db.store.audit_log
        .filter((row: { action: string }) => row.action === "credentials.expiry_warning")
        .map((row: { metadata: { day?: string } }) => row.metadata.day),
    ).toEqual(["2026-11-10", "2026-11-10", "2026-11-11", "2026-11-11"]);
  });
});

describe("credential expiry notifications", () => {
  const withRecipients = async () => {
    const db = await build();
    db.store.user.push(
      { id: "u-owner", name: "Alice", email: "alice@example.com", disabled: false },
      { id: "u-admin", name: "Bob", email: "bob@example.com", disabled: false },
      { id: "u-member", name: "Carol", email: "carol@example.com", disabled: false },
      { id: "u-disabled", name: "Dave", email: "dave@example.com", disabled: true },
    );
    db.store.member.push(
      { id: "m-owner", organizationId: "org-a", userId: "u-owner", role: "owner" },
      { id: "m-admin", organizationId: "org-a", userId: "u-admin", role: "admin" },
      { id: "m-member", organizationId: "org-a", userId: "u-member", role: "member" },
      { id: "m-disabled", organizationId: "org-a", userId: "u-disabled", role: "owner" },
      { id: "m-other", organizationId: "org-b", userId: "u-member", role: "admin" },
    );

    return db;
  };

  const run = (
    db: ReturnType<typeof makeDb>,
    notifyCredentialExpiry?: CredentialExpiryNotifier,
    at: Date = now,
  ) =>
    runEffect(
      runMaintenance({
        now: at,
        auditRetentionDays: 0,
        notifyCredentialExpiry,
      }).pipe(Effect.provideService(Db, db)),
    );

  it("notifies once per new alert with enabled owner/admin recipients only", async () => {
    const db = await withRecipients();

    const notifications: Array<{
      organizationId: string;
      organizationName: string;
      threshold: string;
      recipients: Array<{ email: string }>;
    }> = [];

    const notify = vi.fn((notification: any) =>
      Effect.sync(() => {
        notifications.push(notification);
      }),
    );

    const first = await run(db, notify);
    expect(first.credentialAlerts).toBe(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notifications.map((item) => item.organizationId)).toEqual(["org-a", "org-b"]);

    const orgA = notifications.find((item) => item.organizationId === "org-a")!;
    expect(orgA.organizationName).toBe("Acme A");
    expect(orgA.threshold).toBe("7d");
    // Member and disabled-owner accounts are excluded; results are stable.
    expect(orgA.recipients.map((recipient) => recipient.email)).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);

    const orgB = notifications.find((item) => item.organizationId === "org-b")!;
    expect(orgB.recipients.map((recipient) => recipient.email)).toEqual(["carol@example.com"]);

    // A second run on the same UTC day is deduped by the audit trail, so no
    // duplicate email is sent.
    const second = await run(db, notify);
    expect(second.credentialAlerts).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("keeps maintenance running when the notifier fails or throws", async () => {
    const db = await withRecipients();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const failed = await run(db, () => Effect.fail(new Error("smtp unavailable")));
      expect(failed.credentialAlerts).toBe(2);

      // Next day, a synchronously throwing notifier must be isolated too.
      const thrown = await run(
        db,
        () => {
          throw new Error("transport crashed");
        },
        new Date(now.getTime() + DAY),
      );

      expect(thrown.credentialAlerts).toBe(2);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("apnsCredentialHealth", () => {
  const secret = "apns-health-test-secret";
  const topic = "com.apple.mgmt.External.acme";

  const makeApnsMaterial = async (options: { notAfter?: Date; uid?: string } = {}) => {
    const keys = await generateCaKeyPair();

    const attribute = (type: string, value: string) =>
      new pkijs.AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

    const certificate = new pkijs.Certificate();
    certificate.version = 2;
    certificate.serialNumber = new asn1js.Integer({ value: 7 });

    const name = new pkijs.RelativeDistinguishedNames({
      typesAndValues: [
        attribute("2.5.4.3", "Acme APNs"),
        attribute("0.9.2342.19200300.100.1.1", options.uid ?? topic),
      ],
    });

    certificate.issuer = name;
    certificate.subject = name;
    certificate.notBefore.value = new Date(now.getTime() - 300 * DAY);
    certificate.notAfter.value = options.notAfter ?? daysFromNow(60);
    await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
    await certificate.sign(keys.privateKey, "SHA-256");

    return {
      pem: pemEncode("CERTIFICATE", certificate.toSchema(true).toBER(false)),
      jwk: await exportPrivateKeyJwk(keys.privateKey),
    };
  };

  const encryptedKey = (jwk: JsonWebKey) => sealSecret(secret, JSON.stringify(jwk));

  it("reports expiry and a matching key/topic as healthy", async () => {
    const material = await makeApnsMaterial();

    const health = await apnsCredentialHealth({
      certificatePem: material.pem,
      topic,
      encryptedKey: await encryptedKey(material.jwk),
      authSecret: secret,
      now,
    });

    expect(health).toMatchObject({
      configured: true,
      level: "ok",
      daysLeft: 60,
      commonName: "Acme APNs",
      topic,
      keyConfigured: true,
      keyMatchesCertificate: true,
      topicMatchesCertificate: true,
      renewalUrl: APNS_RENEWAL_URL,
    });
  });

  it("escalates a certificate whose stored key does not match", async () => {
    const material = await makeApnsMaterial();
    const other = await makeApnsMaterial();

    const health = await apnsCredentialHealth({
      certificatePem: material.pem,
      topic,
      encryptedKey: await encryptedKey(other.jwk),
      authSecret: secret,
      now,
    });

    // Expiry is still healthy, but pushes cannot be signed at all.
    expect(health.level).toBe("critical");
    expect(health.keyMatchesCertificate).toBe(false);
  });

  it("escalates a topic mismatch between the row and the certificate", async () => {
    const material = await makeApnsMaterial({ uid: "com.apple.mgmt.External.other" });

    const health = await apnsCredentialHealth({
      certificatePem: material.pem,
      topic,
      encryptedKey: await encryptedKey(material.jwk),
      authSecret: secret,
      now,
    });

    expect(health.level).toBe("critical");
    expect(health.topicMatchesCertificate).toBe(false);
  });

  it("leaves the key comparison unknown when no key is stored", async () => {
    const material = await makeApnsMaterial();

    const health = await apnsCredentialHealth({
      certificatePem: material.pem,
      topic,
      encryptedKey: null,
      authSecret: secret,
      now,
    });

    expect(health).toMatchObject({
      keyConfigured: false,
      keyMatchesCertificate: null,
      level: "ok",
    });
  });

  it("keeps an expired certificate expired even when the key matches", async () => {
    const material = await makeApnsMaterial({ notAfter: daysFromNow(-1) });

    const health = await apnsCredentialHealth({
      certificatePem: material.pem,
      topic,
      encryptedKey: await encryptedKey(material.jwk),
      authSecret: secret,
      now,
    });

    expect(health.level).toBe("expired");
  });
});
