CREATE TABLE `device_apple_user` (
	`device_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`token` text,
	`push_magic` varchar(255),
	`topic` varchar(255),
	`unlock_token` text,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `device_declaration` (
	`device_id` varchar(255) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`declaration_type` varchar(255) NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`valid` varchar(255) NOT NULL,
	`server_token` text,
	`reasons` json,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`identifier`)
);
--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD CONSTRAINT `device_apple_user_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_declaration` ADD CONSTRAINT `device_declaration_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;