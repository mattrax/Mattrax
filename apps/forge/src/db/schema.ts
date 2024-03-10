import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
	bigint,
	boolean,
	datetime,
	json,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	serial,
	timestamp,
	unique,
	varbinary,
	varchar,
} from "drizzle-orm/mysql-core";

const serialRelation = (name: string) =>
	bigint(name, { mode: "number", unsigned: true });

const cuid = (name: string) =>
	varchar(name, { length: 24 }).$default(() => createId());

export type TableID<Table extends string> = number & { __table: Table };

// An account represents the login of an *administrator*.
export const accounts = mysqlTable("accounts", {
	pk: serial("id").primaryKey(),
	id: varchar("luciaId", { length: 16 }).notNull().unique(),
	email: varchar("email", { length: 256 }).unique().notNull(),
	name: varchar("name", { length: 256 }).notNull(),
});

export const sessions = mysqlTable("session", {
	id: varchar("id", {
		length: 255,
	}).primaryKey(),
	userId: varchar("accountPk", {
		length: 255,
	})
		.notNull()
		.references(() => accounts.id),
	expiresAt: datetime("expires_at").notNull(),
});

export const tenants = mysqlTable("tenant", {
	pk: serial("id").primaryKey(),
	id: cuid("cuid").notNull().unique(),
	name: varchar("name", { length: 100 }).notNull(),
	slug: varchar("slug", { length: 256 }).notNull().unique(),
	billingEmail: varchar("billingEmail", { length: 256 }),
	stripeCustomerId: varchar("stripeCustomerId", { length: 256 }),
	enrollmentEnabled: boolean("enrollmentEnabled").notNull().default(true),
	ownerPk: serialRelation("ownerId")
		.references(() => accounts.pk)
		.notNull(),
});

export const tenantAccounts = mysqlTable(
	"tenant_account",
	{
		tenantPk: serialRelation("tenantId")
			.references(() => tenants.pk)
			.notNull(),
		accountPk: serialRelation("accountId")
			.references(() => accounts.pk)
			.notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.tenantPk, table.accountPk] }),
	}),
);

export const tenantAccountInvites = mysqlTable(
	"tenant_account_invites",
	{
		code: varchar("code", { length: 256 }).primaryKey(),
		tenantPk: serialRelation("tenantId")
			.references(() => tenants.pk)
			.notNull(),
		email: varchar("email", { length: 256 }).notNull(),
		createdAt: timestamp("createdAt").defaultNow(),
	},
	(table) => ({
		emailUnique: unique().on(table.tenantPk, table.email),
	}),
);

const userProviderVariants = [
	"entraId",
	// "gsuite"
] as const;

export type UserProviderVariant = (typeof userProviderVariants)[number];

// A link between a tenant and an external authentication provider.
export const identityProviders = mysqlTable(
	"identity_providers",
	{
		pk: serial("id").primaryKey(),
		id: cuid("cuid").notNull().unique(),
		name: varchar("name", { length: 256 }),
		variant: mysqlEnum("provider", userProviderVariants).notNull(),
		tenantPk: serialRelation("tenantId")
			.notNull()
			.unique()
			.references(() => tenants.pk),

		// The "linker" is an administrative user that provides Mattrax with the 'Policy.ReadWrite.MobilityManagement' scope.
		// If the user is deleted, changes password, or revokes the scope, we will need to re-authenticate with a new user.
		// This user is not mission-critical but it helps with UX.
		linkerUpn: varchar("linkerUpn", { length: 256 }),
		linkerRefreshToken: varchar("linkerRefreshToken", { length: 1024 }),

		// ID of the remote user provider
		remoteId: varchar("remoteId", { length: 256 }).notNull(),
		lastSynced: timestamp("lastSynced"),
	},
	(table) => ({
		unique: unique().on(table.variant, table.remoteId),
	}),
);

