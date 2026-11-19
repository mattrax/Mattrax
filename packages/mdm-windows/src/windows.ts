import { Cause, Effect, Option, Predicate, Schema } from "effect";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { windowsPolicyNodes } from "@mattrax/mdm-core";
import { resolveEffectivePolicyForDevice } from "@mattrax/mdm-core";
import { syncDynamicGroupsForDevice } from "@mattrax/mdm-core";
import { deleteDepartedTenantDevice } from "@mattrax/mdm-core";
import {
  ACTIVE_COMMAND_STATUSES,
  COMMAND_EXPIRED_DETAIL,
  DEVICE_COMMAND_ACTIVE_LIMIT,
  RECONCILED_RESULT_STATUS,
  commandStatusIsActive,
  planCommandDeliveryBatch,
} from "@mattrax/mdm-core";
import {
  WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE,
  WINDOWS_INVENTORY_GET_REQUEST_TYPE,
  WINDOWS_POLICY_DELETE_REQUEST_TYPE,
  WINDOWS_POLICY_REPLACE_REQUEST_TYPE,
  WINDOWS_STATE_COMMAND_REQUEST_TYPES,
  WINDOWS_UNENROLL_ALERT,
  WINDOWS_UNENROLL_REQUEST_TYPE,
  planWindowsPolicyDelivery,
  windowsCommandOutcome,
  windowsInventoryCommandRowId,
  windowsPolicyCommandId,
  windowsPolicyNodeHash,
  windowsPolicyRejectionDetail,
  windowsSyncMLData,
  windowsSyncMLLocURI,
  type WindowsDeliveredPolicyNode,
  type WindowsPolicyFailure,
} from "./windowsCommands.ts";
import {
  describeWindowsFailure,
  deviceLimitForOrganization,
  recordWindowsFailure,
  replaceDeviceApplications,
  schema as s,
  type Db,
  type PlanLimitsConfig,
} from "@mattrax/enterprise-core";
import { certificateSerialHex, ensureScepCa, signScepCsr } from "@mattrax/scep";
import { normalizeIssuedCertificateSerial, ScepRepositoryLive } from "@mattrax/mdm-core";
import {
  WINDOWS_APPLICATION_INVENTORY_REQUESTS,
  WINDOWS_MDM_PROVIDER_ID,
  hasWindowsInventory,
  hasWindowsSecurityInventory,
  mergeWindowsApplicationReport,
  parseWindowsApplicationsReport,
  parseWindowsInventory,
  windowsApplicationInventoryDue,
  windowsInventoryDue,
  windowsInventoryRequests,
  windowsInventoryUpdate,
  windowsInventoryValues,
} from "./windowsInventory.ts";
import {
  federatedAuthServiceUrl,
  isFederatedToken,
  unverifiedFederatedTenantId,
  validateFederatedEntraToken,
  type FederatedEntraClaims,
  type FederatedJsonWebKeySet,
  type FederatedTokenValidation,
  type ValidateFederatedEntraTokenOptions,
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
  type WindowsFailurePhase,
  type WindowsFailureReport,
  type WindowsManagementRequest,
  type WindowsManagementResponse,
  type WindowsManagementScope,
} from "@mattrax/management-backend";

const encoder = new TextEncoder();

const JsonArray = Schema.Array(Schema.Json);

const StatusEntry = Schema.Struct({
  cmdRef: Schema.optional(Schema.Json),
  data: Schema.optional(Schema.Json),
});

const AlertEntry = Schema.Struct({
  cmdRef: Schema.optional(Schema.Json),
  data: Schema.optional(Schema.Json),
  items: Schema.optional(Schema.Array(Schema.Json)),
});

type WindowsCommandPayload = { [key: string]: Schema.Json };

const commandPayload = (value: Schema.Json | null | undefined): WindowsCommandPayload =>
  Schema.is(Schema.JsonObject)(value) ? value : {};

const payloadString = (payload: WindowsCommandPayload, key: string): string | undefined => {
  const value = payload[key];

  return Schema.is(Schema.String)(value) ? value : undefined;
};

const payloadArray = (
  value: Schema.Json | null | undefined,
): ReadonlyArray<WindowsDeliveredPolicyNode> => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!Schema.is(Schema.JsonObject)(entry)) return [];
    const uri = entry["uri"];
    const hash = entry["hash"];

    return Schema.is(Schema.String)(uri) && Schema.is(Schema.String)(hash) ? [{ uri, hash }] : [];
  });
};

const policyFailures = (
  value: Schema.Json | null | undefined,
): ReadonlyArray<WindowsPolicyFailure> => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!Schema.is(Schema.JsonObject)(entry)) return [];
    const uri = entry["uri"];
    const hash = entry["hash"];
    const resultStatus = entry["resultStatus"];
    const detail = entry["detail"];
    const at = entry["at"];

    if (
      !Schema.is(Schema.String)(uri) ||
      !Schema.is(Schema.String)(hash) ||
      !Schema.is(Schema.String)(resultStatus) ||
      !Schema.is(Schema.String)(detail) ||
      !Schema.is(Schema.String)(at)
    )
      return [];

    return [{ uri, hash, resultStatus, detail, at }];
  });
};

const stringArray = (value: Schema.Json | null | undefined): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter(Schema.is(Schema.String)) : [];

type WindowsCommand = {
  kind: string;
  cmdID: string;
  locURI?: string;
  data?: string;
  format?: string;
};

