CREATE TABLE `abm_device` (
	`organization_id` varchar(255) NOT NULL,
	`serial` varchar(255) NOT NULL,
	`abm_device_id` varchar(255),
	`model` varchar(255),
	`device_family` varchar(255),
	`os` varchar(255),
	`profile_status` varchar(16) NOT NULL DEFAULT 'unknown',
	`assigned_profile_uuid` varchar(255),
	`enrollment_state` varchar(16) NOT NULL DEFAULT 'UNASSIGNED',
	`assigned_server_id` varchar(255),
	`device_id` varchar(255),
	`last_seen_at` datetime(3),
	`raw` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`serial`)
);
--> statement-breakpoint
CREATE TABLE `apple_business_manager` (
	`organization_id` varchar(255) PRIMARY KEY,
	`credential_type` varchar(16) NOT NULL DEFAULT 'abm_api',
	`encrypted_token` text NOT NULL,
	`token_expiry` datetime(3),
	`apple_org_id` varchar(255),
	`apple_org_name` varchar(255),
	`mdm_server_id` varchar(255),
	`profile_uuid` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'unconfigured',
	`last_synced_at` datetime(3),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `apple_business_manager_organization_unique` UNIQUE INDEX(`organization_id`)
);
--> statement-breakpoint
CREATE TABLE `device_vpp_assignment` (
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`adam_id` varchar(32) NOT NULL,
	`serial` varchar(255) NOT NULL,
	`pricing_param` varchar(255),
	`state` varchar(16) NOT NULL DEFAULT 'assigned',
	`event_id` varchar(255),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`device_id`,`adam_id`)
);
--> statement-breakpoint
CREATE TABLE `vpp_asset` (
	`organization_id` varchar(255) NOT NULL,
	`adam_id` varchar(32) NOT NULL,
	`name` varchar(255) NOT NULL,
	`bundle_id` varchar(255),
	`total_licenses` int NOT NULL DEFAULT 0,
	`available_licenses` int NOT NULL DEFAULT 0,
	`assigned_licenses` int NOT NULL DEFAULT 0,
	`retired_licenses` int NOT NULL DEFAULT 0,
	`pricing_param` varchar(255),
	`device_assignable` boolean NOT NULL DEFAULT false,
	`revocable` boolean NOT NULL DEFAULT false,
	`product_type` varchar(255),
	`supported_platforms` json,
	`last_synced_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`adam_id`)
);
--> statement-breakpoint
CREATE TABLE `vpp_token` (
	`organization_id` varchar(255) PRIMARY KEY,
	`encrypted_token` text NOT NULL,
	`token_expiry` datetime(3),
	`apple_org_id` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'unconfigured',
	`last_synced_at` datetime(3),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `vpp_token_organization_unique` UNIQUE INDEX(`organization_id`)
);
--> statement-breakpoint
CREATE INDEX `abm_device_organization_idx` ON `abm_device` (`organization_id`);--> statement-breakpoint
CREATE INDEX `abm_device_device_idx` ON `abm_device` (`device_id`);--> statement-breakpoint
CREATE INDEX `device_vpp_assignment_organization_idx` ON `device_vpp_assignment` (`organization_id`);--> statement-breakpoint
CREATE INDEX `device_vpp_assignment_asset_idx` ON `device_vpp_assignment` (`organization_id`,`adam_id`);--> statement-breakpoint
CREATE INDEX `vpp_asset_organization_idx` ON `vpp_asset` (`organization_id`);--> statement-breakpoint
ALTER TABLE `abm_device` ADD CONSTRAINT `abm_device_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `abm_device` ADD CONSTRAINT `abm_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `apple_business_manager` ADD CONSTRAINT `apple_business_manager_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_vpp_assignment` ADD CONSTRAINT `device_vpp_assignment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_vpp_assignment` ADD CONSTRAINT `device_vpp_assignment_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `vpp_asset` ADD CONSTRAINT `vpp_asset_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `vpp_token` ADD CONSTRAINT `vpp_token_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;