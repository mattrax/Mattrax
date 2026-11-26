import { escapeHtml, headerValue } from "./emailTemplate.ts";

/**
 * Optional email sent when a restricted-software rule matches an installed
 * application. The same event is always available as a webhook; email is for
 * operators who want the notice without running a receiver.
 */

export type RestrictedSoftwareViolationEmailInput = {
  readonly tenantName: string;
  readonly ruleName: string;
  readonly action: string;
  readonly platform: string;
  readonly deviceName: string;
  readonly deviceId: string;
  readonly applicationName: string | null;
  readonly matchedBundleId: string;
  readonly matchType: string;
  readonly matchValue: string;
  readonly enforcementLabel: string;
  readonly enforcementDetail: string;
  readonly detectedAt: Date | string;
  readonly dashboardUrl?: string | null;
  readonly supportEmail?: string | null;
};

export type RestrictedSoftwareViolationEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

const formatDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

export const restrictedSoftwareViolationEmail = (
  input: RestrictedSoftwareViolationEmailInput,
): RestrictedSoftwareViolationEmail => {
  const tenantName = headerValue(input.tenantName) || "Mattrax";
  const ruleName = headerValue(input.ruleName);
  const deviceName = headerValue(input.deviceName);
  const application = headerValue(input.applicationName || input.matchedBundleId);
  const detectedAt = formatDate(input.detectedAt);
  const subject = `[${tenantName}] Restricted software detected on ${deviceName}`.slice(0, 200);

  const lines = [
    `Restricted software "${ruleName}" matched an installed application.`,
    "",
    `Device: ${deviceName} (${input.deviceId})`,
    `Platform: ${input.platform}`,
    `Application: ${application}`,
    `Matched: ${input.matchType} = ${input.matchValue} (${input.matchedBundleId})`,
    `Action: ${input.action}`,
    `Enforcement: ${input.enforcementLabel}`,
    input.enforcementDetail,
    `Detected: ${detectedAt}`,
  ];

  if (input.dashboardUrl) lines.push("", `Open the fleet view: ${input.dashboardUrl}`);
  if (input.supportEmail) lines.push("", `Support: ${input.supportEmail}`);

  const html = `<p><strong>${escapeHtml(ruleName)}</strong> matched an installed application.</p>
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td>Device</td><td>${escapeHtml(deviceName)}</td></tr>
<tr><td>Platform</td><td>${escapeHtml(input.platform)}</td></tr>
<tr><td>Application</td><td>${escapeHtml(application)}</td></tr>
<tr><td>Matched</td><td>${escapeHtml(input.matchType)} = ${escapeHtml(input.matchValue)} (${escapeHtml(input.matchedBundleId)})</td></tr>
<tr><td>Action</td><td>${escapeHtml(input.action)}</td></tr>
<tr><td>Enforcement</td><td>${escapeHtml(input.enforcementLabel)} — ${escapeHtml(input.enforcementDetail)}</td></tr>
<tr><td>Detected</td><td>${escapeHtml(detectedAt)}</td></tr>
</table>
${input.dashboardUrl ? `<p><a href="${escapeHtml(input.dashboardUrl)}">Open the fleet view</a></p>` : ""}
${input.supportEmail ? `<p>Support: ${escapeHtml(input.supportEmail)}</p>` : ""}`;

  return { subject, text: lines.join("\n"), html };
};
