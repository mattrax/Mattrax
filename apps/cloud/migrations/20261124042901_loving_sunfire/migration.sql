CREATE TABLE `apple_byod_config` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`domain` varchar(255),
	`validated_at` datetime(3),
	`hardware_validation_required` boolean NOT NULL DEFAULT true,
	`hardware_validated_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `apple_byod_config_domain_unique` UNIQUE INDEX(`domain`)
);
--> statement-breakpoint
CREATE TABLE `apple_byod_enrollment` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`managed_apple_account` varchar(320),
	`request_hash` varchar(64) NOT NULL,
	`account_id` varchar(255),
	`directory_user_id` varchar(255),
	`token_hash` varchar(64),
	`token_expires_at` datetime(3),
	`token_consumed_at` datetime(3),
	`challenge_expires_at` datetime(3) NOT NULL,
	`authorized_at` datetime(3),
	`apple_enrollment_id` varchar(255),
	`device_id` varchar(255),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `apple_byod_enrollment_token_unique` UNIQUE INDEX(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `scep_challenge` ADD `byod_enrollment_id` varchar(255);--> statement-breakpoint
ALTER TABLE `scep_issued_certificate` ADD `byod_enrollment_id` varchar(255);--> statement-breakpoint
CREATE INDEX `apple_byod_enrollment_organization_idx` ON `apple_byod_enrollment` (`organization_id`);--> statement-breakpoint
CREATE INDEX `apple_byod_enrollment_device_idx` ON `apple_byod_enrollment` (`device_id`);--> statement-breakpoint
CREATE INDEX `apple_byod_enrollment_account_idx` ON `apple_byod_enrollment` (`account_id`);--> statement-breakpoint
CREATE INDEX `apple_byod_enrollment_directory_user_idx` ON `apple_byod_enrollment` (`directory_user_id`);--> statement-breakpoint
CREATE INDEX `apple_byod_enrollment_challenge_expires_idx` ON `apple_byod_enrollment` (`challenge_expires_at`);--> statement-breakpoint
CREATE INDEX `scep_challenge_byod_idx` ON `scep_challenge` (`byod_enrollment_id`);--> statement-breakpoint
CREATE INDEX `scep_issued_certificate_byod_idx` ON `scep_issued_certificate` (`byod_enrollment_id`);--> statement-breakpoint
ALTER TABLE `apple_byod_config` ADD CONSTRAINT `apple_byod_config_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `apple_byod_enrollment` ADD CONSTRAINT `apple_byod_enrollment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `apple_byod_enrollment` ADD CONSTRAINT `apple_byod_enrollment_account_id_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `apple_byod_enrollment` ADD CONSTRAINT `apple_byod_enrollment_directory_user_id_user_id_fkey` FOREIGN KEY (`directory_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `apple_byod_enrollment` ADD CONSTRAINT `apple_byod_enrollment_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `scep_challenge` ADD CONSTRAINT `scep_challenge_byod_enrollment_id_apple_byod_enrollment_id_fkey` FOREIGN KEY (`byod_enrollment_id`) REFERENCES `apple_byod_enrollment`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `scep_issued_certificate` ADD CONSTRAINT `scep_issued_certificate_f8KR330CkuFa_fkey` FOREIGN KEY (`byod_enrollment_id`) REFERENCES `apple_byod_enrollment`(`id`) ON DELETE SET NULL;