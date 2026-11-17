const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BUTTON_BACKGROUND = "#18181b";

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type OnboardingEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

export type WelcomeEmailInput = {
  readonly firstName?: string | null;
  readonly dashboardUrl: string;
  /** When absent the dashboard is used so the CTA always has somewhere to go. */
  readonly enrollUrl?: string | null;
  readonly replyTo: string;
  readonly supportEmail?: string | null;
  readonly unsubscribeUrl?: string | null;
};

export type OnboardingFollowUpEmailInput = {
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

const footerHtml = (input: FooterInput): string[] => [
  `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#78716c;">${escapeHtml(
    input.reason,
  )}</p>`,
  ...(input.supportEmail
    ? [
        `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#78716c;">Need help? Contact <a href="mailto:${escapeHtml(
          input.supportEmail,
        )}" style="color:#57534e;">${escapeHtml(input.supportEmail)}</a>.</p>`,
      ]
    : []),
  ...(input.unsubscribeUrl
    ? [
        `<p style="margin:0;font-size:12px;line-height:1.5;color:#78716c;"><a href="${escapeHtml(
          input.unsubscribeUrl,
        )}" style="color:#57534e;">Unsubscribe</a></p>`,
      ]
    : []),
];

const htmlShell = (subject: string, preheader: string, content: string[]): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(subject)}</title>`,
    "</head>",
    `<body style="margin:0;padding:0;background:#f5f5f4;font-family:${FONT_STACK};color:#1c1917;">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`,
    '<div style="max-width:520px;margin:0 auto;padding:32px 20px;">',
    '<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:32px;">',
    '<div style="font-size:14px;font-weight:700;letter-spacing:0.02em;color:#1c1917;margin:0 0 24px;">Mattrax</div>',
    ...content,
    "</div>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");

const paragraph = (value: string, muted = false): string =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${
    muted ? "#57534e" : "#1c1917"
  };">${value}</p>`;

const primaryButton = (href: string, label: string): string =>
  `<p style="margin:0 0 12px;"><a data-cta="primary" href="${escapeHtml(
    href,
  )}" style="display:inline-block;background:${BUTTON_BACKGROUND};color:#ffffff;padding:12px 22px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(
    label,
  )}</a></p>`;

const fallbackUrl = (href: string): string =>
  `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#57534e;">Or paste this link into your browser:<br /><span style="word-break:break-all;">${escapeHtml(
    href,
  )}</span></p>`;

const signatureHtml = (replyTo: string): string =>
  `<p style="margin:24px 0 0;font-size:16px;line-height:1.6;">Oscar<br />Founder, Mattrax<br /><span style="font-size:14px;color:#57534e;">Replies go to ${escapeHtml(
    replyTo,
  )}.</span></p>`;

/**
 * The welcome email. Pure: no sender, transport, database or environment is
 * involved, so the copy and markup can be tested directly.
 */
