import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SUPPORT_EMAIL,
  normalizeBrandColor,
} from "@mattrax/enterprise-domain";

const SUPPORT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Collapse whitespace so tenant-controlled text cannot inject mail headers. */
const headerValue = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

const trimOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

/**
 * Only absolute `https` logos survive. Relative paths, inline data URLs and
 * unsafe schemes are dropped rather than rewritten, so the template never
 * emits an unusable or untrustworthy image.
 */
const safeLogoUrl = (value: string | null | undefined): string | null => {
  const trimmed = trimOrNull(value);

  if (!trimmed) return null;

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  return parsed.protocol === "https:" ? trimmed : null;
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** Format the expiry in UTC so every recipient sees the same deadline. */
const formatExpiry = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isNaN(date.getTime()))
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} at ${pad(
      date.getUTCHours(),
    )}:${pad(date.getUTCMinutes())} UTC`;

  const raw = value instanceof Date ? "" : value.trim();

  return raw || "an unknown time";
};

/**
 * Pick black or white button text from the background luminance so a light
 * tenant brand colour stays readable.
 */
const buttonTextColor = (background: string): string => {
  const hex = background.slice(1);

  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.6 ? "#1c1917" : "#ffffff";
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
