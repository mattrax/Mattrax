CREATE TABLE `tenant_deletion` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`steps` json NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`requested_by_user_id` varchar(255),
	`requested_by_email` varchar(320),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `tenant_deletion_organization_unique` UNIQUE INDEX(`organization_id`)
);
--> statement-breakpoint
CREATE INDEX `tenant_deletion_status_updated_idx` ON `tenant_deletion` (`status`,`updated_at`);