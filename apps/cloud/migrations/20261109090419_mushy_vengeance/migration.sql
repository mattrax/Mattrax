CREATE TABLE `account_api_token` (
	`id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token_prefix` varchar(255) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`last_used_at` datetime(3),
	`expires_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `account_api_token_hash_unique` UNIQUE INDEX(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `apple_push_certificate` (
	`organization_id` varchar(255) PRIMARY KEY,
	`email` varchar(320) NOT NULL,
	`topic` varchar(255) NOT NULL,
	`cert_pem` text NOT NULL,
	`encrypted_key` text,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_credentials` (
	`credential_id` varchar(191) NOT NULL,
	`subject_id` varchar(191) NOT NULL,
	`revision` text NOT NULL,
	`active` boolean NOT NULL,
	CONSTRAINT `auth_credentials_key_0` UNIQUE INDEX(`credential_id`)
);
--> statement-breakpoint
CREATE TABLE `auth_identifiers` (
	`namespace` varchar(191) NOT NULL,
	`value` varchar(320) NOT NULL,
	`module_id` text,
	`credential_id` text,
	`subject_id` varchar(191) NOT NULL,
	`revision` text NOT NULL,
	`verified_at` bigint,
	`active` boolean NOT NULL,
	CONSTRAINT `auth_identifiers_key_0` UNIQUE INDEX(`namespace`,`value`)
);
--> statement-breakpoint
CREATE TABLE `auth_passwords` (
	`module_id` varchar(191) NOT NULL,
	`subject_id` varchar(191) NOT NULL,
	`credential_id` varchar(191) NOT NULL,
	`credential_revision` text NOT NULL,
	`verifier_version` text NOT NULL,
	`verifier` text NOT NULL,
	`normalization` text NOT NULL,
	CONSTRAINT `auth_passwords_key_0` UNIQUE INDEX(`module_id`,`subject_id`),
	CONSTRAINT `auth_passwords_key_1` UNIQUE INDEX(`module_id`,`credential_id`)
);
--> statement-breakpoint
CREATE TABLE `auth_pending` (
	`module_id` varchar(191) NOT NULL,
	`kind` text NOT NULL,
	`digest` varchar(191) NOT NULL,
	`version` text NOT NULL,
	`flow_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`binding_digest` text NOT NULL,
	`snapshot` text NOT NULL,
	`expires_at` bigint NOT NULL,
	`attempt_limit` bigint NOT NULL,
	`failed_attempts` bigint NOT NULL,
	`consumed` boolean NOT NULL,
	CONSTRAINT `auth_pending_key_0` UNIQUE INDEX(`digest`)
);
--> statement-breakpoint
CREATE TABLE `auth_proofs` (
	`module_id` varchar(191) NOT NULL,
	`purpose` varchar(191) NOT NULL,
	`series_key` varchar(191) NOT NULL,
	`proof_id` varchar(191) NOT NULL,
	`binding` text NOT NULL,
	`verifier_key_id` text NOT NULL,
	`verifier_digest` text NOT NULL,
	`issued_at` bigint NOT NULL,
	`expires_at` bigint NOT NULL,
	`failed_attempts` bigint NOT NULL,
	CONSTRAINT `auth_proofs_key_0` UNIQUE INDEX(`module_id`,`purpose`,`series_key`),
	CONSTRAINT `auth_proofs_key_1` UNIQUE INDEX(`module_id`,`proof_id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`session_id` varchar(191) NOT NULL,
	`subject_id` varchar(191) NOT NULL,
	`digest` varchar(191) NOT NULL,
	`security_revision` varchar(191) NOT NULL,
	`issued_at` bigint NOT NULL,
	`expires_at` bigint NOT NULL,
	`absolute_expires_at` bigint NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT `auth_sessions_key_0` UNIQUE INDEX(`session_id`),
	CONSTRAINT `auth_sessions_key_1` UNIQUE INDEX(`digest`)
);
--> statement-breakpoint
CREATE TABLE `configuration` (
	`kind` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`data` json NOT NULL,
	`hash` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`kind`,`policy_id`)
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`proto` varchar(16) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'enrolling',
	`name` varchar(255) NOT NULL,
	`model` varchar(255),
	`model_identifier` varchar(255),
	`serial` varchar(255),
	`enrolled_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`notes` text,
	`asset_tag` varchar(255),
	`physical_name` varchar(255),
	`vendor` varchar(255),
	`os_edition` varchar(255),
	`os_version` varchar(255),
	`os_build` varchar(255),
	`disk_total` varchar(255),
	`disk_used` varchar(255),
	`dm_identifier` varchar(255),
	`dm_cert_hash` varchar(255),
	CONSTRAINT `device_serial_unique` UNIQUE INDEX(`serial`)
);
--> statement-breakpoint
CREATE TABLE `device_apple` (
	`device_id` varchar(255) PRIMARY KEY,
	`enrollment_id` varchar(255),
	`token` text,
	`push_magic` varchar(255),
	`topic` varchar(255),
	`unlock_token` text,
	`bootstrap_token` text,
	`configured` boolean NOT NULL DEFAULT false,
	`device_token` varchar(255),
	`token_updated_at` datetime(3)
);
--> statement-breakpoint
CREATE TABLE `enterprise_enrollment` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`code` varchar(255),
	`enabled_apple` boolean NOT NULL DEFAULT true,
	`enabled_windows` boolean NOT NULL DEFAULT true,
	`enabled_android` boolean NOT NULL DEFAULT false,
	`enabled_asset_tag` boolean NOT NULL DEFAULT false,
	`max_devices` int NOT NULL DEFAULT 100,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enterprise_group` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`notes` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_device` (
	`group_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`device_id`)
);
--> statement-breakpoint
CREATE TABLE `group_policy` (
	`group_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`policy_id`)
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`inviter_id` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` varchar(32),
	`status` varchar(32) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`role` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `member_user_organization_unique` UNIQUE INDEX(`user_id`,`organization_id`)
);
--> statement-breakpoint
CREATE TABLE `organization` (
	`id` varchar(255) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`logo` text,
	`metadata` text,
	`stripe_customer_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `organization_slug_unique` UNIQUE INDEX(`slug`)
);
--> statement-breakpoint
CREATE TABLE `organization_device_usage` (
	`organization_id` varchar(255) NOT NULL,
	`period` varchar(32) NOT NULL,
	`billable_devices` int NOT NULL,
	`stripe_subscription_item_id` varchar(255),
	`last_reported_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `policy` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`notes` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scep_ca` (
	`id` int AUTO_INCREMENT PRIMARY KEY,
	`cert_pem` text NOT NULL,
	`private_key_jwk` json NOT NULL,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` varchar(255) PRIMARY KEY,
	`plan` varchar(255) NOT NULL,
	`reference_id` varchar(255) NOT NULL,
	`stripe_customer_id` varchar(255),
	`stripe_subscription_id` varchar(255),
	`status` varchar(32) NOT NULL,
	`period_start` datetime(3),
	`period_end` datetime(3),
	`cancel_at_period_end` boolean,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(255) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`stripe_customer_id` varchar(255),
	`disabled` boolean NOT NULL DEFAULT false,
	`auth_revision` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `user_email_unique` UNIQUE INDEX(`email`)
);
--> statement-breakpoint
CREATE INDEX `account_api_token_user_id_idx` ON `account_api_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_credentials_index_0` ON `auth_credentials` (`subject_id`,`active`,`credential_id`);--> statement-breakpoint
CREATE INDEX `auth_identifiers_index_0` ON `auth_identifiers` (`subject_id`,`namespace`,`value`);--> statement-breakpoint
CREATE INDEX `auth_pending_index_0` ON `auth_pending` (`module_id`,`expires_at`,`digest`);--> statement-breakpoint
CREATE INDEX `auth_sessions_index_0` ON `auth_sessions` (`subject_id`,`security_revision`,`session_id`);--> statement-breakpoint
CREATE INDEX `device_organization_id_idx` ON `device` (`organization_id`);--> statement-breakpoint
CREATE INDEX `enterprise_group_organization_id_idx` ON `enterprise_group` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_organization_id_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_organization_id_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `policy_organization_id_idx` ON `policy` (`organization_id`);--> statement-breakpoint
CREATE INDEX `subscription_reference_id_idx` ON `subscription` (`reference_id`);--> statement-breakpoint
ALTER TABLE `account_api_token` ADD CONSTRAINT `account_api_token_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `apple_push_certificate` ADD CONSTRAINT `apple_push_certificate_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `configuration` ADD CONSTRAINT `configuration_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device` ADD CONSTRAINT `device_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_apple` ADD CONSTRAINT `device_apple_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enterprise_enrollment` ADD CONSTRAINT `enterprise_enrollment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enterprise_group` ADD CONSTRAINT `enterprise_group_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_device` ADD CONSTRAINT `group_device_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_device` ADD CONSTRAINT `group_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_policy` ADD CONSTRAINT `group_policy_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_policy` ADD CONSTRAINT `group_policy_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_inviter_id_user_id_fkey` FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `organization_device_usage` ADD CONSTRAINT `organization_device_usage_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `policy` ADD CONSTRAINT `policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;