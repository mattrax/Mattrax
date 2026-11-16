/**
 * Environment defaults that must be in place before the shared API runtime is
 * imported.
 *
 * The Worker entry is never built without a mail binding or an explicit opt-out
 * (the deploy config decides). A container may have neither, and the supported
 * answer there is the same degraded readiness the previous host produced: no
 * transport means `mailer: skipped`, not a failed probe.
 */
if (!process.env.MAIL_TRANSPORT?.trim() && !process.env.MATTRAX_EMAIL_DISABLED)
  process.env.MATTRAX_EMAIL_DISABLED = "1";
