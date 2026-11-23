CREATE TABLE `application_install` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	`installer_id` varchar(255),
	`platform` varchar(16) NOT NULL,
	`bundle_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `application_install_device_application_unique` UNIQUE INDEX(`device_id`,`application_id`)
);
--> statement-breakpoint
CREATE TABLE `application_uninstall` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	`installer_id` varchar(255),
	`platform` varchar(16) NOT NULL,
	`bundle_id` varchar(255) NOT NULL,
	`adam_id` varchar(255),
	`command_id` varchar(255),
	`status` varchar(16) NOT NULL DEFAULT 'queued',
	`requested_at` datetime(3) NOT NULL,
	`deadline` datetime(3) NOT NULL,
	`observed_version` varchar(255),
	`result_detail` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `application_uninstall_device_application_unique` UNIQUE INDEX(`device_id`,`application_id`)
);
--> statement-breakpoint
ALTER TABLE `application` ADD `remove_on_unassign` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `application_installer` ADD `provisioning_expires_at` datetime(3);--> statement-breakpoint
CREATE INDEX `application_install_organization_idx` ON `application_install` (`organization_id`);--> statement-breakpoint
CREATE INDEX `application_install_application_idx` ON `application_install` (`application_id`);--> statement-breakpoint
CREATE INDEX `application_uninstall_organization_status_idx` ON `application_uninstall` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `application_uninstall_application_idx` ON `application_uninstall` (`application_id`);--> statement-breakpoint
ALTER TABLE `application_install` ADD CONSTRAINT `application_install_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_install` ADD CONSTRAINT `application_install_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_install` ADD CONSTRAINT `application_install_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_uninstall` ADD CONSTRAINT `application_uninstall_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_uninstall` ADD CONSTRAINT `application_uninstall_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `application_uninstall` ADD CONSTRAINT `application_uninstall_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE;