CREATE TABLE `device_user_declaration` (
	`device_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`declaration_type` varchar(255) NOT NULL,
	`active` boolean NOT NULL DEFAULT false,
	`valid` varchar(255) NOT NULL,
	`server_token` text,
	`reasons` json,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`user_id`,`identifier`),
	CONSTRAINT `device_user_declaration_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `configuration` ADD `scope` varchar(16) DEFAULT 'device' NOT NULL;--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `directory_user_id` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `identity_source` varchar(32);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `identity_upn` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `identity_verified_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `ddm_declarations_token` text;--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD CONSTRAINT `device_apple_user_directory_user_id_user_id_fkey` FOREIGN KEY (`directory_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;