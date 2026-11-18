CREATE TABLE `tenant_ownership_transfer` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`requested_by_user_id` varchar(255) NOT NULL,
	`target_user_id` varchar(255) NOT NULL,
	`status` varchar(32) NOT NULL,
	`token_hash` varchar(255),
	`expires_at` datetime(3) NOT NULL,
	`accepted_at` datetime(3),
	`cancelled_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tenant_ownership_transfer_token_unique` UNIQUE INDEX(`token_hash`),
	CONSTRAINT `tenant_ownership_transfer_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `tenant_ownership_transfer_requested_by_user_id_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `tenant_ownership_transfer_target_user_id_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tenant_ownership_transfer_organization_idx` ON `tenant_ownership_transfer` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `tenant_ownership_transfer_target_idx` ON `tenant_ownership_transfer` (`target_user_id`,`status`);