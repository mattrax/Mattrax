import { Schema } from "effect";

/**
 * Typed validation for Entra ID tokens presented to WSTEP when a tenant uses
 * the `Federated` auth policy.
 *
 * This module is intentionally dependency-free beyond WebCrypto so the WSTEP
 * backend can validate a token without importing the OIDC service layer. The
 * caller supplies the expected Entra tenant and audience; the token's `tid`,
 * issuer, signature, `nbf` and `exp` are all checked. JWKS responses are cached
 * in-process for an hour.
 */

export type FederatedTokenFailureReason =
  | "malformed"
  | "unsupported"
  | "jwks"
  | "signature"
  | "issuer"
  | "audience"
  | "tenant"
  | "expired"
  | "not_yet_valid";

export type FederatedTokenFailure = {
  readonly ok: false;
  readonly reason: FederatedTokenFailureReason;
  readonly message: string;
};

export type FederatedEntraClaims = {
  readonly tenantId: string;
  readonly issuer: string;
  readonly audience: ReadonlyArray<string>;
  readonly subject: string;
  readonly objectId?: string;
  readonly userPrincipalName?: string;
  readonly name?: string;
  readonly expiresAt: number;
  readonly issuedAt?: number;
  readonly notBefore?: number;
};

export type FederatedTokenSuccess = {
  readonly ok: true;
  readonly claims: FederatedEntraClaims;
};

export type FederatedTokenValidation = FederatedTokenSuccess | FederatedTokenFailure;

export type FederatedJsonWebKey = {
  readonly kty: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
};

export type FederatedJsonWebKeySet = {
  readonly keys: ReadonlyArray<FederatedJsonWebKey>;
};

export type ValidateFederatedEntraTokenOptions = {
  readonly token: string;
  /** Entra tenant the enrollment is bound to. */
  readonly tenantId: string;
  /** Accepted token audience(s), normally the Mattrax app registration id. */
  readonly audience: string | ReadonlyArray<string>;
  /** Override for tests or non-public clouds. */
  readonly issuer?: string;
  /** Injected JWKS; when omitted the tenant's Entra JWKS endpoint is fetched. */
  readonly jwks?: FederatedJsonWebKeySet;
  readonly jwksUri?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Injectable clock in milliseconds. */
  readonly now?: number;
  readonly clockToleranceSeconds?: number;
  readonly jwksTimeoutMs?: number;
};

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 300;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1_000;

const textEncoder = new TextEncoder();

const JsonWebKey = Schema.Struct({
  kty: Schema.String,
  kid: Schema.optional(Schema.String),
  use: Schema.optional(Schema.String),
  alg: Schema.optional(Schema.String),
  n: Schema.optional(Schema.String),
  e: Schema.optional(Schema.String),
});

const JsonWebKeySet = Schema.Struct({
  keys: Schema.Array(JsonWebKey),
});

const TokenHeader = Schema.Struct({
  alg: Schema.String,
  kid: Schema.optional(Schema.String),
  typ: Schema.optional(Schema.String),
});

type CacheEntry = {
  readonly value: FederatedJsonWebKeySet;
  readonly expiresAt: number;
};

const jwksCache = new Map<string, CacheEntry>();

export const federatedIssuer = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/v2.0`;

export const federatedJwksUri = (tenantId: string): string =>
  `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

/** The realm is the Entra tenant id; exposed for settings/documentation. */
export const federatedRealm = (tenantId: string): string => tenantId;

/**
 * Tenant-specific STS URL returned in discovery. Entra's WS-Federation
 * endpoint is the conventional `AuthenticationServiceUrl` for a federated
 * Windows enrollment. Deployments that need a different endpoint can inject
 * `federated.authServiceUrl`.
 */
