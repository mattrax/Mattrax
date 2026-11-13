import { Effect } from "effect";
import { and, asc, eq, lt } from "drizzle-orm";
import { windowsPolicyNodes } from "./policy.ts";
import { resolveEffectivePolicyForDevice } from "./policyResolutionStore.ts";
import { syncDynamicGroupsForDevice } from "./dynamicGroups.ts";
import {
  deviceLimitForOrganization,
  schema as s,
  type Db,
  type PlanLimitsConfig,
} from "@mattrax/enterprise-core";
import { certificateSerialHex, openCaPrivateKey, signScepCsr } from "@mattrax/scep";
import { normalizeIssuedCertificateSerial } from "./scep.ts";
import {
  federatedAuthServiceUrl,
  isFederatedTokenShaped,
  unverifiedFederatedTenantId,
  validateFederatedEntraToken,
  type FederatedEntraClaims,
  type FederatedJsonWebKeySet,
  type FederatedTokenValidation,
} from "./federated.ts";
import {
  InternalServerError,
  UnknownDevice,
  type ManagementBackend,
  type WindowsDeviceEvent,
  type WindowsDiscoveryRequest,
  type WindowsDiscoveryResponse,
  type WindowsEnrollmentPolicy,
  type WindowsEnrollmentRequest,
  type WindowsEnrollmentResult,
  type WindowsManagementRequest,
  type WindowsManagementResponse,
  type WindowsManagementScope,
} from "@mattrax/management-backend";

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const hmac = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return toBase64Url(new Uint8Array(signature));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;

  return difference === 0;
};

/**
 * Whether a value has the shape of our `<subject>.<issuedAt>.<hmac>` token.
 * Used to distinguish a forged/expired Mattrax token from the opaque client
 * credential Windows sends on the first WSTEP policy request.
 */
const isWindowsEnrollmentTokenShaped = (token: string): boolean => {
  const parts = token.split(".");

  if (parts.length !== 3) return false;
  const [subject, issuedAt, signature] = parts;

  return Boolean(
    subject && /^\d+$/.test(issuedAt ?? "") && /^[A-Za-z0-9_-]+$/.test(signature ?? ""),
  );
};

export type WindowsEnrollmentTokenOptions = {
  /** Lifetime in seconds. Defaults to one hour. */
  readonly ttlSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  readonly now?: number;
};

export type WindowsEnrollmentTokenVerification = {
  readonly subject: string;
  readonly issuedAt: number;
};

const DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Stateless WSTEP enrollment token.
 *
 * Encoding: `<subject>.<issuedAtEpochSeconds>.<base64url HMAC-SHA256>`, signed
 * with the application `AUTH_SECRET`. The policy response hands this token back
 * to Windows, which echoes it in the enrollment request's
 * `BinarySecurityToken`; {@link verifyWindowsEnrollmentToken} rejects forged,
 * malformed and expired tokens.
 *
 * The subject is a fresh enrollment id until the device supplies its real
 * `DeviceID` in the enrollment AdditionalContext. Keeping the token stateless
 * means a retried policy request can safely issue a new token without a database
 * write.
 */
export const createWindowsEnrollmentToken = (
  subject: string,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<string> =>
  (async () => {
    if (!subject) throw new Error("Windows enrollment token subject is required");

    if (!authSecret) throw new Error("Windows enrollment token requires a secret");
    const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
    const signature = await hmac(authSecret, `${subject}.${issuedAt}`);

    return `${subject}.${issuedAt}.${signature}`;
  })();

export const verifyWindowsEnrollmentToken = (
  token: string | undefined,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<WindowsEnrollmentTokenVerification | null> =>
  verifyWindowsEnrollmentTokenDetailed(token, authSecret, options).then(
    (result) => result.verification,
  );

export type WindowsEnrollmentTokenEvaluation = {
  /** Non-null only when the signature is valid and the token has not expired. */
  readonly verification: WindowsEnrollmentTokenVerification | null;
  /** True when the signature is valid but the token's lifetime has elapsed. */
  readonly expired: boolean;
};

/**
 * Verify a token while distinguishing an expired (but otherwise authentic)
 * token from a forged or malformed one. A device that was offline past the
 * policy token's lifetime must be able to start a fresh enrollment rather than
 * being treated as an attacker, while a garbage signature still fails closed.
 */
export const verifyWindowsEnrollmentTokenDetailed = async (
  token: string | undefined,
  authSecret: string,
  options: WindowsEnrollmentTokenOptions = {},
): Promise<WindowsEnrollmentTokenEvaluation> => {
  const invalid = { verification: null, expired: false } as const;

  if (!token || !authSecret) return invalid;
  const parts = token.split(".");

  if (parts.length !== 3) return invalid;
  const [subject, issuedAtRaw, signature] = parts;

  if (!subject || !issuedAtRaw || !signature) return invalid;
  const issuedAt = Number(issuedAtRaw);

  if (!Number.isFinite(issuedAt)) return invalid;

  const expected = await hmac(authSecret, `${subject}.${issuedAtRaw}`);

  if (!timingSafeEqual(expected, signature)) return invalid;

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;

  if (nowSeconds > issuedAt + ttlSeconds) return { verification: null, expired: true };

  // Allow a little clock skew for freshly issued tokens.
  if (issuedAt > nowSeconds + 60) return invalid;

  return { verification: { subject, issuedAt }, expired: false };
};

const fromBase64Url = (value: string): string | null => {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));

    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
};

/** Prefix that marks a tenant-scoped Windows enrollment token. */
const TENANT_TOKEN_PREFIX = "mttxw1";

