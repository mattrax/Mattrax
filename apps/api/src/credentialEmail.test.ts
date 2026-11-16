import { describe, expect, it } from "vitest";
import type { CredentialExpiryNotification } from "@mattrax/enterprise-backend";
import { CREDENTIAL_EMAIL_FROM, credentialExpiryEmail } from "./credentialEmail.js";

const notification: CredentialExpiryNotification = {
  organizationId: "org-1",
  organizationName: "Acme <Corp>",
  threshold: "7d",
  day: "2026-11-10",
  recipients: [{ userId: "u-1", name: "Alice", email: "alice@example.com", role: "owner" }],
  health: {
    apns: {
      configured: true,
      expiresAt: "2026-11-15T00:00:00.000Z",
      daysLeft: 5,
      level: "critical",
      commonName: "Acme APNs",
      topic: "com.apple.mgmt.External.acme",
      keyConfigured: true,
      keyMatchesCertificate: true,
      topicMatchesCertificate: true,
      renewalUrl: "https://identity.apple.com/pushcert/",
    },
    scepCa: {
      configured: true,
      expiresAt: "2026-11-14T00:00:00.000Z",
      daysLeft: 4,
      level: "critical",
      commonName: "Mattrax SCEP CA",
      fingerprintSha256: "ab".repeat(32),
      source: "generated",
      rotationDue: true,
      rotationDueAt: "2025-11-14T00:00:00.000Z",
      retiring: [],
      unattributedIdentities: 0,
      untrustedIdentities: 0,
    },
    deviceCertificates: { total: 4, expiringSoon: 2, expired: 1, revoked: 0 },
    serverCertificate: {
      configured: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
      daysLeft: 60,
      level: "ok",
      origin: "https://e.mattrax.app",
      hostname: "e.mattrax.app",
      checkedAt: "2026-11-10T00:00:00.000Z",
      subject: "CN=e.mattrax.app",
      issuer: "CN=Test CA",
      authorized: true,
      authorizationError: null,
      error: null,
    },
  },
};

describe("credentialExpiryEmail", () => {
  it("includes the tenant, both credentials, expired counts and the management link", () => {
    const email = credentialExpiryEmail(notification, { origin: "https://e.mattrax.app/" });
    expect(email.subject).toContain("Acme <Corp>");
    expect(email.subject).toContain("7 days");
    expect(email.text).toContain("APNs certificate: 5 days left");
    expect(email.text).toContain("SCEP CA certificate: 4 days left");
    expect(email.text).toContain("1 expired, 2 expiring within 30 days");
    expect(email.text).toContain("https://e.mattrax.app/t/org-1/settings/management");
    expect(email.text).toContain("Settings → Management");
    expect(email.text).toContain(CREDENTIAL_EMAIL_FROM);
    // Tenant names are HTML-escaped in the rich body.
    expect(email.html).toContain("Acme &lt;Corp&gt;");
  });

  it("describes expired alerts without a positive days-left", () => {
    const email = credentialExpiryEmail(
      {
        ...notification,
        threshold: "expired",
        health: {
          ...notification.health,
          apns: { ...notification.health.apns, daysLeft: -1, level: "expired" },
        },
      },
      { origin: "https://e.mattrax.app" },
    );

    expect(email.subject).toContain("credential expired");
    expect(email.text).toContain("APNs certificate: expired");
  });
});
