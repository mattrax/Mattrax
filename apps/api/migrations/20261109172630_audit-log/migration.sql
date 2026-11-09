CREATE TABLE `audit_log` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`actor_user_id` varchar(255),
	`actor_email` varchar(320),
	`action` varchar(255) NOT NULL,
	`target_type` varchar(255) NOT NULL,
	`target_id` varchar(255),
	`metadata` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_log_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`),
	CONSTRAINT `audit_log_actor_user_id_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_log_organization_created_idx` ON `audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_organization_action_idx` ON `audit_log` (`organization_id`,`action`);