export const welcomeEmail = (input: WelcomeEmailInput): OnboardingEmail => {
  const name = firstName(input.firstName);
  const dashboardUrl = absoluteHttpUrl(input.dashboardUrl, "dashboardUrl");
  const enrollUrl = enrolTarget(input.enrollUrl, dashboardUrl);
  const replyTo = requireReplyTo(input.replyTo);
  const support = supportAddress(input.supportEmail);
  const unsubscribeUrl = optionalHttpUrl(input.unsubscribeUrl, "unsubscribeUrl");

  const subject = "Welcome to Mattrax";
  const preheader = "Thanks for signing up — here's the one thing to do first.";

  const text = [
    preheader,
    "",
    greeting(name),
    "",
    "Welcome to Mattrax. You signed up to manage your fleet, not to spend your week in GPOs, spreadsheets and a dozen browser tabs. Mattrax exists to put Macs, Windows and Android under one roof, with policies, compliance and inventory in one place.",
    "",
    "The one thing to do first is enrol your first device. Everything else — policies, apps, compliance — starts working once a single device checks in.",
    "",
    `Enrol your first device: ${enrollUrl}`,
    `Your dashboard: ${dashboardUrl}`,
    "",
    "Enrolment takes about ten minutes. When the device checks in you'll see it in the dashboard with its compliance state and the policies that applied.",
    "",
    "You don't need to get everything right today. One device is enough to see how it feels, and you can add the rest whenever you're ready.",
    "",
    "Reply to this email and it comes straight to me. I read every reply, and what you expected versus what actually happened is the most useful thing you can tell me.",
    "",
    "Oscar",
    "Founder, Mattrax",
    `Replies go to ${replyTo}.`,
    "",
    "P.S. If a walkthrough would help, reply and we'll find a time.",
    "",
    ...footerText({
      reason: "You're getting this because you signed up for Mattrax.",
      supportEmail: support,
      unsubscribeUrl,
    }),
  ].join("\n");

  const html = htmlShell(
    subject,
    preheader,
    [
      '<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;">Welcome to Mattrax</h1>',
      paragraph(escapeHtml(greeting(name))),
      paragraph(
        "Welcome to Mattrax. You signed up to manage your fleet, not to spend your week in GPOs, spreadsheets and a dozen browser tabs. Mattrax exists to put Macs, Windows and Android under one roof, with policies, compliance and inventory in one place.",
      ),
      paragraph(
        "The one thing to do first is enrol your first device. Everything else — policies, apps, compliance — starts working once a single device checks in.",
      ),
      primaryButton(enrollUrl, "Enrol your first device"),
      fallbackUrl(enrollUrl),
      paragraph(
        `Or open <a href="${escapeHtml(
          dashboardUrl,
        )}" style="color:#1c1917;">your dashboard</a> and enrol from there.`,
      ),
      paragraph(
        "Enrolment takes about ten minutes. When the device checks in you'll see it in the dashboard with its compliance state and the policies that applied.",
      ),
      paragraph(
        "You don't need to get everything right today. One device is enough to see how it feels, and you can add the rest whenever you're ready.",
      ),
      paragraph(
        "Reply to this email and it comes straight to me. I read every reply, and what you expected versus what actually happened is the most useful thing you can tell me.",
      ),
      signatureHtml(replyTo),
      paragraph("P.S. If a walkthrough would help, reply and we'll find a time.", true),
    ].concat(
      footerHtml({
        reason: "You're getting this because you signed up for Mattrax.",
        supportEmail: support,
        unsubscribeUrl,
      }),
    ),
  );

  return { subject, text, html };
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

  const subject = "Did you get a chance to try Mattrax?";
  const preheader = "A quick check-in on your first device.";

  const since = days
    ? `It's been ${days} ${days === 1 ? "day" : "days"} since you set up ${tenant} on Mattrax, and no device has enrolled yet.`
    : `It's been about a week since you set up ${tenant} on Mattrax, and no device has enrolled yet.`;

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
    ...footerText({
      reason: `You're getting this because ${tenant} was created on Mattrax.`,
      supportEmail: support,
      unsubscribeUrl,
    }),
  ].join("\n");

  const html = htmlShell(
    subject,
    preheader,
    [
      '<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;">Did you get a chance to try Mattrax?</h1>',
      paragraph(escapeHtml(greeting(name))),
      paragraph(escapeHtml(since)),
      paragraph(
        "No pressure — I just wanted to check in. Did something get in the way? Enrolment is usually the fiddliest part of getting started, and it's often one small thing: a certificate, a network rule, an Apple or Google account setting. If that's where you stopped, I can save you the guesswork.",
      ),
      paragraph("Two ways forward:"),
      primaryButton(enrollUrl, "Finish enrolling a device"),
      fallbackUrl(enrollUrl),
      paragraph(
        `<a href="mailto:${escapeHtml(
          replyTo,
        )}" style="color:#1c1917;">Reply and tell me where you got stuck</a> — replies come straight to me. I read every one.`,
      ),
      paragraph(
        "A working device is the quickest way to see whether Mattrax fits how your team works. If it's easier, I'm happy to do a short walkthrough and get the first device enrolled with you.",
      ),
      signatureHtml(replyTo),
    ].concat(
      footerHtml({
        reason: `You're getting this because ${tenant} was created on Mattrax.`,
        supportEmail: support,
        unsubscribeUrl,
      }),
    ),
  );

  return { subject, text, html };
};
