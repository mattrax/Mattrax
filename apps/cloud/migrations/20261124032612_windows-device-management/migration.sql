CREATE TABLE `device_bitlocker_key` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`volume_type` varchar(32) NOT NULL,
	`volume_id` varchar(255) NOT NULL,
	`key_id` varchar(255) NOT NULL,
	`key_type` varchar(32) NOT NULL,
	`protector_type` varchar(255) NOT NULL,
	`sealed_value` text,
	`source` varchar(16) NOT NULL DEFAULT 'entra-id',
	`captured_at` datetime(3) NOT NULL,
	`rotated_at` datetime(3),
	`reported_at` datetime(3) NOT NULL,
	`retired_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `device_bitlocker_key_device_key_unique` UNIQUE INDEX(`device_id`,`key_id`)
);
--> statement-breakpoint
CREATE TABLE `device_diagnostics_archive` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`requested_by_account_id` varchar(255) NOT NULL,
	`requested_by_email` varchar(320) NOT NULL,
	`collection_id` varchar(255) NOT NULL,
	`command_id` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`r2_key` text,
	`size_bytes` bigint,
	`sha256` varchar(255),
	`content_type` varchar(64),
	`error` text,
	`requested_at` datetime(3) NOT NULL,
	`uploaded_at` datetime(3),
	`expires_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device_windows_laps` (
	`device_id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`account_name` varchar(255),
	`account_sid` varchar(255),
	`backup_at` datetime(3),
	`refresh_at` datetime(3),
	`retrieved_at` datetime(3),
	`source` varchar(32) NOT NULL DEFAULT 'unknown',
	`reset_requested_at` datetime(3),
	`reset_status` varchar(255),
	`last_error` text,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `device` ADD `bitlocker_keys_synced_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device` ADD `bitlocker_keys_sync_error` text;--> statement-breakpoint
CREATE INDEX `device_bitlocker_key_organization_idx` ON `device_bitlocker_key` (`organization_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `device_bitlocker_key_device_volume_idx` ON `device_bitlocker_key` (`device_id`,`volume_id`);--> statement-breakpoint
CREATE INDEX `device_diagnostics_archive_device_requested_idx` ON `device_diagnostics_archive` (`device_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `device_diagnostics_archive_organization_requested_idx` ON `device_diagnostics_archive` (`organization_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `device_diagnostics_archive_expires_idx` ON `device_diagnostics_archive` (`expires_at`);--> statement-breakpoint
CREATE INDEX `device_windows_laps_organization_idx` ON `device_windows_laps` (`organization_id`);--> statement-breakpoint
ALTER TABLE `device_bitlocker_key` ADD CONSTRAINT `device_bitlocker_key_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_bitlocker_key` ADD CONSTRAINT `device_bitlocker_key_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_diagnostics_archive` ADD CONSTRAINT `device_diagnostics_archive_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_diagnostics_archive` ADD CONSTRAINT `device_diagnostics_archive_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_windows_laps` ADD CONSTRAINT `device_windows_laps_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_windows_laps` ADD CONSTRAINT `device_windows_laps_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;