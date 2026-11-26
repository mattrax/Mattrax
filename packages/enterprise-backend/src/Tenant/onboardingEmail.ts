import {
  emailButton,
  emailDocument,
  emailFooter,
  emailFootnote,
  emailHeading,
  emailIsolate,
  emailParagraph,
  emailSignature,
  emailSteps,
  emailTextLink,
  resolveEmailBrand,
} from "../Mail/emailLayout.ts";
import { escapeHtml, headerValue, trimOrNull } from "../Mail/emailTemplate.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OnboardingEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

/** Optional deployment or tenant branding. Everything falls back to Mattrax. */
export type OnboardingEmailBranding = {
  readonly brandName?: string | null;
  readonly logoUrl?: string | null;
  readonly brandColor?: string | null;
};

export type WelcomeEmailInput = OnboardingEmailBranding & {
  readonly firstName?: string | null;
  readonly dashboardUrl: string;
  /** Defaults to `/tenants/new` on the dashboard origin. */
  readonly createTenantUrl?: string | null;
  /**
   * @deprecated A tenantless welcome has no enrollment page. Callers that do
   * know a tenant may still pass one; it becomes an additional link on the
   * device step. Production intentionally omits it.
   */
  readonly enrollUrl?: string | null;
  /** Defaults to the quick-start guide on the dashboard origin. */
  readonly docsUrl?: string | null;
  readonly replyTo: string;
  readonly supportEmail?: string | null;
  readonly unsubscribeUrl?: string | null;
  /** Account context in the footer; no tenant exists yet at sign-up. */
  readonly accountEmail?: string | null;
};

export type OnboardingFollowUpEmailInput = OnboardingEmailBranding & {
  readonly firstName?: string | null;
  readonly tenantName: string;
  readonly dashboardUrl: string;
  /** When absent the dashboard is used so the CTA always has somewhere to go. */
  readonly enrollUrl?: string | null;
  readonly replyTo: string;
  readonly supportEmail?: string | null;
  readonly daysSinceCreation?: number | null;
  readonly unsubscribeUrl?: string | null;
};

/** Required links must be absolute http(s); relative or script URLs are a bug. */
const absoluteHttpUrl = (value: string, field: string): string => {
  const trimmed = value.trim();

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${field} must be an absolute http(s) URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`${field} must be an absolute http(s) URL`);

  return trimmed;
};

const optionalHttpUrl = (value: string | null | undefined, field: string): string | null => {
  const trimmed = trimOrNull(value);

  return trimmed ? absoluteHttpUrl(trimmed, field) : null;
};

/** An invalid optional support address is dropped rather than rendered. */
const supportAddress = (value: string | null | undefined): string | null => {
  const trimmed = trimOrNull(value);

  return trimmed && EMAIL.test(trimmed) ? trimmed : null;
};

const requireReplyTo = (value: string): string => {
  const trimmed = trimOrNull(value);

  if (!trimmed || !EMAIL.test(trimmed)) throw new Error("replyTo must be a valid email address");

  return trimmed;
};

const firstName = (value: string | null | undefined): string | null => {
  const trimmed = trimOrNull(value);

  return trimmed ? headerValue(trimmed) : null;
};

const greeting = (name: string | null): string => (name ? `Hey ${name},` : "Hey,");

const enrolTarget = (enrollUrl: string | null | undefined, dashboardUrl: string): string => {
  const trimmed = trimOrNull(enrollUrl);

  return trimmed ? absoluteHttpUrl(trimmed, "enrollUrl") : dashboardUrl;
};

const originOf = (url: string): string => new URL(url).origin;

const createTenantTarget = (
  createTenantUrl: string | null | undefined,
  dashboardUrl: string,
): string => {
  const trimmed = trimOrNull(createTenantUrl);

  return trimmed
    ? absoluteHttpUrl(trimmed, "createTenantUrl")
    : `${originOf(dashboardUrl)}/tenants/new`;
};

const docsTarget = (docsUrl: string | null | undefined, dashboardUrl: string): string => {
  const trimmed = trimOrNull(docsUrl);

  return trimmed
    ? absoluteHttpUrl(trimmed, "docsUrl")
    : `${originOf(dashboardUrl)}/docs/getting-started/quick-start`;
};

const followUpDays = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  return Math.max(1, Math.round(value));
};

type FooterInput = {
  readonly reason: string;
  readonly supportEmail: string | null;
  readonly unsubscribeUrl: string | null;
};

const footerText = (input: FooterInput): string[] => [
  input.reason,
  ...(input.supportEmail ? [`Need help? Contact ${input.supportEmail}.`] : []),
  ...(input.unsubscribeUrl ? [`Unsubscribe: ${input.unsubscribeUrl}`] : []),
];