// An account represents the login of an *end-user*.
// These are scoped to a tenant and can't login to the Mattrax dashboard.
export const users = mysqlTable(
	"users",
	{
		pk: serial("id").primaryKey(),
		id: cuid("cuid").notNull().unique(),
		name: varchar("name", { length: 256 }).notNull(),
		email: varchar("email", { length: 256 }).notNull(),
		tenantPk: serialRelation("tenantId")
			.references(() => tenants.pk)
			.notNull(),
		providerPk: serialRelation("provider")
			.references(() => identityProviders.pk)
			.notNull(),
		// ID of the user in the remove provider
		providerResourceId: varchar("resourceId", { length: 256 }),
	},
	(t) => ({
		emailUnq: unique().on(t.email, t.tenantPk),
		resourceIdUnq: unique().on(t.providerResourceId, t.providerPk),
	}),
);

const policyDataCol = json("data")
	.notNull()
	.default({})
	.$type<Record<string, unknown>>();

export const policies = mysqlTable("policies", {
	pk: serial("id").primaryKey(),
	id: cuid("cuid").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	data: policyDataCol,
	tenantPk: serialRelation("tenantId")
		.references(() => tenants.pk)
		.notNull(),
	lastModified: timestamp("lastModified").notNull().defaultNow(),
	createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const PolicyAssignableVariants = {
	user: "user",
	device: "device",
	group: "group",
} as const;
export const policyAssignableVariants = [
	PolicyAssignableVariants.user,
	PolicyAssignableVariants.device,
	PolicyAssignableVariants.group,
] as const;
export type PolicyAssignableVariant = (typeof policyAssignableVariants)[number];

export const policyAssignables = mysqlTable(
	"policy_assignables",
	{
		policyPk: serialRelation("policyPk")
			.references(() => policies.pk)
			.notNull(),
		// The primary key of the user or device or group
		pk: serialRelation("groupableId").notNull(),
		variant: mysqlEnum("groupableVariant", policyAssignableVariants).notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.policyPk, table.pk, table.variant],
		}),
	}),
);

/// Each version is an immutable snapshot of the policy at a point in time when it was deployed.
/// Versions are tracked on a linear timeline so the timestamp can be used to determine the order.
export const policyVersions = mysqlTable("policy_versions", {
	pk: serial("id").primaryKey(),
	id: cuid("cuid")
		.notNull()
		.unique()
		.$default(() => createId()),
	policyPk: serialRelation("policyId")
		.references(() => policies.id) // This creates a circular reference so is let uncommented
		.notNull(),
	status: mysqlEnum("status", ["deploying", "deployed"])
		.notNull()
		.default("deploying"),
	data: policyDataCol,
	comment: varchar("comment", { length: 256 }).notNull(),
	createdBy: serialRelation("createdBy")
		.references(() => accounts.pk)
		.notNull(),
	createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const policyVersionDeploy = mysqlTable("policy_version_deploy", {
	pk: serial("id").primaryKey(),
	versionPk: serialRelation("versionId")
		.references(() => policyVersions.pk)
		.notNull(),
	deviceId: serialRelation("deviceId")
		.references(() => devices.pk)
		.notNull(),
	status: mysqlEnum("status", ["queued", "deployed", "success", "failed"])
		.notNull()
		.default("queued"),
	lastModified: timestamp("lastModified").notNull().defaultNow(),
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
	pk: serial("id").primaryKey(),
	id: cuid("cuid").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),

	enrollmentType: mysqlEnum("enrollmentType", ["user", "device"]).notNull(),
	os: mysqlEnum("os", possibleOSes).notNull(),

	// This must be a unique *hardware* identifier
	serialNumber: varchar("serialNumber", { length: 256 }).unique().notNull(),

	manufacturer: varchar("manufacturer", { length: 256 }),
	model: varchar("model", { length: 256 }),
	osVersion: varchar("osVersion", { length: 256 }),
	imei: varchar("imei", { length: 256 }),

	freeStorageSpaceInBytes: bigint("freeStorageSpaceInBytes", {
		mode: "number",
		unsigned: true,
	}),
	totalStorageSpaceInBytes: bigint("totalStorageSpaceInBytes", {
		mode: "number",
		unsigned: true,
	}),

	owner: serialRelation("owner").references(() => users.pk),

	azureADDeviceId: varchar("azureADDeviceId", { length: 256 }).unique(),

	enrolledAt: timestamp("enrolledAt").notNull().defaultNow(),
	lastSynced: timestamp("lastSynced").notNull().defaultNow(),

	tenantPk: serialRelation("tenantId")
		.references(() => tenants.pk)
		.notNull(),
});

export const possibleDeviceActions = [
	"restart",
	"shutdown",
	"lost",
	"wipe",
	// "retire",
] as const;

export const deviceActions = mysqlTable("device_actions", {
	id: serial("id").primaryKey(),
	action: mysqlEnum("action", possibleDeviceActions).notNull(),
	devicePk: serialRelation("deviceId")
		.notNull()
		.references(() => devices.pk),
	createdBy: serialRelation("createdBy")
		.notNull()
		.references(() => accounts.pk),
	createdAt: timestamp("createdAt").notNull().defaultNow(),
	// TODO: Possibly move into the audit log instead of keeping this?
	deployedAt: timestamp("deployedAt"),
});

// TODO: Remove this table
export const deviceWindowsData = mysqlTable("device_windows_data_temp", {
	id: serial("id").primaryKey(),
	key: varchar("key", { length: 256 }).notNull(),
	value: varchar("key", { length: 2048 }).notNull(),
	devicePk: serialRelation("deviceId").references(() => devices.pk),
	lastModified: timestamp("lastModified").notNull().defaultNow(),
});

// export const deviceSoftwareInventories = mysqlTable("device_software_inventory", {});

export const GroupAssignableVariants = {
	user: "user",
	device: "device",
} as const;

export const groupAssignableVariants = [
	GroupAssignableVariants.user,
	GroupAssignableVariants.device,
] as const;
export type GroupAssignableVariant = (typeof groupAssignableVariants)[number];

export const groupAssignables = mysqlTable(
	"group_assignables",
	{
		groupPk: serialRelation("groupId")
			.references(() => groups.pk)
			.notNull(),
		// The primary key of the user or device
		pk: serialRelation("groupableId").notNull(),
		variant: mysqlEnum("groupableVariant", groupAssignableVariants).notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.groupPk, table.pk, table.variant],
		}),
	}),
);

