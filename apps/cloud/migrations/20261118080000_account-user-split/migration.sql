-- Split the dashboard identity from directory people.
--
-- `user` currently holds both: accounts that sign in, and directory-synced
-- people that never should have been accounts. Rename the auth table to
-- `account` (InnoDB follows the foreign keys), then create a tenant-scoped
-- `user` table for directory people and remap only the scoping links.
--
-- Existing directory-provisioned members keep their account and membership;
-- this migration does not revoke access. It does create the matching directory
-- user so device links, user policies and directory groups keep working, and
-- future directory sync writes users instead of accounts.
RENAME TABLE `user` TO `account`;
--> statement-breakpoint
ALTER TABLE `account` RENAME INDEX `user_email_unique` TO `account_email_unique`;
--> statement-breakpoint
ALTER TABLE `account` RENAME INDEX `user_welcome_email_sweep_idx` TO `account_welcome_email_sweep_idx`;
--> statement-breakpoint
-- MySQL follows the referenced table through RENAME TABLE but does not rename
-- the constraint, so replace it explicitly for a snapshot-stable name.
ALTER TABLE `account` DROP FOREIGN KEY `user_default_tenant_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_default_tenant_id_organization_id_fkey` FOREIGN KEY (`default_tenant_id`) REFERENCES `organization` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `member` DROP FOREIGN KEY `member_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `member` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `member` RENAME INDEX `member_user_organization_unique` TO `member_account_organization_unique`;
--> statement-breakpoint
ALTER TABLE `member` ADD CONSTRAINT `member_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `account_audit_log` DROP FOREIGN KEY `account_audit_log_subject_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_audit_log` DROP FOREIGN KEY `account_audit_log_actor_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_audit_log` RENAME COLUMN `subject_user_id` TO `subject_account_id`;
--> statement-breakpoint
ALTER TABLE `account_audit_log` RENAME COLUMN `actor_user_id` TO `actor_account_id`;
--> statement-breakpoint
ALTER TABLE `account_audit_log` ADD CONSTRAINT `account_audit_log_subject_account_id_account_id_fkey` FOREIGN KEY (`subject_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `account_audit_log` ADD CONSTRAINT `account_audit_log_actor_account_id_account_id_fkey` FOREIGN KEY (`actor_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `account_session_context` DROP FOREIGN KEY `account_session_context_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_session_context` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `account_session_context` RENAME INDEX `account_session_context_user_idx` TO `account_session_context_account_idx`;
--> statement-breakpoint
ALTER TABLE `account_session_context` ADD CONSTRAINT `account_session_context_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `account_email_change` DROP FOREIGN KEY `account_email_change_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_email_change` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `account_email_change` RENAME INDEX `account_email_change_user_idx` TO `account_email_change_account_idx`;
--> statement-breakpoint
ALTER TABLE `account_email_change` ADD CONSTRAINT `account_email_change_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `account_recovery` DROP FOREIGN KEY `account_recovery_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_recovery` DROP FOREIGN KEY `account_recovery_approved_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_recovery` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `account_recovery` RENAME COLUMN `approved_by_user_id` TO `approved_by_account_id`;
--> statement-breakpoint
ALTER TABLE `account_recovery` RENAME INDEX `account_recovery_user_idx` TO `account_recovery_account_idx`;
--> statement-breakpoint
ALTER TABLE `account_recovery` ADD CONSTRAINT `account_recovery_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `account_recovery` ADD CONSTRAINT `account_recovery_approved_by_account_id_account_id_fkey` FOREIGN KEY (`approved_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `invitation` DROP FOREIGN KEY `invitation_inviter_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_inviter_id_account_id_fkey` FOREIGN KEY (`inviter_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` DROP FOREIGN KEY `tenant_ownership_transfer_requested_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` DROP FOREIGN KEY `tenant_ownership_transfer_target_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` RENAME COLUMN `requested_by_user_id` TO `requested_by_account_id`;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` RENAME COLUMN `target_user_id` TO `target_account_id`;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` ADD CONSTRAINT `tenant_ownership_transfer_hpgmq4br4Kfr_fkey` FOREIGN KEY (`requested_by_account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `tenant_ownership_transfer` ADD CONSTRAINT `tenant_ownership_transfer_target_account_id_account_id_fkey` FOREIGN KEY (`target_account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `account_api_token` DROP FOREIGN KEY `account_api_token_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `account_api_token` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `account_api_token` RENAME INDEX `account_api_token_user_id_idx` TO `account_api_token_account_id_idx`;
--> statement-breakpoint
ALTER TABLE `account_api_token` ADD CONSTRAINT `account_api_token_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` DROP FOREIGN KEY `mcp_oauth_connection_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` RENAME INDEX `mcp_oauth_connection_user_idx` TO `mcp_oauth_connection_account_idx`;
--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` ADD CONSTRAINT `mcp_oauth_connection_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `sso_identity` DROP FOREIGN KEY `sso_identity_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `sso_identity` RENAME COLUMN `user_id` TO `account_id`;
--> statement-breakpoint
ALTER TABLE `sso_identity` ADD CONSTRAINT `sso_identity_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `audit_log` DROP FOREIGN KEY `audit_log_actor_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `audit_log` RENAME COLUMN `actor_user_id` TO `actor_account_id`;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_account_id_account_id_fkey` FOREIGN KEY (`actor_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `email_outbox` DROP FOREIGN KEY `email_outbox_subject_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `email_outbox` RENAME COLUMN `subject_user_id` TO `subject_account_id`;
--> statement-breakpoint
ALTER TABLE `email_outbox` ADD CONSTRAINT `email_outbox_subject_account_id_account_id_fkey` FOREIGN KEY (`subject_account_id`) REFERENCES `account` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `device_attribute` DROP FOREIGN KEY `device_attribute_updated_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `device_attribute` RENAME COLUMN `updated_by_user_id` TO `updated_by_account_id`;
--> statement-breakpoint
ALTER TABLE `device_attribute` ADD CONSTRAINT `device_attribute_updated_by_account_id_account_id_fkey` FOREIGN KEY (`updated_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `dashboard` DROP FOREIGN KEY `dashboard_created_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `dashboard` RENAME COLUMN `created_by_user_id` TO `created_by_account_id`;
--> statement-breakpoint
ALTER TABLE `dashboard` ADD CONSTRAINT `dashboard_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `script` DROP FOREIGN KEY `script_created_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `script` RENAME COLUMN `created_by_user_id` TO `created_by_account_id`;
--> statement-breakpoint
ALTER TABLE `script` ADD CONSTRAINT `script_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `script_execution` DROP FOREIGN KEY `script_execution_requested_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `script_execution` RENAME COLUMN `requested_by_user_id` TO `requested_by_account_id`;
--> statement-breakpoint
ALTER TABLE `script_execution` ADD CONSTRAINT `script_execution_requested_by_account_id_account_id_fkey` FOREIGN KEY (`requested_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `tenant_role` DROP FOREIGN KEY `tenant_role_created_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `tenant_role` RENAME COLUMN `created_by_user_id` TO `created_by_account_id`;
--> statement-breakpoint
ALTER TABLE `tenant_role` ADD CONSTRAINT `tenant_role_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account` (`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `tenant_deletion` RENAME COLUMN `requested_by_user_id` TO `requested_by_account_id`;
--> statement-breakpoint
ALTER TABLE `policy_deployment` RENAME COLUMN `created_by_user_id` TO `created_by_account_id`;
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`external_id` varchar(255),
	`source` varchar(16) NOT NULL DEFAULT 'manual',
	`disabled` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `user_organization_email_unique` UNIQUE INDEX(`organization_id`,`email`),
	CONSTRAINT `user_organization_external_unique` UNIQUE INDEX(`organization_id`,`external_id`),
	CONSTRAINT `user_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `user_organization_idx` ON `user` (`organization_id`,`name`);
--> statement-breakpoint
CREATE TABLE `_account_user_map` (
	`account_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	PRIMARY KEY (`account_id`, `organization_id`),
	UNIQUE INDEX `_account_user_map_user_unique` (`user_id`)
);
--> statement-breakpoint
INSERT IGNORE INTO `_account_user_map` (`account_id`, `organization_id`, `user_id`)
SELECT `member`.`account_id`, `member`.`organization_id`, REPLACE(UUID(), '-', '')
FROM `member`
INNER JOIN `account` ON `account`.`id` = `member`.`account_id`
WHERE `account`.`source` IN ('graph', 'scim');
--> statement-breakpoint
INSERT IGNORE INTO `_account_user_map` (`account_id`, `organization_id`, `user_id`)
SELECT `device_user`.`user_id`, `device_user`.`organization_id`, REPLACE(UUID(), '-', '')
FROM `device_user`;
--> statement-breakpoint
INSERT IGNORE INTO `_account_user_map` (`account_id`, `organization_id`, `user_id`)
SELECT `user_policy`.`user_id`, `user_policy`.`organization_id`, REPLACE(UUID(), '-', '')
FROM `user_policy`;
--> statement-breakpoint
INSERT IGNORE INTO `_account_user_map` (`account_id`, `organization_id`, `user_id`)
SELECT `user_group_member`.`user_id`, `user_group`.`organization_id`, REPLACE(UUID(), '-', '')
FROM `user_group_member`
INNER JOIN `user_group` ON `user_group`.`id` = `user_group_member`.`group_id`;
--> statement-breakpoint
INSERT INTO `user` (`id`, `organization_id`, `name`, `email`, `external_id`, `source`, `disabled`, `created_at`, `updated_at`)
SELECT
	`map`.`user_id`,
	`map`.`organization_id`,
	`account`.`name`,
	`account`.`email`,
	(SELECT `sso_identity`.`object_id` FROM `sso_identity`
		WHERE `sso_identity`.`organization_id` = `map`.`organization_id`
			AND `sso_identity`.`account_id` = `map`.`account_id`
		LIMIT 1),
	CASE `account`.`source` WHEN 'graph' THEN 'entra' WHEN 'scim' THEN 'scim' ELSE 'manual' END,
	`account`.`disabled`,
	`account`.`created_at`,
	`account`.`updated_at`
FROM `_account_user_map` AS `map`
INNER JOIN `account` ON `account`.`id` = `map`.`account_id`;
--> statement-breakpoint
CREATE TABLE `_user_group_member` (
	`group_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	PRIMARY KEY (`group_id`, `user_id`),
	INDEX `user_group_member_user_id_user_id_fkey` (`user_id`)
);
--> statement-breakpoint
INSERT INTO `_user_group_member` (`group_id`, `user_id`)
SELECT `member`.`group_id`, `map`.`user_id`
FROM `user_group_member` AS `member`
INNER JOIN `user_group` ON `user_group`.`id` = `member`.`group_id`
INNER JOIN `_account_user_map` AS `map`
	ON `map`.`account_id` = `member`.`user_id`
	AND `map`.`organization_id` = `user_group`.`organization_id`;
--> statement-breakpoint
DROP TABLE `user_group_member`;
--> statement-breakpoint
RENAME TABLE `_user_group_member` TO `user_group_member`;
--> statement-breakpoint
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_group_id_user_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `user_group` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `user_group_member` ADD CONSTRAINT `user_group_member_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE `_device_user` (
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'manual',
	`created_at` datetime(3) NOT NULL,
	PRIMARY KEY (`device_id`, `user_id`),
	INDEX `device_user_device_idx` (`device_id`),
	INDEX `device_user_user_idx` (`user_id`),
	INDEX `device_user_organization_idx` (`organization_id`)
);
--> statement-breakpoint
INSERT INTO `_device_user` (`organization_id`, `device_id`, `user_id`, `source`, `created_at`)
SELECT `link`.`organization_id`, `link`.`device_id`, `map`.`user_id`, `link`.`source`, `link`.`created_at`
FROM `device_user` AS `link`
INNER JOIN `_account_user_map` AS `map`
	ON `map`.`account_id` = `link`.`user_id`
	AND `map`.`organization_id` = `link`.`organization_id`;
--> statement-breakpoint
DROP TABLE `device_user`;
--> statement-breakpoint
RENAME TABLE `_device_user` TO `device_user`;
--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `device_user` ADD CONSTRAINT `device_user_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TABLE `_user_policy` (
	`organization_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`policy_id` varchar(255) NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'include',
	`created_at` datetime(3) NOT NULL,
	PRIMARY KEY (`user_id`, `policy_id`),
	INDEX `user_policy_user_idx` (`user_id`),
	INDEX `user_policy_policy_idx` (`policy_id`),
	INDEX `user_policy_organization_idx` (`organization_id`)
);
--> statement-breakpoint
INSERT INTO `_user_policy` (`organization_id`, `user_id`, `policy_id`, `mode`, `created_at`)
SELECT `link`.`organization_id`, `map`.`user_id`, `link`.`policy_id`, `link`.`mode`, `link`.`created_at`
FROM `user_policy` AS `link`
INNER JOIN `_account_user_map` AS `map`
	ON `map`.`account_id` = `link`.`user_id`
	AND `map`.`organization_id` = `link`.`organization_id`;
--> statement-breakpoint
DROP TABLE `user_policy`;
--> statement-breakpoint
RENAME TABLE `_user_policy` TO `user_policy`;
--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `user_policy` ADD CONSTRAINT `user_policy_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE;
--> statement-breakpoint
DROP TABLE `_account_user_map`;
