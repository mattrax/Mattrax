CREATE TABLE `scim_token` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`last_used_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `scim_token_hash_unique` UNIQUE INDEX(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `user_group` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_group_member` (
	`group_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`user_id`)
);
--> statement-breakpoint
CREATE INDEX `scim_token_organization_idx` ON `scim_token` (`organization_id`);--> statement-breakpoint
CREATE INDEX `user_group_organization_idx` ON `user_group` (`organization_id`);--> statement-breakpoint
ALTER TABLE `scim_token` ADD CONSTRAINT `scim_token_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group` ADD CONSTRAINT `user_group_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_group_id_user_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;