const brandFor = (
  input: OnboardingEmailBranding,
  fallbackName = "Mattrax",
  origin: string | null = null,
) =>
  resolveEmailBrand({
    name: input.brandName,
    logoUrl: input.logoUrl,
    brandColor: input.brandColor,
    origin,
    fallbackName,
  });

/**
 * The welcome email. Pure: no sender, transport, database or environment is
 * involved, so the copy and markup can be tested directly.
 *
 * A verified account has no tenant yet, so the first step creates one; it never
 * links to an enrolment page that does not exist for a tenantless account.
 * The copy is written once and rendered into both the HTML and plain-text
 * bodies, so the two alternatives cannot drift.
 */
export const welcomeEmail = (input: WelcomeEmailInput): OnboardingEmail => {
  const name = firstName(input.firstName);
  const dashboardUrl = absoluteHttpUrl(input.dashboardUrl, "dashboardUrl");
  const createTenantUrl = createTenantTarget(input.createTenantUrl, dashboardUrl);
  const enrollUrl = optionalHttpUrl(input.enrollUrl, "enrollUrl");
  const docsUrl = docsTarget(input.docsUrl, dashboardUrl);
  const replyTo = requireReplyTo(input.replyTo);
  const support = supportAddress(input.supportEmail);
  const unsubscribeUrl = optionalHttpUrl(input.unsubscribeUrl, "unsubscribeUrl");
  const accountEmail = trimOrNull(input.accountEmail);
  const brand = brandFor(input, "Mattrax", originOf(dashboardUrl));

  const footerReason = accountEmail
    ? `You're receiving this because the ${brand.name} account ${accountEmail} was created.`
    : `You're receiving this because you created a ${brand.name} account.`;

  const footerReasonHtml = accountEmail
    ? `You're receiving this because the ${emailIsolate(
        brand.name,
      )} account ${emailIsolate(accountEmail)} was created.`
    : `You're receiving this because you created a ${emailIsolate(brand.name)} account.`;

  const founder = brand.name.toLowerCase() === "mattrax";

  const copy = {
    subject: `Welcome to ${brand.name}`,
    preheader: "Your account is ready. Create a tenant, set a policy and enrol your first device.",
    heading: `Welcome to ${brand.name}`,
    greeting: greeting(name),
    intro:
      "Mattrax is device management for Mac, Windows and Android in one place: policies, compliance, inventory and software, without the GPOs, spreadsheets and browser tabs.",
    lead: "Your account is ready. This is the order that gets you from signing up to a managed fleet: create a tenant, set a policy, then enrol a device.",
    steps: [
      {
        title: "Create your tenant",
        body: "Name your team and choose a slug. You'll land in the tenant dashboard straight after, and everything else lives inside it.",
        link: { href: createTenantUrl, label: "Create your tenant" },
      },
      {
        title: "Set a baseline policy",
        body: "Open Policies and apply a policy so settings, compliance and software updates are managed from one place.",
      },
      {
        title: "Enrol your first device",
        body: "In that tenant, open Devices → Enrollment and follow the steps for Mac, Windows or Android. Enrolment usually takes about ten minutes.",
        ...(enrollUrl ? { link: { href: enrollUrl, label: "Open enrolment" } } : {}),
      },
    ],
    cta: "Open your dashboard",
    secondary: "Read the quick start",
    founderNote: "Questions? Reply to this email and it comes straight to me. I read every reply.",
    signoff: "Oscar",
    signoffRole: founder ? "Founder, Mattrax" : "The Mattrax team",
    replyLine: `Replies go to ${replyTo}.`,
    footerReason,
    footerReasonHtml,
  };

  const text = [
    copy.preheader,
    "",
    copy.greeting,
    "",
    copy.intro,
    "",
    copy.lead,
    "",
    ...copy.steps.flatMap((step, index) => [
      `${index + 1}. ${step.title}`,
      `   ${step.body}`,
      ...(step.link ? [`   ${step.link.label}: ${step.link.href}`] : []),
      "",
    ]),
    `${copy.cta}: ${dashboardUrl}`,
    `${copy.secondary}: ${docsUrl}`,
    "",
    copy.founderNote,
    "",
    copy.signoff,
    copy.signoffRole,
    copy.replyLine,
    "",
    ...footerText({ reason: copy.footerReason, supportEmail: support, unsubscribeUrl }),
  ].join("\n");

  const content = [
    emailHeading(`Welcome to ${emailIsolate(brand.name)}`),
    emailParagraph(emailIsolate(copy.greeting)),
    emailParagraph(escapeHtml(copy.intro)),
    emailParagraph(escapeHtml(copy.lead), { bottom: 10 }),
    emailSteps(copy.steps),
    emailButton(dashboardUrl, copy.cta, brand),
    emailFootnote(
      `Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
        dashboardUrl,
      )}</span>`,
      16,
    ),
    emailParagraph(emailTextLink(docsUrl, copy.secondary), { muted: true, bottom: 18 }),
    emailParagraph(escapeHtml(copy.founderNote), { bottom: 0 }),
    emailSignature(replyTo, copy.signoff, copy.signoffRole),
  ].join("\n");

  const html = emailDocument({
    subject: copy.subject,
    preheader: copy.preheader,
    brand,
    content,
    footer: emailFooter({
      reason: copy.footerReason,
      reasonHtml: copy.footerReasonHtml,
      supportEmail: support,
      unsubscribeUrl,
    }),
  });

  return { subject: copy.subject, text, html };
};

