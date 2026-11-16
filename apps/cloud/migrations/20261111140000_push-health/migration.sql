ALTER TABLE `device_apple` ADD `last_push_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `last_push_ok_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `last_push_error` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `last_push_error_code` varchar(32);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `consecutive_push_failures` int DEFAULT 0 NOT NULL;