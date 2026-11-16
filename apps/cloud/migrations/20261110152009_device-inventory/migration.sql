ALTER TABLE `device` ADD `filevault_enabled` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `battery_health` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `capabilities` json;--> statement-breakpoint
ALTER TABLE `device` ADD `model_number` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `inventory_updated_at` datetime(3);