import { DEFAULT_SUPPORT_EMAIL } from "@mattrax/enterprise-domain";
import { escapeHtml, formatExpiry, headerValue, trimOrNull } from "./emailTemplate.ts";
import {
  emailButton,
  emailDocument,
  emailFootnote,
  emailHeading,
  emailIsolate,
  emailParagraph,
  emailTextLink,
  resolveEmailBrand,
} from "./emailLayout.ts";

const SUPPORT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

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

  const brand = resolveEmailBrand({
    name: tenant,
    logoUrl: input.logoUrl,
    brandColor: input.brandColor,
    origin: originOf(inviteUrl),
    fallbackName: "Mattrax",
  });

  const subject = `Join ${tenant} on Mattrax`;
  const preheader = `${inviter} invited you to join ${tenant} on Mattrax.`;

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

  const content = [
    emailHeading(`Join ${emailIsolate(tenant)} on Mattrax`),
    emailParagraph(
      `${emailIsolate(
        inviter,
      )} invited you to join <strong>${emailIsolate(tenant)}</strong> as <strong>${escapeHtml(
        role,
      )}</strong>.`,
    ),
    emailParagraph(`This invitation was sent to ${emailIsolate(invitedEmail)}.`),
    emailButton(inviteUrl, "Accept invitation", brand),
    emailFootnote(
      `Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
        inviteUrl,
      )}</span>`,
      16,
    ),
  ].join("\n");

  const footer = [
    emailFootnote(`Expires: ${escapeHtml(expiry)}.`),
    emailFootnote(
      `If you weren't expecting this, ignore this email. Need help? Contact ${emailTextLink(
        `mailto:${support}`,
        support,
      )}.`,
    ),
  ].join("\n");

  const html = emailDocument({ subject, preheader, brand, content, footer });

  return { subject, text, html };
};
