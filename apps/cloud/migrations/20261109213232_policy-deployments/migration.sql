CREATE TABLE `policy_deployment` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`created_by_user_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `policy_deployment_version_unique` UNIQUE INDEX(`policy_id`,`version`),
	CONSTRAINT `policy_deployment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`),
	CONSTRAINT `policy_deployment_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`)
);
--> statement-breakpoint
CREATE INDEX `policy_deployment_policy_idx` ON `policy_deployment` (`policy_id`,`version`);