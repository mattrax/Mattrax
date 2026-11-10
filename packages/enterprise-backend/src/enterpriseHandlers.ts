import { Effect, Exit } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerResponse } from "effect/http";
import {
  applicationKey,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseForbidden,
  EnterpriseLastTenantUser,
  EnterpriseNotFound,
  EnterpriseStripeError,
  EnterpriseTenantHasMembers,
  EnterpriseService,
  enterpriseApi,
  TENANT_EXPORT_MAX_ROWS,
  TENANT_EXPORT_VERSION,
  TENANT_IMPORT_MAX_BYTES,
  type DevicePreRegistrationImportRow,
  type DevicePreRegistrationImportResponse,
  type EnterpriseAuth,
  type TenantExportApplication,
  type TenantExportAuditEntry,
  type TenantExportCertificate,
  type TenantExportEnvelope,
  type TenantExportEnrollment,
  type TenantExportGroup,
  type TenantExportMember,
  type TenantExportPolicy,
  type TenantExportPreRegistration,
  type TenantExportProfile,
  type TenantImportRequest,
  type TenantImportResponse,
  policyApplicationKey,
  normalizeBrandColor,
  resolveTenantBranding,
  validateTenantBranding,
  dynamicGroupRulesProblem,
  WEBHOOK_EVENT_TYPES,
  webhookUrlProblem,
  type DynamicGroupRules,
  type WebhookTestResponse,
} from "@mattrax/enterprise-domain";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import type { Stripe } from "@mattrax/effect-stripe";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, like, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import {
  certificateDeviceIdsFor,
  createWindowsTenantToken,
  dispatchWebhookEvent,
  enterpriseEnrollmentProfile,
  generateWebhookSecret,
  previewDynamicGroup,
  resolveEffectivePolicyForDevice,
  sendTestWebhook,
  syncDynamicGroup,
  syncDynamicGroupsForDevice,
  toWebhookEndpointInfo,
  webhookEventForAuditAction,
  webhookSecretPrefix,
  windowsTenantTokenExpiresAt,
  type WebhookEndpointRow,
} from "@mattrax/management-backend-enterprise";
import { createScepChallenge, validateConfiguration } from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";
import { parseMobileconfigPreview } from "./mobileconfig.ts";
import { tokenScopes } from "./enterpriseAuth.ts";
import {
  ApnsService,
  NoopPushTransport,
  buildApnsCsr,
  generateApnsKeyPair,
  importApnsKeyJwk,
  makeApnsService,
  parseApnsCertificate,
  validateApnsCertificate,
} from "@mattrax/apns";
import { exportPrivateKeyJwk, openSecret, sealSecret } from "@mattrax/crypto";
import { makeApplePush } from "./push.ts";
import { summarizeApplePushHealth } from "./push.ts";
import { buildDeviceActivity, normalizeDeviceActivityLimit } from "./deviceActivity.ts";
import { syncEntraDirectory, acquireEntraSyncLock } from "./entraSync.ts";
import {
  DEVICE_EXPORT_MAX_ROWS,
  normalizeDeviceSearchQuery,
  platformLabel,
  toCsv,
  type DeviceSearchFilters,
} from "./deviceSearch.ts";
import {
  AUDIT_EXPORT_MAX_ROWS,
  auditCsv,
  auditJson,
  auditOrder,
  auditWhere,
  encodeAuditCursor,
  encodeAuditOffsetCursor,
  normalizeAuditSearchQuery,
  type AuditExportEntry,
  type AuditSearchFilters,
} from "./auditLog.ts";
import { canEnrollDevice } from "./enrollmentLimit.ts";
import {
  detectEnrollmentPlatform,
  ENROLLMENT_ATTEMPT_DEDUPE_MS,
  ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT,
  evaluateEnrollmentAttempt,
  type EnrollmentAttemptOutcome,
  type EnrollmentAttemptPlatform,
} from "./enrollmentAttempts.ts";
import { countDeviceHealth, deriveDeviceHealth, normalizeDeviceHealth } from "./deviceHealth.ts";
import { loadCredentialHealth } from "./credentialHealth.ts";
import type { AzureGraphService } from "@mattrax/azure-graph";
import { listUserSessions, revokeUserSession } from "./sessions.ts";
import {
  R2Storage,
  R2StorageLive,
  base64ToBytes,
  bytesToBase64,
  sha256Hex,
} from "./policyApplicationStorage.ts";
import type { R2Bucket } from "./policyApplicationStorage.ts";
import type {
  EnterpriseConfiguration,
  EnterpriseDb,
  EnterpriseDevice,
  EnterpriseEnrollment,
  EnterpriseGroup,
  EnterpriseGroupDevice,
  EnterpriseGroupPolicy,
  EnterpriseApplication,
  EnterpriseOrganization,
  EnterprisePolicy,
  EnterpriseSchema,
} from "./schema.ts";

export type EnterpriseHandlersConfig = {
  readonly origin: string;
  /**
   * Stripe client used for billing. Deployments without Stripe credentials leave
   * this unset; billing handlers then return `EnterpriseStripeError` instead of
   * failing at boot.
   */
  readonly stripeClient?: RawStripeClientLike | ReturnType<typeof makeEffectStripeClient>;
  readonly storage: R2Bucket;
  /** Application secret used to seal/unseal APNs private keys. */
  readonly authSecret?: string;
  /** Microsoft Graph client used by directory sync (optional). */
  readonly azureGraph?: AzureGraphService;
  /** Public Entra app client id, exposed only to build the admin consent URL. */
  readonly azureClientId?: string;
  /** Apple MDM vendor certificate/key used to sign APNs CSRs (optional). */
  readonly cloudAppleVendorCert?: string;
  readonly cloudAppleVendorKey?: string;
  /** Push transport. Defaults to a no-op transport when omitted (tests). */
  readonly apns?: ApnsService.Service;
  /** Injected fetch for outbound webhook deliveries (tests). */
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Per-attempt webhook delivery deadline. Defaults to 5s. */
  readonly webhookTimeoutMs?: number;
  /** Transactional email binding. Invitations are logged when omitted. */
  readonly email?: {
    send(message: {
      to: string;
      from: { name: string; email: string };
      subject: string;
      text?: string;
      html?: string;
    }): Promise<unknown>;
  };
};

type EnterpriseServiceConfig = EnterpriseHandlersConfig & {
  readonly db: EnterpriseDb;
  readonly schema: EnterpriseSchema;
  readonly auth?: EnterpriseAuth["Service"];
};

type StripeClientLike = Parameters<typeof makeEffectStripeClient>[0];
type RawStripeClientLike = object;
type Dynamic = ReturnType<typeof JSON.parse>;

const isEffectStripeClient = (
  client: RawStripeClientLike | ReturnType<typeof makeEffectStripeClient>,
): client is ReturnType<typeof makeEffectStripeClient> =>
  typeof (client as { readonly effect?: unknown }).effect === "function";

const now = () => new Date();

/** Tenant-controlled text is interpolated into invitation HTML. */
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const optionalText = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

type BrandingPayload = {
  readonly displayName?: string | null;
  readonly logo?: string | null;
  readonly supportEmail?: string | null;
  readonly brandColor?: string | null;
};

/**
 * Validate and normalise the write payload for tenant branding. Returns the
 * fields to persist, omitting anything the caller did not send.
 */
const brandingUpdate = (body: BrandingPayload): Record<string, string | null> => {
  const errors = validateTenantBranding(body);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new EnterpriseBadRequest({ message: firstError });

  const update: Record<string, string | null> = {};
  const displayName = optionalText(body.displayName);
  if (displayName !== undefined) update.displayName = displayName;
  const logo = optionalText(body.logo);
  if (logo !== undefined) update.logo = logo;
  const supportEmail = optionalText(body.supportEmail);
  if (supportEmail !== undefined) update.supportEmail = supportEmail;
  const brandColor = optionalText(body.brandColor);
  if (brandColor !== undefined)
    update.brandColor = brandColor ? normalizeBrandColor(brandColor) : null;
  return update;
};

