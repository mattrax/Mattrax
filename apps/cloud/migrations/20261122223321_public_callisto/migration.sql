ALTER TABLE `device` ADD `name_push_enabled` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `applied_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `applied_name_at` datetime(3);