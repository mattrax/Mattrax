ALTER TABLE `policy_deploy_status` ADD `conflicts` json;--> statement-breakpoint
ALTER TABLE `policy_deploy_status` DROP COLUMN `result`;