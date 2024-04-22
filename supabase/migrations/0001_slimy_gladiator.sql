DO $$ BEGIN
 CREATE TYPE "policy_deploy_status_result" AS ENUM('success', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_users_pk_fk";
--> statement-breakpoint
ALTER TABLE "policy_deploy_status" DROP CONSTRAINT "policy_deploy_status_deploy_key_pk";--> statement-breakpoint
ALTER TABLE "policy_deploy_status" ALTER COLUMN "variant" SET DATA TYPE policy_deploy_status_result;--> statement-breakpoint
ALTER TABLE "policy_deploy_status" ADD CONSTRAINT "policy_deploy_status_deploy_device_pk" PRIMARY KEY("deploy","device");--> statement-breakpoint
ALTER TABLE "policy_deploy_status" ADD COLUMN "result" json NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_accounts_pk_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"("pk") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "policy_deploy_status" DROP COLUMN IF EXISTS "key";--> statement-breakpoint
ALTER TABLE "policy_deploy_status" DROP COLUMN IF EXISTS "data";