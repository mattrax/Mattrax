import {
  varchar,
  serial,
  json,
  timestamp,
  mysqlEnum,
  unique,
  primaryKey,
  bigint,
  mysqlTable,
  boolean,
  varbinary,
  datetime,
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const serialRelation = (name: string) =>
  bigint(name, { mode: "number", unsigned: true });

const cuid = (name: string) =>
  varchar(name, { length: 24 }).$default(() => createId());

export type TableID<Table extends string> = number & { __table: Table };

// An account represents the login of an *administrator*.
export const accounts = mysqlTable("accounts", {
  pk: serial("id").primaryKey(),
  id: varchar("luciaId", { length: 16 }).notNull().unique(),
  email: varchar("email", { length: 256 }).unique().notNull(),
  name: varchar("name", { length: 256 }).notNull(),
});

export const sessions = mysqlTable("session", {
  id: varchar("id", {
    length: 255,
  }).primaryKey(),
  userId: varchar("accountPk", {
    length: 255,
  })
    .notNull()
    .references(() => accounts.id),
  expiresAt: datetime("expires_at").notNull(),
});

export const tenants = mysqlTable("tenant", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  billingEmail: varchar("billingEmail", { length: 256 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 256 }),
  enrollmentEnabled: boolean("enrollmentEnabled").notNull().default(true),
  ownerPk: serialRelation("ownerId")
    .references(() => accounts.pk)
    .notNull(),
});

export const tenantAccounts = mysqlTable(
  "tenant_account",
  {
    tenantPk: serialRelation("tenantId")
      .references(() => tenants.pk)
      .notNull(),
    accountPk: serialRelation("accountId")
      .references(() => accounts.pk)
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantPk, table.accountPk] }),
  })
);

export const tenantAccountInvites = mysqlTable(
  "tenant_account_invites",
  {
    code: varchar("code", { length: 256 }).primaryKey(),
    tenantPk: serialRelation("tenantId")
      .references(() => tenants.pk)
      .notNull(),
    email: varchar("email", { length: 256 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (table) => ({
    emailUnique: unique().on(table.tenantPk, table.email),
  })
);

const userProviderVariants = [
  "entraId",
  // "gsuite"
] as const;

export type UserProviderVariant = (typeof userProviderVariants)[number];

// A link between a tenant and an external authentication provider.
export const tenantUserProvider = mysqlTable(
  "tenant_user_provider",
  {
    pk: serial("id").primaryKey(),
    id: cuid("cuid").notNull().unique(),
    variant: mysqlEnum("provider", userProviderVariants).notNull(),
    // ID of the remote user provider
    remoteId: varchar("resourceId", { length: 256 }).notNull(),
    tenantPk: serialRelation("tenantId")
      .references(() => tenants.pk)
      .notNull(),
    lastSynced: timestamp("lastSynced"),
  },
  (table) => {
    return {
      unique: unique().on(table.tenantPk, table.variant, table.remoteId),
    };
  }
);

// An account represents the login of an *end-user*.
// These are scoped to a tenant and can't login to the Mattrax dashboard.
export const users = mysqlTable(
  "users",
  {
    pk: serial("id").primaryKey(),
    id: cuid("cuid").notNull().unique(),
    name: varchar("name", { length: 256 }).notNull(),
    email: varchar("email", { length: 256 }).notNull(),
    tenantPk: serialRelation("tenantId")
      .references(() => tenants.pk)
      .notNull(),
    providerPk: serialRelation("provider")
      .references(() => tenantUserProvider.pk)
      .notNull(),
    // ID of the user in the remove provider
    providerResourceId: varchar("resourceId", { length: 256 }).notNull(),
    groupableVariant: mysqlEnum("groupableVariant", ["user"])
      .notNull()
      .default("user"),
  },
  (t) => ({
    emailUnq: unique().on(t.email, t.tenantPk),
  })
);

export const policies = mysqlTable("policies", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  activeVersion: serialRelation("activeVersion").references(
    () => policyVersions.pk
  ),
  tenantPk: serialRelation("tenantId")
    .references(() => tenants.pk)
    .notNull(),
  groupableVariant: mysqlEnum("groupableVariant", ["policy"])
    .notNull()
    .default("policy"),
});

export const policyVersions = mysqlTable("policy_versions", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  policyPk: serialRelation("policyId")
    // .references(() => policies.id) // This creates a circular reference so is let uncommented
    .notNull(),
  // status: mysqlEnum("status", ["open", "staged", "deployed"])
  //   .notNull()
  //   .default("open"),
  data: json("data").notNull().default([]),
  // deployedAt: timestamp("deployedAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const devices = mysqlTable("devices", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 256 }),

  operatingSystem: varchar("operatingSystem", { length: 256 }).notNull(), // TODO: Enum maybe?
  serialNumber: varchar("serialNumber", { length: 256 }).notNull(),

  manufacturer: varchar("manufacturer", { length: 256 }),
  model: varchar("model", { length: 256 }),
  osVersion: varchar("osVersion", { length: 256 }),
  imei: varchar("imei", { length: 256 }),

  freeStorageSpaceInBytes: bigint("freeStorageSpaceInBytes", {
    mode: "number",
    unsigned: true,
  }),
  totalStorageSpaceInBytes: bigint("totalStorageSpaceInBytes", {
    mode: "number",
    unsigned: true,
  }),

  owner: serialRelation("owner").references(() => users.pk),

  azureADDeviceId: varchar("azureADDeviceId", { length: 256 })
    .notNull()
    .unique(),

  enrolledAt: timestamp("enrolledAt").notNull().defaultNow(),
  lastSynced: timestamp("lastSynced").notNull().defaultNow(),

  tenantPk: serialRelation("tenantId")
    .references(() => tenants.pk)
    .notNull(),

  groupableVariant: mysqlEnum("groupableVariant", ["device"])
    .notNull()
    .default("device"),
});

export const devicesRelations = relations(devices, ({ one }) => ({
  groupable: one(groupables, {
    fields: [devices.pk, devices.groupableVariant],
    references: [groupables.pk, groupables.variant],
  }),
}));

export const groupableVariants = ["user", "device", "policy"] as const;

export const groupables = mysqlTable(
  "groupables",
  {
    pk: serialRelation("id").notNull(),
    variant: mysqlEnum("variant", groupableVariants).notNull(),
    tenantPk: serialRelation("tenantId")
      .references(() => tenants.pk)
      .notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.pk, table.variant] }) })
);