/** Payload of a state command (policy or inventory) written by the server. */
type WindowsStateCommandPayload = {
  kind: string;
  locURI: string;
  cmdID?: string;
  data?: string;
  format?: string;
  hash?: string;
};

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
const isWindowsEnrollmentToken = (token: string): boolean => {
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
 * Certificates issued by {@link createWindowsBackend} used to store the Windows
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
  /**
   * `DMClient/Provider/{ProviderID}` written into the provisioning document.
   * Inventory and unenroll address the same provider, so changing it must be
   * done for the whole deployment (`WindowsMdmServiceLive` too).
   */
  readonly providerId?: string;
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
  | "windowsRecordFailure"
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

export const createWindowsBackend = (options: WindowsBackendOptions): WindowsBackend => {
  const { db, origin, authSecret, windowsOrganizationId, requireDeviceIdentity } = options;
  const ttlSeconds = options.enrollmentTokenTtlSeconds ?? DEFAULT_ENROLLMENT_TOKEN_TTL_SECONDS;

  const tenantTokenTtlSeconds =
    options.tenantTokenTtlSeconds ?? DEFAULT_WINDOWS_TENANT_TOKEN_TTL_SECONDS;

  const internal = () => new InternalServerError();
  const providerId = options.providerId?.trim() || WINDOWS_MDM_PROVIDER_ID;
  const inventoryRequests = windowsInventoryRequests(providerId);

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
    (Schema.is(Schema.String)(federatedAudience)
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
    Effect.promise(() => {
      const input: ValidateFederatedEntraTokenOptions = {
        token,
        tenantId: azureTenantId,
        audience: federatedAudience!,
        jwks: federated?.jwks,
        jwksUri: federated?.jwksUri?.(azureTenantId),
        fetch: federated?.fetch,
        now: federated?.now,
        clockToleranceSeconds: federated?.clockToleranceSeconds,
      };

      return validateFederatedEntraToken(input);
    });

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

  /**
   * Record one failed Windows request. Never fails: a diagnostic write must not
   * change the SOAP fault or SyncML status the device receives. Failures with
   * no attributable tenant (an unsigned or forged enrollment link) are skipped,
   * so an anonymous caller cannot write into another tenant's history.
   */
  const reportFailure = (input: {
    readonly organizationId: string | null | undefined;
    readonly deviceId?: string | null;
    readonly deviceIdentifier?: string | null;
    readonly serial?: string | null;
    readonly hostname?: string | null;
    readonly phase: WindowsFailurePhase;
    readonly code: string;
    readonly message: string;
    readonly detail?: string | null;
  }): Effect.Effect<boolean> =>
    input.organizationId
      ? recordWindowsFailure(db, {
          organizationId: input.organizationId,
          deviceId: input.deviceId,
          deviceIdentifier: input.deviceIdentifier,
          serial: input.serial,
          hostname: input.hostname,
          phase: input.phase,
          code: input.code,
          message: input.message,
          detail: input.detail == null ? null : describeWindowsFailure(input.detail),
        }).pipe(Effect.as(true))
      : Effect.succeed(false);

  /** Low-cardinality code for an error that reached the method boundary. */
  const failureCode = (cause: unknown): string => {
    if (Predicate.isTagged(cause, "UnknownDevice")) return "unknown_device";

    if (Predicate.isTagged(cause, "InternalServerError")) return "internal_error";

    return "request_failed";
  };

  /**
   * Code and bounded detail for a failed request, or `null` when the request
   * was only interrupted (shutdown, client abort) and there is nothing useful
   * to record.
   */
  const failureDetails = (
    cause: Cause.Cause<unknown>,
  ): { readonly code: string; readonly detail: string } | null => {
    if (Cause.hasInterruptsOnly(cause)) return null;

    let error: unknown;

    try {
      error = Cause.squash(cause);
    } catch {
      error = cause;
    }

    return { code: failureCode(error), detail: describeWindowsFailure(error) };
  };

  /** Best-effort tenant attribution for a failure that happened early. */
  const organizationForFailure = (
    tenantToken: string | undefined,
    current: string | null,
  ): Effect.Effect<string | null> =>
    current
      ? Effect.succeed(current)
      : resolveOrganization({ tenantToken }).pipe(Effect.catch(() => Effect.succeed(null)));

  /**
   * Record a failure that escaped a method boundary. Tenant attribution is
   * retried from the signed tenant token so a federated enrollment that fails
   * before the organization is assigned is still visible.
   */
  const reportCause = (input: {
    readonly tenantToken: string | undefined;
    readonly organizationId: string | null;
    readonly deviceId?: string | null;
    readonly deviceIdentifier?: string | null;
    readonly serial?: string | null;
    readonly hostname?: string | null;
    readonly phase: WindowsFailurePhase;
    readonly message: string;
    readonly cause: Cause.Cause<unknown>;
  }): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const details = failureDetails(input.cause);

      if (!details) return false;

      const organizationId = yield* organizationForFailure(input.tenantToken, input.organizationId);

      return yield* reportFailure({
        organizationId,
        deviceId: input.deviceId,
        deviceIdentifier: input.deviceIdentifier,
        serial: input.serial,
        hostname: input.hostname,
        phase: input.phase,
        code: details.code,
        message: input.message,
        detail: details.detail,
      });
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

  /**
   * Revoke every identity certificate bound to a device that has left
   * management. Device-initiated unenrolment reports itself on a check-in and
   * has no operator request to run this cleanup, so the management layer owns
   * it here.
   */
  const revokeWindowsIdentityCertificates = (
    organizationId: string,
    device: { readonly id: string; readonly dmIdentifier?: string | null },
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const deviceIds = certificateDeviceIdsFor(device);

      if (deviceIds.length === 0) return;

      yield* db
        .update(s.scepIssuedCertificate)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(s.scepIssuedCertificate.organizationId, organizationId),
            inArray(s.scepIssuedCertificate.deviceId, deviceIds),
            isNull(s.scepIssuedCertificate.revokedAt),
          ),
        );
    });

  /**
   * Finish a device-initiated or server-acknowledged unenrolment: the device
   * is no longer managed, every queued command is moot, and its identity
   * certificate must not stay usable.
   */
  const completeWindowsUnenrollment = (
    organizationId: string,
    device: { readonly id: string; readonly dmIdentifier?: string | null },
    timestamp: Date,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      yield* db
        .update(s.device)
        .set({
          status: "unenrolled",
          windowsPolicyApplied: null,
          windowsPolicyDelivered: null,
          windowsPolicyReverting: null,
          windowsPolicyFailures: null,
          windowsPolicyUpdatedAt: timestamp,
          windowsPolicyRevertedAt: timestamp,
        })
        .where(eq(s.device.id, device.id));

      yield* db
        .update(s.deviceCommand)
        .set({
          status: "cancelled",
          dedupeKey: null,
          resultStatus: RECONCILED_RESULT_STATUS,
          resultDetail: "The device left management, so the command was never delivered.",
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(s.deviceCommand.deviceId, device.id),
            inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
          ),
        );

      yield* revokeWindowsIdentityCertificates(organizationId, device).pipe(
        Effect.catch(() => Effect.void),
      );
      yield* touchDevice(device.id, organizationId, timestamp);
    });

  /** Preserve the tenant token through discovery -> policy -> enroll URLs. */
  const tenantQuery = (token: string | undefined): string =>
    token?.trim() ? `?tenant=${encodeURIComponent(token.trim())}` : "";

  return {
    windowsDiscovery: (
      request: WindowsDiscoveryRequest,
    ): Effect.Effect<WindowsDiscoveryResponse, UnknownDevice | InternalServerError> => {
      let attributableOrganizationId: string | null = null;

      let boundaryRecorded = false;

      return Effect.gen(function* () {
        const organizationId = yield* resolveOrganization({ tenantToken: request.tenantToken });
        attributableOrganizationId = organizationId;

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
              federatedAuthServiceUrl(
                azureTenantId,
                federated?.clientId ? { clientId: federated.clientId } : {},
              ),
          };
        }

        return {
          authPolicy: "OnPremise",
          // MS-MDE2 enrollment version supported by the WSTEP implementation.
          enrollmentVersion: "4.0",
          enrollmentPolicyServiceUrl: `${origin}/mdm/windows/policy${tenantQuery(request.tenantToken)}`,
          enrollmentServiceUrl: `${origin}/mdm/windows/enroll${tenantQuery(request.tenantToken)}`,
        };
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            boundaryRecorded = yield* reportCause({
              tenantToken: request.tenantToken,
              organizationId: attributableOrganizationId,
              phase: "discovery",
              message:
                "Windows discovery failed. The tenant's enrollment link may be invalid or expired, so the device cannot start enrollment.",
              cause,
            });
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof UnknownDevice
            ? new UnknownDevice({ recorded: boundaryRecorded })
            : new InternalServerError({ recorded: boundaryRecorded }),
        ),
      );
    },

    getWindowsEnrollmentPolicy: (
      authToken: string,
      context = {},
    ): Effect.Effect<WindowsEnrollmentPolicy, UnknownDevice | InternalServerError> => {
      let attributableOrganizationId: string | null = null;
      let reported = false;

      let boundaryRecorded = false;

      const report = (code: string, message: string, detail?: string) =>
        Effect.gen(function* () {
          reported = true;
          attributableOrganizationId = yield* organizationForFailure(
            context.tenantToken,
            attributableOrganizationId,
          );

          boundaryRecorded =
            (yield* reportFailure({
              organizationId: attributableOrganizationId,
              phase: "policy",
              code,
              message,
              detail,
            })) || boundaryRecorded;
        });

      return Effect.gen(function* () {
        const secret = yield* requireSecret();
        // A device may retry the policy call; keep the subject stable when it
        // presents one of our own still-valid tokens.
        const presentedToken = authToken.trim();
        const tenantEvaluation = yield* evaluateTenantToken(context.tenantToken);
        const presentedJwt = isFederatedToken(presentedToken);

        // Discovery mints a federated-mode tenant token; a JWT also selects
        // federated validation when the deployment supports it. OnPremise
        // discovery keeps working even when federated is configured.
        const federatedFlow =
          tenantEvaluation.verification?.federated === true || (federatedEnabled && presentedJwt);

        let organizationId: string;

        if (federatedFlow) {
          // Federated policy requests must carry a verifiable Entra token.
          // There is deliberately no fallback to an opaque client credential.
          if (!presentedJwt) {
            yield* report(
              "federated_token_missing",
              "Windows policy was rejected: the device did not present the Entra token this tenant requires.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }

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

        attributableOrganizationId = organizationId;

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
          isWindowsEnrollmentToken(presentedToken) &&
          !evaluated.verification &&
          !evaluated.expired
        ) {
          yield* report(
            "enrollment_token_invalid",
            "Windows policy was rejected: the WSTEP enrollment token is invalid or expired. Enroll the device again from a fresh link.",
          );

          return yield* Effect.fail(new UnknownDevice());
        }

        const presentedOrganizationId = evaluated.verification
          ? organizationFromWindowsEnrollmentSubject(evaluated.verification.subject)
          : null;

        // A token minted for another tenant must never be upgraded into this
        // tenant's enrollment flow.
        if (presentedOrganizationId && presentedOrganizationId !== organizationId) {
          yield* report(
            "tenant_token_invalid",
            "Windows policy was rejected: the enrollment token belongs to a different tenant.",
          );

          return yield* Effect.fail(new UnknownDevice());
        }

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
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            if (reported) return;

            boundaryRecorded = yield* reportCause({
              tenantToken: context.tenantToken,
              organizationId: attributableOrganizationId,
              phase: "policy",
              message:
                "Windows policy request failed. The device cannot fetch its certificate policy.",
              cause,
            });
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof UnknownDevice
            ? new UnknownDevice({ recorded: boundaryRecorded })
            : new InternalServerError({ recorded: boundaryRecorded }),
        ),
      );
    },

    windowsEnroll: (
      request: WindowsEnrollmentRequest,
    ): Effect.Effect<WindowsEnrollmentResult, UnknownDevice | InternalServerError> => {
      let attributableOrganizationId: string | null = null;
      let reported = false;

      let boundaryRecorded = false;

      let attributableDevice: {
        readonly id: string;
        readonly serial: string | null;
        readonly name: string;
      } | null = null;

      let deviceIdentifier = request.deviceId?.trim() || null;
      const hostname = request.deviceName?.trim() || null;

      const report = (phase: WindowsFailurePhase, code: string, message: string, detail?: string) =>
        Effect.gen(function* () {
          reported = true;
          attributableOrganizationId = yield* organizationForFailure(
            request.tenantToken,
            attributableOrganizationId,
          );

          boundaryRecorded =
            (yield* reportFailure({
              organizationId: attributableOrganizationId,
              deviceId: attributableDevice?.id,
              deviceIdentifier,
              serial: attributableDevice?.serial,
              hostname: attributableDevice?.name ?? hostname,
              phase,
              code,
              message,
              detail,
            })) || boundaryRecorded;
        });

      return Effect.gen(function* () {
        const secret = yield* requireSecret();
        const presentedToken = request.authToken.trim();
        const tenantEvaluation = yield* evaluateTenantToken(request.tenantToken);
        const presentedJwt = isFederatedToken(presentedToken);

        const federatedFlow =
          tenantEvaluation.verification?.federated === true || (federatedEnabled && presentedJwt);

        let organizationId: string;

        if (federatedFlow) {
          // The device presented an Entra token instead of (or after) our
          // WSTEP token. Validate it against the tenant's issuer and JWKS.
          if (!presentedJwt) {
            yield* report(
              "enrollment",
              "federated_token_missing",
              "Windows enrollment was rejected: the device did not present the Entra token this tenant requires.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }

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

          if (!verification) {
            yield* report(
              "enrollment",
              "enrollment_token_invalid",
              "Windows enrollment was rejected: the WSTEP enrollment token is invalid or expired. Start a fresh enrollment from the tenant's enrollment link.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }

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
          if (boundOrganizationId && boundOrganizationId !== organizationId) {
            yield* report(
              "enrollment",
              "tenant_token_invalid",
              "Windows enrollment was rejected: the enrollment token belongs to a different tenant.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }

          if (!boundOrganizationId && request.tenantToken?.trim()) {
            yield* report(
              "enrollment",
              "tenant_token_missing",
              "Windows enrollment was rejected: the device presented a deployment-wide token with a tenant-specific enrollment link.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }
        }

        attributableOrganizationId = organizationId;

        const [enrollment] = yield* db
          .select()
          .from(s.enterpriseEnrollment)
          .where(eq(s.enterpriseEnrollment.organizationId, organizationId))
          .limit(1);

        if (!enrollment?.enabledWindows) {
          yield* report(
            "enrollment",
            "windows_disabled",
            "Windows enrollment is disabled for this tenant. Enable it in Settings → Enrollment.",
          );

          return yield* Effect.fail(new UnknownDevice());
        }

        // Resolve the existing device (by Windows DeviceID) before enforcing the
        // tenant device cap: re-enrolling an existing device must not fail just
        // because the tenant is at its limit.
        const existing = yield* findDevice(organizationId, deviceIdentifier);
        attributableDevice = existing;

        // The same DeviceID can enroll into a different tenant after the
        // machine is re-enrolled. Keep a note of the old rows now and remove
        // them once this enrollment is durable; otherwise the previous tenant
        // retains a managed device (and its policies, commands and seats)
        // until the stale-device sweep.
        //
        // The DeviceID is asserted by the client, so deletion also requires
        // tenant-owned proof that the hardware belongs here: an Autopilot
        // record or a pre-registration. `device_dm_identifier_idx` serves this
        // cross-tenant lookup, which the per-tenant indexes cannot.
        const departedDevices = (yield* db
          .select()
          .from(s.device)
          .where(
            and(eq(s.device.proto, "win"), eq(s.device.dmIdentifier, deviceIdentifier)),
          )).filter((row) => row.organizationId !== organizationId);

        const normalisedDeviceIdentifier = deviceIdentifier.toUpperCase();

        const [autopilotBySerial] = yield* db
          .select()
          .from(s.autopilotDevice)
          .where(
            and(
              eq(s.autopilotDevice.organizationId, organizationId),
              eq(s.autopilotDevice.serial, normalisedDeviceIdentifier),
            ),
          )
          .limit(1);

        const [autopilotByAzureId] = yield* db
          .select()
          .from(s.autopilotDevice)
          .where(
            and(
              eq(s.autopilotDevice.organizationId, organizationId),
              eq(s.autopilotDevice.azureAdDeviceId, deviceIdentifier),
            ),
          )
          .limit(1);

        const [autopilotByDevice] = existing
          ? yield* db
              .select()
              .from(s.autopilotDevice)
              .where(
                and(
                  eq(s.autopilotDevice.organizationId, organizationId),
                  eq(s.autopilotDevice.deviceId, existing.id),
                ),
              )
              .limit(1)
          : [];

        const autopilotProof = Boolean(
          autopilotBySerial || autopilotByAzureId || autopilotByDevice,
        );

        const [preRegistrationProof] = yield* db
          .select()
          .from(s.devicePreRegistration)
          .where(
            and(
              eq(s.devicePreRegistration.organizationId, organizationId),
              eq(s.devicePreRegistration.serial, deviceIdentifier),
            ),
          )
          .limit(1);

        const arrivalProof = autopilotProof || Boolean(preRegistrationProof);

        // `maxDevices === 0` means unlimited for the tenant.
        if (!existing && enrollment.maxDevices > 0) {
          const windowsDevices = yield* db
            .select({ id: s.device.id })
            .from(s.device)
            .where(and(eq(s.device.organizationId, organizationId), eq(s.device.proto, "win")))
            .limit(enrollment.maxDevices);

          if (windowsDevices.length >= enrollment.maxDevices) {
            yield* report(
              "enrollment",
              "device_limit_reached",
              "Windows enrollment was rejected: the tenant's device limit has been reached. Raise the limit or retire a device.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }
        }

        // The deployment plan limit applies to all platforms. Re-enrolling an
        // existing device is always allowed.
        if (!existing) {
          const planStatus = yield* deviceLimitForOrganization({
            db,
            organizationId,
            config: options.planLimits,
          }).pipe(Effect.mapError(() => new InternalServerError()));

          if (planStatus.reached) {
            yield* report(
              "enrollment",
              "plan_limit_reached",
              "Windows enrollment was rejected: the deployment plan's device limit has been reached.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }
        }

        // Windows issues from the tenant's CA, bootstrapping it on first use so
        // a tenant that only uses Windows still gets an isolated identity. The
        // repository opens (and lazily seals) the key; failure must never fall
        // back to a different CA.
        const ca = yield* ensureScepCa(ScepRepositoryLive.make(db, { authSecret }), {
          organizationId,
        }).pipe(
          Effect.tapError((cause) =>
            report(
              "wstep",
              "ca_unavailable",
              "Windows certificate issuance failed: the tenant's identity CA could not be opened or created. Check the tenant's certificate authority in Settings → Management.",
              describeWindowsFailure(cause),
            ),
          ),
          Effect.mapError(() => internal()),
        );

        const timestamp = new Date();
        const notAfter = new Date(timestamp.getTime() + 365 * 24 * 60 * 60 * 1000);

        const signed = yield* signScepCsr({
          csr: request.csr,
          caCertPem: ca.certPem,
          caPrivateKeyJwk: ca.privateKeyJwk,
          notBefore: timestamp,
          notAfter,
          deviceId: deviceIdentifier,
          organizationalUnit: organizationId,
        }).pipe(
          Effect.tapError((cause) =>
            report(
              "wstep",
              "certificate_signing_failed",
              "Windows certificate issuance failed: the certificate request could not be signed by the tenant's CA.",
              describeWindowsFailure(cause),
            ),
          ),
          Effect.mapError(() => internal()),
        );

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

        // The device row is durable from here on, so a later failure (a serial
        // collision, for example) belongs to it rather than to the pre-enrolment
        // DeviceID the client asserted.
        attributableDevice = {
          id: deviceRowId,
          serial: existing?.serial ?? null,
          name: existing ? request.deviceName?.trim() || existing.name : name,
        };

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

          if (!sameIdentity) {
            yield* report(
              "wstep",
              "certificate_serial_collision",
              "Windows certificate issuance failed: the issued serial already belongs to another device.",
            );

            return yield* Effect.fail(internal());
          }

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

        // This enrollment is durable, so the previous tenant's copy can go.
        // Cleanup is best effort: failing it must not reject a device the new
        // tenant has already enrolled. Without Autopilot/pre-registration proof
        // the old row is left to the stale sweep; a self-asserted DeviceID is
        // not enough to delete another tenant's device.
        if (departedDevices.length > 0 && !arrivalProof)
          yield* Effect.logWarning(
            `Leaving previous-tenant Windows device(s) ${departedDevices
              .map((device) => device.id)
              .join(
                ", ",
              )} in place: tenant ${organizationId} has no Autopilot record or pre-registration for ${deviceIdentifier}`,
          );
        else
          yield* Effect.forEach(
            departedDevices,
            (departed) =>
              deleteDepartedTenantDevice({
                db,
                device: departed,
                reason: "Windows enrollment used the same DeviceID in another tenant",
                authSecret,
              }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    `Failed to clean up Windows device ${departed.id} from tenant ${departed.organizationId}: ${String(error)}`,
                  ),
                ),
              ),
            { concurrency: 1, discard: true },
          );

        return {
          deviceId: deviceIdentifier,
          signedCertificate: signed.certificatePem,
          identityCertificate: ca.certPem,
          // The provisioning document uses these for the APPSRV DIGEST
          // challenge. Device authentication uses the issued certificate, so
          // the secret only needs to be unguessable.
          username: deviceIdentifier,
          secret: crypto.randomUUID(),
          providerId,
        };
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            if (reported) return;

            boundaryRecorded = yield* reportCause({
              tenantToken: request.tenantToken,
              organizationId: attributableOrganizationId,
              deviceId: attributableDevice?.id,
              deviceIdentifier,
              serial: attributableDevice?.serial,
              hostname: attributableDevice?.name ?? hostname,
              phase: "enrollment",
              message:
                "Windows enrollment failed before the device could be registered. Check the tenant's Windows enrollment settings and identity CA.",
              cause,
            });
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof UnknownDevice
            ? new UnknownDevice({ recorded: boundaryRecorded })
            : new InternalServerError({ recorded: boundaryRecorded }),
        ),
      );
    },

    windowsManagementCheckin: (
      scope: WindowsManagementScope,
      checkinRequest: WindowsManagementRequest,
    ): Effect.Effect<WindowsManagementResponse, UnknownDevice | InternalServerError> => {
      let attributableOrganizationId: string | null = null;
      let reported = false;

      let boundaryRecorded = false;

      const report = (code: string, message: string, detail?: string) =>
        Effect.gen(function* () {
          reported = true;
          attributableOrganizationId = yield* organizationForFailure(
            scope.tenantToken,
            attributableOrganizationId,
          );

          boundaryRecorded =
            (yield* reportFailure({
              organizationId: attributableOrganizationId,
              deviceIdentifier: scope.deviceId,
              phase: "command",
              code,
              message,
              detail,
            })) || boundaryRecorded;
        });

      return Effect.gen(function* () {
        const organizationId = yield* resolveOrganization({
          tenantToken: scope.tenantToken,
          identityCertificate: scope.identityCertificate,
          requireCertificate: requireDeviceIdentity,
          // The management URL's enrollment token may have expired; the
          // client certificate remains the durable device identity.
          rejectInvalidToken: false,
        });

        attributableOrganizationId = organizationId;

        if (requireDeviceIdentity) {
          const subjectCn = certificateAttribute(scope.identityCertificate, "CN");

          if (subjectCn && subjectCn !== scope.deviceId) {
            yield* report(
              "certificate_identity_mismatch",
              "Windows check-in was rejected: the client certificate does not match the device id in the SyncML header.",
            );

            return yield* Effect.fail(new UnknownDevice());
          }
        }

        const device = yield* findDevice(organizationId, scope.deviceId);

        if (!device) {
          yield* report(
            "unknown_device",
            "Windows check-in was rejected: this device is not enrolled in the tenant, or it was retired.",
          );

          return yield* Effect.fail(new UnknownDevice());
        }

        if (
          requireDeviceIdentity &&
          (yield* identityCertificateRevoked(
            organizationId,
            device,
            scope.identityCertificateSerial,
          ))
        ) {
          reported = true;
          boundaryRecorded =
            (yield* reportFailure({
              organizationId,
              deviceId: device.id,
              deviceIdentifier: scope.deviceId,
              serial: device.serial,
              hostname: device.name,
              phase: "command",
              code: "certificate_revoked",
              message:
                "Windows check-in was rejected: this device's identity certificate has been revoked. Enroll the device again.",
            })) || boundaryRecorded;

          return yield* Effect.fail(new UnknownDevice());
        }

        const timestamp = new Date();

        // Command rows for policy, inventory and imperative actions. Policy and
        // inventory rows are generated from device state, so they are loaded
        // here and reconciled below; action rows are queued by an operator.
        const stateRows = yield* db
          .select()
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.requestType, [...WINDOWS_STATE_COMMAND_REQUEST_TYPES]),
            ),
          );

        const activeCommandRows = yield* db
          .select()
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .orderBy(asc(s.deviceCommand.createdAt))
          .limit(DEVICE_COMMAND_ACTIVE_LIMIT);

        type CommandRow = (typeof stateRows)[number];

        const rowsById = new Map<string, CommandRow>();
        const replaceRowsByUri = new Map<string, CommandRow>();
        const deleteRowsByUri = new Map<string, CommandRow>();
        const inventoryRowsByCommandId = new Map<string, CommandRow>();

        for (const row of [...stateRows, ...activeCommandRows]) {
          const payload = commandPayload(row.payload);
          const uri = payloadString(payload, "locURI");
          const cmdID = payloadString(payload, "cmdID");

          rowsById.set(row.id, row);

          if (row.requestType === WINDOWS_POLICY_REPLACE_REQUEST_TYPE && uri)
            replaceRowsByUri.set(uri, row);
          else if (row.requestType === WINDOWS_POLICY_DELETE_REQUEST_TYPE && uri)
            deleteRowsByUri.set(uri, row);
          else if (
            (row.requestType === WINDOWS_INVENTORY_GET_REQUEST_TYPE ||
              row.requestType === WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE) &&
            cmdID
          )
            inventoryRowsByCommandId.set(cmdID, row);
        }

        const applied = new Set(stringArray(device.windowsPolicyApplied));

        const delivered = new Map(
          payloadArray(device.windowsPolicyDelivered).map((node) => [node.uri, node.hash]),
        );

        const failures = new Map(
          policyFailures(device.windowsPolicyFailures).map((failure) => [failure.uri, failure]),
        );

        const reverting = new Set(stringArray(device.windowsPolicyReverting));

        /** Distinct policy rejections from this check-in, for the history table. */
        const policyHistory: Array<{ uri: string; resultStatus: string; detail: string }> = [];

        let policyStateChanged = false;
        let revertedAt = device.windowsPolicyRevertedAt;
        let unenrolled = false;

        // Application inventory `Get`s that the device answered: a successful
        // status or a `<Results>` block. Used to classify a partial app report.
        const reportedInventoryCommandIds = new Set<string>();

        const recordPolicySuccess = (row: CommandRow, uri: string) => {
          applied.add(uri);
          failures.delete(uri);
          policyStateChanged = true;

          if (row.requestType === WINDOWS_POLICY_DELETE_REQUEST_TYPE) {
            applied.delete(uri);
            delivered.delete(uri);
            reverting.delete(uri);
            revertedAt = timestamp;
          }
        };

        const recordPolicyFailure = (row: CommandRow, uri: string, resultStatus: string) => {
          const detail = windowsPolicyRejectionDetail(uri, resultStatus);
          const previous = failures.get(uri);

          // Append to the failure history once per distinct rejection. A device
          // re-reports the same status on every poll while a setting is stuck;
          // repeating that in the history would bury everything else.
          if (!previous || previous.detail !== detail || previous.resultStatus !== resultStatus)
            policyHistory.push({ uri, resultStatus, detail });

          failures.set(uri, {
            uri,
            hash: payloadString(commandPayload(row.payload), "hash") ?? "",
            resultStatus,
            detail,
            at: timestamp.toISOString(),
          });
          policyStateChanged = true;

          return detail;
        };

        for (const status of checkinRequest.statuses) {
          if (!Schema.is(StatusEntry)(status)) continue;
          const commandId = Schema.is(Schema.String)(status.cmdRef) ? status.cmdRef : undefined;

          if (!commandId) continue;

          const data = windowsSyncMLData(status.data) ?? "";
          const outcome = windowsCommandOutcome(data);
          const row = rowsById.get(commandId) ?? inventoryRowsByCommandId.get(commandId);

          if (!row) {
            // An imperative command is addressed by its row id, which is also
            // the SyncML CmdID.
            yield* db
              .update(s.deviceCommand)
              .set({
                status: outcome.status,
                resultStatus: outcome.resultStatus,
                dedupeKey: outcome.status === "queued" ? undefined : null,
                updatedAt: timestamp,
              })
              .where(
                and(eq(s.deviceCommand.id, commandId), eq(s.deviceCommand.deviceId, device.id)),
              );
            continue;
          }

          if (row.requestType === WINDOWS_UNENROLL_REQUEST_TYPE && outcome.status === "succeeded")
            unenrolled = true;

          const isPolicy =
            row.requestType === WINDOWS_POLICY_REPLACE_REQUEST_TYPE ||
            row.requestType === WINDOWS_POLICY_DELETE_REQUEST_TYPE;

          const isInventory =
            row.requestType === WINDOWS_INVENTORY_GET_REQUEST_TYPE ||
            row.requestType === WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE;

          const uri = payloadString(commandPayload(row.payload), "locURI");

          const detail =
            isPolicy && uri && outcome.status === "failed"
              ? recordPolicyFailure(row, uri, outcome.resultStatus)
              : outcome.status === "succeeded"
                ? null
                : undefined;

          if (isPolicy && uri && outcome.status === "succeeded") recordPolicySuccess(row, uri);

          const commandPatch: Partial<typeof s.deviceCommand.$inferInsert> = {
            status: outcome.status,
            resultStatus: outcome.resultStatus,
            updatedAt: timestamp,
          };

          if (detail !== undefined) commandPatch.resultDetail = detail;

          if (outcome.status !== "queued") commandPatch.dedupeKey = null;

          yield* db
            .update(s.deviceCommand)
            .set(commandPatch)
            .where(and(eq(s.deviceCommand.id, row.id), eq(s.deviceCommand.deviceId, device.id)));

          // A `Get` status is a response too; keep the row terminal like any
          // other command rather than leaving it `sent`.
          if (isInventory && outcome.status === "succeeded") {
            reportedInventoryCommandIds.add(commandId);
            yield* db
              .update(s.deviceCommand)
              .set({ resultStatus: outcome.resultStatus, dedupeKey: null, updatedAt: timestamp })
              .where(and(eq(s.deviceCommand.id, row.id), eq(s.deviceCommand.deviceId, device.id)));
          }
        }

        // A Generic Alert 1226 is how a Windows client reports that the user
        // removed management locally. Any other alert that names a policy node
        // is recorded against that node so the failure is visible.
        for (const alert of checkinRequest.alerts) {
          if (!Schema.is(AlertEntry)(alert)) continue;
          const data = windowsSyncMLData(alert.data)?.trim();

          if (!data) continue;

          if (data === WINDOWS_UNENROLL_ALERT) {
            unenrolled = true;
            continue;
          }

          const uri = (alert.items ?? []).map(windowsSyncMLLocURI).find(Boolean);
          const row = uri ? replaceRowsByUri.get(uri) : undefined;

          if (!uri || !row) continue;

          const detail = recordPolicyFailure(row, uri, data);

          yield* db
            .update(s.deviceCommand)
            .set({
              status: "failed",
              resultStatus: data,
              resultDetail: detail,
              dedupeKey: null,
              updatedAt: timestamp,
            })
            .where(and(eq(s.deviceCommand.id, row.id), eq(s.deviceCommand.deviceId, device.id)));
        }

        if (unenrolled) {
          yield* completeWindowsUnenrollment(organizationId, device, timestamp);

          return { commands: [] };
        }

        // Inventory results arrive in the same SyncML message that answers the
        // previous session's `Get` commands. Parse them before deciding whether
        // this session should ask for another snapshot.
        const inventoryValues = windowsInventoryValues(checkinRequest.results, inventoryRequests);
        const inventory = parseWindowsInventory(inventoryValues);

        const inventoryUpdate = windowsInventoryUpdate(inventory, device);

        // `device` has a per-tenant unique serial. A duplicated or cloned
        // SMBIOS serial must not make the check-in fail (which would also stop
        // policy delivery), so keep the previous value for this device.
        if (inventoryUpdate.serial) {
          const [owner] = yield* db
            .select({ id: s.device.id })
            .from(s.device)
            .where(
              and(
                eq(s.device.organizationId, organizationId),
                eq(s.device.serial, inventoryUpdate.serial),
              ),
            )
            .limit(1);

          if (owner && owner.id !== device.id) delete inventoryUpdate.serial;
        }

        const hasInventoryUpdate = hasWindowsInventory(inventoryUpdate);

        const inventoryDue = windowsInventoryDue({
          lastUpdatedAt: hasInventoryUpdate ? timestamp : device.inventoryUpdatedAt,
          lastRequestedAt: device.inventoryRequestedAt,
          now: timestamp,
        });

        // A `<Results>` block proves the `Get` that produced it completed. The
        // row is part of the command history like any other result.
        const resultCommandIds = new Set<string>();

        for (const entry of checkinRequest.results ?? []) {
          const parsed = Schema.decodeUnknownOption(
            Schema.Struct({ cmdRef: Schema.optional(Schema.Json) }),
          )(entry);

          if (Option.isNone(parsed)) continue;
          const cmdRef = windowsSyncMLData(parsed.value.cmdRef);

          if (cmdRef) {
            resultCommandIds.add(cmdRef);
            reportedInventoryCommandIds.add(cmdRef);
          }
        }

        for (const cmdRef of resultCommandIds) {
          const row = inventoryRowsByCommandId.get(cmdRef);

          if (!row) continue;

          yield* db
            .update(s.deviceCommand)
            .set({
              status: "succeeded",
              resultStatus: "200",
              dedupeKey: null,
              updatedAt: timestamp,
            })
            .where(and(eq(s.deviceCommand.id, row.id), eq(s.deviceCommand.deviceId, device.id)));
        }

        const applicationReport = parseWindowsApplicationsReport(inventoryValues, {
          reportedCommandIds: reportedInventoryCommandIds,
        });

        const applications = applicationReport?.applications;

        // The application inventory is much larger than the DevDetail nodes, so
        // it only replaces rows (and moves its own request clock) when the
        // device actually answered an application `Get`. A partial report (one
        // CSP answered) only replaces the rows that source owns; the other
        // source's apps must survive.
        if (applicationReport !== undefined) {
          let reportedApplications = applicationReport.applications;

          if (!(applicationReport.sources.win32 && applicationReport.sources.msi)) {
            const existing = yield* db
              .select()
              .from(s.deviceApplication)
              .where(
                and(
                  eq(s.deviceApplication.deviceId, device.id),
                  eq(s.deviceApplication.organizationId, organizationId),
                ),
              );

            reportedApplications = mergeWindowsApplicationReport(existing, applicationReport);
          }

          yield* replaceDeviceApplications(db, {
            deviceId: device.id,
            organizationId,
            applications: reportedApplications,
            reportedAt: timestamp,
          });
        }

        const applicationsDue = windowsApplicationInventoryDue({
          lastUpdatedAt: applications !== undefined ? timestamp : device.applicationsUpdatedAt,
          lastRequestedAt: device.applicationsRequestedAt,
          now: timestamp,
        });

        const inventoryColumns: Partial<typeof s.device.$inferInsert> = {
          ...inventoryUpdate,
        };

        if (hasInventoryUpdate) inventoryColumns.inventoryUpdatedAt = timestamp;

        if (hasWindowsSecurityInventory(inventory)) inventoryColumns.securityUpdatedAt = timestamp;

        if (inventoryDue) inventoryColumns.inventoryRequestedAt = timestamp;

        if (applicationsDue) inventoryColumns.applicationsRequestedAt = timestamp;

        if (Object.keys(inventoryColumns).length > 0)
          yield* db.update(s.device).set(inventoryColumns).where(eq(s.device.id, device.id));

        // Refresh liveness (and dynamic groups, which read model/OS/storage)
        // after the inventory write so group rules see the new values.
        yield* touchDevice(device.id, organizationId, timestamp);

        // Windows has no per-login MDM channel, so a user-scoped `./User/`
        // setting is delivered by this device check-in and applies to every
        // user on the machine.
        const effective = yield* resolveEffectivePolicyForDevice(
          db,
          {
            id: device.id,
            organizationId: device.organizationId,
          },
          { includeUserScoped: true },
        );

        const configurations = effective.configurations.map((configuration) => ({
          policyId: configuration.policyId,
          kind: configuration.kind,
          data: configuration.data,
        }));

        const commands: Array<WindowsCommand> = [];

        type DesiredPolicyNode = {
          readonly uri: string;
          readonly data: string;
          readonly format?: string;
          readonly hash: string;
        };

        // Resolve duplicate OMA-URIs deterministically. A policy with a
        // lexicographically smaller id wins, so check-ins are stable across
        // group ordering and devices.
        const desired = new Map<string, DesiredPolicyNode>();

        const sorted = [...configurations].sort((left, right) =>
          String(left.policyId).localeCompare(String(right.policyId)),
        );

        if (device.status === "enrolled") {
          for (const configuration of sorted) {
            for (const node of windowsPolicyNodes({
              policyId: configuration.policyId,
              kind: configuration.kind,
              data: configuration.data,
              hash: "",
            })) {
              if (desired.has(node.omaUri)) continue;

              const value = node.value;

              const serializedValue = Schema.is(Schema.String)(value)
                ? value
                : Schema.is(Schema.JsonObject)(value) ||
                    Schema.is(JsonArray)(value) ||
                    value === null
                  ? JSON.stringify(value)
                  : String(value);

              const hash = yield* Effect.promise(() =>
                windowsPolicyNodeHash(serializedValue, node.format),
              );

              const desiredNode = node.format
                ? { uri: node.omaUri, data: serializedValue, hash, format: node.format }
                : { uri: node.omaUri, data: serializedValue, hash };

              desired.set(node.omaUri, desiredNode);
            }
          }
        }

        const writeStateCommand = (input: {
          readonly id: string;
          readonly requestType: string;
          readonly payload: WindowsStateCommandPayload;
          readonly existing?: CommandRow;
        }): Effect.Effect<unknown, unknown> => {
          if (input.existing)
            return db
              .update(s.deviceCommand)
              .set({
                requestType: input.requestType,
                payload: input.payload,
                status: "sent",
                dedupeKey: null,
                expiresAt: null,
                resultStatus: null,
                resultDetail: null,
                updatedAt: timestamp,
              })
              .where(
                and(eq(s.deviceCommand.id, input.id), eq(s.deviceCommand.deviceId, device.id)),
              );

          return db.insert(s.deviceCommand).values({
            id: input.id,
            organizationId,
            deviceId: device.id,
            requestType: input.requestType,
            payload: input.payload,
            status: "sent",
            dedupeKey: null,
            expiresAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        };

        // Diff the resolved policy against what was actually delivered. Nodes
        // that left every policy are reverted with a `Delete`; a disabled
        // policy or a removed Wi-Fi/restriction profile therefore does not
        // leave the last CSP value on the device indefinitely.
        const policyPlan = planWindowsPolicyDelivery({
          desired: new Map([...desired].map(([uri, node]) => [uri, { uri, hash: node.hash }])),
          delivered: [...delivered].map(([uri, hash]) => ({ uri, hash })),
          applied: [...applied],
          failures: [...failures.values()],
          now: timestamp,
        });

        // A URI that is desired again after a pending revert must not leave a
        // stale `Delete` row (or pending-revert state) behind.
        for (const uri of desired.keys()) {
          if (reverting.delete(uri)) policyStateChanged = true;
          const deleteRow = deleteRowsByUri.get(uri);

          if (deleteRow && commandStatusIsActive(deleteRow.status)) {
            yield* db
              .update(s.deviceCommand)
              .set({
                status: "cancelled",
                dedupeKey: null,
                resultStatus: RECONCILED_RESULT_STATUS,
                resultDetail: "The setting was assigned again before the delete completed.",
                updatedAt: timestamp,
              })
              .where(
                and(eq(s.deviceCommand.id, deleteRow.id), eq(s.deviceCommand.deviceId, device.id)),
              );
          }
        }

        for (const entry of policyPlan.replace) {
          const node = desired.get(entry.uri);

          if (!node) continue;
          const row = replaceRowsByUri.get(entry.uri);

          const commandId =
            row?.id ??
            (yield* Effect.promise(() => windowsPolicyCommandId(device.id, "replace", entry.uri)));

          const payload: WindowsStateCommandPayload = {
            kind: "Replace",
            locURI: entry.uri,
            data: node.data,
            hash: entry.hash,
          };

          if (node.format) payload.format = node.format;

          yield* writeStateCommand({
            id: commandId,
            requestType: WINDOWS_POLICY_REPLACE_REQUEST_TYPE,
            payload,
            existing: row,
          });

          const command: WindowsCommand = {
            kind: "Replace",
            cmdID: commandId,
            locURI: entry.uri,
            data: node.data,
          };

          if (node.format) command.format = node.format;

          commands.push(command);
          delivered.set(entry.uri, entry.hash);
          policyStateChanged = true;
        }

        for (const uri of policyPlan.remove) {
          const row = deleteRowsByUri.get(uri);

          const replaceRow = replaceRowsByUri.get(uri);

          if (replaceRow && commandStatusIsActive(replaceRow.status))
            yield* db
              .update(s.deviceCommand)
              .set({
                status: "cancelled",
                dedupeKey: null,
                resultStatus: RECONCILED_RESULT_STATUS,
                resultDetail: "The setting left every policy; a delete replaces delivery.",
                updatedAt: timestamp,
              })
              .where(
                and(eq(s.deviceCommand.id, replaceRow.id), eq(s.deviceCommand.deviceId, device.id)),
              );

          const commandId =
            row?.id ??
            (yield* Effect.promise(() => windowsPolicyCommandId(device.id, "delete", uri)));

          yield* writeStateCommand({
            id: commandId,
            requestType: WINDOWS_POLICY_DELETE_REQUEST_TYPE,
            payload: { kind: "Delete", locURI: uri },
            existing: row,
          });

          commands.push({ kind: "Delete", cmdID: commandId, locURI: uri });
          reverting.add(uri);
          policyStateChanged = true;
        }

        const policyColumns: Partial<typeof s.device.$inferInsert> = {};

        if (policyStateChanged) {
          policyColumns.windowsPolicyApplied = [...applied];
          policyColumns.windowsPolicyDelivered = [...delivered].map(([uri, hash]) => ({
            uri,
            hash,
          }));
          policyColumns.windowsPolicyReverting = [...reverting];
          policyColumns.windowsPolicyFailures = [...failures.values()];
          policyColumns.windowsPolicyUpdatedAt = timestamp;
          policyColumns.windowsPolicyRevertedAt = revertedAt;
        }

        if (Object.keys(policyColumns).length > 0)
          yield* db.update(s.device).set(policyColumns).where(eq(s.device.id, device.id));

        // Inventory `Get`s use stable command ids so a later `<Results>` entry
        // can be matched back to its OMA-URI even when the device omits
        // `Item/Source`. They are only emitted when the cadence guard says the
        // snapshot is stale or was never collected. A device that is leaving
        // management is not asked for more inventory.
        if (inventoryDue && device.status === "enrolled")
          for (const inventoryRequest of inventoryRequests) {
            const row = inventoryRowsByCommandId.get(inventoryRequest.cmdID);

            const commandId =
              row?.id ??
              (yield* Effect.promise(() =>
                windowsInventoryCommandRowId(device.id, inventoryRequest.cmdID),
              ));

            yield* writeStateCommand({
              id: commandId,
              requestType: WINDOWS_INVENTORY_GET_REQUEST_TYPE,
              payload: {
                kind: "Get",
                cmdID: inventoryRequest.cmdID,
                locURI: inventoryRequest.locURI,
              },
              existing: row,
            });

            commands.push({
              kind: "Get",
              cmdID: inventoryRequest.cmdID,
              locURI: inventoryRequest.locURI,
            });
          }

        // The application inventory is requested on its own daily cadence; a
        // `Get` on `?list=StructData` returns every app in one `Results` block.
        if (applicationsDue && device.status === "enrolled")
          for (const inventoryRequest of WINDOWS_APPLICATION_INVENTORY_REQUESTS) {
            const row = inventoryRowsByCommandId.get(inventoryRequest.cmdID);

            const commandId =
              row?.id ??
              (yield* Effect.promise(() =>
                windowsInventoryCommandRowId(device.id, inventoryRequest.cmdID),
              ));

            yield* writeStateCommand({
              id: commandId,
              requestType: WINDOWS_APPLICATION_INVENTORY_GET_REQUEST_TYPE,
              payload: {
                kind: "Get",
                cmdID: inventoryRequest.cmdID,
                locURI: inventoryRequest.locURI,
              },
              existing: row,
            });

            commands.push({
              kind: "Get",
              cmdID: inventoryRequest.cmdID,
              locURI: inventoryRequest.locURI,
            });
          }

        // Commands handed out but never acknowledged must not stay "sent"
        // forever, and work whose delivery budget elapsed must never fire
        // days later. Plan from the active rows so expiry, retry and delivery
        // use the same rules as Apple instead of a bespoke 30 minute sweep.
        // Policy and inventory rows are delivered above, from device state.
        const activeCommands = yield* db
          .select()
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .orderBy(asc(s.deviceCommand.createdAt))
          .limit(DEVICE_COMMAND_ACTIVE_LIMIT);

        const plan = planCommandDeliveryBatch(
          activeCommands.filter((row) => !WINDOWS_STATE_COMMAND_REQUEST_TYPES.has(row.requestType)),
          timestamp,
        );

        if (plan.expire.length > 0)
          yield* db
            .update(s.deviceCommand)
            .set({
              status: "expired",
              dedupeKey: null,
              resultStatus: RECONCILED_RESULT_STATUS,
              resultDetail: COMMAND_EXPIRED_DETAIL,
              updatedAt: timestamp,
            })
            .where(inArray(s.deviceCommand.id, plan.expire));

        if (plan.requeue.length > 0)
          yield* db
            .update(s.deviceCommand)
            .set({ status: "queued", updatedAt: timestamp })
            .where(inArray(s.deviceCommand.id, plan.requeue));

        for (const command of plan.deliver) {
          const payload = commandPayload(command.payload);
          const kind = payloadString(payload, "kind") ?? "Exec";
          const locURI = payloadString(payload, "locURI");
          const data = payloadString(payload, "data");
          const format = payloadString(payload, "format");

          const syncCommand: WindowsCommand = {
            kind: ["Get", "Replace", "Delete", "Exec"].includes(kind) ? kind : "Exec",
            cmdID: command.id,
            locURI: locURI ?? "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected",
            data: data ?? "",
          };

          syncCommand.format = format ?? "chr";
          commands.push(syncCommand);
          yield* db
            .update(s.deviceCommand)
            .set({ status: "sent", updatedAt: timestamp })
            .where(eq(s.deviceCommand.id, command.id));
        }

        // Policy rejections are already stored per OMA-URI on the device; this
        // is the append-only history an operator can scroll. Best effort, like
        // every other failure record.
        yield* Effect.forEach(
          policyHistory,
          (failure) =>
            reportFailure({
              organizationId,
              deviceId: device.id,
              deviceIdentifier: scope.deviceId,
              serial: device.serial,
              hostname: device.name,
              phase: "policy",
              code: `policy_${failure.resultStatus}`,
              message: failure.detail,
              detail: failure.uri,
            }),
          { concurrency: 2, discard: true },
        );

        return { commands };
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            if (reported) return;

            boundaryRecorded = yield* reportCause({
              tenantToken: scope.tenantToken,
              organizationId: attributableOrganizationId,
              deviceIdentifier: scope.deviceId,
              phase: "command",
              message:
                "Windows management check-in failed, so the device did not receive its policy or commands.",
              cause,
            });
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof UnknownDevice
            ? new UnknownDevice({ recorded: boundaryRecorded })
            : new InternalServerError({ recorded: boundaryRecorded }),
        ),
      );
    },

    windowsDeviceEvent: (
      scope: WindowsManagementScope,
      event: WindowsDeviceEvent,
    ): Effect.Effect<void, UnknownDevice | InternalServerError> => {
      let attributableOrganizationId: string | null = null;

      let boundaryRecorded = false;

      let attributableDevice: {
        readonly id: string;
        readonly serial: string | null;
        readonly name: string;
      } | null = null;

      const deviceIdentifier = event.deviceId || scope.deviceId;

      return Effect.gen(function* () {
        const deviceId = event.deviceId || scope.deviceId;
        // An `Enrolled` event is the tail of the enrollment flow, which may not
        // have a client certificate yet; it is allowed to authenticate with the
        // tenant token (or the legacy pin). Management events must prove device
        // identity when configured.
        const isEnrollmentEvent = Predicate.isTagged("Enrolled")(event);

        const organizationId = yield* resolveOrganization({
          tenantToken: scope.tenantToken,
          identityCertificate: scope.identityCertificate,
          requireCertificate: requireDeviceIdentity && !isEnrollmentEvent,
          // A management event authenticated by certificate must not be
          // wedged by an expired enrollment URL token.
          rejectInvalidToken: isEnrollmentEvent,
        });

        attributableOrganizationId = organizationId;

        if (requireDeviceIdentity && !isEnrollmentEvent) {
          const subjectCn = certificateAttribute(scope.identityCertificate, "CN");

          if (subjectCn && subjectCn !== deviceId) return yield* Effect.fail(new UnknownDevice());
        }

        const device = yield* findDevice(organizationId, deviceId);
        attributableDevice = device ?? null;
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

        if (Predicate.isTagged("Enrolled")(event)) {
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

        // A `CommandResult` carries a status for one command. Persist it
        // against the row it names so Windows command history and policy
        // delivery state are as complete as Apple's.
        if (Predicate.isTagged("CommandResult")(event)) {
          const commandId = event.commandRef?.trim();

          if (commandId) {
            const [exact] = yield* db
              .select()
              .from(s.deviceCommand)
              .where(
                and(eq(s.deviceCommand.id, commandId), eq(s.deviceCommand.deviceId, device.id)),
              )
              .limit(1);

            const inventoryId =
              exact === undefined && commandId.startsWith("windows-")
                ? yield* Effect.promise(() => windowsInventoryCommandRowId(device.id, commandId))
                : undefined;

            const [row] =
              inventoryId === undefined
                ? [exact]
                : yield* db
                    .select()
                    .from(s.deviceCommand)
                    .where(
                      and(
                        eq(s.deviceCommand.id, inventoryId),
                        eq(s.deviceCommand.deviceId, device.id),
                      ),
                    )
                    .limit(1);

            const outcome = windowsCommandOutcome(event.status);
            const uri = row ? payloadString(commandPayload(row.payload), "locURI") : undefined;

            const detail =
              outcome.status === "failed" && uri
                ? windowsPolicyRejectionDetail(uri, outcome.resultStatus)
                : outcome.status === "succeeded"
                  ? null
                  : undefined;

            const resultPatch: Partial<typeof s.deviceCommand.$inferInsert> = {
              status: outcome.status,
              resultStatus: outcome.resultStatus,
              updatedAt: timestamp,
            };

            if (detail !== undefined) resultPatch.resultDetail = detail;

            if (outcome.status !== "queued") resultPatch.dedupeKey = null;

            yield* db
              .update(s.deviceCommand)
              .set(resultPatch)
              .where(
                and(
                  eq(s.deviceCommand.id, row?.id ?? commandId),
                  eq(s.deviceCommand.deviceId, device.id),
                ),
              );

            if (
              row?.requestType === WINDOWS_UNENROLL_REQUEST_TYPE &&
              outcome.status === "succeeded"
            ) {
              yield* completeWindowsUnenrollment(organizationId, device, timestamp);

              return;
            }
          }
        }

        yield* touchDevice(device.id, organizationId, timestamp);
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            boundaryRecorded = yield* reportCause({
              tenantToken: scope.tenantToken,
              organizationId: attributableOrganizationId,
              deviceId: attributableDevice?.id,
              deviceIdentifier,
              serial: attributableDevice?.serial,
              hostname: attributableDevice?.name,
              phase: "command",
              message:
                "Windows device event failed, so a command result or enrollment acknowledgement was not recorded.",
              cause,
            });
          }),
        ),
        Effect.mapError((cause) =>
          cause instanceof UnknownDevice
            ? new UnknownDevice({ recorded: boundaryRecorded })
            : new InternalServerError({ recorded: boundaryRecorded }),
        ),
      );
    },

    /**
     * Persist a fault the SOAP/SyncML layer detected before reaching a backend
     * method (a malformed envelope, a missing security token, an unparseable
     * SyncML body). Tenant attribution is best effort: an unattributable
     * request is dropped rather than guessed.
     */
    windowsRecordFailure: (report: WindowsFailureReport): Effect.Effect<void> =>
      Effect.gen(function* () {
        const organizationId = yield* resolveOrganization({
          tenantToken: report.tenantToken,
          identityCertificate: report.identityCertificate,
          // The management URL's enrollment token expires long before the
          // device certificate; the same fallback applies here so a fault from
          // an established device is still attributed to its tenant.
          rejectInvalidToken: false,
        }).pipe(Effect.catch(() => Effect.succeed(null)));

        if (!organizationId) return;

        const deviceIdentifier =
          report.deviceId?.trim() || certificateAttribute(report.identityCertificate, "CN") || null;

        const device = deviceIdentifier
          ? yield* findDevice(organizationId, deviceIdentifier)
          : null;

        yield* reportFailure({
          organizationId,
          deviceId: device?.id,
          deviceIdentifier,
          serial: device?.serial,
          hostname: device?.name,
          phase: report.phase,
          code: report.code,
          message: report.message,
          detail: report.detail,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`Could not record Windows protocol failure: ${String(cause)}`),
        ),
      ),
  };
};

/**
 * @deprecated Use {@link createWindowsBackend}. Kept as an alias for existing
 * external callers.
 */
export const makeWindowsBackend = createWindowsBackend;
