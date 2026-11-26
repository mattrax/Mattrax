import { normalizeBrandColor } from "@mattrax/enterprise-domain";
import {
  buttonTextColor,
  escapeHtml,
  headerValue,
  relativeLuminance,
  safeLogoUrl,
} from "./emailTemplate.ts";

/**
 * Shared transactional-email presentation.
 *
 * Everything here is deliberately table-based with inline styles: Outlook
 * ignores modern layout, so padding lives on cells and the card is a real
 * table. The few rules in `<style>` only carry dark-mode and mobile overrides,
 * which the clients that support them apply on top of the inline base.
 *
 * The visual language mirrors `@mattrax/ui`: a warm page, a white card with a
 * hairline border, a product-brand primary action and purple links.
 */

export const EMAIL_FONT_STACK =
  "'Geist Variable',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The product brand solid, used when a tenant has not set a colour. */
export const DEFAULT_EMAIL_BRAND_COLOR = "#6e56cf";

export const EMAIL_COLORS = {
  page: "#e9e9e6",
  card: "#ffffff",
  text: "#1a1a18",
  muted: "#5f5f58",
  subtle: "#696961",
  border: "#e5e5df",
  link: "#6550b9",
  brandMuted: "#efecfb",
} as const;

type EmailBrandInput = {
  /** Product or tenant display name. */
  readonly name?: string | null;
  readonly logoUrl?: string | null;
  readonly brandColor?: string | null;
  /** Deployment origin, used to resolve tenant root-relative logos. */
  readonly origin?: string | null;
  /** Used when `name` is blank. */
  readonly fallbackName?: string;
};

export type EmailBrand = {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly accent: string;
  readonly accentText: string;
  /** A hairline that keeps a near-white mark/button visible on the card. */
  readonly accentBorder: string;
  readonly initial: string;
};

/** Resolve tenant/deployment branding to the values the layout can render. */
export const resolveEmailBrand = (input: EmailBrandInput = {}): EmailBrand => {
  const name = headerValue(input.name ?? "") || input.fallbackName?.trim() || "Mattrax";
  const accent = normalizeBrandColor(input.brandColor ?? "") ?? DEFAULT_EMAIL_BRAND_COLOR;
  const initial = Array.from(name)[0]?.toUpperCase() || "M";

  return {
    name,
    logoUrl: safeLogoUrl(input.logoUrl, input.origin),
    accent,
    accentText: buttonTextColor(accent),
    accentBorder:
      relativeLuminance(accent) > 0.7
        ? "border:1px solid #d6d6cf;"
        : "border:1px solid transparent;",
    initial,
  };
};

/**
 * Isolate an interpolated name/address so an RTL value does not reorder the
 * surrounding sentence, and long unbroken values can wrap inside the card.
 */
export const emailIsolate = (value: string): string =>
  `<span dir="auto" style="unicode-bidi:isolate;">${escapeHtml(value)}</span>`;

const hiddenPreheader = (preheader: string): string =>
  `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    preheader,
  )}</div>`;

const brandHeader = (brand: EmailBrand): string =>
  [
    '<tr><td class="email-header" style="padding:24px 32px 0;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">',
    "<tr>",
    `<td width="32" height="32" align="center" valign="middle" bgcolor="${brand.accent}" aria-hidden="true" class="email-mark" style="width:32px;height:32px;background:${brand.accent};${brand.accentBorder}border-radius:8px;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:32px;font-weight:650;letter-spacing:-0.04em;color:${brand.accentText};">${escapeHtml(
      brand.initial,
    )}</td>`,
    `<td valign="middle" dir="auto" class="email-text" style="padding:0 0 0 10px;font-family:${EMAIL_FONT_STACK};font-size:15px;font-weight:600;letter-spacing:-0.01em;color:${EMAIL_COLORS.text};overflow-wrap:anywhere;word-break:break-word;unicode-bidi:isolate;">${escapeHtml(
      brand.name,
    )}</td>`,
    ...(brand.logoUrl
      ? [
          '<td align="right" valign="middle" style="padding:0 0 0 12px;">',
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">',
          '<tr><td align="center" valign="middle" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e5e5df;border-radius:6px;padding:3px 5px;line-height:0;">',
          // Fixed attributes are the Outlook fallback; modern clients override
          // them with the aspect-preserving CSS max constraints.
          `<img src="${escapeHtml(
            brand.logoUrl,
          )}" width="120" height="28" alt="" role="presentation" style="display:block;width:auto;height:auto;max-width:120px;max-height:28px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />`,
          "</td></tr>",
          "</table>",
          "</td>",
        ]
      : []),
    "</tr>",
    "</table>",
    "</td></tr>",
  ].join("\n");

/**
 * The document shell. `content` replaces the body cell and `footer` is the
 * quiet section under a hairline rule.
 */
