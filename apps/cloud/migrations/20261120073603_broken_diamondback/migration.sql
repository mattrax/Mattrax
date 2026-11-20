CREATE TABLE `dashboard_report` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`dashboard_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`frequency` varchar(16) NOT NULL,
	`hour_utc` int NOT NULL DEFAULT 7,
	`format` varchar(8) NOT NULL DEFAULT 'csv',
	`enabled` boolean NOT NULL DEFAULT true,
	`member_account_ids` json NOT NULL,
	`external_emails` json NOT NULL,
	`created_by_account_id` varchar(255),
	`last_period` varchar(32),
	`last_run_at` datetime(3),
	`next_run_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_report_run` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`report_id` varchar(255) NOT NULL,
	`report_name` varchar(255) NOT NULL,
	`format` varchar(8) NOT NULL,
	`period` varchar(40) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`recipients` json NOT NULL,
	`size_bytes` int NOT NULL DEFAULT 0,
	`last_error` text,
	`started_at` datetime(3),
	`completed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `dashboard_report_run_period_unique` UNIQUE INDEX(`report_id`,`period`)
);
--> statement-breakpoint
CREATE INDEX `dashboard_report_dashboard_idx` ON `dashboard_report` (`dashboard_id`);--> statement-breakpoint
CREATE INDEX `dashboard_report_organization_enabled_idx` ON `dashboard_report` (`organization_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `dashboard_report_run_report_created_idx` ON `dashboard_report_run` (`report_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dashboard_report_run_organization_created_idx` ON `dashboard_report_run` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dashboard_report_run_status_created_idx` ON `dashboard_report_run` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `dashboard_report` ADD CONSTRAINT `dashboard_report_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `dashboard_report` ADD CONSTRAINT `dashboard_report_dashboard_id_dashboard_id_fkey` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `dashboard_report` ADD CONSTRAINT `dashboard_report_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `dashboard_report_run` ADD CONSTRAINT `dashboard_report_run_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `dashboard_report_run` ADD CONSTRAINT `dashboard_report_run_report_id_dashboard_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `dashboard_report`(`id`) ON DELETE CASCADE;