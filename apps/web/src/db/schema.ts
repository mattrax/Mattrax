import type { PolicyData } from "@mattrax/policy";
import { createId } from "@paralleldrive/cuid2";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import {
	bigint,
	boolean,
	int,
	json,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	serial,
	smallint,
	text,
	timestamp,
	unique,
	varbinary,
	varchar,
} from "drizzle-orm/mysql-core";

import type { Features } from "~/lib/featureFlags";
import { auditLogDefinition } from "../api/auditLogDefinition";
import { getObjectKeys } from "../api/utils";

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

type KvKey = "config" | `server:${string}` | `cert:${string}`;

export const kv = mysqlTable("kv", {
	key: varchar("key", { length: 256 }).$type<KvKey>().primaryKey(),
	value: varbinary("value", { length: 9068 }).notNull(),
	lastModified: timestamp("last_modified").notNull().defaultNow().onUpdateNow(),
});

// An account represents the login of an *administrator*.
export const accounts = mysqlTable("accounts", {
	pk: serial("pk").primaryKey(),
	id: varchar("id", { length: 16 }).notNull().unique(),
	email: varchar("email", { length: 256 }).unique().notNull(),
	name: varchar("name", { length: 256 }).notNull(),
	features: json("features").$type<Features[]>(),
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
	userAgent: varchar("user_agent", { length: 256 }).notNull(),
	location: varchar("location", { length: 256 }).notNull(),
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

export const passkeyChallenges = mysqlTable("passkey_challenges", {
	challenge: varchar("challenge", { length: 256 }).primaryKey(),
});

export const passkeys = mysqlTable("passkeys", {
	accountPk: serialRelation("account")
		.references(() => accounts.pk)
		.notNull()
		.unique(),
	publicKey: text("public_key").notNull(),
	credentialId: varchar("credential_id", { length: 128 })
		.notNull()
		.primaryKey(),
	counter: int("counter").notNull(),
	transports: json("transports").$type<AuthenticatorTransportFuture[]>(),
});

// When authenticating with the CLI, this code will be used to authenticate.
export const cliAuthCodes = mysqlTable("cli_auth_codes", {
	code: cuid("code").notNull().primaryKey(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	sessionId: varchar("session", {
		length: 255,
	}).references(() => sessions.id),
});

// Organisations represent the physical entity that is using Mattrax.
// Eg. a company, school district, or MSP.
//
// An organisation is just a collect of many tenants, billing information and a set of accounts which have access to it.
//
export const organisations = mysqlTable("organisations", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 100 }).notNull(),
	slug: varchar("slug", { length: 256 }).notNull().unique(),
	billingEmail: varchar("billing_email", { length: 256 }),
	stripeCustomerId: varchar("stripe_customer_id", { length: 256 }),
	ownerPk: serialRelation("owner")
		.references(() => accounts.pk)
		.notNull(),
});

export const organisationMembers = mysqlTable(
	"organisation_members",
	{
		orgPk: serialRelation("org")
			.references(() => organisations.pk)
			.notNull(),
		accountPk: serialRelation("account")
			.references(() => accounts.pk)
			.notNull(),
	},
	(table) => ({ pk: primaryKey({ columns: [table.orgPk, table.accountPk] }) }),
);

export const organisationInvites = mysqlTable(
	"organisation_invites",
	{
		code: varchar("code", { length: 256 }).primaryKey(),
		orgPk: serialRelation("org")
			.references(() => organisations.pk)
			.notNull(),
		email: varchar("email", { length: 256 }).notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => ({
		emailUnique: unique().on(table.orgPk, table.email),
	}),
);

export const tenants = mysqlTable("tenant", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 100 }).notNull(),
	slug: varchar("slug", { length: 256 }).notNull().unique(),
	orgPk: serialRelation("org").references(() => organisations.pk),
});

const userProviderVariants = [
	"entraId",
	// "gsuite"
] as const;

export type UserProviderVariant = (typeof userProviderVariants)[number];

// A link between a tenant and an external authentication provider.
export const identityProviders = mysqlTable(
	"identity_providers",
	{
		pk: serial("pk").primaryKey(),
		id: cuid("id").notNull().unique(),
		name: varchar("name", { length: 256 }),
		provider: mysqlEnum("provider", userProviderVariants).notNull(),
		tenantPk: serialRelation("tenant")
			.notNull()
			.unique()
			.references(() => tenants.pk),

		// The "linker" is an administrative user that provides Mattrax with the 'Policy.ReadWrite.MobilityManagement' scope.
		// If the user is deleted, changes password, or revokes the scope, we will need to re-authenticate with a new user.
		// This user is not mission-critical but it helps with UX.
		linkerUpn: varchar("linker_upn", { length: 256 }),
		linkerRefreshToken: varchar("linker_refresh_token", { length: 1024 }),

		// ID of the remote user provider
		remoteId: varchar("remote_id", { length: 256 }).notNull(),
		lastSynced: timestamp("last_synced"),
	},
	(table) => ({
		unique: unique().on(table.provider, table.remoteId),
	}),
);

