import { schema as coreSchema, type EnterpriseDb } from "@mattrax/enterprise-core";

/**
 * The enterprise schema is owned by `@mattrax/enterprise-core` so that the
 * API, management backends, and enterprise backend all share one definition.
 */
export const schema = coreSchema;

export type EnterpriseSchema = typeof schema;
export type { EnterpriseDb };

export type EnterpriseUser = typeof schema.user.$inferSelect;
export type EnterpriseApiToken = typeof schema.accountApiToken.$inferSelect;
export type EnterpriseOrganization = typeof schema.organization.$inferSelect;
export type EnterpriseDevice = typeof schema.device.$inferSelect;
export type EnterpriseEnrollment = typeof schema.enterpriseEnrollment.$inferSelect;
export type EnterpriseGroup = typeof schema.enterpriseGroup.$inferSelect;
export type EnterpriseGroupDevice = typeof schema.groupDevice.$inferSelect;
export type EnterpriseGroupPolicy = typeof schema.groupPolicy.$inferSelect;
export type EnterprisePolicy = typeof schema.policy.$inferSelect;
export type EnterpriseConfiguration = typeof schema.configuration.$inferSelect;
export type EnterpriseApplePushCertificate = typeof schema.applePushCertificate.$inferSelect;
export type EnterpriseApplePushKey = typeof schema.applePushKey.$inferSelect;

/** Used by tests to construct a schema-aware in-memory database. */
export const createEnterpriseSchema = (): EnterpriseSchema => schema;
