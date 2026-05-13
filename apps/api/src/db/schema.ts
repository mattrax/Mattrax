import { createEnterpriseSchema } from "@mattrax/enterprise-backend/schema";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("organization_slug_unique").on(table.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("member_user_organization_unique").on(table.userId, table.organizationId),
    index("member_organization_id_idx").on(table.organizationId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [index("invitation_organization_id_idx").on(table.organizationId)],
);

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull(),
    periodStart: timestamp("period_start", { mode: "date" }),
    periodEnd: timestamp("period_end", { mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    cancelAt: timestamp("cancel_at", { mode: "date" }),
    canceledAt: timestamp("canceled_at", { mode: "date" }),
    endedAt: timestamp("ended_at", { mode: "date" }),
    seats: integer("seats"),
    trialStart: timestamp("trial_start", { mode: "date" }),
    trialEnd: timestamp("trial_end", { mode: "date" }),
    billingInterval: text("billing_interval"),
    stripeScheduleId: text("stripe_schedule_id"),
  },
  (table) => [index("subscription_reference_id_idx").on(table.referenceId)],
);

export const scepCa = pgTable("scep_ca", {
  id: serial("id").primaryKey(),
  certPem: text("cert_pem").notNull(),
  privateKeyJwk: jsonb("private_key_jwk").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

const enterpriseSchema = createEnterpriseSchema({ organization });

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

export const dbSchema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  subscription,
  scepCa,
  enterpriseEnrollment,
  device,
  deviceApple,
  applePushCertificate,
  enterpriseGroup,
  policy,
  configuration,
  groupDevice,
  groupPolicy,
  organizationDeviceUsage,
};
