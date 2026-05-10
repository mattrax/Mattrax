import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const scepCa = sqliteTable("scep_ca", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: text("private_key_jwk", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
