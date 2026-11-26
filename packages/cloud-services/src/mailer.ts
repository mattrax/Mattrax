import { Effect, Schema } from "effect";
import { DEFAULT_EMAIL_FROM, EmailFailure, parseEmailSender, replyToAddress } from "@mattrax/email";
import { smtpEmailTransport } from "@mattrax/email/smtp";
import type { EmailAddress, EmailReplyTo, EmailTransport } from "@mattrax/email";
import type { SmtpTransportOptions } from "@mattrax/email/smtp";
import { isDevMailboxEnabled, recordDevEmail } from "./devMailbox.js";

/**
 * Outbound-email transport selection.
 *
 * One seam, two real transports and an explicit degraded mode:
 *
 * - the Cloudflare `send_email` binding (hosted default),
 * - SMTP for self-hosted deployments and any container,
 * - the local debug mailbox for development and browser tests.
 *
 * Selection is explicit. A deployment that is missing a setting reports
 * `error` and readiness fails; it is never silently downgraded to logging
 * messages, because that lets users believe a verification code was sent.
 * `MATTRAX_EMAIL_DISABLED` is the only way to opt out, and readiness then
 * reports `skipped` (degraded).
 */

export type MailerState = "ok" | "skipped" | "error";

export type MailerSelection = {
  readonly state: MailerState;
  /** Present only when `state === "ok"`. */
  readonly transport?: EmailTransport;
  /** Sender used by test mail and by callers without a template-specific one. */
  readonly sender: EmailAddress;
  /** Operator-facing reason. Never contains a credential. */
  readonly detail: string;
};

/**
 * The `send_email` binding surface used by the Cloudflare transport. Keeping
 * this structural avoids depending on the generated Worker globals from a
 * shared package.
 */
export interface SendEmail {
  send(message: {
    readonly to: string | ReadonlyArray<string>;
    readonly from: EmailAddress | string;
    readonly replyTo?: EmailAddress | string;
    readonly subject: string;
    readonly text?: string;
    readonly html?: string;
    readonly attachments?: ReadonlyArray<{
      readonly disposition: "attachment";
      readonly filename: string;
      readonly type: string;
      readonly content: ArrayBuffer;
    }>;
  }): Promise<{ readonly messageId: string }>;
}

/** The subset of the Worker environment the mailer reads. */
export type MailerEnv = {
  readonly ORIGIN: string;
  readonly EMAIL?: SendEmail;
  readonly MATTRAX_EMAIL_DISABLED?: string;
  readonly MAIL_TRANSPORT?: string;
  readonly MAIL_FROM?: string;
  readonly MAIL_SMTP_HOST?: string;
  readonly MAIL_SMTP_PORT?: string;
  readonly MAIL_SMTP_SECURE?: string;
  readonly MAIL_SMTP_USER?: string;
  readonly MAIL_SMTP_PASSWORD?: string;
  readonly MAIL_SMTP_HELO?: string;
  readonly DEV_MAILBOX?: string;
  readonly DEV_MAILBOX_ALLOW_REMOTE?: string;
  readonly DEV_MAILBOX_SECRET?: string;
};

const enabled = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const trimmed = (value: string | undefined) => {
  const result = value?.trim();

  return result ? result : undefined;
};

/**
 * Cloudflare's structured address requires `name`; a bare Reply-To string is
 * also accepted, so normalise our optional-name form at the binding boundary.
 */
const replyToForBinding = (replyTo: EmailReplyTo | undefined) =>
  replyTo === undefined
    ? undefined
    : Schema.is(Schema.String)(replyTo)
      ? replyTo
      : { name: replyTo.name ?? replyTo.email, email: replyTo.email };

/** Decode a base64 attachment for the binding's ArrayBuffer field. */
const attachmentContent = (base64: string): ArrayBuffer => {
  const bytes = Buffer.from(base64.replaceAll(/\s+/g, ""), "base64");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
};

/** Adapter for the Cloudflare `send_email` binding. */
export const cloudEmailTransport = (binding: SendEmail): EmailTransport => ({
  send: (message) =>
    Effect.tryPromise({
      try: () =>
        binding.send({
          to: Schema.is(Schema.String)(message.to) ? message.to : [...message.to],
          from: message.from,
          replyTo: replyToForBinding(message.replyTo),
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((attachment) => ({
                  disposition: "attachment" as const,
                  filename: attachment.filename,
                  type: attachment.contentType,
                  content: attachmentContent(attachment.contentBase64),
                })),
              }
            : {}),
        }),
      catch: (cause) =>
        new EmailFailure({
          provider: "Cloudflare Email",
          message: cause instanceof Error ? cause.message : "delivery failed",
        }),
    }).pipe(Effect.asVoid),
});

/**
 * The local debug mailbox. `local` keeps transactional mail inline: the sink is
 * in-isolate memory with nothing to retry, and browser tests read the message
 * within the same request.
 */
