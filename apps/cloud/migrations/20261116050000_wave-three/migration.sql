CREATE TABLE `email_outbox` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255),
	`subject_user_id` varchar(255),
	`recipient` varchar(320) NOT NULL,
	`template` varchar(255) NOT NULL,
	`dedupe_key` varchar(255),
	`payload` json NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3) NOT NULL,
	`claimed_at` datetime(3),
	`last_error` text,
	`created_at` datetime(3) NOT NULL,
	`sent_at` datetime(3),
	CONSTRAINT `email_outbox_dedupe_key_unique` UNIQUE INDEX(`dedupe_key`),
	CONSTRAINT `email_outbox_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `email_outbox_subject_user_id_user_id_fkey` FOREIGN KEY (`subject_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `device_organization_name_idx` ON `device` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `device_organization_last_seen_idx` ON `device` (`organization_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `device_organization_status_idx` ON `device` (`organization_id`,`status`,`name`);--> statement-breakpoint
CREATE INDEX `device_organization_enrolled_idx` ON `device` (`organization_id`,`enrolled_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_next_attempt_idx` ON `email_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_organization_created_idx` ON `email_outbox` (`organization_id`,`created_at`);