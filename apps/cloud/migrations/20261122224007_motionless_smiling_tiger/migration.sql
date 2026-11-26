CREATE TABLE `device_view` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`visibility` varchar(16) NOT NULL DEFAULT 'private',
	`query` json NOT NULL,
	`created_by_account_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `device_view_owner_name_unique` UNIQUE INDEX(`organization_id`,`created_by_account_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `device_view_default` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`view_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `device_view_default_member_unique` UNIQUE INDEX(`organization_id`,`account_id`)
);
--> statement-breakpoint
CREATE INDEX `device_view_organization_visibility_idx` ON `device_view` (`organization_id`,`visibility`);--> statement-breakpoint
CREATE INDEX `device_view_creator_idx` ON `device_view` (`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `device_view_default_view_idx` ON `device_view_default` (`view_id`);--> statement-breakpoint
CREATE INDEX `device_view_default_account_idx` ON `device_view_default` (`account_id`);--> statement-breakpoint
ALTER TABLE `device_view` ADD CONSTRAINT `device_view_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_view` ADD CONSTRAINT `device_view_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `device_view_default` ADD CONSTRAINT `device_view_default_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_view_default` ADD CONSTRAINT `device_view_default_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_view_default` ADD CONSTRAINT `device_view_default_view_id_device_view_id_fkey` FOREIGN KEY (`view_id`) REFERENCES `device_view`(`id`) ON DELETE CASCADE;