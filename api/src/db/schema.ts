import {
  varchar,
  serial,
  mysqlTableCreator,
  int,
  json,
  customType,
} from "drizzle-orm/mysql-core";
import { Policy } from "@mattrax/policy";

const mysqlTable = mysqlTableCreator((name) => `forge_${name}`);

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  email: varchar("email", { length: 256 }).unique().notNull(),
});

export const tenants = mysqlTable("tenant", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 256 }),
  owner_id: int("owner_id")
    .references(() => users.id)
    .notNull(),
});

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
  // TODO: Sync device information from Intune
  intuneId: varchar("intuneId", { length: 256 }).notNull().unique(),
});

// export const applications = mysqlTable("apps", {
//   id: serial("id").primaryKey(),
//   // name: varchar("name", { length: 256 }).notNull(),
//   // description: varchar("description", { length: 256 }),
// });

// A table used to hold a single value which is used for accessing the Intune API as Frank.
export const intuneAccessToken = mysqlTable("intune_access_token", {
  id: serial("id").primaryKey(),
  // TODO: Cache proper access token too
  refresh_token: varchar("refresh_token", { length: 1000 }).notNull(),
});
