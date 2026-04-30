import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  udid: text("udid").notNull().unique(),
  serialNumber: text("serial_number"),
  model: text("model"),
  osVersion: text("os_version"),
  supportsDdm: integer("supports_ddm", { mode: "boolean" }).notNull().default(false),
  pushToken: text("push_token"),
  pushMagic: text("push_magic"),
  topic: text("topic"),
  channel: text("channel", { enum: ["device", "user"] }).notNull().default("device"),
  status: text("status", { enum: ["enrolling", "active", "checked_out"] }).notNull().default("enrolling"),
  enrolledAt: integer("enrolled_at", { mode: "timestamp" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
  identityCertPem: text("identity_cert_pem"),
});

export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull().references(() => devices.id),
  requestType: text("request_type").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  status: text("status", { enum: ["pending", "sent", "acknowledged", "error", "not_now"] }).notNull().default("pending"),
  resultDetail: text("result_detail"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" }),
});

export const declarations = sqliteTable("declarations", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["configuration", "activation", "asset", "management"] }).notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  serverToken: text("server_token").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const deviceDeclarations = sqliteTable("device_declarations", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  declarationId: text("declaration_id").notNull().references(() => declarations.id),
  status: text("status", { enum: ["pending", "active", "failed", "removed"] }).notNull().default("pending"),
  detail: text("detail"),
  serverToken: text("server_token").notNull(),
});

export const scepCa = sqliteTable("scep_ca", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: text("private_key_jwk", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
