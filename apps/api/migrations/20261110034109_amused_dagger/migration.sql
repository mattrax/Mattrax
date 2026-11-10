CREATE TABLE `application` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`bundle_id` varchar(255),
	`version` varchar(255),
	`source` varchar(16) NOT NULL DEFAULT 'manifest',
	`manifest_url` text,
	`store_id` varchar(255),
	`file_name` varchar(255),
	`content_type` varchar(255),
	`size` int,
	`sha256` varchar(255),
	`r2_key` text,
	`notes` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `application_device` (
	`device_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`application_id`)
);
--> statement-breakpoint
CREATE TABLE `application_group` (
	`group_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`application_id`)
);
--> statement-breakpoint
CREATE TABLE `device_policy` (
	`device_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`policy_id`)
);
--> statement-breakpoint
CREATE INDEX `application_organization_id_idx` ON `application` (`organization_id`);--> statement-breakpoint
ALTER TABLE `application` ADD CONSTRAINT `application_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_device` ADD CONSTRAINT `application_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_device` ADD CONSTRAINT `application_device_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_group` ADD CONSTRAINT `application_group_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_group` ADD CONSTRAINT `application_group_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_policy` ADD CONSTRAINT `device_policy_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_policy` ADD CONSTRAINT `device_policy_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;