/**
 * The nudge sent roughly a week after a tenant was created without an enrolled
 * device. Deliberately conversational: it offers a path forward, not a guilt
 * trip.
 */
export const onboardingFollowUpEmail = (input: OnboardingFollowUpEmailInput): OnboardingEmail => {
  const name = firstName(input.firstName);
  const tenant = headerValue(input.tenantName) || "your team";
  const dashboardUrl = absoluteHttpUrl(input.dashboardUrl, "dashboardUrl");
  const enrollUrl = enrolTarget(input.enrollUrl, dashboardUrl);
  const replyTo = requireReplyTo(input.replyTo);
  const support = supportAddress(input.supportEmail);
  const unsubscribeUrl = optionalHttpUrl(input.unsubscribeUrl, "unsubscribeUrl");
  const days = followUpDays(input.daysSinceCreation);
  const brand = brandFor(input, tenant, originOf(dashboardUrl));

  const subject = "Did you get a chance to try Mattrax?";
  const preheader = "A quick check-in on your first device.";

  const since = days
    ? `It's been ${days} ${days === 1 ? "day" : "days"} since you set up ${tenant} on Mattrax, and no device has enrolled yet.`
    : `It's been about a week since you set up ${tenant} on Mattrax, and no device has enrolled yet.`;

  const sinceHtml = days
    ? `It's been ${days} ${days === 1 ? "day" : "days"} since you set up ${emailIsolate(
        tenant,
      )} on Mattrax, and no device has enrolled yet.`
    : `It's been about a week since you set up ${emailIsolate(
        tenant,
      )} on Mattrax, and no device has enrolled yet.`;

  const footerReason = `You're getting this because ${tenant} was created on Mattrax.`;
  const footerReasonHtml = `You're getting this because ${emailIsolate(
    tenant,
  )} was created on Mattrax.`;

  const text = [
    preheader,
    "",
    greeting(name),
    "",
    since,
    "",
    "No pressure — I just wanted to check in. Did something get in the way? Enrolment is usually the fiddliest part of getting started, and it's often one small thing: a certificate, a network rule, an Apple or Google account setting. If that's where you stopped, I can save you the guesswork.",
    "",
    "Two ways forward:",
    "",
    `Finish enrolling a device: ${enrollUrl}`,
    `Reply and tell me where you got stuck: ${replyTo}`,
    "",
    "Reply to this email and it comes straight to me. I read every reply.",
    "",
    "A working device is the quickest way to see whether Mattrax fits how your team works. If it's easier, I'm happy to do a short walkthrough and get the first device enrolled with you.",
    "",
    "Oscar",
    "Founder, Mattrax",
    `Replies go to ${replyTo}.`,
    "",
    ...footerText({ reason: footerReason, supportEmail: support, unsubscribeUrl }),
  ].join("\n");

  const content = [
    emailHeading("Did you get a chance to try Mattrax?"),
    emailParagraph(emailIsolate(greeting(name))),
    emailParagraph(sinceHtml),
    emailParagraph(
      "No pressure — I just wanted to check in. Did something get in the way? Enrolment is usually the fiddliest part of getting started, and it's often one small thing: a certificate, a network rule, an Apple or Google account setting. If that's where you stopped, I can save you the guesswork.",
    ),
    emailParagraph("Two ways forward:", { bottom: 8 }),
    emailButton(enrollUrl, "Finish enrolling a device", brand),
    emailFootnote(
      `Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
        enrollUrl,
      )}</span>`,
      16,
    ),
    emailParagraph(
      `${emailTextLink(
        `mailto:${replyTo}`,
        "Reply and tell me where you got stuck",
      )} — replies come straight to me. I read every one.`,
      { muted: true, bottom: 20 },
    ),
    emailParagraph(
      "A working device is the quickest way to see whether Mattrax fits how your team works. If it's easier, I'm happy to do a short walkthrough and get the first device enrolled with you.",
    ),
    emailSignature(replyTo),
  ].join("\n");

  const html = emailDocument({
    subject,
    preheader,
    brand,
    content,
    footer: emailFooter({
      reason: footerReason,
      reasonHtml: footerReasonHtml,
      supportEmail: support,
      unsubscribeUrl,
    }),
  });

  return { subject, text, html };
};
