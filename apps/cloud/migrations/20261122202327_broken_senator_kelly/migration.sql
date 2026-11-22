ALTER TABLE `organization` ADD `billing_plan` varchar(255);--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_status` varchar(32);--> statement-breakpoint
UPDATE `organization` INNER JOIN `subscription` ON `subscription`.`reference_id` = `organization`.`id` SET `organization`.`billing_plan` = `subscription`.`plan`, `organization`.`billing_status` = `subscription`.`status`;--> statement-breakpoint
DROP TABLE `deployment_license`;--> statement-breakpoint
DROP TABLE `stripe_event`;--> statement-breakpoint
DROP TABLE `subscription`;--> statement-breakpoint
ALTER TABLE `organization` DROP COLUMN `stripe_customer_id`;--> statement-breakpoint
ALTER TABLE `account` DROP COLUMN `stripe_customer_id`;
