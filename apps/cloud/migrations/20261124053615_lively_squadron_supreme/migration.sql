CREATE TABLE `restricted_software` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`match_type` varchar(24) NOT NULL,
	`match_value` varchar(255) NOT NULL,
	`match_key` varchar(255) NOT NULL,
	`action` varchar(20) NOT NULL,
	`message` text,
	`notification_emails` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_by_account_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `restricted_software_match_unique` UNIQUE INDEX(`organization_id`,`platform`,`match_key`)
);
--> statement-breakpoint
CREATE TABLE `restricted_software_assignment` (
	`restricted_software_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`target_id` varchar(255) NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'include',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`restricted_software_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `restricted_software_violation` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`restricted_software_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`action` varchar(20) NOT NULL,
	`match_type` varchar(255) NOT NULL,
	`match_key` varchar(255) NOT NULL,
	`matched_bundle_id` varchar(255) NOT NULL,
	`application_name` varchar(255),
	`application_version` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`enforcement_state` varchar(20) NOT NULL DEFAULT 'detection-only',
	`enforcement_detail` text,
	`occurrence_count` int NOT NULL DEFAULT 1,
	`first_detected_at` datetime(3) NOT NULL,
	`last_detected_at` datetime(3) NOT NULL,
	`last_enforced_at` datetime(3),
	`resolved_at` datetime(3),
	`notified_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `restricted_software_violation_rule_device_unique` UNIQUE INDEX(`restricted_software_id`,`device_id`)
);
--> statement-breakpoint
CREATE INDEX `restricted_software_organization_created_idx` ON `restricted_software` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `restricted_software_created_by_idx` ON `restricted_software` (`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `restricted_software_assignment_target_idx` ON `restricted_software_assignment` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `restricted_software_assignment_organization_idx` ON `restricted_software_assignment` (`organization_id`);--> statement-breakpoint
CREATE INDEX `restricted_software_violation_organization_status_idx` ON `restricted_software_violation` (`organization_id`,`status`,`last_detected_at`);--> statement-breakpoint
CREATE INDEX `restricted_software_violation_device_idx` ON `restricted_software_violation` (`device_id`,`last_detected_at`);--> statement-breakpoint
CREATE INDEX `restricted_software_violation_notified_idx` ON `restricted_software_violation` (`notified_at`);--> statement-breakpoint
ALTER TABLE `restricted_software` ADD CONSTRAINT `restricted_software_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restricted_software` ADD CONSTRAINT `restricted_software_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `restricted_software_assignment` ADD CONSTRAINT `restricted_software_assignment_W9Fi4B49nOWZ_fkey` FOREIGN KEY (`restricted_software_id`) REFERENCES `restricted_software`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restricted_software_assignment` ADD CONSTRAINT `restricted_software_assignment_hJJrgTCe7ieh_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restricted_software_violation` ADD CONSTRAINT `restricted_software_violation_bENdHOdUnZ9H_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restricted_software_violation` ADD CONSTRAINT `restricted_software_violation_THCC68VIBaiJ_fkey` FOREIGN KEY (`restricted_software_id`) REFERENCES `restricted_software`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `restricted_software_violation` ADD CONSTRAINT `restricted_software_violation_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;