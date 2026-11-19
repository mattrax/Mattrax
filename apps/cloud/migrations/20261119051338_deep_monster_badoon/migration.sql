CREATE TABLE `user_group_application` (
	`organization_id` varchar(255) NOT NULL,
	`group_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`application_id`),
	CONSTRAINT `user_group_application_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `user_group_application_group_id_user_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE,
	CONSTRAINT `user_group_application_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `enterprise_group` ADD `directory_group_id` varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX `enterprise_group_directory_unique` ON `enterprise_group` (`organization_id`,`directory_group_id`);--> statement-breakpoint
CREATE INDEX `user_group_application_group_idx` ON `user_group_application` (`group_id`);--> statement-breakpoint
CREATE INDEX `user_group_application_application_idx` ON `user_group_application` (`application_id`);--> statement-breakpoint
CREATE INDEX `user_group_application_organization_idx` ON `user_group_application` (`organization_id`);--> statement-breakpoint
ALTER TABLE `enterprise_group` ADD CONSTRAINT `enterprise_group_directory_group_id_user_group_id_fkey` FOREIGN KEY (`directory_group_id`) REFERENCES `user_group`(`id`) ON DELETE SET NULL;