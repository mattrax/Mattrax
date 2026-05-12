import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = sqliteTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("organization_slug_unique").on(table.slug)],
);

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("member_user_organization_unique").on(table.userId, table.organizationId),
    index("member_organization_id_idx").on(table.organizationId),
  ],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("invitation_organization_id_idx").on(table.organizationId)],
);

export const subscription = sqliteTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull(),
    periodStart: integer("period_start", { mode: "timestamp_ms" }),
    periodEnd: integer("period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }),
    cancelAt: integer("cancel_at", { mode: "timestamp_ms" }),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    seats: integer("seats"),
    trialStart: integer("trial_start", { mode: "timestamp_ms" }),
    trialEnd: integer("trial_end", { mode: "timestamp_ms" }),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (table) => [index("subscription_reference_id_idx").on(table.referenceId)],
);

export const scepCa = sqliteTable("scep_ca", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: text("private_key_jwk", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const enterpriseEnrollment = sqliteTable("enterprise_enrollment", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  code: text("code"),
  enabledApple: integer("enabled_apple", { mode: "boolean" }).notNull().default(true),
  enabledWindows: integer("enabled_windows", { mode: "boolean" }).notNull().default(true),
  enabledAndroid: integer("enabled_android", { mode: "boolean" }).notNull().default(false),
  enabledAssetTag: integer("enabled_asset_tag", { mode: "boolean" }).notNull().default(false),
  maxDevices: integer("max_devices").notNull().default(100),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const device = sqliteTable(
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
    enrolledAt: integer("enrolled_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
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

export const deviceApple = sqliteTable("device_apple", {
  deviceId: text("device_id").primaryKey().references(() => device.id, { onDelete: "cascade" }),
  enrollmentId: text("enrollment_id"),
  token: text("token"),
  pushMagic: text("push_magic"),
  topic: text("topic"),
  unlockToken: text("unlock_token"),
  bootstrapToken: text("bootstrap_token"),
  configured: integer("configured", { mode: "boolean" }).notNull().default(false),
  deviceToken: text("device_token"),
  tokenUpdatedAt: integer("token_updated_at", { mode: "timestamp_ms" }),
});

export const applePushCertificate = sqliteTable("apple_push_certificate", {
  organizationId: text("organization_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  topic: text("topic").notNull(),
  certPem: text("cert_pem").notNull(),
  encryptedKey: text("encrypted_key"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const enterpriseGroup = sqliteTable(
  "enterprise_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("enterprise_group_organization_id_idx").on(table.organizationId)],
);

export const policy = sqliteTable(
  "policy",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("policy_organization_id_idx").on(table.organizationId)],
);

export const configuration = sqliteTable(
  "configuration",
  {
    kind: text("kind").notNull(),
    policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
    data: text("data", { mode: "json" }).notNull(),
    hash: text("hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.policyId] })],
);

export const groupDevice = sqliteTable(
  "group_device",
  {
    groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.deviceId] })],
);

export const groupPolicy = sqliteTable(
  "group_policy",
  {
    groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
    policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.policyId] })],
);

export const organizationDeviceUsage = sqliteTable(
  "organization_device_usage",
  {
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    billableDevices: integer("billable_devices").notNull(),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    lastReportedAt: integer("last_reported_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.period] })],
);