/** Prefix for a tenant token whose discovery chose the Federated auth policy. */
const FEDERATED_TENANT_TOKEN_PREFIX = "mttxw2";
const TENANT_TOKEN_CONTEXT = "mattrax:windows-tenant:v1";
const FEDERATED_TENANT_TOKEN_CONTEXT = "mattrax:windows-tenant:v2:federated";

/** Prefix that binds the organization into a WSTEP enrollment token subject. */
const ENROLLMENT_SUBJECT_PREFIX = "mttxw1:";

/**
 * Tenant enrollment links are shared by administrators (settings, QR code,
 * email), so the token lifetime is measured in days rather than minutes. The
 * enrollment page mints a fresh token on every load.
 */
export const DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export type WindowsTenantTokenOptions = {
  /** Lifetime in seconds. Defaults to seven days. */
  readonly ttlSeconds?: number;
  /** Injectable clock in milliseconds, for tests. */
  readonly now?: number;
  /**
   * Mint a token for a discovery flow that chose `AuthPolicy: Federated`.
   * Policy/enroll then require a verifiable Entra JWT for this tenant.
   */
  readonly federated?: boolean;
};

export type WindowsTenantTokenVerification = {
  readonly organizationId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** True when discovery selected the Federated auth policy. */
  readonly federated: boolean;
};

export type WindowsTenantTokenEvaluation = {
  /** Non-null only when the signature is valid and the token has not expired. */
  readonly verification: WindowsTenantTokenVerification | null;
  /** True when the signature is valid but the token's lifetime has elapsed. */
  readonly expired: boolean;
};

const tenantTokenMessage = (
  organizationId: string,
  issuedAt: number,
  expiresAt: number,
  federated: boolean,
) =>
  `${federated ? FEDERATED_TENANT_TOKEN_CONTEXT : TENANT_TOKEN_CONTEXT}.${organizationId}.${issuedAt}.${expiresAt}`;

/**
 * Stateless tenant enrollment token.
 *
 * Encoding: `mttxw1.<base64url organization id>.<issuedAt>.<expiresAt>.<hmac>`
 * signed with `AUTH_SECRET`. Unlike the WSTEP token (which a device echoes back
 * in a SOAP header), this token lives in the discovery/policy/enroll URL so a
 * tenant-scoped enrollment link never needs a deployment-wide tenant pin.
 */
