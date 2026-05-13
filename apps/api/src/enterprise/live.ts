import { Effect } from "effect";
import type { EnterpriseBackend } from "@mattrax/enterprise-backend";
import type { Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { createAuth } from "../auth.js";
import Stripe from "stripe";
import { env } from "cloudflare:workers";
import { and, count, eq, inArray } from "drizzle-orm";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import { enterpriseEnrollmentProfile } from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";

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
  readonly user: typeof schema.user.$inferSelect;
  readonly organization: typeof schema.organization.$inferSelect;
  readonly member: typeof schema.member.$inferSelect;
};

const canWriteTenant = (role: string) => role.split(",").some((item) => item === "owner" || item === "admin");
const canDeleteTenant = (role: string) => role.split(",").includes("owner");

export const createEnterpriseBackend = (db: Database, config: { origin: string }): EnterpriseBackend => {
  const auth = createAuth();
  const stripeClient = new Stripe((env as any).STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });

  const requireUser = async (request: HttpServerRequest) => {
    const session = await auth.api.getSession({ headers: headersFromRequest(request) }) as any;
    if (!session?.user?.id) throw new Error("Unauthenticated");

    const user = await db.query.user.findFirst({ where: eq(schema.user.id, session.user.id) });
    if (!user) throw new Error("Unauthenticated");
    return { session, user };
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

  const ensureStripeCustomer = async (organization: typeof schema.organization.$inferSelect) => {
    if (organization.stripeCustomerId) return organization.stripeCustomerId;

    let stripeCustomer: Stripe.Customer | undefined;
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

  const rowDevice = (row: typeof schema.device.$inferSelect) => ({
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

  const rowGroup = (row: typeof schema.enterpriseGroup.$inferSelect, devicesCount = 0, policiesCount = 0) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    devicesCount,
    policiesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPolicy = async (row: typeof schema.policy.$inferSelect, withConfigurations = false) => {
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

  const rowEnrollment = (row: typeof schema.enterpriseEnrollment.$inferSelect) => ({
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
    me: (request) => Effect.promise(async () => {
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
    updateMe: (request, payload) => Effect.promise(async () => {
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
    listTenants: (request) => Effect.promise(async () => {
      const { user } = await requireUser(request);
      return { tenants: await listTenantInfo(user.id) };
    }),
    createTenant: (request, payload) => Effect.promise(async () => {
      const body = payload as { name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> };
      const result = await auth.api.createOrganization({ headers: headersFromRequest(request), body }) as any;
      const tenantId = result?.id ?? result?.data?.id ?? result?.organization?.id ?? result?.data?.organization?.id;
      if (!tenantId) throw new Error("Tenant creation failed");
      return { id: tenantId };
    }),
    getTenant: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      return { ...ctx.organization, role: ctx.member.role, createdAt: iso(ctx.organization.createdAt) };
    }),
    patchTenant: (request, tenantId, payload) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      await auth.api.updateOrganization({ headers: headersFromRequest(request), body: { organizationId: tenantId, data: payload } });
      return ok;
    }),
    deleteTenant: (request, tenantId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "delete");
      if (await memberCount(tenantId) > 1) throw new Error("Cannot delete a tenant with more than one user");
      await auth.api.deleteOrganization({ headers: headersFromRequest(request), body: { organizationId: tenantId } });
      return ok;
    }),
    listTenantUsers: (request, tenantId) => Effect.promise(async () => {
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
    inviteTenantUser: (request, tenantId, payload) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      const body = payload as { email: string; role?: string; resend?: boolean };
      const result = await auth.api.createInvitation({ headers: headersFromRequest(request), body: { organizationId: tenantId, email: body.email, role: body.role ?? "member", resend: body.resend } }) as any;
      const invitationId = result?.id ?? result?.data?.id ?? result?.invitation?.id ?? result?.data?.invitation?.id;
      if (!invitationId) throw new Error("Invitation creation failed");
      return { id: invitationId };
    }),
    listTenantInvitations: (request, tenantId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      const invitations = await db.select().from(schema.invitation).where(eq(schema.invitation.organizationId, tenantId));
      return { invitations: invitations.map((item: any) => ({ id: item.id, email: item.email, role: item.role, status: item.status, expiresAt: iso(item.expiresAt), createdAt: iso(item.createdAt) })) };
    }),
    cancelTenantInvitation: (request, tenantId, invitationId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      const invitation = await db.query.invitation.findFirst({ where: and(eq(schema.invitation.id, invitationId), eq(schema.invitation.organizationId, tenantId)) });
      if (!invitation) throw new Error("Invitation not found");
      await auth.api.cancelInvitation({ headers: headersFromRequest(request), body: { invitationId } });
      return ok;
    }),
    patchTenantUser: (request, tenantId, memberId, payload) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      const member = await db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) });
      if (!member) throw new Error("Tenant user not found");
      const body = payload as { role: string };
      await auth.api.updateMemberRole({ headers: headersFromRequest(request), body: { organizationId: tenantId, memberId, role: body.role } });
      return ok;
    }),
    removeTenantUser: (request, tenantId, memberId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      if (await memberCount(tenantId) <= 1) throw new Error("Cannot remove the last tenant user; delete the tenant instead");
      const member = await db.query.member.findFirst({ where: and(eq(schema.member.id, memberId), eq(schema.member.organizationId, tenantId)) });
      if (!member) throw new Error("Tenant user not found");
      const user = await db.query.user.findFirst({ where: eq(schema.user.id, member.userId) });
      if (!user) throw new Error("Tenant user not found");
      await auth.api.removeMember({ headers: headersFromRequest(request), body: { organizationId: tenantId, memberIdOrEmail: user.email } });
      return ok;
    }),
    getEnrollment: (enrollmentId, code) => Effect.promise(async () => {
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
          ? { profile: await serializePlist(enterpriseEnrollmentProfile({ origin: config.origin, topic: apns.topic, organizationId: organization.id })) }
          : { error: "Apple management is not configured! Contact your administrator." },
        windows: !enabled || !enrollment.enabledWindows ? { error: "Windows enrollment is disabled! Contact your administrator." } : "available",
        android: !enabled || !enrollment.enabledAndroid ? { error: "Android enrollment is disabled! Contact your administrator." } : "available",
        assetTag: enabled && enrollment.enabledAssetTag,
      };
    }),
    getTenantEnrollment: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      return rowEnrollment(await getOrCreateEnrollment(ctx.organization.id));
    }),
    patchTenantEnrollment: (request, tenantId, payload) => Effect.promise(async () => {
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
    resetTenantEnrollment: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await getOrCreateEnrollment(ctx.organization.id);
      const newId = id();
      await db.update(schema.enterpriseEnrollment).set({ id: newId, updatedAt: now() }).where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
      return { id: newId };
    }),
    getApns: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const apns = await db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, ctx.organization.id) });
      return { configured: apns !== undefined, email: apns?.email ?? null, topic: apns?.topic ?? null };
    }),
    uploadApns: (request, tenantId, payload) => Effect.promise(async () => {
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
    deleteDevices: (request, tenantId, ids) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      if (ids.length > 0) await db.delete(schema.device).where(and(eq(schema.device.organizationId, ctx.organization.id), inArray(schema.device.id, [...ids])));
      return ok;
    }),
    patchDevice: (request, tenantId, deviceId, payload) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null; assetTag?: string | null };
      await db.update(schema.device).set({ name: body.name, notes: body.notes, assetTag: body.assetTag }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)));
      return ok;
    }),
    deviceAction: (request, tenantId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    deviceUnenroll: (request, tenantId, deviceId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      await db.update(schema.device).set({ status: "unenrolling" }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id), eq(schema.device.status, "enrolled")));
      return ok;
    }),
    createGroup: (request, tenantId, payload) => Effect.promise(async () => {
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
    deleteGroups: (request, tenantId, ids) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const groupId of ids) {
        const result = await db.delete(schema.enterpriseGroup).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id))).returning({ id: schema.enterpriseGroup.id });
        if (result.length) deleted.push(groupId); else failed.push({ id: groupId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchGroup: (request, tenantId, groupId, payload) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name?: string; notes?: string | null };
      await db.update(schema.enterpriseGroup).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)));
      return ok;
    }),
    patchGroupMembers: (request, tenantId, groupId, payload) => Effect.promise(async () => {
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
    syncGroups: (request, tenantId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicateGroup: (request, tenantId, groupId, payload) => Effect.promise(async () => {
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
    createPolicy: (request, tenantId, payload) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { name: string; notes?: string | null };
      const policyId = id();
      await db.insert(schema.policy).values({ id: policyId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() });
      return { id: policyId };
    }),
    deletePolicies: (request, tenantId, ids) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const policyId of ids) {
        const result = await db.delete(schema.policy).where(and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id))).returning({ id: schema.policy.id });
        if (result.length) deleted.push(policyId); else failed.push({ id: policyId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchPolicy: (request, tenantId, policyId, payload) => Effect.promise(async () => {
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
    syncPolicies: (request, tenantId) => Effect.promise(async () => {
      await requireTenant(request, tenantId, "write");
      return ok;
    }),
    duplicatePolicy: (request, tenantId, policyId, payload) => Effect.promise(async () => {
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
    listDevices: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.device).where(eq(schema.device.organizationId, ctx.organization.id));
      return { rows: rows.map(rowDevice) };
    }),
    getDevice: (request, tenantId, deviceId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.device.findFirst({ where: and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Device not found");
      return rowDevice(row);
    }),
    listGroups: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.enterpriseGroup).where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));
      return { rows: rows.map((row: any) => rowGroup(row)) };
    }),
    getGroup: (request, tenantId, groupId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Group not found");
      return rowGroup(row);
    }),
    listPolicies: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const rows = await db.select().from(schema.policy).where(eq(schema.policy.organizationId, ctx.organization.id));
      return { rows: await Promise.all(rows.map((row: any) => rowPolicy(row))) };
    }),
    getPolicy: (request, tenantId, policyId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      const row = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Policy not found");
      return rowPolicy(row, true);
    }),
    billing: (request, tenantId) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId);
      return billingSummary(ctx.organization.id);
    }),
    billingPortal: (request, tenantId, payload) => Effect.promise(async () => {
      const ctx = await requireTenant(request, tenantId, "write");
      const body = payload as { returnUrl: string };
      await ensureStripeCustomer(ctx.organization);
      const result = await auth.api.createBillingPortal({
        headers: headersFromRequest(request),
        body: { referenceId: ctx.organization.id, customerType: "organization", returnUrl: body.returnUrl, disableRedirect: true },
      }) as any;
      return { url: result?.url ?? result?.data?.url ?? body.returnUrl };
    }),
  };
};
