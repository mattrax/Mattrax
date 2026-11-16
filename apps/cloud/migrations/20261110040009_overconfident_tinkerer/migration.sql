CREATE TABLE `entra_directory_sync` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`users_delta_link` text,
	`groups_delta_link` text,
	`domains_synced_at` datetime(3),
	`last_synced_at` datetime(3),
	`last_attempted_at` datetime(3),
	`last_error` text,
	`last_counts` json,
	`status` varchar(32) NOT NULL DEFAULT 'idle',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sso_domain` (
	`domain` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'entra',
	`is_verified` boolean NOT NULL DEFAULT false,
	`verified_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_group` ADD `external_id` varchar(255);--> statement-breakpoint
ALTER TABLE `user_group` ADD `description` text;--> statement-breakpoint
ALTER TABLE `user_group` ADD `source` varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX `sso_domain_organization_idx` ON `sso_domain` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_external_unique` ON `user_group` (`organization_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `entra_directory_sync` ADD CONSTRAINT `entra_directory_sync_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `sso_domain` ADD CONSTRAINT `sso_domain_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;