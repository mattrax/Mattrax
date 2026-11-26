import { Effect } from "effect";
import { verifyEmailToken } from "email-verification-api";
import type { VerifyEmailTokenInput } from "email-verification-api";

/**
 * Email Verification API (EVP) for guest sign-up.
 *
 * The browser fills a hidden token input when its mailbox provider can vouch
 * for the address inline. Verification is strictly an optimisation: without a
 * token, a matching session nonce, or a successful verification, the caller
 * sends the ordinary emailed code. Nothing here may throw into the request.
 */
export type RegistrationEmailProof = {
  readonly email: string;
  /** The relying-party origin the browser was on. */
  readonly audience: string;
  /** SD-JWT+KB presentation, when the browser filled one. */
  readonly token: string | undefined;
  /** Nonce submitted with the token. */
  readonly nonce: string | undefined;
  /** Nonce this browser was actually issued (from the sign-up cookie). */
  readonly sessionNonce: string | undefined;
};

/**
 * The relying-party origin the browser was on. The request carries the public
 * origin the web Worker saw (a self-host may be reached over a loopback or
 * service-binding URL); only a usable HTTP(S) origin is accepted.
 */
export const registrationAudience = (
  configured: string,
  header: string | undefined,
  requestUrl?: string,
): string => {
  // The public-origin header is authoritative when a proxy saw the browser's
  // host. A direct API route can still carry the real host in its own URL. The
  // configured deployment origin is the last resort.
  for (const candidate of [header?.trim(), requestUrl, configured]) {
    if (!candidate) continue;

    try {
      const url = new URL(candidate);

      if (url.protocol === "https:" || url.hostname === "localhost") return url.origin;
    } catch {
      // Try the next source.
    }
  }

  return configured;
};

/**
 * True when there is a complete token/nonce pair and the nonce is the one this
 * browser session was given. A token without that binding is ignored, so a
 * nonce from another session (or a stale form) is rejected before any network
 * work happens.
 */
export const registrationTokenAttempted = (proof: RegistrationEmailProof): boolean =>
  Boolean(proof.token && proof.nonce && proof.sessionNonce === proof.nonce);

/**
 * Verify a browser token. Every failure — absent input, binding mismatch, an
 * invalid token, a timeout, an unreachable issuer — is `false` so the code
 * flow always remains available.
 *
 * `verify` is injectable so the handler's verified/absent/invalid paths can be
 * unit-tested without issuer or DNS traffic.
 */
export type RegistrationTokenVerifier = (
  input: VerifyEmailTokenInput,
) => Promise<{ readonly ok: boolean }>;

export const proveRegistrationEmail = (
  proof: RegistrationEmailProof,
  verify: RegistrationTokenVerifier = verifyEmailToken,
): Effect.Effect<boolean> => {
  if (!registrationTokenAttempted(proof) || !proof.token || !proof.nonce)
    return Effect.succeed(false);

  return Effect.tryPromise(() =>
    verify({
      email: proof.email,
      token: proof.token!,
      nonce: proof.nonce!,
      audience: proof.audience,
      // The person is waiting on the sign-up button; never let issuer or DNS
      // trouble stall it beyond an interactive budget.
      timeoutMs: 10_000,
      timeouts: {
        resolveTxtMs: 2_000,
        resolveHostMs: 2_000,
        metadataFetchMs: 4_000,
        jwksFetchMs: 4_000,
      },
    }),
  ).pipe(
    // The library's success is a discriminated `{ ok: true, value }` result;
    // anything else (including a shape from a future version) is not proof.
    Effect.map((result) => result.ok === true),
    // A rejected promise (for example a DNS implementation missing on an
    // unusual runtime) is a failed verification, never a failed sign-up.
    Effect.catch(() => Effect.succeed(false)),
  );
};
