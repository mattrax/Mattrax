import {
  varchar,
  serial,
  mysqlTableCreator,
  int,
  json,
  customType,
  timestamp,
  mysqlEnum,
  unique,
} from "drizzle-orm/mysql-core";
import { Policy } from "@mattrax/policy";

const mysqlTable = mysqlTableCreator((name) => `forge_${name}`);

export const accounts = mysqlTable("accounts", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).unique().notNull(),
});

export const tenants = mysqlTable("tenant", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 256 }),
  owner_id: int("owner_id")
    .references(() => accounts.id)
    .notNull(),
});

export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    email: varchar("email", { length: 256 }).notNull(),
    tenantId: int("tenantId")
      .references(() => tenants.id)
      .notNull(),
    provider: mysqlEnum("provider", ["mock", "entraId", "gsuite"]).notNull(),
    // This is the unique ID for the user in the provider's system.
    providerId: varchar("providerId", { length: 256 }).notNull(),
  },
  (t) => ({
    emailUnq: unique().on(t.email, t.tenantId),
  })
);

export const policies = mysqlTable("policies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  policy: json("policy").$type<Policy>().default([]).notNull(),
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
  tenantId: int("tenantId")
    .references(() => tenants.id)
    .notNull(),
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

  freeStorageSpaceInBytes: int("freeStorageSpaceInBytes"),
  totalStorageSpaceInBytes: int("totalStorageSpaceInBytes"),

  owner: int("owner").references(() => users.email),

  azureADDeviceId: varchar("azureADDeviceId", { length: 256 })
    .notNull()
    .unique(),
  intuneId: varchar("intuneId", { length: 256 }).notNull().unique(),

  enrolledAt: timestamp("enrolledAt").notNull().defaultNow(),
  lastSynced: timestamp("lastSynced").notNull().defaultNow(),
});

// export const applications = mysqlTable("apps", {
//   id: serial("id").primaryKey(),
//   // name: varchar("name", { length: 256 }).notNull(),
//   // description: varchar("description", { length: 256 }),
// });

type Keys = "intune_refresh_token" | "devices_subscription_id";

// A table used to store key-value pairs.
// This will probs be moved to Redis in the future.
export const kvStore = mysqlTable("kv", {
  key: varchar("key", { length: 200 }).$type<Keys>().primaryKey(),
  value: varchar("value", { length: 1000 }).notNull(),
});
