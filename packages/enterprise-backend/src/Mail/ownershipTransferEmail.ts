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

export type OwnershipTransferEmailInput = {
  readonly tenantName: string;
  readonly logoUrl?: string | null;
  readonly brandColor?: string | null;
  /** The owner handing ownership over. */
  readonly requesterName: string;
  readonly targetEmail: string;
  readonly acceptUrl: string;
  readonly expiresAt: Date | string;
  readonly supportEmail?: string | null;
};

export type OwnershipTransferEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

/**
 * Compose the email that asks a member to take over a tenant. Kept pure so the
 * formatting can be tested without a transport or database.
 */
export const ownershipTransferEmail = (
  input: OwnershipTransferEmailInput,
): OwnershipTransferEmail => {
  const tenant = headerValue(input.tenantName) || "Mattrax";
  const requester = headerValue(input.requesterName) || "A tenant owner";
  const targetEmail = input.targetEmail.trim();
  const acceptUrl = input.acceptUrl.trim();
  const expiry = formatExpiry(input.expiresAt);

  const supportEmail = trimOrNull(input.supportEmail);

  const support =
    supportEmail && SUPPORT_EMAIL.test(supportEmail) ? supportEmail : DEFAULT_SUPPORT_EMAIL;

  const brand = resolveEmailBrand({
    name: tenant,
    logoUrl: input.logoUrl,
    brandColor: input.brandColor,
    origin: originOf(acceptUrl),
    fallbackName: "Mattrax",
  });

  const subject = `Take over ${tenant} on Mattrax`;
  const preheader = `${requester} wants to transfer ownership of ${tenant} to you.`;

  const text = [
    "Hello,",
    "",
    `${requester} wants to transfer ownership of ${tenant} on Mattrax to you.`,
    "",
    "Accepting makes you an owner of the tenant and changes the requester's role to administrator.",
    "",
    "Accept the transfer by opening this link:",
    acceptUrl,
    "",
    `This link was sent to ${targetEmail} and expires on ${expiry}.`,
    "",
    `If you weren't expecting this, ignore this email and the tenant stays as it is. Need help? Contact ${support}.`,
    "",
    "— Mattrax",
  ].join("\n");

  const content = [
    emailHeading(`Take over ${emailIsolate(tenant)}`),
    emailParagraph(
      `${emailIsolate(requester)} wants to transfer ownership of <strong>${emailIsolate(
        tenant,
      )}</strong> on Mattrax to you.`,
    ),
    emailParagraph(
      "Accepting makes you an owner of the tenant and changes the requester's role to administrator.",
    ),
    emailParagraph(`This link was sent to ${emailIsolate(targetEmail)}.`),
    emailButton(acceptUrl, "Accept ownership", brand),
    emailFootnote(
      `Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
        acceptUrl,
      )}</span>`,
      16,
    ),
  ].join("\n");

  const footer = [
    emailFootnote(`Expires: ${escapeHtml(expiry)}.`),
    emailFootnote(
      `If you weren't expecting this, ignore this email and the tenant stays as it is. Need help? Contact ${emailTextLink(
        `mailto:${support}`,
        support,
      )}.`,
    ),
  ].join("\n");

  const html = emailDocument({ subject, preheader, brand, content, footer });

  return { subject, text, html };
};
