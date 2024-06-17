DROP TABLE `windows_ephemeral_state`;--> statement-breakpoint
ALTER TABLE `devices` ADD `enrolled_by` bigint unsigned NOT NULL;