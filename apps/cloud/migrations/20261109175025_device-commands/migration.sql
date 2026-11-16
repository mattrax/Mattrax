CREATE TABLE `device_command` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`request_type` varchar(255) NOT NULL,
	`payload` json,
	`status` varchar(32) NOT NULL DEFAULT 'queued',
	`result_status` varchar(255),
	`result_detail` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `device_command_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`),
	CONSTRAINT `device_command_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`)
);
--> statement-breakpoint
CREATE INDEX `device_command_device_status_idx` ON `device_command` (`device_id`,`status`);--> statement-breakpoint
CREATE INDEX `device_command_organization_idx` ON `device_command` (`organization_id`,`created_at`);