// An account represents the login of an *end-user*.
// These are scoped to a tenant and can't login to the Mattrax dashboard.
export const users = mysqlTable(
	"users",
	{
		pk: serial("pk").primaryKey(),
		id: cuid("id").notNull().unique(),
		name: varchar("name", { length: 256 }).notNull(),
		upn: varchar("upn", { length: 256 }).notNull(),
		tenantPk: serialRelation("tenant")
			.references(() => tenants.pk)
			.notNull(),
		providerPk: serialRelation("provider")
			.references(() => identityProviders.pk)
			.notNull(),
		// Identifier of the user in the remove provider's system
		resourceId: varchar("resource_id", { length: 256 }),
	},
	(t) => ({
		emailUnq: unique().on(t.upn, t.tenantPk),
		resourceIdUnq: unique().on(t.resourceId, t.providerPk),
	}),
);

const policyDataCol = json("data").notNull().default({}).$type<PolicyData>();

export const policies = mysqlTable("policies", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	priority: smallint("priority").notNull().default(128),
	name: varchar("name", { length: 256 }).notNull(),
	data: policyDataCol,
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
	lastModified: timestamp("last_modified").notNull().defaultNow(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
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

export const policyAssignments = mysqlTable(
	"policy_assignables",
	{
		policyPk: serialRelation("policy")
			.references(() => policies.pk)
			.notNull(),
		// The primary key of the user or device or group
		pk: serialRelation("pk").notNull(),
		variant: mysqlEnum("variant", policyAssignableVariants).notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.policyPk, table.pk, table.variant],
		}),
	}),
);

// A deployment is an immutable snapshot of the policy at a point in time when it was deployed.
// Deployments are linear by `createdAt` and are immutable.
export const policyDeploy = mysqlTable("policy_deploy", {
	pk: serial("pk").primaryKey(),
	id: cuid("id")
		.notNull()
		.unique()
		.$default(() => createId()),
	policyPk: serialRelation("policy")
		.references(() => policies.pk)
		.notNull(),
	data: policyDataCol,
	comment: varchar("comment", { length: 256 }).notNull(),
	author: serialRelation("author")
		.references(() => accounts.pk)
		.notNull(),
	doneAt: timestamp("done_at").notNull().defaultNow(),
});

// The status of applying a policy deploy to a specific device.
//
// Policy deploy status's are not immutable. A redeploy will cause it to update.
export const policyDeployStatus = mysqlTable(
	"policy_deploy_status",
	{
		deployPk: serialRelation("deploy")
			.references(() => policyDeploy.pk)
			.notNull(),
		devicePk: serialRelation("device")
			.references(() => devices.pk)
			.notNull(),
		status: mysqlEnum("variant", ["pending", "success", "failed"]).notNull(),
		conflicts: json("conflicts").$type<never>(), // TODO: Proper type using Specta
		doneAt: timestamp("done_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.deployPk, table.devicePk],
		}),
	}),
);

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
	mdm_id: cuid("mdm_id").notNull().unique(),
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

	owner: serialRelation("owner").references(() => users.pk),

	azureADDeviceId: varchar("azure_ad_did", { length: 256 }).unique(),

	enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
	// This will be set if enrolled by a Mattrax account. If null it was enrolled by a user themselves.
	enrolledBy: serialRelation("enrolled_by"),
	lastSynced: timestamp("last_synced").notNull().defaultNow(),

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

export const GroupMemberVariants = {
	user: "user",
	device: "device",
} as const;

export const groupMemberVariants = [
	GroupMemberVariants.user,
	GroupMemberVariants.device,
] as const;
export type GroupMemberVariant = (typeof groupMemberVariants)[number];

export const groupAssignables = mysqlTable(
	"group_assignables",
	{
		groupPk: serialRelation("group")
			.references(() => groups.pk)
			.notNull(),
		// The primary key of the user or device
		pk: serialRelation("pk").notNull(),
		variant: mysqlEnum("variant", groupMemberVariants).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.groupPk, table.pk, table.variant] }),
	}),
);

export const groups = mysqlTable("groups", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
});

export const applications = mysqlTable("apps", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
});

export const ApplicationAssignablesVariants = {
	user: "user",
	device: "device",
	group: "group",
} as const;

export const applicationAssignablesVariants = [
	ApplicationAssignablesVariants.user,
	ApplicationAssignablesVariants.device,
	ApplicationAssignablesVariants.group,
] as const;
export type ApplicationAssignableVariant =
	(typeof applicationAssignablesVariants)[number];

export const applicationAssignables = mysqlTable(
	"application_assignments",
	{
		applicationPk: serialRelation("appPk")
			.references(() => applications.pk)
			.notNull(),
		// The primary key of the user or device or group
		pk: serialRelation("pk").notNull(),
		variant: mysqlEnum("variant", applicationAssignablesVariants).notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.applicationPk, table.pk, table.variant],
		}),
	}),
);

export const domains = mysqlTable("domains", {
	domain: varchar("domain", { length: 256 }).primaryKey(),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	enterpriseEnrollmentAvailable: boolean("enterprise_enrollment_available")
		.notNull()
		.default(false),
	identityProviderPk: serialRelation("identity_provider")
		.notNull()
		.references(() => identityProviders.pk),
});

export const auditLog = mysqlTable("audit_log", {
	id: serial("id").primaryKey(),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
	action: mysqlEnum("action", getObjectKeys(auditLogDefinition)).notNull(),
	data: json("data").notNull(),
	// This value should be set to `NULL` if this action was performed by the system.
	accountPk: serialRelation("account").references(() => accounts.pk),
	doneAt: timestamp("created_at").notNull().defaultNow(),
});
