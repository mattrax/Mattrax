CREATE TABLE `device_user` (
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'manual',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_group_policy` (
	`organization_id` varchar(255) NOT NULL,
	`group_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'include',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`policy_id`)
);
--> statement-breakpoint
CREATE TABLE `user_policy` (
	`organization_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'include',
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`user_id`,`policy_id`)
);
--> statement-breakpoint
CREATE INDEX `device_user_device_idx` ON `device_user` (`device_id`);--> statement-breakpoint
CREATE INDEX `device_user_user_idx` ON `device_user` (`user_id`);--> statement-breakpoint
CREATE INDEX `device_user_organization_idx` ON `device_user` (`organization_id`);--> statement-breakpoint
CREATE INDEX `user_group_policy_group_idx` ON `user_group_policy` (`group_id`);--> statement-breakpoint
CREATE INDEX `user_group_policy_policy_idx` ON `user_group_policy` (`policy_id`);--> statement-breakpoint
CREATE INDEX `user_group_policy_organization_idx` ON `user_group_policy` (`organization_id`);--> statement-breakpoint
CREATE INDEX `user_policy_user_idx` ON `user_policy` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_policy_policy_idx` ON `user_policy` (`policy_id`);--> statement-breakpoint
CREATE INDEX `user_policy_organization_idx` ON `user_policy` (`organization_id`);--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_policy` ADD CONSTRAINT `user_group_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_policy` ADD CONSTRAINT `user_group_policy_group_id_user_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_policy` ADD CONSTRAINT `user_group_policy_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;