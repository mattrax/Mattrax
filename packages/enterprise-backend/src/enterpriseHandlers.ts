// @ts-nocheck
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  EnterpriseAuthError,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseInternalError,
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
import { base64ToBytes, bytesToBase64, policyApplicationKey, sha256Hex, toR2Error } from "./policyApplicationStorage.ts";

type EnterpriseHandlersConfig = {
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

type EnterpriseApiError =
  | EnterpriseUnauthorized
  | EnterpriseBadRequest
  | EnterpriseForbidden
  | EnterpriseNotFound
  | EnterpriseConflict
  | EnterpriseDbError
  | EnterpriseAuthError
  | EnterpriseStripeError
  | EnterpriseR2FileNotFound
  | EnterpriseR2InternalError
  | EnterpriseInternalError;

const isTaggedEnterpriseError = (error: unknown): error is EnterpriseApiError =>
  typeof error === "object" && error !== null && typeof (error as { _tag?: unknown })._tag === "string" && (error as { _tag: string })._tag.startsWith("Enterprise");

const isDbError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "";
  return name.includes("Postgres") || name.includes("Database") || typeof value.code === "string" && /^(?:[0-9A-Z]{5}|SQLITE_|ER_)/.test(value.code) || "constraint" in value || "table" in value || "schema" in value;
};

const isStripeError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type : "";
  return type.startsWith("Stripe") || "requestId" in value || "raw" in value && typeof value.statusCode === "number";
};

const isAuthError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const value = error as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name : "";
  const tag = typeof value._tag === "string" ? value._tag : "";
  return tag.includes("Auth") || "statusCode" in value && ("body" in value || "status" in value);
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : typeof error === "string" ? error : "";

const toEnterpriseError = (error: unknown): EnterpriseApiError => {
  if (isTaggedEnterpriseError(error)) return error;

  const message = errorMessage(error);
  if (message === "Unauthenticated") return new EnterpriseUnauthorized({ message });
  if (message === "Invalid email or password") return new EnterpriseUnauthorized({ message });
  if (message === "Invalid or expired token" || message === "Current password is incorrect") return new EnterpriseBadRequest({ message });
  if (message === "Forbidden") return new EnterpriseForbidden({ message });
  if (message.endsWith("not found")) return new EnterpriseNotFound({ message });
  if (message.startsWith("Cannot ")) return new EnterpriseConflict({ message });
  if (isDbError(error)) return new EnterpriseDbError({ message: "Database operation failed" });
  if (isStripeError(error)) return new EnterpriseStripeError({ message: message || "Stripe operation failed" });
  if (isAuthError(error)) return new EnterpriseAuthError({ message: message || "Authentication service operation failed" });
  return new EnterpriseInternalError({ message: message || "Internal server error" });
};

const effectTry = <A>(try_: () => Promise<A>) => Effect.tryPromise({ try: try_, catch: toEnterpriseError });

