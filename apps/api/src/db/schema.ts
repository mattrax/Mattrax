import { createEnterpriseSchema } from "@mattrax/enterprise-backend/schema";
import type { EnterpriseSchema } from "@mattrax/enterprise-backend/schema";
import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

const enterpriseSchema = createEnterpriseSchema();

export const user: EnterpriseSchema["user"] = enterpriseSchema.user;
export const session: EnterpriseSchema["session"] = enterpriseSchema.session;
export const account: EnterpriseSchema["account"] = enterpriseSchema.account;
export const verification: EnterpriseSchema["verification"] = enterpriseSchema.verification;
export const organization: EnterpriseSchema["organization"] = enterpriseSchema.organization;
export const member: EnterpriseSchema["member"] = enterpriseSchema.member;
export const invitation: EnterpriseSchema["invitation"] = enterpriseSchema.invitation;
export const subscription: EnterpriseSchema["subscription"] = enterpriseSchema.subscription;
export const accountApiToken: EnterpriseSchema["accountApiToken"] = enterpriseSchema.accountApiToken;
export const enterpriseEnrollment: EnterpriseSchema["enterpriseEnrollment"] = enterpriseSchema.enterpriseEnrollment;
export const device: EnterpriseSchema["device"] = enterpriseSchema.device;
export const deviceApple: EnterpriseSchema["deviceApple"] = enterpriseSchema.deviceApple;
export const applePushCertificate: EnterpriseSchema["applePushCertificate"] = enterpriseSchema.applePushCertificate;
export const enterpriseGroup: EnterpriseSchema["enterpriseGroup"] = enterpriseSchema.enterpriseGroup;
export const policy: EnterpriseSchema["policy"] = enterpriseSchema.policy;
export const configuration: EnterpriseSchema["configuration"] = enterpriseSchema.configuration;
export const groupDevice: EnterpriseSchema["groupDevice"] = enterpriseSchema.groupDevice;
export const groupPolicy: EnterpriseSchema["groupPolicy"] = enterpriseSchema.groupPolicy;
export const organizationDeviceUsage: EnterpriseSchema["organizationDeviceUsage"] = enterpriseSchema.organizationDeviceUsage;

export const scepCa = pgTable("scep_ca", {
  id: serial("id").primaryKey(),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: jsonb("private_key_jwk").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const dbSchema: EnterpriseSchema & { readonly scepCa: typeof scepCa } = {
  ...enterpriseSchema,
  scepCa,
};
