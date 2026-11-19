CREATE TABLE `login_attempt` (
	`id` varchar(255) PRIMARY KEY,
	`account_id` varchar(255),
	`email` varchar(320),
	`success` boolean NOT NULL,
	`method` varchar(16) NOT NULL,
	`factor` varchar(16),
	`failure_reason` varchar(40),
	`ip` varchar(64),
	`user_agent` varchar(512),
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `windows_failure` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255),
	`device_identifier` varchar(255),
	`serial` varchar(255),
	`hostname` varchar(255),
	`phase` varchar(16) NOT NULL,
	`code` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`detail` text,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `policy` ADD `enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `login_attempt_account_created_idx` ON `login_attempt` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempt_created_idx` ON `login_attempt` (`created_at`);--> statement-breakpoint
CREATE INDEX `windows_failure_organization_created_idx` ON `windows_failure` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `windows_failure_device_created_idx` ON `windows_failure` (`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `windows_failure_created_idx` ON `windows_failure` (`created_at`);--> statement-breakpoint
ALTER TABLE `login_attempt` ADD CONSTRAINT `login_attempt_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `windows_failure` ADD CONSTRAINT `windows_failure_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `windows_failure` ADD CONSTRAINT `windows_failure_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;