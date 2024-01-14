import {
  varchar,
  serial,
  mysqlTableCreator,
  int,
} from "drizzle-orm/mysql-core";

const mysqlTable = mysqlTableCreator((name) => `forge_${name}`);

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }),
  email: varchar("email", { length: 256 }),
});

export const tenants = mysqlTable("tenant", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  description: varchar("email", { length: 256 }),
  owner_id: int("owner_id").references(() => users.id),
});

export const policies = mysqlTable("policies", {
  id: serial("id").primaryKey(),
  // name: varchar("name", { length: 256 }),
  // description: varchar("email", { length: 256 }),
});

export const devices = mysqlTable("devices", {
  id: serial("id").primaryKey(),
  // name: varchar("name", { length: 256 }),
  // description: varchar("email", { length: 256 }),
});

export const applications = mysqlTable("apps", {
  id: serial("id").primaryKey(),
  // name: varchar("name", { length: 256 }),
  // description: varchar("email", { length: 256 }),
});
