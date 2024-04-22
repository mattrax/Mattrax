import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
	bigint,
	boolean,
	json,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	timestamp,
	smallint,
	unique,
	customType,
	integer,
	varchar,
} from "drizzle-orm/pg-core";
import { auditLogDefinition } from "../api/auditLogDefinition";
import { getObjectKeys } from "../api/utils";
import type { Configuration } from "~/lib/policy";
import type { Features } from "~/lib/featureFlags";

// TS table name - plural, camelCase
// SQL table name - singular, snake_case
// TS column name - camelCase
// SQL column name - snake_case, if this is a relation don't append `_id` or `_pk` suffix

// TODO: Planetscale reports all `id` columns containing an unnecessary index. We probs need Drizzle to fix that.

const blob = customType<{ data: Array<number> }>({
	dataType() {
		return "bytea";
	},
});

const serialRelation = (name: string) => integer(name);

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

export const waitlistInterestEnum = pgEnum(
	"waitlist_interest",
	waitlistInterestReasons,
);
export const waitlistDeploymentEnum = pgEnum(
	"waitlist_deployment",
	waitlistDeploymentMethod,
);

// Waitlist is a table of people who have signed up to be notified when Mattrax is available.
// This is exposed as an API that is called by `apps/landing`
export const waitlist = pgTable("waitlist", {
	id: serial("id").primaryKey(),
	email: varchar("email", { length: 256 }).notNull().unique(),
	name: varchar("name", { length: 256 }),
	interest: waitlistInterestEnum("interest").notNull(),
	deployment: waitlistDeploymentEnum("deployment").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// An account represents the login of an *administrator*.
export const accounts = pgTable("accounts", {
	pk: serial("pk").primaryKey(),
	id: varchar("id", { length: 16 }).notNull().unique(),
	email: varchar("email", { length: 256 }).unique().notNull(),
	name: varchar("name", { length: 256 }).notNull(),
	features: json("features").$type<Features[]>(),
});

// Each session represents an authenticated context with a Mattrax account.
// This could represent a browser or a CLI session.
export const sessions = pgTable("session", {
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
export const accountLoginCodes = pgTable("account_login_codes", {
	code: varchar("code", { length: 8 }).notNull().primaryKey(),
	accountPk: serialRelation("account")
		.references(() => accounts.pk)
		.notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// When authenticating with the CLI, this code will be used to authenticate.
export const cliAuthCodes = pgTable("cli_auth_codes", {
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
export const organisations = pgTable("organisations", {
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

export const organisationMembers = pgTable(
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

export const organisationInvites = pgTable(
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

export const tenants = pgTable("tenant", {
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

export const identityProviderEnum = pgEnum(
	"identity_provider",
	userProviderVariants,
);

// A link between a tenant and an external authentication provider.
export const identityProviders = pgTable(
	"identity_providers",
	{
		pk: serial("pk").primaryKey(),
		id: cuid("id").notNull().unique(),
		name: varchar("name", { length: 256 }),
		provider: identityProviderEnum("provider").notNull(),
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
export const users = pgTable(
	"users",
	{
		pk: serial("pk").primaryKey(),
		id: cuid("id").notNull().unique(),
		name: varchar("name", { length: 256 }).notNull(),
		email: varchar("email", { length: 256 }).notNull(),
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
		emailUnq: unique().on(t.email, t.tenantPk),
		resourceIdUnq: unique().on(t.resourceId, t.providerPk),
	}),
);

const policyDataCol = json("data")
	.notNull()
	.default({})
	.$type<Record<string, Configuration>>();

export const policies = pgTable("policies", {
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
export const policyAssignableVariantEnum = pgEnum(
	"policy_assignable_variant",
	policyAssignableVariants,
);

export const policyAssignments = pgTable(
	"policy_assignables",
	{
		policyPk: serialRelation("policy")
			.references(() => policies.pk)
			.notNull(),
		// The primary key of the user or device or group
		pk: serialRelation("pk").notNull(),
		variant: policyAssignableVariantEnum("variant").notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.policyPk, table.pk, table.variant],
		}),
	}),
);

// A deployment is an immutable snapshot of the policy at a point in time when it was deployed.
// Deployments are linear by `createdAt` and are immutable.
export const policyDeploy = pgTable("policy_deploy", {
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

export const policyDeployStatusResultEnum = pgEnum(
	"policy_deploy_status_result",
	["success", "failed"],
);

// The status of applying a policy deploy to a specific device.
//
// Policy deploy status's are not immutable. A redeploy will cause it to update.
export const policyDeployStatus = pgTable(
	"policy_deploy_status",
	{
		deployPk: serialRelation("deploy")
			.references(() => policyDeploy.pk)
			.notNull(),
		devicePk: serialRelation("device")
			.references(() => devices.pk)
			.notNull(),
		status: policyDeployStatusResultEnum("variant").notNull(),
		// The result of applying the policy, including errors and conflicts, etc.
		result: json("result").notNull().$type<never>(), // TODO: Proper type using Specta
		doneAt: timestamp("done_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.deployPk, table.devicePk],
		}),
	}),
);

// A cache for storing the state of Windows management commands.
export const windowsEphemeralState = pgTable(
	"windows_ephemeral_state",
	{
		// TODO: Datatypes
		sessionId: varchar("session_id", { length: 256 }).notNull(),
		msgId: varchar("msg_id", { length: 256 }).notNull(),
		cmdId: varchar("cmd_id", { length: 256 }).notNull(),
		deployPk: serialRelation("deploy")
			.references(() => policyDeploy.pk)
			.notNull(),
		key: varchar("key", { length: 256 }).notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.sessionId, table.msgId, table.cmdId],
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

export const possibleOSesEnum = pgEnum("device_os", possibleOSes);
export const deviceEnrollmentTypeEnum = pgEnum("device_enrollment_type", [
	"user",
	"device",
]);

export const devices = pgTable("devices", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),

	enrollmentType: deviceEnrollmentTypeEnum("enrollment_type").notNull(),
	os: possibleOSesEnum("os").notNull(),

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

export const possibleDeviceActionsEnum = pgEnum(
	"possible_device_action",
	possibleDeviceActions,
);

export const deviceActions = pgTable(
	"device_actions",
	{
		action: possibleDeviceActionsEnum("action").notNull(),
		devicePk: serialRelation("device")
			.notNull()
			.references(() => devices.pk),
		createdBy: serialRelation("created_by")
			.notNull()
			.references(() => accounts.pk),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		// TODO: Possibly move into the audit log instead of keeping this???
		deployedAt: timestamp("deployed_at"),
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
export const groupMemberVariantEnum = pgEnum("variant", groupMemberVariants);

export const groupMembers = pgTable(
	"group_assignables",
	{
		groupPk: serialRelation("group")
			.references(() => groups.pk)
			.notNull(),
		// The primary key of the user or device
		pk: serialRelation("pk").notNull(),
		variant: groupMemberVariantEnum("variant").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.groupPk, table.pk, table.variant] }),
	}),
);

export const groups = pgTable("groups", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
});

export const applications = pgTable("apps", {
	pk: serial("pk").primaryKey(),
	id: cuid("id").notNull().unique(),
	name: varchar("name", { length: 256 }).notNull(),
	description: varchar("description", { length: 256 }),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
});

export const ApplicationAssignableVariants = {
	user: "user",
	device: "device",
	group: "group",
} as const;

export const applicationAssignableVariants = [
	ApplicationAssignableVariants.user,
	ApplicationAssignableVariants.device,
	ApplicationAssignableVariants.group,
] as const;
export type ApplicationAssignableVariant =
	(typeof applicationAssignableVariants)[number];

export const applicationAssignableVariantEnum = pgEnum(
	"application_assignment_variant",
	applicationAssignableVariants,
);

export const applicationAssignments = pgTable(
	"application_assignments",
	{
		applicationPk: serialRelation("appPk")
			.references(() => applications.pk)
			.notNull(),
		// The primary key of the user or device or group
		pk: serialRelation("pk").notNull(),
		variant: applicationAssignableVariantEnum("variant").notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.applicationPk, table.pk, table.variant],
		}),
	}),
);

export const domains = pgTable("domains", {
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

export const domainToCertificateRelation = relations(domains, ({ one }) => ({
	certificate: one(certificates, {
		fields: [domains.domain],
		references: [certificates.key],
	}),
}));

// The backend for Rust's ACME.
// This will contain the certificate for the primary server domain and any user-provided via `domains`.
// The `key` will either be a comma separated list of domains (for a certificate) or comma separated list of email address (for an ACME account).
export const certificates = pgTable("certificates", {
	key: varchar("key", { length: 256 }).primaryKey(),
	certificate: blob("certificate", { length: 9068 }).notNull(),
	lastModified: timestamp("last_modified").notNull().defaultNow(),
});

export const auditLogActionEnum = pgEnum(
	"audit_log_action",
	getObjectKeys(auditLogDefinition),
);

export const auditLog = pgTable("audit_log", {
	id: serial("id").primaryKey(),
	tenantPk: serialRelation("tenant")
		.references(() => tenants.pk)
		.notNull(),
	action: auditLogActionEnum("action").notNull(),
	data: json("data").notNull(),
	// This value should be set to `NULL` if this action was performed by the system.
	accountPk: serialRelation("user_id").references(() => accounts.pk),
	doneAt: timestamp("created_at").notNull().defaultNow(),
});

// TODO: Remove this
export const organisationAccountsOld = pgTable(
	"oranisation_account",
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
