ALTER TABLE `entra_directory_sync` ADD `sync_interval_minutes` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entra_directory_sync` ADD `next_sync_at` datetime(3);--> statement-breakpoint
ALTER TABLE `entra_directory_sync` ADD `last_run_trigger` varchar(16);