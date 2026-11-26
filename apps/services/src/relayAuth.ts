import { createHmac, timingSafeEqual } from "node:crypto";
import { Option, Schema } from "effect";

/**
 * Authentication for the hosted APNs relay.
 *
 * The hosted Cloud deployment signs each request with `SERVICES_TOKEN`, the
 * same shared secret it uses for hosted billing. Self-hosted deployments use
 * their deployment licence key as a bearer token instead.
 */

export type RelaySignatureResult = "ok" | "missing" | "stale" | "invalid";

export const RelayTimestamp = Schema.FiniteFromString.pipe(Schema.check(Schema.isInt()));

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
};

/** `hex(HMAC-SHA256(token, timestamp.body))`, matching the Cloud transport. */
export const relaySignature = (token: string, timestamp: string, body: string) =>
  createHmac("sha256", token).update(`${timestamp}.${body}`).digest("hex");

export const verifyRelaySignature = (input: {
  readonly token?: string;
  readonly timestamp?: string;
  readonly signature?: string;
  readonly body: string;
  /** Current Unix time in milliseconds, supplied by the request's Clock. */
  readonly now: number;
}): RelaySignatureResult => {
  if (!input.token || !input.timestamp || !input.signature) return "missing";

  const timestamp = Option.getOrUndefined(
    Schema.decodeUnknownOption(RelayTimestamp)(input.timestamp),
  );

  if (timestamp === undefined) return "invalid";

  if (Math.abs(Math.floor(input.now / 1000) - timestamp) > 300) return "stale";

  return safeEqual(relaySignature(input.token, input.timestamp, input.body), input.signature)
    ? "ok"
    : "invalid";
};
