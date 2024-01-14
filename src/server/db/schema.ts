import { varchar, serial, mysqlTableCreator } from "drizzle-orm/mysql-core";

const mysqlTable = mysqlTableCreator((name) => `forge_${name}`);

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }),
  email: varchar("email", { length: 256 }),
});
