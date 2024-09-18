import { createId } from "@paralleldrive/cuid2";
import {
	bigint,
	json,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	serial,
	timestamp,
	unique,
	varchar,
} from "drizzle-orm/mysql-core";

// TS table name - plural, camelCase
// SQL table name - singular, snake_case
// TS column name - camelCase
// SQL column name - snake_case, if this is a relation don't append `_id` or `_pk` suffix

// TODO: Planetscale reports all `id` columns containing an unnecessary index. We probs need Drizzle to fix that.

const serialRelation = (name: string) =>
	bigint(name, { mode: "number", unsigned: true });

const cuid = (name: string) =>
	varchar(name, { length: 24 }).$default(() => createId());

export type TableID<Table extends string> = number & { __table: Table };

export const waitlistInterestReasons = [
	"personal",
	"internal-it-team",
	"msp-provider",
	"other",
] as const;

export const waitlistDeploymentMethod = [
	"managed-cloud",
	"private-cloud",
	"onprem",
	"other",
] as const;

// Waitlist is a table of people who have signed up to be notified when Mattrax is available.
// This is exposed as an API that is called by `apps/landing`
export const waitlist = mysqlTable("waitlist", {
	id: serial("id").primaryKey(),
	email: varchar("email", { length: 256 }).notNull().unique(),
	name: varchar("name", { length: 256 }),
	interest: mysqlEnum("interest", waitlistInterestReasons).notNull(),
	deployment: mysqlEnum("deployment", waitlistDeploymentMethod).notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// An account represents the login of an *administrator*.
export const accounts = mysqlTable("accounts", {
	pk: serial("pk").primaryKey(),
	id: varchar("id", { length: 16 }).notNull().unique(),
	email: varchar("email", { length: 256 }).unique().notNull(),
	name: varchar("name", { length: 256 }).notNull(),
});

// Each session represents an authenticated context with a Mattrax account.
// This could represent a browser or a CLI session.
export const sessions = mysqlTable("session", {
	id: varchar("id", {
		length: 255,
	}).primaryKey(),
	// This can't be `accountId` in TS due to Lucia auth
	userId: varchar("account", {
		length: 255,
	})
		.notNull()
		.references(() => accounts.id),
	expiresAt: timestamp("expires_at").notNull(),
});

// When authenticating with a browser, the user will be sent a code to their email.
// We store it in the DB to ensure it can only be redeemed once.
export const accountLoginCodes = mysqlTable("account_login_codes", {
	code: varchar("code", { length: 8 }).notNull().primaryKey(),
	accountPk: serialRelation("account")
		.references(() => accounts.pk)
		.notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A tenant represents a distinct entity using Mattrax.
// All groups devices, users, policies and applications are owned by a tenant.
//
// A tenant will generally map to a company or organisation.
export const tenants = mysqlTable("tenant", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 100 }).notNull(),
	stripeCustomerId: varchar("stripe_customer_id", { length: 256 }),
	billingEmail: varchar("billing_email", { length: 256 }),
});

export const tenantMembers = mysqlTable(
	"tenant_members",
	{
		tenantPk: serialRelation("tenant")
			.references(() => tenants.pk)
			.notNull(),
		accountPk: serialRelation("account")
			.references(() => accounts.pk)
			.notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.tenantPk, table.accountPk] }),
	}),
);

export const tenantInvites = mysqlTable(
	"tenant_invites",
	{
		code: varchar("code", { length: 256 }).primaryKey(),
		tenantPk: serialRelation("tenant")
			.references(() => tenants.pk)
			.notNull(),
		email: varchar("email", { length: 256 }).notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		emailUnique: unique().on(table.tenantPk, table.email),
	}),
);

// export const enrollmentAttempts = mysqlTable("enrollment_attempts", {
// 	id: cuid("id").notNull().unique(),
// 	status: mysqlEnum("status", ["pending", "success", "failed"]).notNull(),
// 	// TODO: Device information, error information
// 	doneAt: timestamp("created_at").notNull().defaultNow(),
// });

export const blueprints = mysqlTable("blueprints", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),
	data: json("data").notNull().default({}), // TODO: .$type<PolicyData>()
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
	lastModified: timestamp("last_modified").notNull().defaultNow(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const possibleOSes = [
	"Windows",
	"iOS",
	"macOS",
	"tvOS",
	"Android",
	"ChromeOS",
] as const;

export const devices = mysqlTable("devices", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	// A unique identifier for the device used at the MDM layer.
	// This will always change between re-enrollments

	//  which is desired for the frontend cache key to stay consistent.
	mdm_id: cuid("mdm_id").notNull().unique(), // TODO: Do we need this?
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),

	enrollmentType: mysqlEnum("enrollment_type", ["user", "device"]).notNull(),
	os: mysqlEnum("os", possibleOSes).notNull(),

	// This must be a unique *hardware* identifier
	serialNumber: varchar("serial_number", { length: 256 }).unique().notNull(),

	manufacturer: varchar("manufacturer", { length: 256 }),
	model: varchar("model", { length: 256 }),
	osVersion: varchar("os_version", { length: 256 }),
	imei: varchar("imei", { length: 256 }),

	freeStorageSpaceInBytes: bigint("free_storage", { mode: "number" }),
	totalStorageSpaceInBytes: bigint("total_storage", { mode: "number" }),

	// owner: serialRelation("owner").references(() => users.pk),

	azureADDeviceId: varchar("azure_ad_did", { length: 256 }).unique(),

	enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
	// This will be set if enrolled by a Mattrax account. If null it was enrolled by a user themselves.
	enrolledBy: serialRelation("enrolled_by"),
	lastSynced: timestamp("last_synced").notNull().defaultNow(),

	blueprint: serialRelation("blueprint").references(() => blueprints.pk),

	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
});

export const possibleDeviceActions = [
	"restart",
	"shutdown",
	"lost",
	"wipe",
	"retire",
] as const;

// Device actions are ephemeral. They will be deleted after they are completed.
export const deviceActions = mysqlTable(
	"device_actions",
	{
		action: mysqlEnum("action", possibleDeviceActions).notNull(),
		devicePk: serialRelation("device")
			.notNull()
			.references(() => devices.pk),
		createdBy: serialRelation("created_by")
			.notNull()
			.references(() => accounts.pk),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.action, table.devicePk] }),
	}),
);
