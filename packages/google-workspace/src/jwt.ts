import { Clock, Effect } from "effect";
import type { GoogleServiceAccount } from "./config.js";
import { GoogleWorkspaceConfigError } from "./config.js";

/** Read-only Directory API scopes. Workspace sync never mutates the directory. */
export const GOOGLE_DIRECTORY_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
].join(" ");

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const base64UrlEncodeText = (value: string): string => base64UrlEncode(encoder.encode(value));

const pemToPkcs8 = (pem: string): ArrayBuffer => {
  const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);

  if (!match) throw new Error("The service-account key is not a PKCS#8 PEM private key.");

  const binary = atob(match[1].replaceAll(/\s+/g, ""));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return buffer;
};

export type ServiceAccountAssertion = {
  /** The signed JWT to exchange for an access token. */
  readonly assertion: string;
  /** Unix seconds; the token endpoint rejects assertions older than an hour. */
  readonly issuedAt: number;
  readonly expiresAt: number;
};

export type ServiceAccountAssertionOptions = {
  readonly serviceAccount: GoogleServiceAccount;
  readonly adminEmail: string;
  readonly scope?: string;
  readonly audience?: string;
  readonly issuedAt?: number;
  readonly lifetimeSeconds?: number;
  /** Bound the wait for WebCrypto, which itself has no abort handle. */
  readonly timeoutMs?: number;
};

/**
 * Sign the JWT-bearer grant used for domain-wide delegation.
 *
 * RS256 over WebCrypto keeps the Worker bundle free of a JWT dependency: the
 * service-account key is a PKCS#8 PEM, imported once per assertion. The `sub`
 * claim is the Workspace admin the service account impersonates; without it
 * Google issues a token with no Directory access.
 */
export const signServiceAccountAssertion = Effect.fnUntraced(function* (
  options: ServiceAccountAssertionOptions,
): Effect.fn.Return<ServiceAccountAssertion, GoogleWorkspaceConfigError> {
  const currentTime = options.issuedAt ?? (yield* Clock.currentTimeMillis);
  const issuedAt = Math.floor(currentTime / 1_000);
  const lifetime = options.lifetimeSeconds ?? 3_600;

  if (!Number.isFinite(currentTime))
    return yield* Effect.fail(
      new GoogleWorkspaceConfigError({
        message: "The service-account assertion time must be a finite timestamp.",
      }),
    );

  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 3_600)
    return yield* Effect.fail(
      new GoogleWorkspaceConfigError({
        message: "A service-account assertion lifetime must be between 1 and 3600 seconds.",
      }),
    );

  const expiresAt = issuedAt + Math.floor(lifetime);

  const header = base64UrlEncodeText(JSON.stringify({ alg: "RS256", typ: "JWT" }));

  const payload = base64UrlEncodeText(
    JSON.stringify({
      iss: options.serviceAccount.clientEmail,
      sub: options.adminEmail.trim().toLowerCase(),
      scope: options.scope ?? GOOGLE_DIRECTORY_SCOPES,
      aud: options.audience ?? GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: expiresAt,
    }),
  );

  const signingInput = `${header}.${payload}`;

  const signature = yield* Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        "pkcs8",
        pemToPkcs8(options.serviceAccount.privateKeyPem),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );

      const signed = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        encoder.encode(signingInput),
      );

      return base64UrlEncode(new Uint8Array(signed));
    },
    catch: (cause) =>
      new GoogleWorkspaceConfigError({
        // Our own listener throws only safe messages (for example "not a
        // PKCS#8 PEM"); never interpolate the key itself.
        message:
          cause instanceof Error && /PKCS#8/.test(cause.message)
            ? cause.message
            : "The service-account private key could not sign the Google token request.",
      }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: Math.max(1, options.timeoutMs ?? 5_000),
      orElse: () =>
        Effect.fail(
          new GoogleWorkspaceConfigError({
            message:
              "The service-account private key took too long to sign the Google token request.",
          }),
        ),
    }),
  );

  return { assertion: `${signingInput}.${signature}`, issuedAt, expiresAt };
});
