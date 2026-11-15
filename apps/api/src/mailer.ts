import { Schema } from "effect";
import {
  DEFAULT_EMAIL_FROM,
  mailRelayTransport,
  parseEmailSender,
  postmarkEmailTransport,
  resendEmailTransport,
  replyToAddress,
  type EmailAddress,
  type EmailReplyTo,
  type EmailTransport,
} from "@mattrax/enterprise-backend";
import { isDevMailboxEnabled, recordDevEmail } from "./devMailbox.js";

/**
 * Outbound-email transport selection.
 *
 * One seam, three real transports and an explicit degraded mode:
 *
 * - the Cloudflare `send_email` binding (hosted default),
 * - Resend or Postmark over HTTPS (any deployment, including a container),
 * - the self-hosted `apps/mail-relay` sidecar, which speaks SMTP.
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
  /**
   * Optional readiness probe for a transport the deployment runs itself. A
   * hosted provider needs no round trip; the self-hosted relay does, because
   * the container beside it can be down while the Worker looks configured.
   */
  readonly probe?: () => Promise<void>;
};

/** The subset of the Worker environment the mailer reads. */
export type MailerEnv = {
  readonly ORIGIN: string;
  readonly EMAIL?: SendEmail;
  readonly MATTRAX_EMAIL_DISABLED?: string;
  readonly MAIL_TRANSPORT?: string;
  readonly MAIL_FROM?: string;
  readonly MAIL_RELAY_URL?: string;
  readonly MAIL_RELAY_SECRET?: string;
  readonly RESEND_API_KEY?: string;
  readonly POSTMARK_SERVER_TOKEN?: string;
  readonly MAIL_POSTMARK_STREAM?: string;
  readonly DEV_MAILBOX?: string;
  readonly DEV_MAILBOX_ALLOW_REMOTE?: string;
  readonly DEV_MAILBOX_SECRET?: string;
};

export type MailerOptions = {
  readonly fetch?: typeof globalThis.fetch;
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

/** Adapter for the Cloudflare `send_email` binding. */
export const cloudEmailTransport = (binding: SendEmail): EmailTransport => ({
  send: async (message) => {
    await binding.send({
      to: Schema.is(Schema.String)(message.to) ? message.to : [...message.to],
      from: message.from,
      replyTo: replyToForBinding(message.replyTo),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  },
});

/**
 * The local debug mailbox. `local` keeps transactional mail inline: the sink is
 * in-isolate memory with nothing to retry, and browser tests read the message
 * within the same request.
 */
export const devMailboxTransport = (): EmailTransport => ({
  local: true,
  send: async (message) => {
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
      });

      // The link is the point of the mailbox during local development.
      console.log("DEV EMAIL", to, message.subject, message.text);
    }
  },
});

const error = (detail: string, sender: EmailAddress): MailerSelection => ({
  state: "error",
  sender,
  detail,
});

/**
 * Resolve the deployment's mailer.
 *
 * Order:
 *  1. `MATTRAX_EMAIL_DISABLED` — intentional degraded mode.
 *  2. A loopback debug mailbox — local development and browser tests.
 *  3. `MAIL_TRANSPORT` when set: `resend`, `postmark`, `smtp` (relay),
 *     `cloudflare` or `disabled`.
 *  4. The Cloudflare `EMAIL` binding when present.
 *  5. Otherwise `error`.
 */
export const selectMailer = (env: MailerEnv, options: MailerOptions = {}): MailerSelection => {
  const configuredFrom = parseEmailSender(env.MAIL_FROM);
  const sender = configuredFrom ?? DEFAULT_EMAIL_FROM;
  const fetchImpl = options.fetch ?? fetch;

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

  if (transport === "resend") {
    const apiKey = trimmed(env.RESEND_API_KEY);

    if (!apiKey) return error("RESEND_API_KEY is required when MAIL_TRANSPORT=resend", sender);

    if (!configuredFrom) return error("MAIL_FROM is required when MAIL_TRANSPORT=resend", sender);

    return {
      state: "ok",
      transport: resendEmailTransport({ apiKey, fetch: fetchImpl }),
      sender: configuredFrom,
      detail: "Resend",
    };
  }

  if (transport === "postmark") {
    const apiKey = trimmed(env.POSTMARK_SERVER_TOKEN);

    if (!apiKey)
      return error("POSTMARK_SERVER_TOKEN is required when MAIL_TRANSPORT=postmark", sender);

    if (!configuredFrom) return error("MAIL_FROM is required when MAIL_TRANSPORT=postmark", sender);

    return {
      state: "ok",
      transport: postmarkEmailTransport({
        apiKey,
        fetch: fetchImpl,
        messageStream: trimmed(env.MAIL_POSTMARK_STREAM),
      }),
      sender: configuredFrom,
      detail: "Postmark",
    };
  }

  if (transport === "smtp") {
    const url = trimmed(env.MAIL_RELAY_URL);
    const secret = trimmed(env.MAIL_RELAY_SECRET);

    if (!url) return error("MAIL_RELAY_URL is required when MAIL_TRANSPORT=smtp", sender);

    if (!secret || secret.length < 16)
      return error(
        "MAIL_RELAY_SECRET must be at least 16 characters when MAIL_TRANSPORT=smtp",
        sender,
      );

    if (!configuredFrom) return error("MAIL_FROM is required when MAIL_TRANSPORT=smtp", sender);

    return {
      state: "ok",
      transport: mailRelayTransport({ url, secret, fetch: fetchImpl }),
      sender: configuredFrom,
      detail: "SMTP relay",
      probe: async () => {
        const response = await fetchImpl(`${url.replace(/\/+$/, "")}/health`);

        if (!response.ok)
          throw new Error(`mail relay health check failed with status ${response.status}`);

        await response.arrayBuffer();
      },
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
