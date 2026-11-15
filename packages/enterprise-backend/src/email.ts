import { Schema } from "effect";

/**
 * Shared transactional-email contract.
 *
 * Cloudflare's `SendEmail` binding accepts either a bare address or a
 * `{ name, email }` object for Reply-To, so both forms are supported here.
 */
export type EmailReplyTo = { readonly name?: string; readonly email: string } | string;

export type EmailAddress = { readonly name: string; readonly email: string };

export type OutboundEmailMessage = {
  readonly to: string | ReadonlyArray<string>;
  readonly from: EmailAddress;
  readonly replyTo?: EmailReplyTo;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
};

export type EmailTransport = {
  send(message: OutboundEmailMessage): Promise<void>;
  /**
   * Delivers synchronously into an in-process sink (the local debug mailbox)
   * rather than through a provider. Transactional mail then bypasses the
   * durable outbox: there is nothing to retry and the caller needs the message
   * immediately. Never set this on a production transport.
   */
  readonly local?: boolean;
};

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
    const email = angled[2]!.trim();
    const name = angled[1]!
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replaceAll('\\"', '"');

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

  return `"${name.replaceAll(/(["\\])/g, "\\$1")}" <${address.email}>`;
};

/** Normalise Reply-To into the bare or named form provider APIs accept. */
export const replyToAddress = (replyTo: EmailReplyTo): EmailAddress =>
  Schema.is(Schema.String)(replyTo)
    ? { name: DEFAULT_EMAIL_FROM.name, email: replyTo }
    : { name: replyTo.name ?? replyTo.email, email: replyTo.email };

const replyToValue = (replyTo: EmailReplyTo | undefined): string | undefined =>
  replyTo === undefined ? undefined : formatEmailAddress(replyToAddress(replyTo));

const recipientsOf = (to: string | ReadonlyArray<string>): string[] =>
  Schema.is(Schema.String)(to) ? [to] : [...to];

/** Provider errors name the provider and status only: never the recipient. */
const rejection = (provider: string, status: number) =>
  new Error(`${provider} rejected the message with status ${status}`);

export type HttpEmailTransportOptions = {
  readonly apiKey: string;
  readonly fetch: typeof globalThis.fetch;
  /** Overrides the provider's production endpoint (tests and proxies). */
  readonly endpoint?: string;
};

/**
 * Resend's send API. The key is only ever sent in the Authorization header and
 * never appears in an error, so a failure can be persisted safely.
 */
export const resendEmailTransport = (options: HttpEmailTransportOptions): EmailTransport => {
  const endpoint = options.endpoint ?? "https://api.resend.com/emails";

  return {
    send: async (message) => {
      const response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: formatEmailAddress(message.from),
          to: recipientsOf(message.to),
          subject: message.subject,
          text: message.text,
          html: message.html,
          reply_to: replyToValue(message.replyTo),
        }),
      });

      if (!response.ok) throw rejection("Resend", response.status);

      // Drain the body so the connection can be reused by the runtime.
      await response.arrayBuffer();
    },
  };
};

/**
 * Postmark's transactional API. Postmark requires the message stream that the
 * server token belongs to; `outbound` is the default stream every server has.
 */
export const postmarkEmailTransport = (
  options: HttpEmailTransportOptions & { readonly messageStream?: string },
): EmailTransport => {
  const endpoint = options.endpoint ?? "https://api.postmarkapp.com/email";
  const messageStream = options.messageStream ?? "outbound";

  return {
    send: async (message) => {
      const response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          "x-postmark-server-token": options.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: formatEmailAddress(message.from),
          To: recipientsOf(message.to).join(", "),
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          ReplyTo: replyToValue(message.replyTo),
          MessageStream: messageStream,
        }),
      });

      if (!response.ok) throw rejection("Postmark", response.status);

      await response.arrayBuffer();
    },
  };
};

export type MailRelayTransportOptions = {
  readonly url: string;
  readonly secret: string;
  readonly fetch: typeof globalThis.fetch;
};

/**
 * HTTP client for the self-hosted `apps/mail-relay` sidecar, which speaks SMTP
 * to whatever mailbox the operator already has. The container has no way to
 * open an SMTP connection itself, and an HTTP hop keeps the Worker transport
 * seam identical to a hosted provider.
 */
export const mailRelayTransport = (options: MailRelayTransportOptions): EmailTransport => {
  const endpoint = `${options.url.replace(/\/+$/, "")}/send`;

  return {
    send: async (message) => {
      const response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: recipientsOf(message.to),
          from: message.from,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (!response.ok) throw rejection("Mail relay", response.status);

      await response.arrayBuffer();
    },
  };
};
