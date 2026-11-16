CREATE TABLE `attribute_definition` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`key` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`type` varchar(16) NOT NULL DEFAULT 'text',
	`options` json,
	`required` boolean NOT NULL DEFAULT false,
	`visibility` varchar(16) NOT NULL DEFAULT 'visible',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `attribute_definition_organization_key_unique` UNIQUE INDEX(`organization_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `device_attribute` (
	`device_id` varchar(255) NOT NULL,
	`attribute_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`updated_by_user_id` varchar(255),
	`updated_at` datetime(3) NOT NULL,
	PRIMARY KEY(`device_id`,`attribute_id`)
);
--> statement-breakpoint
CREATE TABLE `enrollment_answer` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`enrollment_id` varchar(255) NOT NULL,
	`serial` varchar(128) NOT NULL,
	`attribute_id` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `enrollment_answer_organization_serial_attribute_unique` UNIQUE INDEX(`organization_id`,`serial`,`attribute_id`)
);
--> statement-breakpoint
CREATE TABLE `enrollment_question` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`attribute_id` varchar(255) NOT NULL,
	`prompt` varchar(255),
	`required` boolean,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `enrollment_question_organization_attribute_unique` UNIQUE INDEX(`organization_id`,`attribute_id`)
);
--> statement-breakpoint
CREATE TABLE `scep_ca_trust` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`cert_pem` text NOT NULL,
	`fingerprint_sha256` varchar(64) NOT NULL,
	`source` varchar(16) NOT NULL DEFAULT 'generated',
	`retired_at` datetime(3) NOT NULL,
	`trust_until` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `scep_ca_trust_org_fingerprint_unique` UNIQUE INDEX(`organization_id`,`fingerprint_sha256`)
);
--> statement-breakpoint
CREATE TABLE `script` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`language` varchar(8) NOT NULL,
	`body` text NOT NULL,
	`run_as` varchar(8) NOT NULL DEFAULT 'user',
	`timeout_seconds` int NOT NULL DEFAULT 300,
	`environment` json,
	`trigger_type` varchar(20) NOT NULL DEFAULT 'manual',
	`interval_seconds` int,
	`cron_expression` varchar(255),
	`enabled` boolean NOT NULL DEFAULT true,
	`created_by_user_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `script_assignment` (
	`script_id` varchar(255) NOT NULL,
	`organization_id` varchar(255) NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`target_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	PRIMARY KEY(`script_id`,`target_type`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `script_execution` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`script_id` varchar(255) NOT NULL,
	`device_id` varchar(255) NOT NULL,
	`trigger_type` varchar(20) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'queued',
	`dedupe_key` varchar(64),
	`requested_by_user_id` varchar(255),
	`exit_code` int,
	`stdout` text,
	`stderr` text,
	`stdout_truncated` boolean NOT NULL DEFAULT false,
	`stderr_truncated` boolean NOT NULL DEFAULT false,
	`duration_ms` int,
	`result_detail` text,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `script_execution_device_script_dedupe_unique` UNIQUE INDEX(`device_id`,`script_id`,`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `server_certificate_health` (
	`id` varchar(255) PRIMARY KEY,
	`origin` varchar(255) NOT NULL,
	`hostname` varchar(255) NOT NULL,
	`checked_at` datetime(3) NOT NULL,
	`not_before` datetime(3),
	`not_after` datetime(3),
	`subject` text,
	`issuer` text,
	`serial_number` varchar(255),
	`fingerprint_sha256` varchar(255),
	`authorized` boolean NOT NULL,
	`authorization_error` text,
	`chain_length` int NOT NULL,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `device_apple` ADD `enrollment_mode` varchar(16);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `awaiting_configuration` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `device_apple` ADD `setup_released_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `return_to_service_requested_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple` ADD `return_to_service_completed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `user_short_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `user_long_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `authenticated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `last_seen_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `profiles` json;--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `last_push_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `last_push_ok_at` datetime(3);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `last_push_error` varchar(255);--> statement-breakpoint
ALTER TABLE `device_apple_user` ADD `consecutive_push_failures` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `device_command` ADD `user_id` varchar(255);--> statement-breakpoint
ALTER TABLE `organization` ADD `scripts_enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `scep_issued_certificate` ADD `ca_fingerprint_sha256` varchar(64);--> statement-breakpoint
CREATE INDEX `attribute_definition_organization_sort_idx` ON `attribute_definition` (`organization_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `device_attribute_organization_idx` ON `device_attribute` (`organization_id`);--> statement-breakpoint
CREATE INDEX `device_attribute_attribute_idx` ON `device_attribute` (`attribute_id`);--> statement-breakpoint
CREATE INDEX `enrollment_answer_organization_serial_idx` ON `enrollment_answer` (`organization_id`,`serial`);--> statement-breakpoint
CREATE INDEX `enrollment_question_organization_sort_idx` ON `enrollment_question` (`organization_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `scep_ca_trust_org_idx` ON `scep_ca_trust` (`organization_id`);--> statement-breakpoint
CREATE INDEX `scep_ca_trust_trust_until_idx` ON `scep_ca_trust` (`trust_until`);--> statement-breakpoint
CREATE INDEX `scep_issued_certificate_ca_idx` ON `scep_issued_certificate` (`organization_id`,`ca_fingerprint_sha256`);--> statement-breakpoint
CREATE INDEX `script_organization_name_idx` ON `script` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `script_organization_enabled_idx` ON `script` (`organization_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `script_assignment_target_idx` ON `script_assignment` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `script_assignment_organization_idx` ON `script_assignment` (`organization_id`);--> statement-breakpoint
CREATE INDEX `script_execution_device_created_idx` ON `script_execution` (`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `script_execution_script_created_idx` ON `script_execution` (`script_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `script_execution_organization_created_idx` ON `script_execution` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `script_execution_status_expires_idx` ON `script_execution` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `script_execution_status_updated_idx` ON `script_execution` (`status`,`updated_at`);--> statement-breakpoint
ALTER TABLE `attribute_definition` ADD CONSTRAINT `attribute_definition_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_attribute` ADD CONSTRAINT `device_attribute_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_attribute` ADD CONSTRAINT `device_attribute_attribute_id_attribute_definition_id_fkey` FOREIGN KEY (`attribute_id`) REFERENCES `attribute_definition`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_attribute` ADD CONSTRAINT `device_attribute_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `device_attribute` ADD CONSTRAINT `device_attribute_updated_by_user_id_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `enrollment_answer` ADD CONSTRAINT `enrollment_answer_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enrollment_answer` ADD CONSTRAINT `enrollment_answer_enrollment_id_enterprise_enrollment_id_fkey` FOREIGN KEY (`enrollment_id`) REFERENCES `enterprise_enrollment`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enrollment_answer` ADD CONSTRAINT `enrollment_answer_attribute_id_attribute_definition_id_fkey` FOREIGN KEY (`attribute_id`) REFERENCES `attribute_definition`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enrollment_question` ADD CONSTRAINT `enrollment_question_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `enrollment_question` ADD CONSTRAINT `enrollment_question_attribute_id_attribute_definition_id_fkey` FOREIGN KEY (`attribute_id`) REFERENCES `attribute_definition`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `scep_ca_trust` ADD CONSTRAINT `scep_ca_trust_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script` ADD CONSTRAINT `script_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script` ADD CONSTRAINT `script_created_by_user_id_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `script_assignment` ADD CONSTRAINT `script_assignment_script_id_script_id_fkey` FOREIGN KEY (`script_id`) REFERENCES `script`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script_assignment` ADD CONSTRAINT `script_assignment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script_execution` ADD CONSTRAINT `script_execution_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script_execution` ADD CONSTRAINT `script_execution_script_id_script_id_fkey` FOREIGN KEY (`script_id`) REFERENCES `script`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script_execution` ADD CONSTRAINT `script_execution_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `script_execution` ADD CONSTRAINT `script_execution_requested_by_user_id_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;