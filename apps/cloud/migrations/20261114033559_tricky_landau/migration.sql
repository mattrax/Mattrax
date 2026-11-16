ALTER TABLE `invitation` ADD `last_sent_at` datetime(3);--> statement-breakpoint
ALTER TABLE `invitation` ADD `send_count` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `invitation` ADD `accepted_at` datetime(3);--> statement-breakpoint
CREATE INDEX `invitation_organization_email_idx` ON `invitation` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `invitation_organization_status_idx` ON `invitation` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_unique` ON `invitation` (`token_hash`);