export const createWindowsTenantToken = (
  organizationId: string,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<string> =>
  (async () => {
    if (!organizationId) throw new Error("Windows tenant token organization is required");

    if (!authSecret) throw new Error("Windows tenant token requires a secret");
    const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
    const expiresAt = issuedAt + (options.ttlSeconds ?? DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS);
    const federated = options.federated === true;

    const signature = await hmac(
      authSecret,
      tenantTokenMessage(organizationId, issuedAt, expiresAt, federated),
    );

    return [
      federated ? FEDERATED_TENANT_TOKEN_PREFIX : TENANT_TOKEN_PREFIX,
      toBase64Url(encoder.encode(organizationId)),
      issuedAt,
      expiresAt,
      signature,
    ].join(".");
  })();

export const verifyWindowsTenantTokenDetailed = async (
  token: string | undefined,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<WindowsTenantTokenEvaluation> => {
  const invalid = { verification: null, expired: false } as const;

  if (!token || !authSecret) return invalid;
  const parts = token.split(".");

  if (parts.length !== 5) return invalid;
  const [prefix, encodedOrganization, issuedAtRaw, expiresAtRaw, signature] = parts;
  const federated = prefix === FEDERATED_TENANT_TOKEN_PREFIX;

  if (
    (!federated && prefix !== TENANT_TOKEN_PREFIX) ||
    !encodedOrganization ||
    !issuedAtRaw ||
    !expiresAtRaw ||
    !signature
  )
    return invalid;
  const organizationId = fromBase64Url(encodedOrganization);
  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);

  if (!organizationId || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return invalid;

  if (expiresAt <= issuedAt) return invalid;

  const expected = await hmac(
    authSecret,
    tenantTokenMessage(organizationId, issuedAt, expiresAt, federated),
  );

  if (!timingSafeEqual(expected, signature)) return invalid;

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

  if (nowSeconds > expiresAt) return { verification: null, expired: true };

  // Allow a little clock skew for freshly issued tokens.
  if (issuedAt > nowSeconds + 300) return invalid;

  return { verification: { organizationId, issuedAt, expiresAt, federated }, expired: false };
};

export const verifyWindowsTenantToken = (
  token: string | undefined,
  authSecret: string,
  options: WindowsTenantTokenOptions = {},
): Promise<WindowsTenantTokenVerification | null> =>
  verifyWindowsTenantTokenDetailed(token, authSecret, options).then(
    (result) => result.verification,
  );

/** Expiry encoded in a tenant token, for display in the enrollment UI. */
export const windowsTenantTokenExpiresAt = (token: string): Date | null => {
  const parts = token.split(".");

  if (parts.length !== 5) return null;
  const seconds = Number(parts[3]);

  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
};

/** Bind the organization into a WSTEP token so enrollment cannot switch tenants. */
export const windowsEnrollmentSubject = (organizationId: string): string =>
  `${ENROLLMENT_SUBJECT_PREFIX}${toBase64Url(encoder.encode(organizationId))}:${crypto.randomUUID()}`;

/** Recover the organization previously bound into a WSTEP token subject. */
export const organizationFromWindowsEnrollmentSubject = (
  subject: string | undefined,
): string | null => {
  if (!subject?.startsWith(ENROLLMENT_SUBJECT_PREFIX)) return null;
  const rest = subject.slice(ENROLLMENT_SUBJECT_PREFIX.length);
  const separator = rest.indexOf(":");

  if (separator <= 0) return null;

  return fromBase64Url(rest.slice(0, separator));
};

/**
 * Identity values a SCEP certificate row may carry for a device.
 *
 * Certificates issued by {@link makeWindowsBackend} used to store the Windows
 * `DeviceID` (the device's `dmIdentifier`) instead of the internal `device.id`.
 * Revocation and renewal must honour both so legacy rows keep working after the
 * linkage fix.
 */
export const certificateDeviceIdsFor = (device: {
  readonly id: string;
  readonly dmIdentifier?: string | null;
}): string[] => {
  const ids = new Set<string>();

  if (device.id) ids.add(device.id);
  const dmIdentifier = device.dmIdentifier?.trim();

  if (dmIdentifier) ids.add(dmIdentifier);

  return [...ids];
};

export type WindowsBackendOptions = {
  readonly db: Db["Service"];
  readonly origin: string;
  /** Shared application secret used to sign/verify WSTEP and tenant tokens. */
  readonly authSecret?: string;
  /**
   * Legacy deployment-wide tenant pin. Tenant-scoped enrollment links carry
   * their own signed token, so this is only consulted when a request has no
   * tenant token and no identity certificate. Set it only for single-tenant
   * deployments that need to keep accepting the old un-scoped URL.
   */
  readonly windowsOrganizationId?: string;
  readonly enrollmentTokenTtlSeconds?: number;
  /** Lifetime of the tenant token embedded in enrollment URLs. */
  readonly tenantTokenTtlSeconds?: number;
  /** Require a verified client certificate on SyncML check-in. */
  readonly requireDeviceIdentity?: boolean;
  /** Deployment plan catalogue; omitted means unlimited plans. */
  readonly planLimits?: PlanLimitsConfig;
  /**
   * Federated Entra WSTEP support. Disabled unless an audience is supplied.
   * Discovery advertises `Federated` only for tenants with an Entra tenant id
   * and when the client offered it; policy/enroll then validate the Entra JWT
   * against that tenant's issuer and JWKS.
   */
  readonly federated?: {
    readonly enabled?: boolean;
    /** Accepted token audience(s); normally the Mattrax app registration id. */
    readonly audience?: string | ReadonlyArray<string>;
    /** Optional `wtrealm` for the tenant-specific WS-Federation URL. */
    readonly clientId?: string;
    /** Override the default `https://login.microsoftonline.com/<tid>/wsfed`. */
    readonly authServiceUrl?: (tenantId: string) => string;
    /** Injected JWKS (tests). */
    readonly jwks?: FederatedJsonWebKeySet;
    readonly jwksUri?: (tenantId: string) => string;
    readonly fetch?: typeof globalThis.fetch;
    /** Injectable clock in milliseconds (tests). */
    readonly now?: number;
    readonly clockToleranceSeconds?: number;
  };
};

type WindowsBackend = Pick<
  ManagementBackend.Service,
  | "windowsDiscovery"
  | "getWindowsEnrollmentPolicy"
  | "windowsEnroll"
  | "windowsManagementCheckin"
  | "windowsDeviceEvent"
>;

const decodeCertificateSubject = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const certificateAttribute = (
  identityCertificate: string | undefined,
  attribute: "OU" | "CN",
): string | null => {
  if (!identityCertificate) return null;
  const text = decodeCertificateSubject(identityCertificate);

  return (
    text.match(new RegExp(`(?:^|[,/\\n])\\s*${attribute}\\s*=\\s*([^,/\\n]+)`, "i"))?.[1]?.trim() ??
    null
  );
};

/**
 * A forwarded mTLS serial may be hex (`certificateSerialHex`), uppercase,
 * `0x`-prefixed, colon-separated, or decimal. Compare against every plausible
 * canonical form rather than trusting one forwarder convention.
 */
const certificateSerialCandidates = (value: string): string[] => {
  const candidates = new Set<string>();
  const normalized = normalizeIssuedCertificateSerial(value);

  if (normalized) candidates.add(normalized);
  const compact = value.trim().replace(/[\s:]/g, "");

  if (/^\d+$/.test(compact)) {
    try {
      candidates.add(BigInt(compact).toString(16));
    } catch {
      // Not a decimal serial; the hex form above still applies.
    }
  }

  return [...candidates];
};

type ResolveOrganizationInput = {
  readonly tenantToken?: string;
  readonly identityCertificate?: string;
  /** Require an identity certificate and use its OU as the organization. */
  readonly requireCertificate?: boolean;
  /** Set false to ignore the legacy deployment-wide pin. */
  readonly allowPin?: boolean;
  /**
   * Discovery/policy/enroll must reject a bad or expired tenant token. Device
   * check-ins may instead fall back to the verified certificate OU: the token
   * on the management URL expires long before a device's certificate does.
   */
  readonly rejectInvalidToken?: boolean;
};

type OrganizationResolution = Effect.Effect<string, UnknownDevice | InternalServerError, never>;

export const makeWindowsBackend = (options: WindowsBackendOptions): WindowsBackend => {
  const { db, origin, authSecret, windowsOrganizationId, requireDeviceIdentity } = options;
  const ttlSeconds = options.enrollmentTokenTtlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;

  const tenantTokenTtlSeconds =
    options.tenantTokenTtlSeconds ?? DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS;

  const internal = () => new InternalServerError();

  const requireSecret = (): Effect.Effect<string, InternalServerError> =>
    authSecret ? Effect.succeed(authSecret) : Effect.fail(new InternalServerError());

  const evaluateTenantToken = (
    tenantToken: string | undefined,
  ): Effect.Effect<WindowsTenantTokenEvaluation, InternalServerError> =>
    Effect.gen(function* () {
      const trimmed = tenantToken?.trim();

      if (!trimmed) return { verification: null, expired: false };
      const secret = yield* requireSecret();

      return yield* Effect.promise(() =>
        verifyWindowsTenantTokenDetailed(trimmed, secret, { ttlSeconds: tenantTokenTtlSeconds }),
      );
    });

  const federated = options.federated;
  const federatedAudience = federated?.audience;

  const federatedEnabled = Boolean(
    federated &&
    federated.enabled !== false &&
    federatedAudience &&
    (typeof federatedAudience === "string"
      ? federatedAudience.trim()
      : federatedAudience.length > 0),
  );

  const tenantAzureTenantId = (organizationId: string): Effect.Effect<string | null, unknown> =>
    Effect.gen(function* () {
      const [config] = yield* db
        .select({ azureTenantId: s.ssoConfig.azureTenantId })
        .from(s.ssoConfig)
        .where(eq(s.ssoConfig.organizationId, organizationId))
        .limit(1);

      return config?.azureTenantId?.trim() || null;
    });

  const organizationForAzureTenant = (
    azureTenantId: string,
  ): Effect.Effect<string | null, unknown> =>
    Effect.gen(function* () {
      const [config] = yield* db
        .select({ organizationId: s.ssoConfig.organizationId })
        .from(s.ssoConfig)
        .where(eq(s.ssoConfig.azureTenantId, azureTenantId))
        .limit(1);

      return config?.organizationId ?? null;
    });

  const validateFederatedToken = (
    token: string,
    azureTenantId: string,
  ): Effect.Effect<FederatedTokenValidation, never> =>
    Effect.promise(() =>
      validateFederatedEntraToken({
        token,
        tenantId: azureTenantId,
        audience: federatedAudience!,
        ...(federated?.jwks ? { jwks: federated.jwks } : {}),
        ...(federated?.jwksUri ? { jwksUri: federated.jwksUri(azureTenantId) } : {}),
        ...(federated?.fetch ? { fetch: federated.fetch } : {}),
        ...(federated?.now !== undefined ? { now: federated.now } : {}),
        ...(federated?.clockToleranceSeconds !== undefined
          ? { clockToleranceSeconds: federated.clockToleranceSeconds }
          : {}),
      }),
    );

  /**
   * Resolve a tenant from an Entra token, then validate the token against that
   * tenant. A token for a tenant without SSO configuration, or whose `tid` is
   * not the configured Entra tenant, is rejected.
   */
  const resolveFederatedOrganization = (
    token: string,
    expectedOrganizationId?: string | null,
  ): Effect.Effect<
    { readonly organizationId: string; readonly claims: FederatedEntraClaims },
    UnknownDevice | InternalServerError
  > =>
    Effect.gen(function* () {
      if (!federatedEnabled) return yield* Effect.fail(new UnknownDevice());
      const unverifiedTenant = unverifiedFederatedTenantId(token);

      if (!unverifiedTenant) return yield* Effect.fail(new UnknownDevice());

      const organizationId =
        expectedOrganizationId ?? (yield* organizationForAzureTenant(unverifiedTenant));

      if (!organizationId) return yield* Effect.fail(new UnknownDevice());
      const azureTenantId = yield* tenantAzureTenantId(organizationId);

      if (!azureTenantId) return yield* Effect.fail(new UnknownDevice());

      // The signed tenant token (when present) pins the organization; the
      // token's own tenant must still match that organization's Entra tenant.
      if (azureTenantId.toLowerCase() !== unverifiedTenant.toLowerCase())
        return yield* Effect.fail(new UnknownDevice());
      const validation = yield* validateFederatedToken(token, azureTenantId);

      if (!validation.ok) return yield* Effect.fail(new UnknownDevice());

      return { organizationId, claims: validation.claims };
    }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())));

  /**
   * Resolve the owning organization from, in order: the signed tenant token,
   * the mTLS certificate OU, then the legacy deployment-wide pin. Sources that
   * are present must agree; a conflicting token/certificate pair is rejected
   * rather than silently choosing one tenant over another.
   */
  const resolveOrganization = (input: ResolveOrganizationInput = {}): OrganizationResolution =>
    Effect.gen(function* () {
      const evaluation = yield* evaluateTenantToken(input.tenantToken);
      const tokenOrganizationId = evaluation.verification?.organizationId ?? null;

      if (input.tenantToken?.trim() && !tokenOrganizationId && (input.rejectInvalidToken ?? true))
        return yield* Effect.fail(new UnknownDevice());

      const certificateOrganizationId = certificateAttribute(input.identityCertificate, "OU");

      if (input.requireCertificate && !certificateOrganizationId)
        return yield* Effect.fail(new UnknownDevice());

      if (
        tokenOrganizationId &&
        certificateOrganizationId &&
        tokenOrganizationId !== certificateOrganizationId
      )
        return yield* Effect.fail(new UnknownDevice());

      const organizationId =
        tokenOrganizationId ??
        certificateOrganizationId ??
        (input.allowPin === false ? null : (windowsOrganizationId ?? null));

      if (!organizationId) return yield* Effect.fail(new UnknownDevice());

      return organizationId;
    });

  const findDevice = (organizationId: string, deviceId: string) =>
    Effect.gen(function* () {
      const [device] = yield* db
        .select()
        .from(s.device)
        .where(
          and(eq(s.device.organizationId, organizationId), eq(s.device.dmIdentifier, deviceId)),
        )
        .limit(1);

      return device ?? null;
    });

  const newDeviceId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

  const insertDevice = (input: {
    readonly id: string;
    readonly organizationId: string;
    readonly deviceId: string;
    readonly name: string;
    readonly timestamp: Date;
  }) =>
    Effect.gen(function* () {
      yield* db.insert(s.device).values({
        id: input.id,
        organizationId: input.organizationId,
        proto: "win",
        status: "enrolled",
        name: input.name,
        vendor: "Microsoft",
        dmIdentifier: input.deviceId,
        enrolledAt: input.timestamp,
        lastSeenAt: input.timestamp,
      });
      yield* syncDynamicGroupsForDevice(db, input.organizationId, input.id, {
        now: input.timestamp,
      }).pipe(Effect.catch(() => Effect.void));
    });

  const touchDevice = (deviceId: string, organizationId: string, timestamp: Date) =>
    Effect.gen(function* () {
      yield* db.update(s.device).set({ lastSeenAt: timestamp }).where(eq(s.device.id, deviceId));
      yield* syncDynamicGroupsForDevice(db, organizationId, deviceId, { now: timestamp }).pipe(
        Effect.catch(() => Effect.void),
      );
    });

  /**
   * Reject a device presenting an identity certificate whose serial was
   * revoked. The edge may forward the serial as hex or decimal, so compare
   * canonical forms. Certificate rows can be keyed by the internal device id or
   * the legacy Windows DeviceID.
   */
  const identityCertificateRevoked = (
    organizationId: string,
    device: { readonly id: string; readonly dmIdentifier?: string | null },
    serial: string | undefined,
  ): Effect.Effect<boolean, unknown> =>
    Effect.gen(function* () {
      const trimmed = serial?.trim();

      if (!trimmed) return false;
      const candidates = certificateSerialCandidates(trimmed);

      if (candidates.length === 0) return false;

      for (const deviceId of certificateDeviceIdsFor(device)) {
        const rows = yield* db
          .select({
            serial: s.scepIssuedCertificate.serial,
            revokedAt: s.scepIssuedCertificate.revokedAt,
          })
          .from(s.scepIssuedCertificate)
          .where(
            and(
              eq(s.scepIssuedCertificate.organizationId, organizationId),
              eq(s.scepIssuedCertificate.deviceId, deviceId),
            ),
          );

        if (
          rows.some(
            (row) =>
              row.revokedAt != null &&
              candidates.includes(normalizeIssuedCertificateSerial(row.serial)),
          )
        )
          return true;
      }

      return false;
    });

  /** Preserve the tenant token through discovery -> policy -> enroll URLs. */
  const tenantQuery = (token: string | undefined): string =>
    token?.trim() ? `?tenant=${encodeURIComponent(token.trim())}` : "";

  return {
    windowsDiscovery: (
      request: WindowsDiscoveryRequest,
    ): Effect.Effect<WindowsDiscoveryResponse, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const organizationId = yield* resolveOrganization({ tenantToken: request.tenantToken });

        const offeredFederated = request.authPolicies.some(
          (policy) => policy.trim().toLowerCase() === "federated",
        );

        const azureTenantId = federatedEnabled
          ? yield* tenantAzureTenantId(organizationId).pipe(Effect.mapError(() => internal()))
          : null;

        if (federatedEnabled && offeredFederated && azureTenantId) {
          // Mint a federated-mode tenant token so policy/enroll can enforce
          // Entra token validation without guessing from the request shape.
          const secret = yield* requireSecret();

          const federatedToken = yield* Effect.promise(() =>
            createWindowsTenantToken(organizationId, secret, {
              federated: true,
              ttlSeconds: tenantTokenTtlSeconds,
            }),
          );

          const query = tenantQuery(federatedToken);

          return {
            authPolicy: "Federated",
            // MS-MDE2 enrollment version supported by the WSTEP implementation.
            enrollmentVersion: "4.0",
            enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy${query}`,
            enrollmentServiceUrl: `${origin}/mdm/windows/enroll${query}`,
            authServiceUrl:
              federated?.authServiceUrl?.(azureTenantId) ??
              federatedAuthServiceUrl(azureTenantId, (federated?.clientId ? { clientId: federated.clientId } : {})),
          };
        }

        return {
          authPolicy: "OnPremise",
          // MS-MDE2 enrollment version supported by the WSTEP implementation.
          enrollmentVersion: "4.0",
          enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy${tenantQuery(request.tenantToken)}`,
          enrollmentServiceUrl: `${origin}/mdm/windows/enroll${tenantQuery(request.tenantToken)}`,
        };
      }),

    getWindowsEnrollmentPolicy: (
      authToken: string,
      context = {},
    ): Effect.Effect<WindowsEnrollmentPolicy, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const secret = yield* requireSecret();
        // A device may retry the policy call; keep the subject stable when it
        // presents one of our own still-valid tokens.
        const presentedToken = authToken.trim();
        const tenantEvaluation = yield* evaluateTenantToken(context.tenantToken);
        const presentedJwt = isFederatedTokenShaped(presentedToken);

        // Discovery mints a federated-mode tenant token; a JWT also selects
        // federated validation when the deployment supports it. OnPremise
        // discovery keeps working even when federated is configured.
        const federatedFlow =
          tenantEvaluation.verification?.federated === true || (federatedEnabled && presentedJwt);

        let organizationId: string;

        if (federatedFlow) {
          // Federated policy requests must carry a verifiable Entra token.
          // There is deliberately no fallback to an opaque client credential.
          if (!presentedJwt) return yield* Effect.fail(new UnknownDevice());

          const expectedOrganizationId = context.tenantToken?.trim()
            ? yield* resolveOrganization({ tenantToken: context.tenantToken })
            : null;

          organizationId = (yield* resolveFederatedOrganization(
            presentedToken,
            expectedOrganizationId,
          )).organizationId;
        } else {
          organizationId = yield* resolveOrganization({
            tenantToken: context.tenantToken,
          });
        }

        const evaluated = presentedToken
          ? yield* Effect.promise(() =>
              verifyWindowsEnrollmentTokenDetailed(presentedToken, secret, { ttlSeconds }),
            )
          : { verification: null, expired: false };

        // First enrollment legitimately arrives without a token (or with an
        // opaque WSTEP client credential we cannot verify). A token in *our*
        // format whose signature fails, however, is forgery: fail closed rather
        // than silently downgrading it to a fresh enrollment credential. A
        // token that verifies but has merely expired may start a fresh
        // enrollment subject, otherwise an offline device would be wedged
        // forever.
        if (
          isWindowsEnrollmentTokenShaped(presentedToken) &&
          !evaluated.verification &&
          !evaluated.expired
        )
          return yield* Effect.fail(new UnknownDevice());

        const presentedOrganizationId = evaluated.verification
          ? organizationFromWindowsEnrollmentSubject(evaluated.verification.subject)
          : null;

        // A token minted for another tenant must never be upgraded into this
        // tenant's enrollment flow.
        if (presentedOrganizationId && presentedOrganizationId !== organizationId)
          return yield* Effect.fail(new UnknownDevice());

        const subject =
          evaluated.verification &&
          presentedOrganizationId === organizationId &&
          evaluated.verification.subject
            ? evaluated.verification.subject
            : windowsEnrollmentSubject(organizationId);

        const issued = yield* Effect.promise(() =>
          createWindowsEnrollmentToken(subject, secret, { ttlSeconds }),
        );

        return {
          minimalKeyLength: "2048",
          certificateValidityPeriodSeconds: "31536000",
          renewalPeriodSeconds: "15552000",
          authToken: issued,
        };
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),

    windowsEnroll: (
      request: WindowsEnrollmentRequest,
    ): Effect.Effect<WindowsEnrollmentResult, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const secret = yield* requireSecret();
        const presentedToken = request.authToken.trim();
        const tenantEvaluation = yield* evaluateTenantToken(request.tenantToken);
        const presentedJwt = isFederatedTokenShaped(presentedToken);

        const federatedFlow =
          tenantEvaluation.verification?.federated === true || (federatedEnabled && presentedJwt);

        let organizationId: string;
        let deviceIdentifier: string;

        if (federatedFlow) {
          // The device presented an Entra token instead of (or after) our
          // WSTEP token. Validate it against the tenant's issuer and JWKS.
          if (!presentedJwt) return yield* Effect.fail(new UnknownDevice());

          const expectedOrganizationId = request.tenantToken?.trim()
            ? yield* resolveOrganization({ tenantToken: request.tenantToken })
            : null;

          const resolved = yield* resolveFederatedOrganization(
            presentedToken,
            expectedOrganizationId,
          );

          organizationId = resolved.organizationId;
          deviceIdentifier =
            request.deviceId?.trim() || resolved.claims.objectId || resolved.claims.subject;
        } else {
          const verification = yield* Effect.promise(() =>
            verifyWindowsEnrollmentToken(presentedToken, secret, { ttlSeconds }),
          );

          if (!verification) return yield* Effect.fail(new UnknownDevice());
          deviceIdentifier = request.deviceId?.trim() || verification.subject;
          organizationId = yield* resolveOrganization({
            tenantToken: request.tenantToken,
          });

          const boundOrganizationId = organizationFromWindowsEnrollmentSubject(
            verification.subject,
          );

          // The WSTEP token is minted per tenant. URL token and WSTEP token must
          // agree; an unbound legacy token is only accepted for the legacy
          // deployment-wide pin, never alongside a tenant token.
          if (boundOrganizationId && boundOrganizationId !== organizationId)
            return yield* Effect.fail(new UnknownDevice());

          if (!boundOrganizationId && request.tenantToken?.trim())
            return yield* Effect.fail(new UnknownDevice());
        }

        const [enrollment] = yield* db
          .select()
          .from(s.enterpriseEnrollment)
          .where(eq(s.enterpriseEnrollment.organizationId, organizationId))
          .limit(1);

        if (!enrollment?.enabledWindows) return yield* Effect.fail(new UnknownDevice());

        // Resolve the existing device (by Windows DeviceID) before enforcing the
        // tenant device cap: re-enrolling an existing device must not fail just
        // because the tenant is at its limit.
        const existing = yield* findDevice(organizationId, deviceIdentifier);

        // `maxDevices === 0` means unlimited for the tenant.
        if (!existing && enrollment.maxDevices > 0) {
          const windowsDevices = yield* db
            .select({ id: s.device.id })
            .from(s.device)
            .where(and(eq(s.device.organizationId, organizationId), eq(s.device.proto, "win")))
            .limit(enrollment.maxDevices);

          if (windowsDevices.length >= enrollment.maxDevices)
            return yield* Effect.fail(new UnknownDevice());
        }

        // The deployment plan limit applies to all platforms. Re-enrolling an
        // existing device is always allowed.
        if (!existing) {
          const planStatus = yield* deviceLimitForOrganization({
            db,
            organizationId,
            config: options.planLimits,
          }).pipe(Effect.mapError(() => new InternalServerError()));

          if (planStatus.reached) return yield* Effect.fail(new UnknownDevice());
        }

        const [ca] = yield* db.select().from(s.scepCa).where(eq(s.scepCa.id, 1)).limit(1);

        if (!ca) return yield* Effect.fail(internal());

        // Windows issuance reads the same sealed CA key as SCEP issuance. Pick
        // up a lazy migration (legacy plaintext row) exactly like the SCEP
        // repository does; failure must never fall back to a new CA.
        const caKey = yield* Effect.tryPromise({
          try: () => openCaPrivateKey(ca.privateKeyJwk, authSecret),
          catch: internal,
        });

        if (caKey.migrated) {
          yield* db
            .update(s.scepCa)
            .set({ privateKeyJwk: caKey.migrated })
            .where(eq(s.scepCa.id, 1));
        }

        const timestamp = new Date();
        const notAfter = new Date(timestamp.getTime() + 365 * 24 * 60 * 60 * 1000);

        const signed = yield* signScepCsr({
          csr: request.csr,
          caCertPem: ca.certPem,
          caPrivateKeyJwk: caKey.privateKeyJwk,
          notBefore: timestamp,
          notAfter,
          deviceId: deviceIdentifier,
          organizationalUnit: organizationId,
        }).pipe(Effect.mapError(internal));

        // `device.id` is the internal row id used by revocation, health and
        // renewal. `deviceIdentifier` (the Windows DeviceID) stays in
        // `dmIdentifier` for check-in discovery. Recording the certificate
        // against the DeviceID here is what previously made revocation inert.
        const deviceRowId = existing?.id ?? newDeviceId();
        const name = request.deviceName?.trim() || deviceIdentifier;

        if (existing) {
          yield* db
            .update(s.device)
            .set({
              proto: "win",
              status: "enrolled",
              name: request.deviceName?.trim() || existing.name,
              vendor: "Microsoft",
              dmIdentifier: deviceIdentifier,
              lastSeenAt: timestamp,
            })
            .where(eq(s.device.id, existing.id));
          yield* syncDynamicGroupsForDevice(db, organizationId, existing.id, {
            now: timestamp,
          }).pipe(Effect.catch(() => Effect.void));
        } else {
          yield* insertDevice({
            id: deviceRowId,
            organizationId,
            deviceId: deviceIdentifier,
            name,
            timestamp,
          });
        }

        const serial = certificateSerialHex(signed.certificate);

        const [recorded] = yield* db
          .select({
            serial: s.scepIssuedCertificate.serial,
            organizationId: s.scepIssuedCertificate.organizationId,
            deviceId: s.scepIssuedCertificate.deviceId,
          })
          .from(s.scepIssuedCertificate)
          .where(eq(s.scepIssuedCertificate.serial, serial))
          .limit(1);

        if (recorded) {
          // Serial collisions are now ~2^-127, but a stale row could still
          // exist. Reuse it only for the same tenant *and* device; never let a
          // colliding serial overwrite another identity (which would make its
          // renewals authenticate as the wrong tenant/device).
          const sameIdentity =
            recorded.organizationId === organizationId &&
            (recorded.deviceId === deviceRowId || recorded.deviceId === deviceIdentifier);

          if (!sameIdentity) return yield* Effect.fail(internal());
          yield* db
            .update(s.scepIssuedCertificate)
            .set({
              // Migrate legacy DeviceID-keyed rows to the internal id as we go.
              deviceId: deviceRowId,
              enrollmentId: null,
              notAfter,
              createdAt: timestamp,
              // Deliberately do not clear `revokedAt`: a duplicate serial is a
              // replay/collision, and must never silently un-revoke an identity.
            })
            .where(
              and(
                eq(s.scepIssuedCertificate.serial, serial),
                eq(s.scepIssuedCertificate.organizationId, organizationId),
              ),
            );
        } else {
          yield* db.insert(s.scepIssuedCertificate).values({
            serial,
            organizationId,
            enrollmentId: null,
            deviceId: deviceRowId,
            notAfter,
            createdAt: timestamp,
          });
        }

        return {
          deviceId: deviceIdentifier,
          signedCertificate: signed.certificatePem,
          identityCertificate: ca.certPem,
          // The provisioning document uses these for the APPSRV DIGEST
          // challenge. The management endpoint does not currently issue
          // commands, so the secret only needs to be unguessable.
          username: deviceIdentifier,
          secret: crypto.randomUUID(),
          providerId: "Mattrax",
        };
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),

    windowsManagementCheckin: (
      scope: WindowsManagementScope,
      checkinRequest: WindowsManagementRequest,
    ): Effect.Effect<WindowsManagementResponse, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const organizationId = yield* resolveOrganization({
          tenantToken: scope.tenantToken,
          identityCertificate: scope.identityCertificate,
          requireCertificate: requireDeviceIdentity,
          // The management URL's enrollment token may have expired; the
          // client certificate remains the durable device identity.
          rejectInvalidToken: false,
        });

        if (requireDeviceIdentity) {
          const subjectCn = certificateAttribute(scope.identityCertificate, "CN");

          if (subjectCn && subjectCn !== scope.deviceId) {
            return yield* Effect.fail(new UnknownDevice());
          }
        }

        const device = yield* findDevice(organizationId, scope.deviceId);

        if (!device) return yield* Effect.fail(new UnknownDevice());

        if (
          requireDeviceIdentity &&
          (yield* identityCertificateRevoked(
            organizationId,
            device,
            scope.identityCertificateSerial,
          ))
        )
          return yield* Effect.fail(new UnknownDevice());
        yield* touchDevice(device.id, organizationId, new Date());

        for (const status of checkinRequest.statuses) {
          const entry = status as { cmdRef?: unknown; data?: unknown };
          const commandId = typeof entry.cmdRef === "string" ? entry.cmdRef : undefined;

          if (!commandId) continue;
          const data = String(entry.data ?? "");
          yield* db
            .update(s.deviceCommand)
            .set({
              status: data === "200" ? "succeeded" : data === "418" ? "queued" : "failed",
              resultStatus: data,
              updatedAt: new Date(),
            })
            .where(and(eq(s.deviceCommand.id, commandId), eq(s.deviceCommand.deviceId, device.id)));
        }

        const effective = yield* resolveEffectivePolicyForDevice(db, {
          id: device.id,
          organizationId: device.organizationId,
        });

        const configurations = effective.configurations.map((configuration) => ({
          policyId: configuration.policyId,
          kind: configuration.kind,
          data: configuration.data,
        }));

        const commands: Array<{
          kind: string;
          cmdID: string;
          locURI?: string;
          data?: string;
          format?: string;
        }> = [];

        // 1 is reserved for the SyncHdr status; server commands start at 2.
        let index = 2;

        // Resolve duplicate OMA-URIs deterministically. A policy with a
        // lexicographically smaller id wins, so check-ins are stable across
        // group ordering and devices.
        const desired = new Map<
          string,
          { readonly policyId: string; readonly data: string; readonly format?: string }
        >();

        const sorted = [...configurations].sort((left, right) =>
          String(left.policyId).localeCompare(String(right.policyId)),
        );

        for (const configuration of sorted) {
          for (const node of windowsPolicyNodes({
            policyId: configuration.policyId,
            kind: configuration.kind,
            data: configuration.data,
            hash: "",
          })) {
            if (desired.has(node.omaUri)) continue;
            desired.set(node.omaUri, {
              policyId: configuration.policyId,
              data:
                typeof node.value === "string"
                  ? node.value
                  : typeof node.value === "object"
                    ? JSON.stringify(node.value)
                    : String(node.value),
              ...(node.format ? { format: node.format } : {}),
            });
          }
        }

        for (const [locURI, node] of desired) {
          commands.push({
            kind: "Replace",
            cmdID: String(index++),
            locURI,
            data: node.data,
            ...(node.format ? { format: node.format } : {}),
          });
        }

        // Commands handed out but never acknowledged would otherwise stay
        // "sent" forever. Re-queue them so the next check-in retries.
        yield* db
          .update(s.deviceCommand)
          .set({ status: "queued", updatedAt: new Date() })
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              eq(s.deviceCommand.status, "sent"),
              lt(s.deviceCommand.updatedAt, new Date(Date.now() - 30 * 60 * 1000)),
            ),
          );

        const queued = yield* db
          .select()
          .from(s.deviceCommand)
          .where(and(eq(s.deviceCommand.deviceId, device.id), eq(s.deviceCommand.status, "queued")))
          .orderBy(asc(s.deviceCommand.createdAt))
          .limit(1000);

        for (const command of queued) {
          const payload = (command.payload ?? {}) as { locURI?: string; data?: string };
          commands.push({
            kind: "Exec",
            cmdID: command.id,
            locURI: payload.locURI ?? "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected",
            data: payload.data ?? "",
            format: "chr",
          });
          yield* db
            .update(s.deviceCommand)
            .set({ status: "sent", updatedAt: new Date() })
            .where(eq(s.deviceCommand.id, command.id));
        }

        return { commands };
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),

    windowsDeviceEvent: (
      scope: WindowsManagementScope,
      event: WindowsDeviceEvent,
    ): Effect.Effect<void, UnknownDevice | InternalServerError> =>
      Effect.gen(function* () {
        const deviceId = event.deviceId || scope.deviceId;
        // An `Enrolled` event is the tail of the enrollment flow, which may not
        // have a client certificate yet; it is allowed to authenticate with the
        // tenant token (or the legacy pin). Management events must prove device
        // identity when configured.
        const isEnrollmentEvent = event._tag === "Enrolled";

        const organizationId = yield* resolveOrganization({
          tenantToken: scope.tenantToken,
          identityCertificate: scope.identityCertificate,
          requireCertificate: requireDeviceIdentity && !isEnrollmentEvent,
          // A management event authenticated by certificate must not be
          // wedged by an expired enrollment URL token.
          rejectInvalidToken: isEnrollmentEvent,
        });

        if (requireDeviceIdentity && !isEnrollmentEvent) {
          const subjectCn = certificateAttribute(scope.identityCertificate, "CN");

          if (subjectCn && subjectCn !== deviceId) return yield* Effect.fail(new UnknownDevice());
        }

        const device = yield* findDevice(organizationId, deviceId);
        const timestamp = new Date();

        if (requireDeviceIdentity && !isEnrollmentEvent && device) {
          if (
            yield* identityCertificateRevoked(
              organizationId,
              device,
              scope.identityCertificateSerial,
            )
          )
            return yield* Effect.fail(new UnknownDevice());
        }

        if (event._tag === "Enrolled") {
          if (device) {
            yield* db
              .update(s.device)
              .set({ status: "enrolled", lastSeenAt: timestamp })
              .where(eq(s.device.id, device.id));
            yield* syncDynamicGroupsForDevice(db, organizationId, device.id, {
              now: timestamp,
            }).pipe(Effect.catch(() => Effect.void));
          } else {
            yield* insertDevice({
              id: newDeviceId(),
              organizationId,
              deviceId,
              name: deviceId,
              timestamp,
            });
          }

          return;
        }

        if (!device) return yield* Effect.fail(new UnknownDevice());
        // ManagementCheckin and CommandResult both prove liveness. Command
        // history is not persisted because command delivery is not implemented.
        yield* touchDevice(device.id, organizationId, timestamp);
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal()))),
  };
};
