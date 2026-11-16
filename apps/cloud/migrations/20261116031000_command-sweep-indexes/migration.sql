CREATE INDEX `device_command_status_expires_idx` ON `device_command` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `device_command_status_updated_idx` ON `device_command` (`status`,`updated_at`);
