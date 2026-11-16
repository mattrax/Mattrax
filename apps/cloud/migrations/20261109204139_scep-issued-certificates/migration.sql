CREATE TABLE `scep_issued_certificate` (
	`serial` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`enrollment_id` varchar(255),
	`device_id` varchar(255),
	`not_after` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `scep_issued_certificate_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `scep_issued_certificate_org_idx` ON `scep_issued_certificate` (`organization_id`);