export const emailDocument = (input: {
  readonly subject: string;
  readonly preheader: string;
  readonly brand: EmailBrand;
  readonly content: string;
  readonly footer?: string;
}): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />',
    '<meta name="color-scheme" content="light dark" />',
    '<meta name="supported-color-schemes" content="light dark" />',
    `<title>${escapeHtml(input.subject)}</title>`,
    "<style>",
    ":root { color-scheme: light dark; supported-color-schemes: light dark; }",
    "body { margin: 0 !important; padding: 0 !important; width: 100% !important; }",
    "table { border-collapse: collapse; border-spacing: 0; }",
    "img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }",
    "@media only screen and (max-width: 620px) {",
    "  .email-card { width: 100% !important; }",
    "  .email-body { padding-left: 20px !important; padding-right: 20px !important; }",
    "  .email-header { padding-left: 20px !important; padding-right: 20px !important; }",
    "  .email-footer { padding-left: 20px !important; padding-right: 20px !important; }",
    "  .email-heading { font-size: 24px !important; }",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  .email-page { background: #10100f !important; }",
    "  .email-card { background: #171716 !important; border-color: #2a2a27 !important; }",
    "  .email-text, .email-heading { color: #ecece6 !important; }",
    "  .email-muted { color: #b4b4ac !important; }",
    "  .email-subtle { color: #95958d !important; }",
    "  .email-rule { border-color: #2a2a27 !important; }",
    "  .email-button-cell { background: #ecece6 !important; }",
    "  .email-button { color: #151514 !important; }",
    "  .email-link { color: #b3a4f5 !important; }",
    "  .email-mark { border: 1px solid #3a3a36 !important; }",
    "  .email-step-number { background: #241f3a !important; color: #b3a4f5 !important; }",
    "  .email-code { background: #242421 !important; color: #ecece6 !important; }",
    "}",
    "[data-ogsc] .email-page { background: #10100f !important; }",
    "[data-ogsc] .email-card { background: #171716 !important; border-color: #2a2a27 !important; }",
    "[data-ogsc] .email-text, [data-ogsc] .email-heading { color: #ecece6 !important; }",
    "[data-ogsc] .email-muted { color: #b4b4ac !important; }",
    "[data-ogsc] .email-subtle { color: #95958d !important; }",
    "[data-ogsc] .email-button-cell { background: #ecece6 !important; }",
    "[data-ogsc] .email-button { color: #151514 !important; }",
    "[data-ogsc] .email-link { color: #b3a4f5 !important; }",
    "[data-ogsc] .email-code { background: #242421 !important; color: #ecece6 !important; }",
    "</style>",
    "</head>",
    `<body class="email-page" bgcolor="${EMAIL_COLORS.page}" style="margin:0;padding:0;background:${EMAIL_COLORS.page};font-family:${EMAIL_FONT_STACK};color:${EMAIL_COLORS.text};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">`,
    hiddenPreheader(input.preheader),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.page}" class="email-page" style="width:100%;background:${EMAIL_COLORS.page};border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">`,
    '<tr><td align="center" style="padding:32px 16px;">',
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="mso-table-lspace:0pt;mso-table-rspace:0pt;border-spacing:0;"><tr><td><![endif]-->',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" bgcolor="${EMAIL_COLORS.card}" class="email-card" style="width:100%;max-width:600px;background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;border-collapse:separate;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">`,
    brandHeader(input.brand),
    `<tr><td class="email-body" style="padding:28px 32px 8px;">${input.content}</td></tr>`,
    ...(input.footer
      ? [
          `<tr><td class="email-footer email-rule" style="padding:20px 32px 28px;border-top:1px solid ${EMAIL_COLORS.border};">${input.footer}</td></tr>`,
        ]
      : []),
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");

export const emailHeading = (html: string): string =>
  `<h1 class="email-heading" dir="ltr" style="margin:0 0 18px;font-family:${EMAIL_FONT_STACK};font-size:26px;line-height:1.24;font-weight:600;letter-spacing:-0.02em;color:${EMAIL_COLORS.text};overflow-wrap:anywhere;word-break:break-word;mso-line-height-rule:exactly;">${html}</h1>`;

export const emailParagraph = (
  html: string,
  options: { readonly muted?: boolean; readonly bottom?: number } = {},
): string =>
  `<p dir="ltr" class="${options.muted ? "email-muted" : "email-text"}" style="margin:0 0 ${
    options.bottom ?? 16
  }px;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.6;color:${
    options.muted ? EMAIL_COLORS.muted : EMAIL_COLORS.text
  };overflow-wrap:anywhere;word-break:break-word;mso-line-height-rule:exactly;">${html}</p>`;

/** A quieter paragraph for expiry notes, fallback URLs and legal text. */
export const emailFootnote = (html: string, bottom = 8): string =>
  `<p dir="ltr" class="email-muted" style="margin:0 0 ${bottom}px;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};overflow-wrap:anywhere;word-break:break-word;">${html}</p>`;

export const emailTextLink = (href: string, label: string): string =>
  `<a class="email-link" href="${escapeHtml(
    href,
  )}" style="color:${EMAIL_COLORS.link};text-decoration:underline;text-underline-offset:2px;unicode-bidi:isolate;">${escapeHtml(
    label,
  )}</a>`;

/** A highlighted one-time code; the value is escaped. */
export const emailCode = (code: string): string =>
  `<p class="email-code" dir="ltr" style="margin:0 0 18px;padding:14px 18px;background:#f1f1ed;border-radius:10px;font-family:${EMAIL_FONT_STACK};font-size:28px;line-height:1.2;font-weight:650;letter-spacing:0.18em;color:${EMAIL_COLORS.text};text-align:center;mso-line-height-rule:exactly;">${escapeHtml(
    code,
  )}</p>`;

/**
 * A primary action. The background sits on the cell (not the anchor) because
 * Outlook does not reliably paint padding on inline elements.
 */
export const emailButton = (href: string, label: string, brand: EmailBrand): string =>
  [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 14px;border-collapse:separate;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">',
    "<tr>",
    `<td align="center" bgcolor="${brand.accent}" class="email-button-cell" style="background:${brand.accent};${brand.accentBorder}border-radius:8px;padding:13px 22px;mso-padding-alt:13px 22px;">`,
    `<a data-cta="primary" href="${escapeHtml(
      href,
    )}" class="email-button" style="display:inline-block;font-family:${EMAIL_FONT_STACK};font-size:15px;font-weight:600;line-height:1.2;color:${brand.accentText};text-decoration:none;">${escapeHtml(
      label,
    )}</a>`,
    "</td>",
    "</tr>",
    "</table>",
  ].join("\n");

export type EmailStep = {
  readonly title: string;
  readonly body: string;
  readonly link?: { readonly href: string; readonly label: string };
};

/** Numbered first steps, stacked as table rows so they survive every client. */
export const emailSteps = (steps: ReadonlyArray<EmailStep>): string =>
  [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-steps" style="width:100%;margin:2px 0 6px;border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;">',
    ...steps.map(
      (step, index) =>
        `<tr><td width="30" valign="top" style="width:30px;padding:2px 10px 18px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-spacing:0;"><tr><td width="24" height="24" align="center" valign="middle" bgcolor="${EMAIL_COLORS.brandMuted}" class="email-step-number" style="width:24px;height:24px;background:${EMAIL_COLORS.brandMuted};border-radius:12px;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:24px;font-weight:650;color:${EMAIL_COLORS.link};">${index + 1}</td></tr></table></td><td valign="top" style="padding:0 0 18px;"><p dir="ltr" class="email-text" style="margin:0 0 3px;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.45;font-weight:600;color:${EMAIL_COLORS.text};overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
          step.title,
        )}</p><p dir="ltr" class="email-muted" style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.55;color:${EMAIL_COLORS.muted};overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(
          step.body,
        )}${step.link ? `<br />${emailTextLink(step.link.href, step.link.label)}` : ""}</p></td></tr>`,
    ),
    "</table>",
  ].join("\n");

export const emailSignature = (
  replyTo: string,
  name = "Oscar",
  role = "Founder, Mattrax",
): string =>
  [
    `<p class="email-text" dir="ltr" style="margin:22px 0 0;font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.text};overflow-wrap:anywhere;word-break:break-word;">${emailIsolate(
      name,
    )}<br />${escapeHtml(
      role,
    )}<br /><span class="email-muted" style="color:${EMAIL_COLORS.muted};font-size:14px;">Replies go to ${emailIsolate(
      replyTo,
    )}.</span></p>`,
  ].join("\n");

export type EmailFooterInput = {
  /** Why this person received the message; usually includes account context. */
  readonly reason: string;
  /** Escaped HTML reason, when interpolated values need bidi isolation. */
  readonly reasonHtml?: string;
  readonly supportEmail?: string | null;
  readonly unsubscribeUrl?: string | null;
};

export const emailFooter = (input: EmailFooterInput): string =>
  [
    emailFootnote(input.reasonHtml ?? escapeHtml(input.reason), 8),
    ...(input.supportEmail
      ? [
          emailFootnote(
            `Need help? Contact <a class="email-link" href="mailto:${escapeHtml(
              input.supportEmail,
            )}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;text-underline-offset:2px;">${escapeHtml(
              input.supportEmail,
            )}</a>.`,
            8,
          ),
        ]
      : []),
    ...(input.unsubscribeUrl
      ? [
          `<p class="email-muted" dir="ltr" style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};overflow-wrap:anywhere;word-break:break-word;"><a class="email-link" href="${escapeHtml(
            input.unsubscribeUrl,
          )}" style="color:${EMAIL_COLORS.muted};text-decoration:underline;text-underline-offset:2px;">Unsubscribe</a></p>`,
        ]
      : []),
  ].join("\n");
