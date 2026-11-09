import { AuthPersistence } from "@yielded/auth-persistence-drizzle/Postgres";
import { Schema as AuthSchema, Sessions } from "@yielded/auth";
import { AuthDefinition } from "@mattrax/enterprise-domain";
import { defineRelations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { Effect } from "effect";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    stripeCustomerId: text("stripe_customer_id"),
    disabled: boolean("disabled").notNull().default(false),
    authRevision: text("auth_revision")
      .notNull()
      .default(sql`gen_random_uuid()::text`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

/**
 * Yielded Auth owns identifiers, credentials, passwords, sessions, pending
 * authentication and password reset proofs. The application owns `user` above;
 * Yielded maps it as the subject table so user IDs remain stable.
 */
export const authRequirement: Sessions.AuthenticationRequirement = {
  alternatives: [
    {
      factors: ["knowledge"],
      userVerified: false,
      phishingResistant: false,
      minimumCredentials: 1,
    },
  ],
  maximumAgeMillis: 365 * 24 * 60 * 60 * 1000,
};

export const AuthPersistenceConfig: any = AuthPersistence.make(AuthDefinition);
export const authStorage: any = AuthPersistenceConfig.managed({
  subjects: {
    table: user,
    id: "id",
    status: "disabled",
    activeValue: false,
    securityRevision: "authRevision",
    idCodec: AuthSchema.SubjectId,
    requirements: () => Effect.succeed(authRequirement),
    actionRequirements: () => Effect.succeed(authRequirement),
  },
  prefix: "auth",
});
export const authSchema: any = authStorage.schema;

export const authIdentifiers: any = authSchema.identifiers;
export const authCredentials: any = authSchema.credentials;
export const authPasswords: any = authSchema.passwords;
export const authSessions: any = authSchema.sessions;
export const authPending: any = authSchema.pending;
export const authProofs: any = authSchema.proofs;

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("organization_slug_unique").on(table.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("member_user_organization_unique").on(table.userId, table.organizationId),
    index("member_organization_id_idx").on(table.organizationId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("invitation_organization_id_idx").on(table.organizationId)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull(),
    periodStart: timestamp("period_start", { mode: "date" }),
    periodEnd: timestamp("period_end", { mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("subscription_reference_id_idx").on(table.referenceId)],
);

export const accountApiToken = pgTable(
  "account_api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("account_api_token_hash_unique").on(table.tokenHash),
    index("account_api_token_user_id_idx").on(table.userId),
  ],
);

export const enterpriseEnrollment = pgTable("enterprise_enrollment", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  code: text("code"),
  enabledApple: boolean("enabled_apple").notNull().default(true),
  enabledWindows: boolean("enabled_windows").notNull().default(true),
  enabledAndroid: boolean("enabled_android").notNull().default(false),
  enabledAssetTag: boolean("enabled_asset_tag").notNull().default(false),
  maxDevices: integer("max_devices").notNull().default(100),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

export const device = pgTable(
  "device",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    proto: text("proto", { enum: ["apple", "win", "android"] }).notNull(),
    status: text("status", { enum: ["enrolling", "enrolled", "unenrolling", "unenrolled"] })
      .notNull()
      .default("enrolling"),
    name: text("name").notNull(),
    model: text("model"),
    modelIdentifier: text("model_identifier"),
    serial: text("serial"),
    enrolledAt: timestamp("enrolled_at", { mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }).notNull(),
    notes: text("notes"),
    assetTag: text("asset_tag"),
    physicalName: text("physical_name"),
    vendor: text("vendor"),
    osEdition: text("os_edition"),
    osVersion: text("os_version"),
    osBuild: text("os_build"),
    diskTotal: text("disk_total"),
    diskUsed: text("disk_used"),
    dmIdentifier: text("dm_identifier"),
    dmCertHash: text("dm_cert_hash"),
  },
  (table) => [
    index("device_organization_id_idx").on(table.organizationId),
    uniqueIndex("device_serial_unique").on(table.serial),
  ],
);

export const deviceApple = pgTable("device_apple", {
  deviceId: text("device_id")
    .primaryKey()
    .references(() => device.id, { onDelete: "cascade" }),
  enrollmentId: text("enrollment_id"),
  token: text("token"),
  pushMagic: text("push_magic"),
  topic: text("topic"),
  unlockToken: text("unlock_token"),
  bootstrapToken: text("bootstrap_token"),
  configured: boolean("configured").notNull().default(false),
  deviceToken: text("device_token"),
  tokenUpdatedAt: timestamp("token_updated_at", { mode: "date" }),
});

export const applePushCertificate = pgTable("apple_push_certificate", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  topic: text("topic").notNull(),
  certPem: text("cert_pem").notNull(),
  encryptedKey: text("encrypted_key"),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
});

export const enterpriseGroup = pgTable(
  "enterprise_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("enterprise_group_organization_id_idx").on(table.organizationId)],
);

export const policy = pgTable(
  "policy",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("policy_organization_id_idx").on(table.organizationId)],
);

export const configuration = pgTable(
  "configuration",
  {
    kind: text("kind").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policy.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.policyId] })],
);

export const groupDevice = pgTable(
  "group_device",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => enterpriseGroup.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.deviceId] })],
);

export const groupPolicy = pgTable(
  "group_policy",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => enterpriseGroup.id, { onDelete: "cascade" }),
    policyId: text("policy_id")
      .notNull()
      .references(() => policy.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.policyId] })],
);

export const organizationDeviceUsage = pgTable(
  "organization_device_usage",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    billableDevices: integer("billable_devices").notNull(),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    lastReportedAt: timestamp("last_reported_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.period] })],
);

export const scepCa = pgTable("scep_ca", {
  id: serial("id").primaryKey(),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: jsonb("private_key_jwk").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const relations = defineRelations(
  {
    user,
    organization,
    member,
    invitation,
    subscription,
    accountApiToken,
    enterpriseEnrollment,
    device,
    deviceApple,
    applePushCertificate,
    enterpriseGroup,
    policy,
    configuration,
    groupDevice,
    groupPolicy,
    organizationDeviceUsage,
    scepCa,
  },
  (r) => ({
    user: {
      memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
      invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
      apiTokens: r.many.accountApiToken({ from: r.user.id, to: r.accountApiToken.userId }),
    },
    organization: {
      members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
      invitations: r.many.invitation({ from: r.organization.id, to: r.invitation.organizationId }),
      enrollment: r.one.enterpriseEnrollment({
        from: r.organization.id,
        to: r.enterpriseEnrollment.organizationId,
      }),
      devices: r.many.device({ from: r.organization.id, to: r.device.organizationId }),
      applePushCertificate: r.one.applePushCertificate({
        from: r.organization.id,
        to: r.applePushCertificate.organizationId,
      }),
      groups: r.many.enterpriseGroup({
        from: r.organization.id,
        to: r.enterpriseGroup.organizationId,
      }),
      policies: r.many.policy({ from: r.organization.id, to: r.policy.organizationId }),
      deviceUsage: r.many.organizationDeviceUsage({
        from: r.organization.id,
        to: r.organizationDeviceUsage.organizationId,
      }),
    },
    member: {
      organization: r.one.organization({ from: r.member.organizationId, to: r.organization.id }),
      user: r.one.user({ from: r.member.userId, to: r.user.id }),
    },
    invitation: {
      organization: r.one.organization({
        from: r.invitation.organizationId,
        to: r.organization.id,
      }),
      inviter: r.one.user({ from: r.invitation.inviterId, to: r.user.id }),
    },
    accountApiToken: {
      user: r.one.user({ from: r.accountApiToken.userId, to: r.user.id }),
    },
    enterpriseEnrollment: {
      organization: r.one.organization({
        from: r.enterpriseEnrollment.organizationId,
        to: r.organization.id,
      }),
    },
    device: {
      organization: r.one.organization({ from: r.device.organizationId, to: r.organization.id }),
      apple: r.one.deviceApple({ from: r.device.id, to: r.deviceApple.deviceId }),
      groups: r.many.groupDevice({ from: r.device.id, to: r.groupDevice.deviceId }),
    },
    deviceApple: {
      device: r.one.device({ from: r.deviceApple.deviceId, to: r.device.id }),
    },
    applePushCertificate: {
      organization: r.one.organization({
        from: r.applePushCertificate.organizationId,
        to: r.organization.id,
      }),
    },
    enterpriseGroup: {
      organization: r.one.organization({
        from: r.enterpriseGroup.organizationId,
        to: r.organization.id,
      }),
      devices: r.many.groupDevice({ from: r.enterpriseGroup.id, to: r.groupDevice.groupId }),
      policies: r.many.groupPolicy({ from: r.enterpriseGroup.id, to: r.groupPolicy.groupId }),
    },
    policy: {
      organization: r.one.organization({ from: r.policy.organizationId, to: r.organization.id }),
      configurations: r.many.configuration({ from: r.policy.id, to: r.configuration.policyId }),
      groups: r.many.groupPolicy({ from: r.policy.id, to: r.groupPolicy.policyId }),
    },
    configuration: {
      policy: r.one.policy({ from: r.configuration.policyId, to: r.policy.id }),
    },
    groupDevice: {
      group: r.one.enterpriseGroup({ from: r.groupDevice.groupId, to: r.enterpriseGroup.id }),
      device: r.one.device({ from: r.groupDevice.deviceId, to: r.device.id }),
    },
    groupPolicy: {
      group: r.one.enterpriseGroup({ from: r.groupPolicy.groupId, to: r.enterpriseGroup.id }),
      policy: r.one.policy({ from: r.groupPolicy.policyId, to: r.policy.id }),
    },
    organizationDeviceUsage: {
      organization: r.one.organization({
        from: r.organizationDeviceUsage.organizationId,
        to: r.organization.id,
      }),
    },
  }),
);
