import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Authentication for the hosted APNs relay.
 *
 * The hosted Cloud deployment signs each request with `SERVICES_TOKEN`, the
 * same shared secret it uses for hosted billing. Self-hosted deployments use
 * their deployment licence key as a bearer token instead.
 */

export type RelaySignatureResult = "ok" | "missing" | "stale" | "invalid";

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
  /** Test seam; defaults to the current time. */
  readonly now?: number;
}): RelaySignatureResult => {
  if (!input.token || !input.timestamp || !input.signature) return "missing";

  const timestamp = Number(input.timestamp);

  if (!Number.isFinite(timestamp)) return "invalid";

  if (Math.abs(Math.floor((input.now ?? Date.now()) / 1000) - timestamp) > 300) return "stale";

  return safeEqual(relaySignature(input.token, input.timestamp, input.body), input.signature)
    ? "ok"
    : "invalid";
};
