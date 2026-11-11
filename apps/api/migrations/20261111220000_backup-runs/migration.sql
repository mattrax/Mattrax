CREATE TABLE `backup_run` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL,
	`r2_key` text,
	`size_bytes` bigint,
	`started_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	`error` text,
	`trigger` varchar(16) NOT NULL,
	`retention` varchar(16) NOT NULL DEFAULT 'default',
	CONSTRAINT `backup_run_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `backup_run_organization_started_idx` ON `backup_run` (`organization_id`,`started_at`);