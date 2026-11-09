import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
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
import { and, count, eq, inArray } from "drizzle-orm";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import { enterpriseEnrollmentProfile } from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";
import { createEnterpriseAuth } from "./auth.ts";
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
}: EnterpriseServiceConfig) => {
  const auth = authService ?? createEnterpriseAuth({ db, schema, origin });
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
      yield* db.insert(schema.enterpriseEnrollment).values(enrollment).onConflictDoNothing();
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

  const service: Record<
    string,
    (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>
  > = {
    me: (request) =>
      Effect.gen(function* () {
        const resolved = yield* auth.requireUser({ headers: request.headers });
        const { user } = resolved;
        const tenants = yield* listTenantInfo(user.id);
        const activeOrganizationId =
          "session" in resolved ? resolved.session.activeOrganizationId : undefined;
        const activeTenant =
          tenants.find((tenant: { id: string }) => tenant.id === activeOrganizationId) ??
          tenants[0];
        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image,
          },
          activeTenant,
          tenants,
          billing: activeTenant ? yield* billingSummary(activeTenant.id) : undefined,
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
    deleteMe: () =>
      Effect.succeed({
        error:
          "Delete user is currently not supported while organizations and billing are managed by Mattrax.",
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
        yield* db
          .insert(schema.enterpriseEnrollment)
          .values({
            id: tenantId,
            organizationId: tenantId,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .onConflictDoNothing();
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
        yield* requireTenant(request, tenantId, "write");
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
        yield* requireTenant(request, tenantId, "write");
        const { user } = yield* auth.requireUser({ headers: request.headers });
        const body = payload as { email: string; role?: string; resend?: boolean };
        const invitationId = id();
        const timestamp = now();
        yield* db.insert(schema.invitation).values({
          id: invitationId,
          organizationId: tenantId,
          inviterId: user.id,
          email: body.email,
          role: body.role ?? "member",
          status: "pending",
          expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return { id: invitationId };
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
        yield* requireTenant(request, tenantId, "write");
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
        return ok;
      }),
    removeTenantUser: (request, tenantId, memberId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
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
        return { id: newId };
      }),
    getApns: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });
        return {
          configured: apns !== undefined,
          email: apns?.email ?? null,
          topic: apns?.topic ?? null,
        };
      }),
    uploadApns: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body = payload as { email: string; cert: string };
        const topic =
          body.cert.match(/UID=([^,\n]+)/)?.[1] ?? `com.apple.mgmt.External.${ctx.organization.id}`;
        yield* db
          .insert(schema.applePushCertificate)
          .values({
            organizationId: ctx.organization.id,
            email: body.email,
            certPem: body.cert,
            topic,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: schema.applePushCertificate.organizationId,
            set: { email: body.email, certPem: body.cert, topic, updatedAt: now() },
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
        return ok;
      }),
    deviceAction: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
        return ok;
      }),
    deviceUnenroll: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
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
            .values(body.devices.map((deviceId) => ({ groupId, deviceId })))
            .onConflictDoNothing();
        if (body.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .values(body.policies.map((policyId) => ({ groupId, policyId })))
            .onConflictDoNothing();
        return { id: groupId };
      }),
    deleteGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const deleted: Array<string> = [];
        const failed: Array<{ id: string; reason: string }> = [];
        for (const groupId of ids) {
          const result = yield* db
            .delete(schema.enterpriseGroup)
            .where(
              and(
                eq(schema.enterpriseGroup.id, groupId),
                eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
              ),
            )
            .returning({ id: schema.enterpriseGroup.id });
          if (result.length) deleted.push(groupId);
          else failed.push({ id: groupId, reason: "notFound" });
        }
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
            .values(body.assign.devices.map((deviceId) => ({ groupId, deviceId })))
            .onConflictDoNothing();
        if (body.assign?.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .values(body.assign.policies.map((policyId) => ({ groupId, policyId })))
            .onConflictDoNothing();
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
        return ok;
      }),
    syncGroups: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
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
        for (const policyId of ids) {
          const result = yield* db
            .delete(schema.policy)
            .where(
              and(
                eq(schema.policy.id, policyId),
                eq(schema.policy.organizationId, ctx.organization.id),
              ),
            )
            .returning({ id: schema.policy.id });
          if (result.length) deleted.push(policyId);
          else failed.push({ id: policyId, reason: "notFound" });
        }
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
        yield* db
          .update(schema.policy)
          .set({ name: body.name, notes: body.notes, updatedAt: now() })
          .where(eq(schema.policy.id, policyId));
        for (const [kind, data] of Object.entries(body.configurations ?? {})) {
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
              .onConflictDoUpdate({
                target: [schema.configuration.kind, schema.configuration.policyId],
                set: { data, hash },
              });
          }
        }
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
    syncPolicies: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");
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
    previewMobileconfig: (payload) => Effect.succeed({ payload }),
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
    authSession: (request) => auth.authSession(webRequestFromRequest(request, origin)),
    authRegister: (request, payload) =>
      auth.authRegister(webRequestFromRequest(request, origin), payload),
    authLogin: (request, payload) =>
      auth.authLogin(webRequestFromRequest(request, origin), payload),
    authLogout: (request) => auth.authLogout(webRequestFromRequest(request, origin)),
    authForgotPassword: (_request, payload) => auth.authForgotPassword(payload),
    authResetPassword: (_request, payload) => auth.authResetPassword(payload),
    authChangePassword: (request, payload) =>
      auth.authChangePassword(webRequestFromRequest(request, origin), payload),
    authChangeEmail: (request, payload) =>
      auth.authChangeEmail(webRequestFromRequest(request, origin), payload),
    authVerifyEmailChange: (_request, payload) => auth.authVerifyEmailChange(payload),
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
    .handle("authSession", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authSession(request)),
    )
    .handle("authRegister", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authRegister(request, payload)),
    )
    .handle("authLogin", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authLogin(request, payload)),
    )
    .handle("authLogout", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authLogout(request)),
    )
    .handle("authForgotPassword", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authForgotPassword(request, payload)),
    )
    .handle("authResetPassword", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authResetPassword(request, payload)),
    )
    .handle("authChangePassword", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authChangePassword(request, payload)),
    )
    .handle("authChangeEmail", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.authChangeEmail(request, payload)),
    )
    .handle("authVerifyEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.authVerifyEmailChange(request, payload),
      ),
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
    .handle("deviceAction", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceAction(request, params.tenantId, params.id),
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
