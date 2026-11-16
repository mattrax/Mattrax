CREATE TABLE `autopilot_device` (
	`organization_id` varchar(255) NOT NULL,
	`serial` varchar(255) NOT NULL,
	`hardware_hash` text,
	`graph_id` varchar(255),
	`azure_ad_device_id` varchar(255),
	`group_tag` varchar(255),
	`model` varchar(255),
	`manufacturer` varchar(255),
	`profile_status` varchar(16) NOT NULL DEFAULT 'unknown',
	`enrollment_state` varchar(16) NOT NULL DEFAULT 'unknown',
	`profile_id` varchar(255),
	`device_id` varchar(255),
	`last_synced_at` datetime(3),
	`raw` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`serial`)
);
--> statement-breakpoint
CREATE TABLE `autopilot_profile` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`deployment_mode` varchar(24) NOT NULL DEFAULT 'userDriven',
	`join_type` varchar(32) NOT NULL DEFAULT 'azureADJoin',
	`device_name_template` varchar(255),
	`locale` varchar(255),
	`timezone` varchar(255),
	`enable_device_preparation` boolean NOT NULL DEFAULT false,
	`assigned_group_id` varchar(255),
	`graph_profile_id` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `autopilot_profile_graph_unique` UNIQUE INDEX(`organization_id`,`graph_profile_id`)
);
--> statement-breakpoint
CREATE INDEX `autopilot_device_organization_idx` ON `autopilot_device` (`organization_id`);--> statement-breakpoint
CREATE INDEX `autopilot_device_device_idx` ON `autopilot_device` (`device_id`);--> statement-breakpoint
CREATE INDEX `autopilot_device_graph_idx` ON `autopilot_device` (`organization_id`,`graph_id`);--> statement-breakpoint
CREATE INDEX `autopilot_device_azure_ad_idx` ON `autopilot_device` (`organization_id`,`azure_ad_device_id`);--> statement-breakpoint
CREATE INDEX `autopilot_profile_organization_idx` ON `autopilot_profile` (`organization_id`);--> statement-breakpoint
ALTER TABLE `autopilot_device` ADD CONSTRAINT `autopilot_device_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `autopilot_device` ADD CONSTRAINT `autopilot_device_profile_id_autopilot_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `autopilot_profile`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `autopilot_device` ADD CONSTRAINT `autopilot_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `autopilot_profile` ADD CONSTRAINT `autopilot_profile_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;