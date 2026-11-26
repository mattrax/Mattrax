import { Schema } from "effect";

/**
 * A delivery failure with a provider name and a secret-free reason. The
 * message is safe to persist in the outbox and show in readiness output.
 */
export class EmailFailure extends Schema.TaggedError<EmailFailure>()("EmailFailure", {
  provider: Schema.String,
  message: Schema.String,
}) {}

/** Safe, one-line failure text for logs and the outbox. */
export const describeEmailFailure = (cause: unknown): string => {
  if (cause instanceof EmailFailure) return cause.message;

  const message = cause instanceof Error ? cause.message : "delivery failed";

  return message.replaceAll(/\s+/g, " ").trim().slice(0, 300) || "delivery failed";
};
