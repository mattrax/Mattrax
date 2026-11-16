CREATE TABLE `application_installer` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`application_id` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'manifest',
	`bundle_id` varchar(255),
	`version` varchar(255),
	`manifest_url` text,
	`store_id` varchar(255),
	`file_name` varchar(255),
	`content_type` varchar(255),
	`size` int,
	`sha256` varchar(255),
	`r2_key` text,
	`min_os_version` varchar(255),
	`required_capability` varchar(255),
	`priority` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `application_installer_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `application_installer_application_id_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `application_installer_organization_idx` ON `application_installer` (`organization_id`);--> statement-breakpoint
CREATE INDEX `application_installer_application_idx` ON `application_installer` (`application_id`);
--> statement-breakpoint
INSERT INTO `application_installer` (
	`id`, `organization_id`, `application_id`, `platform`, `source`,
	`bundle_id`, `version`, `manifest_url`, `store_id`, `file_name`,
	`content_type`, `size`, `sha256`, `r2_key`, `priority`,
	`created_at`, `updated_at`
)
SELECT
	CONCAT('legacy_', `id`), `organization_id`, `id`, `platform`, `source`,
	`bundle_id`, `version`, `manifest_url`, `store_id`, `file_name`,
	`content_type`, `size`, `sha256`, `r2_key`, 0, `created_at`, `updated_at`
FROM `application`;
