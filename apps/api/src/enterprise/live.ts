import { Effect, Layer } from "effect";
import { EnterpriseService, type EnterpriseServiceShape } from "@mattrax/enterprise-backend";
import type { Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { createAuth } from "../auth.js";
import { and, count, eq, inArray } from "drizzle-orm";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";

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

export const EnterpriseServiceLive = (db: Database) =>
  Layer.succeed(EnterpriseService, EnterpriseService.of(makeEnterpriseService(db)));

const makeEnterpriseService = (db: Database): EnterpriseServiceShape => {
  const auth = createAuth();

  const requireOrg = async (request: HttpServerRequest): Promise<OrgContext> => {
    const session = await auth.api.getSession({ headers: headersFromRequest(request) }) as any;
    if (!session?.user?.id) throw new Error("Unauthenticated");

    const user = await db.query.user.findFirst({ where: eq(schema.user.id, session.user.id) });
    if (!user) throw new Error("Unauthenticated");

    const activeOrganizationId = session.session?.activeOrganizationId as string | undefined;
    const member = activeOrganizationId
      ? await db.query.member.findFirst({ where: and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, activeOrganizationId)) })
      : await db.query.member.findFirst({ where: eq(schema.member.userId, user.id) });
    if (!member) throw new Error("No active organization");

    const organization = await db.query.organization.findFirst({ where: eq(schema.organization.id, member.organizationId) });
    if (!organization) throw new Error("No active organization");

    return { user, organization, member };
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
      base.configurations = Object.fromEntries(configurations.map((item) => [item.kind, item.data]));
    }
    return base;
  };

  return {
    status: () => Effect.succeed(ok),
    me: (request) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      return {
        user: {
          id: ctx.user.id,
          name: ctx.user.name,
          email: ctx.user.email,
          emailVerified: ctx.user.emailVerified,
          image: ctx.user.image,
        },
        organization: {
          id: ctx.organization.id,
          name: ctx.organization.name,
          slug: ctx.organization.slug,
          role: ctx.member.role,
        },
        billing: await billingSummary(ctx.organization.id),
      };
    }),
    updateMe: (request, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name?: string; image?: string | null };
      await db.update(schema.user).set({
        name: body.name ?? ctx.user.name,
        image: body.image === undefined ? ctx.user.image : body.image,
        updatedAt: now(),
      }).where(eq(schema.user.id, ctx.user.id));
      return ok;
    }),
    deleteMe: () => Effect.succeed({ error: "Delete user is currently not supported while organizations and billing are managed by Mattrax." }),
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
          ? { profile: "" }
          : { error: "Apple management is not configured! Contact your administrator." },
        windows: !enabled || !enrollment.enabledWindows ? { error: "Windows enrollment is disabled! Contact your administrator." } : "available",
        android: !enabled || !enrollment.enabledAndroid ? { error: "Android enrollment is disabled! Contact your administrator." } : "available",
        assetTag: enabled && enrollment.enabledAssetTag,
      };
    }),
    deleteTenant: () => Effect.succeed({ error: "Delete tenant's is currently not supported as they are tied to your account!" }),
    getApns: (request) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const apns = await db.query.applePushCertificate.findFirst({ where: eq(schema.applePushCertificate.organizationId, ctx.organization.id) });
      return { configured: apns !== undefined, email: apns?.email ?? null, topic: apns?.topic ?? null };
    }),
    uploadApns: (request, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
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
    deleteDevices: (request, ids) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      if (ids.length > 0) await db.delete(schema.device).where(and(eq(schema.device.organizationId, ctx.organization.id), inArray(schema.device.id, [...ids])));
      return ok;
    }),
    patchDevice: (request, deviceId, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name?: string; notes?: string | null; assetTag?: string | null };
      await db.update(schema.device).set({ name: body.name, notes: body.notes, assetTag: body.assetTag }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id)));
      return ok;
    }),
    deviceAction: (request) => Effect.promise(async () => {
      await requireOrg(request);
      return ok;
    }),
    deviceUnenroll: (request, deviceId) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      await db.update(schema.device).set({ status: "unenrolling" }).where(and(eq(schema.device.id, deviceId), eq(schema.device.organizationId, ctx.organization.id), eq(schema.device.status, "enrolled")));
      return ok;
    }),
    createGroup: (request, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name: string; notes?: string | null; devices?: Array<string>; policies?: Array<string> };
      const groupId = id();
      await db.insert(schema.enterpriseGroup).values({ id: groupId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() });
      if (body.devices?.length) await db.insert(schema.groupDevice).values(body.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing();
      if (body.policies?.length) await db.insert(schema.groupPolicy).values(body.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing();
      return { id: groupId };
    }),
    deleteGroups: (request, ids) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const groupId of ids) {
        const result = await db.delete(schema.enterpriseGroup).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id))).returning({ id: schema.enterpriseGroup.id });
        if (result.length) deleted.push(groupId); else failed.push({ id: groupId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchGroup: (request, groupId, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name?: string; notes?: string | null };
      await db.update(schema.enterpriseGroup).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)));
      return ok;
    }),
    patchGroupMembers: (request, groupId, payload) => Effect.promise(async () => {
      await requireOrg(request);
      const body = payload as { assign?: { devices?: Array<string>; policies?: Array<string> }; unassign?: { devices?: Array<string>; policies?: Array<string> } };
      if (body.assign?.devices?.length) await db.insert(schema.groupDevice).values(body.assign.devices.map((deviceId) => ({ groupId, deviceId }))).onConflictDoNothing();
      if (body.assign?.policies?.length) await db.insert(schema.groupPolicy).values(body.assign.policies.map((policyId) => ({ groupId, policyId }))).onConflictDoNothing();
      if (body.unassign?.devices?.length) await db.delete(schema.groupDevice).where(and(eq(schema.groupDevice.groupId, groupId), inArray(schema.groupDevice.deviceId, body.unassign.devices)));
      if (body.unassign?.policies?.length) await db.delete(schema.groupPolicy).where(and(eq(schema.groupPolicy.groupId, groupId), inArray(schema.groupPolicy.policyId, body.unassign.policies)));
      return ok;
    }),
    syncGroups: (request) => Effect.promise(async () => {
      await requireOrg(request);
      return ok;
    }),
    duplicateGroup: (request, groupId, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const source = await db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, groupId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)) });
      if (!source) throw new Error("Group not found");
      const body = payload as { name?: string };
      const newId = id();
      await db.insert(schema.enterpriseGroup).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() });
      const devices = await db.select().from(schema.groupDevice).where(eq(schema.groupDevice.groupId, groupId));
      const policies = await db.select().from(schema.groupPolicy).where(eq(schema.groupPolicy.groupId, groupId));
      if (devices.length) await db.insert(schema.groupDevice).values(devices.map((d) => ({ groupId: newId, deviceId: d.deviceId })));
      if (policies.length) await db.insert(schema.groupPolicy).values(policies.map((p) => ({ groupId: newId, policyId: p.policyId })));
      return { id: newId };
    }),
    createPolicy: (request, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name: string; notes?: string | null };
      const policyId = id();
      await db.insert(schema.policy).values({ id: policyId, organizationId: ctx.organization.id, name: body.name, notes: body.notes ?? null, createdAt: now(), updatedAt: now() });
      return { id: policyId };
    }),
    deletePolicies: (request, ids) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const deleted: Array<string> = [];
      const failed: Array<{ id: string; reason: string }> = [];
      for (const policyId of ids) {
        const result = await db.delete(schema.policy).where(and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id))).returning({ id: schema.policy.id });
        if (result.length) deleted.push(policyId); else failed.push({ id: policyId, reason: "notFound" });
      }
      return { deleted, failed };
    }),
    patchPolicy: (request, policyId, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { name?: string; notes?: string | null; configurations?: Record<string, unknown> };
      await db.update(schema.policy).set({ name: body.name, notes: body.notes, updatedAt: now() }).where(and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)));
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
    syncPolicies: (request) => Effect.promise(async () => {
      await requireOrg(request);
      return ok;
    }),
    duplicatePolicy: (request, policyId, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const source = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, policyId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!source) throw new Error("Policy not found");
      const body = payload as { name?: string };
      const newId = id();
      await db.insert(schema.policy).values({ id: newId, organizationId: ctx.organization.id, name: body.name ?? `${source.name} [duplicated]`, notes: source.notes, createdAt: now(), updatedAt: now() });
      const configurations = await db.select().from(schema.configuration).where(eq(schema.configuration.policyId, policyId));
      if (configurations.length) await db.insert(schema.configuration).values(configurations.map((c) => ({ kind: c.kind, policyId: newId, data: c.data, hash: c.hash })));
      return { id: newId };
    }),
    previewMobileconfig: (payload) => Effect.succeed({ payload }),
    search: (request, query) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      if (query.type === "device") {
        const rows = await db.select().from(schema.device).where(eq(schema.device.organizationId, ctx.organization.id));
        return { rows: rows.map(rowDevice) };
      }
      if (query.type === "group") {
        const rows = await db.select().from(schema.enterpriseGroup).where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));
        return { rows: rows.map((row) => rowGroup(row)) };
      }
      const rows = await db.select().from(schema.policy).where(eq(schema.policy.organizationId, ctx.organization.id));
      return { rows: await Promise.all(rows.map((row) => rowPolicy(row))) };
    }),
    node: (request, entity, nodeId) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      if (entity === "device") {
        const row = await db.query.device.findFirst({ where: and(eq(schema.device.id, nodeId), eq(schema.device.organizationId, ctx.organization.id)) });
        if (!row) throw new Error("Device not found");
        return rowDevice(row);
      }
      if (entity === "group") {
        const row = await db.query.enterpriseGroup.findFirst({ where: and(eq(schema.enterpriseGroup.id, nodeId), eq(schema.enterpriseGroup.organizationId, ctx.organization.id)) });
        if (!row) throw new Error("Group not found");
        return rowGroup(row);
      }
      const row = await db.query.policy.findFirst({ where: and(eq(schema.policy.id, nodeId), eq(schema.policy.organizationId, ctx.organization.id)) });
      if (!row) throw new Error("Policy not found");
      return rowPolicy(row, true);
    }),
    billing: (request) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      return billingSummary(ctx.organization.id);
    }),
    billingPortal: (request, payload) => Effect.promise(async () => {
      const ctx = await requireOrg(request);
      const body = payload as { returnUrl: string };
      const result = await auth.api.createBillingPortal({
        headers: headersFromRequest(request),
        body: { referenceId: ctx.organization.id, customerType: "organization", returnUrl: body.returnUrl, disableRedirect: true },
      }) as any;
      return { url: result?.url ?? result?.data?.url ?? body.returnUrl };
    }),
  };
};
