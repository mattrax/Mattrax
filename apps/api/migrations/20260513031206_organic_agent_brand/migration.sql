CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apple_push_certificate" (
	"organization_id" text PRIMARY KEY,
	"email" text NOT NULL,
	"topic" text NOT NULL,
	"cert_pem" text NOT NULL,
	"encrypted_key" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuration" (
	"kind" text,
	"policy_id" text,
	"data" jsonb NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "configuration_pkey" PRIMARY KEY("kind","policy_id")
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"proto" text NOT NULL,
	"status" text DEFAULT 'enrolling' NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"model_identifier" text,
	"serial" text,
	"enrolled_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"notes" text,
	"asset_tag" text,
	"physical_name" text,
	"vendor" text,
	"os_edition" text,
	"os_version" text,
	"os_build" text,
	"disk_total" text,
	"disk_used" text,
	"dm_identifier" text,
	"dm_cert_hash" text
);
--> statement-breakpoint
CREATE TABLE "device_apple" (
	"device_id" text PRIMARY KEY,
	"enrollment_id" text,
	"token" text,
	"push_magic" text,
	"topic" text,
	"unlock_token" text,
	"bootstrap_token" text,
	"configured" boolean DEFAULT false NOT NULL,
	"device_token" text,
	"token_updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "enterprise_enrollment" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"code" text,
	"enabled_apple" boolean DEFAULT true NOT NULL,
	"enabled_windows" boolean DEFAULT true NOT NULL,
	"enabled_android" boolean DEFAULT false NOT NULL,
	"enabled_asset_tag" boolean DEFAULT false NOT NULL,
	"max_devices" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enterprise_group" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_device" (
	"group_id" text,
	"device_id" text,
	CONSTRAINT "group_device_pkey" PRIMARY KEY("group_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "group_policy" (
	"group_id" text,
	"policy_id" text,
	CONSTRAINT "group_policy_pkey" PRIMARY KEY("group_id","policy_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"stripe_customer_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_device_usage" (
	"organization_id" text,
	"period" text,
	"billable_devices" integer NOT NULL,
	"stripe_subscription_item_id" text,
	"last_reported_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "organization_device_usage_pkey" PRIMARY KEY("organization_id","period")
);
--> statement-breakpoint
CREATE TABLE "policy" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scep_ca" (
	"id" serial PRIMARY KEY,
	"cert_pem" text NOT NULL,
	"private_key_jwk" jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" boolean,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"seats" integer,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"stripe_customer_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "device_organization_id_idx" ON "device" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_serial_unique" ON "device" ("serial");--> statement-breakpoint
CREATE INDEX "enterprise_group_organization_id_idx" ON "enterprise_group" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_user_organization_unique" ON "member" ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_unique" ON "organization" ("slug");--> statement-breakpoint
CREATE INDEX "policy_organization_id_idx" ON "policy" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_id_idx" ON "subscription" ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "apple_push_certificate" ADD CONSTRAINT "apple_push_certificate_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "configuration" ADD CONSTRAINT "configuration_policy_id_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_apple" ADD CONSTRAINT "device_apple_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "enterprise_enrollment" ADD CONSTRAINT "enterprise_enrollment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "enterprise_group" ADD CONSTRAINT "enterprise_group_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_device" ADD CONSTRAINT "group_device_group_id_enterprise_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "enterprise_group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_device" ADD CONSTRAINT "group_device_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_policy" ADD CONSTRAINT "group_policy_group_id_enterprise_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "enterprise_group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_policy" ADD CONSTRAINT "group_policy_policy_id_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_device_usage" ADD CONSTRAINT "organization_device_usage_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;