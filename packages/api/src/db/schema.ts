import {
  varchar,
  serial,
  json,
  customType,
  timestamp,
  mysqlEnum,
  unique,
  primaryKey,
  bigint,
  mysqlTable,
  boolean,
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

const serialRelation = (name: string) =>
  bigint(name, { mode: "number", unsigned: true });

export type TableID<Table extends string> = number & { __table: Table };

// An account represents the login of an *administrator*.
export const accounts = mysqlTable("accounts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).unique().notNull(),
});

export const tenants = mysqlTable("tenant", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  billingEmail: varchar("billingEmail", { length: 256 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 256 }),
  enrollmentEnabled: boolean("enrollmentEnabled").notNull().default(true),
  owner_id: serialRelation("ownerId")
    .references(() => accounts.id)
    .notNull(),
});

export const tenantAccounts = mysqlTable(
  "tenant_account",
  {
    tenantId: serialRelation("tenantId")
      .references(() => tenants.id)
      .notNull(),
    accountId: serialRelation("accountId")
      .references(() => accounts.id)
      .notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.tenantId, table.accountId] }),
    };
  }
);

export const tenantAccountInvites = mysqlTable("tenant_account_invites", {
  code: varchar("code", { length: 256 }).primaryKey(),
  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),
  email: varchar("email", { length: 256 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
});

const userProviders = ["entraId", "gsuite"] as const;

export type UserProvider = (typeof userProviders)[number];

// A link between a tenant and an external authentication provider.
export const tenantUserProvider = mysqlTable(
  "tenant_user_provider",
  {
    id: serial("id").primaryKey(),
    name: mysqlEnum("provider", userProviders).notNull(),
    // This is the unique ID for the user in the provider's system.
    resourceId: varchar("resourceId", { length: 256 }).notNull(),
    tenantId: serialRelation("tenantId")
      .references(() => tenants.id)
      .notNull(),
    lastSynced: timestamp("lastSynced"),
  },
  (table) => {
    return {
      unique: unique().on(table.tenantId, table.name, table.resourceId),
    };
  }
);

// An account represents the login of an *end-user*.
// These are scoped to a tenant and can't login to the Mattrax dashboard.
export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    email: varchar("email", { length: 256 }).notNull(),
    tenantId: serialRelation("tenantId")
      .references(() => tenants.id)
      .notNull(),
    provider: serialRelation("provider")
      .references(() => tenantUserProvider.id)
      .notNull(),
    // Resource ID within the provider's system.
    // resourceId: varchar("resourceId", { length: 256 }).notNull(),
    groupableVariant: mysqlEnum("groupableVariant", ["user"])
      .notNull()
      .default("user"),
  },
  (t) => ({
    emailUnq: unique().on(t.email, t.tenantId),
  })
);

export const policies = mysqlTable("policies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  policy: json("policy").default([]).notNull(),
  policyHash: customType<{
    data: string;
  }>({
    dataType: () =>
      "VARCHAR(32) GENERATED ALWAYS AS (md5(JSON_EXTRACT(policy, '$'))) STORED",
  })("policyHash"),
  intuneId: varchar("intuneId", { length: 256 }).unique(),
  // When a policy is uploaded to Intune this will be set to the `policyHash` column.
  // If this doesn't match `policyHash` the policy should be re-uploaded to Intune.
  intunePolicyHash: varchar("intunePolicyHash", { length: 256 }),
  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),

  groupableVariant: mysqlEnum("groupableVariant", ["policy"])
    .notNull()
    .default("policy"),
});

export const devices = mysqlTable("devices", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 256 }),

  manufacturer: varchar("manufacturer", { length: 256 }).notNull(),
  model: varchar("model", { length: 256 }).notNull(),
  operatingSystem: varchar("operatingSystem", { length: 256 }).notNull(), // TODO: Enum maybe?
  osVersion: varchar("osVersion", { length: 256 }).notNull(),
  serialNumber: varchar("serialNumber", { length: 256 }).notNull(),
  imei: varchar("imei", { length: 256 }),

  freeStorageSpaceInBytes: bigint("freeStorageSpaceInBytes", {
    mode: "number",
    unsigned: true,
  }),
  totalStorageSpaceInBytes: bigint("totalStorageSpaceInBytes", {
    mode: "number",
    unsigned: true,
  }),

  owner: serialRelation("owner").references(() => users.id),

  azureADDeviceId: varchar("azureADDeviceId", { length: 256 })
    .notNull()
    .unique(),
  intuneId: varchar("intuneId", { length: 256 }).notNull().unique(),

  enrolledAt: timestamp("enrolledAt").notNull().defaultNow(),
  lastSynced: timestamp("lastSynced").notNull().defaultNow(),

  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),

  groupableVariant: mysqlEnum("groupableVariant", ["device"])
    .notNull()
    .default("device"),
});

export const devicesRelations = relations(devices, ({ one }) => ({
  groupable: one(groupables, {
    fields: [devices.id, devices.groupableVariant],
    references: [groupables.id, groupables.variant],
  }),
}));

export const groupableVariants = ["user", "device", "policy"] as const;

export const groupables = mysqlTable(
  "groupables",
  {
    id: serialRelation("id").notNull(),
    variant: mysqlEnum("variant", groupableVariants).notNull(),
    tenantId: serialRelation("tenantId")
      .references(() => tenants.id)
      .notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.id, table.variant] }) })
);

export const groupGroupables = mysqlTable(
  "group_groupables",
  {
    groupId: serialRelation("groupId")
      .references(() => groups.id)
      .notNull(),
    groupableId: serialRelation("groupableId").notNull(),
    groupableVariant: mysqlEnum(
      "groupableVariant",
      groupableVariants
    ).notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.groupId, table.groupableId, table.groupableVariant],
    }),
  })
);

export const groups = mysqlTable("groups", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }),
  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),
});

export const groupRelations = relations(groups, ({ many }) => ({
  groupables: many(groupGroupables),
}));

export const applications = mysqlTable("apps", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 256 }),
  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),
});

export const domains = mysqlTable("domains", {
  domain: varchar("domain", { length: 256 }).primaryKey(),
  secret: varchar("secret", { length: 256 }).notNull().unique(),
  tenantId: serialRelation("tenantId")
    .references(() => tenants.id)
    .notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  lastVerificationTime: timestamp("lastVerificationTime"),
  verified: boolean("verified").notNull().default(false),
  enterpriseEnrollmentAvailable: boolean("enterpriseEnrollmentAvailable")
    .notNull()
    .default(false),
});
