import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  EnterpriseBadRequest,
  EnterpriseForbidden,
  EnterpriseLastTenantUser,
  EnterpriseNotFound,
  EnterpriseTenantHasMembers,
  EnterpriseService,
  enterpriseApi,
  type EnterpriseAuth,
  policyApplicationKey,
} from "@mattrax/enterprise-domain";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import type { Stripe } from "@mattrax/effect-stripe";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import { enterpriseEnrollmentProfile } from "@mattrax/management-backend-enterprise";
import { createScepChallenge, validateConfiguration } from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";
import { parseMobileconfigPreview } from "./mobileconfig.ts";
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
  EnterpriseOrganization,
  EnterprisePolicy,
  EnterpriseSchema,
} from "./schema.ts";

export type EnterpriseHandlersConfig = {
  readonly origin: string;
  readonly stripeClient: RawStripeClientLike | ReturnType<typeof makeEffectStripeClient>;
  readonly storage: R2Bucket;
  /** Application secret used to seal/unseal APNs private keys. */
  readonly authSecret?: string;
  /** Apple MDM vendor certificate/key used to sign APNs CSRs (optional). */
  readonly cloudAppleVendorCert?: string;
  readonly cloudAppleVendorKey?: string;
  /** Push transport. Defaults to a no-op transport when omitted (tests). */
  readonly apns?: ApnsService.Service;
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
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const ok = { status: "ok" as const };

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
}: EnterpriseServiceConfig) => {
  if (!authService) throw new Error("EnterpriseAuth service is required");
  const auth = authService;
  const apns = apnsService ?? makeApnsService(NoopPushTransport());
  const applePush = makeApplePush({ db, schema, apns, authSecret });
  const stripe = isEffectStripeClient(stripeClient)
    ? stripeClient
    : makeEffectStripeClient(stripeClient as StripeClientLike);
  const r2Layer = R2StorageLive(storage);

  const requireTenant = (
    request: HttpServerRequest,
    tenantId: string,
    access: "read" | "write" | "delete" = "read",
  ) =>
    Effect.gen(function* () {
      const { user } = yield* auth.requireUser({ headers: request.headers });
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
    db.insert(schema.auditLog).values({
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

  const ensureStripeCustomer = (organization: EnterpriseOrganization) =>
    Effect.gen(function* () {
      if (organization.stripeCustomerId) return organization.stripeCustomerId;

      let stripeCustomer: Stripe.Customer | undefined;
      const search = yield* Effect.catch(
        stripe.customers.search({
          query: `metadata["organizationId"]:"${organization.id}" AND metadata["customerType"]:"organization"`,
          limit: 1,
        }) as Effect.Effect<{ data: Array<Stripe.Customer> }, unknown>,
        () =>
          stripe.effect(async (client: Stripe) => {
            for await (const customer of client.customers.list({ limit: 100 })) {
              if (
                customer.metadata?.organizationId === organization.id &&
                customer.metadata?.customerType === "organization"
              )
                return customer;
            }
            return undefined;
          }) as Effect.Effect<Stripe.Customer | undefined, unknown>,
      );
      stripeCustomer = search && "data" in search ? search.data[0] : search;

      stripeCustomer ??= yield* stripe.customers.create({
        name: organization.name,
        metadata: { organizationId: organization.id, customerType: "organization" },
      }) as Effect.Effect<Stripe.Customer, unknown>;

      if (!stripeCustomer)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Stripe customer not found" }));

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
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(eq(schema.member.userId, userId));
      return rows;
    });

  const memberCount = (tenantId: string) =>
    Effect.gen(function* () {
      const [members] = yield* db
        .select({ value: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, tenantId));
      return members?.value ?? 0;
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
  });

  const rowGroup = (row: EnterpriseGroup, devicesCount = 0, policiesCount = 0) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
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
            yield* db.delete(schema.member).where(eq(schema.member.id, membership.id));
          }
        }

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
          (schema as any).authCredentials,
          (schema as any).authIdentifiers,
        ];
        for (const table of authTables) {
          if (table) yield* db.delete(table).where(eq((table as any).subjectId, user.id));
        }

        yield* db.delete(schema.user).where(eq(schema.user.id, user.id));
        return ok;
      }),
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
          metadata?: Record<string, unknown>;
        };
        const existing = yield* db.query.organization.findFirst({
          where: { slug: body.slug },
        });
        if (existing)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "That tenant slug is already in use" }),
          );
        const tenantId = id();
        const timestamp = now();
        yield* db.insert(schema.organization).values({
          id: tenantId,
          name: body.name,
          slug: body.slug,
          logo: body.logo ?? null,
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
          role: ctx.member.role,
          createdAt: iso(ctx.organization.createdAt),
        };
      }),
    patchTenant: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name?: string;
          slug?: string;
          logo?: string | null;
          metadata?: Record<string, unknown> | null;
        };
        yield* db
          .update(schema.organization)
          .set({
            ...body,
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
    listAuditLog: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId);
        const entries = yield* db
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.organizationId, tenantId))
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(200);
        return {
          entries: entries.map((entry: any) => ({
            id: entry.id,
            action: entry.action,
            targetType: entry.targetType,
            targetId: entry.targetId,
            actorEmail: entry.actorEmail,
            metadata: entry.metadata,
            createdAt: iso(entry.createdAt),
          })),
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
          role: body.role ?? "member",
          status: "pending",
          tokenHash,
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const inviteUrl = `${origin}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
        const organization = ctx.organization.name;
        if (email) {
          yield* Effect.tryPromise({
            try: () =>
              email.send({
                to: body.email,
                from: { name: "Mattrax", email: "hello@mattrax.cloud" },
                subject: `You have been invited to ${organization} on Mattrax`,
                text: `You have been invited to join ${organization} on Mattrax as ${body.role ?? "member"}.\n\nAccept the invitation by opening this link:\n\n${inviteUrl}\n\nThis link expires in 7 days.`,
                html: `<p>You have been invited to join <strong>${organization}</strong> on Mattrax as ${body.role ?? "member"}.</p><p><a href="${inviteUrl}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
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
          role: body.role ?? "member",
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
        yield* db.delete(schema.member).where(eq(schema.member.id, memberId));
        yield* audit(ctx, "member.removed", "user", member.userId, { memberId });
        return ok;
      }),
    getEnrollment: (enrollmentId, code) =>
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
        if (enrollment.code && enrollment.code !== code)
          return { name: organization.name, authenticated: false as const };

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: organization.id },
        });
        const [deviceCount] = yield* db
          .select({ value: count() })
          .from(schema.device)
          .where(eq(schema.device.organizationId, organization.id));
        const enabled = (deviceCount?.value ?? 0) <= enrollment.maxDevices;
        const challenge = yield* Effect.tryPromise({
          try: () =>
            createScepChallenge(enrollment.id, authSecret ?? "", {
              // Enrollment profiles are shareable links; allow a week before
              // the challenge goes stale, without a schema migration.
              ttlSeconds: 7 * 24 * 60 * 60,
            }),
          catch: (cause) =>
            new EnterpriseBadRequest({ message: "Could not create the SCEP challenge" }),
        });
        return {
          name: organization.name,
          authenticated: true as const,
          apple:
            !enabled || !enrollment.enabledApple
              ? { error: "Apple enrollment is disabled! Contact your administrator." }
              : apns?.topic
                ? {
                    profile: yield* serializePlist(
                      enterpriseEnrollmentProfile({
                        origin,
                        topic: apns.topic,
                        organizationId: organization.id,
                        organizationName: organization.name,
                        challenge,
                      }),
                    ),
                  }
                : { error: "Apple management is not configured! Contact your administrator." },
          windows:
            !enabled || !enrollment.enabledWindows
              ? { error: "Windows enrollment is disabled! Contact your administrator." }
              : "available",
          android:
            !enabled || !enrollment.enabledAndroid
              ? { error: "Android enrollment is disabled! Contact your administrator." }
              : "available",
          assetTag: enabled && enrollment.enabledAssetTag,
        };
      }),
    getTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const enrollment = yield* getOrCreateEnrollment(ctx.organization.id);
        return rowEnrollment(enrollment);
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
        if (ids.length > 0)
          yield* db
            .delete(schema.device)
            .where(
              and(
                eq(schema.device.organizationId, ctx.organization.id),
                inArray(schema.device.id, [...ids]),
              ),
            );
        yield* audit(ctx, "device.deleted", "device", null, { ids: [...ids] });
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
            const request = (() => {
              if (device.proto === "win") {
                if (action === "wipe")
                  return {
                    requestType: "WindowsWipe",
                    payload: { locURI: "./Vendor/MSFT/RemoteWipe/1/doWipe" },
                  };
                if (action === "restart")
                  return {
                    requestType: "WindowsReboot",
                    payload: { locURI: "./Vendor/MSFT/Reboot/1/RebootNow" },
                  };
                return null;
              }
              switch (action) {
                case "lock":
                  return { requestType: "DeviceLock", payload: {} };
                case "wipe":
                  return { requestType: "EraseDevice", payload: {} };
                case "restart":
                  return { requestType: "RestartDevice", payload: {} };
                case "shutdown":
                  return { requestType: "ShutdownDevice", payload: {} };
                case "clear-passcode":
                  return { requestType: "ClearPasscode", payload: {} };
                case "install-app":
                  if (body.manifestUrl)
                    return {
                      requestType: "InstallApplication",
                      payload: { ManifestURL: body.manifestUrl, ManagementFlags: 1 },
                    };
                  if (body.iTunesStoreId)
                    return {
                      requestType: "InstallApplication",
                      payload: { iTunesStoreID: body.iTunesStoreId, ManagementFlags: 1 },
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
        return ok;
      }),
    deviceUnenroll: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
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
        yield* audit(ctx, "device.unenrolled", "device", deviceId);
        return ok;
      }),
    createGroup: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name: string;
          notes?: string | null;
          devices?: Array<string>;
          policies?: Array<string>;
        };
        yield* assertTenantDevices(ctx.organization.id, body.devices ?? []);
        yield* assertTenantPolicies(ctx.organization.id, body.policies ?? []);
        const groupId = id();
        yield* db.insert(schema.enterpriseGroup).values({
          id: groupId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          createdAt: now(),
          updatedAt: now(),
        });
        if (body.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(body.devices.map((deviceId) => ({ groupId, deviceId })));
        if (body.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .ignore()
            .values(body.policies.map((policyId) => ({ groupId, policyId })));
        yield* audit(ctx, "group.created", "group", groupId, {
          name: body.name,
          devices: body.devices?.length ?? 0,
          policies: body.policies?.length ?? 0,
        });
        return { id: groupId };
      }),
    deleteGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const deleted: Array<string> = [];
        const failed: Array<{ id: string; reason: string }> = [];
        const affectedDevices: Array<string> = [];
        for (const groupId of ids) {
          // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped row
          // first, then delete it by the same predicate.
          const existing = yield* db.query.enterpriseGroup.findFirst({
            where: { id: groupId, organizationId: ctx.organization.id },
          });
          if (!existing) {
            failed.push({ id: groupId, reason: "notFound" });
            continue;
          }
          affectedDevices.push(...(yield* applePush.deviceIdsInGroups([groupId])));
          yield* db
            .delete(schema.enterpriseGroup)
            .where(
              and(
                eq(schema.enterpriseGroup.id, groupId),
                eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
              ),
            );
          deleted.push(groupId);
        }
        // Devices in a deleted group lose policies and must re-sync.
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "group.deleted", "group", null, { ids: [...deleted] });
        return { deleted, failed };
      }),
    patchGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { name?: string; notes?: string | null };
        yield* db
          .update(schema.enterpriseGroup)
          .set({ name: body.name, notes: body.notes, updatedAt: now() })
          .where(
            and(
              eq(schema.enterpriseGroup.id, groupId),
              eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "group.updated", "group", groupId, { fields: Object.keys(body) });
        return ok;
      }),
    patchGroupMembers: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantGroup(ctx.organization.id, groupId);
        const body = payload as {
          assign?: { devices?: Array<string>; policies?: Array<string> };
          unassign?: { devices?: Array<string>; policies?: Array<string> };
        };
        yield* assertTenantDevices(ctx.organization.id, [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ]);
        yield* assertTenantPolicies(ctx.organization.id, [
          ...(body.assign?.policies ?? []),
          ...(body.unassign?.policies ?? []),
        ]);
        if (body.assign?.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(body.assign.devices.map((deviceId) => ({ groupId, deviceId })));
        if (body.assign?.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .ignore()
            .values(body.assign.policies.map((policyId) => ({ groupId, policyId })));
        if (body.unassign?.devices?.length)
          yield* db
            .delete(schema.groupDevice)
            .where(
              and(
                eq(schema.groupDevice.groupId, groupId),
                inArray(schema.groupDevice.deviceId, body.unassign.devices),
              ),
            );
        if (body.unassign?.policies?.length)
          yield* db
            .delete(schema.groupPolicy)
            .where(
              and(
                eq(schema.groupPolicy.groupId, groupId),
                inArray(schema.groupPolicy.policyId, body.unassign.policies),
              ),
            );

        // Device membership changes affect those devices; policy membership
        // changes affect every device in the group. Deduplicate in the helper.
        const affectedDevices = [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ];
        if (body.assign?.policies?.length || body.unassign?.policies?.length)
          affectedDevices.push(...(yield* applePush.deviceIdsInGroups([groupId])));
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "group.members_changed", "group", groupId, {
          assignDevices: body.assign?.devices?.length ?? 0,
          unassignDevices: body.unassign?.devices?.length ?? 0,
          assignPolicies: body.assign?.policies?.length ?? 0,
          unassignPolicies: body.unassign?.policies?.length ?? 0,
        });
        return ok;
      }),
    syncGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        const affected: Array<string> = [];
        for (const groupId of ids) {
          const group = yield* db.query.enterpriseGroup.findFirst({
            where: { id: groupId, organizationId: tenantId },
          });
          if (group) affected.push(...(yield* applePush.deviceIdsInGroups([groupId])));
        }
        yield* applePush.pushAppleDevices(affected);
        return ok;
      }),
    duplicateGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const source = yield* assertTenantGroup(ctx.organization.id, groupId);
        const body = payload as { name?: string };
        const newId = id();
        yield* db.insert(schema.enterpriseGroup).values({
          id: newId,
          organizationId: ctx.organization.id,
          name: body.name ?? `${source.name} [duplicated]`,
          notes: source.notes,
          createdAt: now(),
          updatedAt: now(),
        });
        const devices = yield* db
          .select()
          .from(schema.groupDevice)
          .where(eq(schema.groupDevice.groupId, groupId));
        const policies = yield* db
          .select()
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.groupId, groupId));
        if (devices.length)
          yield* db
            .insert(schema.groupDevice)
            .values(
              devices.map((d: EnterpriseGroupDevice) => ({ groupId: newId, deviceId: d.deviceId })),
            );
        if (policies.length)
          yield* db.insert(schema.groupPolicy).values(
            policies.map((p: EnterpriseGroupPolicy) => ({
              groupId: newId,
              policyId: p.policyId,
            })),
          );
        return { id: newId };
      }),
    createPolicy: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { name: string; notes?: string | null };
        const policyId = id();
        yield* db.insert(schema.policy).values({
          id: policyId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          createdAt: now(),
          updatedAt: now(),
        });
        return { id: policyId };
      }),
    deletePolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const deleted: Array<string> = [];
        const failed: Array<{ id: string; reason: string }> = [];
        const affectedDevices: Array<string> = [];
        for (const policyId of ids) {
          // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped row
          // first, then delete it by the same predicate.
          const existing = yield* db.query.policy.findFirst({
            where: { id: policyId, organizationId: ctx.organization.id },
          });
          if (!existing) {
            failed.push({ id: policyId, reason: "notFound" });
            continue;
          }
          affectedDevices.push(...(yield* applePush.deviceIdsInPolicies([policyId])));
          yield* db
            .delete(schema.policy)
            .where(
              and(
                eq(schema.policy.id, policyId),
                eq(schema.policy.organizationId, ctx.organization.id),
              ),
            );
          deleted.push(policyId);
        }
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "policy.deleted", "policy", null, { ids: [...deleted] });
        return { deleted, failed };
      }),
    patchPolicy: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as {
          name?: string;
          notes?: string | null;
          configurations?: Record<string, unknown>;
        };
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
          .set({ name: body.name, notes: body.notes, updatedAt: now() })
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
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* audit(ctx, "policy.updated", "policy", policyId, {
          fields: Object.keys(body),
          configurations: Object.keys(body.configurations ?? {}),
        });
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
    syncPolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        const affected: Array<string> = [];
        for (const policyId of ids) {
          const policy = yield* db.query.policy.findFirst({
            where: { id: policyId, organizationId: tenantId },
          });
          if (policy) affected.push(...(yield* applePush.deviceIdsInPolicies([policyId])));
        }
        yield* applePush.pushAppleDevices(affected);
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
    listDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* db
          .select()
          .from(schema.device)
          .where(eq(schema.device.organizationId, ctx.organization.id));
        return { rows: rows.map(rowDevice) };
      }),
    getDevice: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });
        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        return rowDevice(row);
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
        return rowGroup(row);
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
        const body = payload as { returnUrl: string };
        const customer = yield* ensureStripeCustomer(ctx.organization);
        const result = yield* stripe.billingPortal.sessions.create({
          customer,
          return_url: body.returnUrl,
        });
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
    .handle("getTenant", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getTenant(request, params.tenantId)),
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
    .handle("listAuditLog", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAuditLog(request, params.tenantId),
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
    .handle("getEnrollment", ({ params, query }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getEnrollment(params.id, query.code)),
    )
    .handle("getTenantEnrollment", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantEnrollment(request, params.tenantId),
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
    .handle("listDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listDevices(request, params.tenantId)),
    )
    .handle("getDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDevice(request, params.tenantId, params.id),
      ),
    )
    .handle("deleteDevices", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevices(request, params.tenantId, payload),
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
    .handle("deviceUnenroll", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceUnenroll(request, params.tenantId, params.id),
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
