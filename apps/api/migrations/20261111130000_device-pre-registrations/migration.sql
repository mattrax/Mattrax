CREATE TABLE `device_pre_registration` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`serial` varchar(255) NOT NULL,
	`name` varchar(255),
	`asset_tag` varchar(255),
	`notes` text,
	`group_id` varchar(255),
	`consumed_device_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `device_pre_registration_organization_serial_unique` UNIQUE INDEX(`organization_id`,`serial`)
);
--> statement-breakpoint
ALTER TABLE `device_pre_registration` ADD CONSTRAINT `device_pre_registration_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `device_pre_registration` ADD CONSTRAINT `device_pre_registration_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `device_pre_registration` ADD CONSTRAINT `device_pre_registration_consumed_device_id_device_id_fkey` FOREIGN KEY (`consumed_device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `device_pre_registration_organization_idx` ON `device_pre_registration` (`organization_id`,`created_at`);
