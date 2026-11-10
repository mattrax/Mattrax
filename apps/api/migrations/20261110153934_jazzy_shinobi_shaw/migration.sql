CREATE TABLE `enrollment_attempt` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`enrollment_id` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL DEFAULT 'unknown',
	`outcome` varchar(16) NOT NULL,
	`detail` varchar(255),
	`ip_hash` varchar(64),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `enrollment_attempt_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`)
);
--> statement-breakpoint
CREATE INDEX `enrollment_attempt_organization_created_idx` ON `enrollment_attempt` (`organization_id`,`created_at`);