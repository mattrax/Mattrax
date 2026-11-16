import { Option, Schema } from "effect";
import {
  SsrRevisionPayload,
  SsrTokenPayload,
  ssrSessionFingerprint,
} from "@mattrax/enterprise-domain/client";

const decodePayload = Schema.decodeUnknownOption(SsrTokenPayload);

const decodeRevision = Schema.decodeUnknownOption(SsrRevisionPayload);

const encoder = new TextEncoder();

const base64UrlToBytes = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );

/**
 * Compare two fingerprints without an early exit. Both values are base64url
 * SHA-256 digests, so the length check only rejects malformed payloads and
 * never leaks the secret-derived value.
 */
const equalFingerprints = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;

  let difference = 0;

  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);

  return difference === 0;
};

/** Verify the HMAC and decode the JSON body; `undefined` on any failure. */
const decodeSigned = async (secret: string, token: string): Promise<Schema.Json | undefined> => {
  const [body, signature] = token.split(".");

  if (!body || !signature) return undefined;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signature),
    encoder.encode(body),
  );

  if (!valid) return undefined;

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Json)(
      JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))),
    ),
  );
};

/**
 * Verify the API-signed SSR bootstrap token at the edge.
 *
 * The web Worker only needs the shared HMAC primitive: a warm token lets an
 * authenticated page render without a service-binding call. This is an
 * affordance cache, never an authority — every data endpoint re-authorises the
 * request. `ver` is meaningless on its own, so the caller must also verify the
 * signed revision cookie and compare it (see `verifySsrRevision`).
 */
export async function verifySsrToken(
  secret: string,
  token: string,
  sessionCookie: string | undefined,
  now = Date.now(),
): Promise<SsrTokenPayload | undefined> {
  try {
    // The fingerprint binds a token to one session cookie. Without the cookie
    // there is nothing to compare against, so fail closed.
    if (!sessionCookie) return undefined;

    const payload = Option.getOrUndefined(decodePayload(await decodeSigned(secret, token)));

    if (!payload || payload.exp <= now) return undefined;

    // A rotated or signed-out session changes the cookie, so a token minted for
    // the previous one stops matching instead of painting the old account.
    const expected = await ssrSessionFingerprint(secret, sessionCookie);

    if (!equalFingerprints(payload.ch, expected)) return undefined;

    return payload;
  } catch {
    return undefined;
  }
}

/**
 * Verify the signed session-revision cookie.
 *
 * The payload is not secret: it names the session and the `authRevision` the
 * API last minted a shell for. Its value is that it is signed, so a browser (or
 * anything on the path) cannot make an old SSR token look current by editing a
 * cookie. A missing or expired revision is a miss, never a pass.
 */
export async function verifySsrRevision(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<SsrRevisionPayload | undefined> {
  try {
    const payload = Option.getOrUndefined(decodeRevision(await decodeSigned(secret, token)));

    if (!payload || payload.exp <= now) return undefined;

    return payload;
  } catch {
    return undefined;
  }
}
