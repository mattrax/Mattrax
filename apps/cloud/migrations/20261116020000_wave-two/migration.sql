CREATE TABLE `account_audit_log` (
	`id` varchar(255) PRIMARY KEY,
	`subject_user_id` varchar(255),
	`subject_email` varchar(320),
	`actor_user_id` varchar(255),
	`actor_email` varchar(320),
	`action` varchar(255) NOT NULL,
	`target_type` varchar(255) NOT NULL,
	`target_id` varchar(255),
	`metadata` json,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_email_change` (
	`id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`old_email` varchar(320) NOT NULL,
	`new_email` varchar(320) NOT NULL,
	`confirm_token_hash` varchar(255) NOT NULL,
	`cancel_token_hash` varchar(255) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`cancelled_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `account_email_change_confirm_unique` UNIQUE INDEX(`confirm_token_hash`),
	CONSTRAINT `account_email_change_cancel_unique` UNIQUE INDEX(`cancel_token_hash`)
);
--> statement-breakpoint
CREATE TABLE `account_recovery` (
	`id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`status` varchar(32) NOT NULL,
	`approval_required` boolean NOT NULL DEFAULT false,
	`approval_organization_id` varchar(255),
	`proof_token_hash` varchar(255) NOT NULL,
	`approval_token_hash` varchar(255),
	`completion_token_hash` varchar(255),
	`approved_by_user_id` varchar(255),
	`approved_at` datetime(3),
	`completed_at` datetime(3),
	`cancelled_at` datetime(3),
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `account_recovery_proof_unique` UNIQUE INDEX(`proof_token_hash`),
	CONSTRAINT `account_recovery_approval_unique` UNIQUE INDEX(`approval_token_hash`),
	CONSTRAINT `account_recovery_completion_unique` UNIQUE INDEX(`completion_token_hash`)
);
--> statement-breakpoint
CREATE TABLE `account_session_context` (
	`session_id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`ip_hash` varchar(32),
	`browser` varchar(255),
	`platform` varchar(255),
	`device_type` varchar(16),
	`created_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `apple_fde_escrow_key` (
	`organization_id` varchar(255) PRIMARY KEY,
	`certificate_pem` text NOT NULL,
	`sealed_private_key` text NOT NULL,
	`certificate_fingerprint_sha256` varchar(255) NOT NULL,
	`subject` varchar(255),
	`certificate_not_after` datetime(3),
	`source` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stripe_event` (
	`id` varchar(255) PRIMARY KEY,
	`type` varchar(255) NOT NULL,
	`organization_id` varchar(255),
	`received_at` datetime(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `device` ADD `passcode_present` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `passcode_compliant` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_install_state` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_pending_version` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_pending_build` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_failure_reason` text;--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_failure_count` int;--> statement-breakpoint
ALTER TABLE `device` ADD `os_update_failed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device` ADD `security_lockdown_mode` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `managed_certificate_count` int;--> statement-breakpoint
ALTER TABLE `device` ADD `management_apps` json;--> statement-breakpoint
ALTER TABLE `device` ADD `bitlocker_enabled` boolean;--> statement-breakpoint
ALTER TABLE `device` ADD `bitlocker_status` int;--> statement-breakpoint
ALTER TABLE `device` ADD `tpm_version` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `secure_boot_state` int;--> statement-breakpoint
ALTER TABLE `device` ADD `domain_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `entra_device_id` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `security_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_applied` json;--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_delivered` json;--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_reverting` json;--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_failures` json;--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_policy_reverted_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `declaration_mode` varchar(16);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `declaration_mode_reason` text;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `declaration_mode_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `is_activation_lock_manageable` boolean;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `security_info_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `security_info_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_secret` ADD `format` varchar(16) DEFAULT 'plaintext' NOT NULL;--> statement-breakpoint
ALTER TABLE `organization` ADD `require_mfa` boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Tenants that already required MFA through their SSO configuration keep the
-- requirement now that it is a tenant property.
UPDATE `organization` AS o
INNER JOIN `sso_config` AS s ON s.`organization_id` = o.`id`
SET o.`require_mfa` = true
WHERE s.`require_mfa` = true;--> statement-breakpoint
ALTER TABLE `scim_token` ADD `expires_at` datetime(3);--> statement-breakpoint
CREATE INDEX `account_audit_log_subject_created_idx` ON `account_audit_log` (`subject_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_audit_log_subject_action_idx` ON `account_audit_log` (`subject_user_id`,`action`);--> statement-breakpoint
CREATE INDEX `account_audit_log_action_created_idx` ON `account_audit_log` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_email_change_user_idx` ON `account_email_change` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_recovery_user_idx` ON `account_recovery` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_recovery_status_idx` ON `account_recovery` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_session_context_user_idx` ON `account_session_context` (`user_id`,`last_used_at`);--> statement-breakpoint
CREATE INDEX `account_session_context_last_used_idx` ON `account_session_context` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `scim_token_organization_expires_idx` ON `scim_token` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `stripe_event_organization_received_idx` ON `stripe_event` (`organization_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `stripe_event_received_idx` ON `stripe_event` (`received_at`);--> statement-breakpoint
ALTER TABLE `account_audit_log` ADD CONSTRAINT `account_audit_log_subject_user_id_user_id_fkey` FOREIGN KEY (`subject_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `account_audit_log` ADD CONSTRAINT `account_audit_log_actor_user_id_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `account_email_change` ADD CONSTRAINT `account_email_change_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `account_recovery` ADD CONSTRAINT `account_recovery_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `account_recovery` ADD CONSTRAINT `account_recovery_approval_organization_id_organization_id_fkey` FOREIGN KEY (`approval_organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `account_recovery` ADD CONSTRAINT `account_recovery_approved_by_user_id_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `account_session_context` ADD CONSTRAINT `account_session_context_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `apple_fde_escrow_key` ADD CONSTRAINT `apple_fde_escrow_key_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;