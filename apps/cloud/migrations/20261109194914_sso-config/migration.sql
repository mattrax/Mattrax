CREATE TABLE `sso_config` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`azure_tenant_id` varchar(255),
	`auto_provision` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `sso_config_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