export const enterpriseHandlers = ({ db, schema, origin, stripeClient, storage }: EnterpriseHandlersConfig) => {
  const auth = createEnterpriseAuth({ db, schema, origin });

  const requireUser = async (request: HttpServerRequest) => {
    return await auth.requireUser({ headers: request.headers });
  };

  const requireTenant = async (request: HttpServerRequest, tenantId: string, access: "read" | "write" | "delete" = "read"): Promise<OrgContext> => {
    const { user } = await requireUser(request);
    const member = await db.query.member.findFirst({ where: and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, tenantId)) });
    if (!member) throw new Error("Tenant not found");
    if (access === "write" && !canWriteTenant(member.role)) throw new Error("Forbidden");
    if (access === "delete" && !canDeleteTenant(member.role)) throw new Error("Forbidden");

    const organization = await db.query.organization.findFirst({ where: eq(schema.organization.id, member.organizationId) });
    if (!organization) throw new Error("Tenant not found");

    return { user, organization, member };
  };

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

  const assertTenantDevices = async (tenantId: string, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) return;
    const rows = await db.select({ id: schema.device.id }).from(schema.device).where(and(eq(schema.device.organizationId, tenantId), inArray(schema.device.id, [...ids])));
    if (rows.length !== new Set(ids).size) throw new Error("Device not found");
  };

  const assertTenantPolicies = async (tenantId: string, ids: ReadonlyArray<string>) => {
    if (ids.length === 0) return;
    const rows = await db.select({ id: schema.policy.id }).from(schema.policy).where(and(eq(schema.policy.organizationId, tenantId), inArray(schema.policy.id, [...ids])));
    if (rows.length !== new Set(ids).size) throw new Error("Policy not found");
  };

  const assertTenantGroup = async (tenantId: string, groupId: string) => {
    const group = await db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, tenantId)) });
    if (!group) throw new Error("Group not found");
    return group;
  };

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

  const service: any = {
    me: (request) => effectTry(async () => {
      const { session, user } = await requireUser(request);
      const tenants = await listTenantInfo(user.id);
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
        billing: activeTenant ? await billingSummary(activeTenant.id) : undefined,
      };
    }),
    updateMe: (request, payload) => effectTry(async () => {
      const { user } = await requireUser(request);
      const body = payload as { name?: string; image?: string | null };
      await db.update(schema.user).set({
        name: body.name ?? user.name,
        image: body.image === undefined ? user.image : body.image,
        updatedAt: now(),
      }).where(eq(schema.user.id, user.id));
      return ok;
    }),
    deleteMe: () => Effect.succeed({ error: "Delete user is currently not supported while organizations and billing are managed by Mattrax." }),
    listTenants: (request) => effectTry(async () => {
      const { user } = await requireUser(request);
      return { tenants: await listTenantInfo(user.id) };
    }),
    createTenant: (request, payload) => effectTry(async () => {
      const { user } = await requireUser(request);
      const body = payload as { name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> };
      const tenantId = id();
      const timestamp = now();
      await db.insert(schema.organization).values({ id: tenantId, name: body.name, slug: body.slug, logo: body.logo ?? null, metadata: body.metadata ? JSON.stringify(body.metadata) : null, createdAt: timestamp, updatedAt: timestamp });
      await db.insert(schema.member).values({ id: id(), organizationId: tenantId, userId: user.id, role: "owner", createdAt: timestamp, updatedAt: timestamp });
      await db.insert(schema.enterpriseEnrollment).values({ id: tenantId, organizationId: tenantId, createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing();
      return { id: tenantId };
    }),
    getTenant: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      return { ...ctx.organization, role: ctx.member.role, createdAt: iso(ctx.organization.createdAt) };
    }),
    patchTenant: (request, tenantId, payload) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      const body = payload as any;
      await db.update(schema.organization).set({ ...body, metadata: body.metadata === undefined ? undefined : body.metadata === null ? null : JSON.stringify(body.metadata), updatedAt: now() }).where(eq(schema.organization.id, tenantId));
      return ok;
    }),
    deleteTenant: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId, "delete");
      if (await memberCount(tenantId) > 1) throw new Error("Cannot delete a tenant with more than one user");
      await db.delete(schema.organization).where(eq(schema.organization.id, tenantId));
      return ok;
    }),
    listTenantUsers: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId);
      const users = await db.select({
        memberId: schema.member.id,
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.member.role,
        createdAt: schema.member.createdAt,
      }).from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId)).where(eq(schema.member.organizationId, tenantId));
      return { users: users.map((user: any) => ({ ...user, createdAt: iso(user.createdAt) })) };
    }),
    inviteTenantUser: (request, tenantId, payload) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      const { user } = await requireUser(request);
      const body = payload as { email: string; role?: string; resend?: boolean };
      const invitationId = id();
      const timestamp = now();
      await db.insert(schema.invitation).values({ id: invitationId, organizationId: tenantId, inviterId: user.id, email: body.email, role: body.role ?? "member", status: "pending", expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000), createdAt: timestamp, updatedAt: timestamp });
      return { id: invitationId };
    }),
    listTenantInvitations: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      const invitations = await db.select().from(schema.invitation).where(eq(schema.invitation.organizationId, tenantId));
      return { invitations: invitations.map((item: any) => ({ id: item.id, email: item.email, role: item.role, status: item.status, expiresAt: iso(item.expiresAt), createdAt: iso(item.createdAt) })) };
    }),
    cancelTenantInvitation: (request, tenantId, invitationId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      const invitation = await db.query.invitation.findFirst({ where: and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, tenantId)) });
      if (!invitation) throw new Error("Invitation not found");
      await db.update(schema.invitation).set({ status: "canceled", updatedAt: now() }).where(eq(schema.invitation.id, invitationId));
      return ok;
    }),
    patchTenantUser: (request, tenantId, memberId, payload) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      const member = await db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) });
      if (!member) throw new Error("Tenant user not found");
      const body = payload as { role: string };
      await db.update(schema.member).set({ role: body.role, updatedAt: now() }).where(eq(schema.member.id, memberId));
      return ok;
    }),
    removeTenantUser: (request, tenantId, memberId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      if (await memberCount(tenantId) <= 1) throw new Error("Cannot remove the last tenant user; delete the tenant instead");
      const member = await db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) });
      if (!member) throw new Error("Tenant user not found");
      await db.delete(schema.member).where(eq(schema.member.id, memberId));
      return ok;
    }),
    getEnrollment: (enrollmentId, code) => effectTry(async () => {
      const enrollment = await db.query.enterpriseEnrollment.findFirst({ where: eq(schema.enterpriseEnrollment.id, enrollmentId) });
      if (!enrollment) throw new Error("Enrollment not found");
      const organization = await db.query.organization.findFirst({ where: eq(schema.organization.id, enrollment.organizationId) });
      if (!organization) throw new Error("Enrollment not found");
      if (enrollment.code && enrollment.code !== code) return { name: organization.name, authenticated: false as const };

      const apns = await db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, organization.id) });
      const [deviceCount] = await db.select({ value: count() }).from(schema.device).where(eq(schema.device.organizationId, organization.id));
      const enabled = (deviceCount?.value ?? 0) <= enrollment.maxDevices;
      return {
        name: organization.name,
        authenticated: true as const,
        apple: !enabled || !enrollment.enabledApple
          ? { error: "Apple enrollment is disabled! Contact your administrator." }
          : apns?.topic
          ? { profile: await Effect.runPromise(serializePlist(enterpriseEnrollmentProfile({ origin, topic: apns.topic, organizationId: organization.id }))) }
          : { error: "Apple management is not configured! Contact your administrator." },
        windows: !enabled || !enrollment.enabledWindows ? { error: "Windows enrollment is disabled! Contact your administrator." } : "available",
        android: !enabled || !enrollment.enabledAndroid ? { error: "Android enrollment is disabled! Contact your administrator." } : "available",
        assetTag: enabled && enrollment.enabledAssetTag,
      };
    }),
    getTenantEnrollment: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      return rowEnrollment(await getOrCreateEnrollment(ctx.organization.id));
    }),
    patchTenantEnrollment: (request, tenantId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await getOrCreateEnrollment(ctx.organization.id);
      const body = payload as { code?: string | null; enabledApple?: boolean; enabledWindows?: boolean; enabledAndroid?: boolean; enabledAssetTag?: boolean; maxDevices?: number };
      await db.update(schema.enterpriseEnrollment).set({
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.enabledApple !== undefined ? { enabledApple: body.enabledApple } : {}),
        ...(body.enabledWindows !== undefined ? { enabledWindows: body.enabledWindows } : {}),
        ...(body.enabledAndroid !== undefined ? { enabledAndroid: body.enabledAndroid } : {}),
        ...(body.enabledAssetTag !== undefined ? { enabledAssetTag: body.enabledAssetTag } : {}),
        ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
        updatedAt: now(),
      }).where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
      return ok;
    }),
    resetTenantEnrollment: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await getOrCreateEnrollment(ctx.organization.id);
      const newId = id();
      await db.update(schema.enterpriseEnrollment).set({ id: newId, updatedAt: now() }).where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
      return { id: newId };
    }),
    getApns: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const apns = await db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, ctx.organization.id) });
      return { configured: apns !== undefined, email: apns?.email ?? null, topic: apns?.topic ?? null };
    }),
    uploadApns: (request, tenantId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { email: string; cert: string };
      const topic = body.cert.match(/UID=([^,\n]+)/)?.[1] ?? `com.apple.mgmt.External.${ctx.organization.id}`;
      await db.insert(schema.applePushCertificate).values({
        organizationId: ctx.organization.id,
        email: body.email,
        certPem: body.cert,
        topic,
        updatedAt: now(),
      }).onConflictDoUpdate({
        target: schema.applePushCertificate.organizationId,
        set: { email: body.email, certPem: body.cert, topic, updatedAt: now() },
      });
      return ok;
    }),
    deleteDevices: (request, tenantId, ids) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      if (ids.length > 0) await db.delete(schema.device).where(and(eq(schema.device.organizationId, ctx.organization.id), inArray(schema.device.id, [...ids])));
      return ok;
    }),
    patchDevice: (request, tenantId, deviceId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null; assetTag?: string | null };
      await db.update(schema.device).set({ name: body.name, notes: body.notes, assetTag: body.assetTag }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)));
      return ok;
    }),
    deviceAction: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    deviceUnenroll: (request, tenantId, deviceId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await db.update(schema.device).set({ status: "unenrolling" }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id), eq(schema.device.status, "enrolled")));
      return ok;
    }),
    createGroup: (request, tenantId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name: string; notes?: string | null; devices?: Array<string>; policies?: Array<string> };
      await assertTenantDevices(ctx.organization.id, body.devices ?? []);
      await assertTenantPolicies(ctx.organization.id, body.policies ?? []);
      const groupId = id();
      await db.insert(schema.enterpriseGroup).values({ id: groupId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() });
      if (body.devices?.length) await db.insert(schema.groupDevice).values(body.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing();
      if (body.policies?.length) await db.insert(schema.groupPolicy).values(body.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing();
      return { id: groupId };
    }),
    deleteGroups: (request, tenantId, ids) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const groupId of ids) {
        const result = await db.delete(schema.enterpriseGroup).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id))).returning({ id: schema.enterpriseGroup.id });
        if (result.length) deleted.push(groupId); else failed.push({ id: groupId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchGroup: (request, tenantId, groupId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null };
      await db.update(schema.enterpriseGroup).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)));
      return ok;
    }),
    patchGroupMembers: (request, tenantId, groupId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await assertTenantGroup(ctx.organization.id, groupId);
      const body = payload as { assign?: { devices?: Array<string>; policies?: Array<string> }; unassign?: { devices?: Array<string>; policies?: Array<string> } };
      await assertTenantDevices(ctx.organization.id, [...(body.assign?.devices ?? []), ...(body.unassign?.devices ?? [])]);
      await assertTenantPolicies(ctx.organization.id, [...(body.assign?.policies ?? []), ...(body.unassign?.policies ?? [])]);
      if (body.assign?.devices?.length) await db.insert(schema.groupDevice).values(body.assign.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing();
      if (body.assign?.policies?.length) await db.insert(schema.groupPolicy).values(body.assign.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing();
      if (body.unassign?.devices?.length) await db.delete(schema.groupDevice).where(and(eq(schema.groupDevice.groupId, groupId), inArray(schema.groupDevice.deviceId, body.unassign.devices)));
      if (body.unassign?.policies?.length) await db.delete(schema.groupPolicy).where(and(eq(schema.groupPolicy.groupId, groupId), inArray(schema.groupPolicy.policyId, body.unassign.policies)));
      return ok;
    }),
    syncGroups: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicateGroup: (request, tenantId, groupId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const source = await assertTenantGroup(ctx.organization.id, groupId);
      const body = payload as { name?: string };
      const newId = id();
      await db.insert(schema.enterpriseGroup).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() });
      const devices = await db.select().from(schema.groupDevice).where(eq(schema.groupDevice.groupId, groupId));
      const policies = await db.select().from(schema.groupPolicy).where(eq(schema.groupPolicy.groupId, groupId));
      if (devices.length) await db.insert(schema.groupDevice).values(devices.map((d: any) => ({ groupId: newId, deviceId: d.deviceId })));
      if (policies.length) await db.insert(schema.groupPolicy).values(policies.map((p: any) => ({ groupId: newId, policyId: p.policyId })));
      return { id: newId };
    }),
    createPolicy: (request, tenantId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name: string; notes?: string | null };
      const policyId = id();
      await db.insert(schema.policy).values({ id: policyId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() });
      return { id: policyId };
    }),
    deletePolicies: (request, tenantId, ids) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const policyId of ids) {
        const result = await db.delete(schema.policy).where(and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id))).returning({ id: schema.policy.id });
        if (result.length) deleted.push(policyId); else failed.push({ id: policyId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchPolicy: (request, tenantId, policyId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null; configurations?: Record<string, unknown> };
      const policy = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!policy) throw new Error("Policy not found");
      await db.update(schema.policy).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(eq(schema.policy.id, policyId));
      for (const [kind, data] of Object.entries(body.configurations ?? {})) {
        if (data === null) {
          await db.delete(schema.configuration).where(and(eq(schema.configuration.policyId, policyId), eq(schema.configuration.kind, kind)));
        } else {
          const hash = await hashJson(data);
          await db.insert(schema.configuration).values({ policyId, kind, data, hash }).onConflictDoUpdate({ target: [schema.configuration.kind, schema.configuration.policyId], set: { data, hash } });
        }
      }
      return ok;
    }),
    uploadPolicyApplication: (request, tenantId, policyId, payload) => Effect.tryPromise({
      try: async () => {
        const ctx = await requireTenant(request, tenantId, "write");
        await assertTenantPolicies(ctx.organization.id, [policyId]);
        const body = payload as { fileName: string; contentType?: string; content: string };
        const bytes = base64ToBytes(body.content);
        const sha256 = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        await storage.put(key, bytes, {
          httpMetadata: body.contentType ? { contentType: body.contentType } : undefined,
          customMetadata: { fileName: body.fileName },
        });
        return { sha256, fileName: body.fileName, contentType: body.contentType ?? null, size: bytes.byteLength };
      },
      catch: toR2Error,
    }),
    downloadPolicyApplication: (request, tenantId, policyId, sha256) => Effect.tryPromise({
      try: async () => {
        const ctx = await requireTenant(request, tenantId);
        await assertTenantPolicies(ctx.organization.id, [policyId]);
        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        const object = await storage.get(key);
        if (!object) throw new EnterpriseR2FileNotFound({ message: "Policy application file not found" });
        const bytes = await object.arrayBuffer();
        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? null,
          size: object.size ?? bytes.byteLength,
          content: bytesToBase64(new Uint8Array(bytes)),
        };
      },
      catch: toR2Error,
    }),
    syncPolicies: (request, tenantId) => effectTry(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicatePolicy: (request, tenantId, policyId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const source = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!source) throw new Error("Policy not found");
      const body = payload as { name?: string };
      const newId = id();
      await db.insert(schema.policy).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() });
      const configurations = await db.select().from(schema.configuration).where(eq(schema.configuration.policyId, policyId));
      if (configurations.length) await db.insert(schema.configuration).values(configurations.map((c: any) => ({ kind: c.kind, policyId: newId, data: c.data, hash: c.hash })));
      return { id: newId };
    }),
    previewMobileconfig: (payload) => Effect.succeed({ payload }),
    listDevices: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.device).where(eq(schema.device.organizationId, ctx.organization.id));
      return { rows: rows.map(rowDevice) };
    }),
    getDevice: (request, tenantId, deviceId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.device.findFirst({ where: and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Device not found");
      return rowDevice(row);
    }),
    listGroups: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.enterpriseGroup).where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));
      return { rows: rows.map((row: any) => rowGroup(row)) };
    }),
    getGroup: (request, tenantId, groupId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Group not found");
      return rowGroup(row);
    }),
    listPolicies: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.policy).where(eq(schema.policy.organizationId, ctx.organization.id));
      return { rows: await Promise.all(rows.map((row: any) => rowPolicy(row))) };
    }),
    getPolicy: (request, tenantId, policyId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Policy not found");
      return rowPolicy(row, true);
    }),
    billing: (request, tenantId) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId);
      return billingSummary(ctx.organization.id);
    }),
    billingPortal: (request, tenantId, payload) => effectTry(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { returnUrl: string };
      await ensureStripeCustomer(ctx.organization);
      const customer = await ensureStripeCustomer(ctx.organization);
      const result = await stripeClient.billingPortal.sessions.create({ customer, return_url: body.returnUrl });
      return { url: result.url ?? body.returnUrl };
    }),
    authSession: (request) => effectTry(() => auth.authSession(webRequestFromRequest(request, origin))),
    authRegister: (request, payload) => effectTry(() => auth.authRegister(webRequestFromRequest(request, origin), payload)),
    authLogin: (request, payload) => effectTry(() => auth.authLogin(webRequestFromRequest(request, origin), payload)),
    authLogout: (request) => effectTry(() => auth.authLogout(webRequestFromRequest(request, origin))),
    authForgotPassword: (_request, payload) => effectTry(() => auth.authForgotPassword(payload)),
    authResetPassword: (_request, payload) => effectTry(() => auth.authResetPassword(payload)),
    authChangePassword: (request, payload) => effectTry(() => auth.authChangePassword(webRequestFromRequest(request, origin), payload)),
    authChangeEmail: (request, payload) => effectTry(() => auth.authChangeEmail(webRequestFromRequest(request, origin), payload)),
    authVerifyEmailChange: (_request, payload) => effectTry(() => auth.authVerifyEmailChange(payload)),
    listApiTokens: (request) => effectTry(() => auth.listApiTokens(webRequestFromRequest(request, origin))),
    createApiToken: (request, payload) => effectTry(() => auth.createApiToken(webRequestFromRequest(request, origin), payload)),
    revokeApiToken: (request, tokenId) => effectTry(() => auth.revokeApiToken(webRequestFromRequest(request, origin), tokenId)),
  };

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
