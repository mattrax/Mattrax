CREATE TABLE `application_assignments` (
	`appPk` bigint unsigned NOT NULL,
	`pk` bigint unsigned NOT NULL,
	`variant` enum('user','device','group') NOT NULL,
	CONSTRAINT `application_assignments_appPk_pk_variant_pk` PRIMARY KEY(`appPk`,`pk`,`variant`)
);
--> statement-breakpoint
SELECT 1