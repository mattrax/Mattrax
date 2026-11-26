-- Consolidated new-schema migration: application storefronts, dashboard reports,
-- fleet migrations, OS policy, realtime events and Google Workspace sync.
CREATE TABLE `application_storefront` (
	`application_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`region` varchar(2) NOT NULL,
	`store_id` varchar(32),
	`available` boolean NOT NULL DEFAULT true,
	`name` varchar(255),
	`bundle_id` varchar(255),
	`version` varchar(255),
	`source` varchar(16) NOT NULL DEFAULT 'manual',
	`last_seen_at` datetime(3),
	`reason` text,
	`checked_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`application_id`,`region`)
);
--> statement-breakpoint
ALTER TABLE `application` ADD `availability` varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `application` ADD `availability_reason` text;--> statement-breakpoint
ALTER TABLE `application` ADD `last_seen_at` datetime(3);--> statement-breakpoint
ALTER TABLE `organization` ADD `app_store_region` varchar(2);--> statement-breakpoint
ALTER TABLE `organization` ADD `auto_unlink_unavailable_applications` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `application_storefront_organization_idx` ON `application_storefront` (`organization_id`);--> statement-breakpoint
ALTER TABLE `application_storefront` ADD CONSTRAINT `application_storefront_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_storefront` ADD CONSTRAINT `application_storefront_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `fleet_migration` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`source_mdm` varchar(16) NOT NULL,
	`platforms` json NOT NULL,
	`group_id` varchar(255),
	`stuck_after_days` int NOT NULL DEFAULT 7,
	`created_by_account_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fleet_migration_device` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`migration_id` varchar(255) NOT NULL,
	`serial` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`device_id` varchar(255),
	`execution_id` varchar(255),
	`unenrol_issued_at` datetime(3),
	`awaiting_enrolment_at` datetime(3),
	`enrolled_at` datetime(3),
	`confirmed_at` datetime(3),
	`stuck_at` datetime(3),
	`confirmed_by_account_id` varchar(255),
	`last_evidence` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `fleet_migration_device_migration_serial_unique` UNIQUE INDEX(`migration_id`,`serial`)
);
--> statement-breakpoint
CREATE INDEX `fleet_migration_organization_idx` ON `fleet_migration` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `fleet_migration_group_idx` ON `fleet_migration` (`group_id`);--> statement-breakpoint
CREATE INDEX `fleet_migration_created_by_idx` ON `fleet_migration` (`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `fleet_migration_device_organization_idx` ON `fleet_migration_device` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `fleet_migration_device_device_idx` ON `fleet_migration_device` (`device_id`);--> statement-breakpoint
CREATE INDEX `fleet_migration_device_confirmed_by_idx` ON `fleet_migration_device` (`confirmed_by_account_id`);--> statement-breakpoint
ALTER TABLE `fleet_migration` ADD CONSTRAINT `fleet_migration_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `fleet_migration` ADD CONSTRAINT `fleet_migration_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `fleet_migration` ADD CONSTRAINT `fleet_migration_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `fleet_migration_device` ADD CONSTRAINT `fleet_migration_device_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `fleet_migration_device` ADD CONSTRAINT `fleet_migration_device_migration_id_fleet_migration_id_fkey` FOREIGN KEY (`migration_id`) REFERENCES `fleet_migration`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `fleet_migration_device` ADD CONSTRAINT `fleet_migration_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `fleet_migration_device` ADD CONSTRAINT `fleet_migration_device_confirmed_by_account_id_account_id_fkey` FOREIGN KEY (`confirmed_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `tenant_os_policy` (
	`organization_id` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`minimum_version` varchar(64),
	`enforcement` varchar(16) NOT NULL DEFAULT 'off',
	`deferral_days` int NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`platform`),
	CONSTRAINT `tenant_os_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);

--> statement-breakpoint
CREATE TABLE `realtime_event` (
	`seq` bigint AUTO_INCREMENT PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`device_id` varchar(255),
	`protocol` varchar(16),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `realtime_event_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `realtime_event_organization_seq_idx` ON `realtime_event` (`organization_id`,`seq`);--> statement-breakpoint
CREATE INDEX `realtime_event_created_idx` ON `realtime_event` (`created_at`);
--> statement-breakpoint
CREATE TABLE `google_directory_sync` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`admin_email` varchar(255),
	`customer` varchar(255),
	`service_account_email` varchar(255),
	`sealed_service_account` text,
	`last_synced_at` datetime(3),
	`last_attempted_at` datetime(3),
	`last_error` text,
	`last_counts` json,
	`status` varchar(32) NOT NULL DEFAULT 'idle',
	`sync_interval_minutes` int NOT NULL DEFAULT 0,
	`next_sync_at` datetime(3),
	`last_run_trigger` varchar(16),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `google_directory_sync_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
