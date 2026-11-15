/**
 * Shared transactional-email contract.
 *
 * Cloudflare's `SendEmail` binding accepts either a bare address or a
 * `{ name, email }` object for Reply-To, so both forms are supported here.
 */
export type EmailReplyTo = { readonly name?: string; readonly email: string } | string;

export type OutboundEmailMessage = {
  readonly to: string | ReadonlyArray<string>;
  readonly from: { readonly name: string; readonly email: string };
  readonly replyTo?: EmailReplyTo;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
};

export type EmailTransport = {
  send(message: OutboundEmailMessage): Promise<void>;
};
