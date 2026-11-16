CREATE TABLE `auth_totp_factor` (
	`scope` varchar(191) PRIMARY KEY,
	`state` text NOT NULL,
	`version` text NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `auth_totp_factor_scope_unique` UNIQUE INDEX(`scope`)
);
--> statement-breakpoint
ALTER TABLE `sso_config` ADD `require_mfa` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `totp_enabled` boolean DEFAULT false NOT NULL;