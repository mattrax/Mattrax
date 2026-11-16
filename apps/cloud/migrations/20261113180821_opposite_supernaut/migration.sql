CREATE TABLE `dashboard` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_by_user_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_widget` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`dashboard_id` varchar(255) NOT NULL,
	`type` varchar(24) NOT NULL,
	`title` varchar(255) NOT NULL,
	`config` json NOT NULL,
	`x` int NOT NULL DEFAULT 0,
	`y` int NOT NULL DEFAULT 0,
	`w` int NOT NULL DEFAULT 4,
	`h` int NOT NULL DEFAULT 3,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_organization_id_idx` ON `dashboard` (`organization_id`);--> statement-breakpoint
CREATE INDEX `dashboard_organization_default_idx` ON `dashboard` (`organization_id`,`is_default`);--> statement-breakpoint
CREATE INDEX `dashboard_widget_dashboard_idx` ON `dashboard_widget` (`dashboard_id`);--> statement-breakpoint
CREATE INDEX `dashboard_widget_organization_idx` ON `dashboard_widget` (`organization_id`);--> statement-breakpoint
ALTER TABLE `dashboard` ADD CONSTRAINT `dashboard_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `dashboard` ADD CONSTRAINT `dashboard_created_by_user_id_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `dashboard_widget` ADD CONSTRAINT `dashboard_widget_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `dashboard_widget` ADD CONSTRAINT `dashboard_widget_dashboard_id_dashboard_id_fkey` FOREIGN KEY (`dashboard_id`) REFERENCES `dashboard`(`id`) ON DELETE CASCADE;