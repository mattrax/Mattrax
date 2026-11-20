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