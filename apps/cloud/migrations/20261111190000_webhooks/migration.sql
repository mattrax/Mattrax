CREATE TABLE `webhook_delivery` (
	`id` varchar(255) PRIMARY KEY,
	`endpoint_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`event` varchar(255) NOT NULL,
	`event_id` varchar(255),
	`payload` json,
	`status` varchar(16) NOT NULL,
	`attempt` int NOT NULL DEFAULT 1,
	`response_status` int,
	`error` text,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoint` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`secret_prefix` varchar(255),
	`description` text,
	`event_filters` json,
	`enabled` boolean NOT NULL DEFAULT true,
	`last_delivery_at` datetime(3),
	`last_delivery_status` varchar(16),
	`consecutive_failures` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_endpoint_created_idx` ON `webhook_delivery` (`endpoint_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_organization_created_idx` ON `webhook_delivery` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_status_attempt_idx` ON `webhook_delivery` (`status`,`attempt`);--> statement-breakpoint
CREATE INDEX `webhook_endpoint_organization_idx` ON `webhook_endpoint` (`organization_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_endpoint_id_webhook_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoint`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `webhook_delivery` ADD CONSTRAINT `webhook_delivery_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `webhook_endpoint` ADD CONSTRAINT `webhook_endpoint_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;