export const groups = mysqlTable("groups", {
	pk: serial("id").primaryKey(),
	id: cuid("cuid").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	tenantPk: serialRelation("tenantId")
		.references(() => tenants.pk)
		.notNull(),
});

export const applications = mysqlTable("apps", {
	pk: serial("id").primaryKey(),
	id: cuid("cuid").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),
	tenantPk: serialRelation("tenantId")
		.references(() => tenants.pk)
		.notNull(),
});

export const domains = mysqlTable("domains", {
	domain: varchar("domain", { length: 256 }).primaryKey(),
	tenantPk: serialRelation("tenantId")
		.references(() => tenants.pk)
		.notNull(),
	createdAt: timestamp("createdAt").notNull().defaultNow(),
	enterpriseEnrollmentAvailable: boolean("enterpriseEnrollmentAvailable")
		.notNull()
		.default(false),
	identityProviderPk: serialRelation("ownerUserProviderPk")
		.notNull()
		.references(() => identityProviders.pk),
});

export const domainToCertificateRelation = relations(domains, ({ one }) => ({
	certificate: one(certificates, {
		fields: [domains.domain],
		references: [certificates.key],
	}),
}));

// The backend for Rust's ACME.
// This will contain the certificate for the primary server domain and any user-provided via `domains`.
// The `key` will either be a comma separated list of domains (for a certificate) or comma separated list of email address (for an ACME account).
export const certificates = mysqlTable("certificates", {
	key: varchar("key", { length: 256 }).primaryKey(),
	certificate: varbinary("certificate", { length: 9068 }).notNull(),
	lastModified: timestamp("lastModified").notNull().defaultNow(),
});

export const accountLoginCodes = mysqlTable("account_login_codes", {
	code: varchar("code", { length: 8 }).notNull().primaryKey(),
	accountPk: serialRelation("accountPk")
		.references(() => accounts.pk)
		.notNull(),
	createdAt: timestamp("createdAt").notNull().defaultNow(),
});
