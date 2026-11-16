CREATE TABLE `scep_challenge` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`enrollment_id` varchar(255) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `scep_challenge_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `scep_challenge_org_idx` ON `scep_challenge` (`organization_id`);--> statement-breakpoint
CREATE INDEX `scep_challenge_enrollment_idx` ON `scep_challenge` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `scep_challenge_expires_at_idx` ON `scep_challenge` (`expires_at`);