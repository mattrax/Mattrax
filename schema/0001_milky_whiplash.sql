CREATE TABLE `group_assignments` (
	`group` bigint unsigned NOT NULL,
	`pk` bigint unsigned NOT NULL,
	`variant` enum('policy','app') NOT NULL,
	CONSTRAINT `group_assignments_group_pk_variant_pk` PRIMARY KEY(`group`,`pk`,`variant`)
);
--> statement-breakpoint
DROP TABLE `assigned_policy`;--> statement-breakpoint
DROP TABLE `assigned_policy_status`;--> statement-breakpoint
SELECT 1