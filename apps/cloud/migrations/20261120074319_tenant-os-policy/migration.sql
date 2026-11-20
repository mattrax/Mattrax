CREATE TABLE `tenant_os_policy` (
	`organization_id` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`minimum_version` varchar(64),
	`enforcement` varchar(16) NOT NULL DEFAULT 'off',
	`deferral_days` int NOT NULL DEFAULT 0,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`platform`),
	CONSTRAINT `tenant_os_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`)
);
