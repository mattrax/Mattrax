import { Effect, Schema } from "effect";
import { sendSmtpMail } from "./smtp.ts";
import type { SmtpTransportOptions } from "./smtp.ts";
import { describeEmailFailure, EmailFailure } from "./failure.ts";

export { describeEmailFailure, EmailFailure } from "./failure.ts";

/**
 * Shared transactional-email contract.
 *
 * Cloudflare's `SendEmail` binding accepts either a bare address or a
 * `{ name, email }` object for Reply-To, so both forms are supported here.
 */
export type EmailReplyTo = { readonly name?: string; readonly email: string } | string;

export type EmailAddress = { readonly name: string; readonly email: string };

/**
 * One attachment. Content is base64 so a rendered message survives the
 * transactional outbox's JSON column unchanged; adapters decode it at the
 * provider boundary.
 */
export type EmailAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly contentBase64: string;
};

export type OutboundEmailMessage = {
  readonly to: string | ReadonlyArray<string>;
  readonly from: EmailAddress;
  readonly replyTo?: EmailReplyTo;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: ReadonlyArray<EmailAttachment>;
};

/**
 * The mailer service contract. Implementations adapt a provider (Cloudflare
 * Email, SMTP, or the local debug mailbox) and report failures through the
 * Effect error channel so the outbox can retry without losing the outcome.
 */
export type EmailTransport = {
  readonly send: (message: OutboundEmailMessage) => Effect.Effect<void, EmailFailure>;
  /**
   * Delivers synchronously into an in-process sink (the local debug mailbox)
   * rather than through a provider. Transactional mail then bypasses the
   * durable outbox: there is nothing to retry and the caller needs the message
   * immediately. Never set this on a production transport.
   */
  readonly local?: boolean;
};

/**
 * Adapt a plain (possibly async) sender to the transport contract. The outbox
 * needs a promise per message; tests and simple adapters should not repeat the
 * `Effect.tryPromise` boilerplate.
 */
export const makeEmailTransport = (
  send: (message: OutboundEmailMessage) => void | Promise<void>,
  options: { readonly local?: boolean; readonly provider?: string } = {},
): EmailTransport => ({
  ...(options.local === undefined ? {} : { local: options.local }),
  send: (message) =>
    Effect.tryPromise({
      try: async () => {
        await send(message);
      },
      catch: (cause) =>
        new EmailFailure({
          provider: options.provider ?? "email",
          message: describeEmailFailure(cause),
        }),
    }),
});

/** Sender used when a deployment has not configured `MAIL_FROM`. */
export const DEFAULT_EMAIL_FROM: EmailAddress = {
  name: "Mattrax",
  email: "hello@mattrax.cloud",
};

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One header line; a newline in a display name would inject a header. */
const headerSafe = (value: string) => value.replaceAll(/[\r\n]+/g, " ").trim();

/**
 * Parse `MAIL_FROM` (or any sender setting). Accepts `Name <a@b>`, a quoted
 * display name and a bare address. Returns `null` for anything unusable so the
 * caller can report the misconfiguration instead of silently sending as the
 * built-in address.
 */
export const parseEmailSender = (value: string | null | undefined): EmailAddress | null => {
  const raw = value?.replaceAll(/[\r\n]+/g, " ").trim();

  if (!raw) return null;

  const angled = /^(.*)<([^<>]+)>$/.exec(raw);

  if (angled) {
    const email = angled[2].trim();

    const name = angled[1]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replaceAll(String.raw`\"`, '"');

    if (!EMAIL_ADDRESS.test(email)) return null;

    return { name: headerSafe(name) || DEFAULT_EMAIL_FROM.name, email };
  }

  if (!EMAIL_ADDRESS.test(raw)) return null;

  return { name: DEFAULT_EMAIL_FROM.name, email: raw };
};

/**
 * `"Name" <address>` for the provider APIs that take one sender string. The
 * display name is always quoted: tenant branding can contain a comma or an
 * angle bracket, which an unquoted header would parse as another mailbox.
 */
export const formatEmailAddress = (address: EmailAddress): string => {
  const name = headerSafe(address.name);

  if (!name) return `<${address.email}>`;

  return `"${name.replaceAll(/(["\\])/g, String.raw`\$1`)}" <${address.email}>`;
};

/** Normalise Reply-To into the bare or named form provider APIs accept. */
export const replyToAddress = (replyTo: EmailReplyTo): EmailAddress =>
  Schema.is(Schema.String)(replyTo)
    ? { name: DEFAULT_EMAIL_FROM.name, email: replyTo }
    : { name: replyTo.name ?? replyTo.email, email: replyTo.email };

/**
 * SMTP delivery. `node:net`/`node:tls` run in Node and in Workers with
 * `nodejs_compat`, so hosted and self-hosted deployments use one client.
 */
export const smtpEmailTransport = (options: SmtpTransportOptions): EmailTransport => ({
  send: (message) => sendSmtpMail(options, message).pipe(Effect.asVoid),
});
