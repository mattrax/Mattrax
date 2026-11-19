ALTER TABLE `audit_log` ADD `actor_type` varchar(16) DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `category` varchar(16) DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_log` ADD `ip` varchar(64);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `user_agent` varchar(512);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `device_id` varchar(255);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `device_certificate_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `device_certificate_serial` varchar(128);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `protocol` varchar(16);--> statement-breakpoint
CREATE INDEX `audit_log_device_organization_created_idx` ON `audit_log` (`device_id`,`organization_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;--> statement-breakpoint
-- Existing rows predate `actor_type`; an event with no account is system
-- activity. Device/MDM protocol rows are the `device.*`/`mdm.*` actions;
-- everything else with no account is background deployment work.
UPDATE `audit_log` SET `actor_type` = 'system', `category` = CASE WHEN `action` LIKE 'device.%' OR `action` LIKE 'mdm.%' OR `action` LIKE 'enrollment.%' THEN 'mdm' ELSE 'system' END WHERE `actor_account_id` IS NULL;
