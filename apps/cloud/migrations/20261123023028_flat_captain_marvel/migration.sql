CREATE TABLE `approval_decision` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`request_id` varchar(255) NOT NULL,
	`approver_account_id` varchar(255),
	`approver_email` varchar(320),
	`decision` varchar(16) NOT NULL,
	`note` text,
	`rbac` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `approval_decision_request_approver_unique` UNIQUE INDEX(`request_id`,`approver_account_id`)
);
--> statement-breakpoint
CREATE TABLE `approval_policy` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`action` varchar(64) NOT NULL,
	`scope_type` varchar(16) NOT NULL DEFAULT 'tenant',
	`scope_id` varchar(255),
	`approver_permission` varchar(64),
	`approver_role` varchar(32),
	`approvals_required` int NOT NULL DEFAULT 1,
	`created_by_account_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approval_request` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`policy_id` varchar(255),
	`action` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`scope_type` varchar(16) NOT NULL DEFAULT 'tenant',
	`scope_id` varchar(255),
	`requested_by_account_id` varchar(255),
	`requested_by_email` varchar(320),
	`requested_by_credential` varchar(16),
	`payload_hash` varchar(64) NOT NULL,
	`payload_summary` json NOT NULL,
	`approver_permission` varchar(64),
	`approver_role` varchar(32),
	`approvals_required` int NOT NULL,
	`break_glass` boolean NOT NULL DEFAULT false,
	`break_glass_reason` text,
	`consumed_at` datetime(3),
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `attribute_collection` (
	`device_id` varchar(255) NOT NULL,
	`attribute_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`source` varchar(16) NOT NULL,
	`script_id` varchar(255),
	`last_collected_at` datetime(3),
	`last_error` text,
	`last_error_at` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`device_id`,`attribute_id`)
);
--> statement-breakpoint
CREATE TABLE `device_handover_archive` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`created_by_account_id` varchar(255) NOT NULL,
	`created_by_email` varchar(255) NOT NULL,
	`reason` text NOT NULL,
	`device_count` int NOT NULL,
	`devices` json NOT NULL,
	`secret_kinds` json NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` int NOT NULL,
	`sha256` varchar(255) NOT NULL,
	`envelope_version` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`downloaded_at` datetime(3)
);
--> statement-breakpoint
CREATE TABLE `device_local_account` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`username` varchar(255) NOT NULL,
	`full_name` varchar(255),
	`uid` int,
	`guid` varchar(255),
	`is_admin` boolean,
	`is_managed` boolean NOT NULL DEFAULT false,
	`has_secure_token` boolean,
	`is_logged_in` boolean,
	`mobile_account` boolean,
	`data_quota` bigint,
	`data_used` bigint,
	`last_login_at` datetime(3),
	`first_seen_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`reported_at` datetime(3) NOT NULL,
	CONSTRAINT `device_local_account_device_username_unique` UNIQUE INDEX(`device_id`,`username`)
);
--> statement-breakpoint
ALTER TABLE `attribute_definition` ADD `source` varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `attribute_definition` ADD `script_id` varchar(255);--> statement-breakpoint
ALTER TABLE `attribute_definition` ADD `script_output_key` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_message` text;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_phone` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_footnote` text;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_acknowledged_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_latitude` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_longitude` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_horizontal_accuracy` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_vertical_accuracy` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_location_reported_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_location_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `local_admin_guid` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `lost_mode_command_id` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `local_accounts_updated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `local_accounts_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_secret` ADD `pending_command_id` varchar(255);--> statement-breakpoint
ALTER TABLE `organization` ADD `local_account_health_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `organization` ADD `local_admin_rotation_days` int;--> statement-breakpoint
CREATE INDEX `approval_decision_organization_created_idx` ON `approval_decision` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_decision_approver_idx` ON `approval_decision` (`approver_account_id`);--> statement-breakpoint
CREATE INDEX `approval_policy_organization_action_idx` ON `approval_policy` (`organization_id`,`action`);--> statement-breakpoint
CREATE INDEX `approval_policy_created_by_idx` ON `approval_policy` (`created_by_account_id`);--> statement-breakpoint
CREATE INDEX `approval_request_organization_status_idx` ON `approval_request` (`organization_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `approval_request_requester_idx` ON `approval_request` (`requested_by_account_id`,`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_request_status_updated_idx` ON `approval_request` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `approval_request_payload_idx` ON `approval_request` (`organization_id`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `approval_request_policy_idx` ON `approval_request` (`policy_id`);--> statement-breakpoint
CREATE INDEX `attribute_collection_organization_idx` ON `attribute_collection` (`organization_id`);--> statement-breakpoint
CREATE INDEX `attribute_collection_attribute_idx` ON `attribute_collection` (`attribute_id`);--> statement-breakpoint
CREATE INDEX `attribute_collection_script_idx` ON `attribute_collection` (`script_id`);--> statement-breakpoint
CREATE INDEX `attribute_definition_script_idx` ON `attribute_definition` (`script_id`);--> statement-breakpoint
CREATE INDEX `device_handover_archive_organization_created_idx` ON `device_handover_archive` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `device_local_account_organization_idx` ON `device_local_account` (`organization_id`,`device_id`);--> statement-breakpoint
ALTER TABLE `approval_decision` ADD CONSTRAINT `approval_decision_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `approval_decision` ADD CONSTRAINT `approval_decision_request_id_approval_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `approval_request`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `approval_decision` ADD CONSTRAINT `approval_decision_approver_account_id_account_id_fkey` FOREIGN KEY (`approver_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `approval_policy` ADD CONSTRAINT `approval_policy_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `approval_policy` ADD CONSTRAINT `approval_policy_created_by_account_id_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `approval_request` ADD CONSTRAINT `approval_request_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `approval_request` ADD CONSTRAINT `approval_request_policy_id_approval_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `approval_policy`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `approval_request` ADD CONSTRAINT `approval_request_requested_by_account_id_account_id_fkey` FOREIGN KEY (`requested_by_account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `attribute_collection` ADD CONSTRAINT `attribute_collection_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `attribute_collection` ADD CONSTRAINT `attribute_collection_attribute_id_attribute_definition_id_fkey` FOREIGN KEY (`attribute_id`) REFERENCES `attribute_definition`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `attribute_collection` ADD CONSTRAINT `attribute_collection_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `attribute_collection` ADD CONSTRAINT `attribute_collection_script_id_script_id_fkey` FOREIGN KEY (`script_id`) REFERENCES `script`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `attribute_definition` ADD CONSTRAINT `attribute_definition_script_id_script_id_fkey` FOREIGN KEY (`script_id`) REFERENCES `script`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `device_handover_archive` ADD CONSTRAINT `device_handover_archive_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_local_account` ADD CONSTRAINT `device_local_account_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_local_account` ADD CONSTRAINT `device_local_account_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;