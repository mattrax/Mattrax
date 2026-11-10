CREATE TABLE `device_application` (
	`device_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`bundle_id` varchar(255) NOT NULL,
	`name` varchar(255),
	`version` varchar(255),
	`short_version` varchar(255),
	`bundle_size` bigint,
	`dynamic_size` bigint,
	`has_update_available` boolean NOT NULL DEFAULT false,
	`is_managed` boolean NOT NULL DEFAULT false,
	`last_reported_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`bundle_id`)
);
--> statement-breakpoint
CREATE TABLE `device_secret` (
	`device_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`sealed_value` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`rotated_at` datetime(3),
	CONSTRAINT PRIMARY KEY(`device_id`,`kind`)
);
--> statement-breakpoint
ALTER TABLE `device` ADD `applications_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `bootstrap_token_escrowed` boolean;--> statement-breakpoint
CREATE INDEX `device_application_organization_idx` ON `device_application` (`organization_id`);--> statement-breakpoint
CREATE INDEX `device_application_bundle_idx` ON `device_application` (`organization_id`,`bundle_id`);--> statement-breakpoint
CREATE INDEX `device_secret_organization_idx` ON `device_secret` (`organization_id`);--> statement-breakpoint
ALTER TABLE `device_application` ADD CONSTRAINT `device_application_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_application` ADD CONSTRAINT `device_application_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_secret` ADD CONSTRAINT `device_secret_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_secret` ADD CONSTRAINT `device_secret_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;