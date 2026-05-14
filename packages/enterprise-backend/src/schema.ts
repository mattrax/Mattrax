import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";

export const createEnterpriseSchema = () => {
  const user = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("user_email_unique").on(table.email)]);

  const session = pgTable("session", {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("session_token_hash_unique").on(table.tokenHash), index("session_user_id_idx").on(table.userId)]);

  const account = pgTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId), index("account_user_id_idx").on(table.userId)]);

  const verification = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    valueHash: text("value_hash").notNull(),
    kind: text("kind").notNull(),
    metadata: jsonb("metadata"),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [index("verification_identifier_idx").on(table.identifier), uniqueIndex("verification_value_hash_unique").on(table.valueHash)]);

  const organization = pgTable("organization", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("organization_slug_unique").on(table.slug)]);

  const member = pgTable("member", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("member_user_organization_unique").on(table.userId, table.organizationId), index("member_organization_id_idx").on(table.organizationId)]);

  const invitation = pgTable("invitation", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [index("invitation_organization_id_idx").on(table.organizationId)]);

  const subscription = pgTable("subscription", {
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
  }, (table) => [index("subscription_reference_id_idx").on(table.referenceId)]);

  const accountApiToken = pgTable("account_api_token", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  }, (table) => [uniqueIndex("account_api_token_hash_unique").on(table.tokenHash), index("account_api_token_user_id_idx").on(table.userId)]);

  const enterpriseEnrollment = pgTable("enterprise_enrollment", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    code: text("code"),
    enabledApple: boolean("enabled_apple").notNull().default(true),
    enabledWindows: boolean("enabled_windows").notNull().default(true),
    enabledAndroid: boolean("enabled_android").notNull().default(false),
    enabledAssetTag: boolean("enabled_asset_tag").notNull().default(false),
    maxDevices: integer("max_devices").notNull().default(100),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  });

  const device = pgTable(
    "device",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
      proto: text("proto", { enum: ["apple", "win", "android"] }).notNull(),
      status: text("status", { enum: ["enrolling", "enrolled", "unenrolling", "unenrolled"] }).notNull().default("enrolling"),
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

  const deviceApple = pgTable("device_apple", {
    deviceId: text("device_id").primaryKey().references(() => device.id, { onDelete: "cascade" }),
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

  const applePushCertificate = pgTable("apple_push_certificate", {
    organizationId: text("organization_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    topic: text("topic").notNull(),
    certPem: text("cert_pem").notNull(),
    encryptedKey: text("encrypted_key"),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  });

  const enterpriseGroup = pgTable(
    "enterprise_group",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      notes: text("notes"),
      createdAt: timestamp("created_at", { mode: "date" }).notNull(),
      updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    },
    (table) => [index("enterprise_group_organization_id_idx").on(table.organizationId)],
  );

  const policy = pgTable(
    "policy",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      notes: text("notes"),
      createdAt: timestamp("created_at", { mode: "date" }).notNull(),
      updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    },
    (table) => [index("policy_organization_id_idx").on(table.organizationId)],
  );

  const configuration = pgTable(
    "configuration",
    {
      kind: text("kind").notNull(),
      policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
      data: jsonb("data").notNull(),
      hash: text("hash").notNull(),
    },
    (table) => [primaryKey({ columns: [table.kind, table.policyId] })],
  );

  const groupDevice = pgTable(
    "group_device",
    {
      groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
      deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.groupId, table.deviceId] })],
  );

  const groupPolicy = pgTable(
    "group_policy",
    {
      groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
      policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.groupId, table.policyId] })],
  );

  const organizationDeviceUsage = pgTable(
    "organization_device_usage",
    {
      organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
      period: text("period").notNull(),
      billableDevices: integer("billable_devices").notNull(),
      stripeSubscriptionItemId: text("stripe_subscription_item_id"),
      lastReportedAt: timestamp("last_reported_at", { mode: "date" }),
      createdAt: timestamp("created_at", { mode: "date" }).notNull(),
      updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.organizationId, table.period] })],
  );

  return {
    user,
    session,
    account,
    verification,
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
  };
};

export type EnterpriseSchema = ReturnType<typeof createEnterpriseSchema>;
export type EnterpriseUser = InferSelectModel<EnterpriseSchema["user"]>;
export type EnterpriseOrganization = InferSelectModel<EnterpriseSchema["organization"]>;
export type EnterpriseApiToken = InferSelectModel<EnterpriseSchema["accountApiToken"]>;
export type EnterpriseDevice = InferSelectModel<EnterpriseSchema["device"]>;
export type EnterpriseGroup = InferSelectModel<EnterpriseSchema["enterpriseGroup"]>;
export type EnterprisePolicy = InferSelectModel<EnterpriseSchema["policy"]>;
export type EnterpriseEnrollment = InferSelectModel<EnterpriseSchema["enterpriseEnrollment"]>;
export type EnterpriseConfiguration = InferSelectModel<EnterpriseSchema["configuration"]>;
export type EnterpriseGroupDevice = InferSelectModel<EnterpriseSchema["groupDevice"]>;
export type EnterpriseGroupPolicy = InferSelectModel<EnterpriseSchema["groupPolicy"]>;

type DbEffect<A> = Effect.Effect<A, unknown>;
type DbBuilder<A> = DbEffect<A> & {
  readonly from: (table: unknown) => DbBuilder<A>;
  readonly innerJoin: (table: unknown, condition: unknown) => DbBuilder<A>;
  readonly where: (condition: unknown) => DbBuilder<A>;
  readonly limit: (count: number) => DbBuilder<A>;
  readonly values: (values: unknown) => DbBuilder<A>;
  readonly set: (values: unknown) => DbBuilder<A>;
  readonly returning: (fields?: unknown) => DbBuilder<A>;
  readonly onConflictDoNothing: () => DbBuilder<A>;
  readonly onConflictDoUpdate: (config: unknown) => DbBuilder<A>;
};

type FindFirst<A> = (query?: unknown) => DbEffect<A | undefined>;

export type EnterpriseDb = {
  readonly query: {
    readonly user: { readonly findFirst: FindFirst<EnterpriseUser> };
    readonly session: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["session"]>> };
    readonly account: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["account"]>> };
    readonly verification: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["verification"]>> };
    readonly organization: { readonly findFirst: FindFirst<EnterpriseOrganization> };
    readonly member: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["member"]>> };
    readonly invitation: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["invitation"]>> };
    readonly accountApiToken: { readonly findFirst: FindFirst<EnterpriseApiToken> };
    readonly enterpriseEnrollment: { readonly findFirst: FindFirst<EnterpriseEnrollment> };
    readonly device: { readonly findFirst: FindFirst<EnterpriseDevice> };
    readonly applePushCertificate: { readonly findFirst: FindFirst<InferSelectModel<EnterpriseSchema["applePushCertificate"]>> };
    readonly enterpriseGroup: { readonly findFirst: FindFirst<EnterpriseGroup> };
    readonly policy: { readonly findFirst: FindFirst<EnterprisePolicy> };
  };
  readonly select: <A = ReadonlyArray<unknown>>(fields?: unknown) => DbBuilder<A>;
  readonly insert: (table: unknown) => DbBuilder<unknown>;
  readonly update: (table: unknown) => DbBuilder<unknown>;
  readonly delete: (table: unknown) => DbBuilder<ReadonlyArray<unknown>>;
};
