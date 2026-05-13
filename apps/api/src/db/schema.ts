import { createEnterpriseSchema } from "@mattrax/enterprise-backend/schema";
import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

const enterpriseSchema = createEnterpriseSchema();

export const user: any = enterpriseSchema.user;
export const session: any = enterpriseSchema.session;
export const account: any = enterpriseSchema.account;
export const verification: any = enterpriseSchema.verification;
export const organization: any = enterpriseSchema.organization;
export const member: any = enterpriseSchema.member;
export const invitation: any = enterpriseSchema.invitation;
export const subscription: any = enterpriseSchema.subscription;
export const accountApiToken: any = enterpriseSchema.accountApiToken;
export const enterpriseEnrollment: any = enterpriseSchema.enterpriseEnrollment;
export const device: any = enterpriseSchema.device;
export const deviceApple: any = enterpriseSchema.deviceApple;
export const applePushCertificate: any = enterpriseSchema.applePushCertificate;
export const enterpriseGroup: any = enterpriseSchema.enterpriseGroup;
export const policy: any = enterpriseSchema.policy;
export const configuration: any = enterpriseSchema.configuration;
export const groupDevice: any = enterpriseSchema.groupDevice;
export const groupPolicy: any = enterpriseSchema.groupPolicy;
export const organizationDeviceUsage: any = enterpriseSchema.organizationDeviceUsage;

export const scepCa = pgTable("scep_ca", {
  id: serial("id").primaryKey(),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: jsonb("private_key_jwk").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const dbSchema: any = {
  ...enterpriseSchema,
  scepCa,
};
