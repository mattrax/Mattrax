DO $$ BEGIN
 CREATE TYPE "application_assignment_variant" AS ENUM('user', 'device', 'group');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "audit_log_action" AS ENUM('addIdp', 'removeIdp', 'connectDomain', 'disconnectDomain', 'addDevice', 'deviceAction', 'removeDevice', 'addPolicy', 'deployPolicy', 'deletePolicy', 'addApp', 'editApp', 'removeApp', 'addGroup', 'editGroup', 'removeGroup');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "device_enrollment_type" AS ENUM('user', 'device');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "variant" AS ENUM('user', 'device');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "identity_provider" AS ENUM('entraId');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "policy_assignable_variant" AS ENUM('user', 'device', 'group');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "policy_deploy_status_variant" AS ENUM('success', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "possible_device_action" AS ENUM('restart', 'shutdown', 'lost', 'wipe', 'retire');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "device_os" AS ENUM('Windows', 'iOS', 'macOS', 'tvOS', 'Android', 'ChromeOS');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "waitlist_deployment" AS ENUM('managed-cloud', 'private-cloud', 'onprem', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "waitlist_interest" AS ENUM('personal', 'internal-it-team', 'msp-provider', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_login_codes" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"account" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(16) NOT NULL,
	"email" varchar(256) NOT NULL,
	"name" varchar(256) NOT NULL,
	"features" json,
	CONSTRAINT "accounts_id_unique" UNIQUE("id"),
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_assignments" (
	"appPk" integer NOT NULL,
	"pk" integer NOT NULL,
	"variant" "application_assignment_variant" NOT NULL,
	CONSTRAINT "application_assignments_appPk_pk_variant_pk" PRIMARY KEY("appPk","pk","variant")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apps" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" varchar(256),
	"tenant" integer NOT NULL,
	CONSTRAINT "apps_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant" integer NOT NULL,
	"action" "audit_log_action" NOT NULL,
	"data" json NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificates" (
	"key" varchar(256) PRIMARY KEY NOT NULL,
	"certificate" "bytea" NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cli_auth_codes" (
	"code" varchar(24) PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"session" varchar(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_actions" (
	"action" "possible_device_action" NOT NULL,
	"device" integer NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deployed_at" timestamp,
	CONSTRAINT "device_actions_action_device_pk" PRIMARY KEY("action","device")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "devices" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" varchar(256),
	"enrollment_type" "device_enrollment_type" NOT NULL,
	"os" "device_os" NOT NULL,
	"serial_number" varchar(256) NOT NULL,
	"manufacturer" varchar(256),
	"model" varchar(256),
	"os_version" varchar(256),
	"imei" varchar(256),
	"free_storage" bigint,
	"total_storage" bigint,
	"owner" integer,
	"azure_ad_did" varchar(256),
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"last_synced" timestamp DEFAULT now() NOT NULL,
	"tenant" integer NOT NULL,
	CONSTRAINT "devices_id_unique" UNIQUE("id"),
	CONSTRAINT "devices_serial_number_unique" UNIQUE("serial_number"),
	CONSTRAINT "devices_azure_ad_did_unique" UNIQUE("azure_ad_did")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domains" (
	"domain" varchar(256) PRIMARY KEY NOT NULL,
	"tenant" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"enterprise_enrollment_available" boolean DEFAULT false NOT NULL,
	"identity_provider" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_assignables" (
	"group" integer NOT NULL,
	"pk" integer NOT NULL,
	"variant" "variant" NOT NULL,
	CONSTRAINT "group_assignables_group_pk_variant_pk" PRIMARY KEY("group","pk","variant")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(256) NOT NULL,
	"tenant" integer NOT NULL,
	CONSTRAINT "groups_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity_providers" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(256),
	"provider" "identity_provider" NOT NULL,
	"tenant" integer NOT NULL,
	"linker_upn" varchar(256),
	"linker_refresh_token" varchar(1024),
	"remote_id" varchar(256) NOT NULL,
	"last_synced" timestamp,
	CONSTRAINT "identity_providers_id_unique" UNIQUE("id"),
	CONSTRAINT "identity_providers_tenant_unique" UNIQUE("tenant"),
	CONSTRAINT "identity_providers_provider_remote_id_unique" UNIQUE("provider","remote_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oranisation_account" (
	"org" integer NOT NULL,
	"account" integer NOT NULL,
	CONSTRAINT "oranisation_account_org_account_pk" PRIMARY KEY("org","account")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisation_invites" (
	"code" varchar(256) PRIMARY KEY NOT NULL,
	"org" integer NOT NULL,
	"email" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "organisation_invites_org_email_unique" UNIQUE("org","email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisation_members" (
	"org" integer NOT NULL,
	"account" integer NOT NULL,
	CONSTRAINT "organisation_members_org_account_pk" PRIMARY KEY("org","account")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisations" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"billing_email" varchar(256),
	"stripe_customer_id" varchar(256),
	"owner" integer NOT NULL,
	CONSTRAINT "organisations_id_unique" UNIQUE("id"),
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policies" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"priority" smallint DEFAULT 128 NOT NULL,
	"name" varchar(256) NOT NULL,
	"data" json DEFAULT '{}'::json NOT NULL,
	"tenant" integer NOT NULL,
	"last_modified" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policies_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_assignables" (
	"policy" integer NOT NULL,
	"pk" integer NOT NULL,
	"variant" "policy_assignable_variant" NOT NULL,
	CONSTRAINT "policy_assignables_policy_pk_variant_pk" PRIMARY KEY("policy","pk","variant")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_deploy" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"policy" integer NOT NULL,
	"data" json DEFAULT '{}'::json NOT NULL,
	"comment" varchar(256) NOT NULL,
	"author" integer NOT NULL,
	"done_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policy_deploy_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_deploy_status" (
	"deploy" integer NOT NULL,
	"device" integer NOT NULL,
	"key" varchar(256) NOT NULL,
	"variant" "policy_deploy_status_variant" NOT NULL,
	"data" json NOT NULL,
	"done_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "policy_deploy_status_deploy_key_pk" PRIMARY KEY("deploy","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"account" varchar(255) NOT NULL,
	"user_agent" varchar(256) NOT NULL,
	"location" varchar(256) NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"org" integer,
	CONSTRAINT "tenant_id_unique" UNIQUE("id"),
	CONSTRAINT "tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" varchar(24) NOT NULL,
	"name" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"tenant" integer NOT NULL,
	"provider" integer NOT NULL,
	"resource_id" varchar(256),
	CONSTRAINT "users_id_unique" UNIQUE("id"),
	CONSTRAINT "users_email_tenant_unique" UNIQUE("email","tenant"),
	CONSTRAINT "users_resource_id_provider_unique" UNIQUE("resource_id","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(256) NOT NULL,
	"name" varchar(256),
	"interest" "waitlist_interest" NOT NULL,
	"deployment" "waitlist_deployment" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "windows_ephemeral_state" (
	"session_id" varchar(256) NOT NULL,
	"msg_id" varchar(256) NOT NULL,
	"cmd_id" varchar(256) NOT NULL,
	"deploy" integer NOT NULL,
	"key" varchar(256) NOT NULL,
	CONSTRAINT "windows_ephemeral_state_session_id_msg_id_cmd_id_pk" PRIMARY KEY("session_id","msg_id","cmd_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_login_codes" ADD CONSTRAINT "account_login_codes_account_accounts_pk_fk" FOREIGN KEY ("account") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_assignments" ADD CONSTRAINT "application_assignments_appPk_apps_pk_fk" FOREIGN KEY ("appPk") REFERENCES "apps"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "apps" ADD CONSTRAINT "apps_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_pk_fk" FOREIGN KEY ("user_id") REFERENCES "users"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cli_auth_codes" ADD CONSTRAINT "cli_auth_codes_session_session_id_fk" FOREIGN KEY ("session") REFERENCES "session"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_actions" ADD CONSTRAINT "device_actions_device_devices_pk_fk" FOREIGN KEY ("device") REFERENCES "devices"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_actions" ADD CONSTRAINT "device_actions_created_by_accounts_pk_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_owner_users_pk_fk" FOREIGN KEY ("owner") REFERENCES "users"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "domains" ADD CONSTRAINT "domains_identity_provider_identity_providers_pk_fk" FOREIGN KEY ("identity_provider") REFERENCES "identity_providers"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_assignables" ADD CONSTRAINT "group_assignables_group_groups_pk_fk" FOREIGN KEY ("group") REFERENCES "groups"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oranisation_account" ADD CONSTRAINT "oranisation_account_org_organisations_pk_fk" FOREIGN KEY ("org") REFERENCES "organisations"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oranisation_account" ADD CONSTRAINT "oranisation_account_account_accounts_pk_fk" FOREIGN KEY ("account") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organisation_invites" ADD CONSTRAINT "organisation_invites_org_organisations_pk_fk" FOREIGN KEY ("org") REFERENCES "organisations"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_org_organisations_pk_fk" FOREIGN KEY ("org") REFERENCES "organisations"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_account_accounts_pk_fk" FOREIGN KEY ("account") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organisations" ADD CONSTRAINT "organisations_owner_accounts_pk_fk" FOREIGN KEY ("owner") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_assignables" ADD CONSTRAINT "policy_assignables_policy_policies_pk_fk" FOREIGN KEY ("policy") REFERENCES "policies"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_deploy" ADD CONSTRAINT "policy_deploy_policy_policies_pk_fk" FOREIGN KEY ("policy") REFERENCES "policies"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_deploy" ADD CONSTRAINT "policy_deploy_author_accounts_pk_fk" FOREIGN KEY ("author") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_deploy_status" ADD CONSTRAINT "policy_deploy_status_deploy_policy_deploy_pk_fk" FOREIGN KEY ("deploy") REFERENCES "policy_deploy"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_deploy_status" ADD CONSTRAINT "policy_deploy_status_device_devices_pk_fk" FOREIGN KEY ("device") REFERENCES "devices"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_account_accounts_id_fk" FOREIGN KEY ("account") REFERENCES "accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant" ADD CONSTRAINT "tenant_org_accounts_pk_fk" FOREIGN KEY ("org") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_tenant_pk_fk" FOREIGN KEY ("tenant") REFERENCES "tenant"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_provider_identity_providers_pk_fk" FOREIGN KEY ("provider") REFERENCES "identity_providers"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "windows_ephemeral_state" ADD CONSTRAINT "windows_ephemeral_state_deploy_policy_deploy_pk_fk" FOREIGN KEY ("deploy") REFERENCES "policy_deploy"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
