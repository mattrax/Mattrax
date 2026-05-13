// @ts-nocheck
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseNotFound,
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
  EnterpriseStripeError,
  EnterpriseUnauthorized,
  enterpriseApi,
} from "@mattrax/enterprise-domain";
import { and, count, eq, inArray } from "drizzle-orm";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import { enterpriseEnrollmentProfile } from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";
import { createEnterpriseAuth } from "./auth.ts";
import { base64ToBytes, bytesToBase64, policyApplicationKey, sha256Hex } from "./policyApplicationStorage.ts";

export type EnterpriseHandlersConfig = {
  readonly db: any;
  readonly schema: any;
  readonly origin: string;
  readonly stripeClient: any;
  readonly storage: any;
};

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

const webRequestFromRequest = (request: HttpServerRequest, origin: string) => new Request(origin, { headers: headersFromRequest(request) });

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();
  return (date instanceof Date ? date : new Date(date)).toISOString();
};

const hashJson = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

type OrgContext = {
  readonly user: any;
  readonly organization: any;
  readonly member: any;
};

const canWriteTenant = (role: string) => role.split(",").some((item) => item === "owner" || item === "admin");
const canDeleteTenant = (role: string) => role.split(",").includes("owner");

const catchDb = (cause: unknown) => {
  console.error("Database error:", cause);
  return new EnterpriseDbError({ message: "Database operation failed" });
};

const catchStripe = (cause: unknown) => {
  console.error("Stripe error:", cause);
  return new EnterpriseStripeError({ message: "Stripe operation failed" });
};

const catchR2 = (cause: unknown) => {
  if (cause instanceof EnterpriseR2FileNotFound || cause instanceof EnterpriseR2InternalError) return cause;
  console.error("R2 error:", cause);
  return new EnterpriseR2InternalError({ message: "R2 operation failed" });
};

export const createEnterpriseService = ({ db, schema, origin, stripeClient, storage }: EnterpriseHandlersConfig) => {
  const auth = createEnterpriseAuth({ db, schema, origin });

  const requireTenant = (request: HttpServerRequest, tenantId: string, access: "read" | "write" | "delete" = "read") => Effect.gen(function* () {
    const { user } = yield* auth.requireUser({ headers: request.headers });
    const member = yield* Effect.tryPromise({ try: () => db.query.member.findFirst({ where: and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, tenantId)) }), catch: catchDb });
    if (!member) return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));
    if (access === "write" && !canWriteTenant(member.role)) return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));
    if (access === "delete" && !canDeleteTenant(member.role)) return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));

    const organization = yield* Effect.tryPromise({ try: () => db.query.organization.findFirst({ where: eq(schema.organization.id, member.organizationId) }), catch: catchDb });
    if (!organization) return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

    return { user, organization, member };
  });

  const ensureStripeCustomer = async (organization: any) => {
    if (organization.stripeCustomerId) return organization.stripeCustomerId;

    let stripeCustomer: any;
    try {
      stripeCustomer = (await stripeClient.customers.search({
        query: `metadata["organizationId"]:"${organization.id}" AND metadata["customerType"]:"organization"`,
        limit: 1,
      })).data[0];
    } catch {
      for await (const customer of stripeClient.customers.list({ limit: 100 })) {
        if (customer.metadata?.organizationId === organization.id && customer.metadata?.customerType === "organization") {
          stripeCustomer = customer;
          break;
        }
      }
    }

    stripeCustomer ??= await stripeClient.customers.create({
      name: organization.name,
      metadata: { organizationId: organization.id, customerType: "organization" },
    });

    await db.update(schema.organization).set({ stripeCustomerId: stripeCustomer.id }).where(eq(schema.organization.id, organization.id));
    return stripeCustomer.id;
  };

  const listTenantInfo = async (userId: string) => {
    const rows = await db.select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      logo: schema.organization.logo,
      role: schema.member.role,
    }).from(schema.member).innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId)).where(eq(schema.member.userId, userId));
    return rows;
  };

  const memberCount = async (tenantId: string) => {
    const [members] = await db.select({ value: count() }).from(schema.member).where(eq(schema.member.organizationId, tenantId));
    return members?.value ?? 0;
  };

  const assertTenantDevices = (tenantId: string, ids: ReadonlyArray<string>) => Effect.gen(function* () {
    if (ids.length === 0) return;
    const rows = yield* Effect.tryPromise({ try: () => db.select({ id: schema.device.id }).from(schema.device).where(and(eq(schema.device.organizationId, tenantId), inArray(schema.device.id, [...ids]))), catch: catchDb });
    if (rows.length !== new Set(ids).size) return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
  });

  const assertTenantPolicies = (tenantId: string, ids: ReadonlyArray<string>) => Effect.gen(function* () {
    if (ids.length === 0) return;
    const rows = yield* Effect.tryPromise({ try: () => db.select({ id: schema.policy.id }).from(schema.policy).where(and(eq(schema.policy.organizationId, tenantId), inArray(schema.policy.id, [...ids]))), catch: catchDb });
    if (rows.length !== new Set(ids).size) return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
  });

  const assertTenantGroup = (tenantId: string, groupId: string) => Effect.gen(function* () {
    const group = yield* Effect.tryPromise({ try: () => db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, tenantId)) }), catch: catchDb });
    if (!group) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
    return group;
  });

  const billingSummary = async (organizationId: string) => {
    const [subscription] = await db.select().from(schema.subscription).where(eq(schema.subscription.referenceId, organizationId)).limit(1);
    const [devices] = await db.select({ value: count() }).from(schema.device).where(and(eq(schema.device.organizationId, organizationId), eq(schema.device.status, "enrolled")));
    return {
      plan: subscription?.plan,
      status: subscription?.status,
      billableDevices: devices?.value ?? 0,
      subscriptionId: subscription?.stripeSubscriptionId ?? null,
    };
  };

  const rowDevice = (row: any) => ({
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

  const rowGroup = (row: any, devicesCount = 0, policiesCount = 0) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    devicesCount,
    policiesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPolicy = async (row: any, withConfigurations = false) => {
    const base: Record<string, unknown> = {
      id: row.id,
      name: row.name,
      notes: row.notes,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
    if (withConfigurations) {
      const configurations = await db.select().from(schema.configuration).where(eq(schema.configuration.policyId, row.id));
      base.configurations = Object.fromEntries(configurations.map((item: any) => [item.kind, item.data]));
    }
    return base;
  };

  const rowEnrollment = (row: any) => ({
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

  const getOrCreateEnrollment = async (organizationId: string) => {
    const existing = await db.query.enterpriseEnrollment.findFirst({ where: eq(schema.enterpriseEnrollment.organizationId, organizationId) });
    if (existing) return existing;
    const timestamp = now();
    const enrollment = { id: id(), organizationId, createdAt: timestamp, updatedAt: timestamp };
    await db.insert(schema.enterpriseEnrollment).values(enrollment).onConflictDoNothing();
    return await db.query.enterpriseEnrollment.findFirst({ where: eq(schema.enterpriseEnrollment.organizationId, organizationId) }) ?? {
      ...enrollment,
      code: null,
      enabledApple: true,
      enabledWindows: true,
      enabledAndroid: false,
      enabledAssetTag: false,
      maxDevices: 100,
    };
  };

  return {
    me: (request) => Effect.gen(function* () {
      const { session, user } = yield* auth.requireUser({ headers: request.headers });
      const tenants = yield* Effect.tryPromise({ try: () => listTenantInfo(user.id), catch: catchDb });
      const activeTenant = tenants.find((tenant: any) => tenant.id === session.session?.activeOrganizationId) ?? tenants[0];
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
        billing: activeTenant ? yield* Effect.tryPromise({ try: () => billingSummary(activeTenant.id), catch: catchDb }) : undefined,
      };
    }),
    updateMe: (request, payload) => Effect.gen(function* () {
      const { user } = yield* auth.requireUser({ headers: request.headers });
      const body = payload as { name?: string; image?: string | null };
      yield* Effect.tryPromise({ try: () => db.update(schema.user).set({ name: body.name ?? user.name, image: body.image === undefined ? user.image : body.image, updatedAt: now() }).where(eq(schema.user.id, user.id)), catch: catchDb });
      return ok;
    }),
    deleteMe: () => Effect.succeed({ error: "Delete user is currently not supported while organizations and billing are managed by Mattrax." }),
    listTenants: (request) => Effect.gen(function* () {
      const { user } = yield* auth.requireUser({ headers: request.headers });
      const tenants = yield* Effect.tryPromise({ try: () => listTenantInfo(user.id), catch: catchDb });
      return { tenants };
    }),
    createTenant: (request, payload) => Effect.gen(function* () {
      const { user } = yield* auth.requireUser({ headers: request.headers });
      const body = payload as { name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> };
      const tenantId = id();
      const timestamp = now();
      yield* Effect.tryPromise({ try: () => db.insert(schema.organization).values({ id: tenantId, name: body.name, slug: body.slug, logo: body.logo ?? null, metadata: body.metadata ? JSON.stringify(body.metadata) : null, createdAt: timestamp, updatedAt: timestamp }), catch: catchDb });
      yield* Effect.tryPromise({ try: () => db.insert(schema.member).values({ id: id(), organizationId: tenantId, userId: user.id, role: "owner", createdAt: timestamp, updatedAt: timestamp }), catch: catchDb });
      yield* Effect.tryPromise({ try: () => db.insert(schema.enterpriseEnrollment).values({ id: tenantId, organizationId: tenantId, createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing(), catch: catchDb });
      return { id: tenantId };
    }),
    getTenant: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      return { ...ctx.organization, role: ctx.member.role, createdAt: iso(ctx.organization.createdAt) };
    }),
    patchTenant: (request, tenantId, payload) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const body = payload as any;
      yield* Effect.tryPromise({ try: () => db.update(schema.organization).set({ ...body, metadata: body.metadata === undefined ? undefined : body.metadata === null ? null : JSON.stringify(body.metadata), updatedAt: now() }).where(eq(schema.organization.id, tenantId)), catch: catchDb });
      return ok;
    }),
    deleteTenant: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "delete");
      const count = yield* Effect.tryPromise({ try: () => memberCount(tenantId), catch: catchDb });
      if (count > 1) return yield* Effect.fail(new EnterpriseConflict({ message: "Cannot delete a tenant with more than one user" }));
      yield* Effect.tryPromise({ try: () => db.delete(schema.organization).where(eq(schema.organization.id, tenantId)), catch: catchDb });
      return ok;
    }),
    listTenantUsers: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId);
      const users = yield* Effect.tryPromise({ try: () => db.select({ memberId: schema.member.id, userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.member.role, createdAt: schema.member.createdAt }).from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId)).where(eq(schema.member.organizationId, tenantId)), catch: catchDb });
      return { users: users.map((user: any) => ({ ...user, createdAt: iso(user.createdAt) })) };
    }),
    inviteTenantUser: (request, tenantId, payload) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const { user } = yield* auth.requireUser({ headers: request.headers });
      const body = payload as { email: string; role?: string; resend?: boolean };
      const invitationId = id();
      const timestamp = now();
      yield* Effect.tryPromise({ try: () => db.insert(schema.invitation).values({ id: invitationId, organizationId: tenantId, inviterId: user.id, email: body.email, role: body.role ?? "member", status: "pending", expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000), createdAt: timestamp, updatedAt: timestamp }), catch: catchDb });
      return { id: invitationId };
    }),
    listTenantInvitations: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const invitations = yield* Effect.tryPromise({ try: () => db.select().from(schema.invitation).where(eq(schema.invitation.organizationId, tenantId)), catch: catchDb });
      return { invitations: invitations.map((item: any) => ({ id: item.id, email: item.email, role: item.role, status: item.status, expiresAt: iso(item.expiresAt), createdAt: iso(item.createdAt) })) };
    }),
    cancelTenantInvitation: (request, tenantId, invitationId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const invitation = yield* Effect.tryPromise({ try: () => db.query.invitation.findFirst({ where: and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, tenantId)) }), catch: catchDb });
      if (!invitation) return yield* Effect.fail(new EnterpriseNotFound({ message: "Invitation not found" }));
      yield* Effect.tryPromise({ try: () => db.update(schema.invitation).set({ status: "canceled", updatedAt: now() }).where(eq(schema.invitation.id, invitationId)), catch: catchDb });
      return ok;
    }),
    patchTenantUser: (request, tenantId, memberId, payload) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const member = yield* Effect.tryPromise({ try: () => db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) }), catch: catchDb });
      if (!member) return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));
      const body = payload as { role: string };
      yield* Effect.tryPromise({ try: () => db.update(schema.member).set({ role: body.role, updatedAt: now() }).where(eq(schema.member.id, memberId)), catch: catchDb });
      return ok;
    }),
    removeTenantUser: (request, tenantId, memberId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      const count = yield* Effect.tryPromise({ try: () => memberCount(tenantId), catch: catchDb });
      if (count <= 1) return yield* Effect.fail(new EnterpriseConflict({ message: "Cannot remove the last tenant user; delete the tenant instead" }));
      const member = yield* Effect.tryPromise({ try: () => db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) }), catch: catchDb });
      if (!member) return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));
      yield* Effect.tryPromise({ try: () => db.delete(schema.member).where(eq(schema.member.id, memberId)), catch: catchDb });
      return ok;
    }),
    getEnrollment: (enrollmentId, code) => Effect.gen(function* () {
      const enrollment = yield* Effect.tryPromise({ try: () => db.query.enterpriseEnrollment.findFirst({ where: eq(schema.enterpriseEnrollment.id, enrollmentId) }), catch: catchDb });
      if (!enrollment) return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));
      const organization = yield* Effect.tryPromise({ try: () => db.query.organization.findFirst({ where: eq(schema.organization.id, enrollment.organizationId) }), catch: catchDb });
      if (!organization) return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));
      if (enrollment.code && enrollment.code !== code) return { name: organization.name, authenticated: false as const };

      const apns = yield* Effect.tryPromise({ try: () => db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, organization.id) }), catch: catchDb });
      const [deviceCount] = yield* Effect.tryPromise({ try: () => db.select({ value: count() }).from(schema.device).where(eq(schema.device.organizationId, organization.id)), catch: catchDb });
      const enabled = (deviceCount?.value ?? 0) <= enrollment.maxDevices;
      return {
        name: organization.name,
        authenticated: true as const,
        apple: !enabled || !enrollment.enabledApple
          ? { error: "Apple enrollment is disabled! Contact your administrator." }
          : apns?.topic
          ? { profile: yield* Effect.tryPromise({ try: () => Effect.runPromise(serializePlist(enterpriseEnrollmentProfile({ origin, topic: apns.topic, organizationId: organization.id }))), catch: catchDb }) }
          : { error: "Apple management is not configured! Contact your administrator." },
        windows: !enabled || !enrollment.enabledWindows ? { error: "Windows enrollment is disabled! Contact your administrator." } : "available",
        android: !enabled || !enrollment.enabledAndroid ? { error: "Android enrollment is disabled! Contact your administrator." } : "available",
        assetTag: enabled && enrollment.enabledAssetTag,
      };
    }),
    getTenantEnrollment: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const enrollment = yield* Effect.tryPromise({ try: () => getOrCreateEnrollment(ctx.organization.id), catch: catchDb });
      return rowEnrollment(enrollment);
    }),
    patchTenantEnrollment: (request, tenantId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      yield* Effect.tryPromise({ try: () => getOrCreateEnrollment(ctx.organization.id), catch: catchDb });
      const body = payload as { code?: string | null; enabledApple?: boolean; enabledWindows?: boolean; enabledAndroid?: boolean; enabledAssetTag?: boolean; maxDevices?: number };
      yield* Effect.tryPromise({ try: () => db.update(schema.enterpriseEnrollment).set({
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.enabledApple !== undefined ? { enabledApple: body.enabledApple } : {}),
        ...(body.enabledWindows !== undefined ? { enabledWindows: body.enabledWindows } : {}),
        ...(body.enabledAndroid !== undefined ? { enabledAndroid: body.enabledAndroid } : {}),
        ...(body.enabledAssetTag !== undefined ? { enabledAssetTag: body.enabledAssetTag } : {}),
        ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
        updatedAt: now(),
      }).where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id)), catch: catchDb });
      return ok;
    }),
    resetTenantEnrollment: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      yield* Effect.tryPromise({ try: () => getOrCreateEnrollment(ctx.organization.id), catch: catchDb });
      const newId = id();
      yield* Effect.tryPromise({ try: () => db.update(schema.enterpriseEnrollment).set({ id: newId, updatedAt: now() }).where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id)), catch: catchDb });
      return { id: newId };
    }),
    getApns: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const apns = yield* Effect.tryPromise({ try: () => db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, ctx.organization.id) }), catch: catchDb });
      return { configured: apns !== undefined, email: apns?.email ?? null, topic: apns?.topic ?? null };
    }),
    uploadApns: (request, tenantId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { email: string; cert: string };
      const topic = body.cert.match(/UID=([^,\n]+)/)?.[1] ?? `com.apple.mgmt.External.${ctx.organization.id}`;
      yield* Effect.tryPromise({ try: () => db.insert(schema.applePushCertificate).values({ organizationId: ctx.organization.id, email: body.email, certPem: body.cert, topic, updatedAt: now() }).onConflictDoUpdate({ target: schema.applePushCertificate.organizationId, set: { email: body.email, certPem: body.cert, topic, updatedAt: now() } }), catch: catchDb });
      return ok;
    }),
    deleteDevices: (request, tenantId, ids) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      if (ids.length > 0) yield* Effect.tryPromise({ try: () => db.delete(schema.device).where(and(eq(schema.device.organizationId, ctx.organization.id), inArray(schema.device.id, [...ids]))), catch: catchDb });
      return ok;
    }),
    patchDevice: (request, tenantId, deviceId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null; assetTag?: string | null };
      yield* Effect.tryPromise({ try: () => db.update(schema.device).set({ name: body.name, notes: body.notes, assetTag: body.assetTag }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id))), catch: catchDb });
      return ok;
    }),
    deviceAction: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      return ok;
    }),
    deviceUnenroll: (request, tenantId, deviceId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      yield* Effect.tryPromise({ try: () => db.update(schema.device).set({ status: "unenrolling" }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id), eq(schema.device.status, "enrolled"))), catch: catchDb });
      return ok;
    }),
    createGroup: (request, tenantId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { name: string; notes?: string | null; devices?: Array<string>; policies?: Array<string> };
      yield* assertTenantDevices(ctx.organization.id, body.devices ?? []);
      yield* assertTenantPolicies(ctx.organization.id, body.policies ?? []);
      const groupId = id();
      yield* Effect.tryPromise({ try: () => db.insert(schema.enterpriseGroup).values({ id: groupId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() }), catch: catchDb });
      if (body.devices?.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupDevice).values(body.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing(), catch: catchDb });
      if (body.policies?.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupPolicy).values(body.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing(), catch: catchDb });
      return { id: groupId };
    }),
    deleteGroups: (request, tenantId, ids) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const groupId of ids) {
        const result = yield* Effect.tryPromise({ try: () => db.delete(schema.enterpriseGroup).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id))).returning({ id: schema.enterpriseGroup.id }), catch: catchDb });
        if (result.length) deleted.push(groupId); else failed.push({ id: groupId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchGroup: (request, tenantId, groupId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null };
      yield* Effect.tryPromise({ try: () => db.update(schema.enterpriseGroup).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id))), catch: catchDb });
      return ok;
    }),
    patchGroupMembers: (request, tenantId, groupId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      yield* assertTenantGroup(ctx.organization.id, groupId);
      const body = payload as { assign?: { devices?: Array<string>; policies?: Array<string> }; unassign?: { devices?: Array<string>; policies?: Array<string> } };
      yield* assertTenantDevices(ctx.organization.id, [...(body.assign?.devices ?? []), ...(body.unassign?.devices ?? [])]);
      yield* assertTenantPolicies(ctx.organization.id, [...(body.assign?.policies ?? []), ...(body.unassign?.policies ?? [])]);
      if (body.assign?.devices?.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupDevice).values(body.assign.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing(), catch: catchDb });
      if (body.assign?.policies?.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupPolicy).values(body.assign.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing(), catch: catchDb });
      if (body.unassign?.devices?.length) yield* Effect.tryPromise({ try: () => db.delete(schema.groupDevice).where(and(eq(schema.groupDevice.groupId, groupId), inArray(schema.groupDevice.deviceId, body.unassign.devices))), catch: catchDb });
      if (body.unassign?.policies?.length) yield* Effect.tryPromise({ try: () => db.delete(schema.groupPolicy).where(and(eq(schema.groupPolicy.groupId, groupId), inArray(schema.groupPolicy.policyId, body.unassign.policies))), catch: catchDb });
      return ok;
    }),
    syncGroups: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicateGroup: (request, tenantId, groupId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const source = yield* assertTenantGroup(ctx.organization.id, groupId);
      const body = payload as { name?: string };
      const newId = id();
      yield* Effect.tryPromise({ try: () => db.insert(schema.enterpriseGroup).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() }), catch: catchDb });
      const devices = yield* Effect.tryPromise({ try: () => db.select().from(schema.groupDevice).where(eq(schema.groupDevice.groupId, groupId)), catch: catchDb });
      const policies = yield* Effect.tryPromise({ try: () => db.select().from(schema.groupPolicy).where(eq(schema.groupPolicy.groupId, groupId)), catch: catchDb });
      if (devices.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupDevice).values(devices.map((d: any) => ({ groupId: newId, deviceId: d.deviceId }))), catch: catchDb });
      if (policies.length) yield* Effect.tryPromise({ try: () => db.insert(schema.groupPolicy).values(policies.map((p: any) => ({ groupId: newId, policyId: p.policyId }))), catch: catchDb });
      return { id: newId };
    }),
    createPolicy: (request, tenantId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { name: string; notes?: string | null };
      const policyId = id();
      yield* Effect.tryPromise({ try: () => db.insert(schema.policy).values({ id: policyId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() }), catch: catchDb });
      return { id: policyId };
    }),
    deletePolicies: (request, tenantId, ids) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const policyId of ids) {
        const result = yield* Effect.tryPromise({ try: () => db.delete(schema.policy).where(and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id))).returning({ id: schema.policy.id }), catch: catchDb });
        if (result.length) deleted.push(policyId); else failed.push({ id: policyId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchPolicy: (request, tenantId, policyId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null; configurations?: Record<string, unknown> };
      const policy = yield* Effect.tryPromise({ try: () => db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) }), catch: catchDb });
      if (!policy) return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
      yield* Effect.tryPromise({ try: () => db.update(schema.policy).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(eq(schema.policy.id, policyId)), catch: catchDb });
      for (const [kind, data] of Object.entries(body.configurations ?? {})) {
        if (data === null) {
          yield* Effect.tryPromise({ try: () => db.delete(schema.configuration).where(and(eq(schema.configuration.policyId, policyId), eq(schema.configuration.kind, kind))), catch: catchDb });
        } else {
          const hash = yield* Effect.tryPromise({ try: () => hashJson(data), catch: catchDb });
          yield* Effect.tryPromise({ try: () => db.insert(schema.configuration).values({ policyId, kind, data, hash }).onConflictDoUpdate({ target: [schema.configuration.kind, schema.configuration.policyId], set: { data, hash } }), catch: catchDb });
        }
      }
      return ok;
    }),
    uploadPolicyApplication: (request, tenantId, policyId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      yield* assertTenantPolicies(ctx.organization.id, [policyId]);
      const body = payload as { fileName: string; contentType?: string; content: string };
      const bytes = base64ToBytes(body.content);
      const sha256 = yield* Effect.tryPromise({ try: () => sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), catch: catchR2 });
      const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
      yield* Effect.tryPromise({ try: () => storage.put(key, bytes, { httpMetadata: body.contentType ? { contentType: body.contentType } : undefined, customMetadata: { fileName: body.fileName } }), catch: catchR2 });
      return { sha256, fileName: body.fileName, contentType: body.contentType ?? null, size: bytes.byteLength };
    }),
    downloadPolicyApplication: (request, tenantId, policyId, sha256) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      yield* assertTenantPolicies(ctx.organization.id, [policyId]);
      const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
      const object = yield* Effect.tryPromise({ try: () => storage.get(key), catch: catchR2 });
      if (!object) return yield* Effect.fail(new EnterpriseR2FileNotFound({ message: "Policy application file not found" }));
      const bytes = yield* Effect.tryPromise({ try: () => object.arrayBuffer(), catch: catchR2 });
      return {
        sha256,
        fileName: object.customMetadata?.fileName ?? sha256,
        contentType: object.httpMetadata?.contentType ?? null,
        size: object.size ?? bytes.byteLength,
        content: bytesToBase64(new Uint8Array(bytes)),
      };
    }),
    syncPolicies: (request, tenantId) => Effect.gen(function* () {
      yield* requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicatePolicy: (request, tenantId, policyId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const source = yield* Effect.tryPromise({ try: () => db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) }), catch: catchDb });
      if (!source) return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
      const body = payload as { name?: string };
      const newId = id();
      yield* Effect.tryPromise({ try: () => db.insert(schema.policy).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() }), catch: catchDb });
      const configurations = yield* Effect.tryPromise({ try: () => db.select().from(schema.configuration).where(eq(schema.configuration.policyId, policyId)), catch: catchDb });
      if (configurations.length) yield* Effect.tryPromise({ try: () => Promise.resolve(db.insert(schema.configuration).values(configurations.map((c: any) => ({ kind: c.kind, policyId: newId, data: c.data, hash: c.hash })))), catch: catchDb });
      return { id: newId };
    }),
    previewMobileconfig: (payload) => Effect.succeed({ payload }),
    listDevices: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const rows = yield* Effect.tryPromise({ try: () => db.select().from(schema.device).where(eq(schema.device.organizationId, ctx.organization.id)), catch: catchDb });
      return { rows: rows.map(rowDevice) };
    }),
    getDevice: (request, tenantId, deviceId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const row = yield* Effect.tryPromise({ try: () => db.query.device.findFirst({ where: and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)) }), catch: catchDb });
      if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
      return rowDevice(row);
    }),
    listGroups: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const rows = yield* Effect.tryPromise({ try: () => db.select().from(schema.enterpriseGroup).where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id)), catch: catchDb });
      return { rows: rows.map((row: any) => rowGroup(row)) };
    }),
    getGroup: (request, tenantId, groupId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const row = yield* Effect.tryPromise({ try: () => db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)) }), catch: catchDb });
      if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
      return rowGroup(row);
    }),
    listPolicies: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const rows = yield* Effect.tryPromise({ try: () => db.select().from(schema.policy).where(eq(schema.policy.organizationId, ctx.organization.id)), catch: catchDb });
      return { rows: yield* Effect.all(rows.map((row: any) => Effect.tryPromise({ try: () => rowPolicy(row), catch: catchDb }))) };
    }),
    getPolicy: (request, tenantId, policyId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      const row = yield* Effect.tryPromise({ try: () => db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) }), catch: catchDb });
      if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
      return yield* Effect.tryPromise({ try: () => rowPolicy(row, true), catch: catchDb });
    }),
    billing: (request, tenantId) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId);
      return yield* Effect.tryPromise({ try: () => billingSummary(ctx.organization.id), catch: catchDb });
    }),
    billingPortal: (request, tenantId, payload) => Effect.gen(function* () {
      const ctx = yield* requireTenant(request, tenantId, "write");
      const body = payload as { returnUrl: string };
      yield* Effect.tryPromise({ try: () => ensureStripeCustomer(ctx.organization), catch: catchStripe });
      const customer = yield* Effect.tryPromise({ try: () => ensureStripeCustomer(ctx.organization), catch: catchStripe });
      const result = yield* Effect.tryPromise({ try: () => stripeClient.billingPortal.sessions.create({ customer, return_url: body.returnUrl }), catch: catchStripe });
      return { url: result.url ?? body.returnUrl };
    }),
    authSession: (request) => auth.authSession(webRequestFromRequest(request, origin)),
    authRegister: (request, payload) => auth.authRegister(webRequestFromRequest(request, origin), payload),
    authLogin: (request, payload) => auth.authLogin(webRequestFromRequest(request, origin), payload),
    authLogout: (request) => auth.authLogout(webRequestFromRequest(request, origin)),
    authForgotPassword: (_request, payload) => auth.authForgotPassword(payload),
    authResetPassword: (_request, payload) => auth.authResetPassword(payload),
    authChangePassword: (request, payload) => auth.authChangePassword(webRequestFromRequest(request, origin), payload),
    authChangeEmail: (request, payload) => auth.authChangeEmail(webRequestFromRequest(request, origin), payload),
    authVerifyEmailChange: (_request, payload) => auth.authVerifyEmailChange(payload),
    listApiTokens: (request) => auth.listApiTokens(webRequestFromRequest(request, origin)),
    createApiToken: (request, payload) => auth.createApiToken(webRequestFromRequest(request, origin), payload),
    revokeApiToken: (request, tokenId) => auth.revokeApiToken(webRequestFromRequest(request, origin), tokenId),
  };
};

export const enterpriseHandlers = (config: EnterpriseHandlersConfig) => {
  const service: any = createEnterpriseService(config);

  return (handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>) =>
    handlers
      .handle("authSession", ({ request }) => service.authSession(request))
      .handle("authRegister", ({ request, payload }) => service.authRegister(request, payload))
      .handle("authLogin", ({ request, payload }) => service.authLogin(request, payload))
      .handle("authLogout", ({ request }) => service.authLogout(request))
      .handle("authForgotPassword", ({ request, payload }) => service.authForgotPassword(request, payload))
      .handle("authResetPassword", ({ request, payload }) => service.authResetPassword(request, payload))
      .handle("authChangePassword", ({ request, payload }) => service.authChangePassword(request, payload))
      .handle("authChangeEmail", ({ request, payload }) => service.authChangeEmail(request, payload))
      .handle("authVerifyEmailChange", ({ request, payload }) => service.authVerifyEmailChange(request, payload))
      .handle("listApiTokens", ({ request }) => service.listApiTokens(request))
      .handle("createApiToken", ({ request, payload }) => service.createApiToken(request, payload))
      .handle("revokeApiToken", ({ request, params }) => service.revokeApiToken(request, params.tokenId))
      .handle("me", ({ request }) => service.me(request))
      .handle("updateMe", ({ request, payload }) => service.updateMe(request, payload))
      .handle("deleteMe", ({ request }) => service.deleteMe(request))
      .handle("listTenants", ({ request }) => service.listTenants(request))
      .handle("createTenant", ({ request, payload }) => service.createTenant(request, payload))
      .handle("getTenant", ({ request, params }) => service.getTenant(request, params.tenantId))
      .handle("patchTenant", ({ request, params, payload }) => service.patchTenant(request, params.tenantId, payload))
      .handle("deleteTenant", ({ request, params }) => service.deleteTenant(request, params.tenantId))
      .handle("listTenantUsers", ({ request, params }) => service.listTenantUsers(request, params.tenantId))
      .handle("inviteTenantUser", ({ request, params, payload }) => service.inviteTenantUser(request, params.tenantId, payload))
      .handle("listTenantInvitations", ({ request, params }) => service.listTenantInvitations(request, params.tenantId))
      .handle("cancelTenantInvitation", ({ request, params }) => service.cancelTenantInvitation(request, params.tenantId, params.invitationId))
      .handle("patchTenantUser", ({ request, params, payload }) => service.patchTenantUser(request, params.tenantId, params.memberId, payload))
      .handle("removeTenantUser", ({ request, params }) => service.removeTenantUser(request, params.tenantId, params.memberId))
      .handle("getEnrollment", ({ params, query }) => service.getEnrollment(params.id, query.code))
      .handle("getTenantEnrollment", ({ request, params }) => service.getTenantEnrollment(request, params.tenantId))
      .handle("patchTenantEnrollment", ({ request, params, payload }) => service.patchTenantEnrollment(request, params.tenantId, payload))
      .handle("resetTenantEnrollment", ({ request, params }) => service.resetTenantEnrollment(request, params.tenantId))
      .handle("getApns", ({ request, params }) => service.getApns(request, params.tenantId))
      .handle("uploadApns", ({ request, params, payload }) => service.uploadApns(request, params.tenantId, payload))
      .handle("listDevices", ({ request, params }) => service.listDevices(request, params.tenantId))
      .handle("getDevice", ({ request, params }) => service.getDevice(request, params.tenantId, params.id))
      .handle("deleteDevices", ({ request, params, payload }) => service.deleteDevices(request, params.tenantId, payload))
      .handle("patchDevice", ({ request, params, payload }) => service.patchDevice(request, params.tenantId, params.id, payload))
      .handle("deviceAction", ({ request, params }) => service.deviceAction(request, params.tenantId, params.id))
      .handle("deviceUnenroll", ({ request, params }) => service.deviceUnenroll(request, params.tenantId, params.id))
      .handle("listGroups", ({ request, params }) => service.listGroups(request, params.tenantId))
      .handle("getGroup", ({ request, params }) => service.getGroup(request, params.tenantId, params.id))
      .handle("createGroup", ({ request, params, payload }) => service.createGroup(request, params.tenantId, payload))
      .handle("deleteGroups", ({ request, params, payload }) => service.deleteGroups(request, params.tenantId, payload))
      .handle("patchGroup", ({ request, params, payload }) => service.patchGroup(request, params.tenantId, params.id, payload))
      .handle("patchGroupMembers", ({ request, params, payload }) => service.patchGroupMembers(request, params.tenantId, params.id, payload))
      .handle("syncGroups", ({ request, params, payload }) => service.syncGroups(request, params.tenantId, payload))
      .handle("duplicateGroup", ({ request, params, payload }) => service.duplicateGroup(request, params.tenantId, params.id, payload))
      .handle("listPolicies", ({ request, params }) => service.listPolicies(request, params.tenantId))
      .handle("getPolicy", ({ request, params }) => service.getPolicy(request, params.tenantId, params.id))
      .handle("createPolicy", ({ request, params, payload }) => service.createPolicy(request, params.tenantId, payload))
      .handle("deletePolicies", ({ request, params, payload }) => service.deletePolicies(request, params.tenantId, payload))
      .handle("patchPolicy", ({ request, params, payload }) => service.patchPolicy(request, params.tenantId, params.id, payload))
      .handle("uploadPolicyApplication", ({ request, params, payload }) => service.uploadPolicyApplication(request, params.tenantId, params.id, payload))
      .handle("downloadPolicyApplication", ({ request, params }) => service.downloadPolicyApplication(request, params.tenantId, params.id, params.sha256))
      .handle("syncPolicies", ({ request, params, payload }) => service.syncPolicies(request, params.tenantId, payload))
      .handle("duplicatePolicy", ({ request, params, payload }) => service.duplicatePolicy(request, params.tenantId, params.id, payload))
      .handle("previewMobileconfig", ({ payload }) => service.previewMobileconfig(payload))
      .handle("billing", ({ request, params }) => service.billing(request, params.tenantId))
      .handle("billingPortal", ({ request, params, payload }) => service.billingPortal(request, params.tenantId, payload));
};