export const groupGroupables = mysqlTable(
  "group_groupables",
  {
    groupPk: serialRelation("groupId")
      .references(() => groups.pk)
      .notNull(),
    groupablePk: serialRelation("groupableId").notNull(),
    groupableVariant: mysqlEnum(
      "groupableVariant",
      groupableVariants
    ).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.groupPk, table.groupablePk, table.groupableVariant],
    }),
  })
);

export const groups = mysqlTable("groups", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  name: varchar("name", { length: 256 }),
  tenantPk: serialRelation("tenantId")
    .references(() => tenants.pk)
    .notNull(),
});

export const groupRelations = relations(groups, ({ many }) => ({
  groupables: many(groupGroupables),
}));

export const applications = mysqlTable("apps", {
  pk: serial("id").primaryKey(),
  id: cuid("cuid").notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 256 }),
  tenantPk: serialRelation("tenantId")
    .references(() => tenants.pk)
    .notNull(),
});

export const domains = mysqlTable("domains", {
  domain: varchar("domain", { length: 256 }).primaryKey(),
  secret: varchar("secret", { length: 256 }).notNull().unique(),
  tenantPk: serialRelation("tenantId")
    .references(() => tenants.pk)
    .notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  lastVerificationTime: timestamp("lastVerificationTime"),
  verified: boolean("verified").notNull().default(false),
  enterpriseEnrollmentAvailable: boolean("enterpriseEnrollmentAvailable")
    .notNull()
    .default(false),
});

export const domainToCertificateRelation = relations(domains, ({ one }) => ({
  certificate: one(certificates, {
    fields: [domains.domain],
    references: [certificates.key],
  }),
}));

// The backend for Rust's ACME.
// This will contain the certificate for the primary server domain and any user-provided via `domains`.
// The `key` will either be a comma separated list of domains (for a certificate) or comma separated list of email address (for an ACME account).
export const certificates = mysqlTable("certificates", {
  key: varchar("key", { length: 256 }).primaryKey(),
  certificate: varbinary("certificate", { length: 9068 }).notNull(),
  lastModified: timestamp("lastModified").notNull().defaultNow(),
});

export const accountLoginCodes = mysqlTable("account_login_codes", {
  code: varchar("code", { length: 8 }).notNull().primaryKey(),
  accountPk: serialRelation("accountPk")
    .references(() => accounts.pk)
    .notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});
