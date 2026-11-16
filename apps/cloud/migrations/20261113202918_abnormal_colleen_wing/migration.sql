CREATE TABLE `tenant_role` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`permissions` json NOT NULL,
	`created_by_user_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenant_role_organization_name_unique` UNIQUE INDEX(`organization_id`,`name`),
	CONSTRAINT `tenant_role_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `tenant_role_created_by_user_id_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `invitation` ADD `custom_role_id` varchar(255);--> statement-breakpoint
ALTER TABLE `member` ADD `custom_role_id` varchar(255);--> statement-breakpoint
CREATE INDEX `member_custom_role_idx` ON `member` (`custom_role_id`);--> statement-breakpoint
CREATE INDEX `tenant_role_organization_idx` ON `tenant_role` (`organization_id`);--> statement-breakpoint
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_custom_role_id_tenant_role_id_fkey` FOREIGN KEY (`custom_role_id`) REFERENCES `tenant_role`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_custom_role_id_tenant_role_id_fkey` FOREIGN KEY (`custom_role_id`) REFERENCES `tenant_role`(`id`) ON DELETE SET NULL;