import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

type CoreSchema = {
  readonly organization: { readonly id: any };
};

export const createEnterpriseSchema = (core: CoreSchema) => {
  const enterpriseEnrollment = sqliteTable("enterprise_enrollment", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => core.organization.id, { onDelete: "cascade" }),
    code: text("code"),
    enabledApple: integer("enabled_apple", { mode: "boolean" }).notNull().default(true),
    enabledWindows: integer("enabled_windows", { mode: "boolean" }).notNull().default(true),
    enabledAndroid: integer("enabled_android", { mode: "boolean" }).notNull().default(false),
    enabledAssetTag: integer("enabled_asset_tag", { mode: "boolean" }).notNull().default(false),
    maxDevices: integer("max_devices").notNull().default(100),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  });

  const device = sqliteTable(
    "device",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => core.organization.id, { onDelete: "cascade" }),
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

  const deviceApple = sqliteTable("device_apple", {
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

  const applePushCertificate = sqliteTable("apple_push_certificate", {
    organizationId: text("organization_id").primaryKey().references(() => core.organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    topic: text("topic").notNull(),
    certPem: text("cert_pem").notNull(),
    encryptedKey: text("encrypted_key"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  });

  const enterpriseGroup = sqliteTable(
    "enterprise_group",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => core.organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      notes: text("notes"),
      createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    },
    (table) => [index("enterprise_group_organization_id_idx").on(table.organizationId)],
  );

  const policy = sqliteTable(
    "policy",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id").notNull().references(() => core.organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      notes: text("notes"),
      createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    },
    (table) => [index("policy_organization_id_idx").on(table.organizationId)],
  );

  const configuration = sqliteTable(
    "configuration",
    {
      kind: text("kind").notNull(),
      policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
      data: text("data", { mode: "json" }).notNull(),
      hash: text("hash").notNull(),
    },
    (table) => [primaryKey({ columns: [table.kind, table.policyId] })],
  );

  const groupDevice = sqliteTable(
    "group_device",
    {
      groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
      deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.groupId, table.deviceId] })],
  );

  const groupPolicy = sqliteTable(
    "group_policy",
    {
      groupId: text("group_id").notNull().references(() => enterpriseGroup.id, { onDelete: "cascade" }),
      policyId: text("policy_id").notNull().references(() => policy.id, { onDelete: "cascade" }),
    },
    (table) => [primaryKey({ columns: [table.groupId, table.policyId] })],
  );

  const organizationDeviceUsage = sqliteTable(
    "organization_device_usage",
    {
      organizationId: text("organization_id").notNull().references(() => core.organization.id, { onDelete: "cascade" }),
      period: text("period").notNull(),
      billableDevices: integer("billable_devices").notNull(),
      stripeSubscriptionItemId: text("stripe_subscription_item_id"),
      lastReportedAt: integer("last_reported_at", { mode: "timestamp_ms" }),
      createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
      updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.organizationId, table.period] })],
  );

  return {
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
