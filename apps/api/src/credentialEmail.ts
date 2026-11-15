import type { CredentialExpiryNotification } from "@mattrax/enterprise-backend";

/** Sender used by every transactional email in the hosted Cloud app. */
export const CREDENTIAL_EMAIL_FROM = "hello@mattrax.cloud";

export type CredentialExpiryEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

type CredentialThresholdLabel = {
  readonly subject: string;
  readonly summary: string;
};

const thresholdLabel = (
  threshold: CredentialExpiryNotification["threshold"],
): CredentialThresholdLabel => {
  if (threshold === "expired")
    return {
      subject: "credential expired",
      summary: "One or more management credentials have expired.",
    };

  if (threshold === "7d")
    return {
      subject: "credential expires within 7 days",
      summary: "One or more management credentials expire within 7 days.",
    };

  return {
    subject: "credential expires within 30 days",
    summary: "One or more management credentials expire within 30 days.",
  };
};

const credentialLine = (
  label: string,
  credential: CredentialExpiryNotification["health"]["apns"],
) => {
  if (!credential.configured) return `${label}: not configured`;
  const daysLeft = credential.daysLeft;

  if (daysLeft == null) return `${label}: expiry could not be read`;
  const expiry = credential.expiresAt ? `, expires ${credential.expiresAt.slice(0, 10)}` : "";

  if (daysLeft <= 0) return `${label}: expired${expiry}`;

  return `${label}: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left${expiry}`;
};

/**
 * Compose the credential-expiry notification. Kept pure so formatting can be
 * tested without a Worker environment or an email binding.
 */
export const credentialExpiryEmail = (
  notification: CredentialExpiryNotification,
  options: { readonly origin: string; readonly supportEmail?: string },
): CredentialExpiryEmail => {
  const label = thresholdLabel(notification.threshold);

  const managementUrl = `${options.origin.replace(/\/+$/, "")}/t/${encodeURIComponent(
    notification.organizationId,
  )}/settings/management`;

  const supportEmail = options.supportEmail ?? CREDENTIAL_EMAIL_FROM;
  const { apns, scepCa, deviceCertificates } = notification.health;

  const lines = [
    credentialLine("APNs certificate", apns),
    credentialLine("SCEP CA certificate", scepCa),
    `Device identity certificates: ${deviceCertificates.expired} expired, ${deviceCertificates.expiringSoon} expiring within 30 days`,
  ];

  const subject = `[Mattrax] ${notification.organizationName}: ${label.subject}`;

  const text = [
    "Hello,",
    "",
    `${label.summary} This notice is for the ${notification.organizationName} tenant.`,
    "",
    ...lines,
    "",
    "Renew or replace the affected credentials in Settings → Management:",
    managementUrl,
    "",
    "APNs: upload a renewed push certificate under Settings → Management. Once it expires, devices stop receiving push commands and fall back to polling for changes.",
    "SCEP: rotate the CA before it expires. When it has expired, new device identities cannot be issued and existing devices cannot renew.",
    "",
    `If you need help, reply to this email or contact ${supportEmail}.`,
    "",
    "— Mattrax",
  ].join("\n");

  const html = [
    "<p>Hello,</p>",
    `<p>${label.summary} This notice is for the <strong>${escapeHtml(
      notification.organizationName,
    )}</strong> tenant.</p>`,
    "<ul>",
    ...lines.map((line) => `<li>${escapeHtml(line)}</li>`),
    "</ul>",
    "<p>Renew or replace the affected credentials in <strong>Settings → Management</strong>:</p>",
    `<p><a href="${escapeHtml(managementUrl)}">${escapeHtml(managementUrl)}</a></p>`,
    "<p><strong>APNs:</strong> upload a renewed push certificate under Settings → Management. Once it expires, devices stop receiving push commands and fall back to polling for changes.</p>",
    "<p><strong>SCEP:</strong> rotate the CA before it expires. When it has expired, new device identities cannot be issued and existing devices cannot renew.</p>",
    `<p>If you need help, reply to this email or contact <a href="mailto:${escapeHtml(
      supportEmail,
    )}">${escapeHtml(supportEmail)}</a>.</p>`,
    "<p>— Mattrax</p>",
  ].join("\n");

  return { subject, text, html };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
