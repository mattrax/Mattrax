ALTER TABLE `device_apple` ADD `enrollment_id` text;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `bootstrap_token` text;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `configured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `device_token` text;