export const federatedAuthServiceUrl = (
  tenantId: string,
  options: { readonly clientId?: string } = {},
): string => {
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/wsfed`);

  if (options.clientId) url.searchParams.set("wtrealm", options.clientId);

  return url.toString();
};

const failure = (reason: FederatedTokenFailureReason, message: string): FederatedTokenFailure => ({
  ok: false,
  reason,
  message,
});

function base64UrlToBytes(input: string): Uint8Array | null {
  try {
    const padded = input.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

    return bytes;
  } catch {
    return null;
  }
}

function decodeJson(value: string): Schema.Json | null {
  const bytes = base64UrlToBytes(value);

  if (!bytes) return null;

  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

type DecodedToken = {
  readonly header: typeof TokenHeader.Type;
  readonly payload: Schema.JsonObject;
  readonly signingInput: string;
  readonly signature: Uint8Array;
};

function decodeToken(token: string): DecodedToken | null {
  const parts = token.split(".");

  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  const signature = base64UrlToBytes(parts[2]);

  if (!Schema.is(TokenHeader)(header) || !Schema.is(Schema.JsonObject)(payload) || !signature)
    return null;

  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature,
  };
}

/** True when the value is a three-part JWT that decodes to an Entra header and claims. */
export function isFederatedToken(token: string): boolean {
  return decodeToken(token) !== null;
}

/** Decode `tid` without verifying. Only used to route to a tenant before full validation. */
export function unverifiedFederatedTenantId(token: string): string | null {
  const decoded = decodeToken(token);
  const tid = decoded?.payload.tid;

  return claimString(tid) ?? null;
}

async function loadJwks(
  options: ValidateFederatedEntraTokenOptions,
): Promise<FederatedJsonWebKeySet | FederatedTokenFailure> {
  if (options.jwks) return options.jwks;
  const uri = options.jwksUri ?? federatedJwksUri(options.tenantId);
  const cached = jwksCache.get(uri);

  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) return failure("jwks", "No fetch implementation is available for Entra JWKS");
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    options.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(uri, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) return failure("jwks", `Entra JWKS request returned HTTP ${response.status}`);
    const body = await response.json();

    if (!Schema.is(JsonWebKeySet)(body))
      return failure("jwks", "Entra JWKS response did not contain a keys array");
    jwksCache.set(uri, { value: body, expiresAt: Date.now() + JWKS_CACHE_TTL_MS });

    return body;
  } catch (cause) {
    return failure("jwks", `Entra JWKS request failed: ${String(cause)}`);
  } finally {
    clearTimeout(timeout);
  }
}

const audienceValues = (audience: string | ReadonlyArray<string>): string[] =>
  (Schema.is(Schema.String)(audience) ? [audience] : [...audience]).filter(Boolean);

const claimString = (value: Schema.Json | undefined): string | undefined =>
  Schema.is(Schema.String)(value) && value.trim() ? value.trim() : undefined;

const claimNumber = (value: Schema.Json | undefined): number | undefined =>
  Schema.is(Schema.Number)(value) && Number.isFinite(value) ? value : undefined;

/**
 * Validate an Entra access/ID token for WSTEP. Every failure is typed and
 * fail-closed; there is no "skip signature in development" branch.
 */
export async function validateFederatedEntraToken(
  options: ValidateFederatedEntraTokenOptions,
): Promise<FederatedTokenValidation> {
  const decoded = decodeToken(options.token);

  if (!decoded) return failure("malformed", "The federated token is not a JWT");

  if (decoded.header.alg !== "RS256")
    return failure("unsupported", `Unsupported token algorithm: ${decoded.header.alg}`);

  const tenantId = options.tenantId.trim();

  if (!tenantId) return failure("tenant", "An expected Entra tenant id is required");

  const claimTenant = claimString(decoded.payload.tid);

  if (!claimTenant) return failure("tenant", "The token has no tenant id (tid) claim");

  if (claimTenant.toLowerCase() !== tenantId.toLowerCase())
    return failure("tenant", "The token tenant does not match this enrollment");

  const issuer = claimString(decoded.payload.iss);

  if (!issuer) return failure("issuer", "The token has no issuer (iss) claim");

  const allowedIssuers = options.issuer
    ? [options.issuer]
    : [
        `https://login.microsoftonline.com/${claimTenant}/v2.0`,
        `https://sts.windows.net/${claimTenant}/`,
      ];

  if (!allowedIssuers.includes(issuer))
    return failure("issuer", "The token issuer is not an Entra issuer for this tenant");

  const audiences = audienceValues(options.audience);

  if (audiences.length === 0)
    return failure("audience", "At least one expected token audience is required");
  const rawAudience = decoded.payload.aud;

  const tokenAudiences = Schema.is(Schema.Array(Schema.String))(rawAudience)
    ? rawAudience
    : Schema.is(Schema.String)(rawAudience)
      ? [rawAudience]
      : [];

  if (!tokenAudiences.some((audience) => audiences.includes(audience)))
    return failure("audience", "The token audience is not allowed");

  const now = Math.floor((options.now ?? Date.now()) / 1_000);
  const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const expiresAt = claimNumber(decoded.payload.exp);

  if (expiresAt === undefined) return failure("expired", "The token has no expiry (exp) claim");

  if (expiresAt + tolerance < now) return failure("expired", "The token is expired");
  const notBefore = claimNumber(decoded.payload.nbf);

  if (notBefore !== undefined && notBefore - tolerance > now)
    return failure("not_yet_valid", "The token is not valid yet");

  const jwks = await loadJwks(options);

  if ("ok" in jwks) return jwks;
  const kid = decoded.header.kid;

  if (!kid) return failure("signature", "The token has no key id (kid)");
  const jwk = jwks.keys.find((key) => key.kid === kid);

  if (!jwk) return failure("signature", "No Entra signing key matches the token key id");

  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e)
    return failure("signature", "The Entra signing key is not an RSA key");

  if (jwk.alg && jwk.alg !== decoded.header.alg)
    return failure("signature", "The Entra signing key algorithm does not match the token");

  let valid = false;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      // SAFETY: WebCrypto accepts Uint8Array as a BufferSource; the TypeScript
      // DOM libs model the buffer backing separately from the view.
      decoded.signature as BufferSource,
      // SAFETY: Same WebCrypto BufferSource representation as above.
      textEncoder.encode(decoded.signingInput) as BufferSource,
    );
  } catch {
    return failure("signature", "The token signature could not be verified");
  }

  if (!valid) return failure("signature", "The token signature is invalid");

  const subject =
    claimString(decoded.payload.oid) ??
    claimString(decoded.payload.sub) ??
    claimString(decoded.payload.preferred_username);

  if (!subject) return failure("malformed", "The token has no subject (sub/oid) claim");

  return {
    ok: true,
    claims: {
      tenantId: claimTenant,
      issuer,
      audience: tokenAudiences,
      subject,
      objectId: claimString(decoded.payload.oid),
      userPrincipalName:
        claimString(decoded.payload.upn) ?? claimString(decoded.payload.preferred_username),
      name: claimString(decoded.payload.name),
      expiresAt,
      issuedAt: claimNumber(decoded.payload.iat),
      notBefore,
    },
  };
}
