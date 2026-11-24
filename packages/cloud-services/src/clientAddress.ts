import { Result } from "effect";
import { NetAddress } from "effect/net";

/**
 * Client address extraction with one trust policy for the whole server.
 *
 * Two header sets look like a client address and only one of them is safe:
 *
 * - Cloudflare sets `cf-connecting-ip` at the edge and overwrites whatever the
 *   caller sent, so it is trustworthy whenever the request carries `cf`.
 * - Behind any other reverse proxy, `x-forwarded-for` is caller-appendable. A
 *   proxy appends the address it saw at the **end** of the chain; every earlier
 *   hop may have been supplied by the caller. Only the last hop is used, and
 *   only after the deployment explicitly opts in (`TRUST_PROXY_HEADERS=1`).
 *
 * The rate limiter keys its buckets with this value and the audit log stores
 * it, so both must agree on what "the client" means. This module owns the
 * rule; `src/rateLimit.ts` only adapts a `Request` to it, which keeps
 * protocol handlers (which see a header record) on the same policy.
 */

/** A header record, or the `Headers` object a fetch-style request exposes. */
export type HeaderSource = Headers | Readonly<Record<string, string | string[] | undefined>>;

export type ClientAddressOptions = {
  /**
   * Trust `x-forwarded-for`/`x-real-ip` from a reverse proxy that appends the
   * address it saw. Off by default: without it an untrusted deployment must
   * not let a caller choose the value recorded against their actions.
   */
  readonly trustForwarded?: boolean;
  /**
   * Whether the request came through Cloudflare and can be identified by
   * `cf-connecting-ip`. Derive it from `request.cf`; never from a header,
   * because a caller can set that header too.
   */
  readonly cloudflare?: boolean;
};

/** Read one header from either a `Headers` instance or a plain record. */
export const headerValue = (headers: HeaderSource, name: string): string | undefined => {
  if (headers instanceof Headers) return headers.get(name)?.trim() || undefined;

  // SAFETY: the caller passed a header record, not a `Headers` instance; the
  // branch above already handled the only other member of `HeaderSource`.
  const record = headers;
  const value = record[name] ?? record[name.toLowerCase()];

  const text = Array.isArray(value) ? value[0] : value;

  return text?.trim() || undefined;
};

/**
 * The verified client address, or `null` when this deployment cannot prove one.
 *
 * Returning `null` is deliberate: a caller-supplied value must never end up in
 * a rate-limit key or a security audit, and "the address is unknown" is more
 * honest than a shared `local` bucket or a spoofed row.
 */
export const clientAddress = (
  headers: HeaderSource,
  { trustForwarded = false, cloudflare = false }: ClientAddressOptions = {},
): string | null => {
  if (cloudflare) return validAddress(headerValue(headers, "cf-connecting-ip"));

  if (!trustForwarded) return null;

  const chain = headerValue(headers, "x-forwarded-for")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return validAddress(chain?.at(-1) ?? headerValue(headers, "x-real-ip"));
};

/**
 * A header value is only an address when the runtime agrees. Forwarded headers
 * are attacker-controlled in an untrusted deployment, and even a trusted one
 * can forward a malformed value; storing "unknown" is better than storing a
 * string that looks like an address.
 */
const validAddress = (value: string | undefined): string | null =>
  value !== undefined && Result.isSuccess(NetAddress.ipFromString(value)) ? value : null;

/** A stored address is bounded; IPv6 with a zone id still fits comfortably. */
export const CLIENT_ADDRESS_MAX_LENGTH = 64;

/** Client address trimmed to the column width, or `null` when unusable. */
export const boundedClientAddress = (
  headers: HeaderSource,
  options: ClientAddressOptions = {},
): string | null => clientAddress(headers, options)?.slice(0, CLIENT_ADDRESS_MAX_LENGTH) ?? null;
