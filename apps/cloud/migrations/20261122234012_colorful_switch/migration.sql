ALTER TABLE `device` ADD `lock_screen_message` text;--> statement-breakpoint
ALTER TABLE `device` ADD `lock_screen_include_asset_tag` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `applied_lock_screen_message` text;--> statement-breakpoint
ALTER TABLE `device` ADD `applied_lock_screen_asset_tag` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `applied_lock_screen_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `queued_lock_screen_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `queued_lock_screen_digest` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `queued_lock_screen_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device` ADD `applied_lock_screen_at` datetime(3);