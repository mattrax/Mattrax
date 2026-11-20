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