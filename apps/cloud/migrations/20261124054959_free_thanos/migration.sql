CREATE TABLE `policy_certificate_material` (
	`kind` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`sealed_pfx` mediumtext NOT NULL,
	`sealed_password` text NOT NULL,
	`file_name` varchar(255),
	`certificate_pem` mediumtext NOT NULL,
	`subject` varchar(255) NOT NULL,
	`not_after` datetime(3) NOT NULL,
	`fingerprint_sha256` varchar(64) NOT NULL,
	`material_sha256` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`kind`,`policy_id`),
	CONSTRAINT `policy_certificate_material_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE,
	CONSTRAINT `policy_certificate_material_TQrTONqXPE3M_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `device` ADD `managed_certificates` json;--> statement-breakpoint
CREATE INDEX `policy_certificate_material_org_idx` ON `policy_certificate_material` (`organization_id`,`not_after`);--> statement-breakpoint
CREATE INDEX `policy_certificate_material_policy_idx` ON `policy_certificate_material` (`policy_id`);