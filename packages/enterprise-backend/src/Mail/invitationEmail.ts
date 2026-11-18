import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SUPPORT_EMAIL,
  normalizeBrandColor,
} from "@mattrax/enterprise-domain";
import {
  buttonTextColor,
  escapeHtml,
  formatExpiry,
  headerValue,
  safeLogoUrl,
  trimOrNull,
} from "./emailTemplate.ts";

const SUPPORT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InvitationEmailInput = {
  readonly tenantName: string;
  readonly logoUrl?: string | null;
  readonly brandColor?: string | null;
  readonly roleLabel: string;
  readonly inviterName: string;
  readonly invitedEmail: string;
  readonly inviteUrl: string;
  readonly expiresAt: Date | string;
  readonly supportEmail?: string | null;
};

export type InvitationEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

/**
 * Compose a tenant invitation email. Kept pure: no sender, transport, database
 * or Worker environment is involved, so formatting can be tested directly.
 */
export const invitationEmail = (input: InvitationEmailInput): InvitationEmail => {
  const tenant = headerValue(input.tenantName) || "Mattrax";
  const role = headerValue(input.roleLabel) || "member";
  const inviter = headerValue(input.inviterName) || "A teammate";
  const invitedEmail = input.invitedEmail.trim();
  const inviteUrl = input.inviteUrl.trim();
  const expiry = formatExpiry(input.expiresAt);

  const supportEmail = trimOrNull(input.supportEmail);

  const support =
    supportEmail && SUPPORT_EMAIL.test(supportEmail) ? supportEmail : DEFAULT_SUPPORT_EMAIL;

  const accent = normalizeBrandColor(input.brandColor ?? "") ?? DEFAULT_BRAND_COLOR;
  const buttonText = buttonTextColor(accent);
  const logoUrl = safeLogoUrl(input.logoUrl);

  const subject = `Join ${tenant} on Mattrax`;

  const text = [
    "Hello,",
    "",
    `${inviter} invited you to join ${tenant} on Mattrax as ${role}.`,
    "",
    "Accept the invitation by opening this link:",
    inviteUrl,
    "",
    `This invitation was sent to ${invitedEmail} and expires on ${expiry}.`,
    "",
    `If you weren't expecting this, ignore this email. Need help? Contact ${support}.`,
    "",
    "— Mattrax",
  ].join("\n");

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(subject)}</title>`,
    "</head>",
    "<body style=\"margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;\">",
    '<div style="max-width:480px;margin:0 auto;padding:32px 20px;">',
    '<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:32px;">',
    ...(logoUrl
      ? [
          `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(
            tenant,
          )}" style="display:block;max-width:160px;max-height:56px;width:auto;height:auto;margin:0 0 24px;" />`,
        ]
      : []),
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Join ${escapeHtml(
      tenant,
    )} on Mattrax</h1>`,
    `<p style="margin:0 0 8px;font-size:16px;line-height:1.5;">${escapeHtml(
      inviter,
    )} invited you to join <strong>${escapeHtml(tenant)}</strong> as <strong>${escapeHtml(
      role,
    )}</strong>.</p>`,
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">This invitation was sent to ${escapeHtml(
      invitedEmail,
    )}.</p>`,
    `<p style="margin:0 0 12px;"><a href="${escapeHtml(
      inviteUrl,
    )}" style="display:inline-block;background:${accent};color:${buttonText};padding:12px 22px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">Accept invitation</a></p>`,
    `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#57534e;">Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
      inviteUrl,
    )}</span></p>`,
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#57534e;">Expires: ${escapeHtml(
      expiry,
    )}</p>`,
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#57534e;">If you weren't expecting this, ignore this email. Need help? Contact <a href="mailto:${escapeHtml(
      support,
    )}" style="color:#57534e;">${escapeHtml(support)}</a>.</p>`,
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");

  return { subject, text, html };
};