export const devMailboxTransport = (): EmailTransport => ({
  local: true,
  send: (message) =>
    Effect.sync(() => {
      const recipients = Schema.is(Schema.String)(message.to) ? [message.to] : [...message.to];

      const replyTo =
        message.replyTo === undefined ? undefined : replyToAddress(message.replyTo).email;

      for (const to of recipients) {
        recordDevEmail({
          to,
          replyTo,
          subject: message.subject,
          text: message.text ?? "",
          html: message.html,
          attachments: message.attachments,
        });

        // The link is the point of the mailbox during local development.
        console.log("DEV EMAIL", to, message.subject, message.text);
      }
    }),
});

const error = (detail: string, sender: EmailAddress): MailerSelection => ({
  state: "error",
  sender,
  detail,
});

/**
 * Read the SMTP settings. Returns the option bag or the operator-facing reason
 * one is missing; every value is trimmed so a stray newline in a secret does
 * not produce a confusing authentication failure.
 */
const smtpOptions = (
  env: MailerEnv,
): { readonly options: SmtpTransportOptions } | { readonly problem: string } => {
  const host = trimmed(env.MAIL_SMTP_HOST);

  if (!host) return { problem: "MAIL_SMTP_HOST is required when MAIL_TRANSPORT=smtp" };

  const port = trimmed(env.MAIL_SMTP_PORT);
  const parsedPort = port === undefined ? undefined : Number(port);

  if (
    parsedPort !== undefined &&
    (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65_535)
  )
    return { problem: "MAIL_SMTP_PORT must be a TCP port number" };

  return {
    options: {
      host,
      port: parsedPort,
      secure: enabled(env.MAIL_SMTP_SECURE),
      user: trimmed(env.MAIL_SMTP_USER),
      password: trimmed(env.MAIL_SMTP_PASSWORD),
      helo: trimmed(env.MAIL_SMTP_HELO),
    },
  };
};

/**
 * Resolve the deployment's mailer.
 *
 * Order:
 *  1. `MATTRAX_EMAIL_DISABLED` — intentional degraded mode.
 *  2. A loopback debug mailbox — local development and browser tests.
 *  3. `MAIL_TRANSPORT` when set: `smtp`, `cloudflare` or `disabled`.
 *  4. The Cloudflare `EMAIL` binding when present.
 *  5. Otherwise `error`.
 */
export const selectMailer = (env: MailerEnv): MailerSelection => {
  const configuredFrom = parseEmailSender(env.MAIL_FROM);
  const sender = configuredFrom ?? DEFAULT_EMAIL_FROM;

  if (enabled(env.MATTRAX_EMAIL_DISABLED))
    return { state: "skipped", sender, detail: "email is disabled" };

  // A malformed sender must not silently fall back to the built-in address:
  // every provider would reject it, or deliver as the wrong identity.
  if (trimmed(env.MAIL_FROM) && !configuredFrom)
    return error("MAIL_FROM is not a valid email address", sender);

  if (isDevMailboxEnabled(env, env.ORIGIN, env.ORIGIN))
    return {
      state: "ok",
      transport: devMailboxTransport(),
      sender,
      detail: "local debug mailbox",
    };

  const transport = trimmed(env.MAIL_TRANSPORT)?.toLowerCase();

  if (transport === "disabled")
    return { state: "skipped", sender, detail: "MAIL_TRANSPORT is disabled" };

  if (transport === "smtp") {
    const smtp = smtpOptions(env);

    if ("problem" in smtp) return error(smtp.problem, sender);

    if (!configuredFrom) return error("MAIL_FROM is required when MAIL_TRANSPORT=smtp", sender);

    return {
      state: "ok",
      transport: smtpEmailTransport(smtp.options),
      sender: configuredFrom,
      detail: "SMTP",
    };
  }

  if (transport === "cloudflare" && !env.EMAIL)
    return error("MAIL_TRANSPORT=cloudflare requires the EMAIL binding", sender);

  if (transport && transport !== "cloudflare")
    return error(`MAIL_TRANSPORT=${transport} is not a supported transport`, sender);

  if (env.EMAIL)
    return {
      state: "ok",
      transport: cloudEmailTransport(env.EMAIL),
      sender,
      detail: "Cloudflare Email",
    };

  return error(
    "no outbound email transport is configured; set MAIL_TRANSPORT and MAIL_FROM, or MATTRAX_EMAIL_DISABLED=1",
    sender,
  );
};

/**
 * Readiness projection for `/api/ready`. A missing or broken mailer throws so
 * the probe fails with `mailer: error`; an explicit opt-out is `skipped`, which
 * makes the overall status degraded rather than healthy.
 */
export const mailerReadiness = (selection: MailerSelection): "ok" | "skipped" => {
  if (selection.state === "ok") return "ok";

  if (selection.state === "skipped") return "skipped";

  throw new Error(selection.detail);
};
