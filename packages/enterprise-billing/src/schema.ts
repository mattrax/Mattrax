import {
  boolean,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Schema for the hosted services deployment (`services.mattrax.app`).
 *
 * These tables are deliberately separate from the main application schema and
 * live in their own database. The `services_` prefix makes the boundary
 * visible in SQL and lets the deployment share a MySQL instance without
 * colliding with a customer's own Mattrax tables.
 *
 * Billing rows reference tenants by id only. There is no foreign key into the
 * application database: the services deployment must keep working when the
 * application database is unavailable, unavailable to us, or self-hosted by a
 * customer.
 */

const id = (name = "id") => varchar(name, { length: 255 });

const shortText = (name: string) => varchar(name, { length: 255 });

const timestamp = (name: string) => datetime(name, { mode: "date", fsp: 3 });

/**
 * A self-hosted deployment licensed to run Mattrax.
 *
 * Hosted tenants are billed through `subscription`; a self-hosted operator is
 * billed once for the whole deployment. The licence key is stored hashed and
 * authenticates the deployment's calls to the services API, including APNs
 * relay requests.
 */
export const deploymentLicense = mysqlTable(
  "services_deployment_license",
  {
    id: id().primaryKey(),
    name: shortText("name").notNull(),
    licenseKeyHash: shortText("license_key_hash").notNull(),
    licenseKeyPrefix: shortText("license_key_prefix").notNull(),
    /** Public origin of the deployment, bound on first contact. */
    origin: shortText("origin"),
    contactEmail: varchar("contact_email", { length: 320 }),
    stripeCustomerId: shortText("stripe_customer_id"),
    stripeSubscriptionId: shortText("stripe_subscription_id"),
    plan: shortText("plan").notNull().default("device"),
    status: varchar("status", { length: 32 }),
    deviceCount: int("device_count").notNull().default(0),
    tenantCount: int("tenant_count").notNull().default(0),
    periodEnd: timestamp("period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("services_deployment_license_key_unique").on(table.licenseKeyHash),
    uniqueIndex("services_deployment_license_customer_unique").on(table.stripeCustomerId),
  ],
);

/**
 * Billing projection of a hosted tenant.
 *
 * Cloud owns tenant identity; this row only stores what Stripe needs. It is
 * created lazily the first time a tenant asks to manage billing, so an
 * unbilled tenant costs nothing.
 */
export const tenant = mysqlTable(
  "services_tenant",
  {
    id: id().primaryKey(),
    name: shortText("name").notNull(),
    stripeCustomerId: shortText("stripe_customer_id"),
    /** Last time the entitlement was pushed to the application deployment. */
    entitlementSyncedAt: timestamp("entitlement_synced_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [uniqueIndex("services_tenant_customer_unique").on(table.stripeCustomerId)],
);

/** The Stripe subscription that grants a hosted tenant its plan. */
export const subscription = mysqlTable(
  "services_subscription",
  {
    id: id().primaryKey(),
    plan: shortText("plan").notNull(),
    tenantId: shortText("tenant_id").notNull(),
    stripeCustomerId: shortText("stripe_customer_id"),
    stripeSubscriptionId: shortText("stripe_subscription_id"),
    status: varchar("status", { length: 32 }).notNull(),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("services_subscription_tenant_unique").on(table.tenantId),
    uniqueIndex("services_subscription_stripe_unique").on(table.stripeSubscriptionId),
  ],
);

/**
 * Usage reported by the application deployment.
 *
 * Seat reconciliation needs the fleet size, but devices live in the
 * application database. The application reports a small snapshot so this
 * deployment never needs a second database connection.
 */
export const tenantUsage = mysqlTable("services_tenant_usage", {
  tenantId: id("tenant_id").primaryKey(),
  billableDevices: int("billable_devices").notNull().default(0),
  devicesUsed: int("devices_used").notNull().default(0),
  tenantCount: int("tenant_count").notNull().default(0),
  reportedAt: timestamp("reported_at").notNull(),
});

/**
 * Stripe event ids already applied. The primary key is the dedupe key, so the
 * insert of a duplicate delivery fails atomically in MySQL even when two
 * instances process the same event concurrently.
 */
export const stripeEvent = mysqlTable(
  "services_stripe_event",
  {
    id: id().primaryKey(),
    type: shortText("type").notNull(),
    tenantId: id("tenant_id"),
    licenseId: id("license_id"),
    receivedAt: timestamp("received_at").notNull(),
  },
  (table) => [index("services_stripe_event_received_at_idx").on(table.receivedAt)],
);

export const servicesSchema = {
  deploymentLicense,
  tenant,
  subscription,
  tenantUsage,
  stripeEvent,
} as const;