/** Throwing here keeps the validation helper usable from Effect.gen. */
const brandingOrFail = (body: BrandingPayload) =>
  Effect.try({
    try: () => brandingUpdate(body),
    catch: (cause) =>
      cause instanceof EnterpriseBadRequest
        ? cause
        : new EnterpriseBadRequest({ message: "Invalid tenant branding" }),
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const ok = { status: "ok" as const };

const APPLE_PROFILE_WINDOW_MS = 60_000;
const APPLE_PROFILE_PER_IP_LIMIT = 60;
const appleProfileWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort per-isolate limiter for the public mobileconfig endpoint. It is
 * deliberately cheap: the goal is to stop accidental QR-refresh loops and
 * trivial download floods, not to be a global quota (that belongs at the edge).
 */
const allowAppleProfileRequest = (ip: string | null | undefined) => {
  const key = ip?.trim() || "local";
  const timestamp = Date.now();
  const entry = appleProfileWindows.get(key);
  if (!entry || entry.resetAt <= timestamp) {
    appleProfileWindows.set(key, { count: 1, resetAt: timestamp + APPLE_PROFILE_WINDOW_MS });
    // Bound the map so rotating addresses cannot grow it without limit.
    if (appleProfileWindows.size > 10_000) {
      for (const [candidate, value] of appleProfileWindows)
        if (value.resetAt <= timestamp) appleProfileWindows.delete(candidate);
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= APPLE_PROFILE_PER_IP_LIMIT;
};

/** Filesystem-safe tenant name for the mobileconfig `Content-Disposition`. */
const safeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "tenant";

/** Slug candidates are derived from tenant input and bounded for MySQL indexes. */
const slugBase = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);

/**
 * `organization.metadata` is stored as JSON text. A malformed historical value
 * must not make the rest of a bundle unexportable.
 */
const exportMetadata = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** Compact bundle validation helper; mirrors the limits used by write handlers. */
const importString = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Build the download response for an Apple enrollment profile. Exported so the
 * content type, attachment filename and cache policy can be asserted without
 * standing up the whole HTTP API.
 */
export const appleEnrollmentProfileResponse = (result: {
  readonly plist: string;
  readonly filename: string;
}) =>
  HttpServerResponse.text(result.plist, {
    contentType: "application/x-apple-aspen-config",
    headers: {
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });

/** Render the stored capability JSON for CSV export without losing entries. */
const capabilityText = (value: unknown): string => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join("; ");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

/** Public audit row shape shared by list, search and export endpoints. */
const auditEntry = (entry: {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  metadata?: unknown;
  createdAt: Date;
}): AuditExportEntry => ({
  id: entry.id,
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId,
  actorUserId: entry.actorUserId ?? null,
  actorEmail: entry.actorEmail ?? null,
  metadata: entry.metadata ?? null,
  createdAt: iso(entry.createdAt),
});

const headersFromRequest = (request: HttpServerRequest) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
};

const webRequestFromRequest = (request: HttpServerRequest, origin: string) =>
  new Request(origin, { headers: headersFromRequest(request) });

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();
  return (date instanceof Date ? date : new Date(date)).toISOString();
};

const hashJson = (value: unknown) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

const TENANT_ROLES = new Set(["owner", "admin", "member", "auditor"]);
const rolesOf = (role: string) =>
  role
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const validRoles = (role: string) => {
  const roles = rolesOf(role);
  return roles.length > 0 && roles.every((item) => TENANT_ROLES.has(item));
};
const hasOwnerRole = (role: string) => rolesOf(role).includes("owner");

/**
 * Role matrix:
 * - owner: read, write, delete
 * - admin: read, write
 * - member: read (baseline tenant access)
 * - auditor: read only (compliance/read-only access; cannot write)
 *
 * There is no `operator` role: device-only writes would require every handler
 * to declare a resource class, and this layer only distinguishes read/write.
 */
const canWriteTenant = (role: string) =>
  role.split(",").some((item) => item === "owner" || item === "admin");
const canDeleteTenant = (role: string) => role.split(",").includes("owner");

export const createEnterpriseService = ({
  db,
  schema,
  origin,
  stripeClient,
  storage,
  auth: authService,
  authSecret,
  cloudAppleVendorCert,
  cloudAppleVendorKey,
  apns: apnsService,
  email,
  azureGraph,
  azureClientId,
  webhookFetch,
  webhookTimeoutMs,
}: EnterpriseServiceConfig) => {
  if (!authService) throw new Error("EnterpriseAuth service is required");
  const auth = authService;
  const apns = apnsService ?? makeApnsService(NoopPushTransport());
  const applePush = makeApplePush({
    db,
    schema,
    apns,
    authSecret,
    ...(webhookFetch ? { webhookFetch } : {}),
  });
  const webhookOptions = {
    ...(authSecret ? { authSecret } : {}),
    ...(webhookFetch ? { fetch: webhookFetch } : {}),
    ...(webhookTimeoutMs !== undefined ? { timeoutMs: webhookTimeoutMs } : {}),
  };
  const stripe = stripeClient
    ? isEffectStripeClient(stripeClient)
      ? stripeClient
      : makeEffectStripeClient(stripeClient as StripeClientLike)
    : undefined;
  const billingConfigured = Boolean(stripe);

  const billingNotConfigured = () =>
    new EnterpriseStripeError({
      message: "Billing is not configured for this deployment.",
    });

  const billingUnavailable = () =>
    new EnterpriseStripeError({
      message: "Billing is temporarily unavailable. Try again shortly.",
    });
  const r2Layer = R2StorageLive(storage);

  const requireTenant = (
    request: HttpServerRequest,
    tenantId: string,
    access: "read" | "write" | "delete" = "read",
  ) =>
    Effect.gen(function* () {
      const { user, apiToken } = yield* auth.requireUser({ headers: request.headers });

      if (apiToken) {
        // A tenant-bound token cannot be used against another tenant. Report it
        // as missing so token holders cannot probe tenant existence.
        if (apiToken.tenantId && apiToken.tenantId !== tenantId)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));
        const scopes = tokenScopes(apiToken.scopes);
        if (access === "read" && !scopes.has("read"))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "This token is not allowed to read this tenant" }),
          );
        if ((access === "write" || access === "delete") && !scopes.has("write"))
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "This token is read-only and cannot modify this tenant",
            }),
          );
      }

      const member = yield* db.query.member.findFirst({
        where: { userId: user.id, organizationId: tenantId },
      });
      if (!member)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));
      if (access === "write" && !canWriteTenant(member.role))
        return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));
      if (access === "delete" && !canDeleteTenant(member.role))
        return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));

      const organization = yield* db.query.organization.findFirst({
        where: { id: member.organizationId },
      });
      if (!organization)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

      return { user, organization, member };
    });

  const snapshotPolicy = (
    ctx: { readonly user: { readonly id: string }; readonly organization: { readonly id: string } },
    policyId: string,
  ) =>
    Effect.gen(function* () {
      const configurations = yield* db
        .select()
        .from(schema.configuration)
        .where(eq(schema.configuration.policyId, policyId));
      const snapshot = Object.fromEntries(
        configurations.map((configuration: any) => [configuration.kind, configuration.data]),
      );
      const [current] = yield* db
        .select({ version: schema.policyDeployment.version })
        .from(schema.policyDeployment)
        .where(eq(schema.policyDeployment.policyId, policyId))
        .orderBy(desc(schema.policyDeployment.version))
        .limit(1);
      yield* db.insert(schema.policyDeployment).values({
        id: id(),
        organizationId: ctx.organization.id,
        policyId,
        version: (current?.version ?? 0) + 1,
        snapshot,
        createdByUserId: ctx.user.id,
        createdAt: now(),
      });
    });

  const audit = (
    ctx: {
      readonly user: { readonly id: string; readonly email: string };
      readonly organization: { readonly id: string };
    },
    action: string,
    targetType: string,
    targetId: string | null = null,
    metadata?: unknown,
  ) =>
    Effect.gen(function* () {
      yield* db.insert(schema.auditLog).values({
        id: id(),
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        action,
        targetType,
        targetId,
        metadata: metadata === undefined ? null : (metadata as object),
        createdAt: now(),
      });
      // A small set of administrator actions are also customer-facing. Device
      // lifecycle events are mostly emitted from the protocol path; deletion
      // only exists here.
      const webhookEvent = webhookEventForAuditAction(action);
      if (!webhookEvent) return;
      const context =
        typeof metadata === "object" && metadata !== null
          ? (metadata as Record<string, unknown>)
          : metadata === undefined
            ? {}
            : { metadata };
      yield* dispatchWebhookEvent(
        db,
        {
          organizationId: ctx.organization.id,
          type: webhookEvent,
          data: { ...context, targetType, targetId },
        },
        webhookOptions,
      );
    });

  const WEBHOOK_EVENTS = new Set<string>(WEBHOOK_EVENT_TYPES);
  const normalizeWebhookEvents = (events: ReadonlyArray<string>): string[] => [
    ...new Set(events.filter((event) => WEBHOOK_EVENTS.has(event))),
  ];

  const webhookDescription = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (trimmed.length > 500)
      throw new EnterpriseBadRequest({ message: "Description must be 500 characters or fewer" });
    return trimmed;
  };

  const requireWebhookUrl = (url: string): string => {
    const problem = webhookUrlProblem(url);
    if (problem) throw new EnterpriseBadRequest({ message: problem });
    return url.trim();
  };

  const requireWebhookSigning = (): string => {
    if (!authSecret)
      throw new EnterpriseBadRequest({
        message: "Webhook signing is not configured on this deployment",
      });
    return authSecret;
  };

  const loadWebhookEndpoint = (organizationId: string, webhookId: string) =>
    Effect.gen(function* () {
      const endpoint = (yield* db.query.webhookEndpoint.findFirst({
        where: { id: webhookId, organizationId },
      })) as WebhookEndpointRow | undefined;
      if (!endpoint)
        return yield* Effect.fail(
          new EnterpriseNotFound({ message: "Webhook endpoint not found" }),
        );
      return endpoint;
    });

  const insertWebhookEndpoint = (input: {
    readonly organizationId: string;
    readonly url: string;
    readonly description: string | null;
    readonly events: string[];
    readonly enabled: boolean;
  }) =>
    Effect.gen(function* () {
      const signingSecret = yield* Effect.try({
        try: () => requireWebhookSigning(),
        catch: (cause) =>
          cause instanceof EnterpriseBadRequest
            ? cause
            : new EnterpriseBadRequest({ message: "Webhook signing is not configured" }),
      });
      const secret = generateWebhookSecret();
      const sealed = yield* Effect.tryPromise({
        try: () => sealSecret(signingSecret, secret),
        catch: () =>
          new EnterpriseBadRequest({ message: "Could not encrypt the webhook signing secret" }),
      });
      const webhookId = id();
      const timestamp = now();
      yield* db.insert(schema.webhookEndpoint).values({
        id: webhookId,
        organizationId: input.organizationId,
        url: input.url,
        secret: sealed,
        secretPrefix: webhookSecretPrefix(secret),
        description: input.description,
        eventFilters: input.events,
        enabled: input.enabled,
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        consecutiveFailures: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const endpoint = (yield* db.query.webhookEndpoint.findFirst({
        where: { id: webhookId, organizationId: input.organizationId },
      })) as WebhookEndpointRow;
      return { endpoint, secret };
    });

  /**
   * Report a partial/total APNs wake-up failure for a policy change as
   * `policy.deployment_failed`. The customer-facing policy write still
   * succeeds; devices converge on their next poll.
   */
  const reportPolicyDeliveryFailure = (
    organizationId: string,
    context: Record<string, unknown>,
    result: {
      readonly requested: number;
      readonly failed: ReadonlyArray<{ readonly deviceId: string }>;
    },
  ) =>
    // A deployment with no push transport is not a policy deployment failure;
    // devices still converge on their next poll.
    apns.available && result.failed.length > 0
      ? dispatchWebhookEvent(
          db,
          {
            organizationId,
            type: "policy.deployment_failed",
            data: {
              ...context,
              requested: result.requested,
              failed: result.failed.length,
              devices: result.failed.slice(0, 25).map((failure) => failure.deviceId),
            },
          },
          webhookOptions,
        )
      : Effect.void;

  const pushPolicyDevices = (
    organizationId: string,
    policyId: string,
    deviceIds: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const result = yield* applePush.pushAppleDevices(deviceIds);
      yield* reportPolicyDeliveryFailure(organizationId, { policyId }, result);
      return result;
    });

  const ensureStripeCustomer = (organization: EnterpriseOrganization) =>
    Effect.gen(function* () {
      if (organization.stripeCustomerId) return organization.stripeCustomerId;
      if (!stripe) return yield* Effect.fail(billingNotConfigured());

      // Search is the cheap path. Some Stripe accounts/API versions reject
      // search, so fall back to a single bounded page instead of iterating the
      // entire customer list.
      const search = yield* Effect.exit(
        stripe.customers.search({
          query: `metadata["organizationId"]:"${organization.id}" AND metadata["customerType"]:"organization"`,
          limit: 1,
        }) as Effect.Effect<{ data: Array<Stripe.Customer> }, unknown>,
      );
      let stripeCustomer: Stripe.Customer | undefined = Exit.isSuccess(search)
        ? search.value.data[0]
        : undefined;

      if (!stripeCustomer && Exit.isFailure(search)) {
        const page = yield* stripe
          .effect((client: Stripe) => client.customers.list({ limit: 100 }))
          .pipe(Effect.mapError(() => billingUnavailable()));
        stripeCustomer = page.data.find(
          (customer: Stripe.Customer) =>
            customer.metadata?.organizationId === organization.id &&
            customer.metadata?.customerType === "organization",
        );
      }

      stripeCustomer ??= (yield* stripe.customers
        .create({
          name: organization.name,
          metadata: { organizationId: organization.id, customerType: "organization" },
        })
        .pipe(Effect.mapError(() => billingUnavailable()))) as Stripe.Customer;

      yield* db
        .update(schema.organization)
        .set({ stripeCustomerId: stripeCustomer.id })
        .where(eq(schema.organization.id, organization.id));
      return stripeCustomer.id;
    });

  const listTenantInfo = (userId: string) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          logo: schema.organization.logo,
          displayName: schema.organization.displayName,
          supportEmail: schema.organization.supportEmail,
          brandColor: schema.organization.brandColor,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(eq(schema.member.userId, userId));
      return rows.map((row: any) => ({
        ...row,
        logo: row.logo ?? null,
        displayName: row.displayName ?? null,
        supportEmail: row.supportEmail ?? null,
        brandColor: row.brandColor ?? null,
      }));
    });

  const memberCount = (tenantId: string) =>
    Effect.gen(function* () {
      const [members] = yield* db
        .select({ value: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, tenantId));
      return members?.value ?? 0;
    });

  const ownerCount = (tenantId: string) =>
    Effect.gen(function* () {
      const members = yield* db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(eq(schema.member.organizationId, tenantId));
      return members.filter((member) => member.role.split(",").includes("owner")).length;
    });

  const assertTenantDevices = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;
      const rows = yield* db
        .select({ id: schema.device.id })
        .from(schema.device)
        .where(
          and(eq(schema.device.organizationId, tenantId), inArray(schema.device.id, [...ids])),
        );
      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
    });

  const assertTenantPolicies = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;
      const rows = yield* db
        .select({ id: schema.policy.id })
        .from(schema.policy)
        .where(
          and(eq(schema.policy.organizationId, tenantId), inArray(schema.policy.id, [...ids])),
        );
      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
    });

  const assertTenantApplications = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;
      const rows = yield* db
        .select({ id: schema.application.id })
        .from(schema.application)
        .where(
          and(
            eq(schema.application.organizationId, tenantId),
            inArray(schema.application.id, [...ids]),
          ),
        );
      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
    });

  const applicationAssignedDeviceIds = (organizationId: string, applicationId: string) =>
    Effect.gen(function* () {
      const groups = yield* db
        .select({ groupId: schema.applicationGroup.groupId })
        .from(schema.applicationGroup)
        .where(eq(schema.applicationGroup.applicationId, applicationId));
      const direct = yield* db
        .select({ deviceId: schema.applicationDevice.deviceId })
        .from(schema.applicationDevice)
        .where(eq(schema.applicationDevice.applicationId, applicationId));
      const groupDevices = groups.length
        ? yield* db
            .select({ deviceId: schema.groupDevice.deviceId })
            .from(schema.groupDevice)
            .where(
              inArray(
                schema.groupDevice.groupId,
                groups.map((group: { groupId: string }) => group.groupId),
              ),
            )
        : [];
      const ids = new Set<string>([
        ...direct.map((row: { deviceId: string }) => row.deviceId),
        ...groupDevices.map((row: { deviceId: string }) => row.deviceId),
      ]);
      if (ids.size === 0) return [] as Array<EnterpriseDevice>;
      const devices = yield* db
        .select()
        .from(schema.device)
        .where(
          and(
            eq(schema.device.organizationId, organizationId),
            inArray(schema.device.id, [...ids]),
          ),
        );
      return devices as Array<EnterpriseDevice>;
    });

  const assertTenantGroup = (tenantId: string, groupId: string) =>
    Effect.gen(function* () {
      const group = yield* db.query.enterpriseGroup.findFirst({
        where: { id: groupId, organizationId: tenantId },
      });
      if (!group) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
      return group;
    });

  const billingSummary = (organizationId: string) =>
    Effect.gen(function* () {
      const [subscription] = yield* db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organizationId))
        .limit(1);
      const [devices] = yield* db
        .select({ value: count() })
        .from(schema.device)
        .where(
          and(
            eq(schema.device.organizationId, organizationId),
            eq(schema.device.status, "enrolled"),
          ),
        );
      return {
        plan: subscription?.plan,
        status: subscription?.status,
        billableDevices: devices?.value ?? 0,
        subscriptionId: subscription?.stripeSubscriptionId ?? null,
        periodEnd: subscription?.periodEnd ? iso(subscription.periodEnd) : null,
        cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
        configured: billingConfigured,
      };
    });

  const rowDevice = (row: EnterpriseDevice) => ({
    id: row.id,
    proto: row.proto,
    name: row.name,
    model: row.model,
    modelIdentifier: row.modelIdentifier,
    serial: row.serial,
    status: row.status,
    enrolledAt: iso(row.enrolledAt),
    lastSeenAt: iso(row.lastSeenAt),
    assetTag: row.assetTag,
    notes: row.notes,
    physicalName: row.physicalName,
    vendor: row.vendor,
    osEdition: row.osEdition,
    osVersion: row.osVersion,
    osBuild: row.osBuild,
    diskTotal: row.diskTotal,
    diskUsed: row.diskUsed,
    fileVaultEnabled: row.fileVaultEnabled,
    fileVaultStatus:
      row.fileVaultEnabled === null || row.fileVaultEnabled === undefined
        ? null
        : row.fileVaultEnabled
          ? ("enabled" as const)
          : ("disabled" as const),
    batteryHealth: row.batteryHealth,
    capabilities: row.capabilities,
    modelNumber: row.modelNumber,
    inventoryUpdatedAt: row.inventoryUpdatedAt ? iso(row.inventoryUpdatedAt) : null,
    applicationsUpdatedAt: row.applicationsUpdatedAt ? iso(row.applicationsUpdatedAt) : null,
  });

  const rowDeviceApplication = (row: typeof schema.deviceApplication.$inferSelect) => ({
    bundleId: row.bundleId,
    name: row.name,
    version: row.version,
    shortVersion: row.shortVersion,
    bundleSize: row.bundleSize,
    dynamicSize: row.dynamicSize,
    hasUpdateAvailable: row.hasUpdateAvailable,
    isManaged: row.isManaged,
    lastReportedAt: iso(row.lastReportedAt),
  });

  const deviceDeclarationsFor = (deviceId: string) =>
    db
      .select()
      .from(schema.deviceDeclaration)
      .where(eq(schema.deviceDeclaration.deviceId, deviceId));

  /** Public view of `device_apple` delivery telemetry (never the token). */
  const rowPushInfo = (apple: any) => ({
    configured: Boolean(apple?.token && apple?.pushMagic),
    lastAttemptAt: apple?.lastPushAt ? iso(apple.lastPushAt) : null,
    lastSuccessAt: apple?.lastPushOkAt ? iso(apple.lastPushOkAt) : null,
    lastError: apple?.lastPushError ?? null,
    lastErrorCode: apple?.lastPushErrorCode ?? null,
    consecutiveFailures: apple?.consecutivePushFailures ?? 0,
    invalidToken: apple?.lastPushErrorCode === "invalid_token",
  });

  type CertificateDevice = Pick<EnterpriseDevice, "id" | "dmIdentifier">;

  const certificateIdsForDevices = (devices: ReadonlyArray<CertificateDevice>) => [
    ...new Set(devices.flatMap((device) => certificateDeviceIdsFor(device))),
  ];

  const deviceCertificatesFor = (organizationId: string, device: CertificateDevice) =>
    db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(
        and(
          eq(schema.scepIssuedCertificate.organizationId, organizationId),
          // Newly issued rows are keyed by the internal `device.id`; legacy
          // Windows rows used the DeviceID (`device.dmIdentifier`). Both must
          // resolve so health and revocation work across upgrades.
          inArray(schema.scepIssuedCertificate.deviceId, certificateDeviceIdsFor(device)),
        ),
      )
      .orderBy(desc(schema.scepIssuedCertificate.createdAt));

  /**
   * Mark every active identity certificate issued to these devices as revoked.
   * Returns the number of certificates that changed state. Tenant scoping is
   * applied in SQL so a crafted device id cannot revoke another tenant's certs.
   */
  const revokeDeviceCertificates = (
    organizationId: string,
    devices: ReadonlyArray<CertificateDevice>,
  ) =>
    Effect.gen(function* () {
      const deviceIds = certificateIdsForDevices(devices);
      if (deviceIds.length === 0) return 0;
      const active = yield* db
        .select({ serial: schema.scepIssuedCertificate.serial })
        .from(schema.scepIssuedCertificate)
        .where(
          and(
            eq(schema.scepIssuedCertificate.organizationId, organizationId),
            inArray(schema.scepIssuedCertificate.deviceId, deviceIds),
            isNull(schema.scepIssuedCertificate.revokedAt),
          ),
        );
      if (active.length === 0) return 0;
      const revokedAt = now();
      yield* db
        .update(schema.scepIssuedCertificate)
        .set({ revokedAt })
        .where(
          and(
            eq(schema.scepIssuedCertificate.organizationId, organizationId),
            inArray(schema.scepIssuedCertificate.deviceId, deviceIds),
            isNull(schema.scepIssuedCertificate.revokedAt),
          ),
        );
      return active.length;
    });

  const rowDeviceHealth = (
    device: Pick<
      EnterpriseDevice,
      | "status"
      | "lastSeenAt"
      | "diskTotal"
      | "diskUsed"
      | "proto"
      | "model"
      | "osEdition"
      | "fileVaultEnabled"
      | "batteryHealth"
    >,
    declarations: ReadonlyArray<{
      readonly identifier?: string;
      readonly declarationType?: string;
      readonly valid?: string | null;
      readonly active?: boolean;
      readonly reasons?: unknown;
    }>,
  ) =>
    deriveDeviceHealth({
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      declarations,
      diskTotal: device.diskTotal,
      diskUsed: device.diskUsed,
      proto: device.proto,
      model: device.model,
      osEdition: device.osEdition,
      fileVaultEnabled: device.fileVaultEnabled,
      batteryHealth: device.batteryHealth,
    });

  const rowCertificate = (row: typeof schema.scepIssuedCertificate.$inferSelect) => ({
    serial: row.serial,
    notAfter: iso(row.notAfter),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
    createdAt: iso(row.createdAt),
  });

  const rowDeclaration = (declaration: any) => ({
    identifier: declaration.identifier,
    declarationType: declaration.declarationType,
    active: declaration.active,
    valid: declaration.valid,
    serverToken: declaration.serverToken,
    reasons: declaration.reasons,
    updatedAt: iso(declaration.updatedAt),
  });

  const rowGroup = (row: EnterpriseGroup, devicesCount = 0, policiesCount = 0) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    kind: row.kind ?? ("manual" as const),
    rules: (row.rules as DynamicGroupRules | null | undefined) ?? null,
    lastEvaluatedAt: row.lastEvaluatedAt ? iso(row.lastEvaluatedAt) : null,
    devicesCount,
    policiesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPolicy = (row: EnterprisePolicy, withConfigurations = false) =>
    Effect.gen(function* () {
      const base: Record<string, unknown> = {
        id: row.id,
        name: row.name,
        notes: row.notes,
        priority: row.priority ?? 0,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };
      if (withConfigurations) {
        const configurations = yield* db
          .select()
          .from(schema.configuration)
          .where(eq(schema.configuration.policyId, row.id));
        base.configurations = Object.fromEntries(
          configurations.map((item: EnterpriseConfiguration) => [item.kind, item.data]),
        );
      }
      return base;
    });

  const rowApplication = (row: EnterpriseApplication, groupsCount = 0, devicesCount = 0) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    bundleId: row.bundleId,
    version: row.version,
    source: row.source,
    manifestUrl: row.manifestUrl,
    storeId: row.storeId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size ?? undefined,
    sha256: row.sha256,
    notes: row.notes,
    groupsCount,
    devicesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowEnrollment = (row: EnterpriseEnrollment) => ({
    id: row.id,
    code: row.code,
    enabledApple: row.enabledApple,
    enabledWindows: row.enabledWindows,
    enabledAndroid: row.enabledAndroid,
    enabledAssetTag: row.enabledAssetTag,
    maxDevices: row.maxDevices,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPreRegistration = (
    row: typeof schema.devicePreRegistration.$inferSelect,
    groupName: string | null,
  ) => ({
    id: row.id,
    serial: row.serial,
    name: row.name,
    assetTag: row.assetTag,
    notes: row.notes,
    groupId: row.groupId,
    groupName,
    consumedDeviceId: row.consumedDeviceId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const getOrCreateEnrollment = (organizationId: string) =>
    Effect.gen(function* () {
      const existing = yield* db.query.enterpriseEnrollment.findFirst({
        where: { organizationId: organizationId },
      });
      if (existing) return existing;
      const timestamp = now();
      const enrollment = { id: id(), organizationId, createdAt: timestamp, updatedAt: timestamp };
      yield* db.insert(schema.enterpriseEnrollment).ignore().values(enrollment);
      return (
        (yield* db.query.enterpriseEnrollment.findFirst({
          where: { organizationId: organizationId },
        })) ?? {
          ...enrollment,
          code: null,
          enabledApple: true,
          enabledWindows: true,
          enabledAndroid: false,
          enabledAssetTag: false,
          maxDevices: 100,
        }
      );
    });

  /**
   * Append an enrollment diagnostic. Diagnostics must never break enrollment,
   * so every failure (including a malformed table in a half-migrated
   * deployment) is swallowed.
   */
  const recordEnrollmentAttempt = (input: {
    readonly organizationId: string;
    readonly enrollmentId: string;
    readonly platform: EnrollmentAttemptPlatform;
    readonly outcome: EnrollmentAttemptOutcome;
    readonly detail?: string;
    readonly ip?: string | null;
    readonly userAgent?: string | null;
  }) =>
    Effect.catchCause(
      Effect.gen(function* () {
        let ipHash: string | null = null;
        // Without a deployment secret a salted digest would be trivially
        // reversible (or identical across deployments), so do not persist an
        // address-derived value at all.
        if (input.ip && authSecret) {
          const bytes = new TextEncoder().encode(`${authSecret}:${input.ip}`);
          ipHash = (yield* sha256Hex(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          )).slice(0, 32);
        }
        const timestamp = now();
        const cutoff = new Date(timestamp.getTime() - ENROLLMENT_ATTEMPT_DEDUPE_MS);
        const recent = (yield* db
          .select()
          .from(schema.enrollmentAttempt)
          .where(
            and(
              eq(schema.enrollmentAttempt.organizationId, input.organizationId),
              eq(schema.enrollmentAttempt.enrollmentId, input.enrollmentId),
              gte(schema.enrollmentAttempt.createdAt, cutoff),
            ),
          )) as Array<{ ipHash: string | null; outcome: string; createdAt: Date }>;
        const duplicate = recent.some((row) => {
          const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
          return (
            !Number.isNaN(createdAt.getTime()) &&
            createdAt >= cutoff &&
            (row.ipHash ?? null) === ipHash &&
            row.outcome === input.outcome
          );
        });
        const sameClient = recent.filter((row) => (row.ipHash ?? null) === ipHash).length;
        if (duplicate || sameClient >= ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT) return;
        yield* db.insert(schema.enrollmentAttempt).values({
          id: id(),
          organizationId: input.organizationId,
          enrollmentId: input.enrollmentId,
          platform: input.platform,
          outcome: input.outcome,
          detail: input.detail?.slice(0, 255) ?? null,
          ipHash,
          userAgent: input.userAgent?.slice(0, 255) ?? null,
          createdAt: timestamp,
        });
        // Only failed attempts are customer-actionable. Dedupe above already
        // stops a page-refresh loop from producing a delivery per request.
        if (input.outcome !== "ok")
          yield* dispatchWebhookEvent(
            db,
            {
              organizationId: input.organizationId,
              type: "enrollment.attempt_failed",
              occurredAt: timestamp,
              data: {
                enrollmentId: input.enrollmentId,
                platform: input.platform,
                outcome: input.outcome,
                detail: input.detail?.slice(0, 255) ?? null,
              },
            },
            webhookOptions,
          );
      }),
      () => Effect.void,
    );

  const requireApnsSecret = () =>
    Effect.gen(function* () {
      if (!authSecret)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "APNs certificate management is not configured on this server",
          }),
        );
      return authSecret;
    });

  const escapeLike = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

  /**
   * Build the tenant-scoped `WHERE` clause shared by the device search and CSV
   * export endpoints. Group filtering resolves the membership list up front
   * (one extra query) instead of joining per row.
   */
  const deviceSearchWhere = (organizationId: string, filters: DeviceSearchFilters) =>
    Effect.gen(function* () {
      const conditions: SQL[] = [eq(schema.device.organizationId, organizationId)];
      if (filters.q) {
        const pattern = `%${escapeLike(filters.q)}%`;
        conditions.push(
          or(
            like(schema.device.name, pattern),
            like(schema.device.serial, pattern),
            like(schema.device.model, pattern),
            like(schema.device.dmIdentifier, pattern),
            like(schema.device.assetTag, pattern),
          ) as SQL,
        );
      }
      if (filters.status) conditions.push(eq(schema.device.status, filters.status));
      if (filters.proto) conditions.push(eq(schema.device.proto, filters.proto));
      if (filters.notSeenBefore)
        conditions.push(lt(schema.device.lastSeenAt, filters.notSeenBefore));
      if (filters.groupId) {
        const group = yield* db.query.enterpriseGroup.findFirst({
          where: { id: filters.groupId, organizationId },
        });
        if (!group)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
        // Keep the membership set in SQL so large groups do not inflate the
        // parameter list (the group_device primary key covers this lookup).
        conditions.push(
          inArray(
            schema.device.id,
            db
              .select({ deviceId: schema.groupDevice.deviceId })
              .from(schema.groupDevice)
              .where(eq(schema.groupDevice.groupId, filters.groupId)),
          ),
        );
      }
      if (filters.health) {
        // Health is derived from declarations and inventory fields, not a
        // stored column. Resolving the matching ids in application code keeps
        // the filter exactly consistent with the dashboard counts. The scan is
        // bounded to one tenant (and the preceding SQL filters); a stored
        // health column would need a schema redesign and backfill.
        const devices = yield* db
          .select()
          .from(schema.device)
          .where(and(...conditions));
        const deviceIds = devices.map((device: EnterpriseDevice) => device.id);
        const declarations = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceDeclaration)
              .where(inArray(schema.deviceDeclaration.deviceId, deviceIds))
          : [];
        const byDevice = new Map<string, Array<any>>();
        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }
        const matching = devices
          .filter((device: EnterpriseDevice) => {
            const health = rowDeviceHealth(device, byDevice.get(device.id) ?? []);
            return filters.health === "stale" ? health.stale : health.level === filters.health;
          })
          .map((device: EnterpriseDevice) => device.id);
        conditions.push(
          matching.length > 0
            ? inArray(schema.device.id, matching)
            : // A sentinel id keeps the generated SQL valid when nothing matches.
              eq(schema.device.id, "__no_matching_health__"),
        );
      }
      if (filters.push) {
        // Resolve matching devices from `device_apple` up front, like the
        // health filter. The final device condition remains tenant-scoped, so
        // ids from other tenants can never leak rows.
        const appleRows = yield* db
          .select()
          .from(schema.deviceApple)
          .where(
            filters.push === "invalid"
              ? eq(schema.deviceApple.lastPushErrorCode, "invalid_token")
              : gt(schema.deviceApple.consecutivePushFailures, 0),
          );
        const deviceIds = appleRows.map((row: { deviceId: string }) => row.deviceId);
        conditions.push(
          deviceIds.length > 0
            ? inArray(schema.device.id, deviceIds)
            : eq(schema.device.id, "__no_matching_push__"),
        );
      }
      return and(...conditions);
    });

  const deviceOrder = (filters: DeviceSearchFilters) => {
    const column =
      filters.sort === "lastSeenAt"
        ? schema.device.lastSeenAt
        : filters.sort === "enrolledAt"
          ? schema.device.enrolledAt
          : filters.sort === "status"
            ? schema.device.status
            : schema.device.name;
    const primary = filters.direction === "desc" ? desc(column) : asc(column);
    // A stable tiebreaker keeps offset pagination deterministic.
    return [primary, asc(schema.device.id)];
  };

  /** Load group memberships for a page of devices in one query (avoids N+1). */
  const deviceGroupsFor = (organizationId: string, deviceIds: string[]) =>
    Effect.gen(function* () {
      const groups = new Map<string, Array<{ id: string; name: string }>>();
      if (deviceIds.length === 0) return groups;
      const rows = yield* db
        .select({
          deviceId: schema.groupDevice.deviceId,
          id: schema.enterpriseGroup.id,
          name: schema.enterpriseGroup.name,
        })
        .from(schema.groupDevice)
        .innerJoin(
          schema.enterpriseGroup,
          eq(schema.groupDevice.groupId, schema.enterpriseGroup.id),
        )
        .where(
          and(
            inArray(schema.groupDevice.deviceId, deviceIds),
            eq(schema.enterpriseGroup.organizationId, organizationId),
          ),
        );
      for (const row of rows) {
        const list = groups.get(row.deviceId) ?? [];
        list.push({ id: row.id, name: row.name });
        groups.set(row.deviceId, list);
      }
      return groups;
    });

  const loadAuditEntries = (organizationId: string, filters: AuditSearchFilters, take: number) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(schema.auditLog)
        .where(auditWhere(schema, organizationId, filters))
        .orderBy(...auditOrder(schema))
        .limit(take)
        .offset(filters.offset);
      return rows;
    });

  /**
   * `normalizeAuditSearchQuery` throws for bad dates/cursors. Wrap the call so
   * a synchronous throw becomes a typed 400 instead of an Effect defect (500).
   */
  const normalizedAuditFilters = (query: Parameters<typeof normalizeAuditSearchQuery>[0]) =>
    Effect.try({
      try: () => normalizeAuditSearchQuery(query),
      catch: (cause) =>
        cause instanceof EnterpriseBadRequest
          ? cause
          : new EnterpriseBadRequest({ message: "Invalid audit filters" }),
    });

  /**
   * Return the private key for the tenant's in-progress CSR. We reuse the
   * pending key (multiple tabs) or the key from an existing certificate
   * (renewal) before generating a fresh one.
   */
  const loadApnsKey = (organizationId: string) =>
    Effect.gen(function* () {
      const secret = yield* requireApnsSecret();
      const pending = yield* db.query.applePushKey.findFirst({
        where: { organizationId },
      });
      if (pending) {
        const jwk = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(secret, pending.encryptedPrivateKeyJwk),
            catch: (cause) =>
              new EnterpriseBadRequest({ message: "Could not read the pending APNs key" }),
          }),
        ) as JsonWebKey;
        return { jwk, pending: true };
      }

      const certificate = yield* db.query.applePushCertificate.findFirst({
        where: { organizationId },
      });
      if (certificate?.encryptedKey) {
        const jwk = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(secret, certificate.encryptedKey!),
            catch: (cause) =>
              new EnterpriseBadRequest({ message: "Could not read the existing APNs key" }),
          }),
        ) as JsonWebKey;
        return { jwk, pending: false };
      }

      const keyPair = yield* Effect.tryPromise({
        try: () => generateApnsKeyPair(),
        catch: (cause) =>
          new EnterpriseBadRequest({ message: "Could not generate an APNs key pair" }),
      });
      const jwk = yield* Effect.tryPromise({
        try: () => exportPrivateKeyJwk(keyPair.privateKey),
        catch: (cause) => new EnterpriseBadRequest({ message: "Could not export the APNs key" }),
      });
      const encryptedPrivateKeyJwk = yield* Effect.tryPromise({
        try: () => sealSecret(secret, JSON.stringify(jwk)),
        catch: (cause) => new EnterpriseBadRequest({ message: "Could not seal the APNs key" }),
      });
      const timestamp = now();
      yield* db
        .insert(schema.applePushKey)
        .values({
          organizationId,
          encryptedPrivateKeyJwk,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onDuplicateKeyUpdate({
          set: { encryptedPrivateKeyJwk, updatedAt: timestamp },
        });
      return { jwk, pending: true };
    });

  const remoteApnsVendor = () =>
    cloudAppleVendorCert && cloudAppleVendorKey
      ? { certificatePem: cloudAppleVendorCert, privateKeyPem: cloudAppleVendorKey }
      : undefined;

  /**
   * Assignment payloads accept either a bare id (legacy callers, defaults to
   * include) or `{ id, mode }`. Unassign ignores the mode.
   */
  const assignmentRefs = (
    values: ReadonlyArray<string | { id: string; mode?: "include" | "exclude" }> | undefined,
  ) =>
    (values ?? []).map((value) =>
      typeof value === "string"
        ? { id: value, mode: "include" as const }
        : { id: value.id, mode: value.mode ?? "include" },
    );

  const service: Record<
    string,
    (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>
  > = {
    me: (request) =>
      Effect.gen(function* () {
        const resolved = yield* auth.requireUser({ headers: request.headers });
        const { user } = resolved;
        const tenants = yield* listTenantInfo(user.id);
        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
          },
          tenants,
        };
      }),
    updateMe: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const body = payload as { name?: string; image?: string | null };
        yield* db
          .update(schema.user)
          .set({
            name: body.name ?? user.name,
            image: body.image === undefined ? user.image : body.image,
            updatedAt: now(),
          })
          .where(eq(schema.user.id, user.id));
        return ok;
      }),
    deleteMe: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });

        // Remove solo tenants with the account; keep shared tenants for the
        // remaining administrators.
        const memberships = yield* db.query.member.findMany({
          where: { userId: user.id },
        });
        for (const membership of memberships) {
          const [members] = yield* db
            .select({ value: count() })
            .from(schema.member)
            .where(eq(schema.member.organizationId, membership.organizationId));
          if ((members?.value ?? 0) <= 1) {
            yield* db
              .delete(schema.organization)
              .where(eq(schema.organization.id, membership.organizationId));
          } else {
            if (
              hasOwnerRole(membership.role) &&
              (yield* ownerCount(membership.organizationId)) <= 1
            )
              return yield* Effect.fail(
                new EnterpriseForbidden({
                  message: "Transfer ownership of this workspace before deleting your account.",
                }),
              );
            yield* db.delete(schema.member).where(eq(schema.member.id, membership.id));
          }
        }

        yield* db
          .delete(schema.platformInstance)
          .where(eq(schema.platformInstance.issuedByUserId, user.id));
        yield* db.delete(schema.accountApiToken).where(eq(schema.accountApiToken.userId, user.id));
        yield* db.delete(schema.invitation).where(eq(schema.invitation.inviterId, user.id));
        yield* db.delete(schema.member).where(eq(schema.member.userId, user.id));

        // Yielded Auth owns these tables; remove the subject's auth state.
        // `authProofs` has no subject column (its binding is JSON), so those
        // short-lived rows are left to expire naturally.
        const authTables = [
          (schema as any).authPending,
          (schema as any).authSessions,
          (schema as any).authPasswords,
          (schema as any).authEmailCredentials,
          (schema as any).authCredentials,
          (schema as any).authIdentifiers,
        ];
        for (const table of authTables) {
          if (table) yield* db.delete(table).where(eq((table as any).subjectId, user.id));
        }

        yield* db.delete(schema.user).where(eq(schema.user.id, user.id));
        return ok;
      }).pipe(Effect.tapCause((cause) => Effect.logError(`deleteMe failed: ${String(cause)}`))),
    listAccountSessions: (request) =>
      Effect.gen(function* () {
        const resolved = yield* auth.requireUser({ headers: request.headers });
        return {
          sessions: yield* listUserSessions(
            db,
            resolved.user.id,
            resolved.session?.sessionId as string | undefined,
          ),
        };
      }),
    revokeAccountSession: (request, sessionId) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const revoked = yield* revokeUserSession(db, user.id, sessionId);
        if (!revoked)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Session not found" }));
        return ok;
      }),
    listTenants: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const tenants = yield* listTenantInfo(user.id);
        return { tenants };
      }),
    createTenant: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const body = payload as {
          name: string;
          slug: string;
          logo?: string | null;
          displayName?: string | null;
          supportEmail?: string | null;
          brandColor?: string | null;
          metadata?: Record<string, unknown>;
        };
        const existing = yield* db.query.organization.findFirst({
          where: { slug: body.slug },
        });
        if (existing)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "That tenant slug is already in use" }),
          );
        const branding = yield* brandingOrFail(body);
        const tenantId = id();
        const timestamp = now();
        yield* db.insert(schema.organization).values({
          id: tenantId,
          name: body.name,
          slug: body.slug,
          logo: null,
          displayName: null,
          supportEmail: null,
          brandColor: null,
          ...branding,
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.member).values({
          id: id(),
          organizationId: tenantId,
          userId: user.id,
          role: "owner",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.enterpriseEnrollment).ignore().values({
          id: tenantId,
          organizationId: tenantId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* audit(
          { user, organization: { id: tenantId } },
          "tenant.created",
          "tenant",
          tenantId,
          {
            name: body.name,
            slug: body.slug,
          },
        );
        return { id: tenantId };
      }),
    getTenant: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        return {
          ...ctx.organization,
          logo: ctx.organization.logo ?? null,
          displayName: ctx.organization.displayName ?? null,
          supportEmail: ctx.organization.supportEmail ?? null,
          brandColor: ctx.organization.brandColor ?? null,
          role: ctx.member.role,
          createdAt: iso(ctx.organization.createdAt),
        };
      }),
    exportTenant: (request, tenantId, query) =>
      Effect.gen(function* () {
        // A bundle carries member emails, application metadata and policy
        // configuration. Restrict it to an owner even though admins can write.
        const ctx = yield* requireTenant(request, tenantId, "write");
        if (!hasOwnerRole(ctx.member.role))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only a tenant owner can export this tenant" }),
          );

        const organizationId = ctx.organization.id;
        const members = (yield* db
          .select()
          .from(schema.member)
          .where(eq(schema.member.organizationId, organizationId))) as Array<{
          userId: string;
          role: string;
          createdAt: Date;
        }>;
        const userIds = [...new Set(members.map((member) => member.userId))];
        const users = userIds.length
          ? ((yield* db
              .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
              .from(schema.user)
              .where(inArray(schema.user.id, userIds))) as Array<{
              id: string;
              name: string;
              email: string;
            }>)
          : [];
        const usersById = new Map(users.map((user) => [user.id, user]));

        const groups = (yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(
            eq(schema.enterpriseGroup.organizationId, organizationId),
          )) as Array<EnterpriseGroup>;
        const groupIds = groups.map((group) => group.id);
        const policies = (yield* db
          .select()
          .from(schema.policy)
          .where(eq(schema.policy.organizationId, organizationId))) as Array<EnterprisePolicy>;
        const policyIds = policies.map((policy) => policy.id);
        const applications = (yield* db
          .select()
          .from(schema.application)
          .where(
            eq(schema.application.organizationId, organizationId),
          )) as Array<EnterpriseApplication>;
        const applicationIds = applications.map((application) => application.id);

        const groupDevices = groupIds.length
          ? ((yield* db
              .select()
              .from(schema.groupDevice)
              .where(inArray(schema.groupDevice.groupId, groupIds))) as Array<{
              groupId: string;
              deviceId: string;
            }>)
          : [];
        const deviceIds = [...new Set(groupDevices.map((link) => link.deviceId))];
        const devices = deviceIds.length
          ? ((yield* db
              .select({
                id: schema.device.id,
                name: schema.device.name,
                serial: schema.device.serial,
              })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, organizationId),
                  inArray(schema.device.id, deviceIds),
                ),
              )) as Array<{ id: string; name: string; serial: string | null }>)
          : [];
        const devicesById = new Map(devices.map((device) => [device.id, device]));

        const groupPolicies = groupIds.length
          ? ((yield* db
              .select()
              .from(schema.groupPolicy)
              .where(inArray(schema.groupPolicy.groupId, groupIds))) as Array<{
              groupId: string;
              policyId: string;
            }>)
          : [];
        const policyKeys = new Set(policyIds);
        const groupPolicyKeys = new Map<string, string[]>();
        for (const link of groupPolicies) {
          if (!policyKeys.has(link.policyId)) continue;
          groupPolicyKeys.set(link.groupId, [
            ...(groupPolicyKeys.get(link.groupId) ?? []),
            link.policyId,
          ]);
        }

        const configurations = policyIds.length
          ? ((yield* db
              .select()
              .from(schema.configuration)
              .where(inArray(schema.configuration.policyId, policyIds))) as Array<{
              policyId: string;
              kind: string;
              data: unknown;
            }>)
          : [];
        const policyConfigurations = new Map<string, Record<string, unknown>>();
        for (const configuration of configurations) {
          const current = policyConfigurations.get(configuration.policyId) ?? {};
          current[configuration.kind] = configuration.data;
          policyConfigurations.set(configuration.policyId, current);
        }

        const applicationGroups = applicationIds.length
          ? ((yield* db
              .select()
              .from(schema.applicationGroup)
              .where(inArray(schema.applicationGroup.applicationId, applicationIds))) as Array<{
              applicationId: string;
              groupId: string;
            }>)
          : [];
        const groupKeys = new Set(groupIds);
        const applicationGroupKeys = new Map<string, string[]>();
        for (const link of applicationGroups) {
          if (!groupKeys.has(link.groupId)) continue;
          applicationGroupKeys.set(link.applicationId, [
            ...(applicationGroupKeys.get(link.applicationId) ?? []),
            link.groupId,
          ]);
        }

        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { organizationId },
        });
        const preRegistrations = (yield* db
          .select()
          .from(schema.devicePreRegistration)
          .where(eq(schema.devicePreRegistration.organizationId, organizationId))) as Array<{
          serial: string;
          name: string | null;
          assetTag: string | null;
          notes: string | null;
          groupId: string | null;
        }>;
        const certificates = (yield* db
          .select()
          .from(schema.scepIssuedCertificate)
          .where(eq(schema.scepIssuedCertificate.organizationId, organizationId))) as Array<{
          serial: string;
          enrollmentId: string | null;
          deviceId: string | null;
          notAfter: Date;
          revokedAt: Date | null;
          createdAt: Date;
        }>;

        let auditLog: TenantExportAuditEntry[] | undefined;
        let auditTruncated: boolean | undefined;
        if (query?.includeAudit === "true" || query?.includeAudit === "1") {
          const rows = (yield* db
            .select()
            .from(schema.auditLog)
            .where(eq(schema.auditLog.organizationId, organizationId))
            .orderBy(desc(schema.auditLog.createdAt))
            .limit(TENANT_EXPORT_MAX_ROWS + 1)) as Array<{
            action: string;
            targetType: string;
            targetId: string | null;
            actorEmail: string | null;
            metadata: unknown;
            createdAt: Date;
          }>;
          auditTruncated = rows.length > TENANT_EXPORT_MAX_ROWS;
          auditLog = rows.slice(0, TENANT_EXPORT_MAX_ROWS).map((entry) => ({
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            actorEmail: entry.actorEmail,
            metadata: entry.metadata,
            createdAt: iso(entry.createdAt),
          }));
        }

        const profile: TenantExportProfile = {
          name: ctx.organization.name,
          slug: ctx.organization.slug,
          logo: ctx.organization.logo ?? null,
          displayName: ctx.organization.displayName ?? null,
          supportEmail: ctx.organization.supportEmail ?? null,
          brandColor: ctx.organization.brandColor ?? null,
          metadata: exportMetadata(ctx.organization.metadata),
        };
        const exportedMembers: TenantExportMember[] = members.flatMap((member) => {
          const user = usersById.get(member.userId);
          if (!user) return [];
          return [
            {
              email: user.email,
              name: user.name,
              role: member.role,
              createdAt: iso(member.createdAt),
            },
          ];
        });
        const exportedGroups: TenantExportGroup[] = groups.map((group) => ({
          key: group.id,
          name: group.name,
          notes: group.notes,
          devices: groupDevices.flatMap((link) => {
            if (link.groupId !== group.id) return [];
            const device = devicesById.get(link.deviceId);
            if (!device) return [];
            return [{ key: device.id, name: device.name, serial: device.serial }];
          }),
          policyKeys: groupPolicyKeys.get(group.id) ?? [],
        }));
        const exportedPolicies: TenantExportPolicy[] = policies.map((policy) => ({
          key: policy.id,
          name: policy.name,
          notes: policy.notes,
          configurations: policyConfigurations.get(policy.id) ?? {},
        }));
        const exportedApplications: TenantExportApplication[] = applications.map((application) => ({
          key: application.id,
          name: application.name,
          platform: application.platform,
          bundleId: application.bundleId,
          version: application.version,
          source: application.source,
          manifestUrl: application.manifestUrl,
          storeId: application.storeId,
          fileName: application.fileName,
          contentType: application.contentType,
          size: application.size,
          sha256: application.sha256,
          r2Key: application.r2Key,
          notes: application.notes,
          groupKeys: applicationGroupKeys.get(application.id) ?? [],
        }));
        const exportedEnrollment: TenantExportEnrollment | undefined = enrollment
          ? {
              code: enrollment.code,
              enabledApple: enrollment.enabledApple ?? true,
              enabledWindows: enrollment.enabledWindows ?? true,
              enabledAndroid: enrollment.enabledAndroid ?? false,
              enabledAssetTag: enrollment.enabledAssetTag ?? false,
              maxDevices: enrollment.maxDevices ?? 100,
            }
          : undefined;
        const exportedPreRegistrations: TenantExportPreRegistration[] = preRegistrations.map(
          (row) => ({
            serial: row.serial,
            name: row.name,
            assetTag: row.assetTag,
            notes: row.notes,
            groupKey: row.groupId && groupKeys.has(row.groupId) ? row.groupId : null,
          }),
        );
        const exportedCertificates: TenantExportCertificate[] = certificates.map((row) => ({
          serial: row.serial,
          enrollmentId: row.enrollmentId,
          deviceKey: row.deviceId && devicesById.has(row.deviceId) ? row.deviceId : null,
          notAfter: iso(row.notAfter),
          revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
          createdAt: iso(row.createdAt),
        }));

        const bundle: TenantExportEnvelope = {
          version: TENANT_EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          tenant: profile,
          members: exportedMembers,
          groups: exportedGroups,
          policies: exportedPolicies,
          applications: exportedApplications,
          ...(exportedEnrollment ? { enrollment: exportedEnrollment } : {}),
          preRegistrations: exportedPreRegistrations,
          scepCertificates: exportedCertificates,
          ...(auditLog ? { auditLog } : {}),
          ...(auditTruncated !== undefined ? { auditTruncated } : {}),
        };
        return {
          body: JSON.stringify(bundle, null, 2),
          filename: `tenant-${safeFilename(ctx.organization.slug)}-${new Date()
            .toISOString()
            .slice(0, 10)}.json`,
          version: TENANT_EXPORT_VERSION,
          counts: {
            members: exportedMembers.length,
            groups: exportedGroups.length,
            policies: exportedPolicies.length,
            applications: exportedApplications.length,
            preRegistrations: exportedPreRegistrations.length,
            certificates: exportedCertificates.length,
          },
        };
      }),
    importTenant: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const bundle = payload as TenantImportRequest;

        // The payload has already been decoded, so this bounds what a caller
        // can make us hold in memory (and what could be written in one go).
        const bytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
        if (bytes > TENANT_IMPORT_MAX_BYTES)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `The bundle is too large (${Math.ceil(
                bytes / 1024,
              )} KB). The limit is ${TENANT_IMPORT_MAX_BYTES / 1024} KB.`,
            }),
          );
        const declaredBytes = Number(request.headers?.["content-length"]);
        if (Number.isFinite(declaredBytes) && declaredBytes > TENANT_IMPORT_MAX_BYTES)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `The bundle is too large. The limit is ${TENANT_IMPORT_MAX_BYTES / 1024} KB.`,
            }),
          );
        if (bundle.version !== TENANT_EXPORT_VERSION)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `Unsupported tenant bundle version ${String(
                bundle.version,
              )}. This server imports version ${TENANT_EXPORT_VERSION}.`,
            }),
          );

        const profile = bundle.tenant;
        if (!profile)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle is missing tenant details" }),
          );
        const name = importString(profile.name, 255);
        if (!name)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle tenant name is required" }),
          );
        if ((profile.name ?? "").trim().length > 255)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The tenant name is longer than 255 characters" }),
          );
        const branding = yield* brandingOrFail(profile);
        const metadata = profile.metadata ? JSON.stringify(profile.metadata) : null;
        if (metadata && metadata.length > 60_000)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "The tenant metadata is too large (limit 60000 characters)",
            }),
          );
        const requestedSlug = slugBase((profile.slug ?? "").trim() || name);
        if (!requestedSlug)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle tenant slug is not usable" }),
          );

        const groups = bundle.groups ?? [];
        const policies = bundle.policies ?? [];
        const applications = bundle.applications ?? [];
        const preRegistrations = bundle.preRegistrations ?? [];
        for (const [label, rows] of [
          ["groups", groups],
          ["policies", policies],
          ["applications", applications],
          ["pre-registrations", preRegistrations],
        ] as const) {
          if (rows.length > TENANT_EXPORT_MAX_ROWS)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `The bundle contains too many ${label} (${rows.length}); the limit is ${TENANT_EXPORT_MAX_ROWS}.`,
              }),
            );
        }

        const groupKeys = new Set<string>();
        for (const group of groups) {
          const key = importString(group.key, 255);
          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every group needs a key" }),
            );
          if (groupKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate group key "${key}"` }),
            );
          groupKeys.add(key);
          const groupName = importString(group.name, 255);
          if (!groupName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Group "${key}" needs a name` }),
            );
          if ((group.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Group "${groupName}" has notes longer than 10000 characters`,
              }),
            );
          if (!Array.isArray(group.policyKeys))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Group "${groupName}" must list its policy assignments`,
              }),
            );
        }

        const policyKeys = new Set<string>();
        const policyConfigurations = new Map<string, Array<[string, unknown]>>();
        for (const policy of policies) {
          const key = importString(policy.key, 255);
          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every policy needs a key" }),
            );
          if (policyKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate policy key "${key}"` }),
            );
          policyKeys.add(key);
          const policyName = importString(policy.name, 255);
          if (!policyName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Policy "${key}" needs a name` }),
            );
          if ((policy.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Policy "${policyName}" has notes longer than 10000 characters`,
              }),
            );
          const configurations = policy.configurations ?? {};
          if (typeof configurations !== "object" || Array.isArray(configurations))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Policy "${policyName}" has invalid configuration data`,
              }),
            );
          const entries: Array<[string, unknown]> = [];
          for (const [kind, data] of Object.entries(configurations)) {
            if (data === null || data === undefined)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Policy "${policyName}" has an empty "${kind}" configuration`,
                }),
              );
            yield* validateConfiguration(kind, data).pipe(
              Effect.mapError(
                (message) =>
                  new EnterpriseBadRequest({
                    message: `Policy "${policyName}": ${message}`,
                  }),
              ),
            );
            entries.push([kind, data]);
          }
          policyConfigurations.set(key, entries);
        }

        for (const group of groups) {
          for (const policyKey of group.policyKeys) {
            if (!policyKeys.has(policyKey))
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Group "${group.name}" references policy "${policyKey}", which is not in this bundle`,
                }),
              );
          }
        }

        const applicationKeys = new Set<string>();
        let applicationsWithoutFiles = 0;
        for (const application of applications) {
          const key = importString(application.key, 255);
          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every application needs a key" }),
            );
          if (applicationKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate application key "${key}"` }),
            );
          applicationKeys.add(key);
          const applicationName = importString(application.name, 255);
          if (!applicationName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Application "${key}" needs a name` }),
            );
          if ((application.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has notes longer than 10000 characters`,
              }),
            );
          if (
            application.platform !== "apple" &&
            application.platform !== "win" &&
            application.platform !== "android"
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an unknown platform`,
              }),
            );
          if (
            application.source !== "manifest" &&
            application.source !== "store" &&
            application.source !== "upload"
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an unknown source`,
              }),
            );
          if (application.platform === "apple" && application.source === "manifest") {
            if (!application.manifestUrl?.trim())
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Apple manifest application "${applicationName}" requires a manifest URL`,
                }),
              );
          }
          if (application.source === "store" && !Number.isSafeInteger(Number(application.storeId)))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" must have a whole-number store ID`,
              }),
            );
          if (
            application.size !== null &&
            application.size !== undefined &&
            (!Number.isSafeInteger(application.size) ||
              application.size < 0 ||
              application.size > 2_147_483_647)
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an invalid file size`,
              }),
            );
          if (!Array.isArray(application.groupKeys))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" must list its group assignments`,
              }),
            );
          for (const groupKey of application.groupKeys) {
            if (!groupKeys.has(groupKey))
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Application "${applicationName}" references group "${groupKey}", which is not in this bundle`,
                }),
              );
          }
          // Bundle bytes are metadata-only, so an uploaded object cannot be
          // restored and must be re-uploaded after import.
          if (application.source === "upload" || application.r2Key) applicationsWithoutFiles++;
        }

        const serials = new Set<string>();
        for (const row of preRegistrations) {
          const serial = importString(row.serial, 255);
          if (!serial)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every pre-registration needs a serial" }),
            );
          if (serials.has(serial.toLowerCase()))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Duplicate pre-registration serial "${serial}"`,
              }),
            );
          serials.add(serial.toLowerCase());
          if (row.groupKey && !groupKeys.has(row.groupKey))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Pre-registration "${serial}" references group "${row.groupKey}", which is not in this bundle`,
              }),
            );
        }

        const enrollment = bundle.enrollment;
        if (enrollment) {
          if (
            !Number.isSafeInteger(enrollment.maxDevices) ||
            enrollment.maxDevices < 0 ||
            enrollment.maxDevices > 1_000_000
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "The enrollment device limit must be a whole number between 0 and 1000000",
              }),
            );
          if (
            enrollment.code !== null &&
            enrollment.code !== undefined &&
            (typeof enrollment.code !== "string" || enrollment.code.length > 255)
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "The enrollment code must be 255 characters or fewer",
              }),
            );
        }

        const timestamp = now();
        const tenantId = id();
        const result = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            let slug = requestedSlug;
            let available = yield* tx.query.organization.findFirst({ where: { slug } });
            for (let attempt = 2; available && attempt <= 100; attempt++) {
              slug = `${requestedSlug.slice(0, 240)}-${attempt}`;
              available = yield* tx.query.organization.findFirst({ where: { slug } });
            }
            if (available)
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "Could not derive a unique tenant slug for this import",
                }),
              );

            yield* tx.insert(schema.organization).values({
              id: tenantId,
              name,
              slug,
              logo: null,
              displayName: null,
              supportEmail: null,
              brandColor: null,
              ...branding,
              metadata,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            yield* tx.insert(schema.member).values({
              id: id(),
              organizationId: tenantId,
              userId: user.id,
              role: "owner",
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            yield* tx.insert(schema.enterpriseEnrollment).values({
              id: tenantId,
              organizationId: tenantId,
              ...(enrollment
                ? {
                    code: enrollment.code?.trim() || null,
                    enabledApple: enrollment.enabledApple,
                    enabledWindows: enrollment.enabledWindows,
                    enabledAndroid: enrollment.enabledAndroid,
                    enabledAssetTag: enrollment.enabledAssetTag,
                    maxDevices: enrollment.maxDevices,
                  }
                : {}),
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            const policyIdByKey = new Map<string, string>();
            for (const policy of policies) {
              const policyId = id();
              policyIdByKey.set(policy.key, policyId);
              yield* tx.insert(schema.policy).values({
                id: policyId,
                organizationId: tenantId,
                name: importString(policy.name, 255)!,
                notes: policy.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
              const configurations = policyConfigurations.get(policy.key) ?? [];
              if (configurations.length > 0) {
                const values = yield* Effect.all(
                  configurations.map(([kind, data]) =>
                    Effect.map(hashJson(data), (hash) => ({ policyId, kind, data, hash })),
                  ),
                );
                yield* tx.insert(schema.configuration).values(values);
              }
              yield* tx.insert(schema.policyDeployment).values({
                id: id(),
                organizationId: tenantId,
                policyId,
                version: 1,
                snapshot: Object.fromEntries(configurations),
                createdByUserId: user.id,
                createdAt: timestamp,
              });
            }

            const groupIdByKey = new Map<string, string>();
            for (const group of groups) {
              const groupId = id();
              groupIdByKey.set(group.key, groupId);
              yield* tx.insert(schema.enterpriseGroup).values({
                id: groupId,
                organizationId: tenantId,
                name: importString(group.name, 255)!,
                notes: group.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }
            const groupPolicyValues: Array<{ groupId: string; policyId: string }> = [];
            for (const group of groups) {
              const groupId = groupIdByKey.get(group.key)!;
              for (const policyKey of group.policyKeys) {
                const policyId = policyIdByKey.get(policyKey);
                if (policyId) groupPolicyValues.push({ groupId, policyId });
              }
            }
            if (groupPolicyValues.length > 0)
              yield* tx.insert(schema.groupPolicy).ignore().values(groupPolicyValues);

            const applicationIdByKey = new Map<string, string>();
            for (const application of applications) {
              const applicationId = id();
              applicationIdByKey.set(application.key, applicationId);
              yield* tx.insert(schema.application).values({
                id: applicationId,
                organizationId: tenantId,
                name: importString(application.name, 255)!,
                platform: application.platform,
                bundleId: importString(application.bundleId, 255),
                version: importString(application.version, 255),
                source: application.source,
                manifestUrl: application.manifestUrl ?? null,
                storeId: importString(application.storeId, 255),
                fileName: importString(application.fileName, 255),
                contentType: importString(application.contentType, 255),
                size: application.size ?? null,
                sha256: importString(application.sha256, 255),
                // Object bytes are not in the bundle; never point a new tenant
                // at the source tenant's R2 key.
                r2Key: null,
                notes: application.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }
            const applicationGroupValues: Array<{ groupId: string; applicationId: string }> = [];
            for (const application of applications) {
              const applicationId = applicationIdByKey.get(application.key)!;
              for (const groupKey of application.groupKeys) {
                const groupId = groupIdByKey.get(groupKey);
                if (groupId) applicationGroupValues.push({ groupId, applicationId });
              }
            }
            if (applicationGroupValues.length > 0)
              yield* tx.insert(schema.applicationGroup).ignore().values(applicationGroupValues);

            for (const row of preRegistrations)
              yield* tx.insert(schema.devicePreRegistration).values({
                id: id(),
                organizationId: tenantId,
                serial: importString(row.serial, 255)!,
                name: importString(row.name, 255),
                assetTag: importString(row.assetTag, 255),
                notes: importString(row.notes, 10_000),
                groupId: row.groupKey ? (groupIdByKey.get(row.groupKey) ?? null) : null,
                consumedDeviceId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });

            yield* tx.insert(schema.auditLog).values({
              id: id(),
              organizationId: tenantId,
              actorUserId: user.id,
              actorEmail: user.email,
              action: "tenant.imported",
              targetType: "tenant",
              targetId: tenantId,
              metadata: {
                sourceTenant: profile.slug ?? null,
                bundleVersion: bundle.version,
                counts: {
                  groups: groups.length,
                  policies: policies.length,
                  applications: applications.length,
                  preRegistrations: preRegistrations.length,
                },
              },
              createdAt: timestamp,
            });

            return { slug };
          }),
        );

        return {
          tenantId,
          slug: result.slug,
          counts: {
            groups: groups.length,
            policies: policies.length,
            applications: applications.length,
            preRegistrations: preRegistrations.length,
          },
          skipped: {
            members: bundle.members?.length ?? 0,
            devices: groups.reduce((total, group) => total + (group.devices?.length ?? 0), 0),
            certificates: bundle.scepCertificates?.length ?? 0,
            auditLog: bundle.auditLog?.length ?? 0,
          },
          applicationsWithoutFiles,
        } satisfies TenantImportResponse;
      }),
    patchTenant: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name?: string;
          slug?: string;
          logo?: string | null;
          displayName?: string | null;
          supportEmail?: string | null;
          brandColor?: string | null;
          metadata?: Record<string, unknown> | null;
        };
        if (body.slug) {
          const claimed = yield* db.query.organization.findFirst({
            where: { slug: body.slug },
          });
          if (claimed && claimed.id !== tenantId)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "That workspace URL is already in use" }),
            );
        }
        const branding = yield* brandingOrFail(body);
        const name = optionalText(body.name);
        if (body.name !== undefined && name === null)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Tenant name cannot be empty" }),
          );
        yield* db
          .update(schema.organization)
          .set({
            ...(name !== undefined && name !== null ? { name } : {}),
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
            ...branding,
            metadata:
              body.metadata === undefined
                ? undefined
                : body.metadata === null
                  ? null
                  : JSON.stringify(body.metadata),
            updatedAt: now(),
          })
          .where(eq(schema.organization.id, tenantId));
        yield* audit(ctx, "tenant.updated", "tenant", tenantId, { fields: Object.keys(body) });
        return ok;
      }),
    deleteTenant: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "delete");
        const count = yield* memberCount(tenantId);
        if (count > 1)
          return yield* Effect.fail(
            new EnterpriseTenantHasMembers({
              message: "Cannot delete a tenant with more than one user",
            }),
          );
        yield* db.delete(schema.organization).where(eq(schema.organization.id, tenantId));
        return ok;
      }),
    getEntraDirectorySync: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        const state = yield* db.query.entraDirectorySync.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        return {
          configured: Boolean(azureGraph && azureClientId),
          enabled: state?.enabled ?? false,
          status: state?.status ?? "idle",
          azureTenantId: config?.azureTenantId ?? null,
          lastSyncedAt: state?.lastSyncedAt ? iso(state.lastSyncedAt) : null,
          lastError: state?.lastError ?? null,
          lastCounts: state?.lastCounts ?? null,
          consentUrl:
            azureGraph && config?.azureTenantId
              ? azureGraph.consentUrl(config.azureTenantId)
              : null,
        };
      }),
    patchEntraDirectorySync: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { enabled?: boolean };
        const existing = yield* db.query.entraDirectorySync.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        const enabled = body.enabled ?? existing?.enabled ?? false;
        if (existing)
          yield* db
            .update(schema.entraDirectorySync)
            .set({ enabled, updatedAt: now() })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
        else
          yield* db.insert(schema.entraDirectorySync).values({
            organizationId: ctx.organization.id,
            enabled,
            status: "idle",
            createdAt: now(),
            updatedAt: now(),
          });
        yield* audit(ctx, "entra.directory_updated", "entra", ctx.organization.id, { enabled });
        return ok;
      }),
    syncEntraDirectory: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        if (!azureGraph)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                "Microsoft Graph is not configured. Set AZURE_CLIENT_ID and AZURE_CLIENT_SECRET and grant admin consent.",
            }),
          );
        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        if (!config?.azureTenantId)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enable Entra ID SSO with a tenant id first." }),
          );
        const state = yield* db.query.entraDirectorySync.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        const lock = yield* acquireEntraSyncLock({
          db,
          organizationId: ctx.organization.id,
        });
        if (!lock.acquired) {
          return yield* Effect.fail(
            new EnterpriseConflict({
              message:
                "A directory sync is already running for this tenant. Wait for it to finish, or retry after the lock becomes stale.",
            }),
          );
        }
        const exit = yield* Effect.exit(
          syncEntraDirectory({
            db,
            graph: azureGraph,
            organizationId: ctx.organization.id,
            azureTenantId: config.azureTenantId,
            autoProvision: config.autoProvision,
            usersDeltaLink: state?.usersDeltaLink,
            groupsDeltaLink: state?.groupsDeltaLink,
            syncUsersAndGroups: true,
            // Persist each resource class's delta cursor as soon as it is
            // complete, so a later failure does not replay the whole tenant.
            onProgress: (progress) =>
              db
                .update(schema.entraDirectorySync)
                .set({
                  ...(progress.usersDelta ? { usersDeltaLink: progress.usersDelta } : {}),
                  ...(progress.groupsDelta ? { groupsDeltaLink: progress.groupsDelta } : {}),
                  lastCounts: {
                    users: progress.users,
                    groups: progress.groups,
                    domains: progress.domains,
                  },
                  updatedAt: now(),
                })
                .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id)),
          }),
        );
        if (Exit.isFailure(exit)) {
          const message = String(exit.cause);
          yield* db
            .update(schema.entraDirectorySync)
            .set({ status: "error", lastError: message.slice(0, 2000), updatedAt: now() })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
          yield* audit(ctx, "entra.sync_failed", "entra", ctx.organization.id, {
            message: message.slice(0, 500),
          });
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: `Directory sync failed: ${message}` }),
          );
        }
        const result = exit.value;
        yield* db
          .update(schema.entraDirectorySync)
          .set({
            status: "idle",
            lastError: null,
            lastSyncedAt: now(),
            ...(result.usersDelta ? { usersDeltaLink: result.usersDelta } : {}),
            ...(result.groupsDelta ? { groupsDeltaLink: result.groupsDelta } : {}),
            lastCounts: {
              users: result.users,
              groups: result.groups,
              domains: result.domains,
            },
            updatedAt: now(),
          })
          .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
        yield* audit(ctx, "entra.sync_completed", "entra", ctx.organization.id, result);
        return {
          status: "ok" as const,
          users: result.users,
          groups: result.groups,
          domains: result.domains,
        };
      }),
    listEntraDomains: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* db
          .select()
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.organizationId, ctx.organization.id));
        return {
          domains: rows.map((row: (typeof rows)[number]) => ({
            domain: row.domain,
            source: row.source,
            isVerified: row.isVerified,
            verifiedAt: row.verifiedAt ? iso(row.verifiedAt) : null,
          })),
        };
      }),
    refreshEntraDomains: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        if (!azureGraph)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Microsoft Graph is not configured." }),
          );
        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        if (!config?.azureTenantId)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enable Entra ID SSO with a tenant id first." }),
          );
        const lock = yield* acquireEntraSyncLock({
          db,
          organizationId: ctx.organization.id,
        });
        if (!lock.acquired) {
          return yield* Effect.fail(
            new EnterpriseConflict({
              message:
                "A directory sync is already running for this tenant. Wait for it to finish, or retry after the lock becomes stale.",
            }),
          );
        }
        const exit = yield* Effect.exit(
          syncEntraDirectory({
            db,
            graph: azureGraph,
            organizationId: ctx.organization.id,
            azureTenantId: config.azureTenantId,
            autoProvision: config.autoProvision,
            syncUsersAndGroups: false,
          }),
        );
        if (Exit.isFailure(exit)) {
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              status: "error",
              lastError: String(exit.cause).slice(0, 2000),
              updatedAt: now(),
            })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `Domain refresh failed: ${String(exit.cause)}`,
            }),
          );
        }
        yield* db
          .update(schema.entraDirectorySync)
          .set({
            status: "idle",
            lastError: null,
            domainsSyncedAt: now(),
            updatedAt: now(),
          })
          .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
        const rows = yield* db
          .select()
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.organizationId, ctx.organization.id));
        yield* audit(ctx, "entra.domains_refreshed", "entra", ctx.organization.id, {
          count: rows.length,
        });
        return {
          domains: rows.map((row: (typeof rows)[number]) => ({
            domain: row.domain,
            source: row.source,
            isVerified: row.isVerified,
            verifiedAt: row.verifiedAt ? iso(row.verifiedAt) : null,
          })),
        };
      }),
    getSsoConfig: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        return {
          enabled: config?.enabled ?? false,
          azureTenantId: config?.azureTenantId ?? null,
          autoProvision: config?.autoProvision ?? true,
        };
      }),
    patchSsoConfig: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          enabled?: boolean;
          azureTenantId?: string | null;
          autoProvision?: boolean;
        };
        const existing = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        const nextAzureTenantId =
          body.azureTenantId === undefined ? (existing?.azureTenantId ?? null) : body.azureTenantId;
        if (nextAzureTenantId) {
          const claimed = yield* db.query.ssoConfig.findFirst({
            where: { azureTenantId: nextAzureTenantId },
          });
          if (claimed && claimed.organizationId !== ctx.organization.id)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "That Entra tenant is already linked to another workspace",
              }),
            );
        }
        const timestamp = now();
        if ((existing?.azureTenantId ?? null) !== nextAzureTenantId) {
          // Delta cursors and imported domains belong to the previous Entra
          // tenant and cannot be reused after a change.
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              usersDeltaLink: null,
              groupsDeltaLink: null,
              status: "idle",
              lastError: null,
              updatedAt: timestamp,
            })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
          yield* db
            .delete(schema.ssoDomain)
            .where(
              and(
                eq(schema.ssoDomain.organizationId, ctx.organization.id),
                eq(schema.ssoDomain.source, "entra"),
              ),
            );
        }
        if (existing) {
          yield* db
            .update(schema.ssoConfig)
            .set({
              ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
              ...(body.azureTenantId !== undefined ? { azureTenantId: body.azureTenantId } : {}),
              ...(body.autoProvision !== undefined ? { autoProvision: body.autoProvision } : {}),
              updatedAt: timestamp,
            })
            .where(eq(schema.ssoConfig.organizationId, ctx.organization.id));
        } else {
          yield* db.insert(schema.ssoConfig).values({
            organizationId: ctx.organization.id,
            enabled: body.enabled ?? false,
            azureTenantId: body.azureTenantId ?? null,
            autoProvision: body.autoProvision ?? true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        yield* audit(ctx, "sso.updated", "sso", ctx.organization.id, {
          fields: Object.keys(body),
        });
        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        return {
          enabled: config?.enabled ?? false,
          azureTenantId: config?.azureTenantId ?? null,
          autoProvision: config?.autoProvision ?? true,
        };
      }),
    listScimTokens: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const rows = yield* db
          .select()
          .from(schema.scimToken)
          .where(eq(schema.scimToken.organizationId, ctx.organization.id));
        return {
          tokens: rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            createdAt: iso(row.createdAt),
            lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
          })),
        };
      }),
    createScimToken: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { name: string };
        const raw = `scim_${bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "")}`;
        const tokenHash = yield* sha256Hex(new TextEncoder().encode(raw).buffer as ArrayBuffer);
        const scimId = id();
        const timestamp = now();
        yield* db.insert(schema.scimToken).values({
          id: scimId,
          organizationId: ctx.organization.id,
          name: body.name,
          tokenHash,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* audit(ctx, "scim.token_created", "scim_token", scimId, { name: body.name });
        return {
          id: scimId,
          name: body.name,
          token: raw,
          baseUrl: `${origin}/scim/v2/${ctx.organization.id}`,
        };
      }),
    revokeScimToken: (request, tenantId, tokenId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* db
          .update(schema.scimToken)
          .set({ revokedAt: now(), updatedAt: now() })
          .where(
            and(
              eq(schema.scimToken.id, tokenId),
              eq(schema.scimToken.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "scim.token_revoked", "scim_token", tokenId);
        return ok;
      }),
    listWebhookEndpoints: (request, tenantId) =>
      Effect.gen(function* () {
        // Delivery health is operationally sensitive, so even the list is
        // owner/admin-only rather than available to read-only members.
        const ctx = yield* requireTenant(request, tenantId, "write");
        const rows = (yield* db
          .select()
          .from(schema.webhookEndpoint)
          .where(eq(schema.webhookEndpoint.organizationId, ctx.organization.id))
          .orderBy(asc(schema.webhookEndpoint.createdAt))) as WebhookEndpointRow[];
        return { endpoints: rows.map(toWebhookEndpointInfo) };
      }),
    createWebhookEndpoint: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          url: string;
          description?: string | null;
          events: ReadonlyArray<string>;
          enabled?: boolean;
        };
        const validated = yield* Effect.try({
          try: () => ({
            url: requireWebhookUrl(body.url),
            description: webhookDescription(body.description),
          }),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Invalid webhook endpoint" }),
        });
        const { endpoint, secret } = yield* insertWebhookEndpoint({
          organizationId: ctx.organization.id,
          url: validated.url,
          description: validated.description,
          events: normalizeWebhookEvents(body.events),
          enabled: body.enabled ?? true,
        });
        yield* audit(ctx, "webhook.created", "webhook_endpoint", endpoint.id, {
          url: endpoint.url,
          events: endpoint.eventFilters ?? [],
        });
        return { endpoint: toWebhookEndpointInfo(endpoint), secret };
      }),
    patchWebhookEndpoint: (request, tenantId, webhookId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          url?: string;
          description?: string | null;
          events?: ReadonlyArray<string>;
          enabled?: boolean;
        };
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        const validated = yield* Effect.try({
          try: () => ({
            url: body.url === undefined ? undefined : requireWebhookUrl(body.url),
            description:
              body.description === undefined ? undefined : webhookDescription(body.description),
          }),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Invalid webhook endpoint" }),
        });
        const update: Record<string, unknown> = { updatedAt: now() };
        if (validated.url !== undefined) update.url = validated.url;
        if (validated.description !== undefined) update.description = validated.description;
        if (body.events !== undefined) update.eventFilters = normalizeWebhookEvents(body.events);
        if (body.enabled !== undefined) update.enabled = body.enabled;
        yield* db
          .update(schema.webhookEndpoint)
          .set(update)
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        const updated = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        yield* audit(ctx, "webhook.updated", "webhook_endpoint", updated.id, {
          fields: Object.keys(update).filter((field) => field !== "updatedAt"),
        });
        return toWebhookEndpointInfo(updated);
      }),
    deleteWebhookEndpoint: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        yield* db
          .delete(schema.webhookEndpoint)
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "webhook.deleted", "webhook_endpoint", existing.id, {
          url: existing.url,
        });
        return ok;
      }),
    rotateWebhookSecret: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        const signingSecret = yield* Effect.try({
          try: () => requireWebhookSigning(),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Webhook signing is not configured" }),
        });
        const secret = generateWebhookSecret();
        const sealed = yield* Effect.tryPromise({
          try: () => sealSecret(signingSecret, secret),
          catch: () =>
            new EnterpriseBadRequest({ message: "Could not encrypt the webhook signing secret" }),
        });
        yield* db
          .update(schema.webhookEndpoint)
          .set({
            secret: sealed,
            secretPrefix: webhookSecretPrefix(secret),
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "webhook.secret_rotated", "webhook_endpoint", existing.id);
        return { secret };
      }),
    testWebhookEndpoint: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        const outcome = yield* sendTestWebhook(db as never, existing, webhookOptions);
        yield* audit(ctx, "webhook.tested", "webhook_endpoint", existing.id, {
          status: outcome.status,
          responseStatus: outcome.responseStatus,
        });
        const response: WebhookTestResponse = {
          status: outcome.status,
          responseStatus: outcome.responseStatus,
          error: outcome.error,
          durationMs: outcome.durationMs,
        };
        return response;
      }),
    listAuditLog: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        // Kept for older dashboard bundles; new callers use `/audit/search`.
        const entries = yield* db
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.organizationId, ctx.organization.id))
          .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
          .limit(200);
        return { entries: entries.map((entry: any) => auditEntry(entry)) };
      }),
    searchAuditLog: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = yield* normalizedAuditFilters(query);
        // Fetch one extra row to detect more pages without a second count.
        const rows = yield* loadAuditEntries(ctx.organization.id, filters, filters.limit + 1);
        const hasMore = rows.length > filters.limit;
        const page = hasMore ? rows.slice(0, filters.limit) : rows;
        let nextCursor: string | null = null;
        if (hasMore && page.length > 0) {
          const last = page[page.length - 1]!;
          nextCursor = filters.offsetPaging
            ? encodeAuditOffsetCursor(filters.offset + filters.limit)
            : encodeAuditCursor({ createdAt: last.createdAt, id: last.id });
        }
        return { entries: page.map((entry: any) => auditEntry(entry)), nextCursor };
      }),
    exportAuditLog: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const format = query.format ?? "csv";
        // Exports always start at the newest matching row; a cursor from an
        // interactive page would silently export only the remainder.
        const filters = {
          ...(yield* normalizedAuditFilters(query)),
          cursor: undefined,
          offset: 0,
        };
        const rows = yield* loadAuditEntries(
          ctx.organization.id,
          filters,
          AUDIT_EXPORT_MAX_ROWS + 1,
        );
        const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
        const entries = (truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows).map(
          (entry: any) => auditEntry(entry),
        );
        return {
          format,
          body: format === "json" ? auditJson(entries) : auditCsv(entries),
          truncated,
          rowCount: entries.length,
        };
      }),
    listTenantUsers: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId);
        const users = yield* db
          .select({
            memberId: schema.member.id,
            userId: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            role: schema.member.role,
            createdAt: schema.member.createdAt,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, tenantId));
        return {
          users: users.map((user: { createdAt: Date }) => ({
            ...user,
            createdAt: iso(user.createdAt),
          })),
        };
      }),
    inviteTenantUser: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const { user } = ctx;
        const body = payload as { email: string; role?: string; resend?: boolean };
        const role = body.role ?? "member";
        if (!validRoles(role))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose a valid workspace role" }),
          );
        if (hasOwnerRole(role) && !hasOwnerRole(ctx.member.role))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only an owner can invite another owner" }),
          );
        const invitationId = id();
        const timestamp = now();
        const rawToken = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "");
        const tokenHash = yield* sha256Hex(
          new TextEncoder().encode(rawToken).buffer as ArrayBuffer,
        );
        yield* db.insert(schema.invitation).values({
          id: invitationId,
          organizationId: tenantId,
          inviterId: user.id,
          email: body.email,
          role,
          status: "pending",
          tokenHash,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const inviteUrl = `${origin}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
        const branding = resolveTenantBranding(ctx.organization);
        const organization = branding.displayName;
        const roleLabel = body.role ?? "member";
        if (email) {
          yield* Effect.tryPromise({
            try: () =>
              email.send({
                to: body.email,
                from: { name: branding.displayName, email: "hello@mattrax.cloud" },
                subject: `You have been invited to ${organization}`,
                text: `You have been invited to join ${organization} as ${roleLabel}.\n\nAccept the invitation by opening this link:\n\n${inviteUrl}\n\nThis link expires in 7 days.\n\nNeed help? Contact ${branding.supportEmail}.`,
                html: `<p>You have been invited to join <strong>${escapeHtml(organization)}</strong> as ${escapeHtml(roleLabel)}.</p><p><a href="${inviteUrl}">Accept the invitation</a></p><p>This link expires in 7 days.</p><p>Need help? Contact <a href="mailto:${escapeHtml(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a>.</p>`,
              }),
            catch: () =>
              new EnterpriseBadRequest({ message: "Could not send the invitation email" }),
          }).pipe(
            Effect.catch((failure) =>
              Effect.logWarning(`Invitation email failed: ${failure.message}; link: ${inviteUrl}`),
            ),
          );
        } else {
          console.log("INVITATION", body.email, inviteUrl);
        }
        yield* audit(ctx, "member.invited", "invitation", invitationId, {
          email: body.email,
          role,
        });
        return { id: invitationId, inviteUrl };
      }),
    acceptInvitation: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const body = payload as { token: string };
        const tokenHash = yield* sha256Hex(
          new TextEncoder().encode(body.token).buffer as ArrayBuffer,
        );
        const invitation = yield* db.query.invitation.findFirst({
          where: { tokenHash },
        });
        if (!invitation || invitation.status !== "pending")
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Invitation not found or already used" }),
          );
        if (invitation.expiresAt <= now())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Invitation expired" }));
        if (invitation.email.toLowerCase() !== user.email.toLowerCase())
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Sign in with the email address this invitation was sent to",
            }),
          );
        const existing = yield* db.query.member.findFirst({
          where: { userId: user.id, organizationId: invitation.organizationId },
        });
        if (!existing) {
          yield* db.insert(schema.member).values({
            id: id(),
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role ?? "member",
            createdAt: now(),
            updatedAt: now(),
          });
        }
        yield* db
          .update(schema.invitation)
          .set({ status: "accepted", updatedAt: now() })
          .where(eq(schema.invitation.id, invitation.id));
        yield* audit(
          { user, organization: { id: invitation.organizationId } },
          "member.joined",
          "user",
          user.id,
          { invitationId: invitation.id, role: invitation.role ?? "member" },
        );
        return { tenantId: invitation.organizationId };
      }),
    listTenantInvitations: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        const invitations = yield* db
          .select()
          .from(schema.invitation)
          .where(eq(schema.invitation.organizationId, tenantId));
        return {
          invitations: invitations.map(
            (item: {
              id: string;
              email: string;
              role: string | null;
              status: string;
              expiresAt: Date;
              createdAt: Date;
            }) => ({
              id: item.id,
              email: item.email,
              role: item.role,
              status: item.status,
              expiresAt: iso(item.expiresAt),
              createdAt: iso(item.createdAt),
            }),
          ),
        };
      }),
    cancelTenantInvitation: (request, tenantId, invitationId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        const invitation = yield* db.query.invitation.findFirst({
          where: { id: invitationId, organizationId: tenantId },
        });
        if (!invitation)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Invitation not found" }));
        yield* db
          .update(schema.invitation)
          .set({ status: "canceled", updatedAt: now() })
          .where(eq(schema.invitation.id, invitationId));
        return ok;
      }),
    patchTenantUser: (request, tenantId, memberId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const member = yield* db.query.member.findFirst({
          where: { id: memberId, organizationId: tenantId },
        });
        if (!member)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));
        const body = payload as { role: string };
        if (!validRoles(body.role))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose a valid workspace role" }),
          );
        if (
          (hasOwnerRole(body.role) || hasOwnerRole(member.role)) &&
          !hasOwnerRole(ctx.member.role)
        )
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only an owner can change owner roles" }),
          );
        const removingOwner = hasOwnerRole(member.role) && !hasOwnerRole(body.role);
        if (removingOwner && (yield* ownerCount(tenantId)) <= 1)
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Cannot remove the last tenant owner" }),
          );
        yield* db
          .update(schema.member)
          .set({ role: body.role, updatedAt: now() })
          .where(eq(schema.member.id, memberId));
        yield* audit(ctx, "member.role_changed", "user", member.userId, {
          memberId,
          role: body.role,
        });
        return ok;
      }),
    removeTenantUser: (request, tenantId, memberId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const count = yield* memberCount(tenantId);
        if (count <= 1)
          return yield* Effect.fail(
            new EnterpriseLastTenantUser({
              message: "Cannot remove the last tenant user; delete the tenant instead",
            }),
          );
        const member = yield* db.query.member.findFirst({
          where: { id: memberId, organizationId: tenantId },
        });
        if (!member)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));
        if (member.role.split(",").includes("owner") && (yield* ownerCount(tenantId)) <= 1)
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Cannot remove the last tenant owner" }),
          );
        yield* db.delete(schema.member).where(eq(schema.member.id, memberId));
        yield* audit(ctx, "member.removed", "user", member.userId, { memberId });
        return ok;
      }),
    getEnrollment: (
      enrollmentId,
      code,
      options?: {
        readonly platform?: string | null;
        readonly ip?: string | null;
        readonly userAgent?: string | null;
      },
    ) =>
      Effect.gen(function* () {
        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { id: enrollmentId },
        });
        if (!enrollment)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));
        const organization = yield* db.query.organization.findFirst({
          where: { id: enrollment.organizationId },
        });
        if (!organization)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));
        const branding = resolveTenantBranding(organization);

        const platform = detectEnrollmentPlatform(options?.userAgent, options?.platform);
        const record = (outcome: EnrollmentAttemptOutcome, detail: string): Effect.Effect<void> =>
          recordEnrollmentAttempt({
            organizationId: organization.id,
            enrollmentId: enrollment.id,
            platform,
            outcome,
            detail,
            ip: options?.ip,
            userAgent: options?.userAgent,
          });

        if (enrollment.code && enrollment.code !== code) {
          yield* record("bad_code", "The enrollment password did not match");
          return { name: organization.name, branding, authenticated: false as const };
        }

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: organization.id },
        });
        const [deviceCount] = yield* db
          .select({ value: count() })
          .from(schema.device)
          .where(eq(schema.device.organizationId, organization.id));
        const enabled = canEnrollDevice(deviceCount?.value ?? 0, enrollment.maxDevices);

        // Only create a SCEP challenge when the Apple branch is actually
        // usable. A failure is reported as a platform error instead of failing
        // the whole enrollment page, and is recorded for administrators.
        let challenge: string | null = null;
        let appleScepFailed = false;
        if (enabled && enrollment.enabledApple && apns?.topic) {
          challenge = yield* Effect.tryPromise({
            try: () =>
              createScepChallenge(enrollment.id, authSecret ?? "", {
                // Enrollment profiles are shareable links; allow a week before
                // the challenge goes stale, without a schema migration.
                ttlSeconds: 7 * 24 * 60 * 60,
              }),
            catch: (cause) =>
              new EnterpriseBadRequest({ message: "Could not create the SCEP challenge" }),
          }).pipe(
            Effect.match({
              onFailure: () => {
                appleScepFailed = true;
                return null;
              },
              onSuccess: (value: string) => value,
            }),
          );
        }

        const evaluation = evaluateEnrollmentAttempt({
          platform,
          limitReached: !enabled,
          appleEnabled: enrollment.enabledApple,
          windowsEnabled: enrollment.enabledWindows,
          androidEnabled: enrollment.enabledAndroid,
          apnsConfigured: Boolean(apns?.topic),
          appleScepFailed,
        });
        yield* record(evaluation.outcome, evaluation.detail);

        // Windows discovery has no built-in tenant identity, so bind the tenant
        // into a short-lived signed token that travels in the discovery URL and
        // is preserved through policy/enroll. This replaces the old
        // deployment-wide pin for Cloud. Regenerated on every page load.
        const windowsToken =
          enabled && enrollment.enabledWindows && authSecret
            ? yield* Effect.tryPromise({
                try: () => createWindowsTenantToken(organization.id, authSecret),
                catch: () =>
                  new EnterpriseBadRequest({
                    message: "Could not create the Windows enrollment link",
                  }),
              }).pipe(Effect.catch(() => Effect.succeed(null)))
            : null;
        const windowsExpiry = windowsToken ? windowsTenantTokenExpiresAt(windowsToken) : null;

        return {
          name: organization.name,
          branding,
          authenticated: true as const,
          apple:
            !enabled || !enrollment.enabledApple
              ? { error: "Apple enrollment is disabled! Contact your administrator." }
              : !apns?.topic
                ? { error: "Apple management is not configured! Contact your administrator." }
                : appleScepFailed || !challenge
                  ? {
                      error:
                        "Apple enrollment is temporarily unavailable! Contact your administrator.",
                    }
                  : {
                      profile: yield* serializePlist(
                        enterpriseEnrollmentProfile({
                          origin,
                          topic: apns.topic,
                          organizationId: organization.id,
                          organizationName: branding.displayName,
                          supportEmail: branding.supportEmail,
                          challenge,
                        }),
                      ),
                    },
          windows:
            !enabled || !enrollment.enabledWindows
              ? { error: "Windows enrollment is disabled! Contact your administrator." }
              : !windowsToken
                ? {
                    error:
                      "Windows enrollment is temporarily unavailable! Contact your administrator.",
                  }
                : {
                    discoveryUrl: `${origin}/mdm/windows/discovery?tenant=${encodeURIComponent(windowsToken)}`,
                    tenantScoped: true as const,
                    ...(windowsExpiry ? { expiresAt: windowsExpiry.toISOString() } : {}),
                  },
          android:
            !enabled || !enrollment.enabledAndroid
              ? { error: "Android enrollment is disabled! Contact your administrator." }
              : "unavailable",
          assetTag: enabled && enrollment.enabledAssetTag,
        };
      }),
    getAppleEnrollmentProfile: (
      enrollmentId,
      code,
      options?: {
        readonly platform?: string | null;
        readonly ip?: string | null;
        readonly userAgent?: string | null;
      },
    ) =>
      Effect.gen(function* () {
        if (!allowAppleProfileRequest(options?.ip))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Too many profile downloads. Wait a minute and scan the QR code again.",
            }),
          );

        const result = (yield* service.getEnrollment(enrollmentId, code, {
          platform: options?.platform ?? "apple",
          ip: options?.ip ?? null,
          userAgent: options?.userAgent ?? null,
        })) as
          | { name: string; authenticated: false }
          | {
              name: string;
              authenticated: true;
              apple: { error: string } | { profile: string };
            };

        if (!result.authenticated)
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "The enrollment password is invalid." }),
          );
        if ("error" in result.apple)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: result.apple.error }));
        if (!("profile" in result.apple))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Apple enrollment is temporarily unavailable! Contact your administrator.",
            }),
          );

        // The profile endpoint is public, so resolve the tenant's display name
        // from the enrollment row rather than trusting a caller-supplied value.
        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { id: enrollmentId },
        });
        const organization = enrollment
          ? yield* db.query.organization.findFirst({ where: { id: enrollment.organizationId } })
          : undefined;
        const filename = `${safeFilename(
          organization?.slug ??
            resolveTenantBranding(organization ?? { name: "tenant" }).displayName,
        )}-enrollment.mobileconfig`;

        return { plist: result.apple.profile, filename };
      }),
    getTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const enrollment = yield* getOrCreateEnrollment(ctx.organization.id);
        const windowsToken =
          enrollment.enabledWindows && authSecret
            ? yield* Effect.tryPromise({
                try: () => createWindowsTenantToken(ctx.organization.id, authSecret),
                catch: () =>
                  new EnterpriseBadRequest({
                    message: "Could not create the Windows enrollment link",
                  }),
              }).pipe(Effect.catch(() => Effect.succeed(null)))
            : null;
        const windowsExpiry = windowsToken ? windowsTenantTokenExpiresAt(windowsToken) : null;
        return {
          ...rowEnrollment(enrollment),
          ...(windowsToken
            ? {
                windowsDiscoveryUrl: `${origin}/mdm/windows/discovery?tenant=${encodeURIComponent(windowsToken)}`,
                ...(windowsExpiry
                  ? { windowsDiscoveryExpiresAt: windowsExpiry.toISOString() }
                  : {}),
              }
            : {}),
        };
      }),
    listEnrollmentAttempts: (request, tenantId, query = {}) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const requested = Number((query as { limit?: unknown }).limit ?? 50);
        const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 200);
        const attempts = yield* db
          .select()
          .from(schema.enrollmentAttempt)
          .where(eq(schema.enrollmentAttempt.organizationId, ctx.organization.id))
          .orderBy(desc(schema.enrollmentAttempt.createdAt))
          .limit(limit);
        return {
          attempts: attempts.map((attempt: any) => ({
            id: attempt.id,
            enrollmentId: attempt.enrollmentId,
            platform: attempt.platform,
            outcome: attempt.outcome,
            detail: attempt.detail,
            createdAt: iso(attempt.createdAt),
          })),
        };
      }),
    patchTenantEnrollment: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* getOrCreateEnrollment(ctx.organization.id);
        const body = payload as {
          code?: string | null;
          enabledApple?: boolean;
          enabledWindows?: boolean;
          enabledAndroid?: boolean;
          enabledAssetTag?: boolean;
          maxDevices?: number;
        };
        yield* db
          .update(schema.enterpriseEnrollment)
          .set({
            ...(body.code !== undefined ? { code: body.code } : {}),
            ...(body.enabledApple !== undefined ? { enabledApple: body.enabledApple } : {}),
            ...(body.enabledWindows !== undefined ? { enabledWindows: body.enabledWindows } : {}),
            ...(body.enabledAndroid !== undefined ? { enabledAndroid: body.enabledAndroid } : {}),
            ...(body.enabledAssetTag !== undefined
              ? { enabledAssetTag: body.enabledAssetTag }
              : {}),
            ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
            updatedAt: now(),
          })
          .where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
        yield* audit(ctx, "enrollment.updated", "enrollment", null, {
          fields: Object.keys(body),
        });
        return ok;
      }),
    resetTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* getOrCreateEnrollment(ctx.organization.id);
        const newId = id();
        yield* db
          .update(schema.enterpriseEnrollment)
          .set({ id: newId, updatedAt: now() })
          .where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
        yield* audit(ctx, "enrollment.reset", "enrollment", newId);
        return { id: newId };
      }),
    getApns: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        let expiresAt: string | null = null;
        let commonName: string | null = null;
        if (apns) {
          try {
            const parsed = parseApnsCertificate(apns.certPem);
            expiresAt = parsed.notAfter.toISOString();
            commonName = parsed.commonName;
          } catch {
            // A historical certificate may be unparseable; still report it as configured.
          }
        }
        return {
          configured: apns !== undefined,
          email: apns?.email ?? null,
          topic: apns?.topic ?? null,
          expiresAt,
          commonName,
        };
      }),
    getApnsCsr: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const key = yield* loadApnsKey(ctx.organization.id);
        const keyPair = yield* Effect.tryPromise({
          try: async () => {
            const privateKey = await importApnsKeyJwk(key.jwk);
            // WebCrypto cannot derive the public key from a private JWK, but the
            // JWK contains the public parameters; derive a key pair by importing
            // both halves.
            const publicKey = await crypto.subtle.importKey(
              "jwk",
              { kty: key.jwk.kty, n: key.jwk.n, e: key.jwk.e, ext: true },
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              true,
              ["verify"],
            );
            return { privateKey, publicKey } as CryptoKeyPair;
          },
          catch: (cause) =>
            new EnterpriseBadRequest({ message: "Could not load the pending APNs key" }),
        });
        const result = yield* Effect.tryPromise({
          try: () =>
            buildApnsCsr({
              keyPair,
              subject: {
                organization: ctx.organization.name,
                organizationalUnit: ctx.organization.id,
              },
              vendor: remoteApnsVendor(),
            }),
          catch: (cause) =>
            new EnterpriseBadRequest({ message: "Could not generate the APNs CSR" }),
        });
        return { plist: result.plist };
      }),
    uploadApns: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { email: string; cert: string };

        // Find the private key this certificate should correspond to. A pending
        // CSR key is the normal case; an existing certificate key covers renewals.
        const pending = yield* db.query.applePushKey.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        const existing = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        let encryptedKey: string | undefined;
        if (authSecret && (pending || existing?.encryptedKey)) {
          const encrypted = pending?.encryptedPrivateKeyJwk ?? existing?.encryptedKey;
          if (encrypted) {
            const jwk = JSON.parse(
              yield* Effect.tryPromise({
                try: () => openSecret(authSecret, encrypted),
                catch: (cause) =>
                  new EnterpriseBadRequest({ message: "Could not read the pending APNs key" }),
              }),
            ) as JsonWebKey;
            const privateKey = yield* Effect.tryPromise({
              try: () => importApnsKeyJwk(jwk),
              catch: (cause) =>
                new EnterpriseBadRequest({ message: "Could not import the pending APNs key" }),
            });
            yield* Effect.tryPromise({
              try: () => validateApnsCertificate(body.cert, { privateKey }),
              catch: (cause) =>
                new EnterpriseBadRequest({
                  message: cause instanceof Error ? cause.message : "Invalid APNs certificate",
                }),
            });
            // Re-seal at rest even though the underlying key is unchanged.
            encryptedKey = yield* Effect.tryPromise({
              try: () => sealSecret(authSecret, JSON.stringify(jwk)),
              catch: (cause) =>
                new EnterpriseBadRequest({ message: "Could not seal the APNs key" }),
            });
          }
        }

        const parsed = yield* Effect.tryPromise({
          try: () => validateApnsCertificate(body.cert),
          catch: (cause) =>
            new EnterpriseBadRequest({
              message: cause instanceof Error ? cause.message : "Invalid APNs certificate",
            }),
        });

        const value = {
          organizationId: ctx.organization.id,
          email: body.email,
          certPem: body.cert,
          topic: parsed.topic,
          updatedAt: now(),
        };
        yield* db
          .insert(schema.applePushCertificate)
          .values({ ...value, encryptedKey: encryptedKey ?? null })
          .onDuplicateKeyUpdate({
            set: {
              email: value.email,
              certPem: value.certPem,
              topic: value.topic,
              updatedAt: value.updatedAt,
              ...(encryptedKey ? { encryptedKey } : {}),
            },
          });
        if (pending)
          yield* db
            .delete(schema.applePushKey)
            .where(eq(schema.applePushKey.organizationId, ctx.organization.id));
        yield* audit(ctx, "apns.certificate_uploaded", "apns", ctx.organization.id, {
          email: body.email,
        });
        return ok;
      }),
    deleteDevices: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        // Resolve the rows first: revocation also has to match certificates
        // recorded against the legacy `dmIdentifier`, not just the row id.
        const devices = ids.length
          ? ((yield* db
              .select()
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(schema.device.id, [...ids]),
                ),
              )) as Array<EnterpriseDevice>)
          : [];
        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, devices);
        if (ids.length > 0)
          yield* db
            .delete(schema.device)
            .where(
              and(
                eq(schema.device.organizationId, ctx.organization.id),
                inArray(schema.device.id, [...ids]),
              ),
            );
        yield* audit(ctx, "device.deleted", "device", null, {
          ids: [...ids],
          revokedCertificates: revoked,
        });
        return ok;
      }),
    listDevicePreRegistrations: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = (yield* db
          .select()
          .from(schema.devicePreRegistration)
          .where(eq(schema.devicePreRegistration.organizationId, ctx.organization.id))
          .orderBy(desc(schema.devicePreRegistration.createdAt))) as Array<
          typeof schema.devicePreRegistration.$inferSelect
        >;
        const groups = (yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(
            eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
          )) as Array<EnterpriseGroup>;
        const groupNames = new Map(groups.map((group) => [group.id, group.name]));
        return {
          rows: rows.map((row) =>
            rowPreRegistration(row, row.groupId ? (groupNames.get(row.groupId) ?? null) : null),
          ),
        };
      }),
    importDevicePreRegistrations: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { rows?: ReadonlyArray<DevicePreRegistrationImportRow> };
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (rows.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Add at least one device row to import." }),
          );
        if (rows.length > 1000)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Import at most 1000 devices at a time." }),
          );

        const groups = (yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(
            eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
          )) as Array<EnterpriseGroup>;
        const groupsById = new Map(groups.map((group) => [group.id, group]));
        const groupsByName = new Map<string, Array<EnterpriseGroup>>();
        for (const group of groups) {
          const key = group.name.trim().toLowerCase();
          groupsByName.set(key, [...(groupsByName.get(key) ?? []), group]);
        }

        const text = (value: string | null | undefined, previous: string | null, max: number) => {
          if (value === undefined) return previous;
          if (value === null) return null;
          const trimmed = value.trim();
          return trimmed ? trimmed.slice(0, max) : null;
        };

        const results: Array<NonNullable<DevicePreRegistrationImportResponse["results"][number]>> =
          [];

        for (const row of rows) {
          const result = yield* Effect.gen(function* () {
            const serial = typeof row.serial === "string" ? row.serial.trim().slice(0, 255) : "";
            if (!serial)
              return {
                serial: typeof row.serial === "string" ? row.serial : "",
                status: "error" as const,
                error: "Serial is required.",
              };

            const existing = (yield* db.query.devicePreRegistration.findFirst({
              where: { organizationId: ctx.organization.id, serial },
            })) as typeof schema.devicePreRegistration.$inferSelect | undefined;

            let groupId = existing?.groupId ?? null;
            const wantsGroup = row.groupId !== undefined || row.groupName !== undefined;
            if (wantsGroup) {
              const requestedId = row.groupId?.trim() || "";
              const requestedName = row.groupName?.trim() || "";
              if (requestedId) {
                if (!groupsById.has(requestedId))
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group ${requestedId} does not belong to this tenant.`,
                  };
                groupId = requestedId;
              } else if (requestedName) {
                const matches = groupsByName.get(requestedName.toLowerCase()) ?? [];
                if (matches.length === 0)
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group "${requestedName}" was not found in this tenant.`,
                  };
                if (matches.length > 1)
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group name "${requestedName}" is ambiguous; import a group id instead.`,
                  };
                groupId = matches[0]!.id;
              } else {
                groupId = null;
              }
            }

            const timestamp = now();
            if (existing) {
              yield* db
                .update(schema.devicePreRegistration)
                .set({
                  name: text(row.name, existing.name, 255),
                  assetTag: text(row.assetTag, existing.assetTag, 255),
                  notes: text(row.notes, existing.notes, 10_000),
                  groupId,
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(schema.devicePreRegistration.id, existing.id),
                    eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
                  ),
                );
              return { serial, status: "updated" as const, id: existing.id };
            }

            const registrationId = id();
            yield* db.insert(schema.devicePreRegistration).values({
              id: registrationId,
              organizationId: ctx.organization.id,
              serial,
              name: text(row.name, null, 255),
              assetTag: text(row.assetTag, null, 255),
              notes: text(row.notes, null, 10_000),
              groupId,
              consumedDeviceId: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            return { serial, status: "created" as const, id: registrationId };
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                serial:
                  typeof row.serial === "string" && row.serial.trim() ? row.serial : "(missing)",
                status: "error" as const,
                error:
                  typeof error === "object" && error !== null && "message" in error
                    ? String((error as { message: unknown }).message)
                    : "Could not import this row.",
              }),
            ),
          );
          results.push(result);
        }

        const created = results.filter((result) => result.status === "created").length;
        const updated = results.filter((result) => result.status === "updated").length;
        const failed = results.length - created - updated;
        yield* audit(ctx, "device_pre_registration.imported", "device_pre_registration", null, {
          rows: results.length,
          created,
          updated,
          failed,
        });
        return { results, created, updated, failed };
      }),
    deleteDevicePreRegistration: (request, tenantId, registrationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const row = yield* db.query.devicePreRegistration.findFirst({
          where: { id: registrationId, organizationId: ctx.organization.id },
        });
        if (!row)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Pre-registered device not found" }),
          );
        yield* db
          .delete(schema.devicePreRegistration)
          .where(
            and(
              eq(schema.devicePreRegistration.id, registrationId),
              eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(
          ctx,
          "device_pre_registration.deleted",
          "device_pre_registration",
          registrationId,
          {
            serial: row.serial,
          },
        );
        return ok;
      }),
    deleteDevicePreRegistrations: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        if (ids.length > 0)
          yield* db
            .delete(schema.devicePreRegistration)
            .where(
              and(
                eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
                inArray(schema.devicePreRegistration.id, [...ids]),
              ),
            );
        yield* audit(ctx, "device_pre_registration.deleted", "device_pre_registration", null, {
          ids: [...ids],
        });
        return ok;
      }),
    patchDevice: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { name?: string; notes?: string | null; assetTag?: string | null };
        yield* db
          .update(schema.device)
          .set({ name: body.name, notes: body.notes, assetTag: body.assetTag })
          .where(
            and(
              eq(schema.device.id, deviceId),
              eq(schema.device.organizationId, ctx.organization.id),
            ),
          );
        yield* syncDynamicGroupsForDevice(db, ctx.organization.id, deviceId, { now: now() });
        yield* audit(ctx, "device.updated", "device", deviceId, { fields: Object.keys(body) });
        return ok;
      }),
    deviceAction: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const body = (payload ?? {}) as {
          action?: string;
          manifestUrl?: string;
          iTunesStoreId?: number;
        };
        const action = body.action ?? "sync";
        let lockPin: string | undefined;
        if (device.status === "enrolled") {
          if (action !== "sync") {
            const windowsCommand =
              device.proto === "win" && (action === "wipe" || action === "restart");
            if (device.proto !== "apple" && !windowsCommand)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message:
                    device.proto === "win"
                      ? "Windows supports remote erase and restart"
                      : "Remote commands are only supported for Apple and Windows devices",
                }),
              );
            const commandId = crypto.randomUUID();
            const timestamp = now();
            const randomPin = String(Math.floor(100000 + Math.random() * 900000));
            const request = (() => {
              if (device.proto === "win") {
                if (action === "wipe")
                  return {
                    requestType: "WindowsWipe",
                    payload: { locURI: "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected" },
                  };
                if (action === "restart")
                  return {
                    requestType: "WindowsReboot",
                    payload: { locURI: "./Device/Vendor/MSFT/Reboot/RebootNow" },
                  };
                return null;
              }
              switch (action) {
                case "lock":
                  lockPin = randomPin;
                  return { requestType: "DeviceLock", payload: { PIN: randomPin } };
                case "wipe":
                  return {
                    requestType: "EraseDevice",
                    payload: { PIN: randomPin, ObliterationBehavior: "Default" },
                  };
                case "restart":
                  return { requestType: "RestartDevice", payload: {} };
                case "shutdown":
                  return { requestType: "ShutdownDevice", payload: {} };
                case "clear-passcode":
                  return { requestType: "ClearPasscode", payload: { UnlockToken: "__STORED__" } };
                case "collect-security-info":
                  // SecurityInfo takes no query payload; the response always
                  // carries FileVault and bootstrap-token escrow state.
                  return { requestType: "SecurityInfo", payload: {} };
                case "refresh-applications":
                  return {
                    requestType: "InstalledApplicationList",
                    payload: {
                      // Request the fields the inventory table persists. The
                      // identifier is always included by the device.
                      Items: [
                        "Identifier",
                        "Name",
                        "Version",
                        "ShortVersion",
                        "BundleSize",
                        "DynamicSize",
                        "HasUpdateAvailable",
                      ],
                      ManagedAppsOnly: false,
                    },
                  };
                case "install-app":
                  if (body.manifestUrl)
                    return {
                      requestType: "InstallApplication",
                      payload: {
                        ManifestURL: body.manifestUrl,
                        ManagementFlags: 1,
                        InstallAsManaged: true,
                        Options: { PurchaseMethod: 1 },
                      },
                    };
                  if (body.iTunesStoreId)
                    return {
                      requestType: "InstallApplication",
                      payload: {
                        iTunesStoreID: body.iTunesStoreId,
                        ManagementFlags: 1,
                        InstallAsManaged: true,
                        Options: { PurchaseMethod: 1 },
                      },
                    };
                  return null;
                default:
                  return null;
              }
            })();
            if (!request)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message:
                    action === "install-app"
                      ? "Provide a manifest URL or iTunes Store ID to install an app"
                      : "Unknown device action",
                }),
              );
            if (action === "clear-passcode") {
              const [apple] = yield* db
                .select({ unlockToken: schema.deviceApple.unlockToken })
                .from(schema.deviceApple)
                .where(eq(schema.deviceApple.deviceId, device.id))
                .limit(1);
              if (!apple?.unlockToken)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message: "This device has not provided an unlock token",
                  }),
                );
              request.payload = { UnlockToken: apple.unlockToken };
            }
            yield* db.insert(schema.deviceCommand).values({
              id: commandId,
              organizationId: ctx.organization.id,
              deviceId: device.id,
              requestType: request.requestType,
              payload: request.payload,
              status: "queued",
              resultStatus: null,
              resultDetail: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
          yield* applePush.pushAppleDevice(device.id);
        }
        yield* audit(ctx, "device.action", "device", deviceId, { action });
        return lockPin ? { ...ok, pin: lockPin } : ok;
      }),
    listDeviceCommands: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const commands = yield* db
          .select()
          .from(schema.deviceCommand)
          .where(eq(schema.deviceCommand.deviceId, device.id))
          .orderBy(desc(schema.deviceCommand.createdAt))
          .limit(200);
        return {
          commands: commands.map((command: any) => ({
            id: command.id,
            requestType: command.requestType,
            status: command.status,
            resultStatus: command.resultStatus,
            resultDetail: command.resultDetail,
            createdAt: iso(command.createdAt),
            updatedAt: iso(command.updatedAt),
          })),
        };
      }),
    listDeviceDeclarations: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const declarations = yield* deviceDeclarationsFor(device.id);
        return { declarations: declarations.map(rowDeclaration) };
      }),
    deviceUnenroll: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        if (device.proto !== "apple")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Remote unenroll is only available for Apple devices today.",
            }),
          );
        if (device.status === "enrolled")
          yield* db
            .update(schema.device)
            .set({ status: "unenrolling" })
            .where(
              and(
                eq(schema.device.id, deviceId),
                eq(schema.device.organizationId, ctx.organization.id),
                eq(schema.device.status, "enrolled"),
              ),
            );
        // mttx pushes both enrolled and already-unenrolling devices so repeated
        // requests still nudge the device.
        if (device.status === "enrolled" || device.status === "unenrolling")
          yield* applePush.pushAppleDevice(device.id, true);
        // Retiring a device must also invalidate its SCEP identity, otherwise a
        // stolen certificate could renew forever. Windows certificates and
        // Apple certificates bound at check-in are keyed by the internal device
        // id, so this covers both platforms.
        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, [device]);
        yield* audit(ctx, "device.unenrolled", "device", deviceId, {
          revokedCertificates: revoked,
        });
        return ok;
      }),
    getDeviceHealth: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const declarations = yield* deviceDeclarationsFor(device.id);
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);
        const apple =
          device.proto === "apple"
            ? yield* db.query.deviceApple.findFirst({ where: { deviceId: device.id } })
            : undefined;
        return {
          health: normalizeDeviceHealth(rowDeviceHealth(device, declarations)),
          declarations: declarations.map(rowDeclaration),
          certificates: certificates.map(rowCertificate),
          push: rowPushInfo(apple),
        };
      }),
    getDeviceActivity: (request, tenantId, deviceId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const limit = normalizeDeviceActivityLimit(query?.limit);
        const audits = yield* db
          .select()
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.organizationId, ctx.organization.id),
              eq(schema.auditLog.targetType, "device"),
              eq(schema.auditLog.targetId, device.id),
            ),
          )
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(limit);
        const commands = yield* db
          .select()
          .from(schema.deviceCommand)
          .where(eq(schema.deviceCommand.deviceId, device.id))
          .orderBy(desc(schema.deviceCommand.updatedAt))
          .limit(limit);
        const declarations = yield* deviceDeclarationsFor(device.id);
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);
        return {
          events: buildDeviceActivity(
            {
              audits: audits as any,
              commands: commands as any,
              declarations: declarations as any,
              certificates: certificates as any,
              device: {
                enrolledAt: device.enrolledAt,
                lastSeenAt: device.lastSeenAt,
                inventoryUpdatedAt: device.inventoryUpdatedAt,
              },
            },
            limit,
          ),
        };
      }),
    getDeviceHealthSummary: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const devices = yield* db
          .select()
          .from(schema.device)
          .where(eq(schema.device.organizationId, ctx.organization.id));
        const deviceIds = devices.map((device: EnterpriseDevice) => device.id);
        const declarations = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceDeclaration)
              .where(inArray(schema.deviceDeclaration.deviceId, deviceIds))
          : [];
        const byDevice = new Map<string, Array<any>>();
        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }
        const summaries = devices.map((device: EnterpriseDevice) =>
          rowDeviceHealth(device, byDevice.get(device.id) ?? []),
        );
        return { counts: countDeviceHealth(summaries) };
      }),
    getDevicePushHealth: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const devices = yield* db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, ctx.organization.id),
              eq(schema.device.proto, "apple"),
            ),
          );
        // Pushes are only attempted for live devices, so retiring devices do
        // not drag the tenant rollup into a failing state forever.
        const eligible = devices.filter(
          (device: EnterpriseDevice) =>
            device.status === "enrolled" || device.status === "unenrolling",
        );
        const deviceIds = eligible.map((device: EnterpriseDevice) => device.id);
        const appleRows = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceApple)
              .where(inArray(schema.deviceApple.deviceId, deviceIds))
          : [];
        const names = new Map(eligible.map((device: EnterpriseDevice) => [device.id, device.name]));
        const recentFailures = appleRows
          .filter((row: any) => (row.consecutivePushFailures ?? 0) > 0 && row.lastPushAt)
          .map((row: any) => ({
            deviceId: row.deviceId,
            deviceName: names.get(row.deviceId) ?? row.deviceId,
            at: iso(row.lastPushAt)!,
            error: row.lastPushError ?? null,
            errorCode: row.lastPushErrorCode ?? null,
            consecutiveFailures: row.consecutivePushFailures ?? 0,
          }))
          .sort((left: { at: string }, right: { at: string }) => right.at.localeCompare(left.at))
          .slice(0, 5);
        return { counts: summarizeApplePushHealth(appleRows), recentFailures };
      }),
    getCredentialHealth: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        return yield* loadCredentialHealth(db, ctx.organization.id, now());
      }),
    revokeDeviceIdentity: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);
        if (certificates.length === 0)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "No issued identity certificates are recorded for this device.",
            }),
          );
        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, [device]);
        yield* audit(ctx, "device.identity_revoked", "device", device.id, {
          revokedCertificates: revoked,
        });
        return { status: "ok" as const, revoked };
      }),
    createGroup: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name: string;
          notes?: string | null;
          kind?: "manual" | "dynamic";
          rules?: DynamicGroupRules | null;
          devices?: Array<string>;
          policies?: Array<string>;
        };
        const kind = body.kind ?? "manual";
        const rules = kind === "dynamic" ? (body.rules ?? null) : null;
        if (kind === "dynamic") {
          const problem = dynamicGroupRulesProblem(rules);
          if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));
          if (body.devices?.length)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Dynamic groups derive device membership from rules",
              }),
            );
        } else if (body.rules != null) {
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Manual groups do not accept membership rules" }),
          );
        }
        yield* assertTenantDevices(ctx.organization.id, body.devices ?? []);
        yield* assertTenantPolicies(ctx.organization.id, body.policies ?? []);
        const groupId = id();
        yield* db.insert(schema.enterpriseGroup).values({
          id: groupId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          kind,
          rules,
          lastEvaluatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
        if (body.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(
              body.devices.map((deviceId) => ({ groupId, deviceId, source: "manual" as const })),
            );
        if (body.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .ignore()
            .values(body.policies.map((policyId) => ({ groupId, policyId })));
        if (kind === "dynamic")
          yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });
        yield* audit(ctx, "group.created", "group", groupId, {
          name: body.name,
          kind,
          devices: body.devices?.length ?? 0,
          policies: body.policies?.length ?? 0,
        });
        return { id: groupId };
      }),
    deleteGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const results = yield* Effect.forEach(
          [...(ids as ReadonlyArray<string>)],
          (groupId) =>
            Effect.gen(function* () {
              // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped
              // row first, then delete it by the same predicate.
              const existing = yield* db.query.enterpriseGroup.findFirst({
                where: { id: groupId, organizationId: ctx.organization.id },
              });
              if (!existing) return { id: groupId, deleted: false as const, reason: "notFound" };
              const devices = yield* applePush.deviceIdsInGroups([groupId]);
              yield* db
                .delete(schema.enterpriseGroup)
                .where(
                  and(
                    eq(schema.enterpriseGroup.id, groupId),
                    eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
                  ),
                );
              return { id: groupId, deleted: true as const, devices };
            }),
          { concurrency: 10 },
        );
        const deleted = results.filter((row) => row.deleted).map((row) => row.id);
        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));
        const affectedDevices = results.flatMap((row) => (row.deleted ? row.devices : []));
        // Devices in a deleted group lose policies and must re-sync.
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "group.deleted", "group", null, { ids: [...deleted] });
        return { deleted, failed };
      }),
    patchGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* assertTenantGroup(ctx.organization.id, groupId);
        const body = payload as {
          name?: string;
          notes?: string | null;
          kind?: "manual" | "dynamic";
          rules?: DynamicGroupRules | null;
        };
        const kind = body.kind ?? existing.kind ?? "manual";
        const rules =
          kind === "dynamic"
            ? body.rules !== undefined
              ? body.rules
              : ((existing.rules as DynamicGroupRules | null | undefined) ?? null)
            : null;
        if (kind === "dynamic") {
          const problem = dynamicGroupRulesProblem(rules);
          if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));
        } else if (body.rules != null) {
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Manual groups do not accept membership rules" }),
          );
        }
        const wasDynamic = existing.kind === "dynamic";
        yield* db
          .update(schema.enterpriseGroup)
          .set({ name: body.name, notes: body.notes, kind, rules, updatedAt: now() })
          .where(
            and(
              eq(schema.enterpriseGroup.id, groupId),
              eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
            ),
          );
        if (kind === "dynamic") {
          yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });
        } else if (wasDynamic) {
          // Switching to manual keeps administrator rows but drops rule rows.
          yield* db
            .delete(schema.groupDevice)
            .where(
              and(
                eq(schema.groupDevice.groupId, groupId),
                eq(schema.groupDevice.source, "dynamic"),
              ),
            );
          yield* db
            .update(schema.enterpriseGroup)
            .set({ lastEvaluatedAt: null })
            .where(eq(schema.enterpriseGroup.id, groupId));
        }
        yield* audit(ctx, "group.updated", "group", groupId, { fields: Object.keys(body) });
        return ok;
      }),
    patchGroupMembers: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const group = yield* assertTenantGroup(ctx.organization.id, groupId);
        const body = payload as {
          assign?: {
            devices?: Array<string>;
            policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          };
          unassign?: {
            devices?: Array<string>;
            policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          };
        };
        if (
          group.kind === "dynamic" &&
          ((body.assign?.devices?.length ?? 0) > 0 || (body.unassign?.devices?.length ?? 0) > 0)
        )
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Dynamic group device membership is controlled by its rules",
            }),
          );
        const assignPolicies = assignmentRefs(body.assign?.policies);
        const unassignPolicies = assignmentRefs(body.unassign?.policies);
        yield* assertTenantDevices(ctx.organization.id, [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ]);
        yield* assertTenantPolicies(ctx.organization.id, [
          ...assignPolicies.map((assignment) => assignment.id),
          ...unassignPolicies.map((assignment) => assignment.id),
        ]);
        if (body.assign?.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(
              body.assign.devices.map((deviceId) => ({
                groupId,
                deviceId,
                source: "manual" as const,
              })),
            );
        if (assignPolicies.length) {
          // Upsert by replacing the affected link rows so a mode change is
          // applied atomically even on MySQL versions without RETURNING.
          const unique = [
            ...new Map(assignPolicies.map((assignment) => [assignment.id, assignment])).values(),
          ];
          yield* db.delete(schema.groupPolicy).where(
            and(
              eq(schema.groupPolicy.groupId, groupId),
              inArray(
                schema.groupPolicy.policyId,
                unique.map((assignment) => assignment.id),
              ),
            ),
          );
          yield* db.insert(schema.groupPolicy).values(
            unique.map((assignment) => ({
              groupId,
              policyId: assignment.id,
              mode: assignment.mode,
            })),
          );
        }
        if (body.unassign?.devices?.length)
          yield* db
            .delete(schema.groupDevice)
            .where(
              and(
                eq(schema.groupDevice.groupId, groupId),
                inArray(schema.groupDevice.deviceId, body.unassign.devices),
              ),
            );
        if (unassignPolicies.length)
          yield* db.delete(schema.groupPolicy).where(
            and(
              eq(schema.groupPolicy.groupId, groupId),
              inArray(
                schema.groupPolicy.policyId,
                unassignPolicies.map((assignment) => assignment.id),
              ),
            ),
          );

        // Device membership changes affect those devices; policy membership
        // changes affect every device in the group. Deduplicate in the helper.
        const affectedDevices = [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ];
        if (assignPolicies.length || unassignPolicies.length)
          affectedDevices.push(...(yield* applePush.deviceIdsInGroups([groupId])));
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "group.members_changed", "group", groupId, {
          assignDevices: body.assign?.devices?.length ?? 0,
          unassignDevices: body.unassign?.devices?.length ?? 0,
          assignPolicies: assignPolicies.length,
          unassignPolicies: unassignPolicies.length,
        });
        return ok;
      }),
    syncGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const affected = yield* Effect.forEach(
          [...(ids as ReadonlyArray<string>)],
          (groupId) =>
            Effect.gen(function* () {
              const group = yield* db.query.enterpriseGroup.findFirst({
                where: { id: groupId, organizationId: ctx.organization.id },
              });
              if (!group) return [];
              if (group.kind === "dynamic")
                yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });
              return yield* applePush.deviceIdsInGroups([groupId]);
            }),
          { concurrency: 10 },
        );
        yield* applePush.pushAppleDevices(affected.flat());
        return ok;
      }),
    duplicateGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const source = yield* assertTenantGroup(ctx.organization.id, groupId);
        const body = payload as { name?: string };
        const newId = id();
        const kind = source.kind ?? "manual";
        yield* db.insert(schema.enterpriseGroup).values({
          id: newId,
          organizationId: ctx.organization.id,
          name: body.name ?? `${source.name} [duplicated]`,
          notes: source.notes,
          kind,
          rules: kind === "dynamic" ? (source.rules as DynamicGroupRules | null) : null,
          lastEvaluatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
        const devices =
          kind === "manual"
            ? yield* db
                .select()
                .from(schema.groupDevice)
                .where(eq(schema.groupDevice.groupId, groupId))
            : [];
        const policies = yield* db
          .select()
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.groupId, groupId));
        if (devices.length)
          yield* db.insert(schema.groupDevice).values(
            devices.map((d: EnterpriseGroupDevice) => ({
              groupId: newId,
              deviceId: d.deviceId,
              source: d.source ?? ("manual" as const),
            })),
          );
        if (policies.length)
          yield* db.insert(schema.groupPolicy).values(
            policies.map((p: EnterpriseGroupPolicy) => ({
              groupId: newId,
              policyId: p.policyId,
              mode: p.mode ?? "include",
            })),
          );
        if (kind === "dynamic")
          yield* syncDynamicGroup(db, ctx.organization.id, newId, { now: now() });
        yield* audit(ctx, "group.duplicated", "group", newId, { sourceId: groupId });
        return { id: newId };
      }),
    createPolicy: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { name: string; notes?: string | null; priority?: number };
        if (body.priority !== undefined && !Number.isSafeInteger(body.priority))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Priority must be a whole number" }),
          );
        const policyId = id();
        yield* db.insert(schema.policy).values({
          id: policyId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          priority: body.priority ?? 0,
          createdAt: now(),
          updatedAt: now(),
        });
        yield* audit(ctx, "policy.created", "policy", policyId, { name: body.name });
        yield* snapshotPolicy(ctx, policyId);
        return { id: policyId };
      }),
    deletePolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const results = yield* Effect.forEach(
          [...(ids as ReadonlyArray<string>)],
          (policyId) =>
            Effect.gen(function* () {
              // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped
              // row first, then delete it by the same predicate.
              const existing = yield* db.query.policy.findFirst({
                where: { id: policyId, organizationId: ctx.organization.id },
              });
              if (!existing) return { id: policyId, deleted: false as const, reason: "notFound" };
              const devices = yield* applePush.deviceIdsInPolicies([policyId]);
              yield* db
                .delete(schema.policy)
                .where(
                  and(
                    eq(schema.policy.id, policyId),
                    eq(schema.policy.organizationId, ctx.organization.id),
                  ),
                );
              return { id: policyId, deleted: true as const, devices };
            }),
          { concurrency: 10 },
        );
        const deleted = results.filter((row) => row.deleted).map((row) => row.id);
        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));
        const affectedDevices = results.flatMap((row) => (row.deleted ? row.devices : []));
        const pushed = yield* applePush.pushAppleDevices(affectedDevices);
        yield* reportPolicyDeliveryFailure(ctx.organization.id, { policyIds: deleted }, pushed);
        yield* audit(ctx, "policy.deleted", "policy", null, { ids: [...deleted] });
        return { deleted, failed };
      }),
    patchPolicy: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name?: string;
          notes?: string | null;
          priority?: number;
          configurations?: Record<string, unknown>;
        };
        if (body.priority !== undefined && !Number.isSafeInteger(body.priority))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Priority must be a whole number" }),
          );
        const policy = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });
        if (!policy)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const configurations = Object.entries(body.configurations ?? {});
        // Validate the whole patch before mutating anything so a bad
        // configuration cannot leave the policy half-updated.
        for (const [kind, data] of configurations) {
          if (data === null) continue;
          yield* validateConfiguration(kind, data).pipe(
            Effect.mapError((message) => new EnterpriseBadRequest({ message })),
          );
        }
        yield* db
          .update(schema.policy)
          .set({ name: body.name, notes: body.notes, priority: body.priority, updatedAt: now() })
          .where(eq(schema.policy.id, policyId));
        for (const [kind, data] of configurations) {
          if (data === null) {
            yield* db
              .delete(schema.configuration)
              .where(
                and(
                  eq(schema.configuration.policyId, policyId),
                  eq(schema.configuration.kind, kind),
                ),
              );
          } else {
            const hash = yield* hashJson(data);
            yield* db
              .insert(schema.configuration)
              .values({ policyId, kind, data, hash })
              .onDuplicateKeyUpdate({ set: { data, hash } });
          }
        }
        const affectedDevices = yield* applePush.deviceIdsInPolicies([policyId]);
        yield* pushPolicyDevices(ctx.organization.id, policyId, affectedDevices);
        yield* audit(ctx, "policy.updated", "policy", policyId, {
          fields: Object.keys(body),
          configurations: Object.keys(body.configurations ?? {}),
        });
        yield* snapshotPolicy(ctx, policyId);
        return ok;
      }),
    listPolicyDeployments: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const deployments = yield* db
          .select()
          .from(schema.policyDeployment)
          .where(eq(schema.policyDeployment.policyId, policyId))
          .orderBy(desc(schema.policyDeployment.version))
          .limit(100);
        return {
          deployments: deployments.map((deployment: any) => ({
            id: deployment.id,
            version: deployment.version,
            createdAt: iso(deployment.createdAt),
            createdByUserId: deployment.createdByUserId,
          })),
        };
      }),
    rollbackPolicy: (request, tenantId, policyId, deploymentId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const deployment = yield* db.query.policyDeployment.findFirst({
          where: {
            id: deploymentId,
            policyId,
            organizationId: ctx.organization.id,
          },
        });
        if (!deployment)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Policy deployment not found" }),
          );
        yield* db.delete(schema.configuration).where(eq(schema.configuration.policyId, policyId));
        const snapshot = deployment.snapshot as Record<string, unknown>;
        const entries = Object.entries(snapshot ?? {});
        if (entries.length > 0)
          yield* db
            .insert(schema.configuration)
            .values(
              yield* Effect.all(
                entries.map(([kind, data]) =>
                  Effect.map(hashJson(data), (hash) => ({ policyId, kind, data, hash })),
                ),
              ),
            );
        yield* snapshotPolicy(ctx, policyId);
        yield* audit(ctx, "policy.rolled_back", "policy", policyId, { deploymentId });
        return ok;
      }),
    uploadPolicyApplication: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const body = payload as { fileName: string; contentType?: string; content: string };
        const bytes = base64ToBytes(body.content);
        const sha256 = yield* sha256Hex(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        yield* r2.put(key, bytes, {
          httpMetadata: body.contentType ? { contentType: body.contentType } : undefined,
          customMetadata: { fileName: body.fileName },
        });
        yield* audit(ctx, "policy.application_uploaded", "policy", policyId, {
          fileName: body.fileName,
          sha256,
        });
        return {
          sha256,
          fileName: body.fileName,
          contentType: body.contentType ?? null,
          size: bytes.byteLength,
        };
      }).pipe(Effect.provide(r2Layer)),
    downloadPolicyApplication: (request, tenantId, policyId, sha256) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        const object = yield* r2.get(key);
        const bytes = yield* r2.arrayBuffer(object);
        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? null,
          size: object.size ?? bytes.byteLength,
          content: bytesToBase64(new Uint8Array(bytes)),
        };
      }).pipe(Effect.provide(r2Layer)),
    getPolicyAssignments: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const policy = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });
        if (!policy)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const priority = policy.priority ?? 0;
        const groupLinks = yield* db
          .select({ groupId: schema.groupPolicy.groupId, mode: schema.groupPolicy.mode })
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.policyId, policyId));
        const groups = groupLinks.length
          ? yield* db
              .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
              .from(schema.enterpriseGroup)
              .where(
                inArray(
                  schema.enterpriseGroup.id,
                  groupLinks.map((link) => link.groupId),
                ),
              )
          : [];
        const groupModes = new Map(
          groupLinks.map((link) => [link.groupId, link.mode ?? ("include" as const)]),
        );
        const deviceLinks = yield* db
          .select({ deviceId: schema.devicePolicy.deviceId, mode: schema.devicePolicy.mode })
          .from(schema.devicePolicy)
          .where(eq(schema.devicePolicy.policyId, policyId));
        const devices = deviceLinks.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(
                    schema.device.id,
                    deviceLinks.map((link) => link.deviceId),
                  ),
                ),
              )
          : [];
        const deviceModes = new Map(
          deviceLinks.map((link) => [link.deviceId, link.mode ?? ("include" as const)]),
        );
        return {
          groups: groups
            .map((group) => ({
              ...group,
              mode: groupModes.get(group.id) ?? "include",
              priority,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          devices: devices
            .map((device) => ({
              ...device,
              mode: deviceModes.get(device.id) ?? "include",
              priority,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      }),
    patchPolicyAssignments: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const body = payload as {
          assign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          unassign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
        };
        const assign = assignmentRefs(body.assign);
        const unassign = assignmentRefs(body.unassign);
        yield* assertTenantDevices(ctx.organization.id, [
          ...assign.map((assignment) => assignment.id),
          ...unassign.map((assignment) => assignment.id),
        ]);
        if (assign.length) {
          const unique = [
            ...new Map(assign.map((assignment) => [assignment.id, assignment])).values(),
          ];
          yield* db.delete(schema.devicePolicy).where(
            and(
              eq(schema.devicePolicy.policyId, policyId),
              inArray(
                schema.devicePolicy.deviceId,
                unique.map((assignment) => assignment.id),
              ),
            ),
          );
          yield* db.insert(schema.devicePolicy).values(
            unique.map((assignment) => ({
              policyId,
              deviceId: assignment.id,
              mode: assignment.mode,
            })),
          );
        }
        if (unassign.length)
          yield* db.delete(schema.devicePolicy).where(
            and(
              eq(schema.devicePolicy.policyId, policyId),
              inArray(
                schema.devicePolicy.deviceId,
                unassign.map((assignment) => assignment.id),
              ),
            ),
          );
        yield* pushPolicyDevices(ctx.organization.id, policyId, [
          ...assign.map((assignment) => assignment.id),
          ...unassign.map((assignment) => assignment.id),
        ]);
        yield* audit(ctx, "policy.assignments_changed", "policy", policyId, {
          assign: assign.length,
          unassign: unassign.length,
          exclude: assign.filter((assignment) => assignment.mode === "exclude").length,
        });
        return ok;
      }),
    listApplications: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const apps = (yield* db
          .select()
          .from(schema.application)
          .where(
            eq(schema.application.organizationId, ctx.organization.id),
          )) as Array<EnterpriseApplication>;
        if (apps.length === 0) return { applications: [] };
        const ids = apps.map((app) => app.id);
        const groupLinks = yield* db
          .select()
          .from(schema.applicationGroup)
          .where(inArray(schema.applicationGroup.applicationId, ids));
        const deviceLinks = yield* db
          .select()
          .from(schema.applicationDevice)
          .where(inArray(schema.applicationDevice.applicationId, ids));
        return {
          applications: apps.map((app) =>
            rowApplication(
              app,
              groupLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
              deviceLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
            ),
          ),
        };
      }),
    getApplication: (request, tenantId, applicationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const app = (yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        })) as EnterpriseApplication | undefined;
        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
        const groupLinks = yield* db
          .select()
          .from(schema.applicationGroup)
          .where(eq(schema.applicationGroup.applicationId, applicationId));
        const deviceLinks = yield* db
          .select()
          .from(schema.applicationDevice)
          .where(eq(schema.applicationDevice.applicationId, applicationId));
        const groupIds = groupLinks.map((link: { groupId: string }) => link.groupId);
        const deviceIds = deviceLinks.map((link: { deviceId: string }) => link.deviceId);
        const groups = groupIds.length
          ? yield* db
              .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
              .from(schema.enterpriseGroup)
              .where(inArray(schema.enterpriseGroup.id, groupIds))
          : [];
        const devices = deviceIds.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(inArray(schema.device.id, deviceIds))
          : [];
        return { ...rowApplication(app, groups.length, devices.length), groups, devices };
      }),
    createApplication: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name: string;
          platform: "apple" | "win" | "android";
          bundleId?: string | null;
          version?: string | null;
          source?: "manifest" | "store" | "upload";
          manifestUrl?: string | null;
          storeId?: string | null;
          notes?: string | null;
        };
        if (!body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));
        const source = body.source ?? (body.storeId ? "store" : "manifest");
        if (body.platform === "apple") {
          if (source === "manifest" && !body.manifestUrl?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Apple manifest applications require a manifest URL",
              }),
            );
          if (source === "store" && !body.storeId?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Apple store applications require a store ID" }),
            );
        }
        if (source === "store" && !Number.isSafeInteger(Number(body.storeId)))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Store ID must be a whole number" }),
          );
        const applicationId = id();
        yield* db.insert(schema.application).values({
          id: applicationId,
          organizationId: ctx.organization.id,
          name: body.name.trim(),
          platform: body.platform,
          bundleId: body.bundleId ?? null,
          version: body.version ?? null,
          source,
          manifestUrl: body.manifestUrl ?? null,
          storeId: body.storeId ?? null,
          notes: body.notes ?? null,
          createdAt: now(),
          updatedAt: now(),
        });
        yield* audit(ctx, "application.created", "application", applicationId, {
          name: body.name.trim(),
          platform: body.platform,
        });
        return { id: applicationId };
      }),
    patchApplication: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = (yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        })) as EnterpriseApplication | undefined;
        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
        const body = payload as {
          name?: string;
          bundleId?: string | null;
          version?: string | null;
          source?: "manifest" | "store" | "upload";
          manifestUrl?: string | null;
          storeId?: string | null;
          notes?: string | null;
        };
        const source = body.source ?? existing.source;
        const manifestUrl =
          body.manifestUrl === undefined ? existing.manifestUrl : body.manifestUrl;
        const storeId = body.storeId === undefined ? existing.storeId : body.storeId;
        if (body.name !== undefined && !body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));
        if (existing.platform === "apple") {
          if (source === "manifest" && !manifestUrl?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Apple manifest applications require a manifest URL",
              }),
            );
          if (source === "store" && !storeId?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Apple store applications require a store ID" }),
            );
        }
        if (source === "store" && !Number.isSafeInteger(Number(storeId)))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Store ID must be a whole number" }),
          );
        yield* db
          .update(schema.application)
          .set({
            name: body.name?.trim() ?? existing.name,
            bundleId: body.bundleId === undefined ? existing.bundleId : body.bundleId,
            version: body.version === undefined ? existing.version : body.version,
            source,
            manifestUrl,
            storeId,
            notes: body.notes === undefined ? existing.notes : body.notes,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.application.id, applicationId),
              eq(schema.application.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "application.updated", "application", applicationId, {
          fields: Object.keys(body),
        });
        return ok;
      }),
    deleteApplications: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");
        const results = yield* Effect.forEach(
          [...(ids as ReadonlyArray<string>)],
          (applicationId) =>
            Effect.gen(function* () {
              const existing = (yield* db.query.application.findFirst({
                where: { id: applicationId, organizationId: ctx.organization.id },
              })) as EnterpriseApplication | undefined;
              if (!existing)
                return { id: applicationId, deleted: false as const, reason: "notFound" };
              yield* db
                .delete(schema.application)
                .where(
                  and(
                    eq(schema.application.id, applicationId),
                    eq(schema.application.organizationId, ctx.organization.id),
                  ),
                );
              // Delete the object only after the row is gone. A failure here
              // leaves an orphaned object, never a row pointing at a deleted
              // file, and must not abort the rest of the batch.
              if (existing.r2Key)
                yield* r2
                  .delete(existing.r2Key)
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning(
                        `Failed to delete application object ${applicationId}: ${String(cause)}`,
                      ),
                    ),
                  );
              return { id: applicationId, deleted: true as const };
            }),
          { concurrency: 10 },
        );
        const deleted = results.filter((row) => row.deleted).map((row) => row.id);
        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));
        yield* audit(ctx, "application.deleted", "application", null, { ids: deleted });
        return { deleted, failed };
      }).pipe(Effect.provide(r2Layer)),
    patchApplicationAssignments: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantApplications(ctx.organization.id, [applicationId]);
        const body = payload as {
          assign?: { groups?: Array<string>; devices?: Array<string> };
          unassign?: { groups?: Array<string>; devices?: Array<string> };
        };
        const groupIds = [...(body.assign?.groups ?? []), ...(body.unassign?.groups ?? [])];
        for (const groupId of groupIds) yield* assertTenantGroup(ctx.organization.id, groupId);
        yield* assertTenantDevices(ctx.organization.id, [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ]);
        if (body.assign?.groups?.length)
          yield* db
            .insert(schema.applicationGroup)
            .ignore()
            .values(body.assign.groups.map((groupId) => ({ groupId, applicationId })));
        if (body.assign?.devices?.length)
          yield* db
            .insert(schema.applicationDevice)
            .ignore()
            .values(body.assign.devices.map((deviceId) => ({ deviceId, applicationId })));
        if (body.unassign?.groups?.length)
          yield* db
            .delete(schema.applicationGroup)
            .where(
              and(
                eq(schema.applicationGroup.applicationId, applicationId),
                inArray(schema.applicationGroup.groupId, body.unassign.groups),
              ),
            );
        if (body.unassign?.devices?.length)
          yield* db
            .delete(schema.applicationDevice)
            .where(
              and(
                eq(schema.applicationDevice.applicationId, applicationId),
                inArray(schema.applicationDevice.deviceId, body.unassign.devices),
              ),
            );
        const affected = yield* applicationAssignedDeviceIds(ctx.organization.id, applicationId);
        yield* applePush.pushAppleDevices(affected.map((device) => device.id));
        yield* audit(ctx, "application.assignments_changed", "application", applicationId, {
          assignGroups: body.assign?.groups?.length ?? 0,
          assignDevices: body.assign?.devices?.length ?? 0,
          unassignGroups: body.unassign?.groups?.length ?? 0,
          unassignDevices: body.unassign?.devices?.length ?? 0,
        });
        return ok;
      }),
    installApplication: (request, tenantId, applicationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const app = (yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        })) as EnterpriseApplication | undefined;
        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
        if (app.platform !== "apple")
          return {
            status: "ok" as const,
            queued: 0,
            skipped: 0,
            message:
              app.platform === "win"
                ? "Windows app delivery is not implemented yet; the catalogue entry was saved."
                : "Android app delivery is not implemented yet; the catalogue entry was saved.",
          };
        if (app.source === "upload")
          return {
            status: "ok" as const,
            queued: 0,
            skipped: 0,
            message:
              "Uploaded installers are stored but not deployable yet. Use a manifest URL or store ID for Apple apps.",
          };
        const devices = yield* applicationAssignedDeviceIds(ctx.organization.id, applicationId);
        const appleDevices = devices.filter(
          (device) => device.proto === "apple" && device.status === "enrolled",
        );
        const skipped = devices.length - appleDevices.length;
        if (appleDevices.length === 0)
          return {
            status: "ok" as const,
            queued: 0,
            skipped,
            message: "No assigned Apple devices.",
          };
        const payload =
          app.source === "store"
            ? {
                iTunesStoreID: Number(app.storeId),
                ManagementFlags: 1,
                InstallAsManaged: true,
                Options: { PurchaseMethod: 1 },
              }
            : {
                ManifestURL: app.manifestUrl,
                ManagementFlags: 1,
                InstallAsManaged: true,
                Options: { PurchaseMethod: 1 },
              };
        yield* db.insert(schema.deviceCommand).values(
          appleDevices.map((device) => ({
            id: id(),
            organizationId: ctx.organization.id,
            deviceId: device.id,
            requestType: "InstallApplication",
            payload,
            status: "queued",
            createdAt: now(),
            updatedAt: now(),
          })),
        );
        yield* applePush.pushAppleDevices(appleDevices.map((device) => device.id));
        yield* audit(ctx, "application.install_queued", "application", applicationId, {
          queued: appleDevices.length,
          skipped,
        });
        return { status: "ok" as const, queued: appleDevices.length, skipped };
      }),
    uploadApplication: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantApplications(ctx.organization.id, [applicationId]);
        const existing = (yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        })) as EnterpriseApplication | undefined;
        const body = payload as { fileName: string; contentType?: string; content: string };
        const bytes = base64ToBytes(body.content);
        const sha256 = yield* sha256Hex(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        );
        const key = applicationKey(ctx.organization.id, applicationId, sha256);
        yield* r2.put(key, bytes, {
          httpMetadata: body.contentType ? { contentType: body.contentType } : undefined,
          customMetadata: { fileName: body.fileName },
        });
        yield* db
          .update(schema.application)
          .set({
            fileName: body.fileName,
            contentType: body.contentType ?? null,
            size: bytes.byteLength,
            sha256,
            r2Key: key,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.application.id, applicationId),
              eq(schema.application.organizationId, ctx.organization.id),
            ),
          );
        if (existing?.r2Key && existing.r2Key !== key) yield* r2.delete(existing.r2Key);
        yield* audit(ctx, "application.uploaded", "application", applicationId, {
          fileName: body.fileName,
          sha256,
          size: bytes.byteLength,
        });
        return {
          sha256,
          fileName: body.fileName,
          contentType: body.contentType ?? null,
          size: bytes.byteLength,
        };
      }).pipe(Effect.provide(r2Layer)),
    downloadApplication: (request, tenantId, applicationId, sha256) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId);
        const app = (yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        })) as EnterpriseApplication | undefined;
        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
        if (app.sha256 !== sha256 || !app.r2Key)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Application file not found" }),
          );
        const object = yield* r2
          .get(app.r2Key)
          .pipe(
            Effect.catchTag("R2FileNotFound", () =>
              Effect.fail(new EnterpriseNotFound({ message: "Application file not found" })),
            ),
          );
        const bytes = yield* r2.arrayBuffer(object);
        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? app.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? app.contentType ?? null,
          size: object.size ?? bytes.byteLength,
          content: bytesToBase64(new Uint8Array(bytes)),
        };
      }).pipe(Effect.provide(r2Layer)),
    syncPolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        const affected = yield* Effect.forEach(
          [...(ids as ReadonlyArray<string>)],
          (policyId) =>
            Effect.gen(function* () {
              const policy = yield* db.query.policy.findFirst({
                where: { id: policyId, organizationId: tenantId },
              });
              return policy ? yield* applePush.deviceIdsInPolicies([policyId]) : [];
            }),
          { concurrency: 10 },
        );
        const pushed = yield* applePush.pushAppleDevices(affected.flat());
        yield* reportPolicyDeliveryFailure(
          tenantId,
          { policyIds: [...(ids as ReadonlyArray<string>)] },
          pushed,
        );
        return ok;
      }),
    duplicatePolicy: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const source = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });
        if (!source)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const body = payload as { name?: string };
        const newId = id();
        yield* db.insert(schema.policy).values({
          id: newId,
          organizationId: ctx.organization.id,
          name: body.name ?? `${source.name} [duplicated]`,
          notes: source.notes,
          priority: source.priority ?? 0,
          createdAt: now(),
          updatedAt: now(),
        });
        const configurations = yield* db
          .select()
          .from(schema.configuration)
          .where(eq(schema.configuration.policyId, policyId));
        if (configurations.length)
          yield* db.insert(schema.configuration).values(
            configurations.map((c: EnterpriseConfiguration) => ({
              kind: c.kind,
              policyId: newId,
              data: c.data,
              hash: c.hash,
            })),
          );
        yield* audit(ctx, "policy.duplicated", "policy", newId, { sourceId: policyId });
        yield* snapshotPolicy(ctx, newId);
        return { id: newId };
      }),
    previewMobileconfig: (payload) =>
      Effect.gen(function* () {
        const body = payload as { mobileconfig: string };
        return yield* Effect.tryPromise({
          try: () => parseMobileconfigPreview(body.mobileconfig),
          catch: (cause) =>
            new EnterpriseBadRequest({
              message: cause instanceof Error ? cause.message : "Invalid mobileconfig",
            }),
        });
      }),
    search: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const term = (query.q ?? "").trim();
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        if (!term) return { rows: [] };
        const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        const devices = yield* db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, ctx.organization.id),
              or(
                like(schema.device.name, pattern),
                like(schema.device.serial, pattern),
                like(schema.device.model, pattern),
                like(schema.device.dmIdentifier, pattern),
              ),
            ),
          )
          .limit(limit);
        const groups = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(
            and(
              eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
              like(schema.enterpriseGroup.name, pattern),
            ),
          )
          .limit(limit);
        const policies = yield* db
          .select()
          .from(schema.policy)
          .where(
            and(
              eq(schema.policy.organizationId, ctx.organization.id),
              like(schema.policy.name, pattern),
            ),
          )
          .limit(limit);
        return {
          rows: [
            ...devices.map(rowDevice),
            ...groups.map((row: EnterpriseGroup) => rowGroup(row)),
            ...(yield* Effect.all(policies.map((row) => rowPolicy(row)))),
          ],
        };
      }),
    listDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* db
          .select()
          .from(schema.device)
          .where(eq(schema.device.organizationId, ctx.organization.id));
        return { rows: rows.map(rowDevice) };
      }),
    searchDevices: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = normalizeDeviceSearchQuery(query);
        const where = yield* deviceSearchWhere(ctx.organization.id, filters);
        const [total] = yield* db.select({ value: count() }).from(schema.device).where(where);
        const rows = yield* db
          .select()
          .from(schema.device)
          .where(where)
          .orderBy(...deviceOrder(filters))
          .limit(filters.limit)
          .offset(filters.offset);
        const groups = yield* deviceGroupsFor(
          ctx.organization.id,
          rows.map((row) => row.id),
        );
        return {
          devices: rows.map((row) => ({ ...rowDevice(row), groups: groups.get(row.id) ?? [] })),
          total: Number(total?.value ?? 0),
        };
      }),
    exportDevices: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = normalizeDeviceSearchQuery(query);
        const where = yield* deviceSearchWhere(ctx.organization.id, filters);
        // Fetch one extra row so truncation is detected without a second count
        // query; the extra row is never written to the CSV.
        const rows = yield* db
          .select()
          .from(schema.device)
          .where(where)
          .orderBy(...deviceOrder(filters))
          .limit(DEVICE_EXPORT_MAX_ROWS + 1);
        const truncated = rows.length > DEVICE_EXPORT_MAX_ROWS;
        const exportedRows = truncated ? rows.slice(0, DEVICE_EXPORT_MAX_ROWS) : rows;
        const groups = yield* deviceGroupsFor(
          ctx.organization.id,
          exportedRows.map((row) => row.id),
        );
        const csv = toCsv(
          [
            "Name",
            "Serial",
            "Model",
            "Platform",
            "Status",
            "OS version",
            "OS build",
            "Last seen",
            "Enrolled at",
            "Asset tag",
            "Model number",
            "FileVault",
            "Battery health",
            "Capabilities",
            "Inventory updated",
            "Groups",
          ],
          exportedRows.map((row) => [
            row.name,
            row.serial,
            row.model,
            platformLabel(row.proto),
            row.status,
            row.osVersion,
            row.osBuild,
            iso(row.lastSeenAt),
            iso(row.enrolledAt),
            row.assetTag,
            row.modelNumber,
            row.fileVaultEnabled === null || row.fileVaultEnabled === undefined
              ? ""
              : row.fileVaultEnabled
                ? "Enabled"
                : "Disabled",
            row.batteryHealth,
            capabilityText(row.capabilities),
            row.inventoryUpdatedAt ? iso(row.inventoryUpdatedAt) : "",
            (groups.get(row.id) ?? []).map((group) => group.name).join("; "),
          ]),
        );
        return { csv, truncated, rowCount: exportedRows.length };
      }),
    getDevice: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const secrets = yield* db
          .select({
            kind: schema.deviceSecret.kind,
            updatedAt: schema.deviceSecret.updatedAt,
            rotatedAt: schema.deviceSecret.rotatedAt,
          })
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, row.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
            ),
          );
        const recoveryKey = secrets.find((secret) => secret.kind === "filevault_recovery_key");
        const bootstrapToken = secrets.find((secret) => secret.kind === "bootstrap_token");
        const [apple] = yield* db
          .select({ bootstrapTokenEscrowed: schema.deviceApple.bootstrapTokenEscrowed })
          .from(schema.deviceApple)
          .where(eq(schema.deviceApple.deviceId, row.id))
          .limit(1);
        // Presence metadata only — the sealed value never leaves the backend.
        return {
          ...rowDevice(row),
          recoveryKeyEscrowed: Boolean(recoveryKey),
          bootstrapTokenEscrowed: apple?.bootstrapTokenEscrowed ?? Boolean(bootstrapToken),
          recoveryKeyUpdatedAt: recoveryKey ? iso(recoveryKey.updatedAt) : null,
          recoveryKeyRotatedAt: recoveryKey?.rotatedAt ? iso(recoveryKey.rotatedAt) : null,
          bootstrapTokenUpdatedAt: bootstrapToken ? iso(bootstrapToken.updatedAt) : null,
        };
      }),
    listDeviceApplications: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const applications = yield* db
          .select()
          .from(schema.deviceApplication)
          .where(
            and(
              eq(schema.deviceApplication.deviceId, device.id),
              eq(schema.deviceApplication.organizationId, ctx.organization.id),
            ),
          );
        return {
          applications: applications
            .map(rowDeviceApplication)
            .sort((left, right) =>
              (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
            ),
        };
      }),
    getDeviceRecoveryKey: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        // Reading a recovery key is a privileged action: the same role check as
        // writes (owner/admin) applies, and every reveal is audited.
        const ctx = yield* requireTenant(request, tenantId, "write");
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Recovery key escrow is not configured on this deployment",
            }),
          );
        const [secret] = yield* db
          .select()
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, device.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
              eq(schema.deviceSecret.kind, "filevault_recovery_key"),
            ),
          )
          .limit(1);
        if (!secret)
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message: "No FileVault recovery key has been escrowed for this device",
            }),
          );
        const recoveryKey = yield* Effect.tryPromise({
          try: () => openSecret(authSecret, secret.sealedValue),
          catch: () =>
            new EnterpriseBadRequest({
              message: "The escrowed recovery key could not be decrypted",
            }),
        });
        yield* audit(ctx, "device.recovery_key_viewed", "device", device.id, {
          kind: "filevault_recovery_key",
        });
        return {
          recoveryKey,
          updatedAt: iso(secret.updatedAt),
          rotatedAt: secret.rotatedAt ? iso(secret.rotatedAt) : null,
        };
      }),
    getApplicationInventory: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = (query ?? {}) as {
          q?: string;
          managed?: string;
          updates?: string;
          limit?: number;
          offset?: number;
        };
        const term = filters.q?.trim().toLowerCase() ?? "";
        const managed =
          filters.managed === "managed"
            ? true
            : filters.managed === "unmanaged"
              ? false
              : undefined;
        const updatesOnly = filters.updates === "available";
        const limit = Math.min(Math.max(Math.trunc(Number(filters.limit ?? 100)) || 100, 1), 500);
        const offset = Math.max(Math.trunc(Number(filters.offset ?? 0)) || 0, 0);

        const rows = yield* db
          .select()
          .from(schema.deviceApplication)
          .where(eq(schema.deviceApplication.organizationId, ctx.organization.id));

        type InventoryGroup = {
          bundleId: string;
          name: string | null;
          version: string | null;
          shortVersion: string | null;
          bundleSize: number | null;
          dynamicSize: number | null;
          hasUpdateAvailable: boolean;
          isManaged: boolean;
          lastReportedAt: Date;
          devices: Set<string>;
        };
        const groups = new Map<string, InventoryGroup>();
        for (const row of rows) {
          const group = groups.get(row.bundleId) ?? {
            bundleId: row.bundleId,
            name: row.name,
            version: row.version,
            shortVersion: row.shortVersion,
            bundleSize: row.bundleSize,
            dynamicSize: row.dynamicSize,
            hasUpdateAvailable: false,
            isManaged: false,
            lastReportedAt: row.lastReportedAt,
            devices: new Set<string>(),
          };
          group.name ??= row.name;
          group.version ??= row.version;
          group.shortVersion ??= row.shortVersion;
          group.bundleSize ??= row.bundleSize;
          group.dynamicSize ??= row.dynamicSize;
          group.hasUpdateAvailable ||= row.hasUpdateAvailable;
          group.isManaged ||= row.isManaged;
          if (row.lastReportedAt > group.lastReportedAt) group.lastReportedAt = row.lastReportedAt;
          group.devices.add(row.deviceId);
          groups.set(row.bundleId, group);
        }

        const matches = [...groups.values()]
          .filter((group) => {
            if (term) {
              const haystack = `${group.name ?? ""} ${group.bundleId}`.toLowerCase();
              if (!haystack.includes(term)) return false;
            }
            if (managed !== undefined && group.isManaged !== managed) return false;
            if (updatesOnly && !group.hasUpdateAvailable) return false;
            return true;
          })
          .sort((left, right) =>
            (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
          );

        return {
          total: matches.length,
          applications: matches.slice(offset, offset + limit).map((group) => ({
            id: group.bundleId,
            bundleId: group.bundleId,
            name: group.name,
            version: group.version,
            shortVersion: group.shortVersion,
            bundleSize: group.bundleSize,
            dynamicSize: group.dynamicSize,
            hasUpdateAvailable: group.hasUpdateAvailable,
            isManaged: group.isManaged,
            lastReportedAt: iso(group.lastReportedAt),
            deviceCount: group.devices.size,
          })),
        };
      }),
    getDeviceEffectivePolicy: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        return yield* resolveEffectivePolicyForDevice(db, {
          id: row.id,
          organizationId: ctx.organization.id,
        });
      }),
    listGroups: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));
        return { rows: rows.map((row: EnterpriseGroup) => rowGroup(row)) };
      }),
    getGroup: (request, tenantId, groupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* db.query.enterpriseGroup.findFirst({
          where: { id: groupId, organizationId: ctx.organization.id },
        });
        if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
        const deviceLinks = yield* db
          .select({ deviceId: schema.groupDevice.deviceId })
          .from(schema.groupDevice)
          .where(eq(schema.groupDevice.groupId, groupId));
        const devices = deviceLinks.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(
                    schema.device.id,
                    deviceLinks.map((link) => link.deviceId),
                  ),
                ),
              )
          : [];
        const policyLinks = yield* db
          .select({ policyId: schema.groupPolicy.policyId, mode: schema.groupPolicy.mode })
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.groupId, groupId));
        const policies = policyLinks.length
          ? yield* db
              .select({
                id: schema.policy.id,
                name: schema.policy.name,
                priority: schema.policy.priority,
              })
              .from(schema.policy)
              .where(
                and(
                  eq(schema.policy.organizationId, ctx.organization.id),
                  inArray(
                    schema.policy.id,
                    policyLinks.map((link) => link.policyId),
                  ),
                ),
              )
          : [];
        const modes = new Map(
          policyLinks.map((link) => [link.policyId, link.mode ?? ("include" as const)]),
        );
        return {
          ...rowGroup(row, devices.length, policies.length),
          devices: [...devices].sort((left, right) => left.name.localeCompare(right.name)),
          policies: policies
            .map((policy) => ({
              ...policy,
              priority: policy.priority ?? 0,
              mode: modes.get(policy.id) ?? "include",
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      }),
    previewGroup: (request, tenantId, groupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const preview = yield* previewDynamicGroup(db, ctx.organization.id, groupId, {
          now: now(),
        });
        if (!preview)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
        return {
          groupId: preview.groupId,
          kind: preview.kind,
          count: preview.count,
          devices: [...preview.devices],
          evaluatedAt: iso(preview.evaluatedAt),
        };
      }),
    listPolicies: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* db
          .select()
          .from(schema.policy)
          .where(eq(schema.policy.organizationId, ctx.organization.id));
        return { rows: yield* Effect.all(rows.map((row: EnterprisePolicy) => rowPolicy(row))) };
      }),
    getPolicy: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });
        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        return yield* rowPolicy(row, true);
      }),
    billing: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        return yield* billingSummary(ctx.organization.id);
      }),
    billingPortal: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        if (!stripe) return yield* Effect.fail(billingNotConfigured());
        const body = payload as { returnUrl: string };
        const customer = yield* ensureStripeCustomer(ctx.organization);
        const result = yield* stripe.billingPortal.sessions
          .create({
            customer,
            return_url: body.returnUrl,
          })
          .pipe(Effect.mapError(() => billingUnavailable()));
        return { url: result.url ?? body.returnUrl };
      }),
    requestEmailVerification: (request) =>
      auth.requestEmailVerification(webRequestFromRequest(request, origin)),
    verifyEmail: (_request, payload) => auth.verifyEmail(payload),
    requestEmailChange: (request, payload) =>
      auth.requestEmailChange(webRequestFromRequest(request, origin), payload),
    verifyEmailChange: (_request, payload) => auth.verifyEmailChange(payload),
    listApiTokens: (request) => auth.listApiTokens(webRequestFromRequest(request, origin)),
    createApiToken: (request, payload) =>
      auth.createApiToken(webRequestFromRequest(request, origin), payload),
    revokeApiToken: (request, tokenId) =>
      auth.revokeApiToken(webRequestFromRequest(request, origin), tokenId),
  };

  return service;
};

export const enterpriseHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>,
) =>
  handlers
    .handle("requestEmailVerification", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.requestEmailVerification(request)),
    )
    .handle("verifyEmail", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.verifyEmail(request, payload)),
    )
    .handle("requestEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.requestEmailChange(request, payload)),
    )
    .handle("verifyEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.verifyEmailChange(request, payload)),
    )
    .handle("listApiTokens", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listApiTokens(request)),
    )
    .handle("createApiToken", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.createApiToken(request, payload)),
    )
    .handle("revokeApiToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeApiToken(request, params.tokenId),
      ),
    )
    .handle("listAccountSessions", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listAccountSessions(request)),
    )
    .handle("revokeAccountSession", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeAccountSession(request, params.sessionId),
      ),
    )
    .handle("me", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.me(request)),
    )
    .handle("updateMe", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.updateMe(request, payload)),
    )
    .handle("deleteMe", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.deleteMe(request)),
    )
    .handle("listTenants", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listTenants(request)),
    )
    .handle("createTenant", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.createTenant(request, payload)),
    )
    .handle("importTenant", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.importTenant(request, payload)),
    )
    .handle("getTenant", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getTenant(request, params.tenantId)),
    )
    .handleRaw("exportTenant", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportTenant(request, params.tenantId, query),
          (result: { body: string; filename: string; version: number }) =>
            HttpServerResponse.text(result.body, {
              contentType: "application/json; charset=utf-8",
              headers: {
                "Content-Disposition": `attachment; filename="${result.filename}"`,
                "Cache-Control": "no-store",
                "X-Tenant-Export-Version": String(result.version),
              },
            }),
        ),
      ),
    )
    .handle("patchTenant", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenant(request, params.tenantId, payload),
      ),
    )
    .handle("deleteTenant", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteTenant(request, params.tenantId),
      ),
    )
    .handle("getEntraDirectorySync", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getEntraDirectorySync(request, params.tenantId),
      ),
    )
    .handle("patchEntraDirectorySync", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchEntraDirectorySync(request, params.tenantId, payload),
      ),
    )
    .handle("syncEntraDirectory", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncEntraDirectory(request, params.tenantId),
      ),
    )
    .handle("listEntraDomains", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listEntraDomains(request, params.tenantId),
      ),
    )
    .handle("refreshEntraDomains", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.refreshEntraDomains(request, params.tenantId),
      ),
    )
    .handle("getSsoConfig", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getSsoConfig(request, params.tenantId),
      ),
    )
    .handle("patchSsoConfig", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchSsoConfig(request, params.tenantId, payload),
      ),
    )
    .handle("listScimTokens", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listScimTokens(request, params.tenantId),
      ),
    )
    .handle("createScimToken", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createScimToken(request, params.tenantId, payload),
      ),
    )
    .handle("revokeScimToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeScimToken(request, params.tenantId, params.tokenId),
      ),
    )
    .handle("listWebhookEndpoints", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listWebhookEndpoints(request, params.tenantId),
      ),
    )
    .handle("createWebhookEndpoint", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createWebhookEndpoint(request, params.tenantId, payload),
      ),
    )
    .handle("patchWebhookEndpoint", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchWebhookEndpoint(request, params.tenantId, params.webhookId, payload),
      ),
    )
    .handle("deleteWebhookEndpoint", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteWebhookEndpoint(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("rotateWebhookSecret", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.rotateWebhookSecret(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("testWebhookEndpoint", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.testWebhookEndpoint(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("listAuditLog", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAuditLog(request, params.tenantId),
      ),
    )
    .handle("searchAuditLog", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.searchAuditLog(request, params.tenantId, query),
      ),
    )
    .handleRaw("exportAuditLog", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportAuditLog(request, params.tenantId, query),
          (result: {
            format: "csv" | "json";
            body: string;
            truncated: boolean;
            rowCount: number;
          }) => {
            const extension = result.format;
            return HttpServerResponse.text(result.body, {
              contentType:
                result.format === "json"
                  ? "application/json; charset=utf-8"
                  : "text/csv; charset=utf-8",
              headers: {
                "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.${extension}"`,
                ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
                "X-Export-Rows": String(result.rowCount),
              },
            });
          },
        ),
      ),
    )
    .handle("listTenantUsers", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantUsers(request, params.tenantId),
      ),
    )
    .handle("inviteTenantUser", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.inviteTenantUser(request, params.tenantId, payload),
      ),
    )
    .handle("acceptInvitation", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.acceptInvitation(request, payload)),
    )
    .handle("listTenantInvitations", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantInvitations(request, params.tenantId),
      ),
    )
    .handle("cancelTenantInvitation", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.cancelTenantInvitation(request, params.tenantId, params.invitationId),
      ),
    )
    .handle("patchTenantUser", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantUser(request, params.tenantId, params.memberId, payload),
      ),
    )
    .handle("removeTenantUser", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.removeTenantUser(request, params.tenantId, params.memberId),
      ),
    )
    .handle("getEnrollment", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) => {
        const headers = request.headers as Record<string, string | undefined>;
        const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
        return service.getEnrollment(params.id, query.code, {
          platform: query.platform,
          ip: headers["cf-connecting-ip"] ?? forwarded,
          userAgent: headers["user-agent"],
        });
      }),
    )
    .handleRaw("getAppleEnrollmentProfile", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) => {
        const headers = request.headers as Record<string, string | undefined>;
        const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
        return Effect.map(
          service.getAppleEnrollmentProfile(params.id, query.code, {
            platform: query.platform ?? "apple",
            ip: headers["cf-connecting-ip"] ?? forwarded,
            userAgent: headers["user-agent"],
          }),
          (result: { plist: string; filename: string }) => appleEnrollmentProfileResponse(result),
        );
      }),
    )
    .handle("getTenantEnrollment", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantEnrollment(request, params.tenantId),
      ),
    )
    .handle("listEnrollmentAttempts", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listEnrollmentAttempts(request, params.tenantId, query),
      ),
    )
    .handle("patchTenantEnrollment", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantEnrollment(request, params.tenantId, payload),
      ),
    )
    .handle("resetTenantEnrollment", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.resetTenantEnrollment(request, params.tenantId),
      ),
    )
    .handle("getApns", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getApns(request, params.tenantId)),
    )
    .handle("getApnsCsr", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getApnsCsr(request, params.tenantId)),
    )
    .handle("uploadApns", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadApns(request, params.tenantId, payload),
      ),
    )
    .handle("search", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.search(request, params.tenantId, query),
      ),
    )
    .handle("listDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listDevices(request, params.tenantId)),
    )
    .handle("searchDevices", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.searchDevices(request, params.tenantId, query),
      ),
    )
    .handleRaw("exportDevices", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportDevices(request, params.tenantId, query),
          (result: { csv: string; truncated: boolean; rowCount: number }) =>
            HttpServerResponse.text(result.csv, {
              contentType: "text/csv; charset=utf-8",
              headers: {
                "Content-Disposition": `attachment; filename="devices-${new Date().toISOString().slice(0, 10)}.csv"`,
                ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
                "X-Export-Rows": String(result.rowCount),
              },
            }),
        ),
      ),
    )
    .handle("getDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDevice(request, params.tenantId, params.id),
      ),
    )
    .handle("listDeviceApplications", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceApplications(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceRecoveryKey", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceRecoveryKey(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceEffectivePolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceEffectivePolicy(request, params.tenantId, params.id),
      ),
    )
    .handle("deleteDevices", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevices(request, params.tenantId, payload),
      ),
    )
    .handle("listDevicePreRegistrations", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDevicePreRegistrations(request, params.tenantId),
      ),
    )
    .handle("importDevicePreRegistrations", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.importDevicePreRegistrations(request, params.tenantId, payload),
      ),
    )
    .handle("deleteDevicePreRegistration", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevicePreRegistration(request, params.tenantId, params.id),
      ),
    )
    .handle("deleteDevicePreRegistrations", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevicePreRegistrations(request, params.tenantId, payload),
      ),
    )
    .handle("patchDevice", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchDevice(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("deviceAction", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceAction(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listDeviceCommands", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceCommands(request, params.tenantId, params.id),
      ),
    )
    .handle("listDeviceDeclarations", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceDeclarations(request, params.tenantId, params.id),
      ),
    )
    .handle("deviceUnenroll", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceUnenroll(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceHealth(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceActivity", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceActivity(request, params.tenantId, params.id, query),
      ),
    )
    .handle("revokeDeviceIdentity", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeDeviceIdentity(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceHealthSummary", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceHealthSummary(request, params.tenantId),
      ),
    )
    .handle("getDevicePushHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDevicePushHealth(request, params.tenantId),
      ),
    )
    .handle("getCredentialHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getCredentialHealth(request, params.tenantId),
      ),
    )
    .handle("listGroups", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listGroups(request, params.tenantId)),
    )
    .handle("getGroup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getGroup(request, params.tenantId, params.id),
      ),
    )
    .handle("previewGroup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.previewGroup(request, params.tenantId, params.id),
      ),
    )
    .handle("createGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createGroup(request, params.tenantId, payload),
      ),
    )
    .handle("deleteGroups", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteGroups(request, params.tenantId, payload),
      ),
    )
    .handle("patchGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchGroup(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("patchGroupMembers", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchGroupMembers(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("syncGroups", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncGroups(request, params.tenantId, payload),
      ),
    )
    .handle("duplicateGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.duplicateGroup(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listApplications", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listApplications(request, params.tenantId),
      ),
    )
    .handle("getApplicationInventory", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getApplicationInventory(request, params.tenantId, query),
      ),
    )
    .handle("getApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getApplication(request, params.tenantId, params.id),
      ),
    )
    .handle("createApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createApplication(request, params.tenantId, payload),
      ),
    )
    .handle("patchApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("deleteApplications", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteApplications(request, params.tenantId, payload),
      ),
    )
    .handle("patchApplicationAssignments", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchApplicationAssignments(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("installApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.installApplication(request, params.tenantId, params.id),
      ),
    )
    .handle("uploadApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("downloadApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.downloadApplication(request, params.tenantId, params.id, params.sha256),
      ),
    )
    .handle("getPolicyAssignments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getPolicyAssignments(request, params.tenantId, params.id),
      ),
    )
    .handle("patchPolicyAssignments", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchPolicyAssignments(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listPolicies", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listPolicies(request, params.tenantId),
      ),
    )
    .handle("getPolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getPolicy(request, params.tenantId, params.id),
      ),
    )
    .handle("createPolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createPolicy(request, params.tenantId, payload),
      ),
    )
    .handle("deletePolicies", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deletePolicies(request, params.tenantId, payload),
      ),
    )
    .handle("patchPolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchPolicy(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("uploadPolicyApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadPolicyApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("downloadPolicyApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.downloadPolicyApplication(request, params.tenantId, params.id, params.sha256),
      ),
    )
    .handle("listPolicyDeployments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listPolicyDeployments(request, params.tenantId, params.id),
      ),
    )
    .handle("rollbackPolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.rollbackPolicy(request, params.tenantId, params.id, params.deploymentId),
      ),
    )
    .handle("syncPolicies", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncPolicies(request, params.tenantId, payload),
      ),
    )
    .handle("duplicatePolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.duplicatePolicy(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("previewMobileconfig", ({ payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.previewMobileconfig(payload)),
    )
    .handle("billing", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.billing(request, params.tenantId)),
    )
    .handle("billingPortal", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.billingPortal(request, params.tenantId, payload),
